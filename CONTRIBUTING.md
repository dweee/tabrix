# Contributing

Thanks for helping improve Tabrix.

This guide is for public contributors. Maintainer-private planning, acceptance
evidence, benchmark artifacts, and release-gate materials are not required for
normal contributions and should not be recreated in this repository.

## Before You Start

Read these first:

1. [README](./README.md)
2. [Docs Index](./docs/README.md)
3. [Architecture](./docs/ARCHITECTURE.md)
4. [Project Structure](./docs/PROJECT_STRUCTURE.md)
5. [Product Surface Matrix](./docs/PRODUCT_SURFACE_MATRIX.md)

If you are an AI coding assistant, also read [AGENTS.md](./AGENTS.md).

## Requirements

- Node.js `20+`
- pnpm `10+`
- Chrome or Chromium for extension and browser-path testing
- Git

This repository is a pnpm monorepo:

```text
app/chrome-extension   Chrome extension runtime
app/native-server      CLI, MCP server, Native Messaging host
packages/shared        shared tool schemas and cross-process contracts
```

## Setup

```bash
git clone https://github.com/guodaxia103/tabrix.git
cd tabrix
pnpm install
```

Build all packages:

```bash
pnpm run build
```

Run the main verification set:

```bash
pnpm run verify
```

Run the full public CI-style check:

```bash
pnpm run ci:check
```

## Local Development

Start all development processes:

```bash
pnpm run dev
```

Run package-specific development commands when you only need one side:

```bash
pnpm run dev:shared
pnpm run dev:native
pnpm run dev:extension
```

Build package-specific targets:

```bash
pnpm run build:shared
pnpm run build:native
pnpm run build:extension
```

After changing extension code, use the local extension loop:

```bash
pnpm -C app/chrome-extension build
pnpm run extension:reload
```

If automatic reload cannot reach Chrome, reload the unpacked extension manually
from `chrome://extensions`.

## Loading the Extension

For local development builds, use the WXT output directory:

```text
app/chrome-extension/.output/chrome-mv3
```

Open `chrome://extensions`, enable `Developer mode`, choose `Load unpacked`,
and select that directory.

For normal user installation, use the packaged extension asset from GitHub
Releases instead of the local build output.

## Common Checks

```bash
pnpm run docs:check
pnpm run typecheck
pnpm run lint
pnpm run test:core
pnpm run audit
pnpm run size:check
```

Targeted tests:

```bash
pnpm -C packages/shared test:contracts
pnpm -C app/native-server test:ci
pnpm -C app/chrome-extension test
```

Runtime checks:

```bash
tabrix status
tabrix doctor --fix
tabrix smoke
tabrix stdio-smoke
```

Do not claim browser-side behavior is verified unless the extension has been
built, reloaded, and tested through the real browser path.

## Change Scope

Prefer small, verifiable changes.

Good contribution scope:

- bug fixes with regression tests
- documentation corrections that reflect real commands
- tool schema consistency fixes
- platform install or packaging reliability
- deterministic tests for shared, native-server, or extension behavior

Open an issue or discussion first for:

- public MCP tool changes
- shared DTO or SQLite schema changes
- risk-tier or security-policy changes
- new dependencies
- new browser-control surfaces
- large UI, architecture, or roadmap changes

Do not reintroduce removed surfaces such as embedded assistant UI, workflow
builders, element picker, visual editor, record/replay engines, or local
semantic search without an explicit maintainer decision.

## Pull Request Checklist

Before opening a PR:

- explain the user-visible problem or developer problem
- keep the diff focused
- add or update the smallest useful test
- run the smallest relevant verification commands
- update docs only when user or contributor behavior changed
- avoid committing private planning, acceptance evidence, local reports, or
  machine-specific files

Recommended final checks:

```bash
pnpm run docs:check
pnpm run verify
```

Use `pnpm run ci:check` before larger PRs.

## Commit Style

Use clear conventional prefixes when possible:

- `feat:` new user-visible behavior
- `fix:` bug fix
- `docs:` documentation-only change
- `test:` test-only change
- `refactor:` behavior-preserving code restructuring

## Bug Reports

Include:

- operating system
- Chrome or Chromium version
- Node.js and pnpm versions
- Tabrix version or commit
- MCP client used
- exact steps to reproduce
- expected behavior
- actual behavior
- relevant output from `tabrix status`, `tabrix doctor`, or `tabrix report`

## Security

Do not open public issues for vulnerabilities. Follow [SECURITY.md](./SECURITY.md).

## License

By contributing, you agree that your contribution is licensed under the MIT
License.
