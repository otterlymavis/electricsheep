#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const releaseDir = path.join(projectRoot, "release");
const budgets = [
  {
    name: "electric-lamb.zip",
    path: path.join(releaseDir, "electric-lamb.zip"),
    maxBytes: 1024 * 1024
  },
  {
    name: "Electric Lamb-mac.zip",
    path: path.join(releaseDir, "Electric Lamb-mac.zip"),
    maxBytes: 5 * 1024 * 1024
  },
  {
    name: "Electric Lamb-standalone-mac.zip",
    path: path.join(releaseDir, "Electric Lamb-standalone-mac.zip"),
    maxBytes: 60 * 1024 * 1024
  }
];

function main() {
  const failures = [];
  for (const budget of budgets) {
    if (!fs.existsSync(budget.path)) {
      failures.push(`${budget.name} is missing`);
      continue;
    }

    const bytes = fs.statSync(budget.path).size;
    const ok = bytes <= budget.maxBytes;
    console.log(`${ok ? "ok" : "over"}: ${budget.name} ${formatBytes(bytes)} / ${formatBytes(budget.maxBytes)}`);
    if (!ok) failures.push(`${budget.name} is ${formatBytes(bytes)}; budget is ${formatBytes(budget.maxBytes)}`);
  }

  const electronDmg = findElectronDmg();
  if (electronDmg) {
    const standalone = path.join(releaseDir, "Electric Lamb-standalone-mac.zip");
    const standaloneBytes = fs.existsSync(standalone) ? fs.statSync(standalone).size : Infinity;
    const electronBytes = fs.statSync(electronDmg).size;
    const ok = standaloneBytes < electronBytes;
    console.log(`${ok ? "ok" : "over"}: standalone Lamb ${formatBytes(standaloneBytes)} vs Electron DMG ${formatBytes(electronBytes)}`);
    if (!ok) failures.push("standalone Lamb zip is not smaller than the Electron DMG");
  }

  if (failures.length) {
    console.error(`\nSize budget failed:\n- ${failures.join("\n- ")}`);
    process.exitCode = 1;
    return;
  }

  console.log("\nElectric Lamb size budget passed.");
}

function findElectronDmg() {
  if (!fs.existsSync(releaseDir)) return "";
  return fs.readdirSync(releaseDir)
    .filter((name) => /^Electric Sheep-.*-arm64\.dmg$/.test(name))
    .map((name) => path.join(releaseDir, name))
    .sort()
    .pop() || "";
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

main();
