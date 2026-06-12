#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const LINE_THRESHOLDS = [800, 1200, 2000];
const SITE_TOKENS = ['github', 'douyin', 'npmjs'];
const MAX_DETAIL_ITEMS = 40;

const PUBLIC_SOT_FILES = [
  'README.md',
  'README_zh.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'AGENTS.md',
  'docs/README.md',
  'docs/ROADMAP.md',
  'docs/PRODUCT_SURFACE_MATRIX.md',
  'docs/ARCHITECTURE.md',
  'docs/PROJECT_STRUCTURE.md',
];

const PRODUCTION_ROOTS = [
  'app/native-server/src',
  'app/chrome-extension/common',
  'app/chrome-extension/entrypoints',
  'app/chrome-extension/inject-scripts',
  'app/chrome-extension/utils',
  'packages/shared/src',
];

const PRODUCTION_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue']);
const IGNORED_DIR_NAMES = new Set(['node_modules', 'dist', 'coverage', '.output', '.wxt']);

const rows = {
  warnings: [],
  infos: [],
};

function toRepoPath(absolutePath) {
  return path.relative(ROOT, absolutePath).replaceAll(path.sep, '/');
}

function hasPathSegment(repoPath, segment) {
  return repoPath.split('/').includes(segment);
}

function isTestOrConfigPath(repoPath) {
  const base = path.basename(repoPath);
  return (
    hasPathSegment(repoPath, 'tests') ||
    base.endsWith('.test.ts') ||
    base.endsWith('.test.tsx') ||
    base.endsWith('.test.js') ||
    base.endsWith('.test.mjs') ||
    base.endsWith('.spec.ts') ||
    base.endsWith('.spec.tsx') ||
    base === 'wxt.config.ts' ||
    base === 'vitest.config.ts' ||
    base === 'jest.config.js' ||
    base === 'eslint.config.js'
  );
}

function isProductionFile(repoPath) {
  const extension = path.extname(repoPath);
  if (!PRODUCTION_EXTENSIONS.has(extension)) {
    return false;
  }
  if (repoPath.endsWith('.d.ts') || isTestOrConfigPath(repoPath)) {
    return false;
  }
  return PRODUCTION_ROOTS.some((root) => repoPath.startsWith(`${root}/`));
}

function isNeutralPath(repoPath) {
  if (!isProductionFile(repoPath)) {
    return false;
  }
  if (repoPath.includes('/knowledge/seeds/')) {
    return false;
  }
  if (repoPath.includes('/knowledge/registry/')) {
    return false;
  }
  if (repoPath.includes('/tests/')) {
    return false;
  }
  return !SITE_TOKENS.some((token) => path.basename(repoPath).toLowerCase().includes(token));
}

function walkFiles(dir) {
  const absoluteDir = path.join(ROOT, dir);
  if (!existsSync(absoluteDir)) {
    return [];
  }

  const files = [];
  for (const entry of readdirSync(absoluteDir)) {
    if (IGNORED_DIR_NAMES.has(entry)) {
      continue;
    }
    const absolutePath = path.join(absoluteDir, entry);
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      files.push(...walkFiles(path.relative(ROOT, absolutePath)));
      continue;
    }
    files.push(absolutePath);
  }
  return files;
}

function getProductionFiles() {
  const seen = new Set();
  const files = [];
  for (const root of PRODUCTION_ROOTS) {
    for (const file of walkFiles(root)) {
      const repoPath = toRepoPath(file);
      if (seen.has(repoPath) || !isProductionFile(repoPath)) {
        continue;
      }
      seen.add(repoPath);
      files.push({ absolutePath: file, repoPath });
    }
  }
  return files.sort((a, b) => a.repoPath.localeCompare(b.repoPath));
}

function countLines(content) {
  if (content.length === 0) {
    return 0;
  }
  return content.split(/\r?\n/).length;
}

function highestExceededThreshold(lineCount) {
  return LINE_THRESHOLDS.filter((threshold) => lineCount > threshold).at(-1) ?? null;
}

function addWarning(code, message, detail = null) {
  rows.warnings.push({ code, message, detail });
}

function addInfo(code, message, detail = null) {
  rows.infos.push({ code, message, detail });
}

function pluralize(count, singular, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function isCommentOnlyLine(line) {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*/')
  );
}

function isSupportReferenceLine(line) {
  const normalized = line.toLowerCase();
  return (
    normalized.includes('github.com/guodaxia103/tabrix') ||
    normalized.includes('github issue') ||
    normalized.includes('github.com/') ||
    normalized.includes('npmjs.com/')
  );
}

function checkPublicSotFiles() {
  const missing = PUBLIC_SOT_FILES.filter((file) => !existsSync(path.join(ROOT, file)));
  if (missing.length > 0) {
    addWarning('public-sot', 'Missing active public source-of-truth files.', missing);
    return;
  }
  addInfo(
    'public-sot',
    `All ${PUBLIC_SOT_FILES.length} active public source-of-truth files exist.`,
  );
}

function checkProductionLineCounts(productionFiles) {
  const oversized = [];
  for (const file of productionFiles) {
    const content = readFileSync(file.absolutePath, 'utf8');
    const lineCount = countLines(content);
    const threshold = highestExceededThreshold(lineCount);
    if (threshold === null) {
      continue;
    }
    oversized.push({
      file: file.repoPath,
      lines: lineCount,
      threshold,
    });
  }

  if (oversized.length === 0) {
    addInfo('line-counts', `No production file exceeds ${LINE_THRESHOLDS[0]} lines.`);
    return;
  }

  addWarning(
    'line-counts',
    `${oversized.length} production file(s) exceed line-count thresholds.`,
    oversized.sort((a, b) => b.lines - a.lines),
  );
}

function checkChromeDebuggerUsage(productionFiles) {
  const violations = [];
  for (const file of productionFiles) {
    if (file.repoPath.endsWith('app/chrome-extension/utils/cdp-session-manager.ts')) {
      continue;
    }
    if (isTestOrConfigPath(file.repoPath)) {
      continue;
    }

    const lines = readFileSync(file.absolutePath, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (line.includes('chrome.debugger') && !isCommentOnlyLine(line)) {
        violations.push({
          file: file.repoPath,
          line: index + 1,
          text: line.trim(),
        });
      }
    });
  }

  if (violations.length === 0) {
    addInfo(
      'chrome-debugger',
      'Direct chrome.debugger usage is confined to cdp-session-manager/test/config paths.',
    );
    return;
  }

  addWarning(
    'chrome-debugger',
    'Direct chrome.debugger usage outside cdp-session-manager/test/config paths.',
    violations,
  );
}

function checkNeutralSiteTokens(productionFiles) {
  const findings = [];
  const skippedReferences = [];
  const tokenPattern = new RegExp(`\\b(${SITE_TOKENS.join('|')})\\b`, 'i');

  for (const file of productionFiles) {
    if (!isNeutralPath(file.repoPath)) {
      continue;
    }

    const lines = readFileSync(file.absolutePath, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const match = tokenPattern.exec(line);
      if (!match) {
        return;
      }
      const finding = {
        file: file.repoPath,
        line: index + 1,
        token: match[1].toLowerCase(),
        text: line.trim(),
      };
      if (isCommentOnlyLine(line) || isSupportReferenceLine(line)) {
        skippedReferences.push(finding);
        return;
      }
      findings.push(finding);
    });
  }

  if (skippedReferences.length > 0) {
    addInfo(
      'neutral-site-reference-lines',
      `${skippedReferences.length} site-family reference occurrence(s) ignored because they are comments or support links.`,
      skippedReferences,
    );
  }

  if (findings.length === 0) {
    addInfo(
      'neutral-site-tokens',
      `No ${SITE_TOKENS.join('/')} token found in neutral production paths.`,
    );
    return;
  }

  addWarning(
    'neutral-site-tokens',
    `${findings.length} site-family token occurrence(s) found in neutral production paths.`,
    findings,
  );
}

function extractArraySource(source, exportName) {
  const marker = `export const ${exportName} = [`;
  const start = source.indexOf(marker);
  if (start === -1) {
    return null;
  }

  const arrayStart = source.indexOf('[', start);
  let depth = 0;
  for (let index = arrayStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '[') {
      depth += 1;
    }
    if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(arrayStart + 1, index);
      }
    }
  }
  return null;
}

function extractObjectBlocks(arraySource) {
  const blocks = [];
  let depth = 0;
  let blockStart = -1;
  for (let index = 0; index < arraySource.length; index += 1) {
    const char = arraySource[index];
    if (char === '{') {
      if (depth === 0) {
        blockStart = index;
      }
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0 && blockStart !== -1) {
        blocks.push(arraySource.slice(blockStart, index + 1));
        blockStart = -1;
      }
    }
  }
  return blocks;
}

function readStringField(objectSource, fieldName) {
  const singleLine = new RegExp(`${fieldName}:\\s*'([^']*)'`).exec(objectSource);
  if (singleLine) {
    return singleLine[1];
  }

  const multiline = new RegExp(`${fieldName}:\\s*\\n\\s*'([^']*)'`).exec(objectSource);
  return multiline?.[1] ?? null;
}

function parseManifestObjects(schemaSource, exportName, fields) {
  const arraySource = extractArraySource(schemaSource, exportName);
  if (arraySource === null) {
    return null;
  }

  return extractObjectBlocks(arraySource).map((block) => {
    const item = {};
    for (const field of fields) {
      item[field] = readStringField(block, field);
    }
    return item;
  });
}

function extractCreateTableNames(schemaSource) {
  const tableNames = new Set();
  const createTablePattern = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z0-9_]+)/gi;
  for (const match of schemaSource.matchAll(createTablePattern)) {
    tableNames.add(match[1]);
  }
  return [...tableNames].sort();
}

function checkSqliteManifests() {
  const schemaPath = path.join(ROOT, 'app/native-server/src/memory/db/schema.ts');
  if (!existsSync(schemaPath)) {
    addWarning('sqlite-manifest', 'SQLite schema file is missing.', toRepoPath(schemaPath));
    return;
  }

  const schemaSource = readFileSync(schemaPath, 'utf8');
  const activeManifest = parseManifestObjects(schemaSource, 'MEMORY_DB_ACTIVE_TABLE_MANIFEST', [
    'name',
    'layer',
    'surface',
    'retention',
    'purpose',
  ]);
  const retiredManifest = parseManifestObjects(schemaSource, 'MEMORY_DB_RETIRED_TABLES', [
    'name',
    'retiredAt',
    'reason',
  ]);

  if (activeManifest === null || retiredManifest === null) {
    addWarning('sqlite-manifest', 'Could not parse SQLite active/retired table manifests.');
    return;
  }

  const createdTables = extractCreateTableNames(schemaSource);
  const activeNames = activeManifest
    .map((table) => table.name)
    .filter(Boolean)
    .sort();
  const createdWithoutManifest = createdTables.filter((table) => !activeNames.includes(table));
  const manifestWithoutCreate = activeNames.filter((table) => !createdTables.includes(table));

  addInfo(
    'sqlite-active-manifest',
    `${activeManifest.length} active SQLite table manifest ${pluralize(
      activeManifest.length,
      'entry',
      'entries',
    )}.`,
    activeManifest,
  );
  addInfo(
    'sqlite-retired-manifest',
    `${retiredManifest.length} retired SQLite table manifest ${pluralize(
      retiredManifest.length,
      'entry',
      'entries',
    )}.`,
    retiredManifest,
  );

  if (createdWithoutManifest.length > 0 || manifestWithoutCreate.length > 0) {
    addWarning(
      'sqlite-manifest-lockstep',
      'SQLite CREATE TABLE names and active manifest differ.',
      {
        createdWithoutManifest,
        manifestWithoutCreate,
      },
    );
  } else {
    addInfo(
      'sqlite-manifest-lockstep',
      'SQLite CREATE TABLE names match the active table manifest.',
    );
  }
}

function printSection(title, entries) {
  console.log(`\n## ${title}`);
  if (entries.length === 0) {
    console.log('- none');
    return;
  }

  for (const entry of entries) {
    console.log(`- [${entry.code}] ${entry.message}`);
    if (entry.detail === null || entry.detail === undefined) {
      continue;
    }
    const detailItems = Array.isArray(entry.detail) ? entry.detail : [entry.detail];
    const visibleItems = detailItems.slice(0, MAX_DETAIL_ITEMS);
    for (const item of visibleItems) {
      if (typeof item === 'string') {
        console.log(`  - ${item}`);
        continue;
      }
      console.log(`  - ${JSON.stringify(item)}`);
    }
    const hiddenCount = detailItems.length - visibleItems.length;
    if (hiddenCount > 0) {
      console.log(`  - ... ${hiddenCount} more item(s) omitted from console output`);
    }
  }
}

function main() {
  console.log('Tabrix public governance scan');
  console.log(`root: ${ROOT}`);
  console.log('mode: report-only; findings do not fail CI');

  const productionFiles = getProductionFiles();
  addInfo('production-scope', `${productionFiles.length} production source file(s) scanned.`);

  checkPublicSotFiles();
  checkProductionLineCounts(productionFiles);
  checkChromeDebuggerUsage(productionFiles);
  checkNeutralSiteTokens(productionFiles);
  checkSqliteManifests();

  printSection('Warnings', rows.warnings);
  printSection('Info', rows.infos);

  console.log(
    `\nSummary: ${rows.warnings.length} warning group(s), ${rows.infos.length} info group(s).`,
  );
  console.log('Exit status: 0 unless the scanner itself throws.');
}

main();
