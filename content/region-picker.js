(function () {
  if (window.__SSC_REGION_ACTIVE) return;
  window.__SSC_REGION_ACTIVE = true;

  function sendToBg(msg) {
    try {
      if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
        console.error(
          "PasteFrame: chrome.runtime is unavailable — reload the extension or use a normal webpage tab."
        );
        return;
      }
      chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError);
    } catch (err) {
      console.error("PasteFrame:", err);
    }
  }

  function teardownSoon() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => teardown());
    });
  }

  const Z = 2147483000;
  const DIM = "rgba(10, 12, 16, 0.72)";

  const style = document.createElement("style");
  style.textContent = `
    [data-ssc-root] { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    [data-ssc-root] .ssc-shade { position: fixed; background: ${DIM}; z-index: ${Z}; pointer-events: auto; }
    [data-ssc-root] .ssc-hole { position: fixed; z-index: ${Z + 1}; pointer-events: auto; cursor: default; }
    [data-ssc-root] .ssc-frame { position: fixed; z-index: ${Z + 2}; pointer-events: none;
      box-sizing: border-box; border: 2px solid #fff;
      box-shadow: 0 0 0 1px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(0,0,0,0.2); }
    [data-ssc-root] .ssc-corner { position: absolute; width: 12px; height: 12px; border: 2px solid #fff;
      box-shadow: 0 0 2px rgba(0,0,0,0.5); box-sizing: border-box; }
    [data-ssc-root] .ssc-c-tl { top: -2px; left: -2px; border-right: none; border-bottom: none; }
    [data-ssc-root] .ssc-c-tr { top: -2px; right: -2px; border-left: none; border-bottom: none; }
    [data-ssc-root] .ssc-c-bl { bottom: -2px; left: -2px; border-right: none; border-top: none; }
    [data-ssc-root] .ssc-c-br { bottom: -2px; right: -2px; border-left: none; border-top: none; }
    [data-ssc-root] .ssc-label { position: fixed; z-index: ${Z + 3}; pointer-events: none;
      font-size: 12px; font-weight: 600; letter-spacing: 0.02em; color: #fff;
      background: rgba(0,0,0,0.78); padding: 5px 10px; border-radius: 6px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.35); }
    [data-ssc-root] .ssc-toolbar { position: fixed; z-index: ${Z + 4}; left: 50%; bottom: 28px;
      transform: translateX(-50%); display: none; align-items: center; gap: 10px;
      padding: 10px 14px; border-radius: 12px;
      background: rgba(28, 28, 32, 0.94); backdrop-filter: blur(10px);
      box-shadow: 0 8px 32px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.06); }
    [data-ssc-root] .ssc-toolbar.ssc-visible { display: flex; }
    [data-ssc-root] .ssc-btn { border: none; cursor: pointer; font-size: 13px; font-weight: 600;
      padding: 9px 16px; border-radius: 8px; transition: background 0.12s, opacity 0.12s; }
    [data-ssc-root] .ssc-btn-ghost { background: transparent; color: rgba(255,255,255,0.75); }
    [data-ssc-root] .ssc-btn-ghost:hover { background: rgba(255,255,255,0.08); color: #fff; }
    [data-ssc-root] .ssc-btn-primary { background: #fff; color: #111; }
    [data-ssc-root] .ssc-btn-primary:hover { background: #e8e8e8; }
    [data-ssc-root] .ssc-hint { position: fixed; z-index: ${Z + 4}; left: 50%; bottom: 96px;
      transform: translateX(-50%); font-size: 12px; color: rgba(255,255,255,0.55);
      text-shadow: 0 1px 4px rgba(0,0,0,0.8); pointer-events: none; white-space: nowrap; }
  `;

  const root = document.createElement("div");
  root.setAttribute("data-ssc-root", "1");

  const backdrop = document.createElement("div");
  Object.assign(backdrop.style, {
    position: "fixed",
    inset: "0",
    zIndex: String(Z),
    background: DIM,
    cursor: "crosshair",
    pointerEvents: "auto",
  });

  const top = document.createElement("div");
  const bottom = document.createElement("div");
  const left = document.createElement("div");
  const right = document.createElement("div");
  [top, bottom, left, right].forEach((el) => {
    el.className = "ssc-shade";
    el.style.display = "none";
  });

  const holeCover = document.createElement("div");
  holeCover.className = "ssc-hole";

  const frame = document.createElement("div");
  frame.className = "ssc-frame";
  frame.style.display = "none";
  ["tl", "tr", "bl", "br"].forEach((k) => {
    const c = document.createElement("div");
    c.className = "ssc-corner ssc-c-" + k;
    frame.appendChild(c);
  });

  const label = document.createElement("div");
  label.className = "ssc-label";
  label.style.display = "none";

  const hint = document.createElement("div");
  hint.className = "ssc-hint";
  hint.textContent = "Click and drag to select · Esc to cancel";

  const toolbar = document.createElement("div");
  toolbar.className = "ssc-toolbar";
  toolbar.innerHTML = `
    <button type="button" class="ssc-btn ssc-btn-ghost" data-ssc="adjust">Adjust</button>
    <button type="button" class="ssc-btn ssc-btn-ghost" data-ssc="cancel">Cancel</button>
    <button type="button" class="ssc-btn ssc-btn-primary" data-ssc="copy">Copy to clipboard</button>
  `;

  let startX = 0;
  let startY = 0;
  let dragging = false;
  let confirmMode = false;
  let rx = 0;
  let ry = 0;
  let rw = 0;
  let rh = 0;

  function layoutShades(x, y, w, h) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const bx = x + w;
    const by = y + h;

    Object.assign(top.style, { left: "0", top: "0", width: "100%", height: `${Math.max(0, y)}px`, display: "block" });
    Object.assign(bottom.style, {
      left: "0",
      top: `${by}px`,
      width: "100%",
      height: `${Math.max(0, vh - by)}px`,
      display: "block",
    });
    Object.assign(left.style, {
      left: "0",
      top: `${y}px`,
      width: `${Math.max(0, x)}px`,
      height: `${Math.max(0, h)}px`,
      display: "block",
    });
    Object.assign(right.style, {
      left: `${bx}px`,
      top: `${y}px`,
      width: `${Math.max(0, vw - bx)}px`,
      height: `${Math.max(0, h)}px`,
      display: "block",
    });

    Object.assign(holeCover.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${w}px`,
      height: `${h}px`,
      display: w > 0 && h > 0 ? "block" : "none",
    });

    Object.assign(frame.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${w}px`,
      height: `${h}px`,
      display: w > 0 && h > 0 ? "block" : "none",
    });

    label.textContent = `${Math.round(w)} × ${Math.round(h)}`;
    const labelH = 28;
    if (y >= labelH + 8) {
      label.style.left = `${x + 6}px`;
      label.style.top = `${y - labelH - 4}px`;
    } else {
      label.style.left = `${x + 6}px`;
      label.style.top = `${by + 6}px`;
    }
    label.style.display = w > 0 && h > 0 ? "block" : "none";
  }

  function hideCropUi() {
    [top, bottom, left, right].forEach((el) => {
      el.style.display = "none";
    });
    holeCover.style.display = "none";
    frame.style.display = "none";
    label.style.display = "none";
  }

  function showBackdropOnly() {
    hideCropUi();
    backdrop.style.display = "block";
    toolbar.classList.remove("ssc-visible");
    hint.style.display = "block";
    confirmMode = false;
    dragging = false;
  }

  function teardown() {
    window.__SSC_REGION_ACTIVE = false;
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("mouseup", onUp, true);
    style.remove();
    root.remove();
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      sendToBg({ type: "SSC_REGION_CANCEL" });
      teardownSoon();
      return;
    }
    if (confirmMode && e.key === "Enter") {
      e.preventDefault();
      doCopy();
    }
  }

  function rectFromPointer(clientX, clientY) {
    const x = Math.min(startX, clientX);
    const y = Math.min(startY, clientY);
    const w = Math.abs(clientX - startX);
    const h = Math.abs(clientY - startY);
    return { x, y, width: w, height: h };
  }

  function onMove(e) {
    if (!dragging) return;
    const r = rectFromPointer(e.clientX, e.clientY);
    rx = r.x;
    ry = r.y;
    rw = r.width;
    rh = r.height;
    backdrop.style.display = "none";
    hint.style.display = "none";
    layoutShades(rx, ry, rw, rh);
  }

  function onUp(e) {
    if (!dragging || e.button !== 0) return;
    dragging = false;
    const r = rectFromPointer(e.clientX, e.clientY);
    rx = r.x;
    ry = r.y;
    rw = r.width;
    rh = r.height;

    if (rw < 4 || rh < 4) {
      showBackdropOnly();
      return;
    }

    backdrop.style.display = "none";
    hint.style.display = "none";
    layoutShades(rx, ry, rw, rh);
    confirmMode = true;
    toolbar.classList.add("ssc-visible");
  }

  function doCopy() {
    const rect = { x: rx, y: ry, width: rw, height: rh };
    sendToBg({ type: "SSC_REGION_DONE", rect });
    teardownSoon();
  }

  function doCancel() {
    sendToBg({ type: "SSC_REGION_CANCEL" });
    teardownSoon();
  }

  backdrop.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || confirmMode) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    rx = startX;
    ry = startY;
    rw = 0;
    rh = 0;
  });

  toolbar.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-ssc]");
    if (!btn) return;
    const a = btn.getAttribute("data-ssc");
    if (a === "copy") doCopy();
    else if (a === "cancel") doCancel();
    else if (a === "adjust") showBackdropOnly();
  });

  root.appendChild(style);
  root.appendChild(backdrop);
  [top, bottom, left, right].forEach((el) => root.appendChild(el));
  root.appendChild(holeCover);
  root.appendChild(frame);
  root.appendChild(label);
  root.appendChild(hint);
  root.appendChild(toolbar);

  document.documentElement.appendChild(root);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("mouseup", onUp, true);
})();
