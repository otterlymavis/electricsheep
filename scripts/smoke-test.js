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
  const richSearchResult = run(["search", "rich-only-token"], store);
  assert.match(richSearchResult.stdout, /rich-only-token/);
  const doctorResult = run(["doctor"], store, { allowFailure: true });
  assert.equal(doctorResult.status, 1);
  assert.match(doctorResult.stdout, /Referenced files/);
  assert.match(doctorResult.stdout, /OCR backlog/);
  assert.match(doctorResult.stdout, /Structured transcripts/);
  const repairResult = run(["repair-legacy"], store);
  assert.match(repairResult.stdout, /repaired 1/);
  const secondRepairResult = run(["repair-legacy"], store);
  assert.match(secondRepairResult.stdout, /repaired 0/);
  const repairedSessions = JSON.parse(fs.readFileSync(path.join(store, "sessions.json"), "utf8"));
  assert.ok(repairedSessions[0].transcriptEventsPath);
  assert.ok(fs.existsSync(repairedSessions[0].transcriptEventsPath));
  const repairedEvents = fs.readFileSync(repairedSessions[0].transcriptEventsPath, "utf8");
  assert.match(repairedEvents, /\[REDACTED\]/);
  assert.doesNotMatch(repairedEvents, /sk-1234567890abcdefghijkl/);
  run(["export", exportDir], store);
  assert.ok(fs.existsSync(path.join(exportDir, "bookmarks.md")));
  assert.ok(fs.existsSync(path.join(exportDir, "bookmarks.html")));
  assert.ok(fs.existsSync(path.join(exportDir, "sessions.md")));
  assert.ok(fs.existsSync(path.join(exportDir, "export-report.md")));
  assert.ok(fs.existsSync(path.join(exportDir, "electric-sheep-data.json")));
  const bookmarksHtml = fs.readFileSync(path.join(exportDir, "bookmarks.html"), "utf8");
  assert.match(bookmarksHtml, /&lt;strong&gt;bookmark&lt;\/strong&gt; smoke-token/);
  const exportReport = fs.readFileSync(path.join(exportDir, "export-report.md"), "utf8");
  assert.match(exportReport, /bookmarks\.html/);
  assert.match(exportReport, /Skipped files: 1/);
  assert.match(exportReport, /Attachments copied: 1/);
  assert.match(exportReport, /missing\.png/);

  await seedEmptyStore(importedStore);
  run(["import", path.join(exportDir, "electric-sheep-data.json")], importedStore);
  run(["import", path.join(exportDir, "electric-sheep-data.json")], importedStore);

  const importedBookmarks = JSON.parse(fs.readFileSync(path.join(importedStore, "bookmarks.json"), "utf8"));
  const importedSessions = JSON.parse(fs.readFileSync(path.join(importedStore, "sessions.json"), "utf8"));
  assert.equal(importedBookmarks.length, 1);
  assert.equal(importedBookmarks[0].richHtml, "<p><strong>bookmark</strong> smoke-token</p><p>rich-only-token</p>");
  assert.equal(importedSessions.length, 1);
  assert.ok(importedBookmarks[0].attachments.some((attachment) => (
    attachment.id === "attachment-smoke" &&
    attachment.path.startsWith(importedStore) &&
    fs.existsSync(attachment.path)
  )));
  assert.ok(importedSessions[0].transcriptPath.startsWith(importedStore));
  assert.ok(fs.existsSync(importedSessions[0].transcriptPath));
  assert.ok(importedSessions[0].wrapUpPath.startsWith(importedStore));
  assert.ok(fs.existsSync(importedSessions[0].wrapUpPath));
  assert.ok(importedSessions[0].transcriptEventsPath.startsWith(importedStore));
  assert.ok(fs.existsSync(importedSessions[0].transcriptEventsPath));

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
  const attachmentPath = path.join(store, "screenshots", "attachment-smoke.txt");
  await fsp.writeFile(attachmentPath, "attachment smoke-token", "utf8");
  await fsp.writeFile(path.join(sessionDir, "wrap-up.md"), "wrap-up smoke-token", "utf8");
  await fsp.writeFile(path.join(sessionDir, "transcript.txt"), "transcript smoke-token sk-1234567890abcdefghijkl", "utf8");
  await fsp.writeFile(path.join(store, "bookmarks.json"), JSON.stringify([
    {
      id: "bookmark-smoke",
      title: "Smoke Bookmark",
      text: "bookmark smoke-token",
      richHtml: "<p><strong>bookmark</strong> smoke-token</p><p>rich-only-token</p>",
      note: "",
      tags: ["smoke"],
      source: "test",
      attachments: [
        {
          id: "attachment-smoke",
          type: "text",
          path: attachmentPath,
          originalName: "attachment-smoke.txt",
          extractedText: "ocr smoke-token",
          ocrStatus: "processed"
        },
        {
          id: "attachment-missing-smoke",
          type: "image",
          path: "/tmp/missing.png",
          originalName: "missing.png",
          extractedText: "",
          ocrStatus: "failed"
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

function run(args, store, options = {}) {
  const result = spawnSync(process.execPath, [sheep, ...args], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ELECTRIC_SHEEP_HOME: store
    },
    encoding: "utf8"
  });

  if (result.status !== 0 && !options.allowFailure) {
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
