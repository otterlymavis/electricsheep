#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const releaseDir = path.join(projectRoot, "release");
const manifestPath = path.join(releaseDir, "electric-lamb-release.json");

async function main() {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  if (manifest.app !== "Electric Lamb") {
    throw new Error("release manifest is not for Electric Lamb");
  }

  for (const artifact of manifest.artifacts || []) {
    const relativePath = artifact.path || path.join("release", artifact.name || "");
    const filePath = path.join(projectRoot, relativePath);
    const content = await fs.readFile(filePath);
    const stat = await fs.stat(filePath);
    const sha256 = crypto.createHash("sha256").update(content).digest("hex");

    if (stat.size !== artifact.bytes) {
      throw new Error(`${relativePath} size mismatch: expected ${artifact.bytes}, got ${stat.size}`);
    }
    if (sha256 !== artifact.sha256) {
      throw new Error(`${relativePath} sha256 mismatch: expected ${artifact.sha256}, got ${sha256}`);
    }

    console.log(`ok: ${relativePath} ${formatBytes(stat.size)} ${sha256}`);
  }

  console.log("Electric Lamb release manifest verified.");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
