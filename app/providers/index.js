const { runOpenAiChat } = require("./openai");
const { runCodexOssChat } = require("./codex_oss");

async function runProviderHandler(handler, input) {
  if (handler === "builtin:provider.codex.oss.chat") {
    return runCodexOssChat(input);
  }
  if (handler === "builtin:provider.openai.chat") {
    return runOpenAiChat(input);
  }
  throw new Error(`Unknown provider handler: ${handler}`);
}

module.exports = { runProviderHandler };
