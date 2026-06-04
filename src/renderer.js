const captureText = document.querySelector("#captureText");
const noteText = document.querySelector("#noteText");
const tagInput = document.querySelector("#tagInput");
const searchInput = document.querySelector("#searchInput");
const bookmarkList = document.querySelector("#bookmarkList");
const sessionList = document.querySelector("#sessionList");
const searchResults = document.querySelector("#searchResults");
const attachmentPreview = document.querySelector("#attachmentPreview");
const attachmentList = document.querySelector("#attachmentList");
const clearAttachments = document.querySelector("#clearAttachments");
const refreshClipboard = document.querySelector("#refreshClipboard");
const captureClipboardImage = document.querySelector("#captureClipboardImage");
const captureScreenshot = document.querySelector("#captureScreenshot");
const importFiles = document.querySelector("#importFiles");
const saveBookmark = document.querySelector("#saveBookmark");
const bookmarksTab = document.querySelector("#bookmarksTab");
const sessionsTab = document.querySelector("#sessionsTab");
const searchTab = document.querySelector("#searchTab");
const exportArchive = document.querySelector("#exportArchive");
const importArchive = document.querySelector("#importArchive");

let bookmarks = [];
let sessions = [];
let archiveResults = [];
let pendingAttachments = [];
let activeView = "bookmarks";
let searchTimer = null;

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function parseTags(value) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function getFileUrl(path) {
  return path ? `file://${path}` : "";
}

function addPendingAttachment(attachment) {
  if (!attachment) return;
  pendingAttachments.push(attachment);
  renderPendingAttachments();
}

function clearPendingAttachments() {
  pendingAttachments = [];
  renderPendingAttachments();
}

function renderPendingAttachments() {
  if (pendingAttachments.length === 0) {
    attachmentPreview.classList.add("hidden");
    attachmentList.innerHTML = "";
    return;
  }

  attachmentPreview.classList.remove("hidden");
  attachmentList.innerHTML = pendingAttachments
    .map((attachment) => renderAttachment(attachment, "pending"))
    .join("");
}

function renderBookmarks() {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = bookmarks.filter((bookmark) => {
    const attachments = normalizeAttachments(bookmark);
    const haystack = [
      bookmark.title || "",
      bookmark.text || "",
      bookmark.note || "",
      (bookmark.tags || []).join(" "),
      attachments.map((attachment) => `${attachment.originalName || ""} ${attachment.extractedText || ""}`).join(" ")
    ].join(" ").toLowerCase();

    return haystack.includes(query);
  });

  if (filtered.length === 0) {
    bookmarkList.innerHTML = `<div class="empty-state">No bookmarks yet.</div>`;
    return;
  }

  bookmarkList.innerHTML = filtered
    .map((bookmark) => {
      const tags = (bookmark.tags || [])
        .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
        .join("");
      const attachments = normalizeAttachments(bookmark)
        .map((attachment) => renderAttachment(attachment, "bookmark"))
        .join("");

      return `
        <article class="bookmark-card">
          <div class="bookmark-meta">
            <time>${formatDate(bookmark.createdAt)}</time>
            <button class="text-button" data-delete="${bookmark.id}">Delete</button>
          </div>
          ${bookmark.title ? `<h3>${escapeHtml(bookmark.title)}</h3>` : ""}
          ${bookmark.text ? `<p class="bookmark-text">${escapeHtml(bookmark.text)}</p>` : ""}
          ${bookmark.note ? `<p class="bookmark-note">${escapeHtml(bookmark.note)}</p>` : ""}
          ${attachments ? `<div class="attachment-list">${attachments}</div>` : ""}
          ${tags ? `<div class="tag-row">${tags}</div>` : ""}
        </article>
      `;
    })
    .join("");
}

function renderSessions() {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = sessions.filter((session) => {
    return [
      session.command || "",
      session.status || "",
      session.startedAt || "",
      session.wrapUpPath || "",
      session.transcriptPath || ""
    ].join(" ").toLowerCase().includes(query);
  });

  if (filtered.length === 0) {
    sessionList.innerHTML = `<div class="empty-state">No tracked sessions yet.</div>`;
    return;
  }

  sessionList.innerHTML = filtered
    .map((session) => `
      <article class="bookmark-card session-card">
        <div class="bookmark-meta">
          <time>${formatDate(session.startedAt)}</time>
          <span class="status-pill">${escapeHtml(session.status || "tracked")}</span>
        </div>
        <h3>${escapeHtml(session.command || "Tracked session")}</h3>
        <p class="session-summary">
          ${escapeHtml(formatDuration(session.durationMs))} · ${escapeHtml(String(session.lineCount || 0))} lines · exit ${escapeHtml(String(session.exitCode ?? "unknown"))}
        </p>
        <div class="button-row compact">
          <button class="secondary-button small-button" data-preview-wrap="${escapeHtml(session.id)}">Wrap-up</button>
          <button class="secondary-button small-button" data-preview-transcript="${escapeHtml(session.id)}">Transcript</button>
          <button class="primary-button small-button" data-save-wrap="${escapeHtml(session.id)}">Save wrap-up</button>
          <button class="text-button" data-delete-session="${escapeHtml(session.id)}">Delete</button>
        </div>
        <pre id="preview-${escapeHtml(session.id)}" class="session-preview hidden"></pre>
      </article>
    `)
    .join("");
}

function renderAttachment(attachment, variant) {
  const name = escapeHtml(attachment.originalName || "Attachment");
  if (attachment.type === "image") {
    const status = getOcrStatusLabel(attachment);
    return `
      <figure class="attachment ${variant}">
        <img src="${attachment.url || getFileUrl(attachment.path)}" alt="${name}" />
        <figcaption>
          <span>${name}</span>
          <span class="ocr-status ${escapeHtml(attachment.ocrStatus || "unknown")}">${status}</span>
        </figcaption>
      </figure>
    `;
  }

  return `
    <div class="attachment ${variant}">
      <span class="file-badge">TXT</span>
      <span>${name}</span>
    </div>
  `;
}

function getOcrStatusLabel(attachment) {
  if (attachment.ocrStatus === "processed") return "Text found";
  if (attachment.ocrStatus === "empty") return "No text";
  if (attachment.ocrStatus === "failed") return "OCR unavailable";
  return "Not processed";
}

function normalizeAttachments(bookmark) {
  const attachments = Array.isArray(bookmark.attachments) ? [...bookmark.attachments] : [];
  if (bookmark.screenshotPath && !attachments.some((attachment) => attachment.path === bookmark.screenshotPath)) {
    attachments.push({
      id: `${bookmark.id}-legacy-screenshot`,
      type: "image",
      path: bookmark.screenshotPath,
      originalName: "Screenshot",
      extractedText: "",
      createdAt: bookmark.createdAt
    });
  }
  return attachments;
}

function renderActiveView() {
  if (activeView === "bookmarks") {
    bookmarkList.classList.remove("hidden");
    sessionList.classList.add("hidden");
    searchResults.classList.add("hidden");
    renderBookmarks();
    return;
  }

  if (activeView === "sessions") {
    bookmarkList.classList.add("hidden");
    sessionList.classList.remove("hidden");
    searchResults.classList.add("hidden");
    renderSessions();
    return;
  }

  bookmarkList.classList.add("hidden");
  sessionList.classList.add("hidden");
  searchResults.classList.remove("hidden");
  renderArchiveResults();
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return entities[character];
  });
}

async function loadBookmarks() {
  bookmarks = await window.electricSheep.listBookmarks();
  renderActiveView();
}

async function loadSessions() {
  sessions = await window.electricSheep.listSessions();
  renderActiveView();
}

refreshClipboard.addEventListener("click", async () => {
  captureText.value = await window.electricSheep.readClipboardText();
  captureText.focus();
});

captureClipboardImage.addEventListener("click", async () => {
  const attachment = await window.electricSheep.readClipboardImage();
  addPendingAttachment(attachment);
});

captureScreenshot.addEventListener("click", async () => {
  const screenshot = await window.electricSheep.captureScreenshot();
  addPendingAttachment(screenshot);
});

importFiles.addEventListener("click", async () => {
  const imported = await window.electricSheep.importFiles();
  if (imported.text) {
    captureText.value = [captureText.value.trim(), imported.text].filter(Boolean).join("\n\n");
  }
  for (const attachment of imported.attachments) {
    addPendingAttachment(attachment);
  }
});

clearAttachments.addEventListener("click", clearPendingAttachments);

saveBookmark.addEventListener("click", async () => {
  const text = captureText.value.trim();

  if (!text && pendingAttachments.length === 0) {
    captureText.focus();
    return;
  }

  await window.electricSheep.addBookmark({
    text,
    note: noteText.value,
    tags: parseTags(tagInput.value),
    source: "quick-save",
    screenshotPath: pendingAttachments.find((attachment) => attachment.type === "image")?.path || "",
    attachments: pendingAttachments
  });

  captureText.value = "";
  noteText.value = "";
  tagInput.value = "";
  clearPendingAttachments();
  await loadBookmarks();
});

searchInput.addEventListener("input", () => {
  if (activeView !== "search") {
    renderActiveView();
    return;
  }

  clearTimeout(searchTimer);
  searchTimer = setTimeout(runArchiveSearch, 180);
});

bookmarksTab.addEventListener("click", () => {
  setActiveView("bookmarks");
});

sessionsTab.addEventListener("click", async () => {
  setActiveView("sessions");
  await loadSessions();
});

searchTab.addEventListener("click", async () => {
  setActiveView("search");
  await runArchiveSearch();
});

exportArchive.addEventListener("click", async () => {
  const result = await window.electricSheep.exportArchive();
  if (!result) return;
  searchInput.value = `Exported to ${result.exportDir}`;
});

importArchive.addEventListener("click", async () => {
  const result = await window.electricSheep.importArchive();
  if (!result) return;
  await loadBookmarks();
  await loadSessions();
  searchInput.value = `Imported ${result.addedBookmarks} bookmarks, ${result.addedSessions} sessions`;
});

bookmarkList.addEventListener("click", async (event) => {
  const deleteId = event.target.dataset.delete;
  if (!deleteId) return;

  bookmarks = await window.electricSheep.deleteBookmark(deleteId);
  renderBookmarks();
});

sessionList.addEventListener("click", async (event) => {
  const wrapId = event.target.dataset.previewWrap;
  const transcriptId = event.target.dataset.previewTranscript;
  const saveWrapId = event.target.dataset.saveWrap;
  const deleteSessionId = event.target.dataset.deleteSession;
  const sessionId = wrapId || transcriptId || saveWrapId || deleteSessionId;
  if (!sessionId) return;

  const session = sessions.find((item) => item.id === sessionId);
  if (!session) return;

  if (deleteSessionId) {
    sessions = await window.electricSheep.deleteSession(deleteSessionId);
    renderSessions();
    return;
  }

  if (saveWrapId) {
    const wrapUp = await window.electricSheep.readSessionFile(session.wrapUpPath);
    await window.electricSheep.addBookmark({
      title: `Wrap-up: ${session.command}`,
      text: wrapUp,
      note: "Saved from tracked terminal session.",
      tags: ["session", "wrap-up"],
      source: "session-wrap-up",
      attachments: []
    });
    await loadBookmarks();
    setActiveView("bookmarks");
    renderActiveView();
    return;
  }

  const filePath = wrapId ? session.wrapUpPath : session.transcriptPath;
  const content = await window.electricSheep.readSessionFile(filePath);
  const preview = document.querySelector(`#preview-${CSS.escape(session.id)}`);
  preview.textContent = content;
  preview.classList.toggle("hidden");
});

window.electricSheep.onClipboardCaptured((text) => {
  captureText.value = text;
  captureText.focus();
});

window.electricSheep.onScreenshotCaptured((screenshot) => {
  addPendingAttachment(screenshot);
});

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "unknown";
  const seconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) return `${remainingSeconds}s`;
  return `${minutes}m ${remainingSeconds}s`;
}

function setActiveView(view) {
  activeView = view;
  bookmarksTab.classList.toggle("active", view === "bookmarks");
  sessionsTab.classList.toggle("active", view === "sessions");
  searchTab.classList.toggle("active", view === "search");
  renderActiveView();
}

async function runArchiveSearch() {
  const query = searchInput.value.trim();

  if (!query) {
    archiveResults = [];
    renderArchiveResults();
    return;
  }

  archiveResults = await window.electricSheep.searchArchive(query);
  renderArchiveResults();
}

function renderArchiveResults() {
  if (!searchInput.value.trim()) {
    searchResults.innerHTML = `<div class="empty-state">Enter a search term.</div>`;
    return;
  }

  if (archiveResults.length === 0) {
    searchResults.innerHTML = `<div class="empty-state">No matches.</div>`;
    return;
  }

  searchResults.innerHTML = archiveResults
    .map((result) => `
      <article class="bookmark-card">
        <div class="bookmark-meta">
          <time>${escapeHtml(result.createdAt || "unknown")}</time>
          <span class="status-pill">${escapeHtml(result.type)}</span>
        </div>
        <h3>${escapeHtml(result.title || "Result")}</h3>
        <p class="session-summary">${escapeHtml(result.source || "")}${result.path ? ` · ${escapeHtml(result.path)}` : ""}</p>
        <p class="bookmark-text">${escapeHtml(result.snippet || "")}</p>
      </article>
    `)
    .join("");
}

loadBookmarks();
loadSessions();
