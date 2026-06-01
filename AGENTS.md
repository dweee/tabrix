# Tabrix AI Development Rules

This repository welcomes contributions from **any AI coding assistant** — Claude (Desktop / Code / Cursor), Codex CLI, Cursor Agent, Cline, Windsurf, GPT-5, Gemini, and any future tool capable of reading + writing files. The historical `Claude → Codex` two-name pairing that appears in old sprint retros was about two specific tools the original maintainer happened to be running, not a restriction on who may contribute.

What matters is the **role** an AI plays for a given task (see "Tiered Execution Model" below), not which vendor ships it.

This repository uses a strict "small, verifiable, low-regression" workflow for AI-assisted development.

All code changes in this repository must follow the `karpathy-guidelines` skill when it is available. If that named skill is not available in the current AI assistant, follow the same baseline rules:

- think before coding
- keep the change as small as possible
- define a verifiable success condition
- prefer a real fix over a temporary suppression

## Command Output
Protect context usage. **Any command with unknown or potentially large output must be byte-capped.**  
Default pattern: 
COMMAND 2>&1 | head -c 4000 


## Workspace and Collaboration Guardrails

Before changing any file, confirm the actual repository root and working tree you are about to edit:

```bash
git rev-parse --show-toplevel
git status --short --branch
```

If the user names a specific path such as `E:\projects\AI\codex\main_tabrix`, treat that path as authoritative. Do not silently edit a detached worktree, temporary checkout, or sibling clone and then report success for the named project directory.

When another assistant or maintainer is actively developing in the same checkout:

- do not touch the same implementation files unless the user explicitly asks you to take over;
- prefer read-only review, documentation-only edits, or a separate owner-lane brief;
- state the exact file scope before editing;
- re-check `git status --short --branch` before and after the task so unrelated concurrent changes are not attributed to your work.

## Mandatory Read Path

Before changing code or docs, every AI assistant should read the public repository docs below first, **in this order**:

1. [README.md](./README.md)
2. [docs/README.md](./docs/README.md)
3. [docs/ROADMAP.md](./docs/ROADMAP.md) — public product direction and contribution areas.
4. [docs/PRODUCT_SURFACE_MATRIX.md](./docs/PRODUCT_SURFACE_MATRIX.md) — current public product surface + capability tiers (GA/Beta/Experimental/Internal).
5. [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
6. [docs/PROJECT_STRUCTURE.md](./docs/PROJECT_STRUCTURE.md)
7. [CONTRIBUTING.md](./CONTRIBUTING.md)

Then continue with the smallest relevant task-specific reading set below.

### Private maintainer planning boundary

Detailed PRDs, sprint backlogs, owner-lane briefs, and version-internal plans are maintainer-private materials and must stay outside the public Git tree. Public contributors should use `docs/ROADMAP.md`, `docs/PRODUCT_SURFACE_MATRIX.md`, and code-local issues/PRs as the public working contract.

### Public rulebook boundary

`AGENTS.md` governs how AI assistants contribute to the public repository.

It does **not** define:
- the current maintainer-private version goal,
- the current private active execution SoT,
- the current private delivery ledger state,
- or maintainer-private owner-lane dispatch workflow details.

Those private authorities may exist outside the public repository and must not be recreated here.

## Task-Specific Reading

### Product positioning, public docs, and boundary-governance tasks

Read:

- [docs/README.md](./docs/README.md)
- [docs/PRODUCT_SURFACE_MATRIX.md](./docs/PRODUCT_SURFACE_MATRIX.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)

### Transport, CLI, MCP, native-server, and diagnostics tasks

Read:

- [docs/CLI_AND_MCP.md](./docs/CLI_AND_MCP.md)
- [docs/TOOLS.md](./docs/TOOLS.md)

### Extension, popup, onboarding, and troubleshooting tasks

Read:

- [docs/QUICKSTART.md](./docs/QUICKSTART.md)
- [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)
- [docs/EXTENSION_TESTING_CONVENTIONS.md](./docs/EXTENSION_TESTING_CONVENTIONS.md) — required when adding or editing any `app/chrome-extension/tests/**` file.

### MKEP Memory-layer tasks (SQLite / SessionManager / post-processor / sidepanel Memory tab)

Public touchpoints: `app/native-server/src/memory/**`, `app/chrome-extension/entrypoints/sidepanel/**` (Memory tab). Detailed phase plans are maintainer-private and must not be reintroduced under `docs/`.

### MKEP Knowledge-layer tasks (registry / seeds / HVO classifier / UI map)

Public touchpoints: `app/chrome-extension/entrypoints/background/knowledge/**`, `app/chrome-extension/entrypoints/background/tools/browser/read-page*`. Detailed Knowledge stage plans are maintainer-private and must not be reintroduced under `docs/`.

### MKEP Experience-layer tasks (action-path replay / recipes / shared deck)

Read the public MKEP code map in this file and the relevant implementation modules. Detailed Experience package briefs are maintainer-private and must not be reintroduced under `docs/`.

### MKEP Policy-layer tasks (risk-tier gating / capability opt-in)

Public touchpoints: `app/native-server/src/policy/**`, `packages/shared/src/tools/**` (`TOOL_RISK_TIERS` + `requiresExplicitOptIn`). Detailed Policy phase plans are maintainer-private and must not be reintroduced under `docs/`.

### Release, security, and third-party reuse tasks

Read:

- [docs/RELEASE_PROCESS.md](./docs/RELEASE_PROCESS.md)
- [docs/TESTING.md](./docs/TESTING.md)
- [docs/PLATFORM_SUPPORT.md](./docs/PLATFORM_SUPPORT.md)
- [SECURITY.md](./SECURITY.md)

### Test / acceptance ownership

`main_tabrix` owns product code, public contracts, deterministic unit/integration tests, benchmark transformers, release gates, report schemas, and regression tests that do not depend on real accounts, private repositories, live browser state, or external-site stability.

Keep these in `main_tabrix`:

- Pure functions, DTO/schema validation, repository/handler tests, policy gates, release-readiness checks, bundle/docs/typecheck/audit gates, and fixture-level benchmark tests.
- Public baseline tests that protect Tabrix's declared open surface and can run deterministically in CI.

Keep these in the maintainer-private acceptance repository:

- Real MCP browser runs, live-site scenarios, login/private-account flows, private repository/account cases, benchmark NDJSON producers, screenshots, and release evidence artifacts.

Passing `main_tabrix` tests is not product-level acceptance for claims about real browser behavior, version benchmark evidence, or release readiness. Those claims require the matching maintainer-private acceptance lane.

## MKEP Code Map (post-pruning)

Use this map when you need to locate where a layer lives. If a task does not fit any of the four layers cleanly, stop and surface the mismatch instead of inventing a new home.

| Layer          | Native server                                                      | Chrome extension                                                    | Shared                                                              |
| -------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Memory**     | `app/native-server/src/memory/**` (SQLite, SessionManager, post-processor) | Sidepanel Memory tab (placeholder, Stage 3e target)                 | –                                                                   |
| **Knowledge**  | –                                                                  | `app/chrome-extension/entrypoints/background/knowledge/**` (seeds, registry, lookup) | –                                                                   |
| **Experience** | _not yet scaffolded — will live under `src/memory/experience/`_    | Sidepanel Experience tab (placeholder, Stage 3b target)             | –                                                                   |
| **Policy**     | `app/native-server/src/policy/**`                                  | Sidepanel Policy surface (future)                                   | `packages/shared/src/tools/**` (`TOOL_RISK_TIERS`, `requiresExplicitOptIn`) |

Cross-cutting helpers:

- `app/native-server/src/shared/data-dirs.ts` — `~/.chrome-mcp-agent/` resolver used by Memory.
- `app/chrome-extension/entrypoints/background/keepalive/` — MV3 SW keepalive (Offscreen Document + Port heartbeat). Do not reopen the old RR-V3 path.
- `packages/shared/src/` public API boundary: `constants`, `types`, `tools/**` (contract entrypoint at `tools.ts`, modules under `tools/`), `labels`, `bridge-ws`, `read-page-contract`. **Any new cross-process type goes here, and nowhere else.**

## Removed Surfaces — Must Not Be Reintroduced

The following product surfaces were removed from the public product surface and **must not be reintroduced** without an explicit governance decision from the repository owner:

- Smart Assistant / Quick Panel / Agent Chat in the sidepanel (Codex / Claude / Cursor / Cline are the intended upstream drivers — Tabrix does not embed its own assistant UI).
- Record & Replay v2 / v3 engine, builder UI, `run_flow` / `list_published_flows` MCP tools.
- Local semantic engine / ONNX WASM workers / `search_tabs_content` MCP tool / `@xenova/transformers` / `hnswlib-wasm-static` / `@vue-flow/*` / `elkjs`.
- Element Marker management, `element_picker` MCP tool.
- Visual Editor (`web-editor-v2`).

If a task seems to require any of these surfaces, stop and ask. The strategic value of the removed surfaces has been remapped to MKEP work tracked in maintainer-private planning, while the public boundary remains [`docs/PRODUCT_SURFACE_MATRIX.md`](./docs/PRODUCT_SURFACE_MATRIX.md).

## Role-Based Execution Model (any AI assistant)

This repository recognizes three AI work lanes. The split is based on **task responsibility**, not on which AI product is running. Any AI assistant may operate in any lane, but it must know which lane it is in and must not silently cross the boundary.

| Lane | Responsibility | Must not do |
| --- | --- | --- |
| **Owner-lane** | Define user value, scope, architecture, contract/risk decisions, and task order | Pretend implementation-only evidence proves product readiness |
| **Executor-lane** | Implement a bounded approved brief exactly within scope | Change architecture, public contracts, schema, risk tier, or scope silently |
| **Acceptance-lane** | Validate product behavior, evidence quality, and scenario coverage | Hide capability gaps behind fallback success or unit tests |

One AI assistant may perform multiple lanes in one session, but it must explicitly switch responsibilities and use the matching evidence standard.

Executor-lane may do mechanical work such as bounded refactors, imports, docs on explicitly listed symbols, test scaffolding on explicitly listed methods, narrow file deletions, and running existing verification commands. Executor-lane must stop and return control to owner-lane when a task requires architectural choice, public contract change, risk-tier change, schema migration, dependency/CI change, or a removed-surface decision.

Detailed maintainer-private dispatch, hand-off, and restricted-environment workflow rules live in maintainer-private protocols and are not reproduced here.

## Operational Guardrails

These are cross-cutting size / performance / schema rules that every AI assistant (regardless of vendor or lane) must respect. They are enforced by CI in `.github/workflows/ci.yml`.

### Sidepanel bundle-size gate (added in B-007, CSS added in B-021)

- Script: `scripts/check-bundle-size.mjs`, wired as `pnpm run size:check` and run in CI after the extension build step. One script, two targets, declared in a `TARGETS` array at the top of the file.
- Targets (WXT splits JS into `chunks/` and CSS into `assets/`):
  - `app/chrome-extension/.output/chrome-mv3/chunks/sidepanel-*.js`
  - `app/chrome-extension/.output/chrome-mv3/assets/sidepanel-*.css`
- Thresholds (raw, not gzipped — easier to eyeball against the WXT build report):

  | Target             | Soft (warn)  | Hard (fail)  |
  | ------------------ | ------------ | ------------ |
  | `sidepanel-*.js`   | 35 kB        | 40 kB        |
  | `sidepanel-*.css`  | 25 kB        | 28 kB        |

- Post-V25-03 baselines: `sidepanel-*.js` ≈ 32.8 kB, `sidepanel-*.css` ≈ 24.0 kB. The CSS cap is tighter than the JS cap on purpose — CSS renders on the critical path, and the Execution tab growth was reviewed with the threshold change in the same commit.
- If a feature pushes either bundle past its soft threshold: either split the feature behind a dynamic import (JS) / scoped stylesheet (CSS), or raise the threshold **in the same reviewed commit** as the feature — never in a separate "oops" follow-up.
- Adding a third target (e.g. `popup-*.js`) is a future backlog item; do not squeeze new targets in opportunistically.

### Schema-cite rule (added in B-009)

Every backlog item whose scope touches the Memory / Knowledge / Experience SQLite tables or the shared DTO contract in `packages/shared/src/` must cite the authoritative schema before implementation starts. Concretely, the "Schema cite" line of the backlog entry must:

- Point at the exact repository file + (when possible) line range of the SQL DDL or TypeScript type that the task builds on — no paraphrase, no "see docs".
- Name each new / modified column or DTO field explicitly; a vague "adds a few fields" is not acceptable.
- Call out the idempotency story: does the migration use `CREATE … IF NOT EXISTS`, does the DTO shape stay backwards-compatible, does the client parser accept unknown keys.

Why: three of the five real bugs in Sprints 1–2 were one side of the extension / native-server / shared DTO triangle drifting from the other two. Forcing a citation turns "I remember what that shape is" into "grep confirms this shape is the same".

Applies equally to owner-lane and executor-lane tasks. Whoever drafts the backlog item (any AI assistant or a human maintainer) puts the citation in the `- **Schema cite**:` bullet (see B-005 / B-006 for examples).

## Code Quality Governance Phase 1 Status

Phase 1 governance tasks are complete (`TQG-00`, `TQG-01`, `TQG-03`, `TQG-05`), and the temporary broad freeze from TQG-00 is lifted.

Normal feature/enhancement work may resume only after owner-lane preflight and under all existing repository rules. Continue enforcing no-new-debt guardrails:

- one task / one commit;
- no unrelated dirty files;
- no public schema, risk tier, shared DTO, SQLite schema, CI, dependency, or lockfile changes without explicit owner-lane authorization;
- no new skipped tests or ungoverned bare `console.*` in governed native-server production paths;
- preserve privacy rules and do not stage/commit `.claude/` or `.agents/`.

For future governance phases, the current status source is `.claude/handoffs/TABRIX_CODE_QUALITY_GOVERNANCE_PROGRESS_LEDGER_zh.md`.

That `.claude/` path is a maintainer-private overlay and may not exist in public clones. External contributors and public-only assistants should use the public docs listed in this file instead of recreating or depending on private state files.

## Public Source Of Truth

For this public repository, treat `docs/` (English-only) plus the root-level `README.md`, `README_zh.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, and `AGENTS.md` as the public source of truth. Do not recreate internal PM systems, private review docs, nightly reports, or acceptance evidence inside the public tree.

Project maintainers also keep non-public product-management, governance, audit, version goals, active execution SoTs, delivery ledgers, and gate-maintenance materials outside this repository. Those private authorities are not required for contributing against the public surface, and they are intentionally not reproduced here. External contributors and public-only AI assistants should rely only on the files enumerated above.

Default expectations:

1. Prefer surgical changes over broad refactors.
2. Do not merge old branches blindly; review and safely absorb only the useful parts.
3. Add the smallest regression test that proves the change is correct.
4. Do not bundle unrelated files into the same commit.
5. Verify before committing; commit promptly after verification.
6. When diagnosing GitHub-visible failures, first distinguish historical commit failures from the current head state.
7. For browser-viewable GitHub troubleshooting, prefer Tabrix first, then use API/CLI only when the page view is insufficient.
8. Run the smallest required test matrix for the change type before committing.
9. When runtime behavior is part of the claim, make sure the local MCP service and unpacked extension are actually running the new build.
10. If the working tree is dirty, do not blindly pull/rebase/merge on top of it; fetch first, assess risk, and prefer a separate branch or worktree when needed.
11. When instructions conflict, follow this order: system/developer instructions, the user's current task, repository task docs, this file, then general heuristics.
12. End each task with a clear status summary: what changed, what was verified, what was not verified, and what risks remain.
13. If a CI or platform failure is caused by a retired upstream endpoint or broken external integration, do not stop at "ignore the error"; restore a real verification path before treating the issue as resolved.
14. When extension code changes, the default local acceptance loop is: `pnpm -C app/chrome-extension build` -> `pnpm run extension:reload` -> real browser validation. Do not claim browser-side verification if the unpacked extension has not been reloaded.
15. Architecture-debt invariant. Repeated feature/fix work on the same MKEP layer should trigger an architecture-debt check rather than silent accumulation. If no debt is found, state that explicitly in the task summary.
16. Core-neutral invariant. When editing core-neutral files, do not introduce site-specific vocabulary (e.g. hostnames, family-specific role literals, or product-specific anchor words). Such logic belongs in a `*-<family>.ts` adapter. Preserve the neutrality test instead of weakening it.
17. Public / private test split. Any test or fixture that reproduces a specific real-world site's URL, DOM content, brand-named accessibility tree, or login-state flow (e.g. Douyin / BOSS / private-console vendors) belongs in the maintainer-private acceptance repository, not in this repo. In this public repo only the declared GA baseline (currently: GitHub) may appear in `app/**/tests/**` as realistic fixture data. Generic login, footer, dashboard, and accessibility-tree fixtures must use neutral wording and MUST NOT embed a specific vendor brand as flavoring. Exception: guardrail tests that list brand words as forbidden tokens (e.g. `tests/read-page-understanding-core-neutrality.test.ts`) may contain those words because their purpose is to assert absence, not reproduce a scenario.
18. Documentation placement. Public English docs go under `docs/`. Chinese-language public material belongs only in root `README_zh.md` and this file. Internal governance, audit, gate maintenance, PRD, roadmap sequencing, and acceptance evidence are maintained outside this public repository by the project maintainers. Do not reintroduce deleted internal documents into `docs/` without an explicit governance decision.
19. Removed-surface invariant. Before adding any MCP tool, background listener, popup entry, sidepanel tab, or shared type, check it against the "Removed Surfaces" list above. If the change looks like it would reintroduce a removed surface in any form — including under a different name — stop and surface the question instead of implementing it.
20. Planning invariant. Every non-trivial feature or refactor commit should reference a public issue, a public roadmap item, or a maintainer-private planning item when one exists. Do not create or update public sprint-backlog files under `docs/`.
21. Product-level acceptance invariant. Source inspection, unit tests, deterministic fixtures, simulated pages, and public CI are necessary but not sufficient for claims about real browser behavior, API/DOM/CDP data-source reuse, Browser Hygiene, same-profile login reuse, competitor superiority, or release readiness. Those claims require acceptance-lane evidence.
22. Scenario-library invariant. Acceptance-lane validation should choose the most relevant scenario or scenarios from the maintainer-private real-user scenario library for the feature under test. Do not hard-code a small fixed set of sites as the only acceptance path. Real site URLs, account states, screenshots, raw responses, competitor run artifacts, and login-dependent flows belong outside the public repository.
23. Capability-gap invariant. A successful fallback path does not prove the higher-level capability. For example, DOM fallback success does not prove API reuse, and a browser task finishing does not prove competitor parity unless the same-scenario comparison captured tool path, profile mode, data source, accuracy, latency, token/cost where available, and Browser Hygiene.

If a task conflicts with these rules, stop and surface the tradeoff instead of guessing.
