#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.join(__dirname, "..");
const releaseDir = path.join(projectRoot, "release");
const checks = [];
const mode = process.argv.includes("--public") ? "public" : "trusted";

function main() {
  check("Preflight mode", true, mode === "public" ? "public notarized release" : "trusted tester/local release");
  check("macOS", process.platform === "darwin", "required for app packaging");
  checkTool("swiftc");
  checkTool("curl");
  checkTool("tar");

  checkFile("Thin app zip", path.join(releaseDir, "Electric Lamb-mac.zip"));
  checkFile("Standalone app zip", path.join(releaseDir, "Electric Lamb-standalone-mac.zip"));
  checkFile("Static Lamb zip", path.join(releaseDir, "electric-lamb.zip"));
  checkFile("Release manifest", path.join(releaseDir, "electric-lamb-release.json"));
  checkFile("Standalone app bundle", path.join(releaseDir, "standalone", "Electric Lamb.app", "Contents", "MacOS", "Electric Lamb"));
  checkFile("Standalone bundled Node", path.join(releaseDir, "standalone", "Electric Lamb.app", "Contents", "Resources", "node", "bin", "node"));

  checkBundledNode();
  if (mode === "public") {
    checkTool("ditto");
    checkTool("codesign");
    checkTool("xcrun");
    checkXcrunTool("notarytool");
    checkXcrunTool("stapler");
    checkDeveloperId();
    checkNotaryProfile();
  }

  const failed = checks.filter((item) => !item.ok);
  for (const item of checks) {
    const mark = item.ok ? "ok" : "missing";
    console.log(`${mark}: ${item.name}${item.detail ? ` - ${item.detail}` : ""}`);
  }

  if (failed.length) {
    console.error(`\n${capitalize(mode)} preflight failed: ${failed.length} issue${failed.length === 1 ? "" : "s"} found.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nElectric Lamb ${mode} release preflight passed.`);
}

function check(name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok), detail });
}

function checkTool(command) {
  const result = spawnSync("/bin/sh", ["-lc", `command -v ${quoteShell(command)}`], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  check(command, result.status === 0, result.stdout.trim() || result.stderr.trim());
}

function quoteShell(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function checkXcrunTool(tool) {
  const result = spawnSync("xcrun", ["-f", tool], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  check(`xcrun ${tool}`, result.status === 0, result.stdout.trim() || result.stderr.trim());
}

function checkFile(name, filePath) {
  check(name, fs.existsSync(filePath), path.relative(projectRoot, filePath));
}

function checkBundledNode() {
  const nodePath = path.join(releaseDir, "standalone", "Electric Lamb.app", "Contents", "Resources", "node", "bin", "node");
  if (!fs.existsSync(nodePath)) return;

  const version = spawnSync(nodePath, ["-p", "process.version + ' ' + process.platform + ' ' + process.arch"], {
    cwd: projectRoot,
    encoding: "utf8"
  });
  check("Bundled Node runs", version.status === 0, version.stdout.trim() || version.stderr.trim());

  const deps = spawnSync("otool", ["-L", nodePath], {
    cwd: projectRoot,
    encoding: "utf8"
  });
  check("Bundled Node is portable", deps.status === 0 && !deps.stdout.includes("/opt/homebrew/"), "no Homebrew dylib links");
}

function checkDeveloperId() {
  const desired = process.env.ELECTRIC_LAMB_DEVELOPER_ID || "";
  const identities = spawnSync("security", ["find-identity", "-v", "-p", "codesigning"], {
    cwd: projectRoot,
    encoding: "utf8"
  });
  if (desired) {
    check("Developer ID identity", identities.stdout.includes(desired), desired);
    return;
  }
  check(
    "Developer ID identity",
    identities.stdout.includes("Developer ID Application:"),
    "set ELECTRIC_LAMB_DEVELOPER_ID for notarization"
  );
}

function checkNotaryProfile() {
  const profile = process.env.ELECTRIC_LAMB_NOTARY_PROFILE || "";
  if (!profile) {
    check("Notary profile", false, "set ELECTRIC_LAMB_NOTARY_PROFILE for notarization");
    return;
  }

  const result = spawnSync("xcrun", ["notarytool", "history", "--keychain-profile", profile], {
    cwd: projectRoot,
    encoding: "utf8"
  });
  check("Notary profile", result.status === 0, profile);
}

function capitalize(value) {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

main();
