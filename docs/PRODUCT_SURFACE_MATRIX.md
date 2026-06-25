# Tabrix Product Surface Matrix

This document defines the current public product surface for Tabrix.

Its purpose is to keep product planning, engineering work, docs, and open source collaboration aligned around the same question:

> What is part of the current public product, what is experimental, and what should not be presented as the default public surface?

## Why This Exists

Tabrix contains more code and history than the current public product surface.

The current public product centers on browser execution, MCP transport,
diagnostics, object-aware page reading, Memory/Object persistence, and bounded
Chrome/CDP sensing. Historical workflow, embedded assistant UI, element marker,
record/replay, and local semantic-search surfaces are removed from the public
product story and must stay out of the default development path.

This matrix is the public source of truth for capability classification.

## Tier Definitions

| Tier           | Meaning                                                                                             | External Positioning                           |
| -------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `GA`           | Stable, public, and expected to work for normal users and contributors                              | Safe to present as default product surface     |
| `Beta`         | Publicly visible and strategically important, but still improving in reliability or coverage        | Present with clear expectations and boundaries |
| `Experimental` | Useful for contributors or internal exploration, but not part of the default public product promise | Mention only with caution                      |
| `Internal`     | Not part of the public product surface                                                              | Do not present as default public capability    |

## Current Capability Matrix

| Capability Area                                                                               | Tier           | Why It Matters                                                                                                                                 |
| --------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Real Chrome AI execution layer                                                                | `GA`           | Headline product value: MCP clients can operate the user's existing Chrome session                                                             |
| Real Chrome execution via extension                                                           | `GA`           | Core product value and main differentiator                                                                                                     |
| MCP transport via `stdio`                                                                     | `GA`           | Tier 1 assistant integration path                                                                                                              |
| MCP transport via `Streamable HTTP`                                                           | `GA`           | Tier 1 remote and local service path                                                                                                           |
| Browser tool execution (`read`, `navigate`, `click`, `fill`, screenshots, network helpers)    | `GA`           | Core daily use capability                                                                                                                      |
| Runtime diagnostics (`status`, `doctor`, `smoke`, `report`)                                   | `GA`           | Required for trust, support, and operations                                                                                                    |
| Remote access with token based control                                                        | `Beta`         | High strategic value, but still needs continued hardening                                                                                      |
| Policy risk tier gating (P0–P3, explicit opt in for P3)                                       | `Beta`         | MKEP Policy layer guardrail for assistant driven sessions                                                                                      |
| Object-aware page reading and stable target references                                        | `Beta`         | Helps assistants understand current page objects and act on fresh targets with less selector guessing                                          |
| Knowledge Registry (observed page/source/object data, no bundled site adapter)                | `Beta`         | MKEP Knowledge layer seed for learned page/source understanding                                                                                |
| Page/source capability knowledge and provenance (`observed` / `seed_adapter` / `manual_seed`) | `Beta`         | Records page/source capability and provenance without storing raw API results                                                                  |
| Knowledge-assisted compact read paths                                                         | `Beta`         | Lets read operations use safe endpoint-shaped data when available, with DOM fallback when not                                                  |
| Operation Memory logs                                                                         | `Beta`         | Records AI-to-Tabrix tool calls, timing, page context, and AI evaluation input for future Experience mining                                    |
| Memory and Object persistence in SQLite                                                       | `Beta`         | MKEP persistence for compact AI-to-Tabrix traces and browser object summaries; survives SW / native server restarts                            |
| Browser lifecycle sensing via extension observers                                             | `Beta`         | Keeps tab/page lifecycle state visible to assistants without turning the sidepanel into a system monitor                                       |
| Browser sensing with Chrome APIs and bounded CDP helpers                                      | `Beta`         | Improves page-state, network, frame, console, visual, and post-action understanding without exposing CDP as the default public control surface |
| Multi client compatibility guidance                                                           | `Beta`         | Important for adoption, but should not outrun core reliability                                                                                 |
| Generic observed-endpoint reuse across arbitrary site families                                | `Experimental` | Strategic direction; should not be marketed as a universal guarantee until broader real-site evidence exists                                   |
| Markdown / document reading surface                                                           | `Experimental` | Useful future reading surface for documents and long-form content; not yet the default public path                                             |
| Sidepanel Memory / Knowledge / Experience tabs (placeholders)                                 | `Experimental` | Early viewers for the MKEP data layers                                                                                                         |
| Reviewed Experience reuse / locator fallback / memory-like recovery helpers                   | `Experimental` | Strong future direction, but not yet a default public promise                                                                                  |
| Internal review systems, acceptance evidence, nightly reports, PM execution docs              | `Internal`     | Governance material, not public product surface                                                                                                |

### Removed surfaces (no longer part of the public product story)

The following surfaces are not part of the current public product story. They
must not be reintroduced or marketed as public capability without an explicit
owner decision.

| Capability Area                                                                     | Status (since Unreleased) | Replacement / Follow up                                                                                            |
| ----------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Smart Assistant (sidepanel AgentChat + Quick Panel + Codex/Claude engines)          | Removed                   | Upstream MCP clients (Codex, Claude, Cursor, Cline) drive Tabrix directly                                          |
| Element Picker MCP tool (`element_picker`) and Element Marker management UI         | Removed                   | Superseded by object-aware page understanding and stable target references                                         |
| Visual Editor (`web editor v2`)                                                     | Removed                   | Out of scope for MKEP execution layer                                                                              |
| Record Replay v2 / v3 workflow engine, builder, and `run_flow` / `list_published_*` | Removed                   | Superseded by future reviewed Experience reuse — design not yet frozen                                             |
| Local semantic engine + ONNX WASM workers + `search_tabs_content`                   | Removed                   | Will be re introduced only behind a dedicated offscreen entry if and when Knowledge / Memory semantic search ships |

## Public Story We Should Keep Repeating

Today, Tabrix should primarily be described as:

1. A way to turn a real daily Chrome session into an AI executable runtime
2. A browser automation layer exposed through MCP
3. A local first and remotely callable system with diagnostics and recovery
4. An object-aware execution layer that can use Memory and Knowledge to reduce unnecessary page reads when the learned context is reliable
5. A product that treats CDP and Chrome APIs as controlled browser sensing substrates, not as a default remote-debugging product surface

It should not primarily be described as:

a general workflow SaaS
a browser IDE
an all in one agent operating system
a semantic search product
a universal website API learner
a CDP-first browser controller

## Planning Rules

When choosing what to build next:

1. Prefer improving `GA` reliability before expanding `Experimental` scope
2. Do not market `Experimental` modules as default public product surface
3. If a feature is externally visible but unstable, classify it as `Beta`, not `GA`
4. If a subsystem exists mainly to support future directions, keep it out of the headline product story until it has a stable user path
5. Do not present seed adapters as proof that arbitrary observed endpoints are product-grade

## Related Docs

`README.md`
`WHY_MCP_CHROME.md`
`ARCHITECTURE.md`
`PROJECT_STRUCTURE.md`
`TESTING.md`
`PLATFORM_SUPPORT.md`
`ROADMAP.md` — public product direction after the pruning pass
