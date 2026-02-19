#!/usr/bin/env node

/**
 * RauskuClaw MCP Server
 * 
 * Model Context Protocol server for RauskuClaw job runner.
 * Exposes jobs, memory, workspace, schedules, and runtime as MCP tools and resources.
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const { getToolDefinitions, executeTool } = require('./lib/tools');
const { listResources, readResource } = require('./lib/resources');

// Server configuration
const SERVER_NAME = 'rauskuclaw-mcp';
const SERVER_VERSION = '0.1.0';

// Create MCP server
const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = getToolDefinitions();
  return { tools };
});

// Handle call tool request
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const result = await executeTool(name, args);
  return result;
});

// Handle list resources request
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const resources = await listResources();
  return { resources };
});

// Handle read resource request
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  const result = await readResource(uri);
  return result;
});

// Start server with STDIO transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[${SERVER_NAME}] MCP server started`);
}

main().catch((error) => {
  console.error(`[${SERVER_NAME}] Fatal error:`, error);
  process.exit(1);
});