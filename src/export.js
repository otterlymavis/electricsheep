const fs = require("node:fs/promises");
const path = require("node:path");
const { getStorePaths, readBookmarks, readSessions, updateBookmarks, updateSessions } = require("./store");

async function exportArchive(targetDir) {
  const bookmarks = await readBookmarks();
  const sessions = await readSessions();
  const exportDir = targetDir || defaultExportDir();
  const exportedAt = new Date().toISOString();
  const exportWarnings = [];

  await fs.mkdir(exportDir, { recursive: true });
  const sessionFiles = await bundleSessionFiles(exportDir, sessions, exportWarnings);
  const attachmentFiles = await bundleBookmarkAttachments(exportDir, bookmarks, exportWarnings);
  await fs.writeFile(path.join(exportDir, "electric-sheep-data.json"), JSON.stringify({
    exportedAt,
    bookmarks,
    sessions,
    sessionFiles,
    attachmentFiles,
    exportWarnings
  }, null, 2), "utf8");
  await fs.writeFile(path.join(exportDir, "bookmarks.md"), renderBookmarksMarkdown(bookmarks, attachmentFiles), "utf8");
  await fs.writeFile(path.join(exportDir, "bookmarks.html"), renderBookmarksHtml(bookmarks, attachmentFiles), "utf8");
  await fs.writeFile(path.join(exportDir, "sessions.md"), await renderSessionsMarkdown(sessions, sessionFiles), "utf8");
  await fs.writeFile(path.join(exportDir, "export-report.md"), renderExportReport({
    exportedAt,
    bookmarks,
    sessions,
    sessionFiles,
    attachmentFiles,
    exportWarnings
  }), "utf8");

  return {
    exportDir,
    bookmarkCount: bookmarks.length,
    sessionCount: sessions.length,
    sessionFileCount: countBundledFiles(sessionFiles),
    attachmentFileCount: countBundledAttachments(attachmentFiles),
    warningCount: exportWarnings.length
  };
}

async function bundleSessionFiles(exportDir, sessions, exportWarnings = []) {
  const bundled = {};
  const sessionsDir = path.join(exportDir, "sessions");
  await fs.mkdir(sessionsDir, { recursive: true });

  for (const session of sessions) {
    const sessionName = safeFileName(`${session.startedAt || "session"}-${session.id || session.command || "unknown"}`);
    const sessionDir = path.join(sessionsDir, sessionName);
    const files = {};

    await fs.mkdir(sessionDir, { recursive: true });
    await copySessionFile(session.transcriptPath, exportDir, sessionDir, "transcript.txt", files, "transcript", session, exportWarnings);
    await copySessionFile(session.transcriptEventsPath, exportDir, sessionDir, "transcript.jsonl", files, "structuredTranscript", session, exportWarnings);
    await copySessionFile(session.wrapUpPath, exportDir, sessionDir, "wrap-up.md", files, "wrapUp", session, exportWarnings);
    await copySessionFile(session.metadataPath, exportDir, sessionDir, "session.json", files, "metadata", session, exportWarnings);

    if (Object.keys(files).length > 0) {
      bundled[session.id || sessionName] = files;
    }
  }

  return bundled;
}

async function copySessionFile(sourcePath, exportDir, sessionDir, fileName, files, key, session, exportWarnings) {
  if (!sourcePath) return;

  try {
    const targetPath = path.join(sessionDir, fileName);
    await fs.copyFile(sourcePath, targetPath);
    files[key] = path.relative(exportDir, targetPath);
  } catch (error) {
    exportWarnings.push({
      type: "session-file",
      sessionId: session.id || "",
      command: session.command || "",
      fileType: key,
      sourcePath,
      reason: error.code || error.message || "copy failed"
    });
  }
}

async function bundleBookmarkAttachments(exportDir, bookmarks, exportWarnings = []) {
  const bundled = {};
  const attachmentsDir = path.join(exportDir, "attachments");
  await fs.mkdir(attachmentsDir, { recursive: true });

  for (const bookmark of bookmarks) {
    const attachments = getBookmarkAttachments(bookmark);
    if (!attachments.length) continue;

    const bookmarkName = safeFileName(`${bookmark.createdAt || "bookmark"}-${bookmark.id || bookmark.title || "unknown"}`);
    const bookmarkDir = path.join(attachmentsDir, bookmarkName);
    const copied = [];

    await fs.mkdir(bookmarkDir, { recursive: true });
    for (let index = 0; index < attachments.length; index += 1) {
      const copiedAttachment = await copyAttachmentFile(attachments[index], exportDir, bookmarkDir, index, bookmark, exportWarnings);
      if (copiedAttachment) copied.push(copiedAttachment);
    }

    if (copied.length) {
      bundled[bookmark.id || bookmarkName] = copied;
    }
  }

  return bundled;
}

function getBookmarkAttachments(bookmark) {
  const attachments = Array.isArray(bookmark.attachments) ? [...bookmark.attachments] : [];

  if (bookmark.screenshotPath && !attachments.some((attachment) => attachment.path === bookmark.screenshotPath)) {
    attachments.push({
      id: `${bookmark.id || "bookmark"}-screenshot`,
      type: "image",
      path: bookmark.screenshotPath,
      originalName: "Screenshot",
      extractedText: "",
      ocrStatus: "unknown",
      createdAt: bookmark.createdAt
    });
  }

  return attachments;
}

async function copyAttachmentFile(attachment, exportDir, bookmarkDir, index, bookmark, exportWarnings) {
  if (!attachment || !attachment.path) {
    exportWarnings.push({
      type: "attachment",
      bookmarkId: bookmark.id || "",
      title: bookmark.title || "",
      attachmentId: attachment?.id || "",
      originalName: attachment?.originalName || "",
      sourcePath: "",
      reason: "missing path"
    });
    return null;
  }

  try {
    const sourceName = attachment.originalName || path.basename(attachment.path) || `attachment-${index + 1}`;
    const targetName = makeExportedAttachmentName(sourceName, attachment.path, index);
    const targetPath = path.join(bookmarkDir, targetName);
    await fs.copyFile(attachment.path, targetPath);
    return {
      id: attachment.id || "",
      type: attachment.type || "",
      originalName: attachment.originalName || "",
      originalPath: attachment.path,
      exportedPath: path.relative(exportDir, targetPath)
    };
  } catch (error) {
    exportWarnings.push({
      type: "attachment",
      bookmarkId: bookmark.id || "",
      title: bookmark.title || "",
      attachmentId: attachment.id || "",
      originalName: attachment.originalName || "",
      sourcePath: attachment.path,
      reason: error.code || error.message || "copy failed"
    });
    return null;
  }
}

function makeExportedAttachmentName(sourceName, sourcePath, index) {
  const safeName = safeFileName(sourceName) || `attachment-${index + 1}`;
  const safeExt = path.extname(safeName);
  const sourceExt = path.extname(sourcePath || "");
  const extension = safeExt || sourceExt;
  const stem = extension && safeName.endsWith(extension) ? safeName.slice(0, -extension.length) : safeName;
  return `${String(index + 1).padStart(2, "0")}-${stem || "attachment"}${extension}`;
}

function findBundledAttachment(bookmark, attachment, attachmentFiles) {
  const bookmarkName = safeFileName(`${bookmark.createdAt || "bookmark"}-${bookmark.id || bookmark.title || "unknown"}`);
  const bundled = attachmentFiles[bookmark.id] || attachmentFiles[bookmarkName] || [];
  return bundled.find((file) => file.id && file.id === attachment.id)
    || bundled.find((file) => file.originalPath && file.originalPath === attachment.path);
}

function countBundledFiles(fileMap) {
  return Object.values(fileMap).reduce((count, files) => count + Object.keys(files).length, 0);
}

function countBundledAttachments(fileMap) {
  return Object.values(fileMap).reduce((count, files) => count + files.length, 0);
}

function renderExportReport({ exportedAt, bookmarks, sessions, sessionFiles, attachmentFiles, exportWarnings }) {
  const sessionFileCount = countBundledFiles(sessionFiles);
  const attachmentFileCount = countBundledAttachments(attachmentFiles);
  const sections = [
    "# Electric Sheep Export Report",
    "",
    `Exported: ${exportedAt}`,
    "",
    "## Summary",
    "",
    `- Bookmarks: ${bookmarks.length}`,
    `- Sessions: ${sessions.length}`,
    `- Session files copied: ${sessionFileCount}`,
    `- Attachments copied: ${attachmentFileCount}`,
    `- Skipped files: ${exportWarnings.length}`,
    "",
    "## Archive Files",
    "",
    "- electric-sheep-data.json",
    "- bookmarks.md",
    "- bookmarks.html",
    "- sessions.md",
    "- export-report.md",
    ""
  ];

  const copiedSessionGroups = Object.entries(sessionFiles);
  if (copiedSessionGroups.length) {
    sections.push("## Copied Session Files", "");
    for (const [sessionId, files] of copiedSessionGroups) {
      sections.push(`### ${sessionId}`);
      for (const [fileType, exportedPath] of Object.entries(files)) {
        sections.push(`- ${fileType}: ${exportedPath}`);
      }
      sections.push("");
    }
  }

  const copiedAttachmentGroups = Object.entries(attachmentFiles);
  if (copiedAttachmentGroups.length) {
    sections.push("## Copied Attachments", "");
    for (const [bookmarkId, files] of copiedAttachmentGroups) {
      sections.push(`### ${bookmarkId}`);
      for (const file of files) {
        sections.push(`- ${file.originalName || file.id || "Attachment"}: ${file.exportedPath}`);
      }
      sections.push("");
    }
  }

  if (exportWarnings.length) {
    sections.push("## Skipped Files", "");
    for (const warning of exportWarnings) {
      const owner = warning.sessionId || warning.bookmarkId || warning.title || "unknown";
      const label = warning.fileType || warning.originalName || warning.attachmentId || warning.type;
      sections.push(`- ${warning.type}: ${owner} / ${label}`);
      sections.push(`  - Source: ${warning.sourcePath || "unknown"}`);
      sections.push(`  - Reason: ${warning.reason || "unknown"}`);
    }
    sections.push("");
  } else {
    sections.push("## Skipped Files", "", "No skipped files.", "");
  }

  return `${sections.join("\n")}\n`;
}

function safeFileName(value) {
  return String(value || "item")
    .replace(/[:/\\?%*|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 140);
}

async function importArchive(jsonPath) {
  const content = await fs.readFile(jsonPath, "utf8");
  const data = JSON.parse(content);
  const archiveDir = path.dirname(jsonPath);
  const incomingBookmarks = Array.isArray(data.bookmarks) ? data.bookmarks : [];
  const incomingSessions = Array.isArray(data.sessions) ? data.sessions : [];
  const attachmentFiles = data.attachmentFiles && typeof data.attachmentFiles === "object" ? data.attachmentFiles : {};
  const sessionFiles = data.sessionFiles && typeof data.sessionFiles === "object" ? data.sessionFiles : {};
  const importWarnings = [];
  const preparedBookmarks = [];
  const preparedSessions = [];
  let addedBookmarks = 0;
  let addedSessions = 0;

  const currentBookmarks = await readBookmarks();
  const currentBookmarkIds = new Set(currentBookmarks.map((bookmark) => bookmark.id).filter(Boolean));
  for (const bookmark of incomingBookmarks) {
    if (!bookmark.id || currentBookmarkIds.has(bookmark.id)) continue;
    preparedBookmarks.push(await restoreBookmarkFiles(bookmark, attachmentFiles, archiveDir, importWarnings));
    currentBookmarkIds.add(bookmark.id);
  }

  const currentSessions = await readSessions();
  const currentSessionIds = new Set(currentSessions.map((session) => session.id).filter(Boolean));
  for (const session of incomingSessions) {
    if (!session.id || currentSessionIds.has(session.id)) continue;
    preparedSessions.push(await restoreSessionFiles(session, sessionFiles, archiveDir, importWarnings));
    currentSessionIds.add(session.id);
  }

  await updateBookmarks((bookmarks) => {
    const ids = new Set(bookmarks.map((bookmark) => bookmark.id).filter(Boolean));
    for (const bookmark of preparedBookmarks) {
      if (!bookmark.id || ids.has(bookmark.id)) continue;
      bookmarks.unshift(bookmark);
      ids.add(bookmark.id);
      addedBookmarks += 1;
    }
    return bookmarks;
  });

  await updateSessions((sessions) => {
    const ids = new Set(sessions.map((session) => session.id).filter(Boolean));
    for (const session of preparedSessions) {
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
    skippedSessions: incomingSessions.length - addedSessions,
    restoredAttachmentFileCount: countRestoredBookmarkFiles(preparedBookmarks),
    restoredSessionFileCount: countRestoredSessionFiles(preparedSessions),
    warningCount: importWarnings.length,
    importWarnings
  };
}

async function restoreBookmarkFiles(bookmark, attachmentFiles, archiveDir, importWarnings) {
  const restored = { ...bookmark };
  const bundled = findAttachmentFilesForBookmark(bookmark, attachmentFiles);
  if (!bundled.length) return restored;

  const targetDir = await makeUniqueDir(
    path.join(getStorePaths().screenshotsDir, `imported-${safeFileName(bookmark.createdAt || bookmark.id || "bookmark")}`)
  );
  const attachments = getBookmarkAttachments(restored);

  for (const bundledFile of bundled) {
    const targetPath = await restoreArchiveFile({
      archiveDir,
      exportedPath: bundledFile.exportedPath,
      targetDir,
      fileName: bundledFile.originalName || path.basename(bundledFile.exportedPath || ""),
      importWarnings,
      warning: {
        type: "attachment",
        bookmarkId: bookmark.id || "",
        title: bookmark.title || "",
        attachmentId: bundledFile.id || "",
        originalName: bundledFile.originalName || ""
      }
    });
    if (!targetPath) continue;

    const attachment = attachments.find((item) => item.id && item.id === bundledFile.id)
      || attachments.find((item) => item.path && item.path === bundledFile.originalPath);
    if (attachment) attachment.path = targetPath;
    if (restored.screenshotPath && restored.screenshotPath === bundledFile.originalPath) {
      restored.screenshotPath = targetPath;
    }
  }

  restored.attachments = attachments;
  return restored;
}

async function restoreSessionFiles(session, sessionFiles, archiveDir, importWarnings) {
  const restored = { ...session };
  const bundled = findSessionFilesForSession(session, sessionFiles);
  if (!Object.keys(bundled).length) return restored;

  const targetDir = await makeUniqueDir(
    path.join(getStorePaths().sessionsDir, `imported-${safeFileName(session.startedAt || session.id || "session")}`)
  );
  const fileKeys = {
    transcript: "transcriptPath",
    structuredTranscript: "transcriptEventsPath",
    wrapUp: "wrapUpPath",
    metadata: "metadataPath"
  };

  for (const [fileType, exportedPath] of Object.entries(bundled)) {
    const targetPath = await restoreArchiveFile({
      archiveDir,
      exportedPath,
      targetDir,
      fileName: path.basename(exportedPath || ""),
      importWarnings,
      warning: {
        type: "session-file",
        sessionId: session.id || "",
        command: session.command || "",
        fileType
      }
    });
    if (targetPath && fileKeys[fileType]) {
      restored[fileKeys[fileType]] = targetPath;
    }
  }

  return restored;
}

function findAttachmentFilesForBookmark(bookmark, attachmentFiles) {
  const bookmarkName = safeFileName(`${bookmark.createdAt || "bookmark"}-${bookmark.id || bookmark.title || "unknown"}`);
  return attachmentFiles[bookmark.id] || attachmentFiles[bookmarkName] || [];
}

function findSessionFilesForSession(session, sessionFiles) {
  const sessionName = safeFileName(`${session.startedAt || "session"}-${session.id || session.command || "unknown"}`);
  return sessionFiles[session.id] || sessionFiles[sessionName] || {};
}

async function restoreArchiveFile({ archiveDir, exportedPath, targetDir, fileName, importWarnings, warning }) {
  if (!exportedPath) return null;

  try {
    const sourcePath = resolveArchivePath(archiveDir, exportedPath);
    const targetPath = await makeUniqueFilePath(targetDir, fileName || path.basename(exportedPath));
    await fs.copyFile(sourcePath, targetPath);
    return targetPath;
  } catch (error) {
    importWarnings.push({
      ...warning,
      exportedPath,
      reason: error.code || error.message || "restore failed"
    });
    return null;
  }
}

function resolveArchivePath(archiveDir, relativePath) {
  const resolvedArchiveDir = path.resolve(archiveDir);
  const resolvedPath = path.resolve(resolvedArchiveDir, relativePath);
  if (resolvedPath !== resolvedArchiveDir && !resolvedPath.startsWith(`${resolvedArchiveDir}${path.sep}`)) {
    throw new Error("archive path escapes export directory");
  }
  return resolvedPath;
}

async function makeUniqueDir(basePath) {
  for (let index = 0; index < 1000; index += 1) {
    const candidate = index === 0 ? basePath : `${basePath}-${index + 1}`;
    try {
      await fs.mkdir(candidate, { recursive: false });
      return candidate;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  throw new Error("could not create unique import directory");
}

async function makeUniqueFilePath(targetDir, fileName) {
  await fs.mkdir(targetDir, { recursive: true });
  const safeName = safeFileName(fileName || "file") || "file";
  const extension = path.extname(safeName);
  const stem = extension ? safeName.slice(0, -extension.length) : safeName;

  for (let index = 0; index < 1000; index += 1) {
    const name = index === 0 ? safeName : `${stem || "file"}-${index + 1}${extension}`;
    const candidate = path.join(targetDir, name);
    try {
      const handle = await fs.open(candidate, "wx");
      await handle.close();
      return candidate;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  throw new Error("could not create unique import file");
}

function countRestoredBookmarkFiles(bookmarks) {
  return bookmarks.reduce((count, bookmark) => {
    const attachments = Array.isArray(bookmark.attachments) ? bookmark.attachments : [];
    return count + attachments.filter((attachment) => attachment.path && isInsideStore(attachment.path)).length;
  }, 0);
}

function countRestoredSessionFiles(sessions) {
  const keys = ["transcriptPath", "transcriptEventsPath", "wrapUpPath", "metadataPath"];
  return sessions.reduce((count, session) => (
    count + keys.filter((key) => session[key] && isInsideStore(session[key])).length
  ), 0);
}

function isInsideStore(filePath) {
  const baseDir = path.resolve(getStorePaths().baseDir);
  const resolvedPath = path.resolve(filePath);
  return resolvedPath === baseDir || resolvedPath.startsWith(`${baseDir}${path.sep}`);
}

function defaultExportDir() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(getStorePaths().baseDir, "exports", `export-${stamp}`);
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function renderBookmarksMarkdown(bookmarks, attachmentFiles = {}) {
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
    const attachments = getBookmarkAttachments(bookmark);
    if (attachments.length) {
      sections.push("### Attachments");
      sections.push("");
      for (const attachment of attachments) {
        sections.push(`- ${attachment.originalName || "Attachment"}: ${attachment.path}`);
        const bundled = findBundledAttachment(bookmark, attachment, attachmentFiles);
        if (bundled) {
          sections.push(`  - Exported: ${bundled.exportedPath}`);
        }
        if (attachment.extractedText) {
          sections.push(`  - OCR/Text: ${attachment.extractedText.replace(/\n/g, " ")}`);
        }
      }
      sections.push("");
    }
  }

  return `${sections.join("\n")}\n`;
}

function renderBookmarksHtml(bookmarks, attachmentFiles = {}) {
  const exportedAt = new Date().toISOString();
  const articles = bookmarks.map((bookmark) => {
    const tags = Array.isArray(bookmark.tags) && bookmark.tags.length
      ? `<p class="tags">${escapeHtml(bookmark.tags.join(", "))}</p>`
      : "";
    const note = bookmark.note
      ? `<section><h3>Note</h3><p>${escapeHtml(bookmark.note)}</p></section>`
      : "";
    const rich = bookmark.richHtml
      ? `<iframe sandbox="" srcdoc="${escapeHtml(renderRichBookmarkFrame(bookmark.richHtml))}" title="Rich content for ${escapeHtml(bookmark.title || "bookmark")}"></iframe>`
      : `<pre>${escapeHtml(bookmark.text || "")}</pre>`;
    const attachments = renderBookmarkAttachmentsHtml(bookmark, attachmentFiles);

    return `
      <article>
        <header>
          <h2>${escapeHtml(bookmark.title || bookmark.createdAt || "Bookmark")}</h2>
          <p>Created: ${escapeHtml(bookmark.createdAt || "unknown")}</p>
          <p>Source: ${escapeHtml(bookmark.source || "quick-save")}</p>
          ${tags}
        </header>
        <section>
          <h3>Content</h3>
          ${rich}
        </section>
        ${note}
        ${attachments}
      </article>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Electric Sheep Bookmarks</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.55; }
    body { margin: 0; padding: 32px; background: Canvas; color: CanvasText; }
    main { max-width: 920px; margin: 0 auto; }
    article { border-top: 1px solid color-mix(in srgb, CanvasText 20%, transparent); padding: 28px 0; }
    h1, h2, h3 { line-height: 1.2; }
    header p, .tags { margin: 4px 0; color: color-mix(in srgb, CanvasText 70%, transparent); }
    iframe { width: 100%; min-height: 420px; border: 1px solid color-mix(in srgb, CanvasText 20%, transparent); border-radius: 8px; background: white; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; }
    ul { padding-left: 20px; }
  </style>
</head>
<body>
  <main>
    <h1>Electric Sheep Bookmarks</h1>
    <p>Exported: ${escapeHtml(exportedAt)}</p>
    ${articles || "<p>No bookmarks exported.</p>"}
  </main>
</body>
</html>
`;
}

function renderRichBookmarkFrame(richHtml) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <base target="_blank">
  <style>
    :root { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #17171f; background: #fff; line-height: 1.55; }
    body { margin: 0; padding: 20px; }
    img, svg, video { max-width: 100%; height: auto; }
    pre, code { white-space: pre-wrap; overflow-wrap: anywhere; }
    table { border-collapse: collapse; max-width: 100%; }
    td, th { border: 1px solid #d8d8e0; padding: 6px 8px; }
  </style>
</head>
<body>${richHtml}</body>
</html>`;
}

function renderBookmarkAttachmentsHtml(bookmark, attachmentFiles = {}) {
  const attachments = getBookmarkAttachments(bookmark);
  if (!attachments.length) return "";

  const items = attachments.map((attachment) => {
    const bundled = findBundledAttachment(bookmark, attachment, attachmentFiles);
    const copied = bundled ? `; exported: ${bundled.exportedPath}` : "";
    const ocr = attachment.extractedText ? `; OCR/Text: ${attachment.extractedText.replace(/\n/g, " ")}` : "";
    return `<li>${escapeHtml(attachment.originalName || "Attachment")}: ${escapeHtml(attachment.path || "")}${escapeHtml(copied)}${escapeHtml(ocr)}</li>`;
  }).join("");

  return `<section><h3>Attachments</h3><ul>${items}</ul></section>`;
}

async function renderSessionsMarkdown(sessions, sessionFiles = {}) {
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
    sections.push(`Structured transcript: ${session.transcriptEventsPath || ""}`);
    sections.push(`Wrap-up: ${session.wrapUpPath || ""}`);
    const bundled = sessionFiles[session.id] || {};
    if (Object.keys(bundled).length) {
      sections.push("Exported files:");
      if (bundled.transcript) sections.push(`- Transcript: ${bundled.transcript}`);
      if (bundled.structuredTranscript) sections.push(`- Structured transcript: ${bundled.structuredTranscript}`);
      if (bundled.wrapUp) sections.push(`- Wrap-up: ${bundled.wrapUp}`);
      if (bundled.metadata) sections.push(`- Metadata: ${bundled.metadata}`);
    }
    if (session.git) {
      sections.push(`Git root: ${session.git.root || ""}`);
      sections.push(`Git branch: ${session.git.branchBefore || ""}${session.git.branchAfter && session.git.branchAfter !== session.git.branchBefore ? ` → ${session.git.branchAfter}` : ""}`);
      sections.push(`Git commit: ${session.git.commitBefore || ""}${session.git.commitAfter && session.git.commitAfter !== session.git.commitBefore ? ` → ${session.git.commitAfter}` : ""}`);
      sections.push(`Git changed files: ${session.git.changedFileCount ?? 0}`);
      for (const file of session.git.changedFiles || []) {
        sections.push(`- ${file.status || ""} ${file.path || ""}`.trim());
      }
      if (session.git.changedFilesTruncated) sections.push("- …");
    }
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
