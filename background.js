importScripts("util.js");

async function injectFunc(tabId, func, args = []) {
  const injected = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
  });
  return injected[0]?.result;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "SSC_OFFLOAD_CLIPBOARD_PNG") {
    return false;
  }

  if (msg?.type === "SSC_REGION_DONE" && sender.tab?.id) {
    copyRegionFromTab(sender.tab.id, msg.rect)
      .then(() => {
        chrome.action.setBadgeText({ text: "✓" });
        chrome.action.setBadgeBackgroundColor({ color: "#0d6e3d" });
        setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2500);
        sendResponse({ ok: true });
      })
      .catch((e) => {
        console.error(e);
        chrome.action.setBadgeText({ text: "!" });
        chrome.action.setBadgeBackgroundColor({ color: "#b00020" });
        setTimeout(() => chrome.action.setBadgeText({ text: "" }), 3000);
        sendResponse({ ok: false, error: String(e.message || e) });
      });
    return true;
  }
  if (msg?.type === "SSC_REGION_CANCEL") {
    sendResponse({ ok: false });
  }
  return false;
});

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = fr.result;
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

async function offscreenClipboardDocOpen() {
  if (!chrome.runtime.getContexts) return false;
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  return contexts.some((c) => c.documentUrl?.includes("offscreen.html"));
}

async function ensureOffscreenClipboardDoc() {
  if (typeof chrome.offscreen === "undefined") {
    throw new Error("Offscreen API unavailable (Chrome 109+ required)");
  }
  if (await offscreenClipboardDocOpen()) return;
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["CLIPBOARD"],
      justification: "Write region screenshot to the system clipboard after the user selects an area",
    });
  } catch (e) {
    const msg = String(e?.message || e);
    if (!msg.includes("single") && !msg.includes("Already")) throw e;
  }
}

function sendClipboardPayloadToOffscreen(b64) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "SSC_OFFLOAD_CLIPBOARD_PNG", b64 },
      (response) => {
        resolve({
          response,
          lastError: chrome.runtime.lastError?.message,
        });
      }
    );
  });
}

async function writePngToClipboardViaOffscreen(blob) {
  const b64 = await blobToBase64(blob);
  await ensureOffscreenClipboardDoc();

  let lastFailure = "";
  for (let attempt = 0; attempt < 40; attempt++) {
    const { response, lastError } = await sendClipboardPayloadToOffscreen(b64);
    if (lastError) {
      lastFailure = lastError;
      await new Promise((r) => setTimeout(r, 50));
      continue;
    }
    if (response?.ok) return;
    if (response?.error) throw new Error(response.error);
    lastFailure = "No response from clipboard page";
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(lastFailure || "Clipboard write failed");
}

async function writePngToClipboard(blob, tabId) {
  const b64 = await blobToBase64(blob);
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    if (typeof tab.windowId === "number" && tab.windowId >= 0) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    await new Promise((r) => setTimeout(r, 120));

    await chrome.scripting.executeScript({
      target: { tabId },
      func: async (payload) => {
        const binary = atob(payload);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const bl = new Blob([bytes], { type: "image/png" });
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": bl }),
        ]);
      },
      args: [b64],
    });
    return;
  } catch (e) {
    console.warn("SSC: focused-tab clipboard failed, using offscreen", e);
  }
  await writePngToClipboardViaOffscreen(blob);
}

async function copyRegionFromTab(tabId, rect) {
  const { x, y, width, height } = rect;
  const inner = await injectFunc(tabId, () => ({
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
  }));
  if (!inner?.innerWidth) throw new Error("Could not read viewport");

  const tab = await chrome.tabs.get(tabId);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const bitmap = await loadImageBitmapFromDataUrl(dataUrl);

  const sx = (x * bitmap.width) / inner.innerWidth;
  const sy = (y * bitmap.height) / inner.innerHeight;
  const sw = (width * bitmap.width) / inner.innerWidth;
  const sh = (height * bitmap.height) / inner.innerHeight;

  const cw = Math.max(1, Math.round(sw));
  const ch = Math.max(1, Math.round(sh));
  const canvas = new OffscreenCanvas(cw, ch);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2d context");

  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, cw, ch);
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: "image/png" });
  await writePngToClipboard(blob, tabId);
}
