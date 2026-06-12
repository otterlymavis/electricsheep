const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.join(__dirname, "..");
const lambDir = path.join(projectRoot, "lite");
const releaseDir = path.join(projectRoot, "release");
const outDir = path.join(releaseDir, "electric-lamb");
const zipPath = path.join(releaseDir, "electric-lamb.zip");

async function main() {
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  for (const file of ["index.html", "styles.css", "app.js"]) {
    await fs.copyFile(path.join(lambDir, file), path.join(outDir, file));
  }
  await fs.copyFile(path.join(projectRoot, "image.png"), path.join(outDir, "image.png"));

  await fs.rm(zipPath, { force: true });
  const result = spawnSync("zip", ["-qr", zipPath, "electric-lamb"], {
    cwd: releaseDir,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || "zip failed");
  }

  const size = (await fs.stat(zipPath)).size;
  console.log(`Wrote ${zipPath}`);
  console.log(`Size: ${formatBytes(size)}`);
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
