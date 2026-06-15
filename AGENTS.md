# Tabrix AI Contributor Rules

Tabrix accepts contributions from any AI coding assistant. The assistant name
does not matter; the responsibility and evidence standard do.

Tabrix's public product center is:

```text
real Chrome + MCP control + browser object awareness + memory and reuse
```

Do not turn Tabrix back into a workflow SaaS, embedded assistant UI, visual
editor, local semantic-search stack, or site-specific automation product.

## Before Editing

Before changing files, confirm the checkout and dirty state:

```bash
git rev-parse --show-toplevel
git status --short --branch
```

If the user names a path such as `E:\projects\AI\codex\main_tabrix`, edit that
checkout, not a sibling clone or temporary worktree.

Read the public docs in this order for non-trivial work:

1. [README.md](./README.md)
2. [docs/README.md](./docs/README.md)
3. [docs/ROADMAP.md](./docs/ROADMAP.md)
4. [docs/PRODUCT_SURFACE_MATRIX.md](./docs/PRODUCT_SURFACE_MATRIX.md)
5. [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
6. [docs/PROJECT_STRUCTURE.md](./docs/PROJECT_STRUCTURE.md)
7. [CONTRIBUTING.md](./CONTRIBUTING.md)

Then read only the task-relevant docs:

- CLI, MCP, transport, diagnostics: [docs/CLI_AND_MCP.md](./docs/CLI_AND_MCP.md),
  [docs/TOOLS.md](./docs/TOOLS.md)
- Extension, popup, onboarding, troubleshooting:
  [docs/QUICKSTART.md](./docs/QUICKSTART.md),
  [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md),
  [docs/EXTENSION_TESTING_CONVENTIONS.md](./docs/EXTENSION_TESTING_CONVENTIONS.md)
- Release, security, platform, testing:
  [docs/RELEASE_PROCESS.md](./docs/RELEASE_PROCESS.md),
  [docs/TESTING.md](./docs/TESTING.md),
  [docs/PLATFORM_SUPPORT.md](./docs/PLATFORM_SUPPORT.md),
  [SECURITY.md](./SECURITY.md)
- Repository file placement:
  [docs/REPOSITORY_GOVERNANCE.md](./docs/REPOSITORY_GOVERNANCE.md)

## Product Boundary

Current public layers:

- **Object**: current and learned browser-page summaries, lifecycle state,
  page objects, actionable targets, source/API clues, freshness.
- **Memory**: AI-to-Tabrix tool-call records, request/response summaries,
  target page context, timing, failures, and AI feedback. Memory must not
  invent or substitute AI evaluation.
- **Knowledge**: privacy-safe page/source capability summaries distilled from
  Object records.
- **Experience**: reusable operation paths distilled only from AI-reviewed
  successful Memory records.
- **Policy**: source choice, freshness gates, risk gates, fallback constraints,
  and execution constraints.

Chrome extension APIs are the default browser execution path. CDP may be used
as a bounded sensing and diagnostics layer for page state, network/frame/console
signals, visual coordinates, and post-action deltas. Do not expose CDP as a
default public remote-debugging control surface without an explicit product
decision.

## AI Feedback And Experience Learning

Memory is the full AI-to-Tabrix trace ledger. AI feedback is the learning signal
that tells Tabrix whether a step helped the user's goal, whether the path was
good, and whether any part is worth reusing. Do not reduce AI feedback to a
final-result-only score.

Default rule:

- Every AI-requested browser step that has task meaning should be eligible for
  AI feedback, including reads, object sensing, navigation, input, click, and
  result collection.
- Pure auxiliary/system-maintenance records should normally be `not_required`,
  such as AI feedback write-back itself, internal health checks, background
  projection jobs, routine UI refreshes, and diagnostics that do not answer or
  advance the user's task.
- Tool success is not business success. System facts can summarize what Tabrix
  observed, but they must not be displayed or persisted as AI evaluation.
- If one step is slow, unstable, repeated, coordinate-dependent, or fails often,
  keep that feedback visible; use it to improve object perception instead of
  hiding the step behind a final success.
- Experience extraction must use AI-reviewed successful paths plus path-quality
  checks. A task can finish successfully and still be unfit for Experience if
  it was slow, brittle, overly broad, privacy-sensitive, or not reusable.

For example, in a search-and-filter task, opening the site, finding the search
box, submitting the query, opening filters, selecting filter items, and
collecting result cards are all meaningful steps. The final result proves the
task outcome; step feedback explains which parts of the path should be reused,
optimized, or rejected.

## Removed Surfaces

Do not reintroduce these surfaces under old or new names without an explicit
maintainer decision:

- Smart Assistant, Quick Panel, Agent Chat, or embedded assistant UI.
- Record/Replay v2/v3 engine, workflow builder, `run_flow`,
  `list_published_flows`, or published-flow MCP tools.
- Local semantic engine, ONNX/WASM workers, `search_tabs_content`, vector
  search dependencies, or semantic-search UI.
- Element Marker management or `element_picker`.
- Visual Editor or `web-editor-v2`.

If a task appears to need one of these, stop and explain the product tradeoff
instead of rebuilding it opportunistically.

## Public And Private Boundary

Public source of truth:

- root: `README.md`, `README_zh.md`, `CHANGELOG.md`, `CONTRIBUTING.md`,
  `SECURITY.md`, `AGENTS.md`
- docs: `docs/`
- public assistant routing skill: `skills/tabrix_browser/`
- public historical examples: `archive/`

Maintainer-private planning, acceptance evidence, benchmark artifacts, raw
browser screenshots, account-specific URLs, internal prompts, handoffs, local
agent state, and private tests must stay outside the public documentation tree
or in ignored private folders.

Never stage or commit:

- `.claude/`
- `.agents/`
- `.private-artifacts/`
- `.private-tests/`
- `code-reviews/`
- root `prompt/`
- root `releases/`

## Code Quality Rules

- Keep changes small and verifiable.
- Do not revert unrelated dirty files.
- Do not change public tool contracts, shared DTOs, SQLite schema, risk tiers,
  CI, dependencies, or lockfiles silently.
- Do not hard-code one website's behavior into neutral core logic. Site-specific
  logic belongs in adapters or seeds.
- Do not persist raw response/request bodies, cookies, Authorization headers,
  secrets, private account data, or raw benchmark artifacts in public files.
- Prefer structured APIs and local patterns over ad hoc string parsing.
- Add the smallest regression test that proves the behavior when code changes.
- Do not add skipped tests or ungoverned bare `console.*` in governed production
  paths.

## MKEP Code Map

Use this map to find the correct home for changes:

| Layer | Native server | Chrome extension | Shared |
| --- | --- | --- | --- |
| Memory | `app/native-server/src/memory/**` | Sidepanel Memory tab | - |
| Object | `app/native-server/src/memory/**` and `src/runtime/**` | browser lifecycle/object inventory paths | `packages/shared/src/memory.ts` |
| Knowledge | projections under Memory/runtime | `entrypoints/background/knowledge/**` | - |
| Experience | experience paths under Memory/runtime | Sidepanel Experience tab | - |
| Policy | `app/native-server/src/policy/**` | future policy UI only | `packages/shared/src/tools/**` |

Cross-process contracts belong in `packages/shared/src/`.

## Test And Acceptance Standard

Use the smallest relevant verification set:

- Docs-only: `pnpm run docs:check`
- Shared contracts: shared package tests plus downstream native/extension tests
- Native-server / CLI / MCP changes: relevant native tests and, when runtime
  behavior is claimed, `tabrix status`, `tabrix doctor --fix`, or `tabrix smoke`
- Extension behavior: `pnpm -C app/chrome-extension build`, then
  `pnpm run extension:reload`, then real browser validation
- Larger changes: `pnpm run verify` or `pnpm run ci:check`

Public deterministic tests are necessary but not enough for claims about real
logged-in browser behavior, private-site flows, competitor superiority, release
readiness, token savings, or product-grade browser reliability. Those claims
require current real-browser acceptance evidence outside the public repo.

## Final Report

End each task with:

- what changed
- what was verified
- what was not verified
- remaining risks or follow-up work

Do not claim `done`, `release-ready`, or `product-grade` beyond the evidence
actually reached.
