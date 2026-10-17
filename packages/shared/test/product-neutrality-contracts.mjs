import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '../../..');

const scannedRoots = [
  'README.md',
  'README_zh.md',
  'CHANGELOG.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'package.json',
  'scripts/README.md',
  'app/chrome-extension/entrypoints',
  'app/chrome-extension/tests',
  'app/native-server/src',
  'packages/shared/src',
  'docs',
];

const scannedExtensions = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.ts',
  '.tsx',
  '.vue',
  '.md',
  '.json',
]);

const ignoredPathParts = new Set([
  'node_modules',
  'dist',
  'build',
  '.output',
  'coverage',
]);

const ignoredFileSuffixes = ['.snap'];

const forbiddenPlatformTerms = [
  ['repo_home', /repo_home/i],
  ['issues_list', /issues_list/i],
  ['workflow_run', /workflow_run/i],
  ['actions_list', /actions_list/i],
  ['codehost', /codehost/i],
  ['non_github_pageRole', /non_github_pageRole/i],
  ['github-prefixed token', /\bgithub_/i],
  ['GitHub API URL', /\bapi\.github\.com\b/i],
  ['npm registry URL', /\bregistry\.npmjs\.org\b/i],
  ['xiaohongshu', /\b(?:xiaohongshu|xhs)\b|小红书/i],
  ['douyin', /\bdouyin\b|抖音/i],
  ['youtube', /\byoutube\b/i],
  ['twitter', /\btwitter\b/i],
  ['weibo', /\bweibo\b/i],
  ['facebook', /\bfacebook\b/i],
  ['linkedin', /\blinkedin\b/i],
  ['amazon', /\bamazon\b/i],
  ['Google Analytics endpoint', /\bgoogle-analytics\b|\bgoogletagmanager\b/i],
  ['Bing tracking endpoint', /\bbat\.bing\b/i],
];

function shouldSkipPath(filePath) {
  const relative = filePath.slice(repoRoot.length + 1).replaceAll('\\', '/');
  const parts = relative.split('/');
  return (
    parts.some((part) => ignoredPathParts.has(part)) ||
    ignoredFileSuffixes.some((suffix) => relative.endsWith(suffix)) ||
    !scannedExtensions.has(extname(filePath))
  );
}

function collectFiles(root) {
  const absoluteRoot = resolve(repoRoot, root);
  if (statSync(absoluteRoot).isFile()) {
    return shouldSkipPath(absoluteRoot) ? [] : [absoluteRoot];
  }
  const entries = readdirSync(absoluteRoot);
  const files = [];
  for (const entry of entries) {
    const absolute = join(absoluteRoot, entry);
    const stats = statSync(absolute);
    if (stats.isDirectory()) {
      if (!ignoredPathParts.has(entry)) {
        files.push(...collectFiles(absolute));
      }
      continue;
    }
    if (!shouldSkipPath(absolute)) {
      files.push(absolute);
    }
  }
  return files;
}

const violations = [];

function isAllowedInfrastructureReference(relative, source, label) {
  if (label === 'github-prefixed token') {
    const nonCiSource = source.replace(/\bGITHUB_(?:ACTIONS|OUTPUT)\b/g, '');
    if (!/\bgithub_/i.test(nonCiSource)) return true;
  }
  if (
    ['GitHub API URL', 'npm registry URL'].includes(label) &&
    (relative.startsWith('scripts/') || relative === 'package.json')
  ) {
    return true;
  }
  if (label === 'github-prefixed token' && relative === 'package.json') {
    return true;
  }
  if (
    relative === 'README.md' ||
    relative === 'README_zh.md' ||
    relative === 'CONTRIBUTING.md' ||
    relative === 'SECURITY.md' ||
    relative === 'AGENTS.md' ||
    relative === 'package.json'
  ) {
    return (
      /\bGitHub Actions\b/i.test(source) ||
      /\bGitHub Releases\b/i.test(source) ||
      /\bSecurity Advisories\b/i.test(source) ||
      /\bgithub\.com\/guodaxia103\/tabrix\b/i.test(source)
    );
  }
  return false;
}

for (const root of scannedRoots) {
  for (const file of collectFiles(root)) {
    const relative = file.slice(repoRoot.length + 1).replaceAll('\\', '/');
    const source = readFileSync(file, 'utf8');
    for (const [label, pattern] of forbiddenPlatformTerms) {
      if (pattern.test(source)) {
        if (isAllowedInfrastructureReference(relative, source, label)) {
          continue;
        }
        violations.push(`${relative}: forbidden platform-specific term: ${label}`);
      }
    }
  }
}

assert.deepEqual(violations, [], violations.join('\n'));

console.log(
  JSON.stringify({
    status: 'PASS',
    contract: 'product-neutrality',
    scannedRoots,
    forbiddenTerms: forbiddenPlatformTerms.length,
  }),
);
