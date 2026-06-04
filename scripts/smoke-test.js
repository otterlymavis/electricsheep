#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.join(__dirname, "..");
const sheep = path.join(projectRoot, "bin", "sheep.js");

async function main() {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "electricsheep-smoke-"));
  const store = path.join(tempRoot, "store");
  const exportDir = path.join(tempRoot, "export");
  const importedStore = path.join(tempRoot, "imported");

  await seedStore(store);

  run(["bookmarks"], store);
  run(["sessions"], store);
  run(["search", "smoke-token"], store);
  run(["export", exportDir], store);
  assert.ok(fs.existsSync(path.join(exportDir, "bookmarks.md")));
  assert.ok(fs.existsSync(path.join(exportDir, "sessions.md")));
  assert.ok(fs.existsSync(path.join(exportDir, "electric-sheep-data.json")));

  await seedEmptyStore(importedStore);
  run(["import", path.join(exportDir, "electric-sheep-data.json")], importedStore);
  run(["import", path.join(exportDir, "electric-sheep-data.json")], importedStore);

  const importedBookmarks = JSON.parse(fs.readFileSync(path.join(importedStore, "bookmarks.json"), "utf8"));
  const importedSessions = JSON.parse(fs.readFileSync(path.join(importedStore, "sessions.json"), "utf8"));
  assert.equal(importedBookmarks.length, 1);
  assert.equal(importedSessions.length, 1);

  const trackResult = run(["track", "/bin/echo", "tracked-smoke-token"], store);
  assert.equal(trackResult.status, 0);

  run(["delete", "bookmark", "bookmark-smoke"], store);
  run(["delete", "session", "session-smoke"], store);
  const remainingBookmarks = JSON.parse(fs.readFileSync(path.join(store, "bookmarks.json"), "utf8"));
  const remainingSessions = JSON.parse(fs.readFileSync(path.join(store, "sessions.json"), "utf8"));
  assert.ok(!remainingBookmarks.some((bookmark) => bookmark.id === "bookmark-smoke"));
  assert.ok(!remainingSessions.some((session) => session.id === "session-smoke"));

  console.log("Smoke test passed.");
}

async function seedStore(store) {
  const sessionDir = path.join(store, "sessions", "sample");
  await fsp.mkdir(path.join(store, "screenshots"), { recursive: true });
  await fsp.mkdir(sessionDir, { recursive: true });
  await fsp.writeFile(path.join(sessionDir, "wrap-up.md"), "wrap-up smoke-token", "utf8");
  await fsp.writeFile(path.join(sessionDir, "transcript.txt"), "transcript smoke-token", "utf8");
  await fsp.writeFile(path.join(store, "bookmarks.json"), JSON.stringify([
    {
      id: "bookmark-smoke",
      title: "Smoke Bookmark",
      text: "bookmark smoke-token",
      note: "",
      tags: ["smoke"],
      source: "test",
      attachments: [
        {
          id: "attachment-smoke",
          type: "image",
          path: "/tmp/missing.png",
          originalName: "missing.png",
          extractedText: "ocr smoke-token",
          ocrStatus: "processed"
        }
      ],
      createdAt: "2026-06-04T00:00:00.000Z"
    }
  ], null, 2), "utf8");
  await fsp.writeFile(path.join(store, "sessions.json"), JSON.stringify([
    {
      id: "session-smoke",
      command: "echo smoke-token",
      status: "completed",
      exitCode: 0,
      startedAt: "2026-06-04T00:00:00.000Z",
      endedAt: "2026-06-04T00:00:01.000Z",
      wrapUpPath: path.join(sessionDir, "wrap-up.md"),
      transcriptPath: path.join(sessionDir, "transcript.txt")
    }
  ], null, 2), "utf8");
}

async function seedEmptyStore(store) {
  await fsp.mkdir(path.join(store, "screenshots"), { recursive: true });
  await fsp.mkdir(path.join(store, "sessions"), { recursive: true });
  await fsp.writeFile(path.join(store, "bookmarks.json"), "[]", "utf8");
  await fsp.writeFile(path.join(store, "sessions.json"), "[]", "utf8");
}

function run(args, store) {
  const result = spawnSync(process.execPath, [sheep, ...args], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ELECTRIC_SHEEP_HOME: store
    },
    encoding: "utf8"
  });

  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`Command failed: sheep ${args.join(" ")}`);
  }

  return result;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
