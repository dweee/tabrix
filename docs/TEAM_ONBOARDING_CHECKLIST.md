# Tabrix Team Onboarding Checklist

A step-by-step checklist for developers newly joining Tabrix. Every command
below is annotated with the repository file it comes from.

Execution note (authoring round): unless a line is explicitly marked as
"executed this round", the commands in this document were **not run** while the
checklist was written. Each annotation only confirms where the command comes
from (root `package.json` `scripts` or the named doc). Run them yourself in
your own environment. Only `pnpm run docs:check` is marked as actually executed
this round.

---

## 1. Documentation entry points and reading order

- [ ] Read [README.md](../README.md) first — product overview, quick start,
      documentation map. (source: `README.md`)
- [ ] Skim [docs/README.md](./README.md) — the documentation hub and the
      audience split (users / developers / reference). (source: `docs/README.md`)
- [ ] Read [CONTRIBUTING.md](../CONTRIBUTING.md) — setup, development loop,
      test commands, PR expectations, change-scope boundaries.
      (source: `CONTRIBUTING.md`, "Before You Start")
- [ ] Read [docs/ARCHITECTURE.md](./ARCHITECTURE.md) — runtime components and
      data flow. (source: `CONTRIBUTING.md`, "Before You Start")
- [ ] Read [docs/PROJECT_STRUCTURE.md](./PROJECT_STRUCTURE.md) — where the code
      lives and which files to start from; its section 5 gives the suggested
      reading order. (source: `docs/PROJECT_STRUCTURE.md`, §5)
- [ ] Read [docs/TESTING.md](./TESTING.md) — verification principles and
      verification levels. (source: `docs/TESTING.md`,
      Verification Principles)
- [ ] For user-side install/connect behavior, read
      [docs/QUICKSTART.md](./QUICKSTART.md). (source: `docs/README.md`, "Users")
- [ ] If you are an AI coding assistant, also read
      [AGENTS.md](../AGENTS.md). (source: `CONTRIBUTING.md`, "Before You Start")
- [ ] Chinese readers: the Chinese landing page is
      [README_zh.md](../README_zh.md) — `docs/` is English-only.
      (source: `docs/README.md`, "Language Policy")
- [ ] Suggested code reading order after the docs:
      `packages/shared/src/tools.ts` → `app/native-server/src/mcp/register-tools.ts`
      → `app/chrome-extension/entrypoints/background/index.ts` → the module you
      change. (source: `docs/PROJECT_STRUCTURE.md`, §5)

## 2. Environment preparation

- [ ] Node.js `20+` installed. (source: `CONTRIBUTING.md`, "Requirements";
      confirmed by root `package.json` → `engines.node: ">=20.0.0"`)
- [ ] pnpm `10+` installed. (source: `CONTRIBUTING.md`, "Requirements";
      confirmed by root `package.json` → `engines.pnpm: ">=10.0.0"`,
      `packageManager: "pnpm@10.22.0"`)
- [ ] Chrome or Chromium available — required for extension and browser-path
      testing. (source: `CONTRIBUTING.md`, "Requirements")
- [ ] Git installed. (source: `CONTRIBUTING.md`, "Requirements")
- [ ] Know that this is a pnpm monorepo with three workspaces:
      `app/chrome-extension`, `app/native-server`, `packages/shared`.
      (source: `CONTRIBUTING.md`, "Requirements"; `pnpm-workspace.yaml` →
      `packages: ['app/*', 'packages/*']`)
- [ ] Be aware `pnpm-workspace.yaml` only allows postinstall builds for
      `better-sqlite3`, `esbuild`, `spawn-sync`. (source: `pnpm-workspace.yaml`
      → `allowBuilds`)

## 3. Install and build

- [ ] Clone and enter the repo:

  ```bash
  git clone https://github.com/guodaxia103/tabrix.git
  cd tabrix
  ```

  (source: `CONTRIBUTING.md`, "Setup")

- [ ] Install dependencies: `pnpm install`
      (source: `CONTRIBUTING.md`, "Setup") — not executed this round.
- [ ] Build all packages: `pnpm run build`
      (source: root `package.json` → `scripts.build`; `CONTRIBUTING.md`,
      "Setup") — not executed this round.
- [ ] Run the main verification set: `pnpm run verify`
      (source: root `package.json` → `scripts.verify` =
      `typecheck && lint && test:core`; `CONTRIBUTING.md`, "Setup")
      — not executed this round.
- [ ] Run the full public CI-style check: `pnpm run ci:check`
      (source: root `package.json` → `scripts.ci:check` =
      `i18n:check && docs:check && governance:console && governance:empty-catch
    && typecheck && lint && test:core && audit`; `CONTRIBUTING.md`, "Setup")
      — not executed this round.
- [ ] Optional per-package builds: `pnpm run build:shared` /
      `pnpm run build:native` / `pnpm run build:extension`
      (source: root `package.json` → `scripts.build:shared`,
      `scripts.build:native`, `scripts.build:extension`;
      `CONTRIBUTING.md`, "Local Development") — not executed this round.

## 4. Local development and the extension change loop

- [ ] Start all development processes: `pnpm run dev`
      (source: root `package.json` → `scripts.dev` = builds `@tabrix/shared`
      then `pnpm -r --parallel dev`; `CONTRIBUTING.md`, "Local Development")
      — not executed this round.
- [ ] Run only one side when needed: `pnpm run dev:shared` /
      `pnpm run dev:native` / `pnpm run dev:extension`
      (source: root `package.json` → `scripts.dev:shared`, `scripts.dev:native`,
      `scripts.dev:extension`; `CONTRIBUTING.md`, "Local Development")
      — not executed this round.
- [ ] After changing extension code, rebuild it:
      `pnpm -C app/chrome-extension build`
      (source: `CONTRIBUTING.md`, "Local Development";
      script confirmed in `app/chrome-extension/package.json` → `scripts.build`)
      — not executed this round.
- [ ] Reload the extension: `pnpm run extension:reload`
      (source: root `package.json` → `scripts.extension:reload` →
      `scripts/reload-extension.mjs`; `CONTRIBUTING.md`,
      "Local Development") — not executed this round.
- [ ] If automatic reload cannot reach Chrome, reload the unpacked extension
      manually from `chrome://extensions`. (source: `CONTRIBUTING.md`,
      "Local Development")
- [ ] For local development builds, load the unpacked extension from
      `app/chrome-extension/.output/chrome-mv3`
      (source: `CONTRIBUTING.md`, "Loading the Extension"; directory confirmed
      present at authoring time) — for normal users, install the packaged
      extension zip from GitHub Releases instead.
- [ ] Open `chrome://extensions`, enable `Developer mode`, choose
      `Load unpacked`, select that directory, then open the popup and click
      `Connect`. (source: `CONTRIBUTING.md`, "Loading the Extension";
      `docs/QUICKSTART.md`, §2)

## 5. Common checks

- [ ] `pnpm run docs:check` — documentation navigation and required-file checks
      (source: root `package.json` → `scripts.docs:check` →
      `scripts/check-docs.mjs`; `CONTRIBUTING.md`, "Common Checks")
      — executed this round after writing this file (see verification note
      below).
- [ ] `pnpm run typecheck` (source: root `package.json` → `scripts.typecheck` =
      `pnpm -r --if-present typecheck`; `CONTRIBUTING.md`, "Common Checks")
      — not executed this round.
- [ ] `pnpm run lint` (source: root `package.json` → `scripts.lint` =
      `pnpm -r --if-present lint`; `CONTRIBUTING.md`, "Common Checks")
      — not executed this round.
- [ ] `pnpm run test:core` (source: root `package.json` → `scripts.test:core` =
      `pnpm -C app/native-server test:ci && pnpm -C app/chrome-extension test`;
      `CONTRIBUTING.md`, "Common Checks") — not executed this round.
- [ ] `pnpm run audit` — production dependency audit
      (source: root `package.json` → `scripts.audit` → `scripts/audit-prod.mjs`;
      `CONTRIBUTING.md`, "Common Checks") — not executed this round.
- [ ] `pnpm run size:check` — bundle size gate
      (source: root `package.json` → `scripts.size:check` →
      `scripts/check-bundle-size.mjs`; `CONTRIBUTING.md`, "Common Checks")
      — not executed this round.
- [ ] Targeted tests:

  ```bash
  pnpm -C packages/shared test:contracts
  pnpm -C app/native-server test:ci
  pnpm -C app/chrome-extension test
  ```

  (source: `CONTRIBUTING.md`, "Common Checks"; each script confirmed in the
  matching `package.json` → `scripts.test:contracts` / `scripts.test:ci` /
  `scripts.test`) — not executed this round.

- [ ] Runtime checks against a live install:
      `tabrix status`, `tabrix doctor --fix`, `tabrix smoke`,
      `tabrix stdio-smoke`
      (source: `CONTRIBUTING.md`, "Runtime checks"; `README.md`,
      "Quick Start") — not executed this round.

## 6. Common pitfalls

- [ ] Do not claim browser-side behavior is verified unless the extension was
      rebuilt, reloaded, and tested through the **real browser path** —
      a code-level test is not runtime verification.
      (source: `CONTRIBUTING.md`, "Common Checks"; `docs/TESTING.md`,
      "Verification Principles")
- [ ] After loading the unpacked extension, keep it in a stable directory and
      do not move it — Chrome remembers the exact unpack path.
      (source: `docs/QUICKSTART.md`, §2)
- [ ] Open an issue or discussion **first** for: public MCP tool changes,
      shared DTO or SQLite schema changes, risk-tier or security-policy
      changes, new dependencies, new browser-control surfaces, large UI /
      architecture / roadmap changes.
      (source: `CONTRIBUTING.md`, "Change Scope")
- [ ] Do not reintroduce removed surfaces — embedded assistant UI, workflow
      builders, element picker, visual editor, record/replay engines, local
      semantic search — without an explicit maintainer decision.
      (source: `CONTRIBUTING.md`, "Change Scope"; `docs/PROJECT_STRUCTURE.md`,
      scope note)
- [ ] Do not commit machine-local or private files (editor dirs, logs, local
      reports, planning/acceptance artifacts). `node_modules`, `.output`,
      `.wxt`, `dist`, `.idea`, logs are gitignored; `docs/` must not contain
      private Chinese planning material. (source: `CONTRIBUTING.md`,
      "Pull Request Checklist"; `.gitignore`; `docs/README.md`,
      "Public and Private Boundary")
- [ ] `packages/shared/` is the key stability boundary — tool schema, risk
      tier, and cross-process type changes usually start there and need
      matching native-server and extension builds.
      (source: `docs/PROJECT_STRUCTURE.md`, §6; `docs/TESTING.md`,
      "Shared contract or tool schema changes")
- [ ] `docs/` is English-only; Chinese public copy belongs in `README_zh.md`.
      (source: `docs/README.md`, "Language Policy")
- [ ] `archive/` and `skills/` are not current product truth — prefer
      `docs/TOOLS.md`, `docs/CLI_AND_MCP.md`.
      (source: `docs/PROJECT_STRUCTURE.md`, "Workspace Responsibilities")
- [ ] CDP is a bounded sensing/diagnostics enhancer, not the default public
      control surface; Chrome APIs are the default execution path.
      (source: `docs/ARCHITECTURE.md`, scope note)

---

Authoring verification note: this checklist was produced from a read-only
review of `README.md`, `CONTRIBUTING.md`, `docs/README.md`, `docs/QUICKSTART.md`,
`docs/ARCHITECTURE.md`, `docs/PROJECT_STRUCTURE.md`, `docs/TESTING.md`,
root / `app/*` / `packages/*` `package.json`, `pnpm-workspace.yaml`, and the
live directory tree. No install, commit, or publish action was performed.
