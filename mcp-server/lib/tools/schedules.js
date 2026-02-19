/**
 * Schedule management tools for RauskuClaw MCP server
 */

const {
  listSchedules,
  getSchedule,
  createSchedule,
  updateSchedule,
  deleteSchedule,
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

const schedulesList = {
  name: 'schedules_list',
  description: 'List recurring schedules with optional filters.',
  inputSchema: {
    type: 'object',
    properties: {
      enabled: {
        type: 'boolean',
        description: 'Filter by enabled status',
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
        description: 'Maximum schedules to return',
        minimum: 1,
        maximum: 500,
        default: 100,
      },
    },
  },
  handler: async (args) => {
    const query = { limit: args.limit };
    if (args.enabled !== undefined) query.enabled = args.enabled ? '1' : '0';
    if (args.type) query.type = args.type;
    if (args.queue) query.queue = args.queue;

    const result = await listSchedules(query);

    if (!result.ok) {
      return formatError(result);
    }

    const schedules = result.data.schedules || [];
    const summary = schedules.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      queue: s.queue,
      enabled: s.enabled,
      next_run_at: s.next_run_at,
      interval_sec: s.interval_sec,
      cron_expr: s.cron_expr,
    }));

    return formatSuccess(summary, `Schedules (${schedules.length}):\n${JSON.stringify(summary, null, 2)}`);
  },
};

const schedulesGet = {
  name: 'schedules_get',
  description: 'Get details of a specific schedule.',
  inputSchema: {
    type: 'object',
    properties: {
      schedule_id: {
        type: 'string',
        description: 'Schedule ID (UUID)',
      },
    },
    required: ['schedule_id'],
  },
  handler: async (args) => {
    const result = await getSchedule(args.schedule_id);

    if (!result.ok) {
      return formatError(result);
    }

    return formatSuccess(result.data.schedule, `Schedule details:\n${JSON.stringify(result.data.schedule, null, 2)}`);
  },
};

const schedulesCreate = {
  name: 'schedules_create',
  description: 'Create a new recurring schedule. Provide either interval_sec or cron expression.',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: 'Job type to schedule',
      },
      queue: {
        type: 'string',
        description: 'Queue name',
        default: 'default',
      },
      name: {
        type: 'string',
        description: 'Schedule name',
      },
      input: {
        type: 'object',
        description: 'Job input data',
      },
      interval_sec: {
        type: 'integer',
        description: 'Interval in seconds (5-86400). Use this OR cron, not both.',
        minimum: 5,
        maximum: 86400,
      },
      cron: {
        type: 'string',
        description: 'Cron expression (e.g., "0 9 * * *"). Use this OR interval_sec, not both.',
      },
      enabled: {
        type: 'boolean',
        description: 'Enable the schedule',
        default: true,
      },
      priority: {
        type: 'integer',
        description: 'Job priority 0-10',
        minimum: 0,
        maximum: 10,
      },
      timeout_sec: {
        type: 'integer',
        description: 'Job timeout in seconds',
      },
      max_attempts: {
        type: 'integer',
        description: 'Max retry attempts',
      },
      start_in_sec: {
        type: 'integer',
        description: 'Delay before first run in seconds',
        minimum: 0,
        maximum: 86400,
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for scheduled jobs',
      },
    },
    required: ['type'],
  },
  handler: async (args) => {
    const params = {
      type: args.type,
      queue: args.queue,
      name: args.name,
      input: args.input,
      enabled: args.enabled,
      priority: args.priority,
      timeout_sec: args.timeout_sec,
      max_attempts: args.max_attempts,
      start_in_sec: args.start_in_sec,
      tags: args.tags,
    };

    // Set cadence
    if (args.interval_sec !== undefined) {
      params.interval_sec = args.interval_sec;
    } else if (args.cron !== undefined) {
      params.cron = args.cron;
    } else {
      return formatError({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Either interval_sec or cron is required',
        },
      });
    }

    const result = await createSchedule(params);

    if (!result.ok) {
      return formatError(result);
    }

    const schedule = result.data.schedule;
    return formatSuccess(schedule, `Schedule created:\nID: ${schedule.id}\nType: ${schedule.type}\nNext run: ${schedule.next_run_at}`);
  },
};

const schedulesUpdate = {
  name: 'schedules_update',
  description: 'Update an existing schedule.',
  inputSchema: {
    type: 'object',
    properties: {
      schedule_id: {
        type: 'string',
        description: 'Schedule ID to update',
      },
      name: {
        type: 'string',
        description: 'Schedule name',
      },
      enabled: {
        type: 'boolean',
        description: 'Enable or disable',
      },
      type: {
        type: 'string',
        description: 'Job type',
      },
      queue: {
        type: 'string',
        description: 'Queue name',
      },
      input: {
        type: 'object',
        description: 'Job input data',
      },
      interval_sec: {
        type: 'integer',
        description: 'New interval in seconds',
        minimum: 5,
        maximum: 86400,
      },
      cron: {
        type: 'string',
        description: 'New cron expression',
      },
      priority: {
        type: 'integer',
        description: 'Job priority',
        minimum: 0,
        maximum: 10,
      },
      timeout_sec: {
        type: 'integer',
        description: 'Job timeout',
      },
      max_attempts: {
        type: 'integer',
        description: 'Max retries',
      },
      start_in_sec: {
        type: 'integer',
        description: 'Delay before next run',
      },
      run_now: {
        type: 'boolean',
        description: 'Trigger immediate run',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags',
      },
    },
    required: ['schedule_id'],
  },
  handler: async (args) => {
    const params = {};
    if (args.name !== undefined) params.name = args.name;
    if (args.enabled !== undefined) params.enabled = args.enabled;
    if (args.type !== undefined) params.type = args.type;
    if (args.queue !== undefined) params.queue = args.queue;
    if (args.input !== undefined) params.input = args.input;
    if (args.interval_sec !== undefined) params.interval_sec = args.interval_sec;
    if (args.cron !== undefined) params.cron = args.cron;
    if (args.priority !== undefined) params.priority = args.priority;
    if (args.timeout_sec !== undefined) params.timeout_sec = args.timeout_sec;
    if (args.max_attempts !== undefined) params.max_attempts = args.max_attempts;
    if (args.start_in_sec !== undefined) params.start_in_sec = args.start_in_sec;
    if (args.run_now !== undefined) params.run_now = args.run_now;
    if (args.tags !== undefined) params.tags = args.tags;

    const result = await updateSchedule(args.schedule_id, params);

    if (!result.ok) {
      return formatError(result);
    }

    return formatSuccess(result.data.schedule, `Schedule updated:\n${JSON.stringify(result.data.schedule, null, 2)}`);
  },
};

const schedulesDelete = {
  name: 'schedules_delete',
  description: 'Delete a schedule.',
  inputSchema: {
    type: 'object',
    properties: {
      schedule_id: {
        type: 'string',
        description: 'Schedule ID to delete',
      },
    },
    required: ['schedule_id'],
  },
  handler: async (args) => {
    const result = await deleteSchedule(args.schedule_id);

    if (!result.ok) {
      return formatError(result);
    }

    return formatSuccess(result.data, `Schedule deleted: ${args.schedule_id}`);
  },
};

module.exports = {
  schedulesList,
  schedulesGet,
  schedulesCreate,
  schedulesUpdate,
  schedulesDelete,
};