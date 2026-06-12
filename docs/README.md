# Tabrix Docs

This directory is the public documentation hub for Tabrix.

The docs are intentionally split by audience. Start with the section that
matches what you are trying to do.

## Users

Use these when you want to install, connect, use, or troubleshoot Tabrix.

1. [Quickstart](./QUICKSTART.md) — install the CLI, load the extension, connect
   an MCP client, and run the first browser task.
2. [CLI and MCP Configuration](./CLI_AND_MCP.md) — commands, transports, client
   snippets, remote access, and status semantics.
3. [Troubleshooting](./TROUBLESHOOTING.md) — common connection, extension,
   Windows, token, and runtime problems.
4. [Use Cases](./USE_CASES.md) — realistic early-stage workflows and fit checks.

## Developers

Use these when you want to understand or change the codebase.

1. [Contributing](../CONTRIBUTING.md) — setup, development loop, test commands,
   pull request expectations, and scope boundaries.
2. [Architecture](./ARCHITECTURE.md) — runtime components and data flow.
3. [Project Structure](./PROJECT_STRUCTURE.md) — where the code lives and which
   files to start from.
4. [Testing](./TESTING.md) — public deterministic test expectations.
5. [Extension Testing Conventions](./EXTENSION_TESTING_CONVENTIONS.md) —
   extension-specific test patterns.
6. [Repository Governance](./REPOSITORY_GOVERNANCE.md) — public/private/archive
   placement rules for files and folders.

## Product and Platform Reference

- [Roadmap](./ROADMAP.md) — public product direction.
- [Product Surface Matrix](./PRODUCT_SURFACE_MATRIX.md) — GA / Beta /
  Experimental / Internal capability boundaries.
- [Compatibility Matrix](./COMPATIBILITY_MATRIX.md) — MCP client and environment
  compatibility notes.
- [Platform Support](./PLATFORM_SUPPORT.md) — operating system and browser
  support posture.
- [Why MCP on Chrome](./WHY_MCP_CHROME.md) — why Tabrix uses real Chrome plus
  MCP.
- [Error Codes](./ERROR_CODES.md) — error code reference.

## API Reference

- [Tools API](./TOOLS.md) — full MCP tool catalog and schemas.

`TOOLS.md` is a reference document, not a getting-started guide. New users
should start with [Quickstart](./QUICKSTART.md).

## Release and Maintenance Reference

- [Release Process](./RELEASE_PROCESS.md) — public release workflow for
  maintainers.
- [Archived Release Notes](./releases/README.md) — historical release notes.
- [Extension Release Assets](./releases/EXTENSION_ASSETS.md) — extension zip
  download and unpacked-install guidance.
- [Changelog](../CHANGELOG.md) — user-visible changes.
- [Security](../SECURITY.md) — disclosure policy and security posture.

## AI Contributor Rules

- [AGENTS.md](../AGENTS.md) — public rules for AI coding assistants.

This file is not required for normal user onboarding. It is kept separate
from user and developer guides so the public documentation stays readable.

## Public and Private Boundary

Public docs explain the product surface, setup, architecture, and contribution
workflow.

Maintainer-private PRDs, acceptance evidence, benchmark artifacts, internal
execution ledgers, prompts, and handoffs stay outside the public documentation
tree.

## Language Policy

- `docs/` is English-only.
- The public Chinese landing page is [README_zh.md](../README_zh.md).
- Private Chinese planning or acceptance materials do not belong in `docs/`.
