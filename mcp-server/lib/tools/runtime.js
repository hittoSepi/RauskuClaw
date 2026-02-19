/**
 * Runtime status tools for RauskuClaw MCP server
 */

const {
  getProviders,
  getHandlers,
  getMetrics,
  getWhoami,
  getUiPrefs,
  setUiPrefs,
} = require('../api-client');

/**
 * Format API error for MCP tool response
 */
function formatError(result) {
  const error = result.error || {};
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `Error: ${error.code || 'UNKNOWN'} - ${error.message || 'Unknown error'}${error.details ? `\nDetails: ${JSON.stringify(error.details, null, 2)}` : ''}`,
      },
    ],
  };
}

/**
 * Format success response for MCP tool
 */
function formatSuccess(data, message) {
  return {
    content: [
      {
        type: 'text',
        text: message || JSON.stringify(data, null, 2),
      },
    ],
  };
}

const runtimeProviders = {
  name: 'runtime_providers',
  description: 'Get the status of AI providers (Codex, OpenAI) configured in RauskuClaw.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async () => {
    const result = await getProviders();

    if (!result.ok) {
      return formatError(result);
    }

    return formatSuccess(result.data.providers, `Provider status:\n${JSON.stringify(result.data.providers, null, 2)}`);
  },
};

const runtimeHandlers = {
  name: 'runtime_handlers',
  description: 'Get the status of built-in handlers (tool.exec, data.fetch, web_search, deploy).',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async () => {
    const result = await getHandlers();

    if (!result.ok) {
      return formatError(result);
    }

    return formatSuccess(result.data.handlers, `Handler status:\n${JSON.stringify(result.data.handlers, null, 2)}`);
  },
};

const runtimeMetrics = {
  name: 'runtime_metrics',
  description: 'Get runtime metrics and alerts for the job queue.',
  inputSchema: {
    type: 'object',
    properties: {
      window_sec: {
        type: 'integer',
        description: 'Time window for metrics in seconds',
        minimum: 60,
        maximum: 604800,
      },
      queue: {
        type: 'string',
        description: 'Filter by queue name',
      },
    },
  },
  handler: async (args) => {
    const query = {};
    if (args.window_sec) query.window_sec = args.window_sec;
    if (args.queue) query.queue = args.queue;

    const result = await getMetrics(query);

    if (!result.ok) {
      return formatError(result);
    }

    return formatSuccess(result.data, `Runtime metrics:\n${JSON.stringify(result.data, null, 2)}`);
  },
};

const runtimeWhoami = {
  name: 'runtime_whoami',
  description: 'Get information about the current API key and its permissions.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async () => {
    const result = await getWhoami();

    if (!result.ok) {
      return formatError(result);
    }

    return formatSuccess(result.data.auth, `Authentication info:\n${JSON.stringify(result.data.auth, null, 2)}`);
  },
};

const uiPrefsGet = {
  name: 'ui_prefs_get',
  description: 'Get UI preferences for a scope.',
  inputSchema: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        description: 'Preferences scope',
        default: 'default',
      },
    },
  },
  handler: async (args) => {
    const result = await getUiPrefs(args.scope || 'default');

    if (!result.ok) {
      return formatError(result);
    }

    return formatSuccess(result.data.prefs, `UI preferences (${result.data.scope}):\n${JSON.stringify(result.data.prefs, null, 2)}`);
  },
};

const uiPrefsSet = {
  name: 'ui_prefs_set',
  description: 'Set UI preferences for a scope.',
  inputSchema: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        description: 'Preferences scope',
        default: 'default',
      },
      prefs: {
        type: 'object',
        description: 'Preferences object to save',
      },
    },
    required: ['prefs'],
  },
  handler: async (args) => {
    const result = await setUiPrefs(args.scope || 'default', args.prefs);

    if (!result.ok) {
      return formatError(result);
    }

    return formatSuccess(result.data.prefs, `UI preferences saved for scope: ${result.data.scope}`);
  },
};

module.exports = {
  runtimeProviders,
  runtimeHandlers,
  runtimeMetrics,
  runtimeWhoami,
  uiPrefsGet,
  uiPrefsSet,
};