#!/usr/bin/env node

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fsp = require("node:fs/promises");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright-core");

const projectRoot = path.join(__dirname, "..");
const serverScript = path.join(projectRoot, "scripts", "lamb-server.js");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function main() {
  assert.ok(fs.existsSync(chromePath), `Chrome executable not found: ${chromePath}`);

  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "electric-lamb-ui-smoke-"));
  const store = path.join(tempRoot, "store");
  const server = spawn(process.execPath, [serverScript], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ELECTRIC_SHEEP_HOME: store,
      ELECTRIC_LAMB_OPEN: "0",
      ELECTRIC_LAMB_PORT: "0",
      ELECTRIC_LAMB_CAPTURE_PORT: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk.toString(); });
  server.stderr.on("data", (chunk) => { output += chunk.toString(); });

  let browser;
  try {
    const appUrl = await waitForUrl(() => output, /Electric Lamb backend: (http:\/\/127\.0\.0\.1:\d+\/)/);
    browser = await chromium.launch({
      executablePath: chromePath,
      headless: true
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
    assert.equal(await page.title(), "Electric Lamb");
    assert.equal(await page.evaluate(() => document.documentElement.dataset.lambBridge), "ready");
    assert.equal(await page.evaluate(() => typeof window.electricSheep), "object");

    const saveToken = `ui-save-smoke-${Date.now()}`;
    await showPanel(page, "0");
    await page.locator("#captureText").fill(saveToken);
    await clickBySelector(page, "#saveBookmark");
    await page.waitForFunction((token) => document.querySelector("#captureStatus")?.textContent.includes("Saved"), saveToken);

    await page.evaluate(() => window.electricSheepUI.loadBookmarks());
    await expectText(page, "#bookmarkList", saveToken);

    await showPanel(page, "3");
    await page.locator("#searchInput").fill(saveToken);
    await expectText(page, "#searchResults", saveToken);

    await showPanel(page, "4");
    await page.evaluate(() => window.electricSheepUI.loadReader());
    await expectText(page, "#readerBody", saveToken);

    const trackToken = `ui-track-smoke-${Date.now()}`;
    await showPanel(page, "2");
    await page.locator("#trackCommand").fill(`echo ${trackToken}`);
    await page.locator("#trackCwd").fill(projectRoot);
    await clickBySelector(page, "#startTrack");
    await expectText(page, "#sessionList", trackToken, 15000);
    await expectText(page, "#sessionList", "completed", 15000);

    assert.deepEqual(errors, [], `browser errors:\n${errors.join("\n")}`);
    console.log("Electric Lamb UI smoke passed.");
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
    await waitFor(() => server.exitCode !== null || server.killed, 3000).catch(() => {});
  }
}

async function showPanel(page, index) {
  await page.evaluate((idx) => {
    for (const panel of document.querySelectorAll(".menu-panel")) {
      panel.style.display = "none";
      panel.classList.remove("visible");
    }
    const panel = document.querySelector(`.menu-panel[data-idx="${idx}"]`)
      || document.querySelector(`.radial-btn[data-idx="${idx}"] .menu-panel`);
    if (!panel) throw new Error(`Panel ${idx} not found`);
    panel.dataset.idx = idx;
    panel.style.display = "flex";
    panel.style.opacity = "1";
    panel.style.transform = "none";
    panel.classList.add("visible");
  }, index);
}

async function clickBySelector(page, selector) {
  await page.evaluate((selector) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`${selector} not found`);
    element.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window
    }));
  }, selector);
}

async function expectText(page, selector, text, timeoutMs = 8000) {
  await page.waitForFunction(
    ({ selector, text }) => document.querySelector(selector)?.textContent.includes(text),
    { selector, text },
    { timeout: timeoutMs }
  );
}

async function waitForUrl(read, pattern) {
  const matched = await waitFor(() => {
    const match = read().match(pattern);
    return match ? match[1] : "";
  }, 12000);
  if (!matched) throw new Error(`Timed out waiting for ${pattern}`);
  return matched;
}

async function waitFor(read, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
