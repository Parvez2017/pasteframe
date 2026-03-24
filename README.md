# PasteFrame

**PasteFrame** is a Chrome extension (Manifest V3) that copies screenshots to your **clipboard** as PNG—paste into chat apps, docs, or image editors with **⌘V / Ctrl+V**. Nothing is saved to disk unless you choose to elsewhere.

Licensed under the [MIT License](LICENSE).

## Features

- **Copy visible** — current viewport
- **Copy full page** — stitched vertical capture (scrolls the tab)
- **Copy selection** — drag a region, then confirm with the bottom bar (**Copy to clipboard**, **Adjust**, **Cancel**). **Esc** cancels; **Enter** copies when the bar is visible

## Install from source

1. Clone this repository:

   ```bash
   git clone https://github.com/Parvez2017/pasteframe.git
   cd pasteframe
   ```

2. Open Chrome and go to `chrome://extensions`.

3. Enable **Developer mode**.

4. Click **Load unpacked** and choose the `pasteframe` folder (the one that contains `manifest.json`).

5. Pin **PasteFrame** from the extensions menu if you like.

Optional Playwright smoke test (dev only; requires [Google Chrome](https://www.google.com/chrome/) and `npm install`):

```bash
npm install
npm run test:browser
```

## Permissions

| Permission        | Why |
|-------------------|-----|
| `activeTab`       | Capture only the tab you’re using when you click the extension |
| `scripting`       | Inject the region-picker UI and run capture helpers in the page |
| `clipboardWrite`  | Put the PNG on the system clipboard |
| `offscreen`       | Fallback clipboard path for region capture when needed |
| `windows`         | Focus the correct window so clipboard writes succeed reliably |

PasteFrame does not send your screenshots to any server; processing stays in the browser.

## Project layout

| Path | Role |
|------|------|
| `manifest.json` | MV3 manifest |
| `popup.html` / `popup.js` | Toolbar popup: visible & full-page capture |
| `background.js` | Service worker: region pipeline, clipboard orchestration |
| `offscreen.html` / `offscreen.js` | Offscreen document for clipboard fallback |
| `content/region-picker.js` | In-page crop UI |
| `util.js` | Shared helpers for the service worker |

## Chrome Web Store

A store listing can be added later. This repo stays the **source of truth**; you can always load the latest via **Load unpacked** or pack a ZIP yourself for submission.

## Contributing

Issues and pull requests are welcome. For larger changes, opening an issue first helps align on direction.

## License

MIT — see [LICENSE](LICENSE).
