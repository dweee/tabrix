# Tabrix Scripts

This directory contains repo-level maintenance scripts. The public repository
owns deterministic gates and public-safe transformers; it does not own raw
real-browser acceptance evidence.

## Public Deterministic Gates

These scripts can run from a normal checkout without private accounts or live
site state:

- `check-docs.mjs` (`pnpm run docs:check`)
- `check-i18n.mjs` (`pnpm run i18n:check`)
- `check-bundle-size.mjs` (`pnpm run size:check`)
- `check-public-governance.mjs` (`pnpm run governance:public`) — report-only
  scan for public SoT presence, architecture boundary warnings, large source
  files, and SQLite table manifest summaries.
- `check-console-governance.mjs` (`pnpm run governance:console`)
- `audit-prod.mjs` (`pnpm run audit`)
- `check-release-readiness.mjs` (`pnpm run release:check`)
- `mcp-redacted-browser-world-smoke.mjs` (`pnpm run smoke:browser-world:redacted`)

`check-release-readiness.mjs` validates package metadata, notes placement, and
the version-appropriate benchmark gate. For v2.6.0+ local owner-lane runs it
requires private transformed benchmark evidence; GitHub Actions fresh checkouts
validate the committed public release-notes summary because private evidence is
not available there.

`mcp-redacted-browser-world-smoke.mjs` calls the local Tabrix MCP runtime and
prints only browser-world counts, booleans, compact limits, and claim
boundaries. It intentionally does not print tab URLs, titles, account state,
screenshots, cookies, network bodies, or page text, so owner-lane smoke checks
do not leak the maintainer's current browser session. It supports single-tab,
lifecycle, multi-public-target matrix, observer-only window-state, and
read_page / BrowserPageObject alignment smoke scenarios.

## Private Evidence Bridges

The benchmark CLIs are public code that transform private real-browser run logs
into deterministic summaries:

- `benchmark-v23.mjs`
- `benchmark-v24.mjs`
- `benchmark-v25.mjs`
- `release-diagnostic-v25.mjs`

Raw NDJSON logs, screenshots, private-account results, baseline comparison
artifacts, and live-site scenario outputs must stay outside public docs. The
scripts read or write them under `TABRIX_RELEASE_EVIDENCE_DIR` when set, or
under `.claude/private-docs/benchmarks/` for maintainer-local runs.

## V27 Public-Safe Reports

`scripts/lib/v27-benchmark-gate.cjs` validates a redacted V27 summary shape.
The matching TypeScript report builder lives in
`app/native-server/src/benchmark/v27-real-gate-report.ts`.

A V27 public-safe `PASS` means only that the redacted public summary passed its
deterministic checks. It is not a release-readiness claim and it does not prove
that real content platforms, private-account, or competitor scenarios passed.
Those live runs belong to the maintainer-private acceptance lane.

## Legacy Client-Specific Helpers

`run-claude-acceptance.ps1`, `claude-smoke-server.cjs`, and
`cleanup-acceptance-tabs.cjs` are legacy Claude CLI smoke helpers. They are not
package scripts, CI gates, release gates, or agent-agnostic product acceptance
runners. Use them only when a maintainer explicitly asks for that Claude-specific
smoke path.
