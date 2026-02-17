const path = require("path");
const { pathToFileURL } = require("url");

function isCi() {
  return String(process.env.CI || "").toLowerCase() === "true" || process.env.CI === "1";
}

function shouldUseFancyUi() {
  if (String(process.env.RAUSKUCLAW_UI || "").toLowerCase() === "plain") return false;
  return Boolean(process.stdout.isTTY) && !isCi();
}

async function renderHeader(command) {
  if (!shouldUseFancyUi()) return;
  try {
    const modPath = pathToFileURL(path.join(__dirname, "ui-ink.mjs")).href;
    const mod = await import(modPath);
    await mod.renderCommandHeader({
      command: String(command || "help")
    });
  } catch {
    // Header is cosmetic. Ignore rendering failures.
  }
}

module.exports = {
  shouldUseFancyUi,
  renderHeader
};
