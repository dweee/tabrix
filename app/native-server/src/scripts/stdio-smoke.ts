#!/usr/bin/env node

/**
 * Stdio smoke test — validates the tabrix-stdio proxy process
 * can start, respond to MCP protocol messages, and shut down cleanly.
 *
 * Does NOT require the HTTP MCP server to be running (only tests local
 * handlers: initialize, tools/list, resources/list, prompts/list).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';
import { TOOL_SCHEMAS } from '@tabrix/shared';
import { filterToolsByEnvironment, filterToolsByPolicy } from '../mcp/tool-registry-filters';

export interface StdioSmokeOptions {
  json?: boolean;
}

interface SmokeStep {
  name: string;
  ok: boolean;
  detail: string;
}

interface SmokeResult {
  ok: boolean;
  steps: SmokeStep[];
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function runStdioSmoke(options: StdioSmokeOptions = {}): Promise<number> {
  const steps: SmokeStep[] = [];

  const record = (name: string, ok: boolean, detail: string): void => {
    steps.push({ name, ok, detail });
  };

  const stdioServerPath = path.resolve(__dirname, '..', 'mcp', 'mcp-server-stdio.js');

  let client: Client | null = null;
  let transport: StdioClientTransport | null = null;
  let childStderrBytes = 0;
  let childStderrChunkCount = 0;

  try {
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [stdioServerPath],
      env: process.env as Record<string, string>,
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (chunk: Buffer | string) => {
      childStderrBytes += Buffer.byteLength(chunk);
      childStderrChunkCount += 1;
    });

    client = new Client({ name: 'stdio-smoke', version: '1.0.0' }, { capabilities: {} });

    // initialize + initialized handshake
    await client.connect(transport);
    record('initialize', true, 'Stdio server initialized successfully');

    // tools/list
    const toolsResult = await client.listTools();
    const toolCount = toolsResult.tools.length;
    const expectedCount = filterToolsByPolicy(filterToolsByEnvironment(TOOL_SCHEMAS)).length;
    const toolsOk = toolCount > 0 && toolCount === expectedCount;
    record(
      'tools/list',
      toolsOk,
      toolsOk
        ? `${toolCount} tools (matches visible MCP registry)`
        : `Expected ${expectedCount} tools, got ${toolCount}`,
    );

    // resources/list
    const resourcesResult = await client.listResources();
    record('resources/list', true, `${resourcesResult.resources.length} resources`);

    // prompts/list
    const promptsResult = await client.listPrompts();
    record('prompts/list', true, `${promptsResult.prompts.length} prompts`);

    // ping
    try {
      await client.ping();
      record('ping', true, 'Server responded to ping');
    } catch (pingErr) {
      record('ping', false, stringifyError(pingErr));
    }

    // close
    await client.close();
    client = null;
    record('close', true, 'Stdio server shut down cleanly');
    record(
      'stderr-isolated',
      true,
      childStderrChunkCount > 0
        ? `Child stderr captured separately (${childStderrBytes} bytes, ${childStderrChunkCount} chunks)`
        : 'Child stderr stayed quiet',
    );
  } catch (error) {
    record('fatal', false, stringifyError(error));
  } finally {
    if (client) {
      try {
        await client.close();
      } catch {
        // Best-effort cleanup.
      }
    }
  }

  const result: SmokeResult = {
    ok: steps.every((step) => step.ok),
    steps,
  };

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write('tabrix stdio-smoke\n\n');
    for (const step of steps) {
      process.stdout.write(`${step.ok ? '[OK]' : '[FAIL]'} ${step.name}: ${step.detail}\n`);
    }
    process.stdout.write(`\n${result.ok ? 'ALL PASSED' : 'SOME FAILED'}\n`);
  }

  return result.ok ? 0 : 1;
}
