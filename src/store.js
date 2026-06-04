const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

function getBaseDir() {
  return process.env.ELECTRIC_SHEEP_HOME || path.join(os.homedir(), ".electricsheep");
}

function getStorePaths() {
  const baseDir = getBaseDir();
  return {
    baseDir,
    bookmarksFile: path.join(baseDir, "bookmarks.json"),
    sessionsFile: path.join(baseDir, "sessions.json"),
    screenshotsDir: path.join(baseDir, "screenshots"),
    sessionsDir: path.join(baseDir, "sessions")
  };
}

async function ensureJsonFile(filePath) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, "[]", "utf8");
  }
}

async function ensureStore() {
  const { baseDir, bookmarksFile, screenshotsDir, sessionsDir, sessionsFile } = getStorePaths();
  await fs.mkdir(baseDir, { recursive: true });
  await fs.mkdir(screenshotsDir, { recursive: true });
  await fs.mkdir(sessionsDir, { recursive: true });
  await ensureJsonFile(bookmarksFile);
  await ensureJsonFile(sessionsFile);
}

async function readJsonList(filePath) {
  await ensureStore();
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content);
}

async function writeJsonList(filePath, items) {
  await fs.writeFile(filePath, JSON.stringify(items, null, 2), "utf8");
}

async function readBookmarks() {
  const { bookmarksFile } = getStorePaths();
  return readJsonList(bookmarksFile);
}

async function writeBookmarks(bookmarks) {
  const { bookmarksFile } = getStorePaths();
  await writeJsonList(bookmarksFile, bookmarks);
}

async function readSessions() {
  const { sessionsFile } = getStorePaths();
  return readJsonList(sessionsFile);
}

async function addSession(session) {
  const { sessionsFile } = getStorePaths();
  const sessions = await readSessions();
  sessions.unshift(session);
  await writeJsonList(sessionsFile, sessions);
  return session;
}

async function updateBookmarks(updater) {
  const bookmarks = await readBookmarks();
  const nextBookmarks = await updater(bookmarks);
  await writeBookmarks(nextBookmarks);
  return nextBookmarks;
}

async function updateSessions(updater) {
  const sessions = await readSessions();
  const nextSessions = await updater(sessions);
  const { sessionsFile } = getStorePaths();
  await writeJsonList(sessionsFile, nextSessions);
  return nextSessions;
}

async function deleteBookmark(id) {
  let deleted = null;

  await updateBookmarks((bookmarks) => {
    deleted = bookmarks.find((bookmark) => bookmark.id === id) || null;
    return bookmarks.filter((bookmark) => bookmark.id !== id);
  });

  return deleted;
}

async function deleteSession(id) {
  let deleted = null;

  await updateSessions((sessions) => {
    deleted = sessions.find((session) => session.id === id) || null;
    return sessions.filter((session) => session.id !== id);
  });

  if (deleted) {
    await removeSessionFiles(deleted);
  }

  return deleted;
}

async function removeSessionFiles(session) {
  const candidateDirs = [
    session.metadataPath,
    session.wrapUpPath,
    session.transcriptPath
  ]
    .filter(Boolean)
    .map((filePath) => path.dirname(filePath));
  const sessionDir = candidateDirs.find((dir) => isInsideBaseDir(dir));

  if (sessionDir) {
    await fs.rm(sessionDir, { recursive: true, force: true });
  }
}

function isInsideBaseDir(filePath) {
  const baseDir = path.resolve(getBaseDir());
  const resolvedPath = path.resolve(filePath);
  return resolvedPath === baseDir || resolvedPath.startsWith(`${baseDir}${path.sep}`);
}

module.exports = {
  addSession,
  deleteBookmark,
  deleteSession,
  ensureStore,
  getBaseDir,
  getStorePaths,
  isInsideBaseDir,
  readBookmarks,
  readSessions,
  updateBookmarks,
  updateSessions,
  writeBookmarks
};
