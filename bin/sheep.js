#!/usr/bin/env node

const { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const pty = require("node-pty");
const { exportArchive, importArchive } = require("../src/export");
const { addSession, deleteBookmark, deleteSession, ensureStore, getStorePaths, readBookmarks, readSessions, updateBookmarks } = require("../src/store");
const { readImageText } = require("../src/ocr");
const { searchArchive } = require("../src/search");
const { buildWrapUp, stripAnsi } = require("../src/wrapup");

const args = process.argv.slice(2);

async function main() {
  const command = args[0];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "track") {
    await track(args.slice(1));
    return;
  }

  if (command === "sessions") {
    await listSessions();
    return;
  }

  if (command === "bookmarks") {
    await listBookmarks();
    return;
  }

  if (command === "ocr-backfill") {
    await backfillOcr();
    return;
  }

  if (command === "export") {
    await exportData(args[1]);
    return;
  }

  if (command === "import") {
    await importData(args[1]);
    return;
  }

  if (command === "search") {
    await searchData(args.slice(1).join(" "));
    return;
  }

  if (command === "doctor") {
    await doctor();
    return;
  }

  if (command === "delete") {
    await deleteItem(args[1], args[2]);
    return;
  }

  if (command === "watch") {
    await watchDesktop(args.slice(1));
    return;
  }

  if (command === "ax") {
    await axRead(args.slice(1));
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exitCode = 1;
}

async function track(commandArgs) {
  await ensureStore();

  const shell = process.env.SHELL || "/bin/zsh";
  const runArgs = commandArgs.length > 0 ? commandArgs : [shell];
  const displayCommand = runArgs.join(" ");
  const sessionId = randomUUID();
  const startedAt = new Date().toISOString();
  const stamp = startedAt.replace(/[:.]/g, "-");
  const sessionDir = path.join(getStorePaths().sessionsDir, `${stamp}-${sessionId.slice(0, 8)}-${safeName(runArgs[0])}`);
  const transcriptPath = path.join(sessionDir, "transcript.txt");
  const wrapUpPath = path.join(sessionDir, "wrap-up.md");
  const metadataPath = path.join(sessionDir, "session.json");

  await fsp.mkdir(sessionDir, { recursive: true });

  const transcriptStream = fs.createWriteStream(transcriptPath, { flags: "a" });
  const transcriptChunks = [];

  writeTranscriptLine(transcriptStream, `$ sheep track ${displayCommand}`);
  console.error(`Tracking session: ${displayCommand}`);
  console.error(`Saving to: ${sessionDir}`);

  const terminal = pty.spawn(runArgs[0], runArgs.slice(1), {
    name: process.env.TERM || "xterm-256color",
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 30,
    cwd: process.cwd(),
    env: process.env
  });

  const stdinWasRaw = process.stdin.isRaw;
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
  }

  const onInput = (chunk) => {
    terminal.write(chunk.toString());
  };
  const onResize = () => {
    terminal.resize(process.stdout.columns || 80, process.stdout.rows || 30);
  };

  process.stdin.on("data", onInput);
  process.stdout.on("resize", onResize);

  terminal.onData((data) => {
    process.stdout.write(data);
    transcriptStream.write(data);
    transcriptChunks.push(Buffer.from(data));
  });

  terminal.onExit(async ({ exitCode }) => {
    process.stdin.off("data", onInput);
    process.stdout.off("resize", onResize);

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(Boolean(stdinWasRaw));
      process.stdin.pause();
    }

    await finishSession({
      command: displayCommand,
      endedAt: new Date().toISOString(),
      exitCode,
      metadataPath,
      sessionDir,
      sessionId,
      startedAt,
      transcriptChunks,
      transcriptPath,
      transcriptStream,
      wrapUpPath
    });
  });
}

async function finishSession({
  command,
  endedAt,
  exitCode,
  metadataPath,
  sessionDir,
  sessionId,
  startedAt,
  transcriptChunks,
  transcriptPath,
  transcriptStream,
  wrapUpPath
}) {
  const transcript = stripAnsi(Buffer.concat(transcriptChunks).toString("utf8"));
  const lineCount = transcript.split(/\r?\n/).filter(Boolean).length;
  const durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  const wrapUp = buildWrapUp({
    command,
    startedAt,
    endedAt,
    exitCode,
    transcript
  });
  const session = {
    id: sessionId,
    source: "terminal",
    command,
    startedAt,
    endedAt,
    durationMs,
    lineCount,
    status: exitCode === 0 ? "completed" : "failed",
    exitCode,
    transcriptPath,
    wrapUpPath,
    metadataPath
  };

  await fsp.writeFile(wrapUpPath, wrapUp, "utf8");
  await fsp.writeFile(metadataPath, JSON.stringify(session, null, 2), "utf8");
  await addSession(session);

  transcriptStream.end(() => {
    console.error(`\nSession saved: ${sessionDir}`);
    console.error(`Wrap-up: ${wrapUpPath}`);
    process.exitCode = exitCode ?? 0;
  });
}

async function listSessions() {
  const sessions = await readSessions();

  if (sessions.length === 0) {
    console.log("No tracked sessions yet.");
    return;
  }

  for (const session of sessions.slice(0, 20)) {
    console.log(`${session.id}  ${session.startedAt}  ${session.command}`);
    console.log(`  ${session.wrapUpPath}`);
  }
}

async function listBookmarks() {
  const bookmarks = await readBookmarks();

  if (bookmarks.length === 0) {
    console.log("No bookmarks yet.");
    return;
  }

  for (const bookmark of bookmarks.slice(0, 20)) {
    console.log(`${bookmark.id}  ${bookmark.createdAt || "unknown"}  ${bookmark.title || firstLine(bookmark.text) || "Bookmark"}`);
  }
}

async function backfillOcr() {
  await ensureStore();
  let checked = 0;
  let updated = 0;
  let failed = 0;

  await updateBookmarks(async (bookmarks) => {
    for (const bookmark of bookmarks) {
      const attachments = normalizeBookmarkAttachments(bookmark);
      bookmark.attachments = attachments;

      for (const attachment of attachments) {
        if (attachment.type !== "image") continue;
        if (attachment.ocrStatus === "processed" || attachment.ocrStatus === "empty") continue;

        checked += 1;
        const ocr = await readImageText(attachment.path);
        attachment.extractedText = ocr.text;
        attachment.ocrStatus = ocr.status;
        if (ocr.status === "failed") {
          failed += 1;
        } else {
          updated += 1;
        }
        console.log(`${ocr.status}: ${attachment.originalName || attachment.path}`);
      }
    }

    return bookmarks;
  });

  console.log(`OCR backfill complete. Checked ${checked}, updated ${updated}, failed ${failed}.`);
}

async function exportData(targetDir) {
  await ensureStore();
  const result = await exportArchive(targetDir);
  console.log(`Exported ${result.bookmarkCount} bookmarks and ${result.sessionCount} sessions.`);
  console.log(result.exportDir);
}

async function importData(jsonPath) {
  if (!jsonPath) {
    throw new Error("Usage: sheep import <electric-sheep-data.json>");
  }

  await ensureStore();
  const result = await importArchive(jsonPath);
  console.log(`Imported ${result.addedBookmarks} bookmarks and ${result.addedSessions} sessions.`);
  console.log(`Skipped ${result.skippedBookmarks} duplicate bookmarks and ${result.skippedSessions} duplicate sessions.`);
}

async function searchData(query) {
  if (!query.trim()) {
    throw new Error("Usage: sheep search <query>");
  }

  await ensureStore();
  const results = await searchArchive(query);

  if (results.length === 0) {
    console.log("No matches.");
    return;
  }

  for (const result of results) {
    console.log(`[${result.type}] ${result.title}`);
    console.log(`  ${result.createdAt || "unknown"} · ${result.source}`);
    if (result.path) {
      console.log(`  ${result.path}`);
    }
    console.log(`  ${result.snippet}`);
    console.log("");
  }
}

async function doctor() {
  await ensureStore();
  const checks = [];

  checks.push({
    name: "Store",
    ok: true,
    detail: getStorePaths().baseDir
  });

  checks.push(await checkModule("Electron", "electron"));
  checks.push(await checkModule("node-pty", "node-pty"));
  checks.push(await checkPtySpawn());
  checks.push(await checkSwiftOcr());

  for (const check of checks) {
    console.log(`${check.ok ? "ok" : "fail"}  ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
  }

  if (checks.some((check) => !check.ok)) {
    process.exitCode = 1;
  }
}

async function deleteItem(type, id) {
  if (!type || !id || !["bookmark", "session"].includes(type)) {
    throw new Error("Usage: sheep delete bookmark <id> | sheep delete session <id>");
  }

  await ensureStore();
  const deleted = type === "bookmark"
    ? await deleteBookmark(id)
    : await deleteSession(id);

  if (!deleted) {
    console.log(`No ${type} found for id: ${id}`);
    return;
  }

  console.log(`Deleted ${type}: ${id}`);
}

async function checkModule(name, moduleName) {
  try {
    require.resolve(moduleName);
    return { name, ok: true };
  } catch (error) {
    return { name, ok: false, detail: error.message };
  }
}

async function checkPtySpawn() {
  return new Promise((resolve) => {
    try {
      const terminal = pty.spawn("/bin/echo", ["pty-doctor"], {
        name: process.env.TERM || "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
        env: process.env
      });
      let output = "";
      terminal.onData((data) => {
        output += data;
      });
      terminal.onExit(({ exitCode }) => {
        resolve({
          name: "PTY spawn",
          ok: exitCode === 0 && output.includes("pty-doctor"),
          detail: exitCode === 0 ? "" : `exit ${exitCode}`
        });
      });
    } catch (error) {
      resolve({ name: "PTY spawn", ok: false, detail: error.message });
    }
  });
}

async function checkSwiftOcr() {
  if (process.platform !== "darwin") {
    return { name: "Swift OCR", ok: false, detail: "macOS only" };
  }

  const result = require("node:child_process").spawnSync("swift", ["--version"], {
    encoding: "utf8"
  });

  return {
    name: "Swift OCR",
    ok: result.status === 0,
    detail: result.status === 0 ? result.stdout.split("\n")[0] : result.stderr.trim()
  };
}

function normalizeBookmarkAttachments(bookmark) {
  const attachments = Array.isArray(bookmark.attachments) ? [...bookmark.attachments] : [];

  if (bookmark.screenshotPath && !attachments.some((attachment) => attachment.path === bookmark.screenshotPath)) {
    attachments.push({
      id: `${bookmark.id}-legacy-screenshot`,
      type: "image",
      path: bookmark.screenshotPath,
      originalName: "Screenshot",
      extractedText: "",
      ocrStatus: "failed",
      createdAt: bookmark.createdAt
    });
  }

  return attachments;
}

function writeTranscriptLine(stream, line) {
  stream.write(`${line}\n\n`);
}

function safeName(value) {
  return path.basename(value).replace(/[^a-z0-9_.-]+/gi, "-").slice(0, 40) || "session";
}

function firstLine(value) {
  return String(value || "").split(/\r?\n/).find(Boolean)?.slice(0, 80) || "";
}

// ── Desktop watch (screenshot + OCR) ─────────────────────────────────────

async function watchDesktop(commandArgs) {
  const appName = commandArgs[0];
  const intervalIdx = commandArgs.indexOf("--interval");
  const intervalSec = intervalIdx >= 0 ? (parseInt(commandArgs[intervalIdx + 1]) || 10) : 10;

  if (!appName) {
    throw new Error("Usage: sheep watch <app-name> [--interval <seconds>]");
  }

  if (process.platform !== "darwin") {
    throw new Error("sheep watch requires macOS");
  }

  await ensureStore();

  const sessionId  = randomUUID();
  const startedAt  = new Date().toISOString();
  const stamp      = startedAt.replace(/[:.]/g, "-");
  const sessionDir = path.join(getStorePaths().sessionsDir, `${stamp}-${sessionId.slice(0, 8)}-watch-${safeName(appName)}`);
  const transcriptPath = path.join(sessionDir, "transcript.txt");
  const wrapUpPath     = path.join(sessionDir, "wrap-up.md");
  const metadataPath   = path.join(sessionDir, "session.json");
  const captureScript  = path.join(__dirname, "..", "scripts", "capture-window.swift");
  const ocrScript      = path.join(__dirname, "..", "scripts", "ocr.swift");

  await fsp.mkdir(sessionDir, { recursive: true });
  console.error(`Watching: ${appName}  (every ${intervalSec}s, Ctrl+C to stop)`);
  console.error(`Session: ${sessionDir}\n`);

  const chunks  = [];
  let prevText  = "";
  let lineCount = 0;

  async function tick() {
    const tmpImg = path.join(os.tmpdir(), `sheep-watch-${Date.now()}.png`);
    const capture = spawnSync("swift", [captureScript, appName, tmpImg], { encoding: "utf8" });
    if (capture.status !== 0) {
      process.stderr.write(`[watch] ${(capture.stderr || "capture failed").trim()}\n`);
      return;
    }

    const ocr = spawnSync("swift", [ocrScript, tmpImg], { encoding: "utf8" });
    await fsp.unlink(tmpImg).catch(() => {});
    if (ocr.status !== 0 || !ocr.stdout.trim()) return;

    const currentText = ocr.stdout.trim();
    if (currentText === prevText) return;

    const prevLines   = new Set(prevText.split("\n").filter(Boolean));
    const newLines    = currentText.split("\n").filter(l => l.trim() && !prevLines.has(l));
    if (newLines.length === 0) { prevText = currentText; return; }

    const chunk = newLines.join("\n") + "\n";
    chunks.push(chunk);
    await fsp.appendFile(transcriptPath, chunk, "utf8");
    lineCount += newLines.length;
    prevText   = currentText;
    process.stdout.write(`[${new Date().toLocaleTimeString()}] +${newLines.length} new line(s)\n`);
  }

  await tick();
  const interval = setInterval(tick, intervalSec * 1000);

  let stopping = false;
  process.on("SIGINT", async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(interval);

    const endedAt    = new Date().toISOString();
    const durationMs = new Date(endedAt) - new Date(startedAt);
    const transcript = chunks.join("");
    const wrapUp     = buildWrapUp({ command: `watch ${appName}`, startedAt, endedAt, exitCode: 0, transcript });
    const session    = {
      id: sessionId, source: "desktop-watch", command: `watch ${appName}`,
      startedAt, endedAt, durationMs, lineCount,
      status: "completed", exitCode: 0,
      transcriptPath, wrapUpPath, metadataPath
    };

    await fsp.writeFile(wrapUpPath,   wrapUp,                        "utf8");
    await fsp.writeFile(metadataPath, JSON.stringify(session, null, 2), "utf8");
    await addSession(session);
    console.error(`\nSession saved: ${sessionDir}`);
    process.exit(0);
  });
}

// ── Accessibility API read ────────────────────────────────────────────────

async function axRead(commandArgs) {
  const appName     = commandArgs[0];
  const intervalIdx = commandArgs.indexOf("--interval");
  const intervalSec = intervalIdx >= 0 ? (parseInt(commandArgs[intervalIdx + 1]) || 5) : 5;
  const oneShot     = commandArgs.includes("--once");

  if (!appName) {
    throw new Error("Usage: sheep ax <app-name> [--once] [--interval <seconds>]");
  }

  if (process.platform !== "darwin") {
    throw new Error("sheep ax requires macOS");
  }

  const axScript = path.join(__dirname, "..", "scripts", "ax-read.swift");

  if (oneShot) {
    const result = spawnSync("swift", [axScript, appName], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr.trim() || "ax-read failed");
    console.log(result.stdout.trim());
    return;
  }

  await ensureStore();

  const sessionId  = randomUUID();
  const startedAt  = new Date().toISOString();
  const stamp      = startedAt.replace(/[:.]/g, "-");
  const sessionDir = path.join(getStorePaths().sessionsDir, `${stamp}-${sessionId.slice(0, 8)}-ax-${safeName(appName)}`);
  const transcriptPath = path.join(sessionDir, "transcript.txt");
  const wrapUpPath     = path.join(sessionDir, "wrap-up.md");
  const metadataPath   = path.join(sessionDir, "session.json");

  await fsp.mkdir(sessionDir, { recursive: true });
  console.error(`Accessibility watch: ${appName}  (every ${intervalSec}s, Ctrl+C to stop)`);
  console.error(`Session: ${sessionDir}\n`);

  let prevText  = "";
  const chunks  = [];
  let lineCount = 0;

  async function tick() {
    const result = spawnSync("swift", [axScript, appName], { encoding: "utf8" });
    if (result.status !== 0) {
      process.stderr.write(`[ax] ${(result.stderr || "ax-read failed").trim()}\n`);
      return;
    }

    const currentText = result.stdout.trim();
    if (!currentText || currentText === prevText) return;

    const prevLines = new Set(prevText.split("\n").filter(Boolean));
    const newLines  = currentText.split("\n").filter(l => l.trim() && !prevLines.has(l));
    if (newLines.length === 0) { prevText = currentText; return; }

    const chunk = newLines.join("\n") + "\n";
    chunks.push(chunk);
    await fsp.appendFile(transcriptPath, chunk, "utf8");
    lineCount += newLines.length;
    prevText   = currentText;
    process.stdout.write(`[${new Date().toLocaleTimeString()}] +${newLines.length} new line(s)\n`);
  }

  await tick();
  const interval = setInterval(tick, intervalSec * 1000);

  let stopping = false;
  process.on("SIGINT", async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(interval);

    const endedAt    = new Date().toISOString();
    const durationMs = new Date(endedAt) - new Date(startedAt);
    const transcript = chunks.join("");
    const wrapUp     = buildWrapUp({ command: `ax ${appName}`, startedAt, endedAt, exitCode: 0, transcript });
    const session    = {
      id: sessionId, source: "desktop-ax", command: `ax ${appName}`,
      startedAt, endedAt, durationMs, lineCount,
      status: "completed", exitCode: 0,
      transcriptPath, wrapUpPath, metadataPath
    };

    await fsp.writeFile(wrapUpPath,   wrapUp,                        "utf8");
    await fsp.writeFile(metadataPath, JSON.stringify(session, null, 2), "utf8");
    await addSession(session);
    console.error(`\nSession saved: ${sessionDir}`);
    process.exit(0);
  });
}

function printHelp() {
  console.log(`Electric Sheep

Usage:
  sheep track <command> [args...]          Track a terminal AI/work session
  sheep track                              Track an interactive shell
  sheep watch <app> [--interval <s>]       Watch a desktop app via screenshot+OCR
  sheep ax <app> [--interval <s>] [--once] Watch a desktop app via Accessibility API
  sheep bookmarks                          List recent bookmarks
  sheep sessions                           List recent tracked sessions
  sheep delete bookmark <id>               Delete a bookmark
  sheep delete session <id>                Delete a tracked session and its files
  sheep ocr-backfill                       OCR saved images that have not been processed
  sheep export [directory]                 Export Markdown and JSON archive
  sheep import <json>                      Import Electric Sheep JSON archive
  sheep search <query>                     Search bookmarks, OCR text, and sessions
  sheep doctor                             Check local runtime dependencies

Examples:
  sheep track codex
  sheep track claude
  sheep track zsh
  sheep watch Codex --interval 5
  sheep watch Cursor --interval 10
  sheep ax "Cursor" --interval 5
  sheep ax Safari --once
  sheep bookmarks
  sheep search docker
  sheep doctor
`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
