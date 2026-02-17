const { shouldUseFancyUi } = require("./ui");

const ANSI = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  gray: "\x1b[90m"
};

function colorize(color, text) {
  if (!shouldUseFancyUi()) return text;
  return `${ANSI[color] || ""}${text}${ANSI.reset}`;
}

function formatPrefix(level) {
  const base = "[rauskuclaw]";
  if (level === "warn") return colorize("yellow", base);
  if (level === "error") return colorize("red", base);
  return colorize("cyan", base);
}

function info(msg) {
  console.log(`${formatPrefix("info")} ${msg}`);
}

function warn(msg) {
  console.warn(`${formatPrefix("warn")} ${msg}`);
}

function error(msg) {
  console.error(`${formatPrefix("error")} ${msg}`);
}

function printCommand(cmd, args, cwd) {
  const full = [cmd, ...(args || [])].join(" ");
  const where = cwd ? ` ${colorize("gray", `(cwd: ${cwd})`)}` : "";
  info(`${colorize("gray", "run:")} ${full}${where}`);
}

module.exports = { info, warn, error, printCommand };
