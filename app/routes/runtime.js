const { prewarmRepoContextSummaries } = require("../providers/openai");
const { getObservabilitySettings, collectMetricCounters, getJobStatusSnapshot, buildRuntimeAlerts } = require("../metrics");

module.exports = function registerRuntimeRoutes(app, deps) {
  const {
    auth,
    badRequest,
    db,
    nowIso,
    queueNamePattern,
    readRuntimeToolsPrefs,
    splitCsvList,
    getConfig,
    envOrConfig,
    envIntOrConfig,
    envBoolOrConfig,
    normalizeQueueName
  } = deps;

  // GET /v1/runtime/providers
  app.get("/v1/runtime/providers", auth, (req, res) => {
    const codexEnabled = envBoolOrConfig("CODEX_OSS_ENABLED", "providers.codex_oss.enabled", false);
    const codexExecMode = String(envOrConfig("CODEX_EXEC_MODE", "providers.codex_oss.exec_mode", "online")).trim().toLowerCase();
    const codexModel = String(process.env.CODEX_OSS_MODEL || getConfig("providers.codex_oss.model", "") || "").trim();
    const codexLocalProvider = String(envOrConfig("CODEX_OSS_LOCAL_PROVIDER", "providers.codex_oss.local_provider", "ollama")).trim().toLowerCase();
    const codexCliPath = String(envOrConfig("CODEX_CLI_PATH", "providers.codex_oss.cli_path", "codex")).trim();
    const codexTimeoutMs = envIntOrConfig("CODEX_OSS_TIMEOUT_MS", "providers.codex_oss.timeout_ms", 60000);

    const openAiEnabled = envBoolOrConfig("OPENAI_ENABLED", "providers.openai.enabled", false);
    const openAiModel = String(envOrConfig("OPENAI_MODEL", "providers.openai.model", "gpt-4.1-mini")).trim();
    const openAiBaseUrl = String(envOrConfig("OPENAI_BASE_URL", "providers.openai.base_url", "https://api.openai.com")).trim();
    const openAiChatCompletionsPath = String(
      envOrConfig("OPENAI_CHAT_COMPLETIONS_PATH", "providers.openai.chat_completions_path", "/v1/chat/completions")
    ).trim();
    const openAiTimeoutMs = envIntOrConfig("OPENAI_TIMEOUT_MS", "providers.openai.timeout_ms", 30000);

    if (String(req.auth?.role || "") === "read") {
      return res.json({
        ok: true,
        providers: {
          codex: { enabled: codexEnabled },
          openai: { enabled: openAiEnabled }
        }
      });
    }

    res.json({
      ok: true,
      providers: {
        codex: {
          enabled: codexEnabled,
          exec_mode: codexExecMode,
          model: codexModel || null,
          local_provider: codexExecMode === "oss" ? codexLocalProvider : null,
          cli_path: codexCliPath || "codex",
          timeout_ms: codexTimeoutMs
        },
        openai: {
          enabled: openAiEnabled,
          model: openAiModel || null,
          base_url: openAiBaseUrl,
          chat_completions_path: openAiChatCompletionsPath || "/v1/chat/completions",
          timeout_ms: openAiTimeoutMs
        }
      }
    });
  });

  // GET /v1/runtime/handlers
  app.get("/v1/runtime/handlers", auth, (req, res) => {
    const runtimeTools = readRuntimeToolsPrefs();
    const deployAllowlistEnvName = String(getConfig("handlers.deploy.allowlist_env", "DEPLOY_TARGET_ALLOWLIST"));
    const deployFallbackTargets = getConfig("handlers.deploy.default_allowed_targets", ["staging"]);
    const deployFallbackCsv = Array.isArray(deployFallbackTargets) ? deployFallbackTargets.join(",") : "staging";
    const deployTargets = splitCsvList(process.env[deployAllowlistEnvName] || deployFallbackCsv);

    const toolExecEnabledEnvName = String(getConfig("handlers.exec.enabled_env", "TOOL_EXEC_ENABLED"));
    const toolExecAllowlistEnvName = String(getConfig("handlers.exec.allowlist_env", "TOOL_EXEC_ALLOWLIST"));
    const toolExecTimeoutEnvName = String(getConfig("handlers.exec.timeout_env", "TOOL_EXEC_TIMEOUT_MS"));
    const toolExecEnabled = envBoolOrConfig(toolExecEnabledEnvName, "handlers.exec.enabled", false);
    const toolExecAllowlist = splitCsvList(process.env[toolExecAllowlistEnvName] || "");
    const toolExecTimeoutMs = envIntOrConfig(toolExecTimeoutEnvName, "handlers.exec.default_timeout_ms", 10000);
    const toolExecEffectiveEnabled = typeof runtimeTools.tool_exec.enabled === "boolean" ? runtimeTools.tool_exec.enabled : toolExecEnabled;
    const toolExecEffectiveAllowlist = Array.isArray(runtimeTools.tool_exec.allowlist) && runtimeTools.tool_exec.allowlist.length > 0
      ? runtimeTools.tool_exec.allowlist
      : toolExecAllowlist;
    const toolExecEffectiveTimeoutMs = Number.isInteger(runtimeTools.tool_exec.timeout_ms)
      ? runtimeTools.tool_exec.timeout_ms
      : toolExecTimeoutMs;

    const dataFetchEnabledEnvName = String(getConfig("handlers.data_fetch.enabled_env", "DATA_FETCH_ENABLED"));
    const dataFetchAllowlistEnvName = String(getConfig("handlers.data_fetch.allowlist_env", "DATA_FETCH_ALLOWLIST"));
    const dataFetchTimeoutEnvName = String(getConfig("handlers.data_fetch.timeout_env", "DATA_FETCH_TIMEOUT_MS"));
    const dataFetchMaxBytesEnvName = String(getConfig("handlers.data_fetch.max_bytes_env", "DATA_FETCH_MAX_BYTES"));
    const dataFetchEnabled = envBoolOrConfig(dataFetchEnabledEnvName, "handlers.data_fetch.enabled", false);
    const dataFetchAllowlist = splitCsvList(process.env[dataFetchAllowlistEnvName] || "");
    const dataFetchTimeoutMs = envIntOrConfig(dataFetchTimeoutEnvName, "handlers.data_fetch.default_timeout_ms", 8000);
    const dataFetchMaxBytes = envIntOrConfig(dataFetchMaxBytesEnvName, "handlers.data_fetch.default_max_bytes", 65536);
    const dataFetchEffectiveEnabled = typeof runtimeTools.data_fetch.enabled === "boolean" ? runtimeTools.data_fetch.enabled : dataFetchEnabled;
    const dataFetchEffectiveAllowlist = Array.isArray(runtimeTools.data_fetch.allowlist) && runtimeTools.data_fetch.allowlist.length > 0
      ? runtimeTools.data_fetch.allowlist
      : dataFetchAllowlist;
    const dataFetchEffectiveTimeoutMs = Number.isInteger(runtimeTools.data_fetch.timeout_ms)
      ? runtimeTools.data_fetch.timeout_ms
      : dataFetchTimeoutMs;
    const dataFetchEffectiveMaxBytes = Number.isInteger(runtimeTools.data_fetch.max_bytes)
      ? runtimeTools.data_fetch.max_bytes
      : dataFetchMaxBytes;

    const webSearchEnabledEnvName = String(getConfig("handlers.web_search.enabled_env", "WEB_SEARCH_ENABLED"));
    const webSearchProviderEnvName = String(getConfig("handlers.web_search.provider_env", "WEB_SEARCH_PROVIDER"));
    const webSearchTimeoutEnvName = String(getConfig("handlers.web_search.timeout_env", "WEB_SEARCH_TIMEOUT_MS"));
    const webSearchMaxResultsEnvName = String(getConfig("handlers.web_search.max_results_env", "WEB_SEARCH_MAX_RESULTS"));
    const webSearchBaseUrlEnvName = String(getConfig("handlers.web_search.base_url_env", "WEB_SEARCH_BASE_URL"));
    const webSearchBraveApiKeyEnvName = String(getConfig("handlers.web_search.brave_api_key_env", "WEB_SEARCH_BRAVE_API_KEY"));
    const webSearchEnabled = envBoolOrConfig(webSearchEnabledEnvName, "handlers.web_search.enabled", false);
    const webSearchProvider = String(envOrConfig(webSearchProviderEnvName, "handlers.web_search.default_provider", "duckduckgo")).trim().toLowerCase() || "duckduckgo";
    const webSearchTimeoutMs = envIntOrConfig(webSearchTimeoutEnvName, "handlers.web_search.default_timeout_ms", 8000);
    const webSearchMaxResults = envIntOrConfig(webSearchMaxResultsEnvName, "handlers.web_search.default_max_results", 5);
    const webSearchBaseUrl = String(envOrConfig(webSearchBaseUrlEnvName, "handlers.web_search.default_base_url", "https://api.duckduckgo.com"));
    const webSearchBraveApiKey = String(process.env[webSearchBraveApiKeyEnvName] || "").trim();
    const webSearchEffectiveEnabled = typeof runtimeTools.web_search.enabled === "boolean" ? runtimeTools.web_search.enabled : webSearchEnabled;
    const webSearchProviderOverride = String(runtimeTools.web_search.provider || "").trim().toLowerCase();
    const webSearchEffectiveProvider = (webSearchProviderOverride === "duckduckgo" || webSearchProviderOverride === "brave")
      ? webSearchProviderOverride
      : webSearchProvider;
    const webSearchEffectiveTimeoutMs = Number.isInteger(runtimeTools.web_search.timeout_ms)
      ? runtimeTools.web_search.timeout_ms
      : webSearchTimeoutMs;
    const webSearchEffectiveMaxResults = Number.isInteger(runtimeTools.web_search.max_results)
      ? runtimeTools.web_search.max_results
      : webSearchMaxResults;
    const webSearchEffectiveBaseUrl = String(runtimeTools.web_search.base_url || webSearchBaseUrl || "").trim() || "https://api.duckduckgo.com";
    const webSearchEffectiveBraveApiKey = Object.prototype.hasOwnProperty.call(runtimeTools.web_search, "brave_api_key")
      ? String(runtimeTools.web_search.brave_api_key || "").trim()
      : webSearchBraveApiKey;
    const webSearchEffectiveBraveConfigured = webSearchEffectiveBraveApiKey.length > 0;

    if (String(req.auth?.role || "") === "read") {
      return res.json({
        ok: true,
        handlers: {
          deploy: { enabled: deployTargets.length > 0 },
          tool_exec: { enabled: toolExecEffectiveEnabled },
          data_fetch: { enabled: dataFetchEffectiveEnabled },
          web_search: { enabled: webSearchEffectiveEnabled, provider: webSearchEffectiveProvider }
        }
      });
    }

    return res.json({
      ok: true,
      handlers: {
        deploy: {
          enabled: deployTargets.length > 0,
          allowed_targets: deployTargets
        },
        tool_exec: {
          enabled: toolExecEffectiveEnabled,
          allowlist_count: toolExecEffectiveAllowlist.length,
          allowlist: toolExecEffectiveAllowlist,
          timeout_ms: toolExecEffectiveTimeoutMs
        },
        data_fetch: {
          enabled: dataFetchEffectiveEnabled,
          allowlist_count: dataFetchEffectiveAllowlist.length,
          allowlist: dataFetchEffectiveAllowlist,
          timeout_ms: dataFetchEffectiveTimeoutMs,
          max_bytes: dataFetchEffectiveMaxBytes
        },
        web_search: {
          enabled: webSearchEffectiveEnabled,
          provider: webSearchEffectiveProvider,
          brave_api_key_configured: webSearchEffectiveBraveConfigured,
          timeout_ms: webSearchEffectiveTimeoutMs,
          max_results: webSearchEffectiveMaxResults,
          base_url: webSearchEffectiveBaseUrl
        }
      }
    });
  });

  // GET /v1/runtime/metrics
  app.get("/v1/runtime/metrics", auth, (req, res) => {
    const settings = getObservabilitySettings();
    const windowSec = Math.max(60, Math.min(7 * 24 * 3600, parseInt(String(req.query.window_sec || settings.alertWindowSec), 10) || settings.alertWindowSec));
    const queueParam = normalizeQueueName(req.query.queue);
    if (queueParam && !queueNamePattern.test(queueParam)) {
      return badRequest(res, "VALIDATION_ERROR", "'queue' must match ^[a-z0-9._:-]{1,80}$");
    }
    const allowedQueues = Array.isArray(req.auth?.queue_allowlist) ? req.auth.queue_allowlist : null;
    if (allowedQueues && queueParam && !allowedQueues.includes(queueParam)) {
      return res.status(403).json({
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: `Queue '${queueParam}' is not allowed for this API key.`,
          details: { allowed_queues: allowedQueues }
        }
      });
    }
    const queueScope = queueParam ? [queueParam] : (allowedQueues || null);
    const metricAgg = collectMetricCounters(db, windowSec, queueScope);
    const jobStatus = getJobStatusSnapshot(db, queueScope);
    const alerts = buildRuntimeAlerts(db, settings, windowSec, queueScope);
    return res.json({
      ok: true,
      metrics: {
        enabled: settings.enabled,
        generated_at: nowIso(),
        window_sec: metricAgg.windowSec,
        counters: metricAgg.counters,
        job_status: jobStatus
      },
      alerts
    });
  });

  // POST /v1/runtime/repo-context/prewarm
  app.post("/v1/runtime/repo-context/prewarm", auth, (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const type = String(body.type || "").trim();
    const input = body.input && typeof body.input === "object" ? body.input : {};
    if (type && type !== "ai.chat.generate") {
      return res.json({
        ok: true,
        skipped: true,
        reason: `type '${type}' is not supported for repo-context prewarm`
      });
    }
    try {
      const out = prewarmRepoContextSummaries(input);
      return res.json({ ok: true, type: "ai.chat.generate", ...out });
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: {
          code: "PREWARM_FAILED",
          message: String(e?.message || e)
        }
      });
    }
  });
};
