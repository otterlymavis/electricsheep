function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function compactLines(transcript) {
  return stripAnsi(transcript)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function findCommandLines(lines) {
  return lines
    .filter((line) => /^(npm|pnpm|yarn|node|python|pip|git|gh|docker|kubectl|curl|npx|bun|deno|cargo|go|rustc)\b/.test(line))
    .slice(-12);
}

function findErrorLines(lines) {
  return lines
    .filter((line) => /(error|failed|exception|traceback|fatal|denied|not found|cannot|warning)/i.test(line))
    .slice(-12);
}

function buildWrapUp({ command, startedAt, endedAt, exitCode, transcript }) {
  const lines = compactLines(transcript);
  const commandLines = findCommandLines(lines);
  const errorLines = findErrorLines(lines);
  const durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  const interestingLines = lines
    .filter((line) => line.length > 24)
    .slice(-10);

  const sections = [
    "# Session Wrap-Up",
    "",
    `Command: \`${command}\``,
    `Started: ${startedAt}`,
    `Ended: ${endedAt}`,
    `Duration: ${formatDuration(durationMs)}`,
    `Exit code: ${exitCode ?? "unknown"}`,
    "",
    "## Summary",
    "",
    `Captured ${lines.length} transcript lines. This automatic wrap-up is local and heuristic; it is meant as a quick index, not a final analysis.`,
    "",
    "## Recent Useful Lines",
    "",
    ...formatBullets(interestingLines),
    "",
    "## Commands Seen",
    "",
    ...formatBullets(commandLines),
    "",
    "## Possible Issues",
    "",
    ...formatBullets(errorLines)
  ];

  return `${sections.join("\n")}\n`;
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "unknown";
  const seconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) return `${remainingSeconds}s`;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatBullets(lines) {
  if (lines.length === 0) return ["- None detected."];
  return lines.map((line) => `- ${line}`);
}

module.exports = {
  buildWrapUp,
  stripAnsi
};
