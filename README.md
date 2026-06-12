# Tabrix

[Releases](https://github.com/guodaxia103/tabrix/releases) ·
[npm package](https://www.npmjs.com/package/@tabrix/tabrix) ·
[MIT License](https://opensource.org/licenses/MIT) ·
[TypeScript 5.8+](https://www.typescriptlang.org/)

Turn your real Chrome session into an MCP browser runtime for AI assistants.

Tabrix is a Chrome extension plus a local native server. It lets MCP clients
operate the browser profile you already use, including your open tabs, cookies,
extensions, and logged-in pages.

## Why Tabrix

Most browser automation starts from a fresh browser. Tabrix starts from the
browser where your work is already happening.

- **Real session reuse**: keep the login state, cookies, extensions, and tabs
  you already rely on.
- **MCP-native control**: connect through `Streamable HTTP` or `stdio` from
  Codex, Claude Desktop, Cursor, Windsurf, Dify, and similar MCP clients.
- **Local-first by default**: browser state stays on your machine unless you
  explicitly enable remote access.
- **Operational checks included**: `tabrix status`, `doctor`, `smoke`, and
  `report` help diagnose the real browser path.
- **Object-aware direction**: Tabrix is evolving toward page-object awareness,
  operation memory, reusable knowledge, and AI-reviewed experience records.

## Quick Start

Install the CLI:

```bash
npm install -g @tabrix/tabrix@latest
# or
pnpm install -g @tabrix/tabrix@latest
```

Register the native host if needed:

```bash
tabrix register
```

Load the extension:

1. Download the latest extension zip from
   [GitHub Releases](https://github.com/guodaxia103/tabrix/releases).
2. Unzip it into a stable local directory.
3. Open `chrome://extensions`, enable `Developer mode`, and load the unpacked
   extension folder.
4. Open the Tabrix popup and click `Connect`.

Verify the runtime:

```bash
tabrix status
tabrix doctor --fix
tabrix smoke
```

Connect an MCP client:

```json
{
  "mcpServers": {
    "tabrix": {
      "type": "streamableHttp",
      "url": "http://127.0.0.1:12306/mcp"
    }
  }
}
```

For detailed setup, use [Quickstart](docs/QUICKSTART.md) and
[CLI and MCP Configuration](docs/CLI_AND_MCP.md).

## What You Can Do

- list and switch tabs in your current Chrome session
- read the current page and return structured browser context
- click, fill, type, upload files, and take screenshots
- inspect console, network, history, bookmarks, and browser status
- share the same browser capability with token-protected LAN access
- build AI workflows that reuse real browser context instead of rebuilding it

The complete tool catalog is in [API Reference](docs/TOOLS.md).

## Product Direction

Tabrix is not trying to become a browser IDE, workflow SaaS, or embedded AI
chat product. The public product center is:

```text
real Chrome + MCP control + browser object awareness + memory and reuse
```

The core long-term loop is:

- **Object**: what the current browser page contains and what looks actionable
- **Memory**: what the AI asked Tabrix to do, what Tabrix returned, and how the
  AI evaluated the result
- **Knowledge**: reusable page/source capability summaries distilled from
  Object records
- **Experience**: reusable paths distilled from AI-reviewed successful Memory
  records

Chrome APIs are the default browser execution path. CDP is treated as a
bounded sensing and diagnostics enhancer, not as the default public control
surface.

Read the public direction in [Roadmap](docs/ROADMAP.md) and capability status in
[Product Surface Matrix](docs/PRODUCT_SURFACE_MATRIX.md).

## Documentation

**Users**

- [Quickstart](docs/QUICKSTART.md)
- [CLI and MCP Configuration](docs/CLI_AND_MCP.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Use Cases](docs/USE_CASES.md)

**Developers**

- [Contributing](CONTRIBUTING.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Project Structure](docs/PROJECT_STRUCTURE.md)
- [Testing](docs/TESTING.md)

**Reference**

- [Docs Index](docs/README.md)
- [API Reference](docs/TOOLS.md)
- [Compatibility Matrix](docs/COMPATIBILITY_MATRIX.md)
- [Platform Support](docs/PLATFORM_SUPPORT.md)
- [Security](SECURITY.md)
- [Changelog](CHANGELOG.md)

## Contributing

Start with [Contributing](CONTRIBUTING.md). High-impact areas include
cross-platform install quality, browser-runtime reliability, MCP compatibility,
tool contract consistency, and regression coverage.

## Origin

Tabrix is a community-driven continuation of
[`hangwin/mcp-chrome`](https://github.com/hangwin/mcp-chrome).

## License

MIT. See [LICENSE](LICENSE).
