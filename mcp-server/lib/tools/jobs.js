/**
 * Job management tools for RauskuClaw MCP server
 */

const {
  createJob,
  listJobs,
  getJob,
  cancelJob,
  getJobLogs,
  listJobTypes,
  createJobType,
  updateJobType,
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

const jobsCreate = {
  name: 'jobs_create',
  description: 'Create a new job in RauskuClaw. Jobs are tasks that get queued and processed by workers.',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: 'Job type name (e.g., "ai.chat.generate", "data.file_read", "tools.web_search")',
      },
      input: {
        type: 'object',
        description: 'Job input data (varies by job type)',
      },
      queue: {
        type: 'string',
        description: 'Queue name (default: "default")',
        default: 'default',
      },
      priority: {
        type: 'integer',
        description: 'Job priority 0-10 (higher = more urgent)',
        minimum: 0,
        maximum: 10,
        default: 5,
      },
      timeout_sec: {
        type: 'integer',
        description: 'Job timeout in seconds',
        minimum: 1,
        maximum: 3600,
      },
      max_attempts: {
        type: 'integer',
        description: 'Maximum retry attempts',
        minimum: 1,
        maximum: 10,
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for categorizing the job',
      },
      callback_url: {
        type: 'string',
        description: 'URL to receive callback when job completes',
      },
    },
    required: ['type'],
  },
  handler: async (args) => {
    const result = await createJob({
      type: args.type,
      input: args.input,
      queue: args.queue,
      priority: args.priority,
      timeout_sec: args.timeout_sec,
      max_attempts: args.max_attempts,
      tags: args.tags,
      callback_url: args.callback_url,
    });

    if (!result.ok) {
      return formatError(result);
    }

    const job = result.data.job || result.data;
    return formatSuccess(job, `Job created successfully:\nID: ${job.id}\nType: ${job.type}\nStatus: ${job.status}\nQueue: ${job.queue || 'default'}`);
  },
};

const jobsList = {
  name: 'jobs_list',
  description: 'List jobs with optional filters. Returns most recent jobs first.',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['queued', 'running', 'succeeded', 'failed', 'cancelled'],
        description: 'Filter by job status',
      },
      type: {
        type: 'string',
        description: 'Filter by job type',
      },
      queue: {
        type: 'string',
        description: 'Filter by queue name',
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of jobs to return',
        minimum: 1,
        maximum: 200,
        default: 50,
      },
    },
  },
  handler: async (args) => {
    const result = await listJobs({
      status: args.status,
      type: args.type,
      queue: args.queue,
      limit: args.limit,
    });

    if (!result.ok) {
      return formatError(result);
    }

    const jobs = result.data.jobs || [];
    const summary = jobs.map((j) => ({
      id: j.id,
      type: j.type,
      status: j.status,
      queue: j.queue,
      created_at: j.created_at,
    }));

    return formatSuccess(summary, `Found ${jobs.length} job(s):\n${JSON.stringify(summary, null, 2)}`);
  },
};

const jobsGet = {
  name: 'jobs_get',
  description: 'Get detailed information about a specific job.',
  inputSchema: {
    type: 'object',
    properties: {
      job_id: {
        type: 'string',
        description: 'Job ID (UUID)',
      },
    },
    required: ['job_id'],
  },
  handler: async (args) => {
    const result = await getJob(args.job_id);

    if (!result.ok) {
      return formatError(result);
    }

    return formatSuccess(result.data.job, `Job details:\n${JSON.stringify(result.data.job, null, 2)}`);
  },
};

const jobsCancel = {
  name: 'jobs_cancel',
  description: 'Cancel a queued or running job.',
  inputSchema: {
    type: 'object',
    properties: {
      job_id: {
        type: 'string',
        description: 'Job ID (UUID)',
      },
    },
    required: ['job_id'],
  },
  handler: async (args) => {
    const result = await cancelJob(args.job_id);

    if (!result.ok) {
      return formatError(result);
    }

    return formatSuccess(result.data.job, `Job cancelled:\nID: ${result.data.job.id}\nStatus: ${result.data.job.status}`);
  },
};

const jobsLogs = {
  name: 'jobs_logs',
  description: 'Get execution logs for a job.',
  inputSchema: {
    type: 'object',
    properties: {
      job_id: {
        type: 'string',
        description: 'Job ID (UUID)',
      },
      tail: {
        type: 'integer',
        description: 'Number of log entries to return',
        minimum: 1,
        maximum: 2000,
        default: 200,
      },
    },
    required: ['job_id'],
  },
  handler: async (args) => {
    const result = await getJobLogs(args.job_id, args.tail);

    if (!result.ok) {
      return formatError(result);
    }

    const logs = result.data.logs || [];
    const formatted = logs.map((l) => `[${l.level}] ${l.ts}: ${l.message}`).join('\n');
    return formatSuccess(logs, `Job logs (${logs.length} entries):\n${formatted}`);
  },
};

const jobTypesList = {
  name: 'job_types_list',
  description: 'List all available job types.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async () => {
    const result = await listJobTypes();

    if (!result.ok) {
      return formatError(result);
    }

    const types = result.data.types || [];
    return formatSuccess(types, `Available job types (${types.length}):\n${JSON.stringify(types, null, 2)}`);
  },
};

const jobTypesCreate = {
  name: 'job_types_create',
  description: 'Create a new job type.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Job type name',
      },
      handler: {
        type: 'string',
        description: 'Handler name (e.g., "builtin:data.fetch")',
      },
      enabled: {
        type: 'boolean',
        description: 'Whether the job type is enabled',
        default: true,
      },
      default_timeout_sec: {
        type: 'integer',
        description: 'Default timeout in seconds',
        default: 120,
      },
      default_max_attempts: {
        type: 'integer',
        description: 'Default max retry attempts',
        default: 1,
      },
    },
    required: ['name', 'handler'],
  },
  handler: async (args) => {
    const result = await createJobType({
      name: args.name,
      handler: args.handler,
      enabled: args.enabled,
      default_timeout_sec: args.default_timeout_sec,
      default_max_attempts: args.default_max_attempts,
    });

    if (!result.ok) {
      return formatError(result);
    }

    return formatSuccess(result.data.type, `Job type created:\n${JSON.stringify(result.data.type, null, 2)}`);
  },
};

const jobTypesUpdate = {
  name: 'job_types_update',
  description: 'Update an existing job type.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Job type name to update',
      },
      enabled: {
        type: 'boolean',
        description: 'Enable or disable the job type',
      },
      handler: {
        type: 'string',
        description: 'New handler name',
      },
      default_timeout_sec: {
        type: 'integer',
        description: 'Default timeout in seconds',
      },
      default_max_attempts: {
        type: 'integer',
        description: 'Default max retry attempts',
      },
    },
    required: ['name'],
  },
  handler: async (args) => {
    const updateData = {};
    if (args.enabled !== undefined) updateData.enabled = args.enabled;
    if (args.handler !== undefined) updateData.handler = args.handler;
    if (args.default_timeout_sec !== undefined) updateData.default_timeout_sec = args.default_timeout_sec;
    if (args.default_max_attempts !== undefined) updateData.default_max_attempts = args.default_max_attempts;

    const result = await updateJobType(args.name, updateData);

    if (!result.ok) {
      return formatError(result);
    }

    return formatSuccess(result.data.type, `Job type updated:\n${JSON.stringify(result.data.type, null, 2)}`);
  },
};

module.exports = {
  jobsCreate,
  jobsList,
  jobsGet,
  jobsCancel,
  jobsLogs,
  jobTypesList,
  jobTypesCreate,
  jobTypesUpdate,
};