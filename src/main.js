const { app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, globalShortcut, nativeImage, screen } = require("electron");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { exportArchive, importArchive } = require("./export");
const { readImageText } = require("./ocr");
const { searchArchive } = require("./search");
const { deleteBookmark, deleteSession, ensureStore, getStorePaths, isInsideBaseDir, readBookmarks, readSessions, writeBookmarks } = require("./store");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    title: "Electric Sheep",
    backgroundColor: "#f7f4ef",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "..", "index.html"));
}

function showCaptureWindow(text = "") {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send("clipboard-captured", text);
}

async function captureScreenshot() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width, height }
  });
  const source = sources[0];

  if (!source) {
    throw new Error("No screen source was available.");
  }

  const image = nativeImage.createFromDataURL(source.thumbnail.toDataURL());
  const buffer = image.toPNG();
  const { screenshotsDir } = getStorePaths();
  await fs.mkdir(screenshotsDir, { recursive: true });

  const fileName = `screenshot-${Date.now()}.png`;
  const filePath = path.join(screenshotsDir, fileName);
  await fs.writeFile(filePath, buffer);

  return createImageAttachment(filePath, fileName);
}

async function saveClipboardImage() {
  const image = clipboard.readImage();
  if (image.isEmpty()) return null;

  const { screenshotsDir } = getStorePaths();
  await fs.mkdir(screenshotsDir, { recursive: true });
  const fileName = `clipboard-image-${Date.now()}.png`;
  const filePath = path.join(screenshotsDir, fileName);
  await fs.writeFile(filePath, image.toPNG());

  return createImageAttachment(filePath, fileName);
}

async function importFiles() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Import files",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Supported files", extensions: ["txt", "md", "json", "log", "csv", "png", "jpg", "jpeg", "webp"] },
      { name: "Text", extensions: ["txt", "md", "json", "log", "csv"] },
      { name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }
    ]
  });

  if (result.canceled) return { text: "", attachments: [] };

  const textParts = [];
  const attachments = [];

  for (const filePath of result.filePaths) {
    const extension = path.extname(filePath).toLowerCase();
    const originalName = path.basename(filePath);

    if ([".txt", ".md", ".json", ".log", ".csv"].includes(extension)) {
      const content = await fs.readFile(filePath, "utf8");
      textParts.push(`--- ${originalName} ---\n${content}`);
      attachments.push(await copyAttachment(filePath, "text", originalName, content));
    }

    if ([".png", ".jpg", ".jpeg", ".webp"].includes(extension)) {
      attachments.push(await copyAttachment(filePath, "image", originalName, ""));
    }
  }

  return {
    text: textParts.join("\n\n"),
    attachments
  };
}

async function copyAttachment(sourcePath, type, originalName, extractedText) {
  const { screenshotsDir } = getStorePaths();
  await fs.mkdir(screenshotsDir, { recursive: true });
  const extension = path.extname(originalName) || (type === "image" ? ".png" : ".txt");
  const fileName = `${type}-${Date.now()}-${randomUUID()}${extension}`;
  const targetPath = path.join(screenshotsDir, fileName);
  await fs.copyFile(sourcePath, targetPath);

  if (type === "image") {
    return createImageAttachment(targetPath, originalName);
  }

  return {
    id: randomUUID(),
    type,
    path: targetPath,
    url: pathToFileURL(targetPath).href,
    originalName,
    extractedText,
    createdAt: new Date().toISOString()
  };
}

async function createImageAttachment(filePath, originalName) {
  const ocr = await readImageText(filePath);

  return {
    id: randomUUID(),
    type: "image",
    path: filePath,
    url: pathToFileURL(filePath).href,
    originalName,
    extractedText: ocr.text,
    ocrStatus: ocr.status,
    createdAt: new Date().toISOString()
  };
}

app.whenReady().then(async () => {
  await ensureStore();
  createWindow();

  globalShortcut.register("CommandOrControl+Shift+B", () => {
    showCaptureWindow(clipboard.readText());
  });

  globalShortcut.register("CommandOrControl+Shift+S", async () => {
    const screenshot = await captureScreenshot();
    showCaptureWindow(clipboard.readText());
    mainWindow.webContents.send("screenshot-captured", screenshot);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("clipboard:read", () => clipboard.readText());

ipcMain.handle("clipboard:image", async () => saveClipboardImage());

ipcMain.handle("screenshot:capture", async () => captureScreenshot());

ipcMain.handle("files:import", async () => importFiles());

ipcMain.handle("export:archive", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose export folder",
    properties: ["openDirectory", "createDirectory"]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return exportArchive(result.filePaths[0]);
});

ipcMain.handle("import:archive", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Import Electric Sheep archive",
    properties: ["openFile"],
    filters: [
      { name: "Electric Sheep JSON", extensions: ["json"] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return importArchive(result.filePaths[0]);
});

ipcMain.handle("bookmarks:list", async () => readBookmarks());

ipcMain.handle("sessions:list", async () => readSessions());

ipcMain.handle("search:archive", async (_event, query) => searchArchive(query || ""));

ipcMain.handle("sessions:read-file", async (_event, filePath) => {
  if (!isInsideBaseDir(filePath)) {
    throw new Error("Session file must be inside the Electric Sheep store.");
  }
  return fs.readFile(filePath, "utf8");
});

ipcMain.handle("bookmarks:add", async (_event, bookmark) => {
  const bookmarks = await readBookmarks();
  const saved = {
    id: randomUUID(),
    title: bookmark.title?.trim() || "",
    text: bookmark.text?.trim() || "",
    note: bookmark.note?.trim() || "",
    tags: Array.isArray(bookmark.tags) ? bookmark.tags : [],
    source: bookmark.source || "quick-save",
    screenshotPath: bookmark.screenshotPath || "",
    attachments: Array.isArray(bookmark.attachments) ? bookmark.attachments : [],
    createdAt: new Date().toISOString()
  };

  bookmarks.unshift(saved);
  await writeBookmarks(bookmarks);
  return saved;
});

ipcMain.handle("bookmarks:delete", async (_event, id) => {
  await deleteBookmark(id);
  return readBookmarks();
});

ipcMain.handle("sessions:delete", async (_event, id) => {
  await deleteSession(id);
  return readSessions();
});
