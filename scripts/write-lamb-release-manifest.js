#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const releaseDir = path.join(projectRoot, "release");
const artifacts = [
  {
    name: "electric-lamb.zip",
    mode: "static browser",
    path: "release/electric-lamb.zip",
    runtime: "browser"
  },
  {
    name: "Electric Lamb-mac.zip",
    mode: "thin macOS app",
    path: "release/Electric Lamb-mac.zip",
    runtime: "system Node.js"
  },
  {
    name: "Electric Lamb-standalone-mac.zip",
    mode: "standalone macOS app",
    path: "release/Electric Lamb-standalone-mac.zip",
    runtime: "bundled official Node.js"
  }
];

async function main() {
  const entries = [];
  for (const artifact of artifacts) {
    const filePath = path.join(projectRoot, artifact.path);
    const content = await fs.readFile(filePath);
    const stat = await fs.stat(filePath);
    entries.push({
      ...artifact,
      bytes: stat.size,
      sha256: crypto.createHash("sha256").update(content).digest("hex")
    });
  }

  const generatedAt = new Date().toISOString();
  await fs.writeFile(path.join(releaseDir, "electric-lamb-release.json"), JSON.stringify({
    app: "Electric Lamb",
    generatedAt,
    artifacts: entries
  }, null, 2), "utf8");

  const markdown = [
    "# Electric Lamb Release Manifest",
    "",
    `Generated: ${generatedAt}`,
    "",
    "| Artifact | Mode | Runtime | Size | SHA-256 |",
    "| --- | --- | --- | ---: | --- |",
    ...entries.map((entry) => `| ${entry.name} | ${entry.mode} | ${entry.runtime} | ${formatBytes(entry.bytes)} | \`${entry.sha256}\` |`),
    "",
    "Local macOS app bundles are unsigned by default. Public distribution requires Developer ID signing and notarization.",
    ""
  ].join("\n");
  await fs.writeFile(path.join(releaseDir, "electric-lamb-release.md"), markdown, "utf8");

  console.log(`Wrote ${path.join(releaseDir, "electric-lamb-release.json")}`);
  console.log(`Wrote ${path.join(releaseDir, "electric-lamb-release.md")}`);
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
