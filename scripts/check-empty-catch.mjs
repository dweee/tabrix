#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TARGET_DIRS = [
  'app/native-server/src',
  'app/chrome-extension/entrypoints',
  'app/chrome-extension/inject-scripts',
  'packages/shared/src',
];
const EXTENSIONS = new Set(['.ts', '.tsx', '.vue', '.js', '.mjs']);
const EMPTY_CATCH_PATTERN = /catch\s*(?:\([^)]*\)\s*)?\{\s*\}/g;

function listFiles(dir) {
  const absoluteDir = path.join(ROOT, dir);
  if (!existsSync(absoluteDir)) return [];

  const files = [];
  for (const entry of readdirSync(absoluteDir)) {
    const absolutePath = path.join(absoluteDir, entry);
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      if (['dist', 'coverage', 'node_modules', '.output'].includes(entry)) continue;
      files.push(...listFiles(path.relative(ROOT, absolutePath)));
      continue;
    }

    const extension = path.extname(entry);
    if (!EXTENSIONS.has(extension)) continue;
    if (entry.endsWith('.test.ts') || entry.endsWith('.spec.ts')) continue;
    files.push(absolutePath);
  }
  return files;
}

const violations = [];

for (const dir of TARGET_DIRS) {
  for (const file of listFiles(dir)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(EMPTY_CATCH_PATTERN)) {
      const beforeMatch = text.slice(0, match.index);
      const line = beforeMatch.split(/\r?\n/).length;
      violations.push({
        file: path.relative(ROOT, file).replaceAll(path.sep, '/'),
        line,
        text: match[0].replace(/\s+/g, ' ').trim(),
      });
    }
  }
}

if (violations.length > 0) {
  console.error('Empty catch blocks are not allowed in production paths:');
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line}: ${violation.text}`);
  }
  process.exit(1);
}

console.log('Empty catch governance check passed: no empty catch blocks in production paths.');
