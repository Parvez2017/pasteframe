chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "SSC_OFFLOAD_CLIPBOARD_PNG") return false;

  (async () => {
    try {
      const binary = atob(msg.b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: "image/png" });
      try {
        window.focus();
      } catch (_) {}
      if (document.body) {
        document.body.tabIndex = -1;
        document.body.focus();
      }
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r))
      );
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      sendResponse({ ok: true });
    } catch (e) {
      console.error("SSC offscreen clipboard:", e);
      sendResponse({ ok: false, error: String(e.message || e) });
    }
  })();

  return true;
});
