const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { promisify } = require("node:util");
const { exportArchive } = require("../src/export");
const { auditArchiveHealth } = require("../src/health");
const { readImageText } = require("../src/ocr");
const { repairLegacySessions } = require("../src/repair");
const { searchArchive } = require("../src/search");
const {
  deleteBookmark,
  deleteSession,
  ensureStore,
  getStorePaths,
  readBookmarks,
  readSessions,
  updateBookmarks,
  updateSessions
} = require("../src/store");

const projectRoot = path.join(__dirname, "..");
const lambDir = path.join(projectRoot, "lite");
const port = Number(process.env.ELECTRIC_LAMB_PORT || 5177);
const host = process.env.ELECTRIC_LAMB_HOST || "127.0.0.1";
const capturePort = Number(process.env.ELECTRIC_LAMB_CAPTURE_PORT || 33099);
const execFileAsync = promisify(execFile);
const activeTracks = new Map();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".json": "application/json; charset=utf-8"
};

async function main() {
  await ensureStore();
  watchParentProcess();
  startCaptureServer();

  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      sendJson(response, 500, { error: error.message || "server error" });
    });
  });

  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    const url = `http://${host}:${actualPort}/`;
    console.log(`Electric Lamb backend: ${url}`);
    console.log(`Store: ${getStorePaths().baseDir}`);
    if (process.env.ELECTRIC_LAMB_OPEN !== "0") openUrl(url);
  });
}

function startCaptureServer() {
  const server = http.createServer((request, response) => {
    handleCaptureRequest(request, response).catch((error) => {
      sendCorsJson(response, 500, { error: error.message || "capture failed" });
    });
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.warn(`Browser capture port ${capturePort} is already in use.`);
      return;
    }
    console.warn(`Browser capture server failed: ${error.message}`);
  });

  server.listen(capturePort, "127.0.0.1", () => {
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : capturePort;
    console.log(`Electric Lamb browser capture: http://127.0.0.1:${actualPort}`);
  });
}

async function handleCaptureRequest(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/ping") {
    sendCorsJson(response, 200, { ok: true, app: "Electric Lamb" });
    return;
  }

  if (request.method === "POST" && request.url === "/capture") {
    const data = await readJsonBody(request);
    const saved = await saveBrowserCapture(data);
    sendCorsJson(response, 200, { ok: true, id: saved.id });
    return;
  }

  response.writeHead(404);
  response.end();
}

async function saveBrowserCapture(data) {
  const saved = {
    id: randomUUID(),
    title: data.title || data.url || "Browser capture",
    text: String(data.text || "").trim(),
    richHtml: String(data.richHtml || "").trim(),
    note: `Captured from ${data.source || "browser"} - ${data.url || ""}`.trim(),
    tags: ["browser", data.source].filter(Boolean),
    source: "browser-extension",
    attachments: [],
    createdAt: new Date().toISOString()
  };

  await updateBookmarks((bookmarks) => [saved, ...bookmarks]);
  return saved;
}

function watchParentProcess() {
  const parentPid = Number(process.env.ELECTRIC_LAMB_PARENT_PID || 0);
  if (!parentPid || !Number.isFinite(parentPid)) return;

  setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      process.exit(0);
    }
  }, 1000).unref();
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);

  if (url.pathname === "/api/info") {
    sendJson(response, 200, {
      app: "Electric Lamb",
      storePath: getStorePaths().baseDir
    });
    return;
  }

  if (url.pathname === "/api/library") {
    const [bookmarks, sessions] = await Promise.all([readBookmarks(), readSessions()]);
    sendJson(response, 200, { bookmarks, sessions });
    return;
  }

  if (url.pathname === "/api/clipboard-content") {
    sendJson(response, 200, await readClipboardContent());
    return;
  }

  if (url.pathname === "/api/bookmarks" && request.method === "GET") {
    sendJson(response, 200, { bookmarks: await readBookmarks() });
    return;
  }

  if (url.pathname === "/api/sessions" && request.method === "GET") {
    sendJson(response, 200, { sessions: await readSessions(), activeTracks: listActiveTracks() });
    return;
  }

  if (url.pathname === "/api/tracks" && request.method === "GET") {
    sendJson(response, 200, { tracks: listActiveTracks() });
    return;
  }

  if (url.pathname === "/api/tracks" && request.method === "POST") {
    const data = await readJsonBody(request);
    sendJson(response, 200, await startTrackedCommand(data));
    return;
  }

  if (url.pathname.startsWith("/api/tracks/") && request.method === "DELETE") {
    const id = decodeURIComponent(url.pathname.slice("/api/tracks/".length));
    sendJson(response, 200, await stopTrackedCommand(id));
    return;
  }

  if (url.pathname === "/api/search") {
    const query = url.searchParams.get("q") || "";
    sendJson(response, 200, { results: await searchArchive(query) });
    return;
  }

  if (url.pathname === "/api/doctor") {
    sendJson(response, 200, { checks: await auditArchiveHealth() });
    return;
  }

  if (url.pathname === "/api/repair-legacy" && request.method === "POST") {
    sendJson(response, 200, await repairLegacySessions());
    return;
  }

  if (url.pathname === "/api/export" && request.method === "POST") {
    sendJson(response, 200, await exportArchive());
    return;
  }

  if (url.pathname === "/api/ocr-backfill" && request.method === "POST") {
    sendJson(response, 200, await backfillOcr());
    return;
  }

  if (url.pathname === "/api/screenshot" && request.method === "POST") {
    sendJson(response, 200, await captureScreenshot());
    return;
  }

  if (url.pathname === "/api/clipboard-image" && request.method === "POST") {
    sendJson(response, 200, await saveClipboardImage());
    return;
  }

  if (url.pathname === "/api/attachment-data" && request.method === "POST") {
    const data = await readJsonBody(request);
    sendJson(response, 200, await saveAttachmentData(data));
    return;
  }

  if (url.pathname === "/api/bookmarks" && request.method === "POST") {
    const incoming = await readJsonBody(request);
    const bookmark = {
      id: incoming.id || randomUUID(),
      title: String(incoming.title || "").trim(),
      text: String(incoming.text || "").trim(),
      richHtml: String(incoming.richHtml || "").trim(),
      note: String(incoming.note || "").trim(),
      tags: Array.isArray(incoming.tags) ? incoming.tags.map(String) : [],
      source: incoming.source || "lamb-companion",
      screenshotPath: String(incoming.screenshotPath || ""),
      attachments: Array.isArray(incoming.attachments) ? incoming.attachments : [],
      createdAt: incoming.createdAt || new Date().toISOString()
    };

    if (!bookmark.text && !bookmark.richHtml) {
      sendJson(response, 400, { error: "bookmark text is required" });
      return;
    }

    await updateBookmarks((bookmarks) => [bookmark, ...bookmarks.filter((item) => item.id !== bookmark.id)]);
    sendJson(response, 200, bookmark);
    return;
  }

  if (url.pathname.startsWith("/api/bookmarks/") && request.method === "DELETE") {
    const id = decodeURIComponent(url.pathname.slice("/api/bookmarks/".length));
    await deleteBookmark(id);
    sendJson(response, 200, { bookmarks: await readBookmarks() });
    return;
  }

  if (url.pathname.startsWith("/api/sessions/") && request.method === "DELETE" && !url.pathname.includes("/file") && !url.pathname.includes("/save-wrap")) {
    const id = decodeURIComponent(url.pathname.slice("/api/sessions/".length));
    await deleteSession(id);
    sendJson(response, 200, { sessions: await readSessions() });
    return;
  }

  if (url.pathname === "/api/read-file" && request.method === "POST") {
    const data = await readJsonBody(request);
    const filePath = String(data.path || "");
    if (!isSafeReadableFile(filePath)) {
      sendJson(response, 403, { error: "file is outside the Electric Sheep store" });
      return;
    }
    try {
      sendJson(response, 200, { content: await fs.readFile(filePath, "utf8") });
    } catch (error) {
      sendJson(response, 404, { error: error.message || "could not read file" });
    }
    return;
  }

  if (url.pathname === "/api/file") {
    const filePath = url.searchParams.get("path") || "";
    if (!isSafeReadableFile(filePath)) {
      sendText(response, 403, "Forbidden");
      return;
    }
    await serveFile(filePath, response);
    return;
  }

  if (url.pathname.match(/^\/api\/sessions\/[^/]+\/file$/)) {
    const id = decodeURIComponent(url.pathname.split("/")[3]);
    const type = url.searchParams.get("type") || "wrap";
    const session = (await readSessions()).find((item) => item.id === id);
    if (!session) {
      sendJson(response, 404, { error: "session not found" });
      return;
    }

    const filePath = getSessionFilePath(session, type);
    if (!filePath) {
      sendJson(response, 404, { error: "session file not available" });
      return;
    }

    try {
      const content = await fs.readFile(filePath, "utf8");
      sendJson(response, 200, { type, path: filePath, content });
    } catch (error) {
      sendJson(response, 404, { error: error.message || "could not read session file" });
    }
    return;
  }

  if (url.pathname.match(/^\/api\/sessions\/[^/]+\/save-wrap$/) && request.method === "POST") {
    const id = decodeURIComponent(url.pathname.split("/")[3]);
    const session = (await readSessions()).find((item) => item.id === id);
    if (!session?.wrapUpPath) {
      sendJson(response, 404, { error: "session wrap-up not found" });
      return;
    }

    const wrapUp = await fs.readFile(session.wrapUpPath, "utf8");
    const bookmark = {
      id: randomUUID(),
      title: `Wrap-up: ${session.command || "Tracked session"}`,
      text: wrapUp,
      richHtml: "",
      note: "Saved from Electric Lamb tracked session.",
      tags: ["session", "wrap-up", "lamb"],
      source: "lamb-session-wrap-up",
      attachments: [],
      createdAt: new Date().toISOString()
    };
    await updateBookmarks((bookmarks) => [bookmark, ...bookmarks]);
    sendJson(response, 200, bookmark);
    return;
  }

  if (url.pathname === "/api/import" && request.method === "POST") {
    const data = await readJsonBody(request);
    sendJson(response, 200, await importArchiveData(data));
    return;
  }

  await serveStatic(url.pathname, response);
}

function listActiveTracks() {
  return [...activeTracks.values()].map((track) => ({
    id: track.id,
    command: track.command,
    cwd: track.cwd,
    startedAt: track.startedAt,
    status: track.status,
    exitCode: track.exitCode,
    output: track.output.slice(-12000)
  }));
}

async function startTrackedCommand(data) {
  const command = String(data.command || "").trim();
  if (!command) throw new Error("tracked command is required");
  const cwd = path.resolve(String(data.cwd || process.env.HOME || projectRoot));
  const id = randomUUID();
  const track = {
    id,
    command,
    cwd,
    startedAt: new Date().toISOString(),
    status: "running",
    exitCode: null,
    output: ""
  };

  const child = spawn(process.execPath, [
    path.join(projectRoot, "bin", "sheep.js"),
    "track",
    "/bin/zsh",
    "-lc",
    command
  ], {
    cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  track.child = child;
  activeTracks.set(id, track);
  const append = (chunk) => {
    track.output = `${track.output}${chunk.toString()}`.slice(-50000);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("exit", async (exitCode) => {
    track.status = "completed";
    track.exitCode = exitCode;
    track.child = null;
    setTimeout(() => activeTracks.delete(id), 5 * 60 * 1000).unref();
  });
  child.on("error", (error) => {
    track.status = "failed";
    track.output = `${track.output}\n${error.message}`.slice(-50000);
    track.child = null;
  });

  return listActiveTracks().find((item) => item.id === id);
}

async function stopTrackedCommand(id) {
  const track = activeTracks.get(id);
  if (!track) return { ok: true, stopped: false };
  if (track.child) {
    track.child.kill("SIGTERM");
    track.status = "stopping";
  }
  return { ok: true, stopped: true };
}

async function importArchiveData(data) {
  const incomingBookmarks = Array.isArray(data.bookmarks) ? data.bookmarks : [];
  const incomingSessions = Array.isArray(data.sessions) ? data.sessions : [];
  let addedBookmarks = 0;
  let addedSessions = 0;

  await updateBookmarks((bookmarks) => {
    const ids = new Set(bookmarks.map((bookmark) => bookmark.id).filter(Boolean));
    const next = [...bookmarks];
    for (const bookmark of incomingBookmarks) {
      const id = bookmark.id || randomUUID();
      if (ids.has(id)) continue;
      next.unshift({
        ...bookmark,
        id,
        title: String(bookmark.title || "").trim(),
        text: String(bookmark.text || "").trim(),
        richHtml: String(bookmark.richHtml || "").trim(),
        note: String(bookmark.note || "").trim(),
        tags: Array.isArray(bookmark.tags) ? bookmark.tags.map(String) : [],
        source: bookmark.source || "lamb-import",
        attachments: Array.isArray(bookmark.attachments) ? bookmark.attachments : [],
        createdAt: bookmark.createdAt || new Date().toISOString()
      });
      ids.add(id);
      addedBookmarks += 1;
    }
    return next;
  });

  await updateSessions((sessions) => {
    const ids = new Set(sessions.map((session) => session.id).filter(Boolean));
    const next = [...sessions];
    for (const session of incomingSessions) {
      const id = session.id || randomUUID();
      if (ids.has(id)) continue;
      next.unshift({
        ...session,
        id,
        source: session.source || "lamb-import",
        status: session.status || "imported",
        createdAt: session.createdAt || session.startedAt || new Date().toISOString()
      });
      ids.add(id);
      addedSessions += 1;
    }
    return next;
  });

  return {
    added: addedBookmarks,
    addedBookmarks,
    addedSessions,
    skippedBookmarks: incomingBookmarks.length - addedBookmarks,
    skippedSessions: incomingSessions.length - addedSessions,
    restoredSessionFileCount: 0,
    restoredAttachmentFileCount: 0,
    warningCount: 0
  };
}

function getSessionFilePath(session, type) {
  if (type === "transcript") return session.transcriptPath || "";
  if (type === "events") return session.transcriptEventsPath || "";
  return session.wrapUpPath || "";
}

async function captureScreenshot() {
  if (process.platform !== "darwin") {
    throw new Error("Screenshot capture is currently macOS-only in Electric Lamb.");
  }

  const { screenshotsDir } = getStorePaths();
  await fs.mkdir(screenshotsDir, { recursive: true });
  const fileName = `screenshot-${Date.now()}.png`;
  const filePath = path.join(screenshotsDir, fileName);
  await execFileAsync("/usr/sbin/screencapture", ["-x", filePath], {
    timeout: 30000,
    maxBuffer: 1024 * 1024
  });
  return createImageAttachment(filePath, fileName);
}

async function saveClipboardImage() {
  if (process.platform !== "darwin") {
    throw new Error("Clipboard image capture is currently macOS-only in Electric Lamb.");
  }

  const { screenshotsDir } = getStorePaths();
  await fs.mkdir(screenshotsDir, { recursive: true });
  const fileName = `clipboard-image-${Date.now()}.png`;
  const filePath = path.join(screenshotsDir, fileName);
  await execFileAsync("swift", [path.join(projectRoot, "scripts", "clipboard-image.swift"), filePath], {
    timeout: 30000,
    maxBuffer: 1024 * 1024
  });
  return createImageAttachment(filePath, fileName);
}

async function readClipboardContent() {
  if (process.platform !== "darwin") return { text: "", html: "" };
  try {
    const { stdout } = await execFileAsync("pbpaste", [], {
      timeout: 5000,
      maxBuffer: 2 * 1024 * 1024
    });
    return { text: stdout, html: "" };
  } catch {
    return { text: "", html: "" };
  }
}

async function saveAttachmentData(data) {
  const originalName = String(data.name || data.originalName || "attachment").trim() || "attachment";
  const type = String(data.type || "").startsWith("image") || String(data.mime || "").startsWith("image/")
    ? "image"
    : "text";
  const mime = String(data.mime || "");
  const base64 = String(data.base64 || "");
  const text = String(data.text || "");

  if (type === "text") {
    const content = text || Buffer.from(base64, "base64").toString("utf8");
    return saveTextAttachment(originalName, content);
  }

  if (!base64) throw new Error("image attachment requires base64 data");
  const extension = extensionForMime(mime) || path.extname(originalName) || ".png";
  const { screenshotsDir } = getStorePaths();
  await fs.mkdir(screenshotsDir, { recursive: true });
  const fileName = `image-${Date.now()}-${randomUUID()}${extension}`;
  const filePath = path.join(screenshotsDir, fileName);
  await fs.writeFile(filePath, Buffer.from(base64, "base64"));
  return createImageAttachment(filePath, originalName);
}

async function saveTextAttachment(originalName, content) {
  const { screenshotsDir } = getStorePaths();
  await fs.mkdir(screenshotsDir, { recursive: true });
  const extension = path.extname(originalName) || ".txt";
  const fileName = `text-${Date.now()}-${randomUUID()}${extension}`;
  const filePath = path.join(screenshotsDir, fileName);
  await fs.writeFile(filePath, content, "utf8");
  return {
    id: randomUUID(),
    type: "text",
    path: filePath,
    url: fileUrl(filePath),
    originalName,
    extractedText: content,
    createdAt: new Date().toISOString()
  };
}

async function createImageAttachment(filePath, originalName) {
  const ocr = await readImageText(filePath);
  return {
    id: randomUUID(),
    type: "image",
    path: filePath,
    url: fileUrl(filePath),
    originalName,
    extractedText: ocr.text,
    ocrStatus: ocr.status,
    createdAt: new Date().toISOString()
  };
}

function fileUrl(filePath) {
  return `/api/file?path=${encodeURIComponent(filePath)}`;
}

function extensionForMime(mime) {
  const map = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif"
  };
  return map[mime] || "";
}

async function serveStatic(requestPath, response) {
  if (requestPath === "/") {
    await serveElectronIndex(response);
    return;
  }

  if (requestPath === "/lamb-bridge.js") {
    await serveFile(path.join(lambDir, "electron-bridge.js"), response);
    return;
  }

  if (requestPath === "/favicon.ico") {
    await serveFile(path.join(projectRoot, "image.png"), response);
    return;
  }

  if (requestPath === "/lamb/" || requestPath.startsWith("/lamb/")) {
    const relativePath = requestPath === "/lamb/" ? "index.html" : decodeURIComponent(requestPath.slice("/lamb/".length));
    await serveStaticFrom(lambDir, relativePath, response);
    return;
  }

  const relativePath = decodeURIComponent(requestPath.slice(1));
  const sourceDir = relativePath === "image.png" || relativePath === "index.html" || relativePath.startsWith("src/")
    ? projectRoot
    : lambDir;
  await serveStaticFrom(sourceDir, relativePath, response);
}

async function serveElectronIndex(response) {
  try {
    const html = await fs.readFile(path.join(projectRoot, "index.html"), "utf8");
    const patched = html
      .replace("<title>Electric Sheep</title>", "<title>Electric Lamb</title>")
      .replace('<script src="./src/renderer.js"></script>', '<script src="/lamb-bridge.js"></script>\n<script src="./src/renderer.js"></script>')
      .replace(/Electric Sheep/g, "Electric Lamb");
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    });
    response.end(patched);
  } catch {
    sendText(response, 404, "Not found");
  }
}

async function serveStaticFrom(sourceDir, relativePath, response) {
  const filePath = path.resolve(sourceDir, relativePath);
  const resolvedBase = path.resolve(sourceDir);

  if (filePath !== resolvedBase && !filePath.startsWith(`${resolvedBase}${path.sep}`)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  await serveFile(filePath, response);
}

async function serveFile(filePath, response) {
  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      "content-type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store"
    });
    response.end(content);
  } catch {
    sendText(response, 404, "Not found");
  }
}

async function backfillOcr() {
  const bookmarks = await readBookmarks();
  let checked = 0;
  let updated = 0;
  let failed = 0;

  await updateBookmarks(async (items) => {
    for (const bookmark of items) {
      for (const attachment of Array.isArray(bookmark.attachments) ? bookmark.attachments : []) {
        if (attachment.type !== "image" || attachment.ocrStatus === "processed" || attachment.ocrStatus === "empty") continue;
        checked += 1;
        try {
          const text = await readImageText(attachment.path);
          attachment.extractedText = text;
          attachment.ocrStatus = text ? "processed" : "empty";
          updated += 1;
        } catch {
          attachment.ocrStatus = "failed";
          failed += 1;
        }
      }
    }
    return items;
  });

  return { checked, updated, failed, bookmarkCount: bookmarks.length };
}

function isSafeReadableFile(filePath) {
  if (!filePath) return false;
  const baseDir = path.resolve(getStorePaths().baseDir);
  const resolved = path.resolve(filePath);
  return resolved === baseDir || resolved.startsWith(`${baseDir}${path.sep}`);
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function sendCorsJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Content-Type"
  });
  response.end(JSON.stringify(value));
}

function sendText(response, statusCode, value) {
  response.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  response.end(value);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) {
        request.destroy();
        reject(new Error("request body too large"));
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function openUrl(url) {
  const opener = process.platform === "darwin"
    ? "open"
    : (process.platform === "win32" ? "cmd" : "xdg-open");
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(opener, args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
