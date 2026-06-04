const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const OCR_HELPER_PATH = path.join(__dirname, "..", "scripts", "ocr.swift");

async function readImageText(filePath) {
  if (process.platform !== "darwin") {
    return { text: "", status: "failed" };
  }

  try {
    await fs.access(OCR_HELPER_PATH);
    const { stdout } = await execFileAsync("swift", [OCR_HELPER_PATH, filePath], {
      maxBuffer: 1024 * 1024,
      timeout: 30000
    });
    const text = stdout.trim();
    return {
      text,
      status: text ? "processed" : "empty"
    };
  } catch (error) {
    console.warn(`OCR failed for ${filePath}: ${error.message}`);
    return { text: "", status: "failed" };
  }
}

module.exports = {
  readImageText
};
