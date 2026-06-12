const STORAGE_KEY = "electricLamb.bookmarks";
const SETTINGS_KEY = "electricLamb.reader";

const titleInput = document.querySelector("#titleInput");
const textInput = document.querySelector("#textInput");
const tagInput = document.querySelector("#tagInput");
const noteInput = document.querySelector("#noteInput");
const saveButton = document.querySelector("#saveButton");
const pasteButton = document.querySelector("#pasteButton");
const importTextButton = document.querySelector("#importTextButton");
const textFileInput = document.querySelector("#textFileInput");
const clearButton = document.querySelector("#clearButton");
const statusLine = document.querySelector("#statusLine");
const searchInput = document.querySelector("#searchInput");
const bookmarkList = document.querySelector("#bookmarkList");
const readerBody = document.querySelector("#readerBody");
const importButton = document.querySelector("#importButton");
const importFile = document.querySelector("#importFile");
const exportJsonButton = document.querySelector("#exportJsonButton");
const exportMarkdownButton = document.querySelector("#exportMarkdownButton");
const exportHtmlButton = document.querySelector("#exportHtmlButton");
const fontSizeInput = document.querySelector("#fontSizeInput");
const measureInput = document.querySelector("#measureInput");
const themeInput = document.querySelector("#themeInput");
const modeLabel = document.querySelector("#modeLabel");
const companionTitle = document.querySelector("#companionTitle");
const companionText = document.querySelector("#companionText");
const sessionList = document.querySelector("#sessionList");
const refreshSessionsButton = document.querySelector("#refreshSessionsButton");
const sessionPreview = document.querySelector("#sessionPreview");
const doctorButton = document.querySelector("#doctorButton");
const repairButton = document.querySelector("#repairButton");
const fullExportButton = document.querySelector("#fullExportButton");
const nativeStatus = document.querySelector("#nativeStatus");

let bookmarks = loadLocalBookmarks();
let sessions = [];
let selectedId = bookmarks[0]?.id || "";
let companionEnabled = false;
let archiveResults = [];

function loadLocalBookmarks() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalBookmarks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    fontSize: Number(fontSizeInput.value),
    measure: Number(measureInput.value),
    theme: themeInput.value
  }));
}

function applySettings() {
  readerBody.style.setProperty("--reader-font-size", `${fontSizeInput.value}px`);
  readerBody.style.setProperty("--reader-measure", `${measureInput.value}ch`);
  readerBody.dataset.theme = themeInput.value;
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
}

async function detectCompanion() {
  if (!["http:", "https:"].includes(location.protocol)) return false;
  try {
    const info = await apiJson("/api/info");
    companionEnabled = info?.app === "Electric Lamb";
  } catch {
    companionEnabled = false;
  }
  renderCompanionState();
  return companionEnabled;
}

function renderCompanionState() {
  if (companionEnabled) {
    modeLabel.textContent = "Companion mode";
    companionTitle.textContent = "Native companion connected";
    companionText.textContent = "Bookmarks and sessions are read from the Electric Sheep store. Track terminals with the Lamb command below.";
    for (const button of [doctorButton, repairButton, fullExportButton, refreshSessionsButton]) button.disabled = false;
    return;
  }

  modeLabel.textContent = "Local browser edition";
  companionTitle.textContent = "Browser-only mode";
  companionText.textContent = "Bookmarks are stored in this browser. Start the Lamb companion for shared store access and tracked sessions.";
  for (const button of [doctorButton, repairButton, fullExportButton, refreshSessionsButton]) button.disabled = true;
}

async function refreshFromCompanion() {
  if (!companionEnabled) return;
  const data = await apiJson("/api/library");
  bookmarks = Array.isArray(data.bookmarks) ? data.bookmarks : [];
  sessions = Array.isArray(data.sessions) ? data.sessions : [];
  selectedId = bookmarks[0]?.id || "";
}

function parseTags(value) {
  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[char]);
}

function firstLine(value) {
  return String(value || "").split(/\r?\n/).find(Boolean)?.slice(0, 72) || "Untitled save";
}

function formatDate(value) {
  if (!value) return "unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function showStatus(message, isError = false) {
  statusLine.textContent = message;
  statusLine.style.color = isError ? "var(--danger)" : "var(--accent-2)";
}

function showNativeStatus(message, isError = false) {
  nativeStatus.textContent = message;
  nativeStatus.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function getFilteredBookmarks() {
  const query = searchInput.value.trim().toLowerCase();
  if (!query) return bookmarks;

  return bookmarks.filter((bookmark) => [
    bookmark.title,
    bookmark.text,
    bookmark.richHtml,
    bookmark.note,
    ...(bookmark.tags || [])
  ].some((value) => String(value || "").toLowerCase().includes(query)));
}

function getFilteredSessions() {
  const query = searchInput.value.trim().toLowerCase();
  if (!query) return sessions;

  return sessions.filter((session) => [
    session.command,
    session.status,
    session.startedAt,
    session.endedAt,
    session.git?.root,
    ...(session.git?.changedFiles || []).map((file) => file.path)
  ].some((value) => String(value || "").toLowerCase().includes(query)));
}

function render() {
  const filtered = getFilteredBookmarks();
  if (!filtered.some((bookmark) => bookmark.id === selectedId)) {
    selectedId = filtered[0]?.id || "";
  }

  bookmarkList.innerHTML = filtered.length
    ? filtered.map((bookmark) => renderBookmarkItem(bookmark)).join("")
    : `<div class="empty">No saved items match this search.</div>`;

  renderReader();
  renderSessions();
  renderArchiveResults();
}

function renderBookmarkItem(bookmark) {
  const tags = (bookmark.tags || [])
    .slice(0, 4)
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join("");

  return `
    <button class="bookmark-item ${bookmark.id === selectedId ? "active" : ""}" data-id="${escapeHtml(bookmark.id)}" type="button">
      <strong>${escapeHtml(bookmark.title || firstLine(bookmark.text))}</strong>
      <small>${escapeHtml(formatDate(bookmark.createdAt))}</small>
      ${tags ? `<span class="tag-row">${tags}</span>` : ""}
    </button>`;
}

function renderReader() {
  const bookmark = bookmarks.find((item) => item.id === selectedId);
  if (!bookmark) {
    readerBody.innerHTML = `<div class="empty">Save or import something to start reading.</div>`;
    applySettings();
    return;
  }

  const tags = (bookmark.tags || [])
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join("");

  readerBody.innerHTML = `
    <div class="reader-inner">
      <time>${escapeHtml(formatDate(bookmark.createdAt))}</time>
      <h2>${escapeHtml(bookmark.title || firstLine(bookmark.text))}</h2>
      ${tags ? `<div class="tag-row">${tags}</div>` : ""}
      <div class="reader-text">${escapeHtml(bookmark.text || "")}</div>
      ${bookmark.note ? `<aside class="reader-note">${escapeHtml(bookmark.note)}</aside>` : ""}
      <div class="reader-actions">
        <button class="secondary-button" type="button" data-copy="${escapeHtml(bookmark.id)}">Copy</button>
        <button class="danger-button" type="button" data-delete="${escapeHtml(bookmark.id)}">Delete</button>
      </div>
    </div>`;
  applySettings();
}

function renderSessions() {
  if (!sessionList) return;
  if (!companionEnabled) {
    sessionList.innerHTML = `<div class="empty">Start <code>npm run lamb</code> to view tracked terminal sessions.</div>`;
    return;
  }

  const filtered = getFilteredSessions();
  sessionList.innerHTML = filtered.length
    ? filtered.slice(0, 12).map((session) => `
      <article class="session-item">
        <strong>${escapeHtml(session.command || "Tracked session")}</strong>
        <p>${escapeHtml(formatDate(session.startedAt))} · ${escapeHtml(formatDuration(session.durationMs))} · ${escapeHtml(session.status || "tracked")} · ${escapeHtml(String(session.lineCount || 0))} lines</p>
        <div class="session-actions">
          <button class="mini-button" type="button" data-session-file="${escapeHtml(session.id)}" data-file-type="wrap">Wrap-up</button>
          <button class="mini-button" type="button" data-session-file="${escapeHtml(session.id)}" data-file-type="transcript">Transcript</button>
          ${session.transcriptEventsPath ? `<button class="mini-button" type="button" data-session-file="${escapeHtml(session.id)}" data-file-type="events">Events</button>` : ""}
          <button class="mini-button" type="button" data-save-wrap="${escapeHtml(session.id)}">Save wrap-up</button>
        </div>
      </article>`).join("")
    : `<div class="empty">${searchInput.value.trim() ? "No sessions match this search." : "No sessions yet. Run"} <code>npm run lamb:track -- &lt;command&gt;</code>.</div>`;
}

function renderArchiveResults() {
  if (!companionEnabled || !archiveResults.length) return;
  const resultSummary = archiveResults.slice(0, 4)
    .map((result) => `${result.type}: ${result.title}`)
    .join(" | ");
  showNativeStatus(`Archive search: ${archiveResults.length} result${archiveResults.length === 1 ? "" : "s"}${resultSummary ? ` - ${resultSummary}` : ""}`);
}

async function runSearch() {
  archiveResults = [];
  if (companionEnabled && searchInput.value.trim()) {
    try {
      const data = await apiJson(`/api/search?q=${encodeURIComponent(searchInput.value.trim())}`);
      archiveResults = Array.isArray(data.results) ? data.results : [];
    } catch {
      showNativeStatus("Archive search failed.", true);
    }
  } else if (companionEnabled) {
    showNativeStatus("");
  }
  render();
}

async function saveCurrentBookmark() {
  const text = textInput.value.trim();
  if (!text) {
    textInput.focus();
    showStatus("Add text before saving.", true);
    return;
  }

  const bookmark = {
    id: crypto.randomUUID ? crypto.randomUUID() : `lamb-${Date.now()}`,
    title: titleInput.value.trim(),
    text,
    note: noteInput.value.trim(),
    tags: parseTags(tagInput.value),
    source: companionEnabled ? "lamb-companion" : "lamb-browser",
    createdAt: new Date().toISOString()
  };

  if (companionEnabled) {
    await apiJson("/api/bookmarks", {
      method: "POST",
      body: JSON.stringify(bookmark)
    });
    await refreshFromCompanion();
  } else {
    bookmarks.unshift(bookmark);
    saveLocalBookmarks();
  }

  selectedId = bookmark.id;
  clearForm();
  render();
  showStatus(companionEnabled ? "Saved to the shared Electric Sheep store." : "Saved locally in this browser.");
}

function clearForm() {
  titleInput.value = "";
  textInput.value = "";
  noteInput.value = "";
  tagInput.value = "";
}

async function pasteText() {
  try {
    textInput.value = await navigator.clipboard.readText();
    showStatus("Clipboard text pasted.");
  } catch {
    showStatus("Browser permission blocked clipboard paste.", true);
  }
}

function exportData() {
  return {
    app: "Electric Lamb",
    exportedAt: new Date().toISOString(),
    bookmarks,
    sessions: companionEnabled ? sessions : []
  };
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderMarkdown() {
  const lines = ["# Electric Lamb Export", "", `Exported: ${new Date().toISOString()}`, ""];
  for (const bookmark of bookmarks) {
    lines.push(`## ${bookmark.title || firstLine(bookmark.text)}`);
    lines.push("");
    lines.push(`Created: ${bookmark.createdAt}`);
    if (bookmark.tags?.length) lines.push(`Tags: ${bookmark.tags.join(", ")}`);
    lines.push("");
    lines.push(bookmark.text || "");
    if (bookmark.note) lines.push("", "### Note", "", bookmark.note);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function renderHtmlExport() {
  const articles = bookmarks.map((bookmark) => `
    <article>
      <h2>${escapeHtml(bookmark.title || firstLine(bookmark.text))}</h2>
      <p>${escapeHtml(bookmark.createdAt)}</p>
      <pre>${escapeHtml(bookmark.text || "")}</pre>
      ${bookmark.note ? `<p><strong>Note:</strong> ${escapeHtml(bookmark.note)}</p>` : ""}
    </article>`).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Electric Lamb Export</title>
  <style>
    body { max-width: 860px; margin: 32px auto; font: 16px/1.55 system-ui, sans-serif; padding: 0 18px; }
    article { border-top: 1px solid #ddd; padding: 22px 0; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <h1>Electric Lamb Export</h1>
  ${articles || "<p>No bookmarks exported.</p>"}
</body>
</html>`;
}

async function importJsonFile(file) {
  const data = JSON.parse(await file.text());
  const incoming = Array.isArray(data.bookmarks) ? data.bookmarks : [];

  if (companionEnabled) {
    const result = await apiJson("/api/import", {
      method: "POST",
      body: JSON.stringify({ bookmarks: incoming })
    });
    await refreshFromCompanion();
    selectedId = bookmarks[0]?.id || "";
    render();
    showStatus(`Imported ${result.added || 0} bookmark${result.added === 1 ? "" : "s"}.`);
    return;
  }

  const existingIds = new Set(bookmarks.map((bookmark) => bookmark.id));
  let added = 0;
  for (const bookmark of incoming) {
    const id = bookmark.id || `imported-${Date.now()}-${added}`;
    if (existingIds.has(id)) continue;
    bookmarks.unshift({
      id,
      title: String(bookmark.title || ""),
      text: String(bookmark.text || ""),
      note: String(bookmark.note || ""),
      tags: Array.isArray(bookmark.tags) ? bookmark.tags.map(String) : [],
      source: bookmark.source || "import",
      createdAt: bookmark.createdAt || new Date().toISOString()
    });
    existingIds.add(id);
    added += 1;
  }

  saveLocalBookmarks();
  selectedId = bookmarks[0]?.id || "";
  render();
  showStatus(`Imported ${added} bookmark${added === 1 ? "" : "s"}.`);
}

async function importTextFiles(files) {
  const incomingFiles = [...files].filter(Boolean);
  let imported = 0;

  for (const file of incomingFiles) {
    const text = await file.text();
    const bookmark = {
      id: crypto.randomUUID ? crypto.randomUUID() : `file-${Date.now()}-${imported}`,
      title: file.name,
      text,
      note: `Imported from ${file.name}`,
      tags: ["file"],
      source: companionEnabled ? "lamb-companion-file" : "lamb-browser-file",
      createdAt: new Date().toISOString()
    };

    if (companionEnabled) {
      await apiJson("/api/bookmarks", {
        method: "POST",
        body: JSON.stringify(bookmark)
      });
    } else {
      bookmarks.unshift(bookmark);
    }
    imported += 1;
  }

  if (companionEnabled) {
    await refreshFromCompanion();
  } else {
    saveLocalBookmarks();
  }

  selectedId = bookmarks[0]?.id || "";
  render();
  showStatus(`Imported ${imported} text file${imported === 1 ? "" : "s"}.`);
}

async function deleteBookmark(id) {
  if (companionEnabled) {
    await apiJson(`/api/bookmarks/${encodeURIComponent(id)}`, { method: "DELETE" });
    await refreshFromCompanion();
  } else {
    bookmarks = bookmarks.filter((item) => item.id !== id);
    saveLocalBookmarks();
  }
  selectedId = bookmarks[0]?.id || "";
  render();
  showStatus("Deleted.");
}

async function previewSessionFile(sessionId, type) {
  if (!companionEnabled) return;
  try {
    const data = await apiJson(`/api/sessions/${encodeURIComponent(sessionId)}/file?type=${encodeURIComponent(type)}`);
    sessionPreview.textContent = data.content || "";
    sessionPreview.classList.add("visible");
    showNativeStatus(`${type} preview loaded.`);
  } catch {
    showNativeStatus("Could not read that session file.", true);
  }
}

async function saveSessionWrap(sessionId) {
  if (!companionEnabled) return;
  try {
    await apiJson(`/api/sessions/${encodeURIComponent(sessionId)}/save-wrap`, { method: "POST" });
    await refreshFromCompanion();
    render();
    showNativeStatus("Wrap-up saved as a bookmark.");
  } catch {
    showNativeStatus("Could not save that wrap-up.", true);
  }
}

async function runDoctor() {
  if (!companionEnabled) return;
  try {
    const data = await apiJson("/api/doctor");
    const checks = Array.isArray(data.checks) ? data.checks : [];
    const failures = checks.filter((check) => !check.ok).length;
    showNativeStatus(`${checks.length} checks · ${failures} issue${failures === 1 ? "" : "s"}`);
  } catch {
    showNativeStatus("Doctor check failed.", true);
  }
}

async function repairLegacyLogs() {
  if (!companionEnabled) return;
  try {
    const result = await apiJson("/api/repair-legacy", { method: "POST" });
    await refreshFromCompanion();
    render();
    showNativeStatus(`Checked ${result.checked} · repaired ${result.repaired} · skipped ${result.skipped}`);
  } catch {
    showNativeStatus("Legacy repair failed.", true);
  }
}

async function runFullExport() {
  if (!companionEnabled) return;
  try {
    const result = await apiJson("/api/export", { method: "POST" });
    showNativeStatus(`Full export: ${result.exportDir}`);
  } catch {
    showNativeStatus("Full export failed.", true);
  }
}

saveButton.addEventListener("click", () => {
  saveCurrentBookmark().catch(() => showStatus("Save failed.", true));
});
pasteButton.addEventListener("click", pasteText);
clearButton.addEventListener("click", () => {
  clearForm();
  showStatus("Draft cleared.");
});
let searchTimer = null;
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    runSearch().catch(() => showNativeStatus("Search failed.", true));
  }, 160);
});
bookmarkList.addEventListener("click", (event) => {
  const item = event.target.closest("[data-id]");
  if (!item) return;
  selectedId = item.dataset.id;
  render();
});
sessionList.addEventListener("click", (event) => {
  const fileButton = event.target.closest("[data-session-file]");
  const saveButton = event.target.closest("[data-save-wrap]");
  if (fileButton) {
    previewSessionFile(fileButton.dataset.sessionFile, fileButton.dataset.fileType || "wrap");
  }
  if (saveButton) {
    saveSessionWrap(saveButton.dataset.saveWrap);
  }
});
readerBody.addEventListener("click", async (event) => {
  const copyId = event.target.dataset.copy;
  const deleteId = event.target.dataset.delete;
  if (copyId) {
    const bookmark = bookmarks.find((item) => item.id === copyId);
    if (!bookmark) return;
    await navigator.clipboard.writeText(bookmark.text || "");
    showStatus("Copied reader text.");
  }
  if (deleteId) {
    await deleteBookmark(deleteId);
  }
});
importTextButton.addEventListener("click", () => textFileInput.click());
textFileInput.addEventListener("change", async () => {
  const files = textFileInput.files;
  if (!files?.length) return;
  try {
    await importTextFiles(files);
  } catch {
    showStatus("Text file import failed.", true);
  } finally {
    textFileInput.value = "";
  }
});
importButton.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  if (!file) return;
  try {
    await importJsonFile(file);
  } catch {
    showStatus("Import failed. Choose an Electric Sheep or Lamb JSON export.", true);
  } finally {
    importFile.value = "";
  }
});
doctorButton.addEventListener("click", () => {
  runDoctor();
});
repairButton.addEventListener("click", () => {
  repairLegacyLogs();
});
fullExportButton.addEventListener("click", () => {
  runFullExport();
});
exportJsonButton.addEventListener("click", () => {
  download("electric-lamb.json", JSON.stringify(exportData(), null, 2), "application/json");
});
exportMarkdownButton.addEventListener("click", () => {
  download("electric-lamb.md", renderMarkdown(), "text/markdown");
});
exportHtmlButton.addEventListener("click", () => {
  download("electric-lamb.html", renderHtmlExport(), "text/html");
});
refreshSessionsButton.addEventListener("click", async () => {
  if (!companionEnabled) {
    showStatus("Start the Lamb companion to view tracked sessions.", true);
    return;
  }
  await refreshFromCompanion();
  render();
  showStatus("Sessions refreshed.");
});

for (const control of [fontSizeInput, measureInput, themeInput]) {
  control.addEventListener("input", () => {
    saveSettings();
    applySettings();
  });
  control.addEventListener("change", () => {
    saveSettings();
    applySettings();
  });
}

async function init() {
  const settings = loadSettings();
  if (settings.fontSize) fontSizeInput.value = String(settings.fontSize);
  if (settings.measure) measureInput.value = String(settings.measure);
  if (settings.theme) themeInput.value = settings.theme;

  renderCompanionState();
  if (await detectCompanion()) {
    await refreshFromCompanion();
  }
  render();
  showStatus(companionEnabled ? `${bookmarks.length} bookmarks · ${sessions.length} sessions.` : `${bookmarks.length} saved locally.`);
}

init().catch(() => {
  render();
  showStatus("Electric Lamb started in browser-only mode.");
});
