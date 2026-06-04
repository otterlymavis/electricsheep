const captureText        = document.querySelector("#captureText");
const noteText           = document.querySelector("#noteText");
const tagInput           = document.querySelector("#tagInput");
const searchInput        = document.querySelector("#searchInput");
const bookmarkList       = document.querySelector("#bookmarkList");
const sessionList        = document.querySelector("#sessionList");
const searchResults      = document.querySelector("#searchResults");
const attachmentPreview  = document.querySelector("#attachmentPreview");
const attachmentList     = document.querySelector("#attachmentList");
const clearAttachments   = document.querySelector("#clearAttachments");
const refreshClipboard   = document.querySelector("#refreshClipboard");
const captureClipboardImage = document.querySelector("#captureClipboardImage");
const captureScreenshot  = document.querySelector("#captureScreenshot");
const importFiles        = document.querySelector("#importFiles");
const saveBookmark       = document.querySelector("#saveBookmark");
const exportArchive      = document.querySelector("#exportArchive");
const importArchive      = document.querySelector("#importArchive");
const toolStatus         = document.querySelector("#toolStatus");
const settingsStatus     = document.querySelector("#settingsStatus");
const appVersion         = document.querySelector("#appVersion");
const storePath          = document.querySelector("#storePath");
const ocrBackfill        = document.querySelector("#ocrBackfill");
const doctorCheck        = document.querySelector("#doctorCheck");

let bookmarks         = [];
let sessions          = [];
let archiveResults    = [];
let pendingAttachments = [];
let searchTimer       = null;

// ── Helpers ──────────────────────────────────────────────────────────────

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function parseTags(value) {
  return value.split(",").map(t => t.trim()).filter(Boolean);
}

function getFileUrl(filePath) {
  return filePath ? `file://${filePath}` : "";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[c]);
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m === 0 ? `${s}s` : `${m}m ${s % 60}s`;
}

// ── Attachments ──────────────────────────────────────────────────────────

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
    .map(a => renderAttachment(a, "pending"))
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
      </figure>`;
  }
  return `
    <div class="attachment ${variant}">
      <span class="file-badge">TXT</span>
      <span>${name}</span>
    </div>`;
}

function getOcrStatusLabel(attachment) {
  if (attachment.ocrStatus === "processed") return "Text found";
  if (attachment.ocrStatus === "empty")     return "No text";
  if (attachment.ocrStatus === "failed")    return "OCR unavailable";
  return "Not processed";
}

function normalizeAttachments(bookmark) {
  const list = Array.isArray(bookmark.attachments) ? [...bookmark.attachments] : [];
  if (bookmark.screenshotPath && !list.some(a => a.path === bookmark.screenshotPath)) {
    list.push({
      id: `${bookmark.id}-legacy-screenshot`,
      type: "image",
      path: bookmark.screenshotPath,
      originalName: "Screenshot",
      extractedText: "",
      createdAt: bookmark.createdAt
    });
  }
  return list;
}

// ── Render bookmarks ──────────────────────────────────────────────────────

function renderBookmarks() {
  if (bookmarks.length === 0) {
    bookmarkList.innerHTML = `<div class="empty-state">Nothing saved yet.\nUse Save to capture your first snippet.</div>`;
    return;
  }

  bookmarkList.innerHTML = bookmarks.map(bookmark => {
    const tags = (bookmark.tags || [])
      .map(t => `<span class="tag">${escapeHtml(t)}</span>`)
      .join("");
    const attachments = normalizeAttachments(bookmark)
      .map(a => renderAttachment(a, "bookmark"))
      .join("");

    return `
      <article class="bookmark-card">
        <div class="bookmark-meta">
          <time>${formatDate(bookmark.createdAt)}</time>
          <button class="text-button" data-delete="${bookmark.id}">Delete</button>
        </div>
        ${bookmark.title  ? `<h3>${escapeHtml(bookmark.title)}</h3>` : ""}
        ${bookmark.text   ? `<p class="bookmark-text">${escapeHtml(bookmark.text)}</p>` : ""}
        ${bookmark.note   ? `<p class="bookmark-note">${escapeHtml(bookmark.note)}</p>` : ""}
        ${attachments     ? `<div class="attachment-list">${attachments}</div>` : ""}
        ${tags            ? `<div class="tag-row">${tags}</div>` : ""}
      </article>`;
  }).join("");
}

// ── Render sessions ───────────────────────────────────────────────────────

function renderSessions() {
  if (sessions.length === 0) {
    sessionList.innerHTML = `<div class="empty-state">No sessions yet.\nRun sheep track &lt;command&gt; in your terminal to start recording.</div>`;
    return;
  }

  sessionList.innerHTML = sessions.map(session => `
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
    </article>`
  ).join("");
}

// ── Render archive search results ─────────────────────────────────────────

function renderArchiveResults() {
  if (!searchInput.value.trim()) {
    searchResults.innerHTML = `<div class="empty-state">Enter a search term.</div>`;
    return;
  }
  if (archiveResults.length === 0) {
    searchResults.innerHTML = `<div class="empty-state">No matches.</div>`;
    return;
  }
  searchResults.innerHTML = archiveResults.map(result => `
    <article class="bookmark-card">
      <div class="bookmark-meta">
        <time>${escapeHtml(result.createdAt || "unknown")}</time>
        <span class="status-pill">${escapeHtml(result.type)}</span>
      </div>
      <h3>${escapeHtml(result.title || "Result")}</h3>
      <p class="session-summary">${escapeHtml(result.source || "")}${result.path ? ` · ${escapeHtml(result.path)}` : ""}</p>
      <p class="bookmark-text">${escapeHtml(result.snippet || "")}</p>
    </article>`
  ).join("");
}

// ── Load data ─────────────────────────────────────────────────────────────

async function loadBookmarks() {
  bookmarks = await window.electricSheep.listBookmarks();
  renderBookmarks();
}

async function loadSessions() {
  sessions = await window.electricSheep.listSessions();
  renderSessions();
}

async function runArchiveSearch() {
  const query = searchInput.value.trim();
  if (!query) { archiveResults = []; renderArchiveResults(); return; }
  archiveResults = await window.electricSheep.searchArchive(query);
  renderArchiveResults();
}

// ── Expose to radial UI ───────────────────────────────────────────────────

async function loadSettings() {
  try {
    const info = await window.electricSheep.getInfo();
    if (appVersion) appVersion.textContent = `v${info.version}`;
    if (storePath)  storePath.textContent  = info.storePath;
  } catch {}
}

function showSettingsStatus(msg, isError = false) {
  settingsStatus.textContent = msg;
  settingsStatus.style.color = isError ? "var(--pink)" : "var(--mint)";
  settingsStatus.classList.remove("hidden");
}

ocrBackfill?.addEventListener("click", async () => {
  showSettingsStatus("Running OCR backfill…");
  try {
    const r = await window.electricSheep.ocrBackfill();
    showSettingsStatus(`Checked ${r.checked} · updated ${r.updated} · failed ${r.failed}`);
  } catch { showSettingsStatus("OCR backfill failed", true); }
});

doctorCheck?.addEventListener("click", async () => {
  showSettingsStatus("Running checks…");
  try {
    const checks = await window.electricSheep.doctorCheck();
    showSettingsStatus(checks.map(c => `${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? " — " + c.detail : ""}`).join("\n"));
  } catch { showSettingsStatus("Doctor check failed", true); }
});

window.electricSheepUI = { loadBookmarks, loadSessions, runArchiveSearch, loadSettings };

// ── Capture panel events ──────────────────────────────────────────────────

refreshClipboard.addEventListener("click", async () => {
  captureText.value = await window.electricSheep.readClipboardText();
  captureText.focus();
});

captureClipboardImage.addEventListener("click", async () => {
  addPendingAttachment(await window.electricSheep.readClipboardImage());
});

captureScreenshot.addEventListener("click", async () => {
  addPendingAttachment(await window.electricSheep.captureScreenshot());
});

importFiles.addEventListener("click", async () => {
  const imported = await window.electricSheep.importFiles();
  if (imported.text) {
    captureText.value = [captureText.value.trim(), imported.text].filter(Boolean).join("\n\n");
  }
  for (const attachment of imported.attachments) addPendingAttachment(attachment);
});

clearAttachments.addEventListener("click", clearPendingAttachments);

saveBookmark.addEventListener("click", async () => {
  const text = captureText.value.trim();
  if (!text && pendingAttachments.length === 0) { captureText.focus(); return; }

  await window.electricSheep.addBookmark({
    text,
    note: noteText.value,
    tags: parseTags(tagInput.value),
    source: "quick-save",
    screenshotPath: pendingAttachments.find(a => a.type === "image")?.path || "",
    attachments: pendingAttachments
  });

  captureText.value = "";
  noteText.value    = "";
  tagInput.value    = "";
  clearPendingAttachments();
  await loadBookmarks();
});

// ── Search events ─────────────────────────────────────────────────────────

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runArchiveSearch, 180);
});

// ── Tools events ──────────────────────────────────────────────────────────

function showToolStatus(msg) {
  toolStatus.textContent = msg;
  toolStatus.classList.remove("hidden");
}

exportArchive.addEventListener("click", async () => {
  const result = await window.electricSheep.exportArchive();
  if (!result) return;
  showToolStatus(`Exported to ${result.exportDir}`);
});

importArchive.addEventListener("click", async () => {
  const result = await window.electricSheep.importArchive();
  if (!result) return;
  await loadBookmarks();
  await loadSessions();
  showToolStatus(`Imported ${result.addedBookmarks} bookmarks, ${result.addedSessions} sessions`);
});

// ── Bookmark list delegated events ────────────────────────────────────────

bookmarkList.addEventListener("click", async event => {
  const id = event.target.dataset.delete;
  if (!id) return;
  bookmarks = await window.electricSheep.deleteBookmark(id);
  renderBookmarks();
});

// ── Session list delegated events ─────────────────────────────────────────

sessionList.addEventListener("click", async event => {
  const wrapId       = event.target.dataset.previewWrap;
  const transcriptId = event.target.dataset.previewTranscript;
  const saveWrapId   = event.target.dataset.saveWrap;
  const deleteId     = event.target.dataset.deleteSession;
  const sessionId    = wrapId || transcriptId || saveWrapId || deleteId;
  if (!sessionId) return;

  const session = sessions.find(s => s.id === sessionId);
  if (!session) return;

  if (deleteId) {
    sessions = await window.electricSheep.deleteSession(deleteId);
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
    return;
  }

  const filePath = wrapId ? session.wrapUpPath : session.transcriptPath;
  const content  = await window.electricSheep.readSessionFile(filePath);
  const preview  = document.querySelector(`#preview-${CSS.escape(session.id)}`);
  preview.textContent = content;
  preview.classList.toggle("hidden");
});

// ── Global shortcut callbacks ─────────────────────────────────────────────

window.electricSheep.onClipboardCaptured(text => {
  captureText.value = text;
  captureText.focus();
});

window.electricSheep.onScreenshotCaptured(screenshot => {
  addPendingAttachment(screenshot);
});

// ── Initial load ──────────────────────────────────────────────────────────

loadBookmarks();
loadSessions();
