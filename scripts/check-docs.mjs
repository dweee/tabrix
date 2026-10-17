import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = process.cwd();

const requiredFiles = [
  'AGENTS.md',
  'README.md',
  'README_zh.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'docs/README.md',
  'docs/QUICKSTART.md',
  'docs/TROUBLESHOOTING.md',
  'docs/CLI_AND_MCP.md',
  'docs/PRODUCT_SURFACE_MATRIX.md',
  'docs/TESTING.md',
  'docs/PLATFORM_SUPPORT.md',
  'docs/COMPATIBILITY_MATRIX.md',
  'docs/USE_CASES.md',
  'docs/ARCHITECTURE.md',
  'docs/PROJECT_STRUCTURE.md',
  'docs/REPOSITORY_GOVERNANCE.md',
  'docs/ROADMAP.md',
  'docs/RELEASE_PROCESS.md',
  'docs/TOOLS.md',
  'docs/releases/README.md',
  'docs/releases/EXTENSION_ASSETS.md',
  'archive/README.md',
];

const mustReference = [
  {
    file: 'AGENTS.md',
    includes: [
      'docs/README.md',
      'docs/PRODUCT_SURFACE_MATRIX.md',
      'docs/ARCHITECTURE.md',
      'docs/PROJECT_STRUCTURE.md',
      'docs/QUICKSTART.md',
      'docs/TROUBLESHOOTING.md',
      'docs/CLI_AND_MCP.md',
      'CONTRIBUTING.md',
      'SECURITY.md',
    ],
  },
  {
    file: 'README.md',
    includes: [
      'docs/README.md',
      'docs/QUICKSTART.md',
      'docs/TROUBLESHOOTING.md',
      'docs/CLI_AND_MCP.md',
      'docs/USE_CASES.md',
      'docs/PRODUCT_SURFACE_MATRIX.md',
      'docs/ARCHITECTURE.md',
      'CONTRIBUTING.md',
      'SECURITY.md',
    ],
  },
  {
    file: 'README_zh.md',
    includes: [
      'docs/README.md',
      'docs/QUICKSTART.md',
      'docs/TROUBLESHOOTING.md',
      'docs/CLI_AND_MCP.md',
      'docs/USE_CASES.md',
      'CONTRIBUTING.md',
      'SECURITY.md',
    ],
  },
  {
    file: 'docs/README.md',
    includes: [
      'QUICKSTART.md',
      'TROUBLESHOOTING.md',
      'CLI_AND_MCP.md',
      'USE_CASES.md',
      'PRODUCT_SURFACE_MATRIX.md',
      'TESTING.md',
      'PLATFORM_SUPPORT.md',
      'COMPATIBILITY_MATRIX.md',
      'ARCHITECTURE.md',
      'PROJECT_STRUCTURE.md',
      'REPOSITORY_GOVERNANCE.md',
      'ROADMAP.md',
      'RELEASE_PROCESS.md',
      'TOOLS.md',
      'releases/README.md',
    ],
  },
];

const forbiddenPatterns = [/internal-docs[\\/]/, /E:\\projects\\AI\\codex\\internal-docs/i];
const forbiddenHeroImagePatterns = [
  {
    file: 'README.md',
    pattern: /!\[[^\]]*]\(https:\/\/img\.shields\.io\//,
    reason: 'remote badge images break the first-screen README preview when image loading is blocked',
  },
  {
    file: 'README_zh.md',
    pattern: /!\[[^\]]*]\(https:\/\/img\.shields\.io\//,
    reason: 'remote badge images break the first-screen README preview when image loading is blocked',
  },
];
const rootReleaseNotesPattern = /^RELEASE_NOTES_v.+\.md$/;
const forbiddenTrackedRootPrefixes = [
  '.acp-sessions/',
  '.agents/',
  '.claude/',
  '.codex-prompts/',
  '.gstack-codex-txn/',
  '.playwright-mcp/',
  '.private-artifacts/',
  '.private-tests/',
  'code-reviews/',
  'prompt/',
  'releases/',
];

const codeSearchRoots = ['app', 'packages', 'scripts'];
const allowedCodeDocLinkFiles = new Set(['app/chrome-extension/common/constants.ts']);
const githubDocsBlobPattern =
  /https:\/\/github\.com\/guodaxia103\/tabrix\/blob\/main\/(docs\/[A-Za-z0-9_./-]+\.md)/g;

let failed = false;

function getTrackedFiles() {
  try {
    return execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(Boolean)
      .map((file) => file.replaceAll('\\', '/'));
  } catch {
    return [];
  }
}

function collectFiles(rootDir) {
  if (!fs.existsSync(rootDir)) return [];

  const result = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (
          ['node_modules', 'dist', 'coverage', 'releases', '.git', '.output', '.wxt'].includes(
            entry.name,
          )
        ) {
          continue;
        }
        stack.push(nextPath);
        continue;
      }

      if (entry.isFile()) {
        result.push(nextPath);
      }
    }
  }

  return result;
}

for (const relativeFile of requiredFiles) {
  const absoluteFile = path.join(repoRoot, relativeFile);
  if (!fs.existsSync(absoluteFile)) {
    console.error(`[docs:check] missing required file: ${relativeFile}`);
    failed = true;
  }
}

for (const entry of fs.readdirSync(path.join(repoRoot, 'docs'), { withFileTypes: true })) {
  if (entry.isFile() && rootReleaseNotesPattern.test(entry.name)) {
    console.error(
      `[docs:check] release notes must live under docs/releases/: docs/${entry.name}`,
    );
    failed = true;
  }
}

for (const trackedFile of getTrackedFiles()) {
  for (const prefix of forbiddenTrackedRootPrefixes) {
    if (trackedFile.startsWith(prefix)) {
      console.error(
        `[docs:check] tracked public files must not live under root ${prefix}: ${trackedFile}`,
      );
      failed = true;
    }
  }
}

for (const rule of mustReference) {
  const absoluteFile = path.join(repoRoot, rule.file);
  if (!fs.existsSync(absoluteFile)) {
    continue;
  }
  const content = fs.readFileSync(absoluteFile, 'utf8');
  for (const expected of rule.includes) {
    if (!content.includes(expected)) {
      console.error(`[docs:check] ${rule.file} is missing expected reference: ${expected}`);
      failed = true;
    }
  }
}

const publicDocsFiles = [
  'AGENTS.md',
  'README.md',
  'README_zh.md',
  ...fs.readdirSync(path.join(repoRoot, 'docs')).map((name) => path.join('docs', name)),
].filter((relativePath) => {
  const absolutePath = path.join(repoRoot, relativePath);
  return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile();
});

for (const relativeFile of publicDocsFiles) {
  const absoluteFile = path.join(repoRoot, relativeFile);
  const content = fs.readFileSync(absoluteFile, 'utf8');
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(content)) {
      console.error(
        `[docs:check] forbidden internal reference found in ${relativeFile}: ${pattern}`,
      );
      failed = true;
    }
  }
}

for (const rule of forbiddenHeroImagePatterns) {
  const absoluteFile = path.join(repoRoot, rule.file);
  if (!fs.existsSync(absoluteFile)) {
    continue;
  }
  const content = fs.readFileSync(absoluteFile, 'utf8');
  if (rule.pattern.test(content)) {
    console.error(`[docs:check] ${rule.file}: ${rule.reason}`);
    failed = true;
  }
}

const codeFiles = codeSearchRoots.flatMap((root) => collectFiles(path.join(repoRoot, root)));
for (const absoluteFile of codeFiles) {
  const content = fs.readFileSync(absoluteFile, 'utf8');
  const matches = content.matchAll(githubDocsBlobPattern);
  for (const match of matches) {
    const relativeCodePath = path.relative(repoRoot, absoluteFile).replaceAll('\\', '/');
    const relativeDocPath = match[1];
    const absoluteDocPath = path.join(repoRoot, relativeDocPath);
    if (!fs.existsSync(absoluteDocPath)) {
      console.error(
        `[docs:check] code references missing public doc: ${relativeDocPath} (from ${relativeCodePath})`,
      );
      failed = true;
    }

    if (!allowedCodeDocLinkFiles.has(relativeCodePath)) {
      console.error(
        `[docs:check] hardcoded public doc links must route through ${Array.from(allowedCodeDocLinkFiles).join(', ')} (found in ${relativeCodePath})`,
      );
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}

console.log('[docs:check] OK');
