import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = path.join(root, "test-results");
fs.mkdirSync(results, { recursive: true });

const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filename = path.resolve(root, relative);
  if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename)) {
    response.writeHead(404).end("Not found");
    return;
  }
  const type = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png" }[path.extname(filename)] || "application/octet-stream";
  response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
  fs.createReadStream(filename).pipe(response);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

const executablePath = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((candidate) => fs.existsSync(candidate));
if (!executablePath) throw new Error("Chrome or Chromium is required");

const browser = await chromium.launch({ executablePath, headless: true });
const base = `http://127.0.0.1:${server.address().port}`;
const errors = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const monitor = (page) => {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (entry) => { if (entry.type() === "error") errors.push(entry.text()); });
};

async function measureJump(page, holdMs) {
  await page.keyboard.down("Space");
  await page.waitForFunction(() => window.__tazyGame.snapshot.state === "jump");
  await page.waitForTimeout(holdMs);
  await page.keyboard.up("Space");
  await page.waitForFunction(() => window.__tazyGame.snapshot.state !== "jump");
  return page.evaluate(() => window.__tazyGame.snapshot.lastJumpPeak);
}

try {
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  monitor(desktop);
  await desktop.goto(`${base}/index.html`, { waitUntil: "networkidle" });
  await desktop.waitForFunction(() => window.__tazyGame);
  await desktop.locator("#start-btn").click();
  const lowPeak = await measureJump(desktop, 55);
  const highPeak = await measureJump(desktop, 360);
  assert(lowPeak > 0.65, `A quick jump must clear the fence: ${lowPeak}`);
  assert(highPeak > 1.5, `A held jump must reach the high arc: ${highPeak}`);

  const patterns = await desktop.evaluate(() => window.__tazyGame.samplePatterns(24, 1));
  assert(patterns.length === 24, "Pattern director must produce the requested sample");
  assert(patterns.every((pattern) => {
    const route = [pattern.fromLane, ...pattern.route];
    return route.every((lane, index) => index === 0 || Math.abs(lane - route[index - 1]) <= 1);
  }), "Safe route must never require skipping two lanes at once");
  assert(patterns.every((pattern, index) => index === 0 || pattern.id !== patterns[index - 1].id), "Pattern director must not repeat the same wave");
  assert(patterns.every((pattern, index) => index === 0 || !(pattern.action && patterns[index - 1].action)), "Full-width action rows need a recovery wave");
  assert(new Set(patterns.map(({ id }) => id)).size >= 4, "Pattern sample must contain useful variety");
  await desktop.waitForFunction(() => document.getElementById("countdown").classList.contains("hidden"));
  await desktop.waitForTimeout(1000);
  await desktop.screenshot({ path: path.join(results, "desktop-gameplay.png") });
  await desktop.close();

  const model = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  monitor(model);
  await model.goto(`${base}/index.html?debug=dog`, { waitUntil: "networkidle" });
  await model.waitForFunction(() => window.__tazyGame);
  await model.evaluate(() => document.getElementById("start-overlay").classList.add("hidden"));
  await model.waitForTimeout(600);
  await model.screenshot({ path: path.join(results, "tazy-model.png") });
  await model.close();

  const portraitContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const portrait = await portraitContext.newPage();
  monitor(portrait);
  await portrait.goto(`${base}/index.html`, { waitUntil: "networkidle" });
  await portrait.locator("#start-btn").click();
  await portrait.locator("#game-canvas").tap({ position: { x: 195, y: 500 } });
  await portrait.waitForFunction(() => window.__tazyGame.snapshot.state === "jump", null, { timeout: 1500 });
  await portrait.waitForFunction(() => window.__tazyGame.snapshot.state === "run");
  const swipe = (fromX, fromY, toX, toY) => portrait.evaluate(({ fromX, fromY, toX, toY }) => {
    const canvas = document.getElementById("game-canvas");
    canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", clientX: fromX, clientY: fromY }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", clientX: toX, clientY: toY }));
  }, { fromX, fromY, toX, toY });
  await swipe(250, 500, 100, 500);
  assert((await portrait.evaluate(() => window.__tazyGame.snapshot.lane)) === 0, "A left swipe must change to the adjacent lane");
  await swipe(195, 450, 195, 600);
  assert((await portrait.evaluate(() => window.__tazyGame.snapshot.state)) === "slide", "A down swipe must trigger a slide");
  const portraitHud = await portrait.locator("#hud").boundingBox();
  assert(portraitHud && portraitHud.width <= 390, "Portrait HUD must fit the phone viewport");
  await portrait.screenshot({ path: path.join(results, "phone-portrait.png") });
  await portraitContext.close();

  const landscapeContext = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const landscape = await landscapeContext.newPage();
  monitor(landscape);
  await landscape.goto(`${base}/index.html`, { waitUntil: "networkidle" });
  const startPanel = await landscape.locator("#start-overlay .panel").boundingBox();
  assert(startPanel && startPanel.height <= 390, "Start panel must fit a landscape phone");
  await landscape.locator("#start-btn").click();
  await landscape.screenshot({ path: path.join(results, "phone-landscape.png") });
  await landscapeContext.close();

  assert(errors.length === 0, `Browser errors: ${errors.join(" | ")}`);
  console.log(`Browser smoke OK: jump peaks ${lowPeak.toFixed(2)}/${highPeak.toFixed(2)}, fair pattern director, dog model, touch gestures and phone layouts.`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
