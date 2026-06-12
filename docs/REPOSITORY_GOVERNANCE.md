# Repository Governance

This document explains where public, archived, and maintainer-private materials
belong in this repository.

The goal is simple: a new user, contributor, or AI coding assistant should be
able to enter the repository without confusing active product truth with old
plans, private evidence, local scratch work, or generated artifacts.

## Source Of Truth

Use these files first:

- Product landing page: [README](../README.md)
- Chinese landing page: [README_zh](../README_zh.md)
- Documentation index: [docs/README](./README.md)
- Public product scope: [Roadmap](./ROADMAP.md) and
  [Product Surface Matrix](./PRODUCT_SURFACE_MATRIX.md)
- Architecture and code map: [Architecture](./ARCHITECTURE.md) and
  [Project Structure](./PROJECT_STRUCTURE.md)
- Tool contracts: [Tools API](./TOOLS.md)
- Contributor workflow: [Contributing](../CONTRIBUTING.md)

## Directory Placement Rules

| Material                                                                                                 | Location                                                      | Rule                                            |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------- |
| User setup, troubleshooting, use cases                                                                   | `docs/`                                                       | English-only public docs.                       |
| Root product landing pages                                                                               | `README.md`, `README_zh.md`                                   | Keep short and user-facing.                     |
| API and tool reference                                                                                   | `docs/TOOLS.md`, `docs/CLI_AND_MCP.md`, `docs/ERROR_CODES.md` | Contract/reference docs, not tutorials.         |
| Historical release notes                                                                                 | `docs/releases/`                                              | Archived public release records.                |
| Historical public examples                                                                               | `archive/`                                                    | Not active product truth.                       |
| AI assistant routing skill                                                                               | `skills/tabrix_browser/`                                      | Public assistant-routing help only.             |
| AI contributor rules                                                                                     | `AGENTS.md`                                                   | Contributor-facing rules, not normal user docs. |
| Maintainer-private PRDs, acceptance evidence, ledgers, prompts, handoffs, assistant-specific local notes | Outside the public tree or ignored private folders            | Do not publish in `docs/`.                      |
| Local build outputs, screenshots, logs, generated zips                                                   | Ignored local folders                                         | Do not track.                                   |

## What Must Not Be Reintroduced

Do not add these as public source-of-truth folders:

- `prompt/` for active instructions
- `releases/` for public release docs or release zips
- `code-reviews/` for review reports
- `docs/benchmarks/` for private acceptance evidence
- `.claude/`, `.agents/`, `.private-artifacts/`, `.private-tests/` as public
  documentation sources

If a file is useful but historical, put it under `archive/` with a clear
README. If it contains maintainer-private product planning, account-specific
evidence, private URLs, screenshots, raw benchmark reports, prompts, or
handoffs, keep it outside the public repository.

## AI Assistant Handoff Rules

An AI assistant taking over the repository should read:

1. [README](../README.md)
2. [docs/README](./README.md)
3. [Roadmap](./ROADMAP.md)
4. [Product Surface Matrix](./PRODUCT_SURFACE_MATRIX.md)
5. [Architecture](./ARCHITECTURE.md)
6. [Project Structure](./PROJECT_STRUCTURE.md)
7. [Contributing](../CONTRIBUTING.md)
8. [AGENTS.md](../AGENTS.md) when editing files

Do not infer current product direction from archived prompts, release notes, old
review reports, local scratch folders, or untracked acceptance artifacts.

## Enforcement

`pnpm run docs:check` protects the public documentation boundary by checking
required docs, key references, release-note placement, README image behavior,
and forbidden tracked root folders.

When adding or moving docs, update this document and
[docs/README](./README.md) if the new location is part of the active public
entry path.
