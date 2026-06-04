/**
 * Playwright REPL driver for Electric Sheep (macOS Electron).
 * Usage: node scripts/driver.mjs
 * Commands: launch, ss [name], click <sel>, type <text>, eval <js>, text [sel], wait <sel>, quit, help
 */
import { _electron as electron } from 'playwright-core';
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR  = path.resolve(fileURLToPath(import.meta.url), '../..');
const SHOT_DIR = process.env.SCREENSHOT_DIR || '/tmp/shots';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const ELECTRON_BIN = path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');

let app  = null;
let page = null;

const CMDS = {
  async launch() {
    if (app) return console.log('already launched');
    app = await electron.launch({
      executablePath: ELECTRON_BIN,
      args: [APP_DIR],
      timeout: 30_000,
      env: { ...process.env },
    });
    await new Promise(r => setTimeout(r, 4_000));
    page = app.windows().find(w => !w.url().startsWith('devtools://'))
        ?? await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    console.log('launched. windows:');
    for (const w of app.windows()) console.log(' ', w.url());
  },

  async ss(name) {
    if (!page) return console.log('ERROR: launch first');
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png');
    await page.screenshot({ path: f, fullPage: false });
    console.log('screenshot:', f);
  },

  async click(sel) {
    if (!page) return console.log('ERROR: launch first');
    const r = await page.evaluate(s => {
      const el = document.querySelector(s);
      if (!el) return 'NOT_FOUND';
      el.click(); return 'OK';
    }, sel);
    await new Promise(r => setTimeout(r, 400));
    console.log('click', sel, '→', r);
  },

  async fill(args) {
    const [sel, ...rest] = args.split(' ');
    const text = rest.join(' ');
    if (!page) return console.log('ERROR: launch first');
    const r = await page.evaluate(([s, t]) => {
      const el = document.querySelector(s);
      if (!el) return 'NOT_FOUND';
      el.focus();
      el.value = t;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return 'OK';
    }, [sel, text]);
    console.log('fill', sel, '→', r);
  },

  async type(text) { if (page) { await page.keyboard.type(text, { delay: 30 }); } },
  async press(key)  { if (page) { await page.keyboard.press(key); } },

  async wait(sel) {
    if (!page) return console.log('ERROR: launch first');
    try { await page.waitForSelector(sel, { timeout: 8_000 }); console.log('found:', sel); }
    catch { console.log('TIMEOUT:', sel); }
  },

  async eval(expr) {
    if (!page) return console.log('ERROR: launch first');
    try { console.log(JSON.stringify(await page.evaluate(expr))); }
    catch (e) { console.log('ERROR:', e.message); }
  },

  async text(sel) {
    if (!page) return console.log('ERROR: launch first');
    console.log(await page.evaluate(
      s => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)',
      sel || null));
  },

  async windows() {
    if (!app) return console.log('ERROR: launch first');
    for (const w of app.windows()) console.log(' ', w.url());
  },

  async quit() { if (app) await app.close().catch(() => {}); app = null; page = null; },
  help() { console.log('commands:', Object.keys(CMDS).join(', ')); },
};

const stdin = fs.createReadStream(null, { fd: fs.openSync('/dev/stdin', 'r') });
const rl = readline.createInterface({ input: stdin, output: process.stdout, prompt: 'driver> ' });

rl.on('line', async line => {
  const trimmed = line.trim();
  const spaceIdx = trimmed.indexOf(' ');
  const cmd  = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const args = spaceIdx === -1 ? ''       : trimmed.slice(spaceIdx + 1);
  if (!cmd) { rl.prompt(); return; }
  const fn = CMDS[cmd];
  if (!fn) { console.log('unknown:', cmd, '— try: help'); rl.prompt(); return; }
  try { await fn(args); } catch (e) { console.log('ERROR:', e.message); }
  if (cmd === 'quit') { rl.close(); process.exit(0); }
  rl.prompt();
});
rl.on('close', async () => { await CMDS.quit(); process.exit(0); });

console.log('Electric Sheep driver — "launch" to start, "help" for commands');
rl.prompt();
