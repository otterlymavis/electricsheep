const captureText        = document.querySelector("#captureText");
const noteText           = document.querySelector("#noteText");
const tagInput           = document.querySelector("#tagInput");
const searchInput        = document.querySelector("#searchInput");
const bookmarkList       = document.querySelector("#bookmarkList");
const sessionList        = document.querySelector("#sessionList");
const activeTrackList    = document.querySelector("#activeTrackList");
const trackCommand       = document.querySelector("#trackCommand");
const trackCwd           = document.querySelector("#trackCwd");
const startTrack         = document.querySelector("#startTrack");
const refreshTracks      = document.querySelector("#refreshTracks");
const trackStatus        = document.querySelector("#trackStatus");
const searchResults      = document.querySelector("#searchResults");
const attachmentPreview  = document.querySelector("#attachmentPreview");
const attachmentList     = document.querySelector("#attachmentList");
const clearAttachments   = document.querySelector("#clearAttachments");
const refreshClipboard   = document.querySelector("#refreshClipboard");
const captureClipboardImage = document.querySelector("#captureClipboardImage");
const captureScreenshot  = document.querySelector("#captureScreenshot");
const importFiles        = document.querySelector("#importFiles");
const saveBookmark       = document.querySelector("#saveBookmark");
const captureStatus      = document.querySelector("#captureStatus");
const exportArchive      = document.querySelector("#exportArchive");
const importArchive      = document.querySelector("#importArchive");
const toolStatus         = document.querySelector("#toolStatus");
const settingsStatus     = document.querySelector("#settingsStatus");
const appVersion         = document.querySelector("#appVersion");
const storePath          = document.querySelector("#storePath");
const fontChoice         = document.querySelector("#fontChoice");
const readerFontChoice   = document.querySelector("#readerFontChoice");
const readerFontSize     = document.querySelector("#readerFontSize");
const readerLineHeight   = document.querySelector("#readerLineHeight");
const readerMeasure      = document.querySelector("#readerMeasure");
const readerTheme        = document.querySelector("#readerTheme");
const readerSearch       = document.querySelector("#readerSearch");
const readerList         = document.querySelector("#readerList");
const readerBody         = document.querySelector("#readerBody");
const readerPrev         = document.querySelector("#readerPrev");
const readerNext         = document.querySelector("#readerNext");
const readerCount        = document.querySelector("#readerCount");
const readerStats        = document.querySelector("#readerStats");
const readerCopy         = document.querySelector("#readerCopy");
const readerProgressBar  = document.querySelector("#readerProgressBar");
const ocrBackfill        = document.querySelector("#ocrBackfill");
const doctorCheck        = document.querySelector("#doctorCheck");
const repairLegacySessions = document.querySelector("#repairLegacySessions");
const api                = window.electricSheep;

let bookmarks         = [];
let sessions          = [];
let activeTracks      = [];
let archiveResults    = [];
let pendingAttachments = [];
let searchTimer       = null;
let selectedReaderIndex = 0;
let readerQuery = "";
let currentReaderText = "";
let currentReaderHtml = "";
let pendingClipboardHtml = "";

const FONT_STORAGE_KEY = "electricSheep.font";
const FONT_CHOICES = new Set(["inter", "lexend", "comic", "opendyslexic"]);
const READER_STORAGE_KEY = "electricSheep.reader";

function showStatus(node, msg, isError = false) {
  if (!node) return;
  node.textContent = msg;
  node.style.color = isError ? "var(--pink)" : "var(--mint)";
  node.classList.remove("hidden");
}

function clearStatus(node) {
  if (!node) return;
  node.textContent = "";
  node.classList.add("hidden");
}

function getStoredFontChoice() {
  try {
    const stored = localStorage.getItem(FONT_STORAGE_KEY);
    return FONT_CHOICES.has(stored) ? stored : "inter";
  } catch {
    return "inter";
  }
}

function applyFontChoice(value) {
  const font = FONT_CHOICES.has(value) ? value : "inter";
  document.documentElement.dataset.font = font;
  if (fontChoice) fontChoice.value = font;
  if (readerFontChoice) readerFontChoice.value = font;
  try {
    localStorage.setItem(FONT_STORAGE_KEY, font);
  } catch {}
}

applyFontChoice(getStoredFontChoice());

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getReaderSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(READER_STORAGE_KEY) || "{}");
    return {
      fontSize: clampNumber(Number(parsed.fontSize) || 18, 14, 24),
      lineHeight: ["1.45", "1.65", "1.9"].includes(parsed.lineHeight) ? parsed.lineHeight : "1.65",
      measure: clampNumber(Number(parsed.measure) || 66, 48, 84),
      theme: ["dark", "paper", "sepia"].includes(parsed.theme) ? parsed.theme : "dark"
    };
  } catch {
    return { fontSize: 18, lineHeight: "1.65", measure: 66, theme: "dark" };
  }
}

function saveReaderSettings(settings) {
  try {
    localStorage.setItem(READER_STORAGE_KEY, JSON.stringify(settings));
  } catch {}
}

function applyReaderSettings() {
  const settings = getReaderSettings();
  if (readerFontSize) readerFontSize.value = String(settings.fontSize);
  if (readerLineHeight) readerLineHeight.value = settings.lineHeight;
  if (readerMeasure) readerMeasure.value = String(settings.measure);
  if (readerTheme) readerTheme.value = settings.theme;
  if (readerBody) {
    readerBody.style.setProperty("--reader-font-size", `${settings.fontSize}px`);
    readerBody.style.setProperty("--reader-line-height", settings.lineHeight);
    readerBody.style.setProperty("--reader-measure", `${settings.measure}ch`);
    readerBody.dataset.theme = settings.theme;
  }
}

applyReaderSettings();

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

function sanitizeRichHtml(value) {
  const html = String(value || "").trim();
  if (!html) return "";

  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const node of [...doc.querySelectorAll("script, iframe, object, embed, link, meta")]) {
    node.remove();
  }

  for (const element of [...doc.body.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const attrValue = attribute.value.trim().toLowerCase();
      if (name.startsWith("on") || attrValue.startsWith("javascript:")) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  return doc.body.innerHTML.trim();
}

function normalizeClipboardPayload(payload) {
  if (typeof payload === "string") {
    return { text: payload, html: "" };
  }

  return {
    text: String(payload?.text || ""),
    html: sanitizeRichHtml(payload?.html || "")
  };
}

function setCaptureContent(payload) {
  const content = normalizeClipboardPayload(payload);
  captureText.value = content.text;
  pendingClipboardHtml = content.html;
  captureText.focus();
  updateSaveButtonState();
  showStatus(captureStatus, content.text.trim() ? "Clipboard text loaded." : "Clipboard has no text.", !content.text.trim());
}

function stripAnsi(value) {
  return String(value).replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function splitTranscriptBlocks(content) {
  const lines = stripAnsi(content).replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let buffer = [];
  let codeLanguage = "";
  let inCode = false;

  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text) {
      blocks.push({
        type: inCode ? "code" : "dialogue",
        language: inCode ? codeLanguage : "",
        text
      });
    }
    buffer = [];
  };

  for (const line of lines) {
    const fence = line.match(/^\s*```([\w.+-]*)\s*$/);
    if (fence) {
      flush();
      inCode = !inCode;
      codeLanguage = inCode ? fence[1] : "";
      continue;
    }
    buffer.push(line);
  }

  flush();
  return blocks.length > 0 ? blocks : [{ type: "dialogue", language: "", text: stripAnsi(content).trim() }];
}

function renderSeparatedTranscript(content) {
  const blocks = splitTranscriptBlocks(content);
  return `
    <div class="transcript-reader">
      ${blocks.map(block => `
        <section class="transcript-block ${block.type}">
          <div class="transcript-block-label">${block.type === "code" ? `Code${block.language ? ` · ${escapeHtml(block.language)}` : ""}` : "Dialogue"}</div>
          <pre>${escapeHtml(block.text)}</pre>
        </section>
      `).join("")}
    </div>`;
}

function parseStructuredEvents(content) {
  return String(content || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return { kind: "raw", role: "unknown", text: line };
      }
    });
}

function formatStructuredEventTitle(event) {
  const titles = {
    session_start: "Session started",
    terminal_input: "Input",
    terminal_output: "Terminal output",
    capture_update: "Screen update",
    accessibility_update: "Accessibility update",
    session_end: "Session ended",
    raw: "Raw event"
  };
  return titles[event.kind] || event.kind || "Event";
}

function renderStructuredEvents(content) {
  const events = parseStructuredEvents(content);
  if (events.length === 0) {
    return `<div class="empty-state compact">No structured events.</div>`;
  }

  return `
    <div class="event-timeline">
      ${events.map(event => {
        const detail = [
          event.role ? `role: ${event.role}` : "",
          event.source ? `source: ${event.source}` : "",
          Number.isFinite(event.lineCount) ? `${event.lineCount} lines` : "",
          Number.isFinite(event.byteLength) ? `${event.byteLength} bytes` : "",
          Number.isFinite(event.chunkCount) ? `${event.chunkCount} chunks` : "",
          Number.isFinite(event.redactionCount) && event.redactionCount > 0 ? `${event.redactionCount} redacted` : "",
          Number.isFinite(event.exitCode) ? `exit ${event.exitCode}` : "",
          Number.isFinite(event.git?.changedFileCount) ? `${event.git.changedFileCount} git files` : ""
        ].filter(Boolean).join(" · ");
        return `
          <section class="event-row ${escapeHtml(event.kind || "event")}">
            <div class="event-meta">
              <span class="event-kind">${escapeHtml(formatStructuredEventTitle(event))}</span>
              <time>${escapeHtml(event.timestamp || "")}</time>
            </div>
            ${detail ? `<p class="event-detail">${escapeHtml(detail)}</p>` : ""}
            ${event.command ? `<p class="event-command">${escapeHtml(event.command)}</p>` : ""}
            ${event.git?.changedFiles?.length ? `<p class="event-detail">${escapeHtml(event.git.changedFiles.map(file => file.path).join(", "))}${event.git.changedFilesTruncated ? "…" : ""}</p>` : ""}
            ${event.text ? `<pre>${escapeHtml(event.text)}</pre>` : ""}
          </section>`;
      }).join("")}
    </div>`;
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
  updateSaveButtonState();
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

function updateSaveButtonState() {
  if (!saveBookmark) return;
  const hasContent = captureText.value.trim() || pendingAttachments.length > 0;
  saveBookmark.disabled = !hasContent;
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
    renderReader();
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
  renderReader();
}

function getBookmarkReadingText(bookmark) {
  const attachments = normalizeAttachments(bookmark)
    .filter(a => a.extractedText)
    .map(a => `From ${a.originalName || "attachment"}:\n${a.extractedText}`);
  return [bookmark.text, bookmark.note, ...attachments]
    .map(value => String(value || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

function getBookmarkReadingHtml(bookmark) {
  const html = sanitizeRichHtml(bookmark.richHtml || "");
  if (!html) return "";

  const parts = [`<div class="reader-rich-content">${html}</div>`];
  if (bookmark.note) {
    parts.push(`<aside class="reader-note">${escapeHtml(bookmark.note)}</aside>`);
  }
  return parts.join("");
}

function getReaderItems() {
  const query = readerQuery.trim().toLowerCase();
  const items = bookmarks
    .map((bookmark, index) => ({
      bookmark,
      index,
      text: getBookmarkReadingText(bookmark),
      html: getBookmarkReadingHtml(bookmark)
    }))
    .filter(item => item.text);
  if (!query) return items;
  return items.filter(item => [
    item.bookmark.title,
    item.bookmark.note,
    item.text,
    ...(item.bookmark.tags || [])
  ].some(value => String(value || "").toLowerCase().includes(query)));
}

function getReadingStats(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.ceil(words / 220));
  return { words, minutes };
}

function renderReader() {
  if (!readerList || !readerBody) return;

  const items = getReaderItems();
  if (items.length === 0) {
    currentReaderText = "";
    currentReaderHtml = "";
    const emptyText = readerQuery.trim() ? "No saved reads match that filter." : "No readable saves yet.";
    readerList.innerHTML = `<div class="empty-state compact">${escapeHtml(emptyText)}</div>`;
    readerBody.innerHTML = `
      <div class="reader-empty">
        <h3>${readerQuery.trim() ? "No match" : "Nothing to read yet"}</h3>
        <p>${readerQuery.trim() ? "Try another word, tag, or phrase." : "Saved text, notes, and OCR text will appear here."}</p>
      </div>`;
    if (readerCount) readerCount.textContent = readerQuery.trim() ? "0 matches" : "0 saved";
    if (readerStats) readerStats.textContent = "0 words";
    if (readerProgressBar) readerProgressBar.style.width = "0%";
    if (readerPrev) readerPrev.disabled = true;
    if (readerNext) readerNext.disabled = true;
    if (readerCopy) readerCopy.disabled = true;
    applyReaderSettings();
    return;
  }

  selectedReaderIndex = clampNumber(selectedReaderIndex, 0, items.length - 1);
  const selected = items[selectedReaderIndex];
  currentReaderText = selected.text;
  currentReaderHtml = selected.html;
  const stats = getReadingStats(selected.text);
  const tags = (selected.bookmark.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("");
  const readerText = currentReaderHtml
    ? currentReaderHtml
    : escapeHtml(selected.text);

  readerList.innerHTML = items.map((item, index) => `
    <button class="reader-list-item ${index === selectedReaderIndex ? "active" : ""}" data-reader-index="${index}" type="button">
      <span>${escapeHtml(item.bookmark.title || item.text.split(/\n/)[0].slice(0, 60) || "Saved item")}</span>
      <time>${formatDate(item.bookmark.createdAt)}</time>
    </button>
  `).join("");

  readerBody.innerHTML = `
    <header class="reader-article-header">
      <time>${formatDate(selected.bookmark.createdAt)}</time>
      <h3>${escapeHtml(selected.bookmark.title || "Saved reading")}</h3>
      ${tags ? `<div class="tag-row">${tags}</div>` : ""}
    </header>
    <div class="reader-text ${currentReaderHtml ? "rich" : ""}">${readerText}</div>`;

  if (readerCount) readerCount.textContent = `${selectedReaderIndex + 1} of ${items.length}${readerQuery.trim() ? " matches" : ""}`;
  if (readerStats) readerStats.textContent = `${stats.words} words · ${stats.minutes} min`;
  if (readerProgressBar) readerProgressBar.style.width = `${((selectedReaderIndex + 1) / items.length) * 100}%`;
  if (readerPrev) readerPrev.disabled = selectedReaderIndex === 0;
  if (readerNext) readerNext.disabled = selectedReaderIndex === items.length - 1;
  if (readerCopy) readerCopy.disabled = false;
  applyReaderSettings();
}

function selectReaderItem(index) {
  selectedReaderIndex = index;
  renderReader();
}

// ── Render sessions ───────────────────────────────────────────────────────

function renderSessions() {
  renderActiveTracks();
  if (sessions.length === 0) {
    sessionList.innerHTML = `<div class="empty-state">No archived sessions yet.\nStart a tracked command above or run sheep track &lt;command&gt; in your terminal.</div>`;
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
        ${session.git ? ` · ${escapeHtml(String(session.git.changedFileCount || 0))} files changed` : ""}
      </p>
      <div class="button-row compact">
        <button class="secondary-button small-button" data-preview-wrap="${escapeHtml(session.id)}">Wrap-up</button>
        <button class="secondary-button small-button" data-preview-transcript="${escapeHtml(session.id)}">Transcript</button>
        ${session.transcriptEventsPath ? `<button class="secondary-button small-button" data-preview-events="${escapeHtml(session.id)}">Events</button>` : ""}
        <button class="primary-button small-button" data-save-wrap="${escapeHtml(session.id)}">Save wrap-up</button>
        <button class="text-button" data-delete-session="${escapeHtml(session.id)}">Delete</button>
      </div>
      <div id="preview-${escapeHtml(session.id)}" class="session-preview hidden"></div>
    </article>`
  ).join("");
}

function renderActiveTracks() {
  if (!activeTrackList) return;
  if (!activeTracks.length) {
    activeTrackList.innerHTML = "";
    return;
  }

  activeTrackList.innerHTML = activeTracks.map(track => `
    <article class="active-track-card">
      <div class="bookmark-meta">
        <time>${escapeHtml(track.startedAt || "")}</time>
        <span class="status-pill">${escapeHtml(track.status || "running")}</span>
      </div>
      <h3>${escapeHtml(track.command || "Tracked command")}</h3>
      <p class="session-summary">${escapeHtml(track.cwd || "")}${Number.isFinite(track.exitCode) ? ` · exit ${escapeHtml(String(track.exitCode))}` : ""}</p>
      ${track.output ? `<pre>${escapeHtml(track.output)}</pre>` : ""}
      ${track.status === "running" || track.status === "stopping" ? `<button class="text-button" data-stop-track="${escapeHtml(track.id)}">Stop</button>` : ""}
    </article>
  `).join("");
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
  if (!api) { renderBookmarks(); return; }
  bookmarks = await api.listBookmarks();
  renderBookmarks();
}

async function loadReader() {
  await loadBookmarks();
  renderReader();
}

async function loadSessions() {
  if (!api) { renderSessions(); return; }
  const [sessionItems, trackItems] = await Promise.all([
    api.listSessions(),
    api.listActiveTracks ? api.listActiveTracks() : []
  ]);
  sessions = sessionItems;
  activeTracks = trackItems;
  renderSessions();
}

async function runArchiveSearch() {
  const query = searchInput.value.trim();
  if (!query) { archiveResults = []; renderArchiveResults(); return; }
  if (!api) { archiveResults = []; renderArchiveResults(); return; }
  archiveResults = await api.searchArchive(query);
  renderArchiveResults();
}

// ── Expose to radial UI ───────────────────────────────────────────────────

async function loadSettings() {
  if (!api) return;
  try {
    const info = await api.getInfo();
    if (appVersion) appVersion.textContent = `v${info.version}`;
    if (storePath)  storePath.textContent  = info.storePath;
  } catch {}
}

function showSettingsStatus(msg, isError = false) {
  showStatus(settingsStatus, msg, isError);
}

ocrBackfill?.addEventListener("click", async () => {
  showSettingsStatus("Running OCR backfill…");
  try {
    const r = await api.ocrBackfill();
    showSettingsStatus(`Checked ${r.checked} · updated ${r.updated} · failed ${r.failed}`);
  } catch { showSettingsStatus("OCR backfill failed", true); }
});

doctorCheck?.addEventListener("click", async () => {
  showSettingsStatus("Running checks…");
  try {
    const checks = await api.doctorCheck();
    showSettingsStatus(checks.map(c => `${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? " — " + c.detail : ""}`).join("\n"));
  } catch { showSettingsStatus("Doctor check failed", true); }
});

repairLegacySessions?.addEventListener("click", async () => {
  showSettingsStatus("Repairing legacy logs…");
  try {
    const result = await api.repairLegacySessions();
    await loadSessions();
    const warnings = result.warningCount ? ` · ${result.warningCount} warnings` : "";
    showSettingsStatus(`Checked ${result.checked} · repaired ${result.repaired} · skipped ${result.skipped}${warnings}`);
  } catch {
    showSettingsStatus("Legacy log repair failed", true);
  }
});

function showTrackStatus(msg, isError = false) {
  showStatus(trackStatus, msg, isError);
}

startTrack?.addEventListener("click", async () => {
  if (!api?.startTrackedSession) {
    showTrackStatus("Tracking is unavailable in this build.", true);
    return;
  }

  const command = trackCommand.value.trim();
  if (!command) {
    trackCommand.focus();
    showTrackStatus("Enter a command to track.", true);
    return;
  }

  startTrack.disabled = true;
  showTrackStatus("Starting tracked command...");
  try {
    const track = await api.startTrackedSession({
      command,
      cwd: trackCwd.value.trim()
    });
    activeTracks = [track, ...activeTracks.filter(item => item.id !== track.id)];
    renderActiveTracks();
    showTrackStatus("Tracking started.");
  } catch (error) {
    showTrackStatus(error.message || "Could not start tracking.", true);
  } finally {
    startTrack.disabled = false;
  }
});

refreshTracks?.addEventListener("click", async () => {
  await loadSessions();
  showTrackStatus("Sessions refreshed.");
});

fontChoice?.addEventListener("change", () => {
  applyFontChoice(fontChoice.value);
  showSettingsStatus(`Font set to ${fontChoice.selectedOptions[0]?.textContent || "Inter"}.`);
});

readerFontChoice?.addEventListener("change", () => {
  applyFontChoice(readerFontChoice.value);
});

function updateReaderControlSettings() {
  const settings = {
    fontSize: clampNumber(Number(readerFontSize?.value) || 18, 14, 24),
    lineHeight: readerLineHeight?.value || "1.65",
    measure: clampNumber(Number(readerMeasure?.value) || 66, 48, 84),
    theme: readerTheme?.value || "dark"
  };
  saveReaderSettings(settings);
  applyReaderSettings();
}

for (const control of [readerFontSize, readerLineHeight, readerMeasure, readerTheme]) {
  control?.addEventListener("input", updateReaderControlSettings);
  control?.addEventListener("change", updateReaderControlSettings);
}

readerSearch?.addEventListener("input", () => {
  readerQuery = readerSearch.value;
  selectedReaderIndex = 0;
  renderReader();
});

readerList?.addEventListener("click", event => {
  const item = event.target.closest("[data-reader-index]");
  if (!item) return;
  selectReaderItem(Number(item.dataset.readerIndex));
});

readerPrev?.addEventListener("click", () => {
  selectReaderItem(selectedReaderIndex - 1);
});

readerNext?.addEventListener("click", () => {
  selectReaderItem(selectedReaderIndex + 1);
});

readerCopy?.addEventListener("click", async () => {
  if (!currentReaderText.trim()) return;
  readerCopy.disabled = true;
  try {
    if (api?.writeClipboardContent) {
      await api.writeClipboardContent({
        text: currentReaderText,
        html: currentReaderHtml
      });
    } else if (api?.writeClipboardText) {
      await api.writeClipboardText(currentReaderText);
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(currentReaderText);
    }
    readerCopy.textContent = "Copied";
  } catch {
    readerCopy.textContent = "Copy failed";
  } finally {
    setTimeout(() => {
      readerCopy.textContent = "Copy";
      readerCopy.disabled = !currentReaderText.trim();
    }, 900);
  }
});

document.addEventListener("keydown", event => {
  const readerPanel = document.querySelector('.reader-panel');
  if (!readerPanel || readerPanel.style.display === "none") return;
  if (event.target.matches("input, textarea, select")) return;
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    selectReaderItem(selectedReaderIndex - 1);
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    selectReaderItem(selectedReaderIndex + 1);
  }
});

window.electricSheepUI = { loadBookmarks, loadReader, loadSessions, runArchiveSearch, loadSettings };

// ── Capture panel events ──────────────────────────────────────────────────

refreshClipboard.addEventListener("click", async () => {
  clearStatus(captureStatus);
  if (!api) { showStatus(captureStatus, "Desktop bridge is unavailable.", true); return; }
  try {
    const content = api.readClipboardContent
      ? await api.readClipboardContent()
      : await api.readClipboardText();
    setCaptureContent(content);
  } catch {
    showStatus(captureStatus, "Could not read clipboard text.", true);
  }
});

captureClipboardImage.addEventListener("click", async () => {
  clearStatus(captureStatus);
  if (!api) { showStatus(captureStatus, "Desktop bridge is unavailable.", true); return; }
  try {
    const attachment = await api.readClipboardImage();
    if (!attachment) {
      showStatus(captureStatus, "Clipboard has no image.", true);
      return;
    }
    addPendingAttachment(attachment);
    showStatus(captureStatus, "Clipboard image attached.");
  } catch {
    showStatus(captureStatus, "Could not read clipboard image.", true);
  }
});

captureScreenshot.addEventListener("click", async () => {
  clearStatus(captureStatus);
  if (!api) { showStatus(captureStatus, "Desktop bridge is unavailable.", true); return; }
  try {
    addPendingAttachment(await api.captureScreenshot());
    showStatus(captureStatus, "Screenshot attached.");
  } catch {
    showStatus(captureStatus, "Screenshot failed. Check screen recording permission.", true);
  }
});

importFiles.addEventListener("click", async () => {
  clearStatus(captureStatus);
  if (!api) { showStatus(captureStatus, "Desktop bridge is unavailable.", true); return; }
  try {
    const imported = await api.importFiles();
    if (imported.text) {
      captureText.value = [captureText.value.trim(), imported.text].filter(Boolean).join("\n\n");
      pendingClipboardHtml = "";
    }
    for (const attachment of imported.attachments) addPendingAttachment(attachment);
    updateSaveButtonState();
    const count = imported.attachments.length;
    if (imported.text || count) showStatus(captureStatus, `Imported ${count} attachment${count === 1 ? "" : "s"}.`);
  } catch {
    showStatus(captureStatus, "Import failed.", true);
  }
});

clearAttachments.addEventListener("click", () => {
  clearPendingAttachments();
  showStatus(captureStatus, "Attachments cleared.");
});

captureText.addEventListener("input", () => {
  pendingClipboardHtml = "";
  updateSaveButtonState();
});

saveBookmark.addEventListener("click", async () => {
  clearStatus(captureStatus);
  const text = captureText.value.trim();
  if (!text && pendingAttachments.length === 0) {
    captureText.focus();
    showStatus(captureStatus, "Add text or an attachment first.", true);
    return;
  }

  saveBookmark.disabled = true;
  try {
    if (!api) throw new Error("Desktop bridge is unavailable.");
    await api.addBookmark({
      text,
      richHtml: pendingClipboardHtml,
      note: noteText.value,
      tags: parseTags(tagInput.value),
      source: "quick-save",
      screenshotPath: pendingAttachments.find(a => a.type === "image")?.path || "",
      attachments: pendingAttachments
    });

    captureText.value = "";
    pendingClipboardHtml = "";
    noteText.value    = "";
    tagInput.value    = "";
    clearPendingAttachments();
    await loadBookmarks();
    showStatus(captureStatus, "Saved to Library.");
  } catch {
    showStatus(captureStatus, "Save failed.", true);
  } finally {
    updateSaveButtonState();
  }
});

// ── Search events ─────────────────────────────────────────────────────────

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runArchiveSearch, 180);
});

// ── Tools events ──────────────────────────────────────────────────────────

function showToolStatus(msg) {
  showStatus(toolStatus, msg);
}

exportArchive.addEventListener("click", async () => {
  if (!api) { showToolStatus("Desktop bridge is unavailable."); return; }
  const result = await api.exportArchive();
  if (!result) return;
  const skipped = result.warningCount ? ` (${result.warningCount} skipped; see export report)` : "";
  showToolStatus(`Exported ${result.bookmarkCount} bookmarks, ${result.sessionCount} sessions, ${result.sessionFileCount || 0} session files, and ${result.attachmentFileCount || 0} attachments${skipped} to ${result.exportDir}`);
});

importArchive.addEventListener("click", async () => {
  if (!api) { showToolStatus("Desktop bridge is unavailable."); return; }
  const result = await api.importArchive();
  if (!result) return;
  await loadBookmarks();
  await loadSessions();
  const restored = `${result.restoredSessionFileCount || 0} session files, ${result.restoredAttachmentFileCount || 0} attachments`;
  const warnings = result.warningCount ? `; ${result.warningCount} restore warnings` : "";
  showToolStatus(`Imported ${result.addedBookmarks} bookmarks, ${result.addedSessions} sessions, and restored ${restored}${warnings}`);
});

// ── Bookmark list delegated events ────────────────────────────────────────

bookmarkList.addEventListener("click", async event => {
  const id = event.target.dataset.delete;
  if (!id) return;
  if (!confirm("Delete this bookmark?")) return;
  bookmarks = await api.deleteBookmark(id);
  renderBookmarks();
});

// ── Session list delegated events ─────────────────────────────────────────

sessionList.addEventListener("click", async event => {
  const wrapId       = event.target.dataset.previewWrap;
  const transcriptId = event.target.dataset.previewTranscript;
  const eventsId     = event.target.dataset.previewEvents;
  const saveWrapId   = event.target.dataset.saveWrap;
  const deleteId     = event.target.dataset.deleteSession;
  const sessionId    = wrapId || transcriptId || eventsId || saveWrapId || deleteId;
  if (!sessionId) return;

  const session = sessions.find(s => s.id === sessionId);
  if (!session) return;

  if (deleteId) {
    if (!confirm("Delete this tracked session?")) return;
    sessions = await api.deleteSession(deleteId);
    renderSessions();
    return;
  }

  if (saveWrapId) {
    const wrapUp = await api.readSessionFile(session.wrapUpPath);
    await api.addBookmark({
      title: `Wrap-up: ${session.command}`,
      text: wrapUp,
      note: "Saved from tracked terminal session.",
      tags: ["session", "wrap-up"],
      source: "session-wrap-up",
      attachments: []
    });
    await loadBookmarks();
    alert("Wrap-up saved to Library.");
    return;
  }

  const filePath = wrapId ? session.wrapUpPath : (eventsId ? session.transcriptEventsPath : session.transcriptPath);
  const content  = await api.readSessionFile(filePath);
  const preview  = document.querySelector(`#preview-${CSS.escape(session.id)}`);
  const mode = wrapId ? "wrap" : (eventsId ? "events" : "transcript");

  if (!preview.classList.contains("hidden") && preview.dataset.mode === mode) {
    preview.classList.add("hidden");
    return;
  }

  preview.dataset.mode = mode;
  preview.classList.remove("hidden");

  if (transcriptId) {
    preview.innerHTML = renderSeparatedTranscript(content);
    return;
  }

  if (eventsId) {
    preview.innerHTML = renderStructuredEvents(content);
    return;
  }

  preview.textContent = content;
});

activeTrackList?.addEventListener("click", async event => {
  const id = event.target.dataset.stopTrack;
  if (!id || !api?.stopTrackedSession) return;
  await api.stopTrackedSession(id);
  await loadSessions();
  showTrackStatus("Stop requested.");
});

// ── Global shortcut callbacks ─────────────────────────────────────────────

api?.onBookmarkAdded(() => {
  loadBookmarks();
});

api?.onClipboardCaptured(content => {
  setCaptureContent(content);
});

api?.onScreenshotCaptured(screenshot => {
  addPendingAttachment(screenshot);
});

// ── Initial load ──────────────────────────────────────────────────────────

loadBookmarks();
loadSessions();
updateSaveButtonState();

setInterval(() => {
  if (activeTracks.some(track => track.status === "running" || track.status === "stopping")) {
    loadSessions().catch(() => {});
  }
}, 1500);
