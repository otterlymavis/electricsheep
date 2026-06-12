const fs = require("node:fs/promises");
const path = require("node:path");

const ARCH_NAMES = {
  0: "ia32",
  1: "x64",
  2: "armv7l",
  3: "arm64",
  4: "universal"
};

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName;
  const arch = ARCH_NAMES[context.arch] || String(context.arch || "");
  const appDir = await findAppResourcesDir(context.appOutDir, platform);

  if (appDir) {
    await pruneNodePtyPrebuilds(appDir, platform, arch);
  }

  await pruneElectronLocales(context.appOutDir, platform);
};

async function findAppResourcesDir(appOutDir, platform) {
  if (platform === "darwin") {
    const entries = await fs.readdir(appOutDir, { withFileTypes: true });
    const app = entries.find((entry) => entry.isDirectory() && entry.name.endsWith(".app"));
    return app ? path.join(appOutDir, app.name, "Contents", "Resources", "app") : "";
  }

  return path.join(appOutDir, "resources", "app");
}

async function pruneNodePtyPrebuilds(appDir, platform, arch) {
  const prebuildsDir = path.join(appDir, "node_modules", "node-pty", "prebuilds");
  const keep = `${platform}-${arch}`;
  const entries = await readDirIfExists(prebuildsDir);

  await Promise.all(entries.map(async (entry) => {
    if (!entry.isDirectory() || entry.name === keep) return;
    await fs.rm(path.join(prebuildsDir, entry.name), { recursive: true, force: true });
  }));
}

async function pruneElectronLocales(appOutDir, platform) {
  const localesDir = platform === "darwin"
    ? await findMacLocalesDir(appOutDir)
    : path.join(appOutDir, "locales");
  const entries = await readDirIfExists(localesDir);

  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || entry.name === "en-US.pak") return;
    await fs.rm(path.join(localesDir, entry.name), { force: true });
  }));
}

async function findMacLocalesDir(appOutDir) {
  const entries = await fs.readdir(appOutDir, { withFileTypes: true });
  const app = entries.find((entry) => entry.isDirectory() && entry.name.endsWith(".app"));
  return app ? path.join(appOutDir, app.name, "Contents", "Resources") : "";
}

async function readDirIfExists(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
