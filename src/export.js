const fs = require("node:fs/promises");
const path = require("node:path");
const { getStorePaths, readBookmarks, readSessions, updateBookmarks, updateSessions } = require("./store");

async function exportArchive(targetDir) {
  const bookmarks = await readBookmarks();
  const sessions = await readSessions();
  const exportDir = targetDir || defaultExportDir();

  await fs.mkdir(exportDir, { recursive: true });
  await fs.writeFile(path.join(exportDir, "electric-sheep-data.json"), JSON.stringify({
    exportedAt: new Date().toISOString(),
    bookmarks,
    sessions
  }, null, 2), "utf8");
  await fs.writeFile(path.join(exportDir, "bookmarks.md"), renderBookmarksMarkdown(bookmarks), "utf8");
  await fs.writeFile(path.join(exportDir, "sessions.md"), await renderSessionsMarkdown(sessions), "utf8");

  return {
    exportDir,
    bookmarkCount: bookmarks.length,
    sessionCount: sessions.length
  };
}

async function importArchive(jsonPath) {
  const content = await fs.readFile(jsonPath, "utf8");
  const data = JSON.parse(content);
  const incomingBookmarks = Array.isArray(data.bookmarks) ? data.bookmarks : [];
  const incomingSessions = Array.isArray(data.sessions) ? data.sessions : [];
  let addedBookmarks = 0;
  let addedSessions = 0;

  await updateBookmarks((bookmarks) => {
    const ids = new Set(bookmarks.map((bookmark) => bookmark.id).filter(Boolean));
    for (const bookmark of incomingBookmarks) {
      if (!bookmark.id || ids.has(bookmark.id)) continue;
      bookmarks.unshift(bookmark);
      ids.add(bookmark.id);
      addedBookmarks += 1;
    }
    return bookmarks;
  });

  await updateSessions((sessions) => {
    const ids = new Set(sessions.map((session) => session.id).filter(Boolean));
    for (const session of incomingSessions) {
      if (!session.id || ids.has(session.id)) continue;
      sessions.unshift(session);
      ids.add(session.id);
      addedSessions += 1;
    }
    return sessions;
  });

  return {
    addedBookmarks,
    addedSessions,
    skippedBookmarks: incomingBookmarks.length - addedBookmarks,
    skippedSessions: incomingSessions.length - addedSessions
  };
}

function defaultExportDir() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(getStorePaths().baseDir, "exports", `export-${stamp}`);
}

function renderBookmarksMarkdown(bookmarks) {
  const sections = [
    "# Electric Sheep Bookmarks",
    "",
    `Exported: ${new Date().toISOString()}`,
    ""
  ];

  for (const bookmark of bookmarks) {
    sections.push(`## ${bookmark.title || bookmark.createdAt || "Bookmark"}`);
    sections.push("");
    sections.push(`Created: ${bookmark.createdAt || "unknown"}`);
    sections.push(`Source: ${bookmark.source || "quick-save"}`);
    if (Array.isArray(bookmark.tags) && bookmark.tags.length) {
      sections.push(`Tags: ${bookmark.tags.join(", ")}`);
    }
    sections.push("");
    if (bookmark.text) {
      sections.push(bookmark.text);
      sections.push("");
    }
    if (bookmark.note) {
      sections.push("### Note");
      sections.push("");
      sections.push(bookmark.note);
      sections.push("");
    }
    const attachments = Array.isArray(bookmark.attachments) ? bookmark.attachments : [];
    if (attachments.length) {
      sections.push("### Attachments");
      sections.push("");
      for (const attachment of attachments) {
        sections.push(`- ${attachment.originalName || "Attachment"}: ${attachment.path}`);
        if (attachment.extractedText) {
          sections.push(`  - OCR/Text: ${attachment.extractedText.replace(/\n/g, " ")}`);
        }
      }
      sections.push("");
    }
  }

  return `${sections.join("\n")}\n`;
}

async function renderSessionsMarkdown(sessions) {
  const sections = [
    "# Electric Sheep Sessions",
    "",
    `Exported: ${new Date().toISOString()}`,
    ""
  ];

  for (const session of sessions) {
    sections.push(`## ${session.command || "Tracked session"}`);
    sections.push("");
    sections.push(`Started: ${session.startedAt || "unknown"}`);
    sections.push(`Ended: ${session.endedAt || "unknown"}`);
    sections.push(`Status: ${session.status || "tracked"}`);
    sections.push(`Exit code: ${session.exitCode ?? "unknown"}`);
    sections.push(`Transcript: ${session.transcriptPath || ""}`);
    sections.push(`Wrap-up: ${session.wrapUpPath || ""}`);
    sections.push("");

    if (session.wrapUpPath) {
      try {
        const wrapUp = await fs.readFile(session.wrapUpPath, "utf8");
        sections.push(wrapUp.trim());
        sections.push("");
      } catch {
        sections.push("_Wrap-up file unavailable._");
        sections.push("");
      }
    }
  }

  return `${sections.join("\n")}\n`;
}

module.exports = {
  exportArchive,
  importArchive
};
