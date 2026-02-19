/**
 * Resource handlers for RauskuClaw MCP server
 */

const {
  listJobs,
  getJob,
  listMemory,
  getMemory,
  getMemoryScopes,
  listSchedules,
  getSchedule,
  listWorkspace,
  readFile,
  getProviders,
  getHandlers,
} = require('../api-client');

/**
 * Resource URI patterns
 */
const RESOURCE_PATTERNS = {
  JOB: /^rauskuclaw:\/\/jobs\/([a-f0-9-]+)$/i,
  JOBS_LIST: /^rauskuclaw:\/\/jobs(\?.*)?$/i,
  MEMORY_ENTRY: /^rauskuclaw:\/\/memory\/([^\/]+)\/([^\/]+)$/i,
  MEMORY_SCOPE: /^rauskuclaw:\/\/memory\/scopes$/i,
  SCHEDULE: /^rauskuclaw:\/\/schedules\/([a-f0-9-]+)$/i,
  SCHEDULES_LIST: /^rauskuclaw:\/\/schedules$/i,
  WORKSPACE_FILE: /^rauskuclaw:\/\/workspace\/(.+)$/i,
  RUNTIME_PROVIDERS: /^rauskuclaw:\/\/runtime\/providers$/i,
  RUNTIME_HANDLERS: /^rauskuclaw:\/\/runtime\/handlers$/i,
};

/**
 * List all available resources
 */
async function listResources() {
  const resources = [];

  // Add static resource templates
  resources.push({
    uri: 'rauskuclaw://jobs',
    name: 'Jobs List',
    description: 'List of all jobs in the queue',
    mimeType: 'application/json',
  });

  resources.push({
    uri: 'rauskuclaw://memory/scopes',
    name: 'Memory Scopes',
    description: 'List of memory scopes with counts',
    mimeType: 'application/json',
  });

  resources.push({
    uri: 'rauskuclaw://schedules',
    name: 'Schedules List',
    description: 'List of all recurring schedules',
    mimeType: 'application/json',
  });

  resources.push({
    uri: 'rauskuclaw://runtime/providers',
    name: 'Runtime Providers',
    description: 'AI provider configuration status',
    mimeType: 'application/json',
  });

  resources.push({
    uri: 'rauskuclaw://runtime/handlers',
    name: 'Runtime Handlers',
    description: 'Built-in handler status',
    mimeType: 'application/json',
  });

  resources.push({
    uri: 'rauskuclaw://workspace',
    name: 'Workspace Root',
    description: 'Workspace file browser',
    mimeType: 'application/json',
  });

  return resources;
}

/**
 * Read a specific resource by URI
 */
async function readResource(uri) {
  // Jobs list
  if (RESOURCE_PATTERNS.JOBS_LIST.test(uri)) {
    const result = await listJobs({ limit: 50 });
    if (!result.ok) {
      throw new Error(`Failed to list jobs: ${result.error?.message}`);
    }
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(result.data.jobs || [], null, 2),
        },
      ],
    };
  }

  // Single job
  const jobMatch = uri.match(RESOURCE_PATTERNS.JOB);
  if (jobMatch) {
    const jobId = jobMatch[1];
    const result = await getJob(jobId);
    if (!result.ok) {
      throw new Error(`Failed to get job: ${result.error?.message}`);
    }
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(result.data.job, null, 2),
        },
      ],
    };
  }

  // Memory scopes
  if (RESOURCE_PATTERNS.MEMORY_SCOPE.test(uri)) {
    const result = await getMemoryScopes({ limit: 100 });
    if (!result.ok) {
      throw new Error(`Failed to list memory scopes: ${result.error?.message}`);
    }
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(result.data.scopes || [], null, 2),
        },
      ],
    };
  }

  // Memory entry by scope/key
  const memoryMatch = uri.match(RESOURCE_PATTERNS.MEMORY_ENTRY);
  if (memoryMatch) {
    const scope = decodeURIComponent(memoryMatch[1]);
    const key = decodeURIComponent(memoryMatch[2]);
    const result = await listMemory({ scope, key, limit: 1 });
    if (!result.ok) {
      throw new Error(`Failed to get memory: ${result.error?.message}`);
    }
    const memories = result.data.memories || [];
    if (memories.length === 0) {
      throw new Error(`Memory entry not found: ${scope}/${key}`);
    }
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(memories[0], null, 2),
        },
      ],
    };
  }

  // Schedules list
  if (RESOURCE_PATTERNS.SCHEDULES_LIST.test(uri)) {
    const result = await listSchedules({ limit: 100 });
    if (!result.ok) {
      throw new Error(`Failed to list schedules: ${result.error?.message}`);
    }
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(result.data.schedules || [], null, 2),
        },
      ],
    };
  }

  // Single schedule
  const scheduleMatch = uri.match(RESOURCE_PATTERNS.SCHEDULE);
  if (scheduleMatch) {
    const scheduleId = scheduleMatch[1];
    const result = await getSchedule(scheduleId);
    if (!result.ok) {
      throw new Error(`Failed to get schedule: ${result.error?.message}`);
    }
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(result.data.schedule, null, 2),
        },
      ],
    };
  }

  // Workspace file
  const workspaceMatch = uri.match(RESOURCE_PATTERNS.WORKSPACE_FILE);
  if (workspaceMatch) {
    const filePath = decodeURIComponent(workspaceMatch[1]);
    const result = await readFile(filePath);
    if (!result.ok) {
      throw new Error(`Failed to read file: ${result.error?.message}`);
    }
    return {
      contents: [
        {
          uri,
          mimeType: 'text/plain',
          text: result.data.file.content,
        },
      ],
    };
  }

  // Runtime providers
  if (RESOURCE_PATTERNS.RUNTIME_PROVIDERS.test(uri)) {
    const result = await getProviders();
    if (!result.ok) {
      throw new Error(`Failed to get providers: ${result.error?.message}`);
    }
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(result.data.providers, null, 2),
        },
      ],
    };
  }

  // Runtime handlers
  if (RESOURCE_PATTERNS.RUNTIME_HANDLERS.test(uri)) {
    const result = await getHandlers();
    if (!result.ok) {
      throw new Error(`Failed to get handlers: ${result.error?.message}`);
    }
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(result.data.handlers, null, 2),
        },
      ],
    };
  }

  throw new Error(`Unknown resource URI: ${uri}`);
}

module.exports = {
  RESOURCE_PATTERNS,
  listResources,
  readResource,
};