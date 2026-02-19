# RauskuClaw MCP Server

Model Context Protocol (MCP) server for [RauskuClaw](https://github.com/rauskuclaw/rauskuclaw) job runner.

## Overview

This MCP server exposes RauskuClaw capabilities as tools and resources for AI assistants that support the Model Context Protocol, such as:

- Claude Desktop
- VS Code extensions with MCP support
- Other MCP-compatible clients

## Installation

The MCP server is bundled with RauskuClaw. Install dependencies:

```bash
cd /opt/openclaw/mcp-server
npm install
```

## Configuration

Set environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `RAUSKUCLAW_API_URL` | RauskuClaw API base URL | `http://localhost:3001` |
| `RAUSKUCLAW_API_KEY` | API key for authentication | (required) |

## Usage

### Running the Server

```bash
cd /opt/openclaw/mcp-server
RAUSKUCLAW_API_KEY=your-api-key npm start
```

### Claude Desktop Configuration

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "rauskuclaw": {
      "command": "node",
      "args": ["/opt/openclaw/mcp-server/index.js"],
      "env": {
        "RAUSKUCLAW_API_URL": "http://localhost:3001",
        "RAUSKUCLAW_API_KEY": "your-api-key"
      }
    }
  }
}
```

On macOS, the config file is located at:
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

On Windows:
```
%APPDATA%\Claude\claude_desktop_config.json
```

## Available Tools

### Jobs

| Tool | Description |
|------|-------------|
| `jobs_create` | Create a new job |
| `jobs_list` | List jobs with filters |
| `jobs_get` | Get job details |
| `jobs_cancel` | Cancel a job |
| `jobs_logs` | Get job execution logs |
| `job_types_list` | List available job types |
| `job_types_create` | Create a new job type |
| `job_types_update` | Update a job type |

### Memory

| Tool | Description |
|------|-------------|
| `memory_list` | List memory entries |
| `memory_scopes` | List memory scopes |
| `memory_get` | Get a memory entry |
| `memory_write` | Write to memory |
| `memory_delete` | Delete a memory entry |
| `memory_reset` | Reset memory (destructive) |
| `memory_search` | Semantic memory search |
| `working_memory_list` | List working memory sessions |
| `working_memory_get` | Get working memory state |
| `working_memory_save` | Save working memory |
| `working_memory_clear` | Clear working memory |

### Workspace

| Tool | Description |
|------|-------------|
| `workspace_list` | List directory contents |
| `workspace_read` | Read file content |
| `workspace_write` | Write file content |
| `workspace_delete` | Delete file |
| `workspace_upload` | Upload base64 file |
| `workspace_create` | Create file or directory |
| `workspace_move` | Move/rename entry |

### Schedules

| Tool | Description |
|------|-------------|
| `schedules_list` | List schedules |
| `schedules_get` | Get schedule details |
| `schedules_create` | Create schedule |
| `schedules_update` | Update schedule |
| `schedules_delete` | Delete schedule |

### Runtime

| Tool | Description |
|------|-------------|
| `runtime_providers` | Get AI provider status |
| `runtime_handlers` | Get handler status |
| `runtime_metrics` | Get runtime metrics |
| `runtime_whoami` | Get API key info |
| `ui_prefs_get` | Get UI preferences |
| `ui_prefs_set` | Set UI preferences |

## Available Resources

Resources can be read by URI:

| URI | Description |
|-----|-------------|
| `rauskuclaw://jobs` | Jobs list |
| `rauskuclaw://jobs/{id}` | Single job details |
| `rauskuclaw://memory/scopes` | Memory scopes |
| `rauskuclaw://memory/{scope}/{key}` | Memory entry |
| `rauskuclaw://schedules` | Schedules list |
| `rauskuclaw://schedules/{id}` | Schedule details |
| `rauskuclaw://workspace/{path}` | File content |
| `rauskuclaw://runtime/providers` | Provider status |
| `rauskuclaw://runtime/handlers` | Handler status |

## Example Usage

### Create a Job

```javascript
// Tool: jobs_create
{
  "type": "ai.chat.generate",
  "input": {
    "prompt": "Analyze the current codebase"
  }
}
```

### Write to Memory

```javascript
// Tool: memory_write
{
  "scope": "project.context",
  "key": "decisions.2026-02-19",
  "value": {
    "summary": "Added MCP server support",
    "impact": "Enables AI assistant integration"
  }
}
```

### Read a File

```javascript
// Tool: workspace_read
{
  "path": "README.md"
}
```

### Create a Schedule

```javascript
// Tool: schedules_create
{
  "type": "report.generate",
  "cron": "0 9 * * *",
  "name": "Daily report"
}
```

## Development

### Run Tests

```bash
cd /opt/openclaw/mcp-server
npm test
```

### Project Structure

```
mcp-server/
├── package.json
├── index.js              # Entry point
├── lib/
│   ├── api-client.js     # HTTP client for RauskuClaw API
│   ├── tools/
│   │   ├── index.js      # Tool registry
│   │   ├── jobs.js       # Job tools
│   │   ├── memory.js     # Memory tools
│   │   ├── workspace.js  # Workspace tools
│   │   ├── schedules.js  # Schedule tools
│   │   └── runtime.js    # Runtime tools
│   └── resources/
│       └── index.js      # Resource handlers
└── test/
    └── mcp.test.js       # Tests
```

## Security Notes

- The API key is required for all operations
- Queue allowlist is enforced by the API
- Read-only vs admin role is supported
- Some tools (e.g., `tool.exec`, `data.fetch`) require explicit enablement on the server

## License

MIT