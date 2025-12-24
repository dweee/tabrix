# 录制回放功能重构计划

## 目标

完全重写录制回放功能，打造超越商业级应用体验的产品。定位为全功能平台：端到端测试 + 浏览器自动化 + 用户操作录制。

## 决策

- **兼容性**: 不需要兼容现有数据，可以完全重写
- **产品定位**: 全功能商业级产品
- **iframe 支持**: 中优先级，基础支持后续迭代

---

## 实施进度

### 已完成

#### Phase 1.1: Action 系统 ✅

- [x] `actions/types.ts` - 完整的 Action 类型定义（27 种 Action 类型）
  - trigger/delay/click/dblclick/fill/key/scroll/drag/wait/assert/extract/script/http/screenshot/triggerEvent/setAttribute/switchFrame/loopElements/if/foreach/while/executeFlow/navigate/openTab/switchTab/closeTab/handleDownload
- [x] `actions/registry.ts` - Action 执行器注册表（支持 before/after 钩子、重试/超时、解析器）
- [x] `actions/index.ts` - 模块导出

#### Phase 1.2: 选择器引擎 - 基础框架 ✅

- [x] `shared/selector/types.ts` - 选择器类型定义（含 ExtendedSelectorTarget）
- [x] `shared/selector/stability.ts` - 稳定性评分计算
- [x] `shared/selector/strategies/` - 6 种选择器策略（testid/aria/css-unique/css-path/anchor-relpath/text）
- [x] `shared/selector/generator.ts` - 统一选择器生成（含 generateExtendedSelectorTarget）
- [x] `shared/selector/locator.ts` - 统一元素定位（支持多候选尝试与排序）

#### Phase 1.2: 选择器引擎 - 补齐商业级功能 ✅

对比 `web-editor-v2/locator.ts`，已补齐以下功能：

| 功能                    | 状态    | 说明                                                                              |
| ----------------------- | ------- | --------------------------------------------------------------------------------- |
| **指纹(Fingerprint)**   | ✅ 完成 | `fingerprint.ts` - 生成、解析、验证、相似度计算                                   |
| **DOM Path**            | ✅ 完成 | `dom-path.ts` - 路径计算、定位、比较                                              |
| **锚点+相对路径策略**   | ✅ 完成 | `strategies/anchor-relpath.ts` - anchor + nth-of-type 路径                        |
| **Shadow DOM 完整支持** | ✅ 完成 | `shadow-dom.ts` - 链遍历和查询；`generator.ts` - 链生成                           |
| **name/title/alt 属性** | ✅ 完成 | `testid.ts` + `generator.ts` - 带标签前缀规则                                     |
| **类型扩展**            | ✅ 完成 | `types.ts` - `ExtendedSelectorTarget`、`fingerprint/domPath/shadowHostChain` 字段 |

> **注意**: aria-label 属性已由 `ariaStrategy` 处理，不重复加入 testid 策略

### 进行中

#### Phase 1.3: 数据模型统一 🔄

**当前状态**：P0、P3 已完成。P1、P2、P4 待后续迭代。

- P0 ✅：录制产物转换为 DAG，可直接回放
- P3 ✅：22 个 Action Handlers 完整实现 + Scheduler 集成架构设计完成
- P1 ⏳：存储层统一（IndexedDB schema、lazy normalize）
- P2 ⏳：录制链路迁移到 Action
- P4 ⏳：清理旧 Step 类型

**核心问题**：录制与回放数据格式不一致

- 录制产物：`Flow.steps: Step[]`（`recording/flow-builder.ts`）
- 回放输入：`Flow.nodes/edges`（`engine/scheduler.ts:279` 要求 DAG）
- 导致录制后无法直接回放，需要通过 Builder 转换

**类型定义位置**：
| 类型 | 旧定义 | 新定义 |
|------|--------|--------|
| Step/Action | `record-replay/types.ts:145` | `actions/types.ts:706` (AnyAction) |
| Flow | `record-replay/types.ts:251` (含 steps) | `actions/types.ts:831` (仅 nodes/edges) |
| Variable | `record-replay/types.ts:221` (key/default) | `actions/types.ts:145` (name/...) |

**受影响文件清单**：

使用旧 `Step` 的文件（15个）：

- `engine/plugins/types.ts`、`engine/runners/step-runner.ts`、`engine/runners/subflow-runner.ts`
- `engine/scheduler.ts`、`rr-utils.ts`
- `recording/session-manager.ts`、`recording/content-message-handler.ts`
- `recording/flow-builder.ts`、`recording/browser-event-listener.ts`
- `nodes/index.ts`、`nodes/types.ts`、`nodes/click.ts`、`nodes/navigate.ts`
- `nodes/conditional.ts`、`nodes/download-screenshot-attr-event-frame-loop.ts`

使用旧 `Flow` 的文件（12个）：

- Background: `index.ts`、`flow-store.ts`、`storage/indexeddb-manager.ts`
- Recording: `flow-builder.ts`、`recorder-manager.ts`、`session-manager.ts`
- Engine: `scheduler.ts`、`runners/step-runner.ts`、`plugins/types.ts`、`logging/run-logger.ts`
- UI: `builder/App.vue`、`builder/components/Sidebar.vue`

**迁移策略（推荐分阶段）**：

**P0: 先让录制产物可运行（最小改动）** ✅

- [x] 在 `flow-store.ts:saveFlow` 保存时，把 `steps` 转换为 DAG（新增 `packages/shared/src/rr-graph.ts:stepsToDAG`）
- [x] 确保保存的 flow 同时有 `steps` 和 `nodes/edges`（向后兼容）
- [x] 添加 `normalizeFlowForSave` 归一化函数，只在 nodes 缺失时补齐
- [x] 添加 `filterValidEdges` 校验旧 edges 有效性，避免 topoOrder 崩溃
- 涉及文件：`packages/shared/src/rr-graph.ts`、`flow-store.ts`

**P1: 存储层统一（单一真源）**

- [x] `flow-store.ts` 读写逻辑适配新 Flow（P0 已完成）
- [ ] `importFlowFromJson` 支持新旧格式自动识别（P0 已间接支持：导入后保存会触发 normalize）
- [ ] 考虑 IndexedDB schema 升级策略，这里不用考虑，因为还没有任何人使用，没有任何数据产生，直接升级即可
- [ ] 迁移场景：`ensureMigratedFromLocal()` 需要做 lazy normalize（当前迁移不走 saveFlow）
- 涉及文件：`flow-store.ts`、`storage/indexeddb-manager.ts`

**P2: 录制链路迁移**

- [ ] `flow-builder.ts` 改为写 `nodes: AnyAction[]`
- [ ] `content-message-handler.ts` 接收 Step 后转换为 Action
- [ ] 可选：修改 `recorder.js` 直接发送 Action
- 涉及文件：`flow-builder.ts`、`content-message-handler.ts`、`session-manager.ts`

**P3: 回放引擎适配** ✅

- [x] 实现核心 Action Handlers（navigate, click, dblclick, fill, wait）
  - `actions/handlers/common.ts` - 共享工具（selector转换、消息发送、元素验证）
  - `actions/handlers/navigate.ts` - 导航处理器
  - `actions/handlers/click.ts` - 点击/双击处理器
  - `actions/handlers/fill.ts` - 表单填充处理器
  - `actions/handlers/wait.ts` - 等待条件处理器
  - `actions/handlers/index.ts` - 注册入口（createReplayActionRegistry）
- [x] 类型安全改进
  - 使用泛型 `ActionHandler<T>` 确保类型一致
  - 添加 `sendMessageToTab` 封装避免 undefined frameId 错误
  - 使用 `SelectorCandidateSource`/`SelectorStability` 正确类型
- [x] Tool 调用统一传递 `tabId`，避免默认 active tab 歧义
- [x] 错误信息保留：解析 tool 返回的 error content
- [x] 扩展 Handlers：key, scroll, delay, screenshot
  - `actions/handlers/key.ts` - 键盘输入（支持目标聚焦）
  - `actions/handlers/scroll.ts` - 滚动（offset/element/container 三种模式）
  - `actions/handlers/delay.ts` - 延迟等待
  - `actions/handlers/screenshot.ts` - 截图（全页/元素/区域）
- [x] 完整 Handlers 实现（22个处理器）
  - `actions/handlers/assert.ts` - 断言（exists/visible/textPresent/attribute，支持轮询）
  - `actions/handlers/extract.ts` - 数据提取（selector/js 模式）
  - `actions/handlers/script.ts` - 自定义脚本（MAIN/ISOLATED world）
  - `actions/handlers/http.ts` - HTTP 请求（GET/POST/PUT/DELETE/PATCH）
  - `actions/handlers/tabs.ts` - 标签页（openTab/switchTab/closeTab/handleDownload）
  - `actions/handlers/control-flow.ts` - 控制流（if/foreach/while/switchFrame）
  - `actions/handlers/drag.ts` - 拖拽（start/end 目标，支持 path 坐标）
- [x] Scheduler 集成架构（详见下方）
- 涉及文件：`scheduler.ts`、`rr-utils.ts`、`step-runner.ts`、`actions/handlers/*`、`actions/adapter.ts`、`engine/execution-mode.ts`、`engine/runners/step-executor.ts`

##### Scheduler 集成 ActionRegistry 详细设计

**1. 适配层 (`actions/adapter.ts`)**

核心功能：Step ↔ Action 双向转换

```typescript
// 主要导出
export function stepToAction(step: Step): ExecutableAction | null;
export function execCtxToActionCtx(
  ctx: ExecCtx,
  tabId: number,
  options?: { stepId?: string; runId?: string; pushLog?: (entry: unknown) => void },
): ActionExecutionContext;
export function actionResultToExecResult(result: ActionExecutionResult): ExecResult;
export function createStepExecutor(
  registry: ActionRegistry,
): (ctx, step, tabId, options) => Promise<StepExecutionAttempt>;
export function isActionSupported(stepType: string): boolean;
export type StepExecutionAttempt =
  | { supported: true; result: ExecResult }
  | { supported: false; reason: string };
```

关键实现：

- **日志归因修复**：`execCtxToActionCtx` 接受 `stepId` 参数，确保日志正确归因到具体步骤
- **Selector Candidate 转换**：Legacy `{ type, value }` → Action `{ type, selector/xpath/text }`
  - css/attr → `{ type, selector }`
  - xpath → `{ type, xpath }`
  - text → `{ type, text }`
  - aria → 解析 `"role[name=...]"` 格式为 `{ type, role?, name }`
- **TargetLocator 转换**：保留 `ref`、`selector`（fast-path）、`tag`（hint）字段
- **二次转换保护**：`isLegacyTargetLocator` 精确检测，通过检查 candidate 是否有 `value` 字段来判断

**2. 执行模式 (`engine/execution-mode.ts`)**

```typescript
export type ExecutionMode = 'legacy' | 'actions' | 'hybrid';

export interface ExecutionModeConfig {
  mode: ExecutionMode;
  legacyOnlyTypes?: Set<string>; // 强制使用 legacy 的类型
  actionsAllowlist?: Set<string>; // 允许使用 actions 的类型
  logFallbacks?: boolean; // 是否记录回退日志
  skipActionsRetry?: boolean; // 跳过 ActionRegistry 重试
  skipActionsNavWait?: boolean; // 跳过 ActionRegistry 导航等待
}

// 已验证安全的类型（保守列表）
export const MIGRATED_ACTION_TYPES = new Set([
  'navigate',
  'click',
  'dblclick',
  'fill',
  'key',
  'scroll',
  'drag',
  'wait',
  'delay',
  'screenshot',
  'assert',
]);

// 需要更多验证的类型
export const NEEDS_VALIDATION_TYPES = new Set([
  'extract',
  'http',
  'script',
  'openTab',
  'switchTab',
  'closeTab',
  'handleDownload',
  'if',
  'foreach',
  'while',
  'switchFrame',
]);

// 必须使用 legacy 的类型
export const LEGACY_ONLY_TYPES = new Set([
  'triggerEvent',
  'setAttribute',
  'loopElements',
  'executeFlow',
]);
```

**3. 执行器抽象 (`engine/runners/step-executor.ts`)**

```typescript
export interface StepExecutorInterface {
  execute(ctx: ExecCtx, step: Step, options: StepExecutionOptions): Promise<StepExecutionResult>;
  supports(stepType: string): boolean;
}

export class LegacyStepExecutor implements StepExecutorInterface {
  /* 使用 nodes/executeStep */
}
export class ActionsStepExecutor implements StepExecutorInterface {
  /* 使用 ActionRegistry，strict 模式 */
}
export class HybridStepExecutor implements StepExecutorInterface {
  /* 先尝试 actions，失败回退 legacy */
}

export function createExecutor(
  config: ExecutionModeConfig,
  registry?: ActionRegistry,
): StepExecutorInterface;
```

**4. 导出更新 (`actions/index.ts`)**

```typescript
// 适配器导出
export {
  execCtxToActionCtx,
  stepToAction,
  actionResultToExecResult,
  createStepExecutor,
  isActionSupported,
  getActionType,
  type StepExecutionAttempt,
} from './adapter';

// Handler 工厂导出
export {
  createReplayActionRegistry,
  registerReplayHandlers,
  getSupportedActionTypes,
  isActionTypeSupported,
} from './handlers';
```

##### 后续接入步骤（未完成）

1. **修改 StepRunner 依赖注入 StepExecutorInterface**
   - 当前 `StepRunner` 直接调用 `executeStep`（`step-runner.ts:84`）
   - 需要改为通过 `StepExecutorInterface.execute()` 调用
   - 由 `Scheduler` 创建 `ActionRegistry` + `createExecutor` 并注入

2. **解决双重策略问题**
   - StepRunner 有 retry/timeout/nav-wait 策略（`step-runner.ts:82,106`）
   - ActionRegistry 也有 retry/timeout 策略（`registry.ts:462,527`）
   - 需明确唯一权威：使用 `skipActionsRetry/skipActionsNavWait` 配置控制

3. **tabId 管理**
   - 当前 ExecCtx 不携带 tabId
   - openTab/switchTab 后需要更新 tabId
   - 建议在 ExecCtx 中添加 `tabId` 字段并在 tab 切换时同步

4. **集成测试**
   - 在 hybrid 模式下验证各类型行为一致性
   - 特别关注：aria selector、script when:'after' defer、control-flow 条件求值

**P4: 清理旧类型**

- [ ] 删除 `types.ts` 中的 `Step` 联合类型
- [ ] 删除 `Flow.steps` 字段
- [ ] 将旧类型移至 `legacy-types.ts`（如 UI 仍需要）

**风险点**：

- 类型同名冲突：两个 `Flow` 类型容易 import 错
- 变量结构不同：旧 `v.key/v.default` vs 新 `v.name/...`
- 子流程执行：`execute-flow.ts` 有 `flow.steps` fallback
- UI Builder 保存格式需同步适配

#### P0 Bug 修复详情 ✅

**fill 值不完整 (debounce/flush 时序冲突)**

问题：`INPUT_DEBOUNCE_MS=800` vs `BATCH_SEND_MS=100`，导致用户正在输入时 flush 发送不完整的值。

修复方案（`recorder.js`）：

- 添加 flush gate 机制：基于 `_lastInputActivityTs` 判断是否在输入中
- 添加 force flush timer：最多延迟 1500ms 强制 flush
- 添加 commit points：focusout、Enter 键、pagehide/visibilitychange 时立即 flush
- 修复 `_finalizePendingInput()`：使用 DOM 引用 `lastFill.el` 读取最新值
- 添加 `_getElementValue()` 严格模式：保护变量占位符不被覆盖
- iframe upsert 一致性：通过 postMessage 到 top frame 统一处理

**stop barrier 丢步骤 (iframe 最后步骤丢失)**

问题：stop 时 subframe ACK 可能在 top 处理完 postMessage 之前返回，导致 iframe 最后步骤丢失。

修复方案：

- `recorder-manager.ts`：
  - 先停 subframes（并发，1.5s 超时），再停 main frame（5s 超时）
  - 记录 barrier 元数据到 `flow.meta.stopBarrier`
- `recorder.js`：
  - 添加 `_finalizePendingClick()` 方法，在 flush 之前处理 pending click
  - 添加 `_syncStopBarrierToTop()` 方法：iframe 等待 top 处理完 postMessage 后再 ACK
  - `_detach()` 在 paused 状态保持 top 的 message listener
  - `_onWindowMessage` 处理 `iframeStopBarrier` 消息并回复 ACK
  - stop 时清除 isPaused 状态确保 barrier 一致性

#### Phase 2: locator 指纹验证 ✅

- [x] 更新 `shared/selector/locator.ts` - 添加指纹验证逻辑
  - 新增 `VERIFY_FINGERPRINT` 消息类型（`message-types.ts`）
  - 新增 `verifyElementFingerprint` 方法通过消息协议验证
  - 在 `locate()` 的 fast path 和 candidate 循环中添加指纹验证
  - 读取 `options.verifyFingerprint` 配置和 `target.fingerprint` 字段
- [x] 更新 `accessibility-tree-helper.js` - 添加 `verifyFingerprint` action 处理
- [ ] 抽取共用工具到 `shared/selector-core/` 供 web-editor-v2 复用（可选优化）

#### Phase 2-7: 后续阶段

- Phase 2: 录制系统重写
- Phase 3: 回放引擎重写
- Phase 4: Builder 重构
- Phase 5-7: 高级功能、iframe、测试

---

## 一、现状分析

### 1.1 架构现状

```
录制: recorder.js -> content-message-handler -> session-manager -> flow-store (steps格式)
回放: scheduler -> step-runner -> nodes/* (需要 nodes/edges 格式)
```

### 1.2 高严重度 Bug

| Bug                    | 位置                                                | 描述                                   | 状态      |
| ---------------------- | --------------------------------------------------- | -------------------------------------- | --------- |
| 数据格式不兼容         | `flow-builder.ts` / `scheduler.ts`                  | 录制产生 steps，回放需要 nodes/edges   | ✅ 已修复 |
| 变量丢失               | `recorder.js:609` / `content-message-handler.ts:18` | 变量只存本地，不传给 background        | ✅ 已修复 |
| 步骤丢失               | `recorder.js:584-594`                               | pause/stop/导航时未 flush 缓冲区       | ✅ 已修复 |
| fill 值不完整          | `recorder.js`                                       | debounce 800ms vs flush 100ms 时序冲突 | ✅ 已修复 |
| stop barrier 丢步骤    | `recorder-manager.ts` / `recorder.js`               | stop 时 iframe 最后步骤可能丢失        | ✅ 已修复 |
| trigger 无 handler     | `nodes/index.ts:58`                                 | UI 可用但运行时无执行器                | ✅ 已修复 |
| 选择器桥死锁           | `accessibility-tree-helper.js:1051`                 | iframe 通信无超时                      | ✅ 已修复 |
| Builder 保存丢失子流程 | `useBuilderStore.ts:392`                            | 编辑子流程时保存不会 flush             | ✅ 已修复 |

### 1.3 中严重度 Bug

| Bug                       | 位置                                     | 描述                          | 状态      |
| ------------------------- | ---------------------------------------- | ----------------------------- | --------- |
| pause/resume 状态不同步   | `recorder.js:476` / `session-manager.ts` | content 暂停，background 继续 | ✅ 已修复 |
| 双击产生多余点击          | `recorder.js:650`                        | click + dblclick 序列问题     |
| contenteditable 不录制    | `recorder.js:663-684`                    | focusin 支持但 input 不支持   |
| 跨 frame 消息无验证       | `recorder.js:577,1026`                   | postMessage('\*') 可被伪造    |
| saveFlow 异步无 await     | `recorder-manager.ts:45`                 | 异常不会被捕获                |
| waitForNetworkIdle 失效   | `step-runner.ts:88`                      | 始终调用 waitForNavigation    |
| wait helper 不支持 iframe | `wait.ts:23,36,57`                       | 只注入顶层 frame              |
| 模板替换不一致            | `wait.ts:12`, `assert.ts:19` 等          | 传 {} 而非 ctx.vars           |
| key 不聚焦目标            | `key.ts:10`                              | 忽略 target 字段              |
| script 忽略 frameId       | `script.ts:15`                           | 总在顶层执行                  |
| 运行统计错误              | `scheduler.ts:327,485`                   | 只统计默认边，不含分支        |
| 子流程忽略分支边          | `subflow-runner.ts:40`                   | defaultEdgesOnly              |

### 1.4 代码质量问题

- 大量 `any` 类型和类型断言
- 错误处理不完善（catch {} 吞掉错误）
- 状态分散在 content/background，无单一事实来源
- 选择器生成逻辑重复（recorder.js, accessibility-tree-helper.js, wait-helper.js）
- useBuilderStore 职责过多（状态、历史、布局、IO、子流程、变量分析）

### 1.5 架构问题

- 消息通信使用魔法字符串
- 无单元测试覆盖
- 强耦合 chrome.\* API，难以测试
- 内存泄漏风险：`__claudeElementMap` 只增不减

---

## 二、新架构设计

### 2.1 核心架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    Flow Management Layer                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ FlowStore   │  │ FlowRunner  │  │ FlowEditor  │              │
│  │ (IndexedDB) │  │ (Scheduler) │  │ (Builder)   │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                    Core Engine Layer                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ Recorder    │  │ Executor    │  │ Selector    │              │
│  │ Coordinator │  │ Engine      │  │ Engine      │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                    Action Layer                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Action Registry (命令模式 - 所有可执行操作)               │    │
│  │ click | fill | navigate | scroll | wait | assert | ...  │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                    Content Scripts Layer                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ Event       │  │ Action      │  │ Page        │              │
│  │ Capture     │  │ Executor    │  │ Inspector   │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 核心数据结构

```typescript
// 统一的 Action 定义
interface Action {
  id: string;
  type: ActionType;
  config: Record<string, unknown>;
  target?: TargetLocator;
  // 执行选项
  timeout?: number;
  retry?: RetryConfig;
  onError?: ErrorHandling;
}

// Flow 始终使用 DAG 格式
interface Flow {
  id: string;
  name: string;
  version: number;
  // 主体结构
  nodes: FlowNode[];
  edges: FlowEdge[];
  // 变量系统
  variables: Variable[];
  // 子流程
  subflows?: Record<string, Subflow>;
  // 元数据
  meta: FlowMeta;
}

// 选择器候选列表
interface TargetLocator {
  candidates: SelectorCandidate[];
  frameSelector?: string; // iframe 选择器
  recordedAttributes?: Record<string, string>; // 录制时的元素属性快照
}

interface SelectorCandidate {
  type: 'testid' | 'aria' | 'css' | 'xpath' | 'text';
  value: string;
  confidence: number; // 0-100 稳定性评分
}
```

### 2.3 模块职责

| 模块                | 职责                               | 关键文件                          |
| ------------------- | ---------------------------------- | --------------------------------- |
| RecorderCoordinator | 录制生命周期管理、状态机、DAG 构建 | `recording/coordinator.ts`        |
| EventCapture        | 页面事件捕获、事件合并             | `inject-scripts/event-capture.ts` |
| ActionComposer      | 事件到 Action 转换、fill 合并      | `recording/action-composer.ts`    |
| ExecutorEngine      | 回放调度、DAG 遍历、错误处理       | `engine/executor.ts`              |
| ActionRegistry      | Action 执行器注册表                | `actions/registry.ts`             |
| SelectorEngine      | 统一选择器生成和定位               | `selector/engine.ts`              |
| FlowStore           | 持久化、版本管理                   | `storage/flow-store.ts`           |

---

## 三、重构任务拆解

### Phase 1: 基础架构 (P0)

#### 1.1 Action 系统重构

```
目录: app/chrome-extension/entrypoints/background/record-replay/actions/
```

- [ ] 创建 `types.ts` - Action 类型定义和接口
- [ ] 创建 `registry.ts` - Action 执行器注册表（命令模式）
- [ ] 迁移现有 nodes/_ 到 actions/_，统一接口
- [ ] 添加缺失的 Action: `trigger`, `delay`, `group`, `comment`
- [ ] 每个 Action 实现 `validate()`, `execute()`, `describe()` 方法

#### 1.2 选择器引擎统一

```
目录: app/chrome-extension/shared/selector/
```

- [ ] 创建 `strategies/` - 各种选择器策略
  - `testid.ts` - data-testid, data-cy 等
  - `aria.ts` - aria-label, role
  - `css-unique.ts` - 唯一 class 组合
  - `css-path.ts` - nth-of-type 路径
  - `text.ts` - 文本内容匹配
- [ ] 创建 `generator.ts` - 统一选择器生成
- [ ] 创建 `locator.ts` - 统一元素定位
- [ ] 删除重复代码: recorder.js, accessibility-tree-helper.js, wait-helper.js

#### 1.3 数据模型统一

```
文件: app/chrome-extension/entrypoints/background/record-replay/types.ts
```

- [ ] 定义 `Action`, `Flow`, `FlowNode`, `FlowEdge` 类型
- [ ] 定义 `Variable`, `TargetLocator`, `SelectorCandidate` 类型
- [ ] 移除过时的 `Step` 类型引用
- [ ] 更新 `packages/shared/src/step-types.ts` 同步

### Phase 2: 录制系统重写 (P0)

#### 2.1 RecorderCoordinator

```
文件: app/chrome-extension/entrypoints/background/record-replay/recording/coordinator.ts
```

- [ ] 实现状态机: `idle` -> `recording` -> `paused` -> `stopping` -> `idle`
- [ ] 实现 DAGFlowBuilder - 录制时直接构建 DAG
- [ ] 实现变量收集器 - 敏感值自动变量化
- [ ] 实现 Tab 管理 - 跨标签页录制支持

#### 2.2 EventCapture 重写

```
文件: app/chrome-extension/inject-scripts/event-capture.ts
```

- [ ] 重写事件监听（使用 TypeScript）
- [ ] 实现事件缓冲区，可靠的 flush 机制
- [ ] 修复 debounce/flush 时序问题（统一为 600ms）
- [ ] 实现 contenteditable 支持
- [ ] 实现安全的跨 frame 通信（验证 origin）

#### 2.3 ActionComposer

```
文件: app/chrome-extension/entrypoints/background/record-replay/recording/action-composer.ts
```

- [ ] 实现 fill 合并逻辑（同元素连续输入合并）
- [ ] 实现 scroll 合并逻辑（同方向滚动合并）
- [ ] 实现 click/dblclick 区分逻辑
- [ ] 添加 Action 描述生成（用于 UI 显示）

#### 2.4 录制 UI 改进

```
文件: app/chrome-extension/inject-scripts/recorder-ui.ts
```

- [ ] 重写录制浮层（TypeScript）
- [ ] 添加实时步骤预览
- [ ] 添加快捷键支持（暂停/继续/停止）
- [ ] 添加元素高亮改进（显示选择器信息）

### Phase 3: 回放引擎重写 (P0)

#### 3.1 ExecutorEngine

```
文件: app/chrome-extension/entrypoints/background/record-replay/engine/executor.ts
```

- [ ] 重写 DAG 遍历逻辑，支持分支和循环
- [ ] 实现执行上下文管理（变量、帧、Tab）
- [ ] 实现执行暂停/继续/单步调试
- [ ] 实现执行状态广播（实时进度）

#### 3.2 错误处理增强

```
文件: app/chrome-extension/entrypoints/background/record-replay/engine/error-handler.ts
```

- [ ] 实现失败截图捕获
- [ ] 实现控制台日志收集
- [ ] 实现智能重试（元素不可见则等待、超时则延长）
- [ ] 实现错误恢复策略配置

#### 3.3 等待策略完善

```
文件: app/chrome-extension/entrypoints/background/record-replay/engine/wait-policy.ts
```

- [ ] 实现 `waitForSelector` 支持 iframe
- [ ] 实现 `waitForNetworkIdle` 真正的网络空闲检测
- [ ] 实现 `waitForNavigation` 可靠的导航等待
- [ ] 添加超时配置和错误信息

### Phase 4: Builder 重构 (P1)

#### 4.1 Store 拆分

```
目录: app/chrome-extension/entrypoints/popup/components/builder/store/
```

- [ ] 拆分 `useBuilderStore.ts`:
  - `useFlowStore.ts` - Flow 数据管理
  - `useEditorStore.ts` - 编辑器状态
  - `useHistoryStore.ts` - 撤销/重做
  - `useLayoutStore.ts` - 画布布局
- [ ] 修复子流程保存问题（保存前 flush 当前子流程）

#### 4.2 选择器编辑器增强

```
文件: app/chrome-extension/entrypoints/popup/components/builder/widgets/SelectorEditor.vue
```

- [ ] 显示所有候选选择器，不仅是 CSS
- [ ] 添加选择器稳定性评分显示
- [ ] 添加实时元素验证
- [ ] 支持 iframe 选择器编辑

#### 4.3 属性面板优化

```
目录: app/chrome-extension/entrypoints/popup/components/builder/components/properties/
```

- [ ] 统一属性面板组件接口
- [ ] 添加配置验证和错误提示
- [ ] 添加高级选项折叠

### Phase 5: 高级功能 (P2)

#### 5.1 变量系统

- [ ] 实现变量定义 UI
- [ ] 实现运行时变量输入
- [ ] 实现敏感变量加密存储
- [ ] 实现变量从页面提取

#### 5.2 断言系统

- [ ] 增强断言类型（存在、可见、文本、属性、样式）
- [ ] 实现断言失败详情
- [ ] 实现软断言（失败继续执行）

#### 5.3 数据提取

- [ ] 实现 CSS 选择器提取
- [ ] 实现表格数据提取
- [ ] 实现列表数据提取
- [ ] 实现数据导出（JSON/CSV）

#### 5.4 触发器系统

- [ ] 完善 URL 触发器
- [ ] 完善定时触发器
- [ ] 完善右键菜单触发器
- [ ] 添加快捷键触发器

### Phase 6: iframe 支持 (P2)

#### 6.1 iframe 录制

- [ ] 检测 iframe 并注入录制脚本
- [ ] 实现跨 frame 事件上报
- [ ] 实现复合选择器生成（frame|>element）

#### 6.2 iframe 回放

- [ ] 实现 frame 定位和切换
- [ ] 修复 wait-helper frame 支持
- [ ] 实现复合选择器解析和执行

### Phase 7: 测试和文档 (P2)

#### 7.1 单元测试

```
目录: app/chrome-extension/tests/record-replay/
```

- [ ] 创建测试设置和 Chrome API mock
- [ ] 测试 ActionComposer（fill 合并、事件转换）
- [ ] 测试 SelectorEngine（选择器生成、定位）
- [ ] 测试 ExecutorEngine（DAG 遍历、错误处理）
- [ ] 测试 RecorderCoordinator（状态机、变量收集）

#### 7.2 集成测试

- [ ] 端到端录制回放测试
- [ ] 多标签页测试
- [ ] iframe 场景测试

---

## 四、关键文件清单

### 需要删除/重写的文件

- `inject-scripts/recorder.js` → 重写为 TypeScript
- `recording/session-manager.ts` → 合并到 coordinator.ts
- `recording/flow-builder.ts` → 重写，支持 DAG
- `engine/scheduler.ts` → 重写为 executor.ts

### 需要创建的文件

```
app/chrome-extension/
├── shared/
│   └── selector/
│       ├── strategies/
│       │   ├── testid.ts
│       │   ├── aria.ts
│       │   ├── css-unique.ts
│       │   ├── css-path.ts
│       │   └── text.ts
│       ├── generator.ts
│       └── locator.ts
├── inject-scripts/
│   ├── event-capture.ts
│   └── recorder-ui.ts
└── entrypoints/background/record-replay/
    ├── actions/
    │   ├── types.ts
    │   ├── registry.ts
    │   ├── click.ts
    │   ├── fill.ts
    │   ├── navigate.ts
    │   ├── trigger.ts
    │   ├── delay.ts
    │   └── ...
    ├── recording/
    │   ├── coordinator.ts
    │   └── action-composer.ts
    ├── engine/
    │   ├── executor.ts
    │   ├── error-handler.ts
    │   └── wait-policy.ts
    └── types.ts (统一类型定义)
```

### 需要修改的文件

- `entrypoints/popup/components/builder/store/useBuilderStore.ts` - 拆分
- `entrypoints/popup/components/builder/widgets/SelectorEditor.vue` - 增强
- `common/message-types.ts` - 添加新消息类型
- `entrypoints/background/record-replay/nodes/index.ts` - 迁移到 actions/

---

## 五、验收标准

### 功能验收

- [ ] 录制后立即可回放，无需手动转换
- [ ] 敏感输入自动变量化
- [ ] 回放失败时显示截图和详细错误
- [ ] 支持暂停/继续/单步调试
- [ ] 所有 Action 类型都有执行器

### 质量验收

- [ ] 无 any 类型（除第三方库接口）
- [ ] 所有错误有明确处理和用户反馈
- [ ] 核心模块单测覆盖率 > 80%
- [ ] 通过 TypeScript 严格模式检查

### 体验验收

- [ ] 录制启动 < 500ms
- [ ] 回放单步 < 100ms（不含等待）
- [ ] 选择器定位成功率 > 95%

---

## 六、参考资源

### Automa 值得借鉴的设计

- **命令模式**: 每个 Block 独立封装，易于测试和扩展
- **策略模式**: 动态加载 handler
- **状态机模式**: WorkflowState 管理执行状态
- **错误处理**: Block 级 + 工作流级 + 重试机制
- **Block 类型定义**: 50+ 种类型，分类清晰

### 关键 Automa 文件参考

- `other/automa/src/workflowEngine/WorkflowEngine.js` - 工作流引擎
- `other/automa/src/workflowEngine/WorkflowWorker.js` - Block 执行器
- `other/automa/src/content/services/recordWorkflow/recordEvents.js` - 录制事件
- `other/automa/src/utils/shared.js` - Block 类型定义

---

## 七、Phase 1.3 P3 新增/修改文件清单

> 本次实现的 22 个 Action Handlers + Scheduler 集成架构

### 新增文件

#### Action Handlers (`actions/handlers/`)

| 文件              | 功能                                                          | 行数 |
| ----------------- | ------------------------------------------------------------- | ---- |
| `common.ts`       | 共享工具（selector转换、消息发送、元素验证、SelectorLocator） | ~250 |
| `navigate.ts`     | 页面导航                                                      | ~80  |
| `click.ts`        | 点击/双击（click, dblclick）                                  | ~180 |
| `fill.ts`         | 表单填充                                                      | ~120 |
| `wait.ts`         | 等待条件（selector/text/navigation/networkIdle/sleep）        | ~180 |
| `key.ts`          | 键盘输入（支持目标聚焦）                                      | ~100 |
| `scroll.ts`       | 滚动（offset/element/container 三种模式）                     | ~150 |
| `delay.ts`        | 延迟等待                                                      | ~40  |
| `screenshot.ts`   | 截图（全页/元素/区域）                                        | ~100 |
| `assert.ts`       | 断言（exists/visible/textPresent/attribute，支持轮询）        | ~200 |
| `extract.ts`      | 数据提取（selector/js 模式）                                  | ~180 |
| `script.ts`       | 自定义脚本（MAIN/ISOLATED world）                             | ~240 |
| `http.ts`         | HTTP 请求（GET/POST/PUT/DELETE/PATCH）                        | ~220 |
| `tabs.ts`         | 标签页（openTab/switchTab/closeTab/handleDownload）           | ~300 |
| `control-flow.ts` | 控制流（if/foreach/while/switchFrame）                        | ~380 |
| `drag.ts`         | 拖拽（start/end 目标，支持 path 坐标）                        | ~260 |
| `index.ts`        | Handler 注册入口（createReplayActionRegistry）                | ~160 |

#### Scheduler 集成

| 文件                              | 功能                                           | 行数 |
| --------------------------------- | ---------------------------------------------- | ---- |
| `actions/adapter.ts`              | Step ↔ Action 适配层（类型转换、Selector转换） | ~350 |
| `engine/execution-mode.ts`        | 执行模式配置（legacy/actions/hybrid）          | ~160 |
| `engine/runners/step-executor.ts` | 执行器抽象（Legacy/Actions/Hybrid）            | ~200 |

### 修改文件

| 文件                  | 修改内容                         |
| --------------------- | -------------------------------- |
| `actions/registry.ts` | 添加 `tryResolveValue` 别名      |
| `actions/index.ts`    | 导出 adapter 和 handler 工厂函数 |

### 文件依赖关系

```
Scheduler (scheduler.ts)
    ↓
StepRunner (step-runner.ts)
    ↓ 当前直接调用 executeStep，后续改为注入 StepExecutorInterface
StepExecutorInterface (step-executor.ts)
    ├── LegacyStepExecutor → nodes/executeStep
    ├── ActionsStepExecutor → ActionRegistry.execute()
    └── HybridStepExecutor → 先 Actions，失败回退 Legacy
                ↓
        adapter.ts (stepToAction, execCtxToActionCtx)
                ↓
        ActionRegistry (registry.ts)
                ↓
        ActionHandlers (handlers/*.ts)
```

### 类型关系

```
Legacy Step (types.ts:145)
    ↓ stepToAction() + extractParams() + convertTargetLocator()
ExecutableAction (actions/types.ts:706)
    ↓ ActionRegistry.execute()
ActionExecutionResult (actions/types.ts)
    ↓ actionResultToExecResult()
ExecResult (nodes/types.ts)
```

### Selector 转换

```
Legacy SelectorCandidate { type, value, weight? }
    ↓ convertSelectorCandidate()
Action SelectorCandidate { type, selector/xpath/text/role+name, weight? }
    ↓ toSelectorTarget() (common.ts)
SharedSelectorTarget (shared/selector/types.ts)
    ↓ selectorLocator.locate()
Located Element { ref, frameId, resolvedBy }
```
