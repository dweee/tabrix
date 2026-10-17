import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const DEFAULT_PORT = 12306;
const HEALTHCHECK_TIMEOUT_MS = 1500;
const HEALTHCHECK_INTERVAL_MS = 30_000;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const DIST_ENTRY_PATH = path.join(PROJECT_ROOT, 'app', 'native-server', 'dist', 'daemon-entry.js');

function getDaemonPort() {
  const rawPort = Number(process.env.CHROME_MCP_PORT ?? DEFAULT_PORT);
  return Number.isFinite(rawPort) && rawPort > 0 ? rawPort : DEFAULT_PORT;
}

async function isDaemonHealthy(port) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTHCHECK_TIMEOUT_MS);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/ping`, {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function ensureDaemonBuild() {
  if (existsSync(DIST_ENTRY_PATH)) {
    return;
  }

  const result = spawnSync('pnpm', ['--filter', '@tabrix/tabrix', 'build'], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0 || !existsSync(DIST_ENTRY_PATH)) {
    process.exit(result.status ?? 1);
  }
}

function keepAliveForExistingDaemon(port) {
  process.stdout.write(`Existing native daemon is already healthy on port ${port}.\n`);

  const timer = setInterval(async () => {
    try {
      const healthy = await isDaemonHealthy(port);
      if (!healthy) {
        clearInterval(timer);
        process.stderr.write(`Existing native daemon on port ${port} is no longer healthy.\n`);
        process.exit(1);
      }
    } catch (error) {
      clearInterval(timer);
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Existing native daemon health check failed: ${message}\n`);
      process.exit(1);
    }
  }, HEALTHCHECK_INTERVAL_MS);
}

function launchDaemonChild() {
  const child = spawn(process.execPath, [DIST_ENTRY_PATH], {
    cwd: PROJECT_ROOT,
    env: process.env,
    stdio: 'inherit',
  });

  child.on('error', (error) => {
    process.stderr.write(`Failed to launch native daemon: ${error.message}\n`);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });

  const forwardSignal = (signal) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.on('SIGINT', () => forwardSignal('SIGINT'));
  process.on('SIGTERM', () => forwardSignal('SIGTERM'));
}

async function main() {
  const port = getDaemonPort();
  const healthy = await isDaemonHealthy(port);

  if (healthy) {
    keepAliveForExistingDaemon(port);
    return;
  }

  ensureDaemonBuild();
  launchDaemonChild();
}

void main();
