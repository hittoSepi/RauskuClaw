/**
 * Memory tools for RauskuClaw MCP server
 */

const {
  listMemory,
  getMemoryScopes,
  getMemory,
  writeMemory,
  deleteMemory,
  resetMemory,
  searchMemory,
  listWorkingMemory,
  getLatestWorkingMemory,
  saveWorkingMemory,
  clearWorkingMemory,
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

const memoryList = {
  name: 'memory_list',
  description: 'List memory entries with optional filters. Memory stores key-value data with optional TTL.',
  inputSchema: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        description: 'Filter by scope (namespace for memory entries)',
      },
      key: {
        type: 'string',
        description: 'Filter by key',
      },
      include_expired: {
        type: 'boolean',
        description: 'Include expired entries',
        default: false,
      },
      limit: {
        type: 'integer',
        description: 'Maximum entries to return',
        minimum: 1,
        maximum: 500,
        default: 100,
      },
    },
  },
  handler: async (args) => {
    const result = await listMemory({
      scope: args.scope,
      key: args.key,
      include_expired: args.include_expired ? '1' : '0',
      limit: args.limit,
    });

    if (!result.ok) {
      return formatError(result);
    }

    const memories = result.data.memories || [];
    const summary = memories.map((m) => ({
      id: m.id,
      scope: m.scope,
      key: m.key,
      tags: m.tags,
      created_at: m.created_at,
      expires_at: m.expires_at,
      embedding_status: m.embedding_status,
    }));

    return formatSuccess(summary, `Found ${memories.length} memory entries:\n${JSON.stringify(summary, null, 2)}`);
  },
};

const memoryScopes = {
  name: 'memory_scopes',
  description: 'List all memory scopes with aggregate counts.',
  inputSchema: {
    type: 'object',
    properties: {
      q: {
        type: 'string',
        description: 'Search query for scope names',
      },
      include_expired: {
        type: 'boolean',
        description: 'Include expired entries in counts',
        default: false,
      },
      limit: {
        type: 'integer',
        description: 'Maximum scopes to return',
        minimum: 1,
        maximum: 1000,
        default: 200,
      },
    },
  },
  handler: async (args) => {
    const result = await getMemoryScopes({
      q: args.q,
      include_expired: args.include_expired ? '1' : '0',
      limit: args.limit,
    });

    if (!result.ok) {
      return formatError(result);
    }

    const scopes = result.data.scopes || [];
    return formatSuccess(scopes, `Memory scopes (${scopes.length}):\n${JSON.stringify(scopes, null, 2)}`);
  },
};

const memoryGet = {
  name: 'memory_get',
  description: 'Get a specific memory entry by ID.',
  inputSchema: {
    type: 'object',
    properties: {
      memory_id: {
        type: 'string',
        description: 'Memory entry ID (UUID)',
      },
    },
    required: ['memory_id'],
  },
  handler: async (args) => {
    const result = await getMemory(args.memory_id);

    if (!result.ok) {
      return formatError(result);
    }

    return formatSuccess(result.data.memory, `Memory entry:\n${JSON.stringify(result.data.memory, null, 2)}`);
  },
};

const memoryWrite = {
  name: 'memory_write',
  description: 'Create or update a memory entry. Memory is a key-value store with optional semantic search.',
  inputSchema: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        description: 'Scope (namespace) for the memory entry',
      },
      key: {
        type: 'string',
        description: 'Key within the scope',
      },
      value: {
        description: 'Value to store (any JSON value)',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for categorization',
      },
      ttl_sec: {
        type: 'integer',
        description: 'Time-to-live in seconds',
        minimum: 1,
        maximum: 31536000,
      },
    },
    required: ['scope', 'key', 'value'],
  },
  handler: async (args) => {
    const result = await writeMemory({
      scope: args.scope,
      key: args.key,
      value: args.value,
      tags: args.tags,
      ttl_sec: args.ttl_sec,
    });

    if (!result.ok) {
      return formatError(result);
    }

    return formatSuccess(result.data.memory, `Memory saved:\nScope: ${args.scope}\nKey: ${args.key}\nID: ${result.data.memory.id}`);
  },
};

const memoryDelete = {
  name: 'memory_delete',
  description: 'Delete a memory entry by ID.',
  inputSchema: {
    type: 'object',
    properties: {
      memory_id: {
        type: 'string',
        description: 'Memory entry ID (UUID)',
      },
    },
    required: ['memory_id'],
  },
  handler: async (args) => {
    const result = await deleteMemory(args.memory_id);

    if (!result.ok) {
      return formatError(result);
    }

    return formatSuccess(result.data, `Memory deleted: ${args.memory_id}`);
  },
};

const memoryReset = {
  name: 'memory_reset',
  description: 'Destructive reset of memory. Can reset all memory or a specific scope. Requires confirmation.',
  inputSchema: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        description: 'Scope to reset (if omitted, resets all memory)',
      },
      confirm: {
        type: 'boolean',
        description: 'Must be true to confirm the destructive operation',
      },
    },
    required: ['confirm'],
  },
  handler: async (args) => {
    if (!args.confirm) {
      return formatError({
        error: {
          code: 'CONFIRMATION_REQUIRED',
          message: 'Set confirm=true to proceed with memory reset',
        },
      });
    }

    const result = await resetMemory({
      scope: args.scope,
      confirm: true,
    });

    if (!result.ok) {
      return formatError(result);
    }

    return formatSuccess(result.data, `Memory reset completed:\nDeleted: ${result.data.deleted_memories} entries\nScope: ${args.scope || 'all'}`);
  },
};

const memorySearch = {
  name: 'memory_search',
  description: 'Semantic search in memory using vector embeddings. Requires MEMORY_VECTOR_ENABLED=1 on the server.',
  inputSchema: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        description: 'Scope to search within',
      },
      query: {
        type: 'string',
        description: 'Search query text',
      },
      top_k: {
        type: 'integer',
        description: 'Maximum results to return',
        minimum: 1,
        maximum: 100,
        default: 10,
      },
      include_expired: {
        type: 'boolean',
        description: 'Include expired entries',
        default: false,
      },
    },
    required: ['scope', 'query'],
  },
  handler: async (args) => {
    const result = await searchMemory({
      scope: args.scope,
      query: args.query,
      top_k: args.top_k,
      include_expired: args.include_expired,
    });

    if (!result.ok) {
      return formatError(result);
    }

    const matches = result.data.matches || [];
    const summary = matches.map((m) => ({
      id: m.memory.id,
      key: m.memory.key,
      score: m.score,
      value: m.memory.value,
    }));

    return formatSuccess(summary, `Found ${matches.length} match(es):\n${JSON.stringify(summary, null, 2)}`);
  },
};

// Working Memory tools

const workingMemoryList = {
  name: 'working_memory_list',
  description: 'List recent working memory sessions.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'integer',
        description: 'Maximum sessions to return',
        minimum: 1,
        maximum: 100,
        default: 10,
      },
    },
  },
  handler: async (args) => {
    const result = await listWorkingMemory({ limit: args.limit });

    if (!result.ok) {
      return formatError(result);
    }

    const sessions = result.data.sessions || [];
    return formatSuccess(sessions, `Working memory sessions (${sessions.length}):\n${JSON.stringify(sessions, null, 2)}`);
  },
};

const workingMemoryGet = {
  name: 'working_memory_get',
  description: 'Get the latest working memory session or a specific session.',
  inputSchema: {
    type: 'object',
    properties: {
      session_id: {
        type: 'string',
        description: 'Session ID (if omitted, gets latest)',
      },
    },
  },
  handler: async (args) => {
    let result;
    if (args.session_id) {
      result = await listWorkingMemory({ session_id: args.session_id });
    } else {
      result = await getLatestWorkingMemory();
    }

    if (!result.ok) {
      return formatError(result);
    }

    return formatSuccess(result.data.state, `Working memory:\n${JSON.stringify(result.data.state, null, 2)}`);
  },
};

const workingMemorySave = {
  name: 'working_memory_save',
  description: 'Save working memory state for a session.',
  inputSchema: {
    type: 'object',
    properties: {
      session_id: {
        type: 'string',
        description: 'Session ID (auto-generated if not provided)',
      },
      state: {
        type: 'object',
        description: 'State data to save',
      },
      ttl_sec: {
        type: 'integer',
        description: 'Time-to-live in seconds',
        minimum: 60,
        maximum: 604800,
      },
    },
    required: ['state'],
  },
  handler: async (args) => {
    const result = await saveWorkingMemory({
      session_id: args.session_id,
      state: args.state,
      ttl_sec: args.ttl_sec,
    });

    if (!result.ok) {
      return formatError(result);
    }

    return formatSuccess(result.data, `Working memory saved:\nSession: ${result.data.session_id}`);
  },
};

const workingMemoryClear = {
  name: 'working_memory_clear',
  description: 'Clear working memory for a session.',
  inputSchema: {
    type: 'object',
    properties: {
      session_id: {
        type: 'string',
        description: 'Session ID to clear',
      },
    },
    required: ['session_id'],
  },
  handler: async (args) => {
    const result = await clearWorkingMemory(args.session_id);

    if (!result.ok) {
      return formatError(result);
    }

    return formatSuccess(result.data, `Working memory cleared:\nSession: ${args.session_id}\nDeleted: ${result.data.deleted_entries} entries`);
  },
};

module.exports = {
  memoryList,
  memoryScopes,
  memoryGet,
  memoryWrite,
  memoryDelete,
  memoryReset,
  memorySearch,
  workingMemoryList,
  workingMemoryGet,
  workingMemorySave,
  workingMemoryClear,
};