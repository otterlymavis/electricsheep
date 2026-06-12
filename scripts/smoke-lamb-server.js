#!/usr/bin/env node

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const serverScript = path.join(projectRoot, "scripts", "lamb-server.js");

async function main() {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "electric-lamb-server-smoke-"));
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

  try {
    const appUrl = await waitForUrl(outputRef(() => output), /Electric Lamb backend: (http:\/\/127\.0\.0\.1:\d+\/)/);
    const captureUrl = await waitForUrl(outputRef(() => output), /Electric Lamb browser capture: (http:\/\/127\.0\.0\.1:\d+)/);

    const info = await getJson(new URL("/api/info", appUrl));
    assert.equal(info.app, "Electric Lamb");
    assert.equal(info.storePath, store);

    const html = await getText(appUrl);
    assert.match(html, /Electric Lamb/);
    assert.match(html, /lamb-bridge\.js/);

    const saved = await postJson(new URL("/api/bookmarks", appUrl), {
      title: "Server Smoke",
      text: "lamb-server-smoke-token",
      note: "saved through API smoke",
      tags: ["smoke"],
      source: "smoke-test"
    });
    assert.equal(saved.title, "Server Smoke");

    const search = await getJson(new URL("/api/search?q=lamb-server-smoke-token", appUrl));
    assert.ok(search.results.some((result) => result.id === saved.id));

    const ping = await getJson(new URL("/ping", captureUrl));
    assert.equal(ping.ok, true);
    const capture = await postJson(new URL("/capture", captureUrl), {
      title: "Captured Smoke",
      text: "browser-capture-smoke-token",
      richHtml: "<p>browser-capture-smoke-token</p>",
      source: "smoke",
      url: "https://example.test/smoke"
    });
    assert.equal(capture.ok, true);

    const track = await postJson(new URL("/api/tracks", appUrl), {
      command: "echo lamb-server-track-smoke-token",
      cwd: projectRoot
    });
    assert.equal(track.status, "running");

    const sessionSeen = await waitFor(async () => {
      const sessions = await getJson(new URL("/api/sessions", appUrl));
      return sessions.sessions.some((session) => (
        String(session.command || "").includes("lamb-server-track-smoke-token") &&
        session.status === "completed"
      ));
    }, 12000);
    assert.ok(sessionSeen, "tracked command did not become a completed session");

    const bookmarks = await getJson(new URL("/api/bookmarks", appUrl));
    assert.ok(bookmarks.bookmarks.some((bookmark) => bookmark.id === capture.id));
    assert.ok(fs.existsSync(path.join(store, "sessions.json")));

    console.log("Electric Lamb server smoke passed.");
  } finally {
    server.kill("SIGTERM");
    await waitFor(() => server.exitCode !== null || server.killed, 3000).catch(() => {});
  }
}

function outputRef(read) {
  return read;
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

async function getJson(url) {
  const response = await fetch(url);
  assert.ok(response.ok, `${url} returned ${response.status}`);
  return response.json();
}

async function getText(url) {
  const response = await fetch(url);
  assert.ok(response.ok, `${url} returned ${response.status}`);
  return response.text();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
