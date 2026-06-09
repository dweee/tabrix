import * as fs from 'fs';
import * as path from 'path';

describe('config CLI action', () => {
  test('does not force process.exit after concurrent config fetches', () => {
    const cliSource = fs.readFileSync(path.resolve(__dirname, '../cli.ts'), 'utf8');
    const configStart = cliSource.indexOf(".command('config')");
    const clientsStart = cliSource.indexOf(".command('clients')", configStart);

    expect(configStart).toBeGreaterThanOrEqual(0);
    expect(clientsStart).toBeGreaterThan(configStart);

    const configAction = cliSource.slice(configStart, clientsStart);
    expect(configAction).toContain('process.exitCode = exitCode');
    expect(configAction).toContain('process.exitCode = 1');
    expect(configAction).not.toContain('process.exit(');
  });

  test('does not force process.exit after MCP inspect commands', () => {
    const cliSource = fs.readFileSync(path.resolve(__dirname, '../cli.ts'), 'utf8');
    const mcpStart = cliSource.indexOf("const mcpCommand = program.command('mcp')");
    const toolsStart = cliSource.indexOf(".command('tools')", mcpStart);
    const callStart = cliSource.indexOf(".command('call <toolName>')", toolsStart);
    const smokeStart = cliSource.indexOf("program\n  .command('smoke')", callStart);

    expect(mcpStart).toBeGreaterThanOrEqual(0);
    expect(toolsStart).toBeGreaterThan(mcpStart);
    expect(callStart).toBeGreaterThan(toolsStart);
    expect(smokeStart).toBeGreaterThan(callStart);

    const toolsAction = cliSource.slice(toolsStart, callStart);
    const callAction = cliSource.slice(callStart, smokeStart);

    for (const action of [toolsAction, callAction]) {
      expect(action).toContain('process.exitCode = exitCode');
      expect(action).toContain('process.exitCode = 1');
      expect(action).not.toContain('process.exit(');
    }
  });
});
