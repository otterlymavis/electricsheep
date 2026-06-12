#!/usr/bin/env node

const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const appPath = path.resolve(projectRoot, process.argv[2] || "release/standalone/Electric Lamb.app");
const appExecutable = path.join(appPath, "Contents", "MacOS", "Electric Lamb");
const appResourcesPath = path.join(appPath, "Contents", "Resources", "app");

async function main() {
  assert.equal(process.platform, "darwin", "Electric Lamb app smoke test currently requires macOS");
  assert.ok(fs.existsSync(appExecutable), `missing app executable: ${appExecutable}`);
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "electric-lamb-app-smoke-"));
  const store = path.join(tempRoot, "store");

  const app = spawnApp(store);
  let appOutput = "";
  app.stdout?.on("data", (chunk) => { appOutput += chunk.toString(); });
  app.stderr?.on("data", (chunk) => { appOutput += chunk.toString(); });

  try {
    const running = await waitFor(() => findProcesses(), (processes) => (
      processes.some((line) => line.includes(appExecutable)) &&
      processes.some((line) => line.includes(appResourcesPath) && line.includes("lamb-server.js"))
    ), 12000);
    assert.ok(running, `Electric Lamb app or backend did not start\n${appOutput.trim()}`);
    assert.ok(fs.existsSync(path.join(store, "bookmarks.json")), "Electric Lamb did not initialize the isolated smoke-test store");
  } finally {
    app.kill("SIGTERM");
  }

  const stopped = await waitFor(() => findProcesses(), (processes) => (
    !processes.some((line) => (
      line.includes(appExecutable) ||
      (line.includes(appResourcesPath) && line.includes("lamb-server.js"))
    ))
  ), 12000);
  assert.ok(stopped, "Electric Lamb backend was still running after app quit");

  console.log(`Electric Lamb app smoke passed: ${appPath}`);
}

function spawnApp(store) {
  return spawn(appExecutable, [], {
    cwd: projectRoot,
    detached: false,
    env: {
      ...process.env,
      ELECTRIC_SHEEP_HOME: store,
      ELECTRIC_LAMB_CAPTURE_PORT: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function findProcesses() {
  const result = spawnSync("pgrep", ["-fl", "Electric Lamb|lamb-server.js"], {
    cwd: projectRoot,
    encoding: "utf8"
  });
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

async function waitFor(read, predicate, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate(read())) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
