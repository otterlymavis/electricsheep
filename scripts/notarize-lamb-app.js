#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.join(__dirname, "..");
const releaseDir = path.join(projectRoot, "release");
const appPath = path.join(releaseDir, "standalone", "Electric Lamb.app");
const notarizedZip = path.join(releaseDir, "Electric Lamb-standalone-notarized-mac.zip");
const identity = process.env.ELECTRIC_LAMB_DEVELOPER_ID || "";
const keychainProfile = process.env.ELECTRIC_LAMB_NOTARY_PROFILE || "";

async function main() {
  if (process.platform !== "darwin") {
    throw new Error("notarization requires macOS");
  }
  if (!identity.includes("Developer ID Application:")) {
    throw new Error("set ELECTRIC_LAMB_DEVELOPER_ID to a Developer ID Application signing identity");
  }
  if (!keychainProfile) {
    throw new Error("set ELECTRIC_LAMB_NOTARY_PROFILE to a notarytool keychain profile");
  }

  await fs.access(appPath);
  signApp();
  await zipApp(notarizedZip);
  submitForNotarization();
  stapleApp();
  validateStaple();
  await zipApp(notarizedZip);

  console.log(`Wrote notarized ZIP: ${notarizedZip}`);
}

function signApp() {
  run("codesign", [
    "--force",
    "--deep",
    "--options",
    "runtime",
    "--timestamp",
    "--sign",
    identity,
    appPath
  ]);
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
}

async function zipApp(zipPath) {
  await fs.rm(zipPath, { force: true });
  run("ditto", ["-c", "-k", "--keepParent", appPath, zipPath]);
}

function submitForNotarization() {
  run("xcrun", [
    "notarytool",
    "submit",
    notarizedZip,
    "--keychain-profile",
    keychainProfile,
    "--wait"
  ]);
}

function stapleApp() {
  run("xcrun", ["stapler", "staple", appPath]);
}

function validateStaple() {
  run("xcrun", ["stapler", "validate", appPath]);
  run("spctl", ["--assess", "--type", "execute", "--verbose=4", appPath]);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
