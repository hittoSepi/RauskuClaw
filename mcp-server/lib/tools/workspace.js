/**
 * Workspace file tools for RauskuClaw MCP server
 */

const {
  listWorkspace,
  readFile,
  writeFile,
  deleteFile,
  uploadFile,
  createEntry,
  moveEntry,
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

const workspaceList = {
  name: 'workspace_list',
  description: 'List files and directories in the workspace.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory path to list (default: root)',
        default: '.',
      },
      limit: {
        type: 'integer',
        description: 'Maximum entries to return',
        minimum: 1,
        maximum: 1000,
        default: 200,
      },
    },
  },
  handler: async (args) => {
    const result = await listWorkspace(args.path || '.', args.limit);

    if (!result.ok) {
      return formatError(result);
    }

    const entries = result.data.entries || [];
    const summary = entries.map((e) => ({
      name: e.name,
      path: e.path,
      is_dir: e.is_dir,
      size: e.size,
      modified_at: e.modified_at,
    }));

    return formatSuccess(summary, `Directory listing (${entries.length} entries):\n${JSON.stringify(summary, null, 2)}`);
  },
};

const workspaceRead = {
  name: 'workspace_read',
  description: 'Read a text file from the workspace.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path to read',
      },
    },
    required: ['path'],
  },
  handler: async (args) => {
    const result = await readFile(args.path);

    if (!result.ok) {
      return formatError(result);
    }

    const file = result.data.file;
    return formatSuccess(file, `File: ${file.path}\nSize: ${file.size} bytes\nModified: ${file.modified_at}\n\n${file.content}`);
  },
};

const workspaceWrite = {
  name: 'workspace_write',
  description: 'Write content to a text file in the workspace.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path to write',
      },
      content: {
        type: 'string',
        description: 'Text content to write',
      },
    },
    required: ['path', 'content'],
  },
  handler: async (args) => {
    const result = await writeFile(args.path, args.content);

    if (!result.ok) {
      return formatError(result);
    }

    const file = result.data.file;
    return formatSuccess(file, `File saved: ${file.path}\nSize: ${file.size} bytes`);
  },
};

const workspaceDelete = {
  name: 'workspace_delete',
  description: 'Delete a file from the workspace.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path to delete',
      },
    },
    required: ['path'],
  },
  handler: async (args) => {
    const result = await deleteFile(args.path);

    if (!result.ok) {
      return formatError(result);
    }

    return formatSuccess(result.data, `File deleted: ${args.path}`);
  },
};

const workspaceUpload = {
  name: 'workspace_upload',
  description: 'Upload base64-encoded file content to the workspace.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Target file path',
      },
      content_base64: {
        type: 'string',
        description: 'Base64-encoded file content',
      },
      overwrite: {
        type: 'boolean',
        description: 'Overwrite existing file',
        default: false,
      },
    },
    required: ['path', 'content_base64'],
  },
  handler: async (args) => {
    const result = await uploadFile(args.path, args.content_base64, args.overwrite);

    if (!result.ok) {
      return formatError(result);
    }

    const file = result.data.file;
    return formatSuccess(file, `File uploaded: ${file.path}\nSize: ${file.size} bytes${file.overwritten ? ' (overwritten)' : ''}`);
  },
};

const workspaceCreate = {
  name: 'workspace_create',
  description: 'Create a new file or directory in the workspace.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to create',
      },
      kind: {
        type: 'string',
        enum: ['file', 'dir'],
        description: 'Create file or directory',
        default: 'file',
      },
      content: {
        type: 'string',
        description: 'Initial content (for files)',
      },
      overwrite: {
        type: 'boolean',
        description: 'Overwrite existing entry',
        default: false,
      },
    },
    required: ['path'],
  },
  handler: async (args) => {
    const result = await createEntry(args.path, args.kind, args.content || '', args.overwrite);

    if (!result.ok) {
      return formatError(result);
    }

    const entry = result.data.entry;
    return formatSuccess(entry, `Created ${entry.kind}: ${entry.path}${entry.overwritten ? ' (overwritten)' : ''}`);
  },
};

const workspaceMove = {
  name: 'workspace_move',
  description: 'Move or rename a file or directory.',
  inputSchema: {
    type: 'object',
    properties: {
      from_path: {
        type: 'string',
        description: 'Source path',
      },
      to_path: {
        type: 'string',
        description: 'Destination path',
      },
      overwrite: {
        type: 'boolean',
        description: 'Overwrite destination if exists',
        default: false,
      },
    },
    required: ['from_path', 'to_path'],
  },
  handler: async (args) => {
    const result = await moveEntry(args.from_path, args.to_path, args.overwrite);

    if (!result.ok) {
      return formatError(result);
    }

    return formatSuccess(result.data, `Moved: ${result.data.from_path} -> ${result.data.to_path}`);
  },
};

module.exports = {
  workspaceList,
  workspaceRead,
  workspaceWrite,
  workspaceDelete,
  workspaceUpload,
  workspaceCreate,
  workspaceMove,
};