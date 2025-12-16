**# Claude Agent SDK 能力对齐分析文档**

> 本文档记录了 AgentChat ClaudeEngine 与 Claude Agent SDK 0.1.69 的能力对比分析，以及与 other/Claudable 实现的功能差异。

**## 1. 概述**

**### 1.1 背景**

当前 AgentChat 中的 ClaudeEngine 已经可以正常进行会话，但需要确保：

1. 100% 覆盖 other/Claudable 中的 Claude 相关能力

2. 支持 Claude Agent SDK 的所有核心特性

3. 支持 Claude 的管理能力（MCP servers、models、commands、account 等）

**### 1.2 分析范围**

- **AgentChat ClaudeEngine**: `app/native-server/src/agent/engines/claude.ts`

- **Claudable Claude 实现**: `other/Claudable/lib/services/cli/claude.ts`

- **Claude Agent SDK**: `@anthropic-ai/claude-agent-sdk@0.1.69`

**### 1.3 当前状态**

| 项目 | SDK 版本 | 实现文件 |

|-----|---------|---------|

| AgentChat | 0.1.69 | `app/native-server/src/agent/engines/claude.ts:36` |

| Claudable | 0.1.22 | `other/Claudable/lib/services/cli/claude.ts:563` |

---

**## 2. 关键决策**

| 决策项 | 结论 | 说明 |

|-------|-----|------|

| 覆盖口径 | 能力级对齐 | 功能等价即可，不要求字段名完全一致 |

| SDK 版本 | 0.1.69 | 以 AgentChat 当前使用版本为准 |

| 路由粒度 | sessionId | 保持 sessionId，支持一个项目多个 session |

| 架构方案 | 每次 act 创建新 query + resume | 非常驻 Query，简单且满足需求 |

| 管理能力 | act 内自动采集缓存 | 避免额外启动进程 |

| 权限模式 | 可配置 | UI 选项让用户选择 |

---

**## 3. SDK Options 完整对比表**

以下是 Claude Agent SDK 0.1.69 的 `Options` 接口（定义于 `agentSdkTypes.d.ts:685`）与当前 AgentChat ClaudeEngine 的对比。

**### 3.1 已实现字段**

| 字段 | SDK 类型 | AgentChat 实现 | 代码位置 |

|-----|---------|---------------|---------|

| `cwd` | string | 已实现 | `claude.ts:391` |

| `additionalDirectories` | string[] | Hard-coded 为 [cwd] | `claude.ts:392` |

| `model` | string | 已实现（请求/项目/默认） | `claude.ts:393` |

| `includePartialMessages` | boolean | 已启用 (true) | `claude.ts:399` |

| `env` | Record<string, string> | 已实现（CCR 支持） | `claude.ts:406` |

| `stderr` | callback | 已实现 | `claude.ts:407` |

| `executable` | string | 传了 process.execPath | `claude.ts:401` |

| `resume` | string | 部分实现（project 级别） | `claude.ts:420` |

**### 3.2 Hard-coded 字段（需改为可配置）**

| 字段 | 当前值 | 问题 | 优先级 |

|-----|-------|------|-------|

| `permissionMode` | 'bypassPermissions' | 强制绕过权限检查，存在安全风险 | P0 |

| `allowDangerouslySkipPermissions` | true | 与 permissionMode 联动，强制开启 | P0 |

**### 3.3 未实现字段**

| 字段 | SDK 类型 | 功能说明 | 优先级 |

|-----|---------|---------|-------|

| `abortController` | AbortController | SDK 原生取消支持 | P0 |

| `settingSources` | string[] | 加载 CLAUDE.md 等配置 | P0 |

| `systemPrompt` | string | 自定义系统提示词 | P1 |

| `agents` | AgentDefinition[] | 自定义子代理 | P1 |

| `allowedTools` | string[] | 工具白名单 | P1 |

| `disallowedTools` | string[] | 工具黑名单 | P1 |

| `tools` | string[] | 指定可用工具 | P1 |

| `betas` | string[] | Beta 特性（如 1M context） | P1 |

| `hooks` | HooksConfig | Pre/Post 工具钩子 | P1 |

| `maxThinkingTokens` | number | 思考 token 上限 | P1 |

| `maxTurns` | number | 最大对话轮数 | P1 |

| `maxBudgetUsd` | number | 成本上限 | P1 |

| `mcpServers` | McpServerConfig[] | SDK 管理的 MCP 服务器 | P1 |

| `outputFormat` | OutputFormat | 结构化 JSON 输出 | P1 |

| `enableFileCheckpointing` | boolean | 文件检查点（支持回滚） | P1 |

| `sandbox` | SandboxConfig | 沙箱配置 | P1 |

| `canUseTool` | callback | 自定义权限处理 | P2 |

| `continue` | boolean | 继续最近会话 | P2 |

| `executableArgs` | string[] | 运行时参数 | P2 |

| `extraArgs` | string[] | CLI 透传参数 | P2 |

| `fallbackModel` | string | 备用模型 | P2 |

| `forkSession` | boolean | 恢复时 fork | P2 |

| `persistSession` | boolean | 会话持久化 | P2 |

| `pathToClaudeCodeExecutable` | string | 自定义可执行路径 | P2 |

| `permissionPromptToolName` | string | 权限提示路由 | P2 |

| `plugins` | string[] | 本地插件 | P2 |

| `resumeSessionAt` | string | 从指定消息恢复 | P2 |

| `strictMcpConfig` | boolean | 严格 MCP 校验 | P2 |

| `spawnClaudeCodeProcess` | callback | 自定义进程拉起 | P2 |

**### 3.4 无效字段（需移除）**

| 字段 | 问题 | 说明 |

|-----|------|------|

| `images` | SDK 0.1.69 不支持此字段 | 当前代码传了但会被 SDK 忽略，`claude.ts:400` |

**### 3.5 类型错误字段**

| 字段 | 当前传值 | SDK 期望值 | 说明 |

|-----|---------|----------|------|

| `executable` | `process.execPath` (路径) | `'node' \| 'bun' \| 'deno'` | 应传运行时名称而非路径 |

---

**## 4. SDK 消息类型处理对比**

Claude Agent SDK 定义了多种消息类型（`SDKMessage` 联合类型，`agentSdkTypes.d.ts:400-513`）。

**### 4.1 已处理消息类型**

| 消息类型 | 处理状态 | 代码位置 | 说明 |

|---------|---------|---------|------|

| `stream_event` | 部分处理 | `claude.ts:439-600` | 处理了 message*start/content_block*\*/message_stop |

| `assistant` | 已处理 | `claude.ts:601-670` | 作为 fallback |

| `result` | 部分处理 | `claude.ts:671-686` | 处理了 usage/error |

| `system:init` | 部分处理 | `claude.ts:687-704` | 仅提取 session_id |

**### 4.2 未处理消息类型**

| 消息类型 | SDK 定义 | 功能 | 优先级 |

|---------|---------|-----|-------|

| `auth_status` | SDKAuthStatusMessage | 认证状态（登录引导） | P0 |

| `tool_progress` | SDKToolProgressMessage | 工具执行进度 | P1 |

| `system:status` | SDKSystemMessage | 系统状态（如 compacting） | P2 |

| `system:compact_boundary` | SDKSystemMessage | 上下文压缩边界 | P2 |

| `system:hook_response` | SDKSystemMessage | Hook 执行结果 | P2 |

| `user` | SDKUserMessage | 用户消息回显 | P2 |

**### 4.3 result 消息未解析字段**

| 字段 | 功能 | 优先级 |

|-----|------|-------|

| `structured_output` | 结构化输出结果（配合 outputFormat） | P1 |

| `permission_denials` | 权限拒绝记录 | P1 |

---

**## 5. Query 管理方法实现状态**

Claude Agent SDK 的 `Query` 接口（`agentSdkTypes.d.ts:514-589`）提供了管理和控制方法。

**### 5.1 数据查询方法**

| 方法 | 功能 | AgentChat 状态 | 数据来源 | 优先级 |

|-----|-----|---------------|---------|-------|

| `supportedCommands()` | 获取 slash commands | 未实现 | initialize 缓存 | P0 |

| `supportedModels()` | 获取可用模型列表 | 未实现 | initialize 缓存 | P0 |

| `accountInfo()` | 获取账号信息 | 未实现 | initialize 缓存 | P0 |

| `mcpServerStatus()` | MCP 服务器状态 | 未实现 | 需活进程（控制请求） | P0 |

**### 5.2 控制方法**

| 方法 | 功能 | AgentChat 状态 | 优先级 |

|-----|-----|---------------|-------|

| `interrupt()` | 中断执行 | 未实现 | P0 |

| `rewindFiles(userMessageId)` | 文件回滚 | 未实现 | P1 |

| `setPermissionMode(mode)` | 运行时改权限 | 未实现 | P2 |

| `setModel(model)` | 运行时改模型 | 未实现 | P2 |

| `setMaxThinkingTokens(n)` | 运行时改思考上限 | 未实现 | P2 |

| `streamInput(stream)` | 流式输入 | 未实现 | P1 |

**### 5.3 数据来源说明**

SDK 的管理方法分为两类：

1. **读 initialize 缓存**（无额外开销）：

- `supportedCommands()` → `sdk.mjs:8059-8061`

- `supportedModels()` → `sdk.mjs:8062-8064`

- `accountInfo()` → `sdk.mjs:8072-8074`

2. **发送控制请求**（需活进程）：

- `mcpServerStatus()` → 发送 `mcp_status` 请求，`sdk.mjs:8065-8071`

---

**## 6. Claudable vs AgentChat 功能对比**

**### 6.1 功能覆盖对比**

| 功能 | Claudable | AgentChat | 差异说明 | 优先级 |

|-----|------|-----------|---------|-------|

| WebSocket + SSE 双通道 | ✓ | SSE only | Claudable 有 WS 优先 + SSE fallback | P1 |

| systemPrompt | ✓ | ✗ | Claudable 有预设的 Next.js 系统提示 | P1 |

| maxOutputTokens | ✓ | ✗ | Claudable 通过 env 设置 | P1 |

| 工具使用立即推送 | ✓ | ✗ | AgentChat 延迟到 content_block_stop | P1 |

| UserRequest 追踪模型 | ✓ | ✗ | Claudable 有 running/completed/failed 状态 | P2 |

| isOptimistic 乐观更新 | ✓ | ✗ | Claudable 支持乐观消息替换 | P2 |

| Thinking 标签渲染 | ✓ | ✗ | Claudable 解析 `<thinking>` 做折叠 | P2 |

| ready 状态事件 | ✓ | ✗ | Claudable 发送 ready 状态 | P2 |

**### 6.2 Claudable 关键实现参考**

| 功能 | Claudable 代码位置 |

|-----|-------------|

| Claude 执行入口 | `other/Claudable/lib/services/cli/claude.ts:563` |

| systemPrompt 设置 | `other/Claudable/lib/services/cli/claude.ts:726-736` |

| maxOutputTokens | `other/Claudable/lib/services/cli/claude.ts:582-586` |

| WebSocket + SSE | `other/Claudable/components/chat/ChatLog.tsx:1509-1600` |

| Thinking 渲染 | `other/Claudable/components/chat/ChatLog.tsx:2244-2290` |

| isOptimistic 类型 | `other/Claudable/types/realtime.ts:7-24` |

---

**## 7. 管理能力数据采集方案**

**### 7.1 推荐方案：act 内自动采集 + 缓存**

为避免每次管理查询都启动新进程，推荐在每次 act 的 query 过程中自动采集管理信息。

**#### 7.1.1 从 **`system:init`** 获取（零额外开销）**

`system:init` 消息包含丰富的管理信息（`agentSdkTypes.d.ts:421-456`）：

```typescript
interface SystemInitMessage {
  session_id: string; // 会话 ID

  agents?: string[]; // 可用 agents 列表

  tools: string[]; // 可用工具列表

  mcp_servers: { name: string; status: string }[]; // MCP 服务器快照

  slash_commands: string[]; // slash 命令名称列表

  plugins?: string[]; // 已加载插件

  skills?: string[]; // 已加载 skills

  model: string; // 当前模型

  permissionMode: string; // 权限模式

  cwd: string; // 工作目录

  output_style?: string; // 输出风格

  betas?: string[]; // 启用的 beta 特性

  claude_code_version?: string; // Claude Code 版本

  apiKeySource?: string; // API Key 来源
}
```

**#### 7.1.2 从 Query 方法获取（无额外进程）**

这些方法读取 Query 构造时的 initialize 缓存，不发送额外请求：

```typescript
// 完整模型列表（含 displayName/description）

const models = await query.supportedModels();

// 完整命令列表（含 description/argumentHint）

const commands = await query.supportedCommands();

// 账号信息（email/org/subscription）

const account = await query.accountInfo();
```

**#### 7.1.3 mcpServerStatus 特殊处理**

`mcpServerStatus()` 需要发送控制请求，必须在活进程内调用：

- **默认**：展示 `system:init.mcp_servers` 快照

- **按需**：提供"刷新"按钮触发实时查询

**### 7.2 缓存策略**

| 配置项 | 建议值 | 说明 |

|-------|-------|------|

| 缓存级别 | project 或 session | 根据业务需求选择 |

| TTL | 5 分钟 | 可配置 |

| 失效条件 | 新 act 执行时自动刷新 | 保证数据新鲜 |

---

**## 8. 数据模型设计**

**### 8.1 当前问题**

当前 `resume` 绑定在 `project.activeClaudeSessionId` 单值上（`chat-service.ts:68-81`），导致：

- 同一项目的多个 session 会共享同一个 Claude 会话

- 会话串话，消息混乱

**### 8.2 建议方案：新增 sessions 表**

```sql

CREATE TABLE sessions (

 id TEXT PRIMARY KEY, -- AgentChat session ID

 project_id TEXT NOT NULL, -- 关联项目

 engine_name TEXT NOT NULL, -- 引擎名称（claude/codex/...）

 engine_session_id TEXT, -- 引擎会话 ID（如 claudeSessionId）

name TEXT, -- 会话名称

 created_at TEXT NOT NULL,

 updated_at TEXT NOT NULL,

FOREIGN KEY (project_id) REFERENCES projects(id)

);

CREATE INDEX idx_sessions_project ON sessions(project_id);

CREATE INDEX idx_sessions_engine ON sessions(project_id, engine_name);

```

**### 8.3 类型定义**

```typescript
interface Session {
  id: string;

  projectId: string;

  engineName: EngineName;

  engineSessionId?: string; // Claude sessionId / Codex sessionId 等

  name?: string;

  createdAt: string;

  updatedAt: string;
}

interface ClaudeManagementInfo {
  sessionId: string;

  models: ModelInfo[];

  commands: SlashCommand[];

  account: AccountInfo;

  mcpServers: McpServerStatus[];

  tools: string[];

  agents: string[];

  plugins: string[];

  skills: string[];

  betas: string[];

  claudeCodeVersion?: string;

  lastUpdated: string;
}
```

---

**## 9. API 设计**

**### 9.1 Session CRUD API**

| 方法 | 路径 | 功能 |

|-----|-----|------|

| POST | `/agent/projects/:projectId/sessions` | 创建会话 |

| GET | `/agent/projects/:projectId/sessions` | 列出会话 |

| GET | `/agent/sessions/:sessionId` | 获取会话详情 |

| DELETE | `/agent/sessions/:sessionId` | 删除会话 |

**### 9.2 管理能力 API**

| 方法 | 路径 | 功能 |

|-----|-----|------|

| GET | `/agent/projects/:projectId/claude-info` | 获取缓存的管理信息 |

| POST | `/agent/projects/:projectId/claude-info/refresh` | 刷新管理信息（可选） |

**### 9.3 消息 API 增强**

| 方法 | 路径 | 变更 |

|-----|-----|------|

| GET | `/agent/projects/:projectId/messages` | 增加 `sessionId` 过滤参数 |

---

**## 10. 实施计划**

**### 10.1 P0 - 必须实现（阻塞性/关键风险）**

| # | 任务 | 关键文件 |

|---|-----|---------|

| 1 | Session 数据模型重构 | `db/schema.ts`, `chat-service.ts`, `routes/agent.ts` |

| 2 | SDK Options 适配层 | `engines/claude.ts:390-416`, `engines/types.ts` |

| 3 | 取消执行可靠性（abortController） | `engines/claude.ts:424`, `chat-service.ts:230` |

| 4 | 认证状态可见性（auth_status） | `engines/claude.ts:439` |

| 5 | Claude 管理能力（act 内采集） | `engines/claude.ts:687`, `routes/agent.ts` |

| 6 | system:init 完整处理 | `engines/claude.ts:687-704` |

**### 10.2 P1 - 重要增强**

| # | 任务 | 说明 |

|---|-----|------|

| 7 | UI 可配置 Options | systemPrompt, env, betas, maxTokens, outputFormat, tools, mcpServers, sandbox |

| 8 | 事件处理增强 | tool_progress, system:status/compact_boundary/hook_response |

| 9 | agents/hooks 配置支持 | 声明式 subagents，预置 hooks 策略 |

| 10 | enableFileCheckpointing + rewindFiles | 文件检查点和回滚 |

| 11 | MCP 状态刷新 | init 快照 + 按需刷新 |

**### 10.3 P2 - 可延后**

| # | 任务 |

|---|-----|

| 12 | WebSocket 主通道（WS 优先 + SSE fallback） |

| 13 | Thinking 标签渲染（`<thinking>` 折叠） |

| 14 | 高级 Options（plugins, forkSession, resumeSessionAt, spawnClaudeCodeProcess, canUseTool） |

| 15 | 乐观消息（isOptimistic） |

**### 10.4 实施顺序建议**

```

阶段 1：数据模型基础

├── 新增 sessions 表和 API

├── 重构 claudeSessionId 到 session 维度

└── SDK Options 适配层

阶段 2：可靠性和管理

├── 接入 SDK abortController

├── 处理 auth_status

├── 完整处理 system:init

└── 新增管理 API

阶段 3：前端适配

├── Session 列表/切换 UI

├── 管理面板（models/commands/mcp/account）

└── 按 session 加载历史

阶段 4：P1 批量增强

├── UI 可配置 Options

├── 事件处理增强

└── 文件检查点

```

---

**## 11. 风险点和注意事项**

**### 11.1 行为变更风险**

| 变更 | 影响 | 建议 |

|-----|------|------|

| `settingSources` 从 `[]` 改为含 `'project'` | 会开始加载 CLAUDE.md | 这是必要的对齐，需告知用户 |

| `permissionMode` 从 `bypassPermissions` 改为 `default` | 危险操作需确认 | 提供 UI 选项，默认安全 |

**### 11.2 兼容性风险**

| 问题 | 建议 |

|-----|------|

| 旧 `activeClaudeSessionId` 迁移 | 作为无 session 映射时的 fallback，逐步废弃 |

| `images` 字段移除 | 需寻找 SDK 支持的图片输入方式或移除功能 |

**### 11.3 性能风险**

| 场景 | 风险 | 建议 |

|-----|------|------|

| 管理信息频繁查询 | 频繁启动进程 | 使用 act 内采集 + 缓存方案 |

| mcpServerStatus 实时刷新 | 需要活进程 | 默认展示快照，按需刷新 |

---

**## 12. 验收标准**

**### 12.1 功能验收**

- [ ] 同一项目可以创建多个独立的 Claude 会话

- [ ] 每个会话有独立的 claudeSessionId 和消息历史

- [ ] 管理面板可以展示：支持的模型、slash commands、MCP servers 状态、账号信息

- [ ] 取消请求后 Claude Code 子进程确实退出

- [ ] `CLAUDE.md` 和 `.claude/settings.json` 能被正确加载

- [ ] 认证问题有明确的 UI 提示

**### 12.2 兼容性验收**

- [ ] 现有会话可以正常继续

- [ ] 旧数据迁移无损

---

**## 13. 附录**

**### 13.1 原始需求**

> 现在的AgentChat，对于ClaudeEngine，当前已经可以正常会话了，现在需要你和codex一起深入去检查一下，看other/Claudable里实现的claude相关的能力，在我们当前的AgentChat里是否已经全部100%覆盖了。我的目标是，我这里支持的ClaudeEngine的相关能力，必须>=other/Claudable里的，并且你和codex还要仔细查看claude agent sdk里面的所有特性，我希望都能在我的这个项目里能支持

**### 13.2 用户澄清**

1. **覆盖口径**：能力级对齐，以 SDK 0.1.69 为准

2. **SDK 特性**：可配置参数需支持，回调型特性通过配置启用

3. **管理能力**：需要支持 Claude 的管理命令（MCP、agents、models 等）

4. **路由粒度**：sessionId，支持一个项目多个 session

5. **权限模式**：可配置

**### 13.3 关键文件索引**

| 文件 | 说明 |

|-----|------|

| `app/native-server/src/agent/engines/claude.ts` | ClaudeEngine 核心实现 |

| `app/native-server/src/agent/engines/types.ts` | 引擎接口定义 |

| `app/native-server/src/agent/chat-service.ts` | 会话服务 |

| `app/native-server/src/agent/db/schema.ts` | 数据库 Schema |

| `app/native-server/src/server/routes/agent.ts` | API 路由 |

| `packages/shared/src/agent-types.ts` | 共享类型 |

| `other/Claudable/lib/services/cli/claude.ts` | Claudable Claude 实现参考 |

| `node_modules/.../agentSdkTypes.d.ts` | SDK 类型定义 |

---

_文档生成日期：2025-12-16_

_分析工具：Claude Opus 4.5 + Codex_
