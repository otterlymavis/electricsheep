const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.join(__dirname, "..");
const releaseDir = path.join(projectRoot, "release");
const standalone = process.argv.includes("--standalone");
const appName = "Electric Lamb.app";
const outputRoot = standalone ? path.join(releaseDir, "standalone") : releaseDir;
const appDir = path.join(outputRoot, appName);
const contentsDir = path.join(appDir, "Contents");
const macOsDir = path.join(contentsDir, "MacOS");
const resourcesDir = path.join(contentsDir, "Resources");
const appResourcesDir = path.join(resourcesDir, "app");
const zipPath = path.join(releaseDir, standalone ? "Electric Lamb-standalone-mac.zip" : "Electric Lamb-mac.zip");

async function main() {
  await fs.rm(appDir, { recursive: true, force: true });
  if (standalone) await fs.mkdir(outputRoot, { recursive: true });
  await fs.mkdir(macOsDir, { recursive: true });
  await fs.mkdir(appResourcesDir, { recursive: true });

  await buildSwiftShell();
  await writeInfoPlist();
  await copyAppResources();
  if (standalone) await copyNodeRuntime();
  await copyIfExists(path.join(projectRoot, "build", "icon.icns"), path.join(resourcesDir, "icon.icns"));
  await verifyAppBundle();
  await signAppBundleIfRequested();
  await zipApp();

  console.log(`Wrote ${appDir}`);
  console.log(`Wrote ${zipPath}`);
  console.log(`Mode: ${standalone ? "standalone runtime" : "thin runtime"}`);
  console.log(`App size: ${await fileSize(appDir)}`);
  console.log(`Zip size: ${await fileSize(zipPath)}`);
}

async function buildSwiftShell() {
  const source = path.join(projectRoot, "lamb-shell", "ElectricLamb.swift");
  const output = path.join(macOsDir, "Electric Lamb");
  const result = spawnSync("swiftc", [
    source,
    "-o",
    output,
    "-framework",
    "AppKit",
    "-framework",
    "WebKit"
  ], {
    cwd: projectRoot,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || "swiftc failed");
  }
  await fs.chmod(output, 0o755);
}

async function writeInfoPlist() {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>Electric Lamb</string>
  <key>CFBundleIdentifier</key>
  <string>local.electriclamb.app</string>
  <key>CFBundleName</key>
  <string>Electric Lamb</string>
  <key>CFBundleDisplayName</key>
  <string>Electric Lamb</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>CFBundleIconFile</key>
  <string>icon.icns</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
</dict>
</plist>
`;
  await fs.writeFile(path.join(contentsDir, "Info.plist"), plist, "utf8");
  await fs.writeFile(path.join(contentsDir, "PkgInfo"), "APPL????", "utf8");
}

async function copyAppResources() {
  await copyDir(path.join(projectRoot, "lite"), path.join(appResourcesDir, "lite"));
  await copyDir(path.join(projectRoot, "src"), path.join(appResourcesDir, "src"));
  await copyDir(path.join(projectRoot, "bin"), path.join(appResourcesDir, "bin"));
  await fs.mkdir(path.join(appResourcesDir, "scripts"), { recursive: true });
  for (const file of ["lamb-server.js", "ocr.swift", "capture-window.swift", "ax-read.swift", "clipboard-image.swift"]) {
    await fs.copyFile(path.join(projectRoot, "scripts", file), path.join(appResourcesDir, "scripts", file));
  }
  await fs.copyFile(path.join(projectRoot, "image.png"), path.join(appResourcesDir, "image.png"));
  await fs.copyFile(path.join(projectRoot, "index.html"), path.join(appResourcesDir, "index.html"));
  await fs.copyFile(path.join(projectRoot, "package.json"), path.join(appResourcesDir, "package.json"));
  await copyDir(path.join(projectRoot, "node_modules", "node-pty"), path.join(appResourcesDir, "node_modules", "node-pty"));
  await copyDir(path.join(projectRoot, "node_modules", "node-addon-api"), path.join(appResourcesDir, "node_modules", "node-addon-api"));
  await pruneNodePty();
}

async function copyNodeRuntime() {
  const nodeDir = path.join(resourcesDir, "node", "bin");
  await fs.mkdir(nodeDir, { recursive: true });
  const target = path.join(nodeDir, "node");
  const source = await getPortableNodeBinary();
  await fs.copyFile(source, target);
  await fs.chmod(target, 0o755);

  const deps = spawnSync("otool", ["-L", target], { encoding: "utf8" });
  if (deps.status === 0 && deps.stdout.includes("/opt/homebrew/")) {
    throw new Error("standalone Node runtime links to Homebrew libraries");
  }
}

async function getPortableNodeBinary() {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("standalone Electric Lamb packaging currently supports macOS arm64");
  }

  const version = process.versions.node;
  const archiveName = `node-v${version}-darwin-arm64`;
  const cacheDir = path.join(projectRoot, ".cache", "electric-lamb", archiveName);
  const nodePath = path.join(cacheDir, archiveName, "bin", "node");

  try {
    await fs.access(nodePath);
    return nodePath;
  } catch {}

  await fs.mkdir(cacheDir, { recursive: true });
  const archivePath = path.join(cacheDir, `${archiveName}.tar.gz`);
  const url = `https://nodejs.org/dist/v${version}/${archiveName}.tar.gz`;
  const download = spawnSync("curl", ["-fL", url, "-o", archivePath], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (download.status !== 0) {
    throw new Error(`could not download official Node runtime: ${download.stderr || download.stdout}`);
  }
  await verifyNodeArchiveChecksum({ archiveName, archivePath, cacheDir, version });

  const extract = spawnSync("tar", ["-xzf", archivePath], {
    cwd: cacheDir,
    encoding: "utf8"
  });
  if (extract.status !== 0) {
    throw new Error(`could not extract official Node runtime: ${extract.stderr || extract.stdout}`);
  }

  await fs.access(nodePath);
  return nodePath;
}

async function verifyNodeArchiveChecksum({ archiveName, archivePath, cacheDir, version }) {
  const sumsPath = path.join(cacheDir, "SHASUMS256.txt");
  const sumsUrl = `https://nodejs.org/dist/v${version}/SHASUMS256.txt`;
  const downloadSums = spawnSync("curl", ["-fL", sumsUrl, "-o", sumsPath], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (downloadSums.status !== 0) {
    throw new Error(`could not download Node checksums: ${downloadSums.stderr || downloadSums.stdout}`);
  }

  const sums = await fs.readFile(sumsPath, "utf8");
  const archiveFile = `${archiveName}.tar.gz`;
  const expected = sums
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find((parts) => parts[1] === archiveFile)?.[0];
  if (!expected) {
    throw new Error(`Node checksum not found for ${archiveFile}`);
  }

  const actualResult = spawnSync("shasum", ["-a", "256", archivePath], {
    encoding: "utf8"
  });
  if (actualResult.status !== 0) {
    throw new Error(`could not verify Node checksum: ${actualResult.stderr || actualResult.stdout}`);
  }
  const actual = actualResult.stdout.trim().split(/\s+/)[0];
  if (actual !== expected) {
    throw new Error(`Node checksum mismatch for ${archiveFile}`);
  }
}

async function verifyAppBundle() {
  const required = [
    path.join(macOsDir, "Electric Lamb"),
    path.join(contentsDir, "Info.plist"),
    path.join(appResourcesDir, "index.html"),
    path.join(appResourcesDir, "lite", "electron-bridge.js"),
    path.join(appResourcesDir, "scripts", "lamb-server.js"),
    path.join(appResourcesDir, "node_modules", "node-pty", "package.json")
  ];

  for (const file of required) {
    await fs.access(file);
  }

  const nodeForCheck = standalone
    ? path.join(resourcesDir, "node", "bin", "node")
    : process.execPath;
  const requireCheck = spawnSync(nodeForCheck, [
    "-e",
    `require(${JSON.stringify(path.join(appResourcesDir, "node_modules", "node-pty"))}); console.log("node-pty ok")`
  ], {
    cwd: appResourcesDir,
    encoding: "utf8"
  });
  if (requireCheck.status !== 0) {
    throw new Error(`packaged node-pty failed to load: ${requireCheck.stderr || requireCheck.stdout}`);
  }
}

async function signAppBundleIfRequested() {
  if (process.platform !== "darwin") return;
  if (process.env.ELECTRIC_LAMB_CODESIGN !== "1") return;

  const sign = spawnSync("codesign", ["--force", "--deep", "--sign", "-", appDir], {
    cwd: projectRoot,
    encoding: "utf8"
  });
  if (sign.status !== 0) {
    throw new Error(`codesign failed: ${sign.stderr || sign.stdout}`);
  }

  const verify = spawnSync("codesign", ["--verify", "--deep", "--strict", appDir], {
    cwd: projectRoot,
    encoding: "utf8"
  });
  if (verify.status !== 0) {
    throw new Error(`codesign verification failed: ${verify.stderr || verify.stdout}`);
  }
}

async function zipApp() {
  await fs.rm(zipPath, { force: true });
  const archiveCommand = process.platform === "darwin" ? "ditto" : "zip";
  const archiveArgs = process.platform === "darwin"
    ? ["-c", "-k", "--keepParent", appDir, zipPath]
    : ["-qr", zipPath, appName];
  const result = spawnSync(archiveCommand, archiveArgs, {
    cwd: outputRoot,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `${archiveCommand} failed`);
  }
}

async function copyDir(source, target) {
  await fs.mkdir(target, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDir(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

async function copyIfExists(source, target) {
  try {
    await fs.copyFile(source, target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function pruneNodePty() {
  const nodePtyDir = path.join(appResourcesDir, "node_modules", "node-pty");
  for (const dir of ["build", "deps", "scripts", "src", "third_party"]) {
    await fs.rm(path.join(nodePtyDir, dir), { recursive: true, force: true });
  }

  const prebuildsDir = path.join(nodePtyDir, "prebuilds");
  const entries = await fs.readdir(prebuildsDir, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isDirectory() || entry.name === "darwin-arm64") return;
    await fs.rm(path.join(prebuildsDir, entry.name), { recursive: true, force: true });
  }));
}

async function fileSize(filePath) {
  const result = spawnSync("du", ["-sh", filePath], { encoding: "utf8" });
  return result.stdout.trim().split(/\s+/)[0] || "unknown";
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
