#!/usr/bin/env node

const { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const pty = require("node-pty");
const { exportArchive, importArchive } = require("../src/export");
const { auditArchiveHealth } = require("../src/health");
const { repairLegacySessions } = require("../src/repair");
const { addSession, deleteBookmark, deleteSession, ensureStore, getStorePaths, readBookmarks, readSessions, updateBookmarks } = require("../src/store");
const { readImageText } = require("../src/ocr");
const { redactSecrets } = require("../src/redact");
const { searchArchive } = require("../src/search");
const { buildWrapUp, stripAnsi } = require("../src/wrapup");

const args = process.argv.slice(2);
const MAX_GIT_CHANGED_FILES = 200;
const OUTPUT_COALESCE_MS = 350;

function writeJsonlEvent(stream, event) {
  stream.write(`${JSON.stringify(event)}\n`);
}

async function appendJsonlEvent(filePath, event) {
  await fsp.appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8");
}

function endWritable(stream) {
  return new Promise((resolve, reject) => {
    stream.once("error", reject);
    stream.end(resolve);
  });
}

function runGit(cwd, gitArgs) {
  const result = spawnSync("git", gitArgs, {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024
  });
  return result.status === 0 ? result.stdout.trimEnd() : "";
}

function parseGitStatus(statusOutput) {
  return statusOutput
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(Boolean)
    .map(line => {
      const match = line.match(/^(..)\s+(.*)$/);
      const status = (match ? match[1] : line.slice(0, 2)).trim();
      const rawPath = (match ? match[2] : line.slice(2)).trim();
      const filePath = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop() : rawPath;
      return { status, path: filePath };
    });
}

function getGitSnapshot(cwd) {
  const root = runGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (!root) return null;

  const changedFiles = parseGitStatus(runGit(root, ["status", "--porcelain=v1"]));
  return {
    root,
    branch: runGit(root, ["branch", "--show-current"]),
    commit: runGit(root, ["rev-parse", "--short", "HEAD"]),
    isDirty: changedFiles.length > 0,
    changedFileCount: changedFiles.length,
    changedFiles: changedFiles.slice(0, MAX_GIT_CHANGED_FILES),
    changedFilesTruncated: changedFiles.length > MAX_GIT_CHANGED_FILES
  };
}

function summarizeGitSession(before, after) {
  if (!before && !after) return null;

  const changed = new Map();
  for (const file of before?.changedFiles || []) changed.set(file.path, file);
  for (const file of after?.changedFiles || []) changed.set(file.path, file);

  return {
    root: after?.root || before?.root || "",
    branchBefore: before?.branch || "",
    branchAfter: after?.branch || "",
    commitBefore: before?.commit || "",
    commitAfter: after?.commit || "",
    dirtyBefore: Boolean(before?.isDirty),
    dirtyAfter: Boolean(after?.isDirty),
    changedFileCount: Math.max(before?.changedFileCount || 0, after?.changedFileCount || 0, changed.size),
    changedFiles: Array.from(changed.values()).slice(0, MAX_GIT_CHANGED_FILES),
    changedFilesTruncated: Boolean(before?.changedFilesTruncated || after?.changedFilesTruncated || changed.size > MAX_GIT_CHANGED_FILES)
  };
}

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

  if (command === "repair-legacy") {
    await repairLegacy();
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
  const redactedDisplayCommand = redactSecrets(displayCommand).text;
  const sessionId = randomUUID();
  const startedAt = new Date().toISOString();
  const cwd = process.cwd();
  const gitStart = getGitSnapshot(cwd);
  const stamp = startedAt.replace(/[:.]/g, "-");
  const sessionDir = path.join(getStorePaths().sessionsDir, `${stamp}-${sessionId.slice(0, 8)}-${safeName(runArgs[0])}`);
  const transcriptPath = path.join(sessionDir, "transcript.txt");
  const transcriptEventsPath = path.join(sessionDir, "transcript.jsonl");
  const wrapUpPath = path.join(sessionDir, "wrap-up.md");
  const metadataPath = path.join(sessionDir, "session.json");

  await fsp.mkdir(sessionDir, { recursive: true });

  const transcriptStream = fs.createWriteStream(transcriptPath, { flags: "a" });
  const transcriptEventsStream = fs.createWriteStream(transcriptEventsPath, { flags: "a" });
  const transcriptChunks = [];
  let transcriptEventSeq = 0;
  let pendingOutput = null;
  let pendingOutputTimer = null;

  const writeTranscriptEvent = (event) => {
    transcriptEventSeq += 1;
    writeJsonlEvent(transcriptEventsStream, {
      seq: transcriptEventSeq,
      timestamp: new Date().toISOString(),
      ...event
    });
  };
  const flushPendingOutput = () => {
    if (!pendingOutput) return;
    if (pendingOutputTimer) {
      clearTimeout(pendingOutputTimer);
      pendingOutputTimer = null;
    }
    writeTranscriptEvent({
      kind: "terminal_output",
      source: "terminal",
      role: "terminal",
      byteLength: pendingOutput.byteLength,
      chunkCount: pendingOutput.chunkCount,
      redactionCount: pendingOutput.redactionCount,
      text: pendingOutput.text
    });
    pendingOutput = null;
  };
  const queueOutputEvent = (data) => {
    const text = stripAnsi(data);
    if (!text) return;
    const redacted = redactSecrets(text);
    if (!pendingOutput) {
      pendingOutput = {
        byteLength: 0,
        chunkCount: 0,
        redactionCount: 0,
        text: ""
      };
    }
    pendingOutput.byteLength += Buffer.byteLength(data);
    pendingOutput.chunkCount += 1;
    pendingOutput.redactionCount += redacted.count;
    pendingOutput.text += redacted.text;
    if (pendingOutputTimer) clearTimeout(pendingOutputTimer);
    pendingOutputTimer = setTimeout(flushPendingOutput, OUTPUT_COALESCE_MS);
  };

  writeTranscriptLine(transcriptStream, `$ sheep track ${displayCommand}`);
  writeTranscriptEvent({
    kind: "session_start",
    source: "terminal",
    role: "system",
    command: redactedDisplayCommand,
    cwd,
    git: gitStart
  });
  console.error(`Tracking session: ${redactedDisplayCommand}`);
  console.error(`Saving to: ${sessionDir}`);

  const terminal = pty.spawn(runArgs[0], runArgs.slice(1), {
    name: process.env.TERM || "xterm-256color",
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 30,
    cwd,
    env: process.env
  });

  const stdinWasRaw = process.stdin.isRaw;
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
  }

  const onInput = (chunk) => {
    flushPendingOutput();
    writeTranscriptEvent({
      kind: "terminal_input",
      source: "terminal",
      role: "user",
      byteLength: Buffer.byteLength(chunk)
    });
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
    queueOutputEvent(data);
  });

  terminal.onExit(async ({ exitCode }) => {
    flushPendingOutput();
    process.stdin.off("data", onInput);
    process.stdout.off("resize", onResize);

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(Boolean(stdinWasRaw));
      process.stdin.pause();
    }

    await finishSession({
      command: redactedDisplayCommand,
      endedAt: new Date().toISOString(),
      exitCode,
      metadataPath,
      sessionDir,
      sessionId,
      startedAt,
      cwd,
      gitStart,
      transcriptChunks,
      transcriptEventCount: transcriptEventSeq,
      transcriptEventsPath,
      transcriptEventsStream,
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
  cwd,
  gitStart,
  transcriptChunks,
  transcriptEventCount,
  transcriptEventsPath,
  transcriptEventsStream,
  transcriptPath,
  transcriptStream,
  wrapUpPath
}) {
  const transcript = stripAnsi(Buffer.concat(transcriptChunks).toString("utf8"));
  const redactedTranscript = redactSecrets(transcript);
  const lineCount = transcript.split(/\r?\n/).filter(Boolean).length;
  const durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  const gitEnd = getGitSnapshot(cwd);
  const git = summarizeGitSession(gitStart, gitEnd);
  const wrapUp = buildWrapUp({
    command,
    startedAt,
    endedAt,
    exitCode,
    transcript: redactedTranscript.text
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
    transcriptEventsPath,
    wrapUpPath,
    metadataPath,
    transcriptEventCount: transcriptEventCount + 1,
    redactionCount: redactedTranscript.count,
    git
  };

  await fsp.writeFile(wrapUpPath, wrapUp, "utf8");
  await fsp.writeFile(metadataPath, JSON.stringify(session, null, 2), "utf8");
  await addSession(session);
  writeJsonlEvent(transcriptEventsStream, {
    seq: transcriptEventCount + 1,
    timestamp: endedAt,
    kind: "session_end",
    source: "terminal",
    role: "system",
    exitCode,
    durationMs,
    lineCount,
    redactionCount: redactedTranscript.count,
    git
  });

  await Promise.all([
    endWritable(transcriptStream),
    endWritable(transcriptEventsStream)
  ]);

  console.error(`\nSession saved: ${sessionDir}`);
  console.error(`Wrap-up: ${wrapUpPath}`);
  process.exitCode = exitCode ?? 0;
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
  console.log(`Exported ${result.bookmarkCount} bookmarks, ${result.sessionCount} sessions, ${result.sessionFileCount || 0} session files, and ${result.attachmentFileCount || 0} attachments.`);
  if (result.warningCount) {
    console.log(`Skipped ${result.warningCount} missing or unreadable files. See export-report.md for details.`);
  }
  console.log(result.exportDir);
}

async function importData(jsonPath) {
  if (!jsonPath) {
    throw new Error("Usage: sheep import <electric-sheep-data.json>");
  }

  await ensureStore();
  const result = await importArchive(jsonPath);
  console.log(`Imported ${result.addedBookmarks} bookmarks and ${result.addedSessions} sessions.`);
  console.log(`Restored ${result.restoredSessionFileCount || 0} session files and ${result.restoredAttachmentFileCount || 0} attachments.`);
  if (result.warningCount) {
    console.log(`Skipped ${result.warningCount} missing archive files during restore.`);
  }
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
  checks.push(...await auditArchiveHealth());

  for (const check of checks) {
    console.log(`${check.ok ? "ok" : "fail"}  ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
  }

  if (checks.some((check) => !check.ok)) {
    process.exitCode = 1;
  }
}

async function repairLegacy() {
  await ensureStore();
  const result = await repairLegacySessions();
  console.log(`Checked ${result.checked} sessions, repaired ${result.repaired}, skipped ${result.skipped}.`);
  if (result.warningCount) {
    console.log(`${result.warningCount} warnings while repairing legacy sessions.`);
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
  const commandLabel = redactSecrets(`watch ${appName}`).text;
  const stamp      = startedAt.replace(/[:.]/g, "-");
  const sessionDir = path.join(getStorePaths().sessionsDir, `${stamp}-${sessionId.slice(0, 8)}-watch-${safeName(appName)}`);
  const transcriptPath = path.join(sessionDir, "transcript.txt");
  const transcriptEventsPath = path.join(sessionDir, "transcript.jsonl");
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
  let transcriptEventCount = 0;

  async function writeWatchEvent(event) {
    transcriptEventCount += 1;
    await appendJsonlEvent(transcriptEventsPath, {
      seq: transcriptEventCount,
      timestamp: new Date().toISOString(),
      ...event
    });
  }

  await writeWatchEvent({
    kind: "session_start",
    source: "desktop-watch",
    role: "system",
    command: commandLabel,
    intervalSec
  });

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
    const redactedChunk = redactSecrets(chunk);
    chunks.push(chunk);
    await fsp.appendFile(transcriptPath, chunk, "utf8");
    await writeWatchEvent({
      kind: "capture_update",
      source: "desktop-watch",
      role: "screen",
      lineCount: newLines.length,
      redactionCount: redactedChunk.count,
      text: redactedChunk.text
    });
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
    const redactedTranscript = redactSecrets(transcript);
    const wrapUp     = buildWrapUp({ command: commandLabel, startedAt, endedAt, exitCode: 0, transcript: redactedTranscript.text });
    await writeWatchEvent({
      timestamp: endedAt,
      kind: "session_end",
      source: "desktop-watch",
      role: "system",
      exitCode: 0,
      durationMs,
      lineCount,
      redactionCount: redactedTranscript.count
    });
    const session    = {
      id: sessionId, source: "desktop-watch", command: commandLabel,
      startedAt, endedAt, durationMs, lineCount,
      status: "completed", exitCode: 0,
      transcriptPath, transcriptEventsPath, wrapUpPath, metadataPath,
      transcriptEventCount,
      redactionCount: redactedTranscript.count
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
  const commandLabel = redactSecrets(`ax ${appName}`).text;
  const stamp      = startedAt.replace(/[:.]/g, "-");
  const sessionDir = path.join(getStorePaths().sessionsDir, `${stamp}-${sessionId.slice(0, 8)}-ax-${safeName(appName)}`);
  const transcriptPath = path.join(sessionDir, "transcript.txt");
  const transcriptEventsPath = path.join(sessionDir, "transcript.jsonl");
  const wrapUpPath     = path.join(sessionDir, "wrap-up.md");
  const metadataPath   = path.join(sessionDir, "session.json");

  await fsp.mkdir(sessionDir, { recursive: true });
  console.error(`Accessibility watch: ${appName}  (every ${intervalSec}s, Ctrl+C to stop)`);
  console.error(`Session: ${sessionDir}\n`);

  let prevText  = "";
  const chunks  = [];
  let lineCount = 0;
  let transcriptEventCount = 0;

  async function writeAxEvent(event) {
    transcriptEventCount += 1;
    await appendJsonlEvent(transcriptEventsPath, {
      seq: transcriptEventCount,
      timestamp: new Date().toISOString(),
      ...event
    });
  }

  await writeAxEvent({
    kind: "session_start",
    source: "desktop-ax",
    role: "system",
    command: commandLabel,
    intervalSec
  });

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
    const redactedChunk = redactSecrets(chunk);
    chunks.push(chunk);
    await fsp.appendFile(transcriptPath, chunk, "utf8");
    await writeAxEvent({
      kind: "accessibility_update",
      source: "desktop-ax",
      role: "accessibility",
      lineCount: newLines.length,
      redactionCount: redactedChunk.count,
      text: redactedChunk.text
    });
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
    const redactedTranscript = redactSecrets(transcript);
    const wrapUp     = buildWrapUp({ command: commandLabel, startedAt, endedAt, exitCode: 0, transcript: redactedTranscript.text });
    await writeAxEvent({
      timestamp: endedAt,
      kind: "session_end",
      source: "desktop-ax",
      role: "system",
      exitCode: 0,
      durationMs,
      lineCount,
      redactionCount: redactedTranscript.count
    });
    const session    = {
      id: sessionId, source: "desktop-ax", command: commandLabel,
      startedAt, endedAt, durationMs, lineCount,
      status: "completed", exitCode: 0,
      transcriptPath, transcriptEventsPath, wrapUpPath, metadataPath,
      transcriptEventCount,
      redactionCount: redactedTranscript.count
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
  sheep repair-legacy                      Generate event timelines for old sessions

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
  sheep repair-legacy
`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
