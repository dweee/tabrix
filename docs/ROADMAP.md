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
- object-aware page reading, operation memory, knowledge records, and reviewed experience records that help assistants choose smaller, safer paths instead of defaulting to full-page context

This is the path most likely to make Tabrix uniquely useful for Codex, Claude Desktop, Cursor, Cline, and similar MCP-connected assistants.

## Now

Current public capabilities and near-term priorities:

**Transport & diagnostics (ongoing):**

- make `Streamable HTTP` and `stdio` the most reliable MCP entry paths
- improve reconnect, diagnostics, and install recovery
- reduce first-success friction for new users and contributors
- browser auto-launch and recovery when an assistant calls Tabrix and Chrome is not ready

**Structured page reading and browser context:**

- structured layered page reading with compact outputs, richer detail on demand, and stable target references for follow-up actions
- candidate actions that help assistants choose clickable, fillable, and inspectable page targets with less guessing
- browser page summaries and post-action deltas that reduce repeated full-page reads when the cached context is still reliable
- Markdown / document reading surface for long-form content, help pages, and README files
- browser-observed source summaries with privacy-safe row or shape summarization
- compact provenance with fallback page reading when learned sources are unsafe, stale, or uncertain

**Policy, safety, and operational records:**

- risk-tier gating for high-risk tools, with explicit operator opt-in where required
- operation memory records that can support explainability and future reviewed experience mining
- object and knowledge records that summarize page/source capabilities without becoming user-data caches

In public terms: Tabrix provides real-Chrome MCP execution, structured page reading, candidate action targeting, operational memory, and safe knowledge-assisted compact reads. These are public capabilities with explicit privacy and fallback boundaries.

## Next

Once the current page-reading and evidence surface stabilizes, the next major product upgrades are:

- object-aware page understanding: page regions, forms, lists, cards, dialogs, menus, tables, and safe action targets
- controlled browser sensing using Chrome APIs plus bounded CDP diagnostics where it improves page-state, network, frame, console, visual, or post-action understanding
- MKEP Memory-backed AI-to-Tabrix interaction history and AI feedback readiness
- MKEP Knowledge expansion beyond seed data into privacy-safe page/source capability summaries
- Experience design for reviewed, reusable operation paths derived from AI-approved successful traces
- stronger real-browser MCP E2E coverage and fixture-based regression testing
- better locator stability through fingerprinting, fallback chains, and more deterministic targeting

These upgrades matter because they improve success rate, reduce token cost, and make browser actions more predictable.

Important boundary: public roadmap items about objects, knowledge, and experience mean storing compact operational summaries, provenance, shape information, and reviewed reusable patterns. They do not mean storing API response bodies, cookies, Authorization values, raw request bodies, full page dumps, or user data caches.

## Later

Longer-term public directions:

- MKEP Experience reuse: per-site reusable recipes that let repeated tasks skip redundant page reads
- Memory-to-Experience extraction from AI-approved successful traces, with conservative replay checks before reuse
- community sharing / import / export of Experience packs
- failure diagnosis artifacts for regression and support
- safer team collaboration and multi-operator browser workflows
- richer higher-level automation layers built on top of the stable MCP execution path

These directions are strategically important, but they should not outrun the current reliability foundation.

Detailed sprint plans and maintainer-private briefs are maintained outside the
public repository.

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
- Memory-backed diagnostics and AI-to-Tabrix interaction explainability
- fixture sites, smoke coverage, and regression evidence
- tool schema clarity and client integration quality

If you want to help shape a roadmap item, open an issue with:

- the user problem
- the proposed behavior
- affected modules
- the smallest verifiable success condition
