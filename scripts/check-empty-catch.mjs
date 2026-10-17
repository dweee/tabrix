#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const BASELINE_PATH = path.join(ROOT, 'scripts', 'empty-catch-baseline.json');
const TARGET_DIRS = [
  'app/native-server/src',
  'app/chrome-extension/entrypoints',
  'app/chrome-extension/inject-scripts',
  'packages/shared/src',
];
const EXTENSIONS = new Set(['.ts', '.tsx', '.vue', '.js', '.mjs']);

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '');
}

function maskNonCode(text) {
  const chars = [...text];
  let cursor = 0;
  let quote = null;
  while (cursor < chars.length) {
    const char = chars[cursor];
    const next = chars[cursor + 1];
    if (quote) {
      chars[cursor] = /\r|\n/.test(char) ? char : ' ';
      if (char === '\\') {
        cursor += 1;
        if (cursor < chars.length) chars[cursor] = ' ';
      } else if (char === quote) {
        quote = null;
      }
      cursor += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      chars[cursor] = ' ';
      cursor += 1;
      continue;
    }
    if (char === '/' && next === '/') {
      chars[cursor] = ' ';
      chars[cursor + 1] = ' ';
      cursor += 2;
      while (cursor < chars.length && !/\r|\n/.test(chars[cursor])) {
        chars[cursor] = ' ';
        cursor += 1;
      }
      continue;
    }
    if (char === '/' && next === '*') {
      chars[cursor] = ' ';
      chars[cursor + 1] = ' ';
      cursor += 2;
      while (cursor < chars.length) {
        const current = chars[cursor];
        const after = chars[cursor + 1];
        chars[cursor] = /\r|\n/.test(current) ? current : ' ';
        if (current === '*' && after === '/') {
          chars[cursor + 1] = ' ';
          cursor += 2;
          break;
        }
        cursor += 1;
      }
      continue;
    }
    cursor += 1;
  }
  return chars.join('');
}

function skipWhitespace(text, index) {
  let cursor = index;
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
  return cursor;
}

function skipBalanced(text, index, open, close) {
  if (text[index] !== open) return -1;
  let depth = 0;
  let cursor = index;
  let quote = null;
  while (cursor < text.length) {
    const char = text[cursor];
    const next = text[cursor + 1];
    if (quote) {
      if (char === '\\') {
        cursor += 2;
        continue;
      }
      if (char === quote) quote = null;
      cursor += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      cursor += 1;
      continue;
    }
    if (char === '/' && next === '/') {
      cursor = text.indexOf('\n', cursor + 2);
      if (cursor === -1) return text.length;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = text.indexOf('*/', cursor + 2);
      cursor = end === -1 ? text.length : end + 2;
      continue;
    }
    if (char === open) depth += 1;
    if (char === close) {
      depth -= 1;
      if (depth === 0) return cursor;
    }
    cursor += 1;
  }
  return -1;
}

function findEmptyCatchBlocks(text) {
  const out = [];
  const code = maskNonCode(text);
  const catchPattern = /\bcatch\b/g;
  for (const match of code.matchAll(catchPattern)) {
    let cursor = skipWhitespace(code, match.index + match[0].length);
    if (code[cursor] === '(') {
      const paramEnd = skipBalanced(code, cursor, '(', ')');
      if (paramEnd === -1) continue;
      cursor = skipWhitespace(code, paramEnd + 1);
    }
    if (code[cursor] !== '{') continue;
    const bodyEnd = skipBalanced(code, cursor, '{', '}');
    if (bodyEnd === -1) continue;
    const body = text.slice(cursor + 1, bodyEnd);
    if (stripComments(body).trim().length > 0) continue;
    out.push({ index: match.index, text: text.slice(match.index, bodyEnd + 1) });
  }
  return out;
}

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

function collectViolations() {
  const violations = [];
  for (const dir of TARGET_DIRS) {
    for (const file of listFiles(dir)) {
      const text = readFileSync(file, 'utf8');
      for (const match of findEmptyCatchBlocks(text)) {
        const beforeMatch = text.slice(0, match.index);
        const line = beforeMatch.split(/\r?\n/).length;
        violations.push({
          file: path.relative(ROOT, file).replaceAll(path.sep, '/'),
          line,
          text: match.text.replace(/\s+/g, ' ').trim(),
        });
      }
    }
  }
  return violations;
}

function violationKey(violation) {
  return `${violation.file}:${violation.line}:${violation.text}`;
}

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) return [];
  const parsed = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error('scripts/empty-catch-baseline.json must be an array.');
  }
  return parsed;
}

if (process.argv.includes('--self-test')) {
  const sample = `
    try {} catch {}
    try {} catch (error) {
      // ignored
    }
    try {} catch (error) { report(error); }
    const text = "catch {}";
  `;
  const found = findEmptyCatchBlocks(sample);
  if (found.length !== 2) {
    console.error(`Expected 2 self-test empty catches, found ${found.length}`);
    process.exit(1);
  }
  console.log('Empty catch governance self-test passed.');
  process.exit(0);
}

const violations = collectViolations();

if (process.argv.includes('--update-baseline')) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(violations, null, 2)}\n`);
  console.log(`Empty catch baseline updated: ${violations.length} existing entries.`);
  process.exit(0);
}

const baseline = readBaseline();
const baselineKeys = new Set(baseline.map(violationKey));
const newViolations = violations.filter((violation) => !baselineKeys.has(violationKey(violation)));

if (newViolations.length > 0) {
  console.error('Empty catch blocks are not allowed in production paths:');
  for (const violation of newViolations) {
    console.error(`${violation.file}:${violation.line}: ${violation.text}`);
  }
  process.exit(1);
}

console.log(
  `Empty catch governance check passed: no new empty catch blocks. Baseline entries: ${baseline.length}.`,
);
