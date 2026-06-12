# Tabrix

[发布版本](https://github.com/guodaxia103/tabrix/releases) ·
[npm 包](https://www.npmjs.com/package/@tabrix/tabrix) ·
[MIT 许可证](https://opensource.org/licenses/MIT) ·
[TypeScript 5.8+](https://www.typescriptlang.org/)

把你正在使用的真实 Chrome 会话，变成 AI 助手可调用的 MCP 浏览器运行时。

Tabrix 由 Chrome 扩展和本地原生服务组成。它让支持 MCP 的客户端操作你
已经在用的浏览器配置，包括当前标签页、Cookie、扩展、登录态和业务页面。

## 为什么是 Tabrix

很多浏览器自动化工具会重新启动一个干净浏览器。Tabrix 从你已经在工作的真实
浏览器开始。

- **复用真实会话**：保留登录态、Cookie、扩展和当前标签页。
- **MCP 原生接入**：支持 `Streamable HTTP` 和 `stdio`，可接 Codex、
  Claude Desktop、Cursor、Windsurf、Dify 等 MCP 客户端。
- **默认本地优先**：浏览器状态默认留在本机；远程访问需要显式开启。
- **内置运行检查**：`tabrix status`、`doctor`、`smoke`、`report` 用来
  检查真实浏览器链路。
- **面向对象感知演进**：目标是让 AI 更清楚当前网页有什么、能操作什么、
  操作后是否推进了任务。

## 快速开始

安装 CLI：

```bash
npm install -g @tabrix/tabrix@latest
# 或
pnpm install -g @tabrix/tabrix@latest
```

必要时注册 Native Messaging Host：

```bash
tabrix register
```

加载 Chrome 扩展：

1. 从 [GitHub Releases](https://github.com/guodaxia103/tabrix/releases)
   下载最新扩展 zip。
2. 解压到一个稳定目录，后续不要随意移动。
3. 打开 `chrome://extensions`，启用 `开发者模式`，加载已解压扩展目录。
4. 打开 Tabrix 弹窗，点击 `Connect`。

验证运行状态：

```bash
tabrix status
tabrix doctor --fix
tabrix smoke
```

MCP 客户端配置示例：

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

详细步骤见 [Quickstart](docs/QUICKSTART.md) 和
[CLI and MCP Configuration](docs/CLI_AND_MCP.md)。

## 可以做什么

- 列出和切换当前 Chrome 标签页
- 读取当前网页并返回结构化浏览器上下文
- 点击、填写、键盘输入、上传文件、截图
- 查看 console、network、history、bookmarks 和运行状态
- 通过 token 保护的局域网访问共享同一个浏览器能力
- 构建复用真实浏览器上下文的 AI 工作流

完整工具清单见 [API Reference](docs/TOOLS.md)。

## 产品方向

Tabrix 不是浏览器 IDE、流程编排 SaaS，也不是内置 AI 聊天产品。公开产品中心是：

```text
真实 Chrome + MCP 控制 + 网页对象感知 + 记忆与复用
```

长期闭环是：

- **对象库**：当前网页有什么、哪些对象看起来可操作
- **记忆库**：AI 让 Tabrix 做了什么、Tabrix 返回了什么、AI 如何评价结果
- **知识库**：从对象库中沉淀可复用的页面/来源能力摘要
- **经验库**：从 AI 评价成功的记忆中沉淀可复用路径

Chrome APIs 是默认浏览器执行路径。CDP 是受控的感知和诊断增强，不是默认公开
控制面。

公开路线见 [Roadmap](docs/ROADMAP.md)，能力分层见
[Product Surface Matrix](docs/PRODUCT_SURFACE_MATRIX.md)。

## 文档入口

**用户**

- [Quickstart](docs/QUICKSTART.md)
- [CLI and MCP Configuration](docs/CLI_AND_MCP.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Use Cases](docs/USE_CASES.md)

**开发者**

- [Contributing](CONTRIBUTING.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Project Structure](docs/PROJECT_STRUCTURE.md)
- [Testing](docs/TESTING.md)

**参考**

- [Docs Index](docs/README.md)
- [API Reference](docs/TOOLS.md)
- [Compatibility Matrix](docs/COMPATIBILITY_MATRIX.md)
- [Platform Support](docs/PLATFORM_SUPPORT.md)
- [Security](SECURITY.md)
- [Changelog](CHANGELOG.md)

## 贡献

贡献请先看 [Contributing](CONTRIBUTING.md)。高价值方向包括跨平台安装质量、
浏览器运行链路稳定性、MCP 兼容性、工具契约一致性和回归测试覆盖。

## 项目来源

Tabrix 是对 [`hangwin/mcp-chrome`](https://github.com/hangwin/mcp-chrome)
的社区延续。

## 许可证

MIT，详见 [LICENSE](LICENSE)。
