const fs = require("node:fs/promises");
const { readBookmarks, readSessions } = require("./store");
const { stripAnsi } = require("./wrapup");

async function searchArchive(query, options = {}) {
  const normalizedQuery = query.trim().toLowerCase();
  const limit = options.limit || 20;

  if (!normalizedQuery) return [];

  const [bookmarkResults, sessionResults] = await Promise.all([
    searchBookmarks(normalizedQuery),
    searchSessions(normalizedQuery)
  ]);

  return [...bookmarkResults, ...sessionResults]
    .sort((a, b) => scoreResult(b, normalizedQuery) - scoreResult(a, normalizedQuery))
    .slice(0, limit);
}

async function searchBookmarks(query) {
  const bookmarks = await readBookmarks();
  const results = [];

  for (const bookmark of bookmarks) {
    const attachments = normalizeAttachments(bookmark);
    const haystack = [
      bookmark.title || "",
      bookmark.text || "",
      htmlToSearchText(bookmark.richHtml || ""),
      bookmark.note || "",
      Array.isArray(bookmark.tags) ? bookmark.tags.join(" ") : "",
      attachments.map((attachment) => [
        attachment.originalName || "",
        attachment.extractedText || ""
      ].join(" ")).join(" ")
    ].join("\n");
    const snippet = findSnippet(haystack, query);

    if (!snippet) continue;

    results.push({
      type: "bookmark",
      id: bookmark.id,
      title: bookmark.title || firstLine(bookmark.text) || "Bookmark",
      createdAt: bookmark.createdAt || "",
      source: bookmark.source || "quick-save",
      path: "",
      snippet
    });
  }

  return results;
}

async function searchSessions(query) {
  const sessions = await readSessions();
  const results = [];

  for (const session of sessions) {
    const metadata = [
      session.command || "",
      session.status || "",
      session.startedAt || "",
      session.endedAt || "",
      session.git?.root || "",
      session.git?.branchBefore || "",
      session.git?.branchAfter || "",
      session.git?.commitBefore || "",
      session.git?.commitAfter || "",
      ...(session.git?.changedFiles || []).map(file => `${file.status || ""} ${file.path || ""}`)
    ].join("\n");
    const metadataSnippet = findSnippet(metadata, query);

    if (metadataSnippet) {
      results.push(sessionResult(session, "metadata", metadataSnippet));
      continue;
    }

    const wrapUpSnippet = await findFileSnippet(session.wrapUpPath, query);
    if (wrapUpSnippet) {
      results.push(sessionResult(session, "wrap-up", wrapUpSnippet));
      continue;
    }

    const transcriptSnippet = await findFileSnippet(session.transcriptPath, query);
    if (transcriptSnippet) {
      results.push(sessionResult(session, "transcript", transcriptSnippet));
      continue;
    }

    const structuredSnippet = await findFileSnippet(session.transcriptEventsPath, query);
    if (structuredSnippet) {
      results.push(sessionResult(session, "structured transcript", structuredSnippet));
    }
  }

  return results;
}

function sessionResult(session, source, snippet) {
  return {
    type: "session",
    id: session.id,
    title: session.command || "Tracked session",
    createdAt: session.startedAt || "",
    source,
    path: source === "transcript"
      ? session.transcriptPath
      : (source === "structured transcript" ? session.transcriptEventsPath : session.wrapUpPath),
    snippet
  };
}

async function findFileSnippet(filePath, query) {
  if (!filePath) return "";

  try {
    const content = stripAnsi(await fs.readFile(filePath, "utf8"));
    return findSnippet(content, query);
  } catch {
    return "";
  }
}

function findSnippet(value, query) {
  const normalizedValue = stripAnsi(String(value || ""));
  const lowerValue = normalizedValue.toLowerCase();
  const index = lowerValue.indexOf(query);

  if (index === -1) return "";

  const start = Math.max(0, index - 90);
  const end = Math.min(normalizedValue.length, index + query.length + 140);
  return normalizedValue
    .slice(start, end)
    .replace(/\s+/g, " ")
    .trim();
}

function htmlToSearchText(value) {
  return String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#039;|&apos;/gi, "'");
}

function scoreResult(result, query) {
  const title = result.title.toLowerCase();
  const snippet = result.snippet.toLowerCase();
  let score = 0;
  if (title.includes(query)) score += 10;
  if (snippet.includes(query)) score += 5;
  if (result.type === "bookmark") score += 2;
  return score;
}

function normalizeAttachments(bookmark) {
  const attachments = Array.isArray(bookmark.attachments) ? [...bookmark.attachments] : [];

  if (bookmark.screenshotPath && !attachments.some((attachment) => attachment.path === bookmark.screenshotPath)) {
    attachments.push({
      type: "image",
      path: bookmark.screenshotPath,
      originalName: "Screenshot",
      extractedText: ""
    });
  }

  return attachments;
}

function firstLine(value) {
  return String(value || "").split(/\r?\n/).find(Boolean)?.slice(0, 80) || "";
}

module.exports = {
  searchArchive
};
