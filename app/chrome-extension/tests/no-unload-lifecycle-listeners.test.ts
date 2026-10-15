import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Chrome 120+ Permissions-Policy can block `unload` listeners. Upstream
 * mcp-chrome #329 switched deleted Tabrix surfaces (element-picker /
 * quick-panel) to `pagehide`. This guard keeps shipped content/inject code
 * from reintroducing `unload` lifecycle listeners.
 */
const EXTENSION_ROOT = resolve(__dirname, '..');
const SCAN_ROOTS = [join(EXTENSION_ROOT, 'entrypoints'), join(EXTENSION_ROOT, 'inject-scripts')];

const UNLOAD_PATTERNS = [/addEventListener\s*\(\s*['"]unload['"]/, /\.onunload\s*=/];

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('no unload lifecycle listeners in shipped content/inject code', () => {
  it('entrypoints and inject-scripts do not register unload listeners', () => {
    const offenders: string[] = [];

    for (const root of SCAN_ROOTS) {
      for (const file of collectSourceFiles(root)) {
        const source = readFileSync(file, 'utf8');
        // Strip block + line comments so prose mentioning unload does not fail the guard.
        const withoutComments = source
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/.*$/gm, '$1');
        for (const pattern of UNLOAD_PATTERNS) {
          if (pattern.test(withoutComments)) {
            offenders.push(relative(EXTENSION_ROOT, file));
            break;
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
