const fs = require("node:fs/promises");
const { readBookmarks, readSessions } = require("./store");

const LARGE_TRANSCRIPT_BYTES = 5 * 1024 * 1024;

async function auditArchiveHealth() {
  const bookmarks = await readBookmarks();
  const sessions = await readSessions();
  const missingFiles = [];
  let imageOcrBacklog = 0;
  let sessionsWithoutStructuredTranscript = 0;
  let largeTranscripts = 0;

  for (const bookmark of bookmarks) {
    for (const attachment of getBookmarkAttachments(bookmark)) {
      if (!attachment.path) {
        missingFiles.push(`bookmark ${bookmark.id || bookmark.title || "unknown"} attachment missing path`);
        continue;
      }

      if (attachment.type === "image" && !["processed", "empty"].includes(attachment.ocrStatus)) {
        imageOcrBacklog += 1;
      }

      if (!(await fileExists(attachment.path))) {
        missingFiles.push(`bookmark ${bookmark.id || bookmark.title || "unknown"} attachment ${attachment.originalName || attachment.path}`);
      }
    }
  }

  for (const session of sessions) {
    await checkSessionFile(session, "transcriptPath", "transcript", missingFiles);
    await checkSessionFile(session, "wrapUpPath", "wrap-up", missingFiles);
    await checkSessionFile(session, "metadataPath", "metadata", missingFiles);

    if (!session.transcriptEventsPath) {
      sessionsWithoutStructuredTranscript += 1;
    } else {
      await checkSessionFile(session, "transcriptEventsPath", "structured transcript", missingFiles);
    }

    if (session.transcriptPath) {
      const size = await fileSize(session.transcriptPath);
      if (size > LARGE_TRANSCRIPT_BYTES) largeTranscripts += 1;
    }
  }

  return [
    {
      name: "Archive records",
      ok: true,
      detail: `${bookmarks.length} bookmarks · ${sessions.length} sessions`
    },
    {
      name: "Referenced files",
      ok: missingFiles.length === 0,
      detail: missingFiles.length ? summarizeList(missingFiles) : "all reachable"
    },
    {
      name: "OCR backlog",
      ok: imageOcrBacklog === 0,
      detail: imageOcrBacklog ? `${imageOcrBacklog} image attachments need OCR` : "clear"
    },
    {
      name: "Structured transcripts",
      ok: sessionsWithoutStructuredTranscript === 0,
      detail: sessionsWithoutStructuredTranscript ? `${sessionsWithoutStructuredTranscript} sessions use legacy transcript-only format` : "present"
    },
    {
      name: "Large transcripts",
      ok: largeTranscripts === 0,
      detail: largeTranscripts ? `${largeTranscripts} transcripts exceed ${formatBytes(LARGE_TRANSCRIPT_BYTES)}` : "none"
    }
  ];
}

function getBookmarkAttachments(bookmark) {
  const attachments = Array.isArray(bookmark.attachments) ? [...bookmark.attachments] : [];
  if (bookmark.screenshotPath && !attachments.some((attachment) => attachment.path === bookmark.screenshotPath)) {
    attachments.push({
      id: `${bookmark.id || "bookmark"}-screenshot`,
      type: "image",
      path: bookmark.screenshotPath,
      originalName: "Screenshot",
      ocrStatus: "unknown"
    });
  }
  return attachments;
}

async function checkSessionFile(session, key, label, missingFiles) {
  if (!session[key]) return;
  if (!(await fileExists(session[key]))) {
    missingFiles.push(`session ${session.id || session.command || "unknown"} ${label}`);
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fileSize(filePath) {
  try {
    return (await fs.stat(filePath)).size;
  } catch {
    return 0;
  }
}

function summarizeList(items) {
  const shown = items.slice(0, 3).join("; ");
  return items.length > 3 ? `${shown}; +${items.length - 3} more` : shown;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

module.exports = {
  auditArchiveHealth
};
