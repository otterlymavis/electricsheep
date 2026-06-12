const fs = require("node:fs/promises");
const path = require("node:path");
const { redactSecrets } = require("./redact");
const { readSessions, updateSessions } = require("./store");
const { stripAnsi } = require("./wrapup");

async function repairLegacySessions() {
  const sessions = await readSessions();
  const prepared = [];
  const warnings = [];
  let checked = 0;
  let repaired = 0;
  let skipped = 0;

  for (const session of sessions) {
    checked += 1;
    const result = await prepareLegacySessionRepair(session);
    if (result.session) prepared.push(result.session);
    if (result.warning) warnings.push(result.warning);
    if (result.status === "repaired") repaired += 1;
    if (result.status === "skipped") skipped += 1;
  }

  if (prepared.length) {
    const repairedById = new Map(prepared.map((session) => [session.id, session]));
    await updateSessions((currentSessions) => currentSessions.map((session) => repairedById.get(session.id) || session));
  }

  return {
    checked,
    repaired,
    skipped,
    warningCount: warnings.length,
    warnings
  };
}

async function prepareLegacySessionRepair(session) {
  if (session.transcriptEventsPath) {
    return { status: "skipped" };
  }

  if (!session.transcriptPath) {
    return {
      status: "skipped",
      warning: {
        sessionId: session.id || "",
        command: session.command || "",
        reason: "missing transcript path"
      }
    };
  }

  try {
    const transcript = await fs.readFile(session.transcriptPath, "utf8");
    const transcriptEventsPath = path.join(path.dirname(session.transcriptPath), "transcript.jsonl");
    const repairedSession = {
      ...session,
      transcriptEventsPath,
      transcriptEventCount: 3,
      repairedStructuredTranscriptAt: new Date().toISOString()
    };
    const events = buildLegacyTranscriptEvents(repairedSession, transcript);
    repairedSession.redactionCount = events
      .filter((event) => event.kind === "session_start" || event.kind === "terminal_output")
      .reduce((count, event) => count + (event.redactionCount || 0), 0);

    await fs.writeFile(transcriptEventsPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
    if (repairedSession.metadataPath) {
      await writeMetadataIfPossible(repairedSession);
    }

    return { status: "repaired", session: repairedSession };
  } catch (error) {
    return {
      status: "skipped",
      warning: {
        sessionId: session.id || "",
        command: session.command || "",
        transcriptPath: session.transcriptPath,
        reason: error.code || error.message || "repair failed"
      }
    };
  }
}

function buildLegacyTranscriptEvents(session, transcript) {
  const redacted = redactSecrets(stripAnsi(transcript || ""));
  const redactedCommand = redactSecrets(session.command || "Legacy session");
  const text = redacted.text;
  const startedAt = session.startedAt || new Date().toISOString();
  const endedAt = session.endedAt || startedAt;
  const byteLength = Buffer.byteLength(transcript || "");
  const lineCount = text.split(/\r?\n/).filter(Boolean).length;

  return [
    {
      seq: 1,
      timestamp: startedAt,
      kind: "session_start",
      source: session.source || "legacy-repair",
      role: "system",
      command: redactedCommand.text,
      redactionCount: redactedCommand.count,
      repaired: true
    },
    {
      seq: 2,
      timestamp: startedAt,
      kind: "terminal_output",
      source: session.source || "legacy-repair",
      role: "terminal",
      byteLength,
      chunkCount: 1,
      redactionCount: redacted.count,
      text,
      repaired: true
    },
    {
      seq: 3,
      timestamp: endedAt,
      kind: "session_end",
      source: session.source || "legacy-repair",
      role: "system",
      exitCode: session.exitCode ?? null,
      durationMs: session.durationMs ?? null,
      lineCount,
      redactionCount: redacted.count,
      repaired: true
    }
  ];
}

async function writeMetadataIfPossible(session) {
  try {
    await fs.writeFile(session.metadataPath, JSON.stringify(session, null, 2), "utf8");
  } catch {}
}

module.exports = {
  repairLegacySessions
};
