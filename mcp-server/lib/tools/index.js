/**
 * Tool registry for RauskuClaw MCP server
 */

const jobsTools = require('./jobs');
const memoryTools = require('./memory');
const workspaceTools = require('./workspace');
const schedulesTools = require('./schedules');
const runtimeTools = require('./runtime');

/**
 * All available tools
 */
const allTools = [
  // Jobs
  jobsTools.jobsCreate,
  jobsTools.jobsList,
  jobsTools.jobsGet,
  jobsTools.jobsCancel,
  jobsTools.jobsLogs,
  jobsTools.jobTypesList,
  jobsTools.jobTypesCreate,
  jobsTools.jobTypesUpdate,

  // Memory
  memoryTools.memoryList,
  memoryTools.memoryScopes,
  memoryTools.memoryGet,
  memoryTools.memoryWrite,
  memoryTools.memoryDelete,
  memoryTools.memoryReset,
  memoryTools.memorySearch,
  memoryTools.workingMemoryList,
  memoryTools.workingMemoryGet,
  memoryTools.workingMemorySave,
  memoryTools.workingMemoryClear,

  // Workspace
  workspaceTools.workspaceList,
  workspaceTools.workspaceRead,
  workspaceTools.workspaceWrite,
  workspaceTools.workspaceDelete,
  workspaceTools.workspaceUpload,
  workspaceTools.workspaceCreate,
  workspaceTools.workspaceMove,

  // Schedules
  schedulesTools.schedulesList,
  schedulesTools.schedulesGet,
  schedulesTools.schedulesCreate,
  schedulesTools.schedulesUpdate,
  schedulesTools.schedulesDelete,

  // Runtime
  runtimeTools.runtimeProviders,
  runtimeTools.runtimeHandlers,
  runtimeTools.runtimeMetrics,
  runtimeTools.runtimeWhoami,
  runtimeTools.uiPrefsGet,
  runtimeTools.uiPrefsSet,
];

/**
 * Get all tool definitions (name, description, inputSchema)
 */
function getToolDefinitions() {
  return allTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

/**
 * Get tool handler by name
 * @param {string} name - Tool name
 * @returns {Function|null} - Tool handler or null if not found
 */
function getToolHandler(name) {
  const tool = allTools.find((t) => t.name === name);
  return tool ? tool.handler : null;
}

/**
 * Execute a tool by name
 * @param {string} name - Tool name
 * @param {object} args - Tool arguments
 * @returns {Promise<object>} - Tool result
 */
async function executeTool(name, args) {
  const handler = getToolHandler(name);
  if (!handler) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Unknown tool: ${name}`,
        },
      ],
    };
  }

  try {
    return await handler(args || {});
  } catch (e) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Tool execution error: ${e?.message || e}`,
        },
      ],
    };
  }
}

module.exports = {
  allTools,
  getToolDefinitions,
  getToolHandler,
  executeTool,
};