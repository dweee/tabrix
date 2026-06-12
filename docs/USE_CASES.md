# Tabrix Use Cases

This document focuses on realistic early-stage use cases for Tabrix.

It is written for the open-source cold-start phase:

- show what Tabrix is already good at
- help new users self-identify whether it fits their workflow
- avoid over-promising experimental capability areas

## 1. Research and Information Collection

**Good fit when:**

- you want an AI assistant to read and summarize pages from your real browser session
- you already keep relevant tabs, logins, and browsing context open
- you want screenshots, extracted content, or structured page understanding

**Typical flow:**

1. open or switch to the target tab
2. read page content
3. extract interactive elements or take screenshots
4. summarize findings in the client

**Why Tabrix helps:**

- avoids rebuilding login and browser context from scratch
- works with real tabs instead of a separate browser runtime

## 2. Logged-In Back-Office Automation

**Good fit when:**

- you use CMS, ticketing, CRM, console, or operations tools that require a real login session
- repetitive click-and-fill work happens in the same browser profile every day

**Typical flow:**

1. connect the extension
2. navigate to the target system
3. read the page and locate the target form or control
4. click, fill, submit, and verify

**Why Tabrix helps:**

- reuses your real authenticated browser session
- reduces setup friction compared with fresh ephemeral browser environments

## 3. QA and Regression Reproduction

**Good fit when:**

- you need a fast way to reproduce UI behavior in a real browser session
- you want screenshots, console logs, or browser-side state from the actual page

**Typical flow:**

1. navigate to the target page
2. inspect the current state
3. trigger the target interaction
4. capture screenshot or console output

**Why Tabrix helps:**

- makes it easier to combine browser actions with AI analysis
- provides a practical path for diagnosis through `status`, `doctor`, `smoke`, and browser tools

## 4. Support and Operations Assistance

**Good fit when:**

- you need to inspect user-facing or operator-facing pages while keeping your current support workflow open
- you want AI assistance for reading, explaining, and navigating operational systems

**Typical flow:**

1. keep your support tabs open
2. ask the assistant to inspect a specific page or state
3. extract content, summarize, or navigate to the next action

**Why Tabrix helps:**

- the AI can work with the browser context you already use for support work
- reduces context-switching between manual browsing and assistant help

## 5. Content and Community Research

**Good fit when:**

- you want an assistant to inspect public or logged-in community pages that are already open in your browser
- you need to compare search results, posts, repository pages, comments, or visible engagement signals
- you want the assistant to stay read-only while preserving the browser profile you normally use

**Typical flow:**

1. open the target site or search results in Chrome
2. ask the assistant to read the visible results or open a small number of detail pages
3. extract titles, authors, visible metadata, summaries, or comparison points
4. verify the output against the page and keep the task read-only

**Why Tabrix helps:**

- works against the real browser profile instead of a blank automation profile
- can combine structured reads, scoped DOM fallback, screenshots, and browser state checks
- keeps API or endpoint-shaped reads evidence-bounded instead of treating every site as a guaranteed API source

## 6. Remote Browser Capability Sharing

**Good fit when:**

- you want multiple MCP clients to reach the same browser capability over LAN
- you need token-protected remote access to a browser runtime on another machine

**Typical flow:**

1. enable remote access
2. configure token-based authentication
3. connect a remote MCP client
4. run browser tasks through the remote endpoint

**Why Tabrix helps:**

- exposes browser execution through a structured MCP interface
- keeps a real-browser execution model instead of switching to a separate headless product surface

## How Object-Aware Tabrix Should Improve These Flows

Across these use cases, the product direction is not to show more internal
statistics. The useful direction is to give the assistant better browser facts:

- which real tab or page is currently relevant
- what important page objects are visible, such as forms, result lists, cards,
  menus, dialogs, tables, or pagination
- which target looks actionable and whether the target is still fresh
- what changed after a click, fill, navigation, or read action
- whether prior Knowledge or reviewed Experience can reduce another full-page
  read

Bounded CDP and Chrome API signals can help explain low-level browser behavior,
such as slow loading, console errors, network failures, frame changes, or a
click that did not change the page. Those signals should support compact
assistant-facing results, not become a separate user-facing debugging product.

## What Tabrix Is Not Best At Today

Tabrix is currently not best described as:

- a general workflow SaaS
- a browser IDE
- a fully productized agent operating system
- a semantic search product

For the current public product surface, read:

- [`PRODUCT_SURFACE_MATRIX.md`](./PRODUCT_SURFACE_MATRIX.md)
- [`QUICKSTART.md`](./QUICKSTART.md)
- [`CLI_AND_MCP.md`](./CLI_AND_MCP.md)
