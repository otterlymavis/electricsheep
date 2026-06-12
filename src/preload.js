const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electricSheep", {
  readClipboardText: () => ipcRenderer.invoke("clipboard:read"),
  readClipboardContent: () => ipcRenderer.invoke("clipboard:read-content"),
  writeClipboardText: (text) => ipcRenderer.invoke("clipboard:write-text", text),
  writeClipboardContent: (content) => ipcRenderer.invoke("clipboard:write-content", content),
  readClipboardImage: () => ipcRenderer.invoke("clipboard:image"),
  captureScreenshot: () => ipcRenderer.invoke("screenshot:capture"),
  importFiles: () => ipcRenderer.invoke("files:import"),
  exportArchive: () => ipcRenderer.invoke("export:archive"),
  importArchive: () => ipcRenderer.invoke("import:archive"),
  listBookmarks: () => ipcRenderer.invoke("bookmarks:list"),
  listSessions: () => ipcRenderer.invoke("sessions:list"),
  searchArchive: (query) => ipcRenderer.invoke("search:archive", query),
  readSessionFile: (filePath) => ipcRenderer.invoke("sessions:read-file", filePath),
  addBookmark: (bookmark) => ipcRenderer.invoke("bookmarks:add", bookmark),
  deleteBookmark: (id) => ipcRenderer.invoke("bookmarks:delete", id),
  deleteSession: (id) => ipcRenderer.invoke("sessions:delete", id),
  getInfo: () => ipcRenderer.invoke("app:info"),
  ocrBackfill: () => ipcRenderer.invoke("ocr:backfill"),
  doctorCheck: () => ipcRenderer.invoke("doctor:check"),
  repairLegacySessions: () => ipcRenderer.invoke("sessions:repair-legacy"),
  onClipboardCaptured: (callback) => {
    ipcRenderer.on("clipboard-captured", (_event, text) => callback(text));
  },
  onScreenshotCaptured: (callback) => {
    ipcRenderer.on("screenshot-captured", (_event, screenshot) => callback(screenshot));
  },
  onBookmarkAdded: (callback) => {
    ipcRenderer.on("bookmark-added", (_event, bookmark) => callback(bookmark));
  }
});
