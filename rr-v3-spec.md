# Record-Replay V3 架构规范

> 目标：超越 Automa，打造商业级录制回放产品

## 设计决策

- **无需兼容旧数据**：V3 全新格式，旧数据仅提供导入迁移工具
- **多 Run 并行**：Run Queue + maxParallelRuns，暂不做 DAG 分支并行
- **暂不做 Table**：用持久化变量（$ 前缀）替代
- **聚焦自动化场景**：优先错误处理、调试器、触发器

---

## 1. 目录结构

```
app/chrome-extension/entrypoints/background/
  record-replay-v3/
    index.ts                      # 公共 API 入口
    domain/
      json.ts                     # JsonValue 基础类型
      ids.ts                      # FlowId, NodeId, RunId, TriggerId
      errors.ts                   # RRErrorCode, RRError
      policy.ts                   # Timeout/Retry/OnError/Artifacts 策略
      variables.ts                # 变量指针, $ 持久化变量
      flow.ts                     # FlowV3, NodeV3, EdgeV3
      events.ts                   # RunEvent 事件流
      debug.ts                    # 调试器状态 + 协议
      triggers.ts                 # 触发器规范
    engine/
      kernel/
        kernel.ts                 # ExecutionKernel 接口
        runner.ts                 # RunRunner（单 Run 顺序执行器）
        traversal.ts              # Edge 解析, next-label 规则
        breakpoints.ts            # 断点管理器
      queue/
        queue.ts                  # RunQueue 接口 + 调度器
        leasing.ts                # 租约/心跳规则
      plugins/
        types.ts                  # NodeDefinition, TriggerDefinition
        registry.ts               # 插件注册表
      keepalive/
        offscreen-keepalive.ts    # Offscreen + keepalive port
      transport/
        rpc.ts                    # 类型化请求/响应
        events-bus.ts             # 事件订阅/持久化/流
    storage/
      db.ts                       # rr_v3 IndexedDB
      flows.ts                    # FlowV3 持久化
      runs.ts                     # RunRecordV3 持久化
      events.ts                   # RunEvent 分块持久化
      queue.ts                    # RunQueue 持久化
      persistent-vars.ts          # $ 变量持久化
      triggers.ts                 # 触发器持久化
      import/
        v2-reader.ts              # 读取 V2 存储
        v2-to-v3.ts               # 转换为 V3 格式

app/chrome-extension/entrypoints/offscreen/
  rr-keepalive.ts                 # 保持 Port 连接，防止 SW 挂起
```

---

## 2. 核心类型定义

### 2.1 基础类型 (`domain/json.ts`)

```typescript
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];
export type ISODateTimeString = string;
export type UnixMillis = number;
```

### 2.2 ID 类型 (`domain/ids.ts`)

```typescript
export type FlowId = string;
export type NodeId = string;
export type EdgeId = string;
export type RunId = string;
export type TriggerId = string;

export type EdgeLabel = string;
export const EDGE_LABELS = {
  DEFAULT: 'default',
  ON_ERROR: 'onError',
  TRUE: 'true',
  FALSE: 'false',
} as const;
```

### 2.3 错误码 (`domain/errors.ts`)

```typescript
export const RR_ERROR_CODES = {
  // 验证
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNSUPPORTED_NODE: 'UNSUPPORTED_NODE',
  DAG_INVALID: 'DAG_INVALID',
  DAG_CYCLE: 'DAG_CYCLE',

  // 运行时
  TIMEOUT: 'TIMEOUT',
  TAB_NOT_FOUND: 'TAB_NOT_FOUND',
  FRAME_NOT_FOUND: 'FRAME_NOT_FOUND',
  TARGET_NOT_FOUND: 'TARGET_NOT_FOUND',
  ELEMENT_NOT_VISIBLE: 'ELEMENT_NOT_VISIBLE',
  NAVIGATION_FAILED: 'NAVIGATION_FAILED',
  NETWORK_REQUEST_FAILED: 'NETWORK_REQUEST_FAILED',

  // 脚本执行
  SCRIPT_FAILED: 'SCRIPT_FAILED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  TOOL_ERROR: 'TOOL_ERROR',

  // 控制
  RUN_CANCELED: 'RUN_CANCELED',
  RUN_PAUSED: 'RUN_PAUSED',

  // 内部
  INTERNAL: 'INTERNAL',
  INVARIANT_VIOLATION: 'INVARIANT_VIOLATION',
} as const;

export type RRErrorCode = (typeof RR_ERROR_CODES)[keyof typeof RR_ERROR_CODES];

export interface RRError {
  code: RRErrorCode;
  message: string;
  data?: JsonValue;
  retryable?: boolean;
  cause?: RRError;
}
```

### 2.4 策略 (`domain/policy.ts`)

```typescript
export interface TimeoutPolicy {
  ms: UnixMillis;
  scope?: 'attempt' | 'node'; // attempt=每次尝试, node=总计
}

export interface RetryPolicy {
  retries: number;
  intervalMs: UnixMillis;
  backoff?: 'none' | 'exp' | 'linear';
  maxIntervalMs?: UnixMillis;
  jitter?: 'none' | 'full';
  retryOn?: ReadonlyArray<RRErrorCode>;
}

export type OnErrorPolicy =
  | { kind: 'stop' }
  | { kind: 'continue'; as?: 'warning' | 'error' }
  | {
      kind: 'goto';
      target: { kind: 'edgeLabel'; label: EdgeLabel } | { kind: 'node'; nodeId: NodeId };
    }
  | { kind: 'retry'; override?: Partial<RetryPolicy> };

export interface ArtifactPolicy {
  screenshot?: 'never' | 'onFailure' | 'always';
  saveScreenshotAs?: string;
  includeConsole?: boolean;
  includeNetwork?: boolean;
}

export interface NodePolicy {
  timeout?: TimeoutPolicy;
  retry?: RetryPolicy;
  onError?: OnErrorPolicy;
  artifacts?: ArtifactPolicy;
}

export interface FlowPolicy {
  defaultNodePolicy?: NodePolicy;
  unsupportedNodePolicy?: OnErrorPolicy;
  runTimeoutMs?: UnixMillis;
}
```

### 2.5 变量 (`domain/variables.ts`)

```typescript
export type VariableName = string;
export type PersistentVariableName = `$${string}`; // $ 前缀 = 持久化
export type VariableScope = 'run' | 'flow' | 'persistent';

export interface VariablePointer {
  scope: VariableScope;
  name: VariableName;
  path?: ReadonlyArray<string | number>; // JSON path
}

export interface VariableDefinition {
  name: VariableName;
  label?: string;
  description?: string;
  sensitive?: boolean;
  required?: boolean;
  default?: JsonValue;
  scope?: Exclude<VariableScope, 'persistent'>;
}
```

### 2.6 Flow IR (`domain/flow.ts`)

```typescript
export const FLOW_SCHEMA_VERSION = 3 as const;

export interface EdgeV3 {
  id: EdgeId;
  from: NodeId;
  to: NodeId;
  label?: EdgeLabel;
}

export type NodeKind = string; // 可扩展

export interface NodeV3 {
  id: NodeId;
  kind: NodeKind;
  name?: string;
  disabled?: boolean;
  policy?: NodePolicy;
  config: JsonObject;
  ui?: { x: number; y: number };
}

export interface FlowV3 {
  schemaVersion: typeof FLOW_SCHEMA_VERSION;
  id: FlowId;
  name: string;
  description?: string;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
  entryNodeId: NodeId; // 显式入口点
  nodes: NodeV3[];
  edges: EdgeV3[];
  variables?: VariableDefinition[];
  policy?: FlowPolicy;
  meta?: {
    tags?: string[];
    bindings?: Array<{ kind: 'domain' | 'path' | 'url'; value: string }>;
  };
}
```

### 2.7 事件流 (`domain/events.ts`)

```typescript
export type RunStatus = 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'canceled';

export interface EventBase {
  runId: RunId;
  ts: UnixMillis;
  seq: number; // 单调递增序列号
}

export type PauseReason =
  | { kind: 'breakpoint'; nodeId: NodeId }
  | { kind: 'step'; nodeId: NodeId }
  | { kind: 'command' }
  | { kind: 'policy'; nodeId: NodeId; reason: string };

export type RunEvent =
  // Run 生命周期
  | (EventBase & { type: 'run.queued'; flowId: FlowId })
  | (EventBase & { type: 'run.started'; flowId: FlowId })
  | (EventBase & { type: 'run.paused'; reason: PauseReason; nodeId?: NodeId })
  | (EventBase & { type: 'run.resumed' })
  | (EventBase & { type: 'run.canceled'; reason?: string })
  | (EventBase & { type: 'run.succeeded'; tookMs: number; outputs?: JsonObject })
  | (EventBase & { type: 'run.failed'; error: RRError; nodeId?: NodeId })

  // Node 执行
  | (EventBase & { type: 'node.queued'; nodeId: NodeId })
  | (EventBase & { type: 'node.started'; nodeId: NodeId; attempt: number })
  | (EventBase & {
      type: 'node.succeeded';
      nodeId: NodeId;
      tookMs: number;
      next?: { kind: 'edgeLabel'; label: EdgeLabel } | { kind: 'end' };
    })
  | (EventBase & {
      type: 'node.failed';
      nodeId: NodeId;
      attempt: number;
      error: RRError;
      decision: 'retry' | 'continue' | 'stop' | 'goto';
    })
  | (EventBase & { type: 'node.skipped'; nodeId: NodeId; reason: 'disabled' | 'unreachable' })

  // 变量 & 日志
  | (EventBase & {
      type: 'vars.patch';
      patch: Array<{ op: 'set' | 'delete'; name: string; value?: JsonValue }>;
    })
  | (EventBase & { type: 'artifact.screenshot'; nodeId: NodeId; data: string; savedAs?: string })
  | (EventBase & {
      type: 'log';
      level: 'debug' | 'info' | 'warn' | 'error';
      message: string;
      data?: JsonValue;
    });
```

---

## 3. Execution Kernel

```typescript
export interface RunStartRequest {
  runId: RunId;
  flowId: FlowId;
  flowSnapshot: FlowV3;
  args?: JsonObject;
  startNodeId?: NodeId;
  debug?: { breakpoints?: NodeId[]; pauseOnStart?: boolean };
}

export interface RunResult {
  runId: RunId;
  status: Extract<RunStatus, 'succeeded' | 'failed' | 'canceled'>;
  tookMs: number;
  error?: RRError;
  outputs?: JsonObject;
}

export interface ExecutionKernel {
  onEvent(listener: (event: RunEvent) => void): Unsubscribe;
  startRun(req: RunStartRequest): Promise<void>;
  pauseRun(runId: RunId, reason?: { kind: 'command' }): Promise<void>;
  resumeRun(runId: RunId): Promise<void>;
  cancelRun(runId: RunId, reason?: string): Promise<void>;
  debug(
    runId: RunId,
    cmd: DebuggerCommand,
  ): Promise<{ ok: true; state?: DebuggerState } | { ok: false; error: string }>;
  getRunStatus(
    runId: RunId,
  ): Promise<{
    status: RunStatus;
    currentNodeId?: NodeId;
    startedAt?: number;
    updatedAt: number;
  } | null>;
  recover(): Promise<void>;
}
```

---

## 4. Plugin API

```typescript
export interface NodeExecutionContext {
  runId: RunId;
  flow: FlowV3;
  nodeId: NodeId;
  vars: Record<string, JsonValue>;
  log: (level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: JsonValue) => void;
  chooseNext: (label: string) => { kind: 'edgeLabel'; label: string };
  artifacts: {
    screenshot: () => Promise<{ ok: true; base64: string } | { ok: false; error: RRError }>;
  };
  persistent: {
    get: (name: `$${string}`) => Promise<JsonValue | undefined>;
    set: (name: `$${string}`, value: JsonValue) => Promise<void>;
    delete: (name: `$${string}`) => Promise<void>;
  };
}

export type NodeExecutionResult =
  | {
      status: 'succeeded';
      next?: { kind: 'edgeLabel'; label: string } | { kind: 'end' };
      outputs?: JsonObject;
      varsPatch?: Array<{ op: 'set' | 'delete'; name: string; value?: JsonValue }>;
    }
  | { status: 'failed'; error: RRError };

export interface NodeDefinition<
  TKind extends NodeKind = NodeKind,
  TConfig extends JsonObject = JsonObject,
> {
  kind: TKind;
  schema: Schema<TConfig>;
  defaultPolicy?: NodePolicy;
  execute(
    ctx: NodeExecutionContext,
    node: NodeV3 & { kind: TKind; config: TConfig },
  ): Promise<NodeExecutionResult>;
}

export interface TriggerDefinition<
  TKind extends TriggerKind = TriggerKind,
  TConfig extends JsonObject = JsonObject,
> {
  kind: TKind;
  schema: Schema<TConfig>;
  install(ctx: TriggerInstallContext<TKind, TConfig>): Promise<void> | void;
  uninstall(ctx: TriggerInstallContext<TKind, TConfig>): Promise<void> | void;
}

export interface RRPlugin {
  name: string;
  register(ctx: PluginRegistrationContext): void;
}
```

---

## 5. Run Queue

```typescript
export interface RunQueueConfig {
  maxParallelRuns: number;
  leaseTtlMs: number; // e.g. 15_000
  heartbeatIntervalMs: number; // e.g. 5_000
}

export interface RunQueueItem {
  id: RunId;
  flowId: FlowId;
  status: 'queued' | 'running' | 'paused';
  createdAt: UnixMillis;
  updatedAt: UnixMillis;
  priority: number;
  attempt: number;
  maxAttempts: number;
  args?: JsonObject;
  trigger?: TriggerFireContext;
  lease?: { ownerId: string; expiresAt: UnixMillis };
  debug?: { breakpoints?: string[]; pauseOnStart?: boolean };
}

export interface RunQueue {
  enqueue(
    input: Omit<RunQueueItem, 'status' | 'createdAt' | 'updatedAt' | 'attempt' | 'lease'> & {
      id: RunId;
    },
  ): Promise<RunQueueItem>;
  claimNext(ownerId: string, now: number): Promise<RunQueueItem | null>;
  heartbeat(ownerId: string, now: number): Promise<void>;
  markRunning(runId: RunId, ownerId: string, now: number): Promise<void>;
  markPaused(runId: RunId, ownerId: string, now: number): Promise<void>;
  markDone(runId: RunId, now: number): Promise<void>;
  cancel(runId: RunId, now: number, reason?: string): Promise<void>;
  get(runId: RunId): Promise<RunQueueItem | null>;
  list(status?: RunQueueItem['status']): Promise<RunQueueItem[]>;
}
```

### Queue 状态机

```
queued → running → (paused ↔ running)* → done (succeeded/failed/canceled)

取消路径:
- queued → canceled
- running/paused → canceled

租约恢复 (SW 重启):
- lease.expiresAt < now → 回到 queued 重新执行
```

---

## 6. Debugger Protocol

```typescript
export interface Breakpoint {
  nodeId: NodeId;
  enabled: boolean;
}

export interface DebuggerState {
  runId: RunId;
  status: 'attached' | 'detached';
  execution: 'running' | 'paused';
  pauseReason?: PauseReason;
  currentNodeId?: NodeId;
  breakpoints: Breakpoint[];
  stepMode?: 'none' | 'stepOver';
}

export type DebuggerCommand =
  | { type: 'debug.attach'; runId: RunId }
  | { type: 'debug.detach'; runId: RunId }
  | { type: 'debug.pause'; runId: RunId }
  | { type: 'debug.resume'; runId: RunId }
  | { type: 'debug.stepOver'; runId: RunId }
  | { type: 'debug.setBreakpoints'; runId: RunId; nodeIds: NodeId[] }
  | { type: 'debug.addBreakpoint'; runId: RunId; nodeId: NodeId }
  | { type: 'debug.removeBreakpoint'; runId: RunId; nodeId: NodeId }
  | { type: 'debug.getState'; runId: RunId }
  | { type: 'debug.getVar'; runId: RunId; name: string }
  | { type: 'debug.setVar'; runId: RunId; name: string; value: JsonValue };
```

---

## 7. 持久化变量 ($ 前缀)

```typescript
export interface PersistentVarRecord {
  key: PersistentVariableName; // `$xxx`
  value: JsonValue;
  updatedAt: UnixMillis;
  version: number; // 单调递增，用于调试/冲突检测
}

export interface PersistentVarStore {
  get(key: PersistentVariableName): Promise<PersistentVarRecord | undefined>;
  set(key: PersistentVariableName, value: JsonValue): Promise<PersistentVarRecord>;
  delete(key: PersistentVariableName): Promise<void>;
  list(prefix?: PersistentVariableName): Promise<PersistentVarRecord[]>;
}
```

**语义**:

- 任何 `$` 开头的变量名为持久化变量
- 写入时同步持久化到 IndexedDB
- 跨 Flow、跨 Run 共享
- 并发规则：per-key last-write-wins

---

## 8. 触发器

```typescript
export type TriggerKind = 'manual' | 'url' | 'cron' | 'command' | 'contextMenu' | 'dom';

export interface TriggerSpecBase {
  id: TriggerId;
  kind: TriggerKind;
  enabled: boolean;
  flowId: FlowId;
  args?: JsonObject;
}

export type TriggerSpec =
  | (TriggerSpecBase & { kind: 'manual' })
  | (TriggerSpecBase & {
      kind: 'url';
      match: Array<{ kind: 'url' | 'domain' | 'path'; value: string }>;
    })
  | (TriggerSpecBase & { kind: 'cron'; cron: string; timezone?: string })
  | (TriggerSpecBase & { kind: 'command'; commandKey: string })
  | (TriggerSpecBase & {
      kind: 'contextMenu';
      title: string;
      contexts?: chrome.contextMenus.ContextType[];
    })
  | (TriggerSpecBase & {
      kind: 'dom';
      selector: string;
      appear?: boolean;
      once?: boolean;
      debounceMs?: UnixMillis;
    });
```

---

## 9. MV3 约束处理

### Service Worker 挂起问题

- 创建 Offscreen Document 作为 keep-alive anchor
- Offscreen 打开长连接 `chrome.runtime.Port` 到 background
- 只要有 running/paused 的 Run，就保持 Offscreen 存活

### 崩溃恢复

- Run/Event/Queue 状态持久化到 IndexedDB
- SW 重启后调用 `kernel.recover()` 恢复执行

---

## 10. 实施路线

| Phase | 时长   | 内容                                        | 验收标准                    |
| ----- | ------ | ------------------------------------------- | --------------------------- |
| 0     | 1 周   | 目录骨架 + 类型定义 + 空实现                | 编译通过，现有测试不破坏    |
| 1     | 2-3 周 | Kernel（顺序执行）+ 事件流 + 节点级 onError | contract tests 覆盖错误策略 |
| 2     | 2 周   | 调试器 MVP（断点/暂停/stepOver/varsDiff）   | 可断点单步，状态可恢复      |
| 3     | 2-4 周 | Run Queue + maxParallelRuns + 租约          | 多 Run 并行，确定性测试     |
| 4     | 3 周   | 触发器（cron/url/command/contextMenu）      | 触发器安装/卸载正确         |
| 5     | 3 周   | Recorder V3（TS 化 + top 聚合）             | 录制→回放全链路稳定         |

---

_最后更新: 2025-12_
