const statusEl = document.getElementById("status");

function setStatus(text, variant = "ok") {
  statusEl.textContent = text;
  statusEl.className = "status";
  if (variant === "error") statusEl.classList.add("error");
  if (variant === "muted") statusEl.classList.add("muted");
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function restrictedUrl(url) {
  if (!url) return true;
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("devtools://") ||
    url.startsWith("view-source:")
  );
}

function dataUrlToBlob(dataUrl) {
  const [header, b64] = dataUrl.split(",");
  const mime = /data:([^;]+);/.exec(header)?.[1] || "image/png";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function copyBlobToClipboard(blob) {
  await navigator.clipboard.write([
    new ClipboardItem({
      [blob.type]: blob,
    }),
  ]);
}

async function captureVisibleDataUrl(windowId) {
  return chrome.tabs.captureVisibleTab(windowId ?? null, { format: "png" });
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = dataUrl;
  });
}

async function injectFunc(tabId, func, args = []) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
  });
  return result;
}

async function copyVisible() {
  const tab = await getActiveTab();
  if (!tab?.id || restrictedUrl(tab.url)) {
    setStatus("Can't capture this page (browser internal URL).", "error");
    return;
  }
  setStatus("Copying…", "muted");
  const dataUrl = await captureVisibleDataUrl(tab.windowId);
  const blob = dataUrlToBlob(dataUrl);
  await copyBlobToClipboard(blob);
  setStatus("Copied visible area.");
}

async function copyFullPage() {
  const tab = await getActiveTab();
  if (!tab?.id || restrictedUrl(tab.url)) {
    setStatus("Can't capture this page (browser internal URL).", "error");
    return;
  }

  setStatus("Scrolling & capturing…", "muted");
  const tabId = tab.id;

  const metrics = await injectFunc(tabId, () => ({
    scrollHeight: Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight || 0
    ),
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    scrollY: window.scrollY,
    scrollX: window.scrollX,
  }));

  const { scrollHeight, innerHeight, innerWidth, scrollY, scrollX } = metrics;
  if (!innerHeight || innerHeight < 1) {
    setStatus("Could not read page size.", "error");
    return;
  }

  const slices = Math.max(1, Math.ceil(scrollHeight / innerHeight));
  const shots = [];

  await injectFunc(tabId, (y) => {
    window.scrollTo({ top: y, left: 0, behavior: "instant" });
  }, [0]);

  await new Promise((r) => setTimeout(r, 200));

  for (let i = 0; i < slices; i++) {
    const y = i * innerHeight;
    await injectFunc(
      tabId,
      (top) => {
        window.scrollTo({ top, left: 0, behavior: "instant" });
      },
      [y]
    );
    await new Promise((r) => setTimeout(r, 200));
    const dataUrl = await captureVisibleDataUrl(tab.windowId);
    const img = await loadImageFromDataUrl(dataUrl);
    const sliceCssH = Math.min(innerHeight, scrollHeight - y);
    const srcH = Math.round(sliceCssH * (img.height / innerHeight));
    shots.push({ dataUrl, img, srcH, sliceCssH });
  }

  await injectFunc(
    tabId,
    (sx, sy) => {
      window.scrollTo({ top: sy, left: sx, behavior: "instant" });
    },
    [scrollX, scrollY]
  );

  const first = shots[0]?.img;
  if (!first) {
    setStatus("No captures.", "error");
    return;
  }

  const scaleY = first.height / innerHeight;
  let totalPx = 0;
  for (const s of shots) totalPx += s.srcH;

  const canvas = document.createElement("canvas");
  canvas.width = first.width;
  canvas.height = totalPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    setStatus("Canvas not available.", "error");
    return;
  }

  let destY = 0;
  for (const s of shots) {
    ctx.drawImage(s.img, 0, 0, s.img.width, s.srcH, 0, destY, s.img.width, s.srcH);
    destY += s.srcH;
  }

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
  });
  await copyBlobToClipboard(blob);
  setStatus("Copied full page.");
}

async function copyRegion() {
  const tab = await getActiveTab();
  if (!tab?.id || restrictedUrl(tab.url)) {
    setStatus("Can't capture this page (browser internal URL).", "error");
    return;
  }

  setStatus("Drag a region, then click Copy in the bar at the bottom.", "muted");

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/region-picker.js"],
    });
  } catch (e) {
    setStatus("Could not inject on this page.", "error");
    return;
  }

  setStatus("After Copy, check the extension badge (✓) if the popup closed.");
}

document.getElementById("btn-visible").addEventListener("click", () => {
  copyVisible().catch((e) => {
    console.error(e);
    setStatus(e.message || "Copy failed.", "error");
  });
});

document.getElementById("btn-full").addEventListener("click", () => {
  copyFullPage().catch((e) => {
    console.error(e);
    setStatus(e.message || "Copy failed.", "error");
  });
});

document.getElementById("btn-region").addEventListener("click", () => {
  copyRegion().catch((e) => {
    console.error(e);
    setStatus(e.message || "Copy failed.", "error");
  });
});
