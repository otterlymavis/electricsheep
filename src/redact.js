const SECRET_PATTERNS = [
  /\b(sk-[A-Za-z0-9_-]{20,})\b/g,
  /\b(xox[baprs]-[A-Za-z0-9-]{20,})\b/g,
  /\b(gh[pousr]_[A-Za-z0-9_]{20,})\b/g,
  /\b(glpat-[A-Za-z0-9_-]{20,})\b/g,
  /\b(AKIA[0-9A-Z]{16})\b/g,
  /\b(AIza[0-9A-Za-z_-]{30,})\b/g,
  /\b([A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)[A-Za-z0-9_]*\s*=\s*)([^\s"']+)/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
];

function redactSecrets(value) {
  let redacted = String(value || "");
  let count = 0;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (...args) => {
      count += 1;
      if (args.length > 3 && /=$/.test(args[1]?.trim?.() || "")) {
        return `${args[1]}[REDACTED]`;
      }
      return "[REDACTED]";
    });
  }
  return { text: redacted, count };
}

module.exports = {
  redactSecrets
};
