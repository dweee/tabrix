# 录制回放功能重构计划

## 目标

打造商业级录制回放应用，超越 Automa。定位：端到端测试 + 浏览器自动化 + 用户操作录制。

## 决策

- **兼容性**: 不需要兼容现有数据，可以完全重写
- **产品定位**: 全功能商业级产品
- **iframe 支持**: 中优先级，基础支持后续迭代

---

## V3 重构计划

> **重要**：V2 已完成基础功能（269 测试通过），现启动 V3 全面重构以达到商业级水准。

### 相关文档

| 文档                               | 说明                                |
| ---------------------------------- | ----------------------------------- |
| [rr-v3-spec.md](./rr-v3-spec.md)   | V3 架构规范（类型定义、接口设计）   |
| [rr-v3-tasks.md](./rr-v3-tasks.md) | V3 详细任务拆解（762h，6 个 Phase） |
| [rr-check.md](./rr-check.md)       | 与 Automa 深度对比分析              |

### V3 核心改进

| 维度       | V2 现状     | V3 目标                                         |
| ---------- | ----------- | ----------------------------------------------- |
| 错误处理   | workflow 级 | 节点级 onError（stop/continue/goto/retry）      |
| 调试器     | 仅暂停      | 断点、单步、变量查看、事件追踪                  |
| 并行执行   | 单线程      | 多 Run 并行 + Run Queue                         |
| 触发器     | 1 种        | 6 种（manual/url/cron/command/contextMenu/dom） |
| 持久化变量 | 无          | $ 前缀变量跨 Run 共享                           |
| 录制器     | JS 混杂     | TypeScript 模块化 + top 聚合                    |
| 崩溃恢复   | 无          | checkpoint + 租约恢复                           |

### V3 实施路线

```
Phase 0 (1周)  → 目录骨架 + 类型定义     [42h]
Phase 1 (4周)  → Kernel + 事件流 + onError [152h]
Phase 2 (2周)  → 调试器 MVP              [90h]
Phase 3 (3周)  → Run Queue + 并行        [110h]
Phase 4 (3周)  → 触发器系统              [132h]
Phase 5 (6周)  → Recorder V3 (TS化)      [236h]
───────────────────────────────────────────
总计: ~762h (~19周单人，13-16周多人并行)
```

---

## V2 完成进度（历史记录）

| 阶段                   | 状态    | 主要内容                                  |
| ---------------------- | ------- | ----------------------------------------- |
| Phase 1.1 Action 系统  | ✅ 完成 | 27 种 Action 类型、执行器注册表           |
| Phase 1.2 选择器引擎   | ✅ 完成 | 6 种策略、指纹验证、Shadow DOM            |
| Phase 1.3 数据模型统一 | ✅ 完成 | DAG 单一数据源、hybrid 执行模式、269 测试 |
| 深度审查对比           | ✅ 完成 | 与 Automa 全面对比，详见 `rr-check.md`    |

**当前测试状态**: 269 个测试（全部通过）

---

## 待实现任务

### P0: Bug 修复（深度审查发现）

> 详见 `rr-check.md` 深度审查报告

| Bug                 | 位置                    | 问题                                                      | 修复方案                        |
| ------------------- | ----------------------- | --------------------------------------------------------- | ------------------------------- |
| if/else 标签不匹配  | `mapStepToNodeConfig()` | `s.else === true` 映射为 `"true"`，画布期望 `"case:else"` | 使用正确的 label 常量           |
| delay schema 不匹配 | delay 类型映射          | 映射为 wait 时缺少 `condition.kind`                       | 添加 `condition.kind = 'sleep'` |

### P1: 核心功能增强

> 参考 Automa，详见 `rr-check.md` 第八节

| 功能         | 描述                                            | 参考实现                    |
| ------------ | ----------------------------------------------- | --------------------------- |
| 错误处理增强 | 每节点 onError 配置（continue/stop/jump/retry） | Automa `block.data.onError` |
| 调试器       | 暂停/单步/恢复/断点                             | Automa Debugger 接口        |
| 并行执行     | 多 Worker 并行执行                              | Automa `WorkflowWorker`     |

### P2: 触发器 + 数据系统

| 功能        | 当前状态 | Automa 对比    |
| ----------- | -------- | -------------- |
| 定时触发    | ❌ 无    | cron/interval  |
| URL 触发    | ❌ 无    | 正则/glob 匹配 |
| 快捷键触发  | ❌ 无    | 全局快捷键     |
| Tables 数据 | ❌ 无    | 表格数据存储   |
| 持久变量    | ❌ 无    | $ 前缀变量     |
| 凭证存储    | ❌ 无    | 加密凭证       |

### P3: 功能扩展

| 功能         | 描述                                                      |
| ------------ | --------------------------------------------------------- |
| 更多节点类型 | webhook、http-request、execute-workflow、google-sheets 等 |
| 画布增强     | 节点分组、搜索、注释                                      |
| 录制增强     | 文件上传、拖拽、右键菜单                                  |

### 可选优化

- [ ] 录制期实时 DAG 展示（将 nodes/edges 包含在 timeline 广播中）
- [ ] 抽取共用工具到 `shared/selector-core/` 供 web-editor-v2 复用

---

## 已完成内容概要

### Phase 1.1: Action 系统 ✅

- `actions/types.ts` - 27 种 Action 类型定义
- `actions/registry.ts` - 执行器注册表（before/after 钩子、重试/超时）
- `actions/handlers/*` - 22 个 Handler 实现

### Phase 1.2: 选择器引擎 ✅

- 6 种选择器策略：testid/aria/css-unique/css-path/anchor-relpath/text
- 指纹验证：生成、解析、验证、相似度计算
- Shadow DOM 完整支持：链遍历和查询

### Phase 1.3: 数据模型统一 ✅

**核心改动**：

- 录制/回放统一使用 `nodes/edges` 格式（不再写入 `steps`）
- 存储层自动 strip steps，IndexedDB 迁移完成
- Hybrid 执行模式：可配置 legacy/actions/hybrid

**测试覆盖**：

- 42 个契约测试（adapter-policy + step-executor + session-dag-sync）
- 62 个集成测试（routing + handlers + control-flow）

**已修复 Bug**：

- fill 值不完整（debounce/flush 时序）
- stop barrier 丢步骤（iframe 最后步骤）
- 变量丢失、步骤丢失、trigger 无 handler 等

---

## 架构概览

### 当前架构

```
录制: recorder.js → content-message-handler → session-manager → flow-store (nodes/edges)
回放: scheduler → step-runner → step-executor → action-handlers (nodes/edges)
```

### 核心数据结构

```typescript
interface Flow {
  id: string;
  name: string;
  version: number;
  nodes: FlowNode[]; // 单一数据源
  edges: FlowEdge[];
  variables: Variable[];
  meta: FlowMeta;
}

interface FlowNode {
  id: string;
  type: NodeType;
  config: Record<string, unknown>;
}

interface FlowEdge {
  id: string;
  from: string;
  to: string;
  label?: string; // 'default' | 'case:else' | 'case:true' | ...
}
```

### 执行模式

```typescript
type ExecutionMode = 'legacy' | 'actions' | 'hybrid';

// hybrid 模式：allowlist 内走 actions，其他走 legacy
const MINIMAL_HYBRID_ACTION_TYPES = new Set([
  'fill',
  'key',
  'scroll',
  'drag',
  'wait',
  'delay',
  'screenshot',
  'assert',
]);
```

---

## 关键文件清单

### 核心模块

| 模块         | 文件                              | 职责                           |
| ------------ | --------------------------------- | ------------------------------ |
| 录制会话     | `recording/session-manager.ts`    | 状态机、DAG 同步、Stop Barrier |
| 回放调度     | `engine/scheduler.ts`             | DAG 遍历、执行上下文           |
| 执行器       | `engine/runners/step-executor.ts` | Legacy/Actions/Hybrid 执行     |
| Action 适配  | `actions/adapter.ts`              | Step ↔ Action 转换             |
| Handler 注册 | `actions/handlers/index.ts`       | 22 个 Handler 工厂             |
| 选择器       | `shared/selector/*`               | 生成、定位、指纹               |
| 存储         | `record-replay/flow-store.ts`     | IndexedDB、迁移、导入导出      |

### 测试文件

| 文件                                      | 测试数 | 覆盖内容                   |
| ----------------------------------------- | ------ | -------------------------- |
| `adapter-policy.contract.test.ts`         | 7      | skipRetry/skipNavWait 策略 |
| `step-executor.contract.test.ts`          | 20     | 执行器路由、配置契约       |
| `session-dag-sync.contract.test.ts`       | 15     | DAG 同步、不变式处理       |
| `hybrid-actions.integration.test.ts`      | 17     | 低风险 action handlers     |
| `high-risk-actions.integration.test.ts`   | 11     | click/navigate 路由        |
| `tab-cursor.integration.test.ts`          | 8      | tabs 操作、ctx.tabId 同步  |
| `script-control-flow.integration.test.ts` | 26     | script defer、控制流       |
| `flow-store-strip-steps.contract.test.ts` | 10     | steps strip、normalize     |

---

## 对比 Automa（核心差异）

> 完整对比详见 `rr-check.md`

| 维度         | 当前项目       | Automa         | 差距   |
| ------------ | -------------- | -------------- | ------ |
| 类型安全     | ✅ TypeScript  | ❌ JS          | 优势   |
| Stop Barrier | ✅ 优雅停止    | ❌ 简单标志    | 优势   |
| 选择器质量   | ✅ 多策略      | ❌ 基础        | 优势   |
| 并行执行     | ❌ 单线程      | ✅ 多 Worker   | 需实现 |
| 错误处理     | ❌ workflow 级 | ✅ 每 block    | 需增强 |
| 调试器       | ❌ 仅暂停      | ✅ 完整        | 需实现 |
| 数据系统     | ❌ 无          | ✅ Tables/凭证 | 需实现 |
| 节点类型     | ~15 种         | 50+ 种         | 需扩展 |
| 触发器       | 1 种           | 10+ 种         | 需实现 |

---

## 重构路线图

```
Phase 1: Bug 修复 + 错误处理增强（当前）
├── 修复 if/else 标签映射
├── 修复 delay schema 映射
└── 实现每节点 onError 配置

Phase 2: 调试器 + 并行执行
├── 实现 Debugger 接口（pause/next/resume/breakpoint）
├── 实现 Worker 池并行执行
└── 支持执行队列

Phase 3: 触发器 + 数据系统
├── 实现触发器注册中心
├── 支持 URL/定时/快捷键触发
└── 实现 Tables 和持久变量

Phase 4: 功能扩展
├── 更多节点类型（50+ 目标）
├── 画布功能增强
└── 录制能力增强
```

---

## 建议架构改进

### 1. 节点执行器插件化

```typescript
interface NodeExecutor<T extends NodeConfig> {
  type: string;
  execute(node: Node<T>, ctx: ExecutionContext): Promise<ExecutionResult>;
  validate?(config: T): ValidationResult;
  onError?(error: Error, node: Node<T>): ErrorHandlerResult;
}

class ExecutorRegistry {
  register(executor: NodeExecutor<any>): void;
  get(type: string): NodeExecutor<any> | undefined;
}
```

### 2. 调试器接口

```typescript
interface Debugger {
  pause(): void;
  resume(): void;
  stepOver(): void;
  stepInto(): void;
  setBreakpoint(nodeId: string): void;
  removeBreakpoint(nodeId: string): void;
  getState(): DebuggerState;
}
```

### 3. 触发器系统

```typescript
interface Trigger {
  type: string;
  config: TriggerConfig;
  evaluate(context: TriggerContext): boolean;
  setup(): void;
  teardown(): void;
}

class TriggerRegistry {
  register(trigger: Trigger): void;
  evaluate(flowId: string): boolean;
}
```

---

_最后更新: 2025-12_
