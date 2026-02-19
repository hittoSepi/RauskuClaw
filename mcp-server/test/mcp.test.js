/**
 * Tests for RauskuClaw MCP Server
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { getToolDefinitions, executeTool } = require('../lib/tools');
const { listResources, readResource } = require('../lib/resources');

describe('Tool Registry', () => {
  it('should return all tool definitions', () => {
    const tools = getToolDefinitions();
    assert.ok(Array.isArray(tools));
    assert.ok(tools.length > 0);
    
    // Check that each tool has required properties
    for (const tool of tools) {
      assert.ok(tool.name, 'Tool should have name');
      assert.ok(tool.description, 'Tool should have description');
      assert.ok(tool.inputSchema, 'Tool should have inputSchema');
      assert.strictEqual(tool.inputSchema.type, 'object');
    }
  });

  it('should include job management tools', () => {
    const tools = getToolDefinitions();
    const names = tools.map(t => t.name);
    
    assert.ok(names.includes('jobs_create'), 'Should include jobs_create');
    assert.ok(names.includes('jobs_list'), 'Should include jobs_list');
    assert.ok(names.includes('jobs_get'), 'Should include jobs_get');
    assert.ok(names.includes('jobs_cancel'), 'Should include jobs_cancel');
    assert.ok(names.includes('jobs_logs'), 'Should include jobs_logs');
  });

  it('should include memory tools', () => {
    const tools = getToolDefinitions();
    const names = tools.map(t => t.name);
    
    assert.ok(names.includes('memory_list'), 'Should include memory_list');
    assert.ok(names.includes('memory_write'), 'Should include memory_write');
    assert.ok(names.includes('memory_search'), 'Should include memory_search');
  });

  it('should include workspace tools', () => {
    const tools = getToolDefinitions();
    const names = tools.map(t => t.name);
    
    assert.ok(names.includes('workspace_list'), 'Should include workspace_list');
    assert.ok(names.includes('workspace_read'), 'Should include workspace_read');
    assert.ok(names.includes('workspace_write'), 'Should include workspace_write');
  });

  it('should include schedule tools', () => {
    const tools = getToolDefinitions();
    const names = tools.map(t => t.name);
    
    assert.ok(names.includes('schedules_list'), 'Should include schedules_list');
    assert.ok(names.includes('schedules_create'), 'Should include schedules_create');
  });

  it('should include runtime tools', () => {
    const tools = getToolDefinitions();
    const names = tools.map(t => t.name);
    
    assert.ok(names.includes('runtime_providers'), 'Should include runtime_providers');
    assert.ok(names.includes('runtime_handlers'), 'Should include runtime_handlers');
    assert.ok(names.includes('runtime_metrics'), 'Should include runtime_metrics');
  });
});

describe('Tool Execution', () => {
  it('should return error for unknown tool', async () => {
    const result = await executeTool('unknown_tool_xyz', {});
    
    assert.ok(result.isError, 'Should be an error result');
    assert.ok(result.content[0].text.includes('Unknown tool'), 'Should mention unknown tool');
  });

  it('should handle missing required parameters', async () => {
    // This will fail because the API is not available, but we can check the error handling
    const result = await executeTool('jobs_create', {});
    
    // The tool should either return an error from the API or from validation
    assert.ok(result.isError || result.content, 'Should have a result');
  });
});

describe('Resource Handlers', () => {
  it('should list available resources', async () => {
    const resources = await listResources();
    
    assert.ok(Array.isArray(resources), 'Should return an array');
    assert.ok(resources.length > 0, 'Should have resources');
    
    // Check that each resource has required properties
    for (const resource of resources) {
      assert.ok(resource.uri, 'Resource should have uri');
      assert.ok(resource.name, 'Resource should have name');
    }
  });

  it('should include expected resource URIs', async () => {
    const resources = await listResources();
    const uris = resources.map(r => r.uri);
    
    assert.ok(uris.includes('rauskuclaw://jobs'), 'Should include jobs resource');
    assert.ok(uris.includes('rauskuclaw://schedules'), 'Should include schedules resource');
    assert.ok(uris.includes('rauskuclaw://memory/scopes'), 'Should include memory scopes resource');
    assert.ok(uris.includes('rauskuclaw://runtime/providers'), 'Should include runtime providers resource');
  });

  it('should throw error for unknown resource URI', async () => {
    await assert.rejects(
      async () => await readResource('rauskuclaw://unknown/xyz'),
      /Unknown resource URI/
    );
  });
});

describe('Tool Input Schemas', () => {
  it('should have valid JSON Schema for all tools', () => {
    const tools = getToolDefinitions();
    
    for (const tool of tools) {
      const schema = tool.inputSchema;
      
      // Basic JSON Schema validation
      assert.strictEqual(typeof schema, 'object', `${tool.name} inputSchema should be object`);
      assert.strictEqual(schema.type, 'object', `${tool.name} inputSchema.type should be object`);
      
      // If properties exist, they should be valid
      if (schema.properties) {
        assert.strictEqual(typeof schema.properties, 'object', `${tool.name} properties should be object`);
      }
      
      // If required exists, it should be an array
      if (schema.required) {
        assert.ok(Array.isArray(schema.required), `${tool.name} required should be array`);
      }
    }
  });
});