# CLI MCP Configuration Guide

This guide explains how to configure Codex CLI and Claude Code to connect to the Chrome MCP Server.

## Overview

The Chrome MCP Server exposes its MCP interface at `http://127.0.0.1:56889/mcp` (default port).
Both Codex CLI and Claude Code can connect to this endpoint to use Chrome browser control tools.

## Codex CLI Configuration

### Option 1: HTTP MCP Server (Recommended)

Add the following to your `~/.codex/config.json`:

```json
{
  "mcpServers": {
    "chrome-mcp": {
      "url": "http://127.0.0.1:56889/mcp"
    }
  }
}
```

### Option 2: Via Environment Variable

Set the MCP URL via environment variable before running codex:

```bash
export MCP_HTTP_PORT=56889
```

## Claude Code Configuration

### Option 1: HTTP MCP Server

Add the following to your `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "chrome-mcp": {
      "url": "http://127.0.0.1:56889/mcp"
    }
  }
}
```

### Option 2: Stdio Server (Alternative)

If you prefer stdio-based MCP communication:

```json
{
  "mcpServers": {
    "chrome-mcp": {
      "command": "node",
      "args": ["/path/to/mcp-chrome/dist/mcp/mcp-server-stdio.js"]
    }
  }
}
```

## Verifying Connection

After configuration, the CLI tools should be able to see and use Chrome MCP tools such as:

- `chrome_get_windows_and_tabs` - Get browser window and tab information
- `chrome_navigate` - Navigate to a URL
- `chrome_click_element` - Click on page elements
- `chrome_get_page_content` - Get page content
- And more...

## Troubleshooting

### Connection Refused

If you get "connection refused" errors:

1. Ensure the Chrome extension is installed and the native server is running
2. Check that the port matches (default: 56889)
3. Verify no firewall is blocking localhost connections

### Tools Not Appearing

If MCP tools don't appear in the CLI:

1. Restart the CLI tool after configuration changes
2. Check the configuration file syntax (valid JSON)
3. Ensure the MCP server URL is accessible

### Port Conflicts

If port 56889 is already in use:

1. Set a custom port in the extension settings
2. Update the CLI configuration to match the new port

## Environment Variables

| Variable                     | Description                            | Default |
| ---------------------------- | -------------------------------------- | ------- |
| `MCP_HTTP_PORT`              | HTTP port for MCP server               | 56889   |
| `MCP_ALLOWED_WORKSPACE_BASE` | Additional allowed workspace directory | (none)  |
