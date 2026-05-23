# Tabrix Public Roadmap

This document describes the public product direction for Tabrix.

It is intended to answer a simple question:

> If Tabrix keeps winning, what does it become next?

This is a public roadmap, not a dated delivery promise.
It should stay ambitious enough to attract contributors, but grounded enough to match the current codebase and public product surface.

## Product Direction

Tabrix is building toward a clear position:

> The browser automation execution layer for AI assistants that need to operate a user's real Chrome session.

That means we are not primarily trying to become:

- another generic browser automation framework
- another workflow SaaS
- another browser IDE
- another "spin up a fresh browser every time" runtime

## Why This Direction Matters

The strongest advantage in this repository is not "browser control" by itself.
It is the combination of:

- real logged-in Chrome session reuse
- MCP-native access for AI assistants
- local-first deployment with optional remote access
- diagnostics and recovery for day-to-day operation
- Memory and Knowledge evidence that can help assistants choose smaller, safer read paths instead of defaulting to full-page context

This is the path most likely to make Tabrix uniquely useful for Codex, Claude Desktop, Cursor, Cline, and similar MCP-connected assistants.

## Now

Current near-term priorities and recently delivered capabilities:

**Transport & diagnostics (ongoing):**

- make `Streamable HTTP` and `stdio` the most reliable MCP entry paths
- improve reconnect, diagnostics, and install recovery
- reduce first-success friction for new users and contributors
- browser auto-launch and recovery when an assistant calls Tabrix and Chrome is not ready

**Page reading & AI-facing evidence (delivered v2.7):**

- structured L0/L1/L2 layered page reading with task protocol and complexity-aware source routing
- AI-facing task state verdicts (`BrowserTaskStateVerdict`) and data-source routing evidence (`BrowserDataSourceDecisionEvidence`)
- browser page projection deltas (`BrowserPageProjectionDelta`) for post-action change detection and token savings
- Markdown / document reading surface for long-form content, help pages, and README files
- browser-observed API response sampling with privacy-safe JSON row summarization
- compact endpoint provenance with fallback DOM reading when API paths are unsafe or uncertain

**Policy & safety (delivered v2.7):**

- MKEP Policy risk-tier gating for every P3-classified tool, with an explicit opt-in flow exposed via MCP

In public terms: Tabrix now provides structured, layered page reading with built-in evidence about data-source choices, plus safe API response sampling when endpoints are observed and classified. The Policy gating surface is complete.

## Next

Once the current page-reading and evidence surface stabilizes, the next major product upgrades are:

- MKEP Memory-backed run history and operation-log explainability (Session / Task / Step viewers in the sidepanel)
- MKEP Knowledge expansion beyond the GitHub seed (URL catalogue, menu / region / endpoint knowledge for additional sites)
- extend browser-observed endpoint classification to more site families, with seed adapters for high-value public sites
- stronger real-browser MCP E2E coverage and fixture-based regression testing
- better locator stability through fingerprinting, fallback chains, and more deterministic targeting
- internal read-page module refactoring to reduce complexity and extract site-specific adapters from neutral core logic
- Experience layer design: define the contract between Knowledge-recorded paths and Experience-reusable recipes

These upgrades matter because they improve success rate, reduce token cost, and make browser actions more predictable.

Important boundary: public roadmap items about endpoint knowledge mean storing endpoint capability, provenance, and shape summaries. They do not mean storing API response bodies, cookies, Authorization values, raw request bodies, or user data caches.

## Later

Longer-term public directions:

- MKEP Experience reuse: per-site reusable recipes that let repeated tasks skip redundant page reads
- reviewed Memory-to-Experience candidate extraction, with human or policy approval before high-confidence reuse
- community sharing / import / export of Experience packs
- replay artifacts for failed flows and nightly regression diagnosis
- safer team collaboration and multi-operator browser workflows
- richer higher-level automation layers built on top of the stable MCP execution path

These directions are strategically important, but they should not outrun the current reliability foundation.

Detailed sprint plans and owner-lane briefs are maintained outside the public repository.

## What We Will Not Prioritize First

To keep the product sharp, Tabrix should not drift into headline messaging such as:

- "all-in-one agent operating system"
- "default workflow builder"
- "semantic search product"
- "general-purpose browser IDE"
- "universal automatic website API learner"

Some related subsystems exist in the repository, but they are not the current public center of gravity.

For the current public boundary, read:

- [PRODUCT_SURFACE_MATRIX.md](PRODUCT_SURFACE_MATRIX.md)
- [USE_CASES.md](USE_CASES.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)

## How To Contribute To The Roadmap

High-value contribution areas right now:

- reliability and reconnect behavior
- first-success onboarding and install quality
- structured browser reading and extraction
- endpoint provenance, redaction, and safe fallback behavior
- Memory-backed diagnostics and operation-log explainability
- fixture sites, smoke coverage, and regression evidence
- tool schema clarity and client integration quality

If you want to help shape a roadmap item, open an issue with:

- the user problem
- the proposed behavior
- affected modules
- the smallest verifiable success condition
