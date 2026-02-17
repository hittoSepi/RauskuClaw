const { getConfig, envOrConfig, envIntOrConfig, envBoolOrConfig } = require("../config");
const { createProviderError, toProviderError } = require("./errors");

function extractAssistantText(choice) {
  const content = choice?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function normalizeMessages(input) {
  if (Array.isArray(input?.messages) && input.messages.length > 0) {
    return input.messages
      .map((m) => ({
        role: String(m?.role || "user"),
        content: String(m?.content || "")
      }))
      .filter((m) => (m.role === "system" || m.role === "user" || m.role === "assistant") && m.content.trim().length > 0);
  }

  const prompt = String(input?.prompt || "").trim();
  const system = String(input?.system || "").trim();
  if (!prompt) throw createProviderError("PROVIDER_INPUT", "OpenAI chat input requires 'prompt' or 'messages'");

  const out = [];
  if (system) out.push({ role: "system", content: system });
  out.push({ role: "user", content: prompt });
  return out;
}

function openAiSettings() {
  const enabled = envBoolOrConfig("OPENAI_ENABLED", "providers.openai.enabled", false);
  const apiKeyEnv = String(getConfig("providers.openai.api_key_env", "OPENAI_API_KEY"));
  const apiKey = String(process.env[apiKeyEnv] || "").trim();
  const baseUrl = String(envOrConfig("OPENAI_BASE_URL", "providers.openai.base_url", "https://api.openai.com")).replace(/\/+$/, "");
  const model = String(envOrConfig("OPENAI_MODEL", "providers.openai.model", "gpt-4.1-mini")).trim();
  const timeoutMs = envIntOrConfig("OPENAI_TIMEOUT_MS", "providers.openai.timeout_ms", 30000);

  return { enabled, apiKeyEnv, apiKey, baseUrl, model, timeoutMs };
}

async function runOpenAiChat(input, options = {}) {
  const s = options.settings || openAiSettings();
  const fetchImpl = options.fetchImpl || fetch;
  if (!s.enabled) {
    throw createProviderError("PROVIDER_DISABLED", "OpenAI provider disabled. Set OPENAI_ENABLED=1 (or providers.openai.enabled=true).");
  }
  if (!s.apiKey) {
    throw createProviderError("PROVIDER_CONFIG", `OpenAI API key missing. Set ${s.apiKeyEnv}.`);
  }
  if (!s.model) {
    throw createProviderError("PROVIDER_CONFIG", "OpenAI model is empty.");
  }

  const messages = normalizeMessages(input || {});
  const payload = { model: s.model, messages };

  if (Number.isFinite(Number(input?.temperature))) {
    payload.temperature = Number(input.temperature);
  }
  if (Number.isInteger(input?.max_tokens) && input.max_tokens > 0) {
    payload.max_tokens = input.max_tokens;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1, s.timeoutMs));
  try {
    const resp = await fetchImpl(`${s.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${s.apiKey}`
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });

    const text = await resp.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }

    if (!resp.ok) {
      const msg = data?.error?.message || data?.error || text || `OpenAI error ${resp.status}`;
      throw createProviderError("PROVIDER_HTTP", String(msg), { status: resp.status });
    }

    const choice = data?.choices?.[0];
    const outputText = extractAssistantText(choice);
    if (!outputText.trim()) {
      throw createProviderError("PROVIDER_RESPONSE", "OpenAI returned empty assistant output.");
    }
    return {
      provider: "openai",
      model: data?.model || s.model,
      output_text: outputText,
      finish_reason: choice?.finish_reason || null,
      usage: data?.usage || null,
      id: data?.id || null
    };
  } catch (e) {
    if (e?.name === "AbortError") {
      throw createProviderError("PROVIDER_TIMEOUT", `OpenAI request timed out after ${s.timeoutMs}ms.`);
    }
    throw toProviderError(e, "PROVIDER_NETWORK", "OpenAI request failed");
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { runOpenAiChat, normalizeMessages, openAiSettings, extractAssistantText };
