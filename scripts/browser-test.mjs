/**
 * Launches Chrome with the unpacked extension and smoke-tests popup + region flow.
 * Requires: npm install && npx playwright install chrome
 */
import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extPath = path.resolve(__dirname, "..");
const userDataDir = path.join(
  process.env.TMPDIR || "/tmp",
  "ss-copy-playwright-profile"
);

const chromeMac =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const executablePath =
  process.env.CHROME_PATH ||
  (process.platform === "darwin" ? chromeMac : undefined);

const launchOpts = {
  headless: false,
  ignoreDefaultArgs: ["--disable-extensions"],
  args: [
    // Chrome 137–141: allow CLI-loaded extensions; 142+ may block — use Chrome for Testing or load unpacked manually.
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`,
  ],
};
if (executablePath) {
  launchOpts.executablePath = executablePath;
} else {
  launchOpts.channel = "chrome";
}

const context = await chromium.launchPersistentContext(userDataDir, launchOpts);

async function getExtensionId() {
  const existing = context
    .serviceWorkers()
    .find((w) => w.url().startsWith("chrome-extension://"));
  if (existing) return new URL(existing.url()).host;

  const swPromise = context.waitForEvent("serviceworker", { timeout: 25000 });
  const p = await context.newPage();
  await p.goto("https://example.com/", { waitUntil: "domcontentloaded" });
  const sw = await swPromise;
  const id = new URL(sw.url()).host;
  if (!id) throw new Error("Could not parse extension id from " + sw.url());
  return id;
}

const extensionId = await getExtensionId();
console.log("Extension ID:", extensionId);

async function openPopup() {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: "domcontentloaded",
  });
  return popup;
}

// --- Visible copy ---
const page = context.pages().find((p) => p.url().includes("example.com")) || (await context.newPage());
if (!page.url().includes("example.com")) {
  await page.goto("https://example.com/", { waitUntil: "domcontentloaded" });
}
await page.bringToFront();

let popup = await openPopup();
await popup.locator("#btn-visible").click();
await new Promise((r) => setTimeout(r, 600));
let status = (await popup.locator("#status").textContent())?.trim() || "";
console.log("Copy visible → status:", JSON.stringify(status));
if (!status.toLowerCase().includes("copied")) {
  console.error("FAIL: expected success status for visible copy");
  process.exitCode = 1;
}

// --- Region copy ---
await page.bringToFront();
popup = await openPopup();
await popup.locator("#btn-region").click();
await new Promise((r) => setTimeout(r, 300));

await page.bringToFront();
await new Promise((r) => setTimeout(r, 200));
const vp = page.viewportSize();
const w = vp?.width ?? 800;
const h = vp?.height ?? 600;
await page.mouse.move(Math.round(w * 0.1), Math.round(h * 0.15));
await page.mouse.down();
await page.mouse.move(Math.round(w * 0.45), Math.round(h * 0.55));
await page.mouse.up();
await new Promise((r) => setTimeout(r, 3500));
console.log("Region drag completed — check extension badge or paste in an app.");

await context.close();
console.log("Done.");
