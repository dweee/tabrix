# Record-Replay V3 详细任务拆解

> 总估算：约 762 工时（13-16 周多人并行）

## 约定

- 估算为工程工时（h），默认 1 名熟练 TS 工程师
- Lane：A=Domain/Types，B=Storage，C=Kernel/Engine，D=Transport，E=UI，F=Triggers，G=Recorder，T=Tests
- 可并行：不同 Lane 可并行；同 Lane 默认串行

## 单测要求

### 必须单测的模块

| 模块                             | 测试文件                  | 覆盖要求                            |
| -------------------------------- | ------------------------- | ----------------------------------- |
| **domain/errors.ts**             | `errors.test.ts`          | 错误码枚举完整性、RRError 序列化    |
| **domain/policy.ts**             | `policy.test.ts`          | policy merge 逻辑、默认值填充       |
| **domain/variables.ts**          | `variables.test.ts`       | VariablePointer 解析、$ 前缀检测    |
| **storage/flows.ts**             | `flows.test.ts`           | CRUD、schema 校验、版本迁移         |
| **storage/runs.ts**              | `runs.test.ts`            | 状态转换、摘要更新                  |
| **storage/events.ts**            | `events.test.ts`          | 分块存储、seq 连续性、按 runId 查询 |
| **storage/queue.ts**             | `queue.test.ts`           | enqueue/claim/lease、原子性         |
| **storage/persistent-vars.ts**   | `persistent-vars.test.ts` | get/set/delete、LWW 并发            |
| **engine/kernel/traversal.ts**   | `traversal.test.ts`       | DAG 校验、cycle 检测、edge 选择     |
| **engine/kernel/runner.ts**      | `runner.test.ts`          | 节点执行、事件序列、错误处理        |
| **engine/kernel/breakpoints.ts** | `breakpoints.test.ts`     | add/remove/hit 检测                 |
| **engine/queue/leasing.ts**      | `leasing.test.ts`         | 续约、过期、回收                    |
| **engine/queue/scheduler.ts**    | `scheduler.test.ts`       | maxParallelRuns、优先级、FIFO       |
| **engine/plugins/registry.ts**   | `registry.test.ts`        | 注册/覆盖/查询、未注册错误          |
| **engine/triggers/\*.ts**        | `triggers/*.test.ts`      | 各触发器安装/卸载/触发              |
| **recording/flow-builder.ts**    | `flow-builder.test.ts`    | 事件→节点转换、DAG 构建             |
| **recorder/batching.ts**         | `batching.test.ts`        | debounce、flush、合并逻辑           |
| **recorder/iframe-bridge.ts**    | `iframe-bridge.test.ts`   | 消息转发、聚合                      |

### 测试原则

1. **纯逻辑优先**：domain 和 engine 核心逻辑必须可单测（不依赖 chrome API）
2. **Mock 边界清晰**：storage 层 mock IndexedDB，transport 层 mock chrome.runtime
3. **契约测试**：跨模块接口用契约测试验证
4. **覆盖率目标**：核心模块 > 80%，工具函数 > 90%

---

## Phase 0（1周）：目录骨架 + 类型定义

| ID    | 任务                          | 文件                                                                                   | 依赖     | 估算 | Lane | 可并行 | 验收标准                       |
| ----- | ----------------------------- | -------------------------------------------------------------------------------------- | -------- | ---: | ---- | ------ | ------------------------------ |
| P0-01 | 创建 V3 目录骨架              | `record-replay-v3/**`、`index.ts`                                                      | -        |   3h | A    | ✅     | 目录结构与 spec 一致；编译通过 |
| P0-02 | 实现 domain 类型              | `domain/{json,ids,errors,policy,variables,flow,events,debug,triggers}.ts`              | P0-01    |   8h | A    | ✅     | 类型与 spec 一致；无 any 泄漏  |
| P0-03 | 实现 engine 接口（空实现）    | `engine/kernel/*`、`engine/queue/*`、`engine/plugins/*`                                | P0-02    |   8h | C    | ✅     | 接口与 spec 一致；编译通过     |
| P0-04 | 实现 transport/keepalive 接口 | `engine/transport/*`、`engine/keepalive/*`                                             | P0-02    |   6h | D    | ✅     | 类型齐全；编译通过             |
| P0-05 | 实现 storage 接口（空实现）   | `storage/{db,flows,runs,events,queue,persistent-vars,triggers}.ts`、`storage/import/*` | P0-02    |  10h | B    | ✅     | 可 import；抛 NotImplemented   |
| P0-06 | Offscreen keepalive 占位      | `entrypoints/offscreen/rr-keepalive.ts`                                                | P0-01    |   2h | D    | ✅     | 不改变现有行为；编译通过       |
| P0-07 | V3 smoke 测试                 | `tests/record-replay-v3/spec-smoke.test.ts`                                            | P0-02    |   2h | T    | ✅     | 验证常量/类型可用              |
| P0-08 | 确保现有功能不破坏            | 不修改 V2 wiring                                                                       | P0-01~07 |   3h | T    | ❌     | 编译+测试通过；V2 无变更       |

**Phase 0 总计：42h**

---

## Phase 1（2-3周）：Kernel + 事件流 + onError

| ID    | 任务                 | 文件                                                                                      | 依赖                | 估算 | Lane | 可并行 | 验收标准                                                   |
| ----- | -------------------- | ----------------------------------------------------------------------------------------- | ------------------- | ---: | ---- | ------ | ---------------------------------------------------------- |
| P1-01 | V3 IndexedDB schema  | `storage/db.ts`                                                                           | P0-05               |  10h | B    | ✅     | stores 创建成功；不影响 V2                                 |
| P1-02 | FlowV3 持久化 CRUD   | `storage/flows.ts`                                                                        | P1-01               |   6h | B    | ✅     | save/get/list/delete 可用；**单测覆盖 CRUD + schema 校验** |
| P1-03 | RunRecordV3 持久化   | `storage/runs.ts`                                                                         | P1-01               |   8h | B    | ✅     | 状态更新可持久化；**单测覆盖状态转换**                     |
| P1-04 | RunEvent 分块落库    | `storage/events.ts`                                                                       | P1-01               |  10h | B    | ✅     | append 不丢事件；seq 连续；**单测覆盖分块+查询**           |
| P1-05 | PersistentVarStore   | `storage/persistent-vars.ts`                                                              | P1-01               |  10h | B    | ✅     | get/set/delete/list；LWW；**单测覆盖并发写入**             |
| P1-06 | RunQueue 基础持久化  | `storage/queue.ts`、`engine/queue/queue.ts`                                               | P1-01               |   8h | B    | ✅     | enqueue/list/get；状态更新；**单测覆盖队列操作**           |
| P1-07 | PluginRegistry       | `engine/plugins/registry.ts`                                                              | P0-03               |   6h | C    | ✅     | 注册/查询 NodeDefinition；**单测覆盖注册/覆盖/未注册错误** |
| P1-08 | DAG 校验 + traversal | `engine/kernel/traversal.ts`                                                              | P0-03               |   8h | C    | ✅     | cycle/invalid 检测；**单测覆盖各种 DAG 结构**              |
| P1-09 | EventsBus            | `engine/transport/events-bus.ts`                                                          | P1-03, P1-04        |  10h | D    | ✅     | 事件订阅+落库；**单测覆盖订阅/广播/持久化**                |
| P1-10 | Kernel 核心执行      | `engine/kernel/runner.ts`、`kernel.ts`                                                    | P1-07~09, P1-05     |  24h | C    | ❌     | 单 Run 顺序执行；事件序列正确；**单测覆盖执行流程**        |
| P1-11 | onError 策略         | `engine/kernel/runner.ts`、`policy.ts`                                                    | P1-10               |  20h | C    | ❌     | retry/continue/stop/goto；**单测覆盖所有错误策略**         |
| P1-12 | artifacts 接口       | `engine/kernel/artifacts.ts`                                                              | P1-10               |   6h | C    | ✅     | 截图占位；不阻塞执行                                       |
| P1-13 | V3 contract tests    | `tests/record-replay-v3/{kernel-onerror,events-persist,persistent-vars}.contract.test.ts` | P1-05, P1-09, P1-11 |  18h | T    | ✅     | 覆盖关键策略与落库一致性                                   |
| P1-14 | 最小 V3 API          | `engine/transport/rpc.ts`、`index.ts`                                                     | P1-09               |   8h | D    | ✅     | listRuns/getEvents 可用                                    |

**Phase 1 总计：152h**

---

## Phase 2（2周）：调试器 MVP

| ID    | 任务                    | 文件                                                                          | 依赖         | 估算 | Lane | 可并行 | 验收标准                                             |
| ----- | ----------------------- | ----------------------------------------------------------------------------- | ------------ | ---: | ---- | ------ | ---------------------------------------------------- |
| P2-01 | BreakpointManager       | `engine/kernel/breakpoints.ts`                                                | P1-10        |   6h | C    | ✅     | add/remove/set；命中触发 pause；**单测覆盖断点管理** |
| P2-02 | pause/resume/stepOver   | `engine/kernel/runner.ts`、`kernel.ts`                                        | P2-01        |  18h | C    | ❌     | 断点暂停；stepOver 单步；**单测覆盖状态转换**        |
| P2-03 | DebuggerCommand 路由    | `engine/kernel/kernel.ts`、`debug-controller.ts`                              | P2-02        |  10h | C    | ✅     | attach/detach/getState；**单测覆盖命令路由**         |
| P2-04 | 变量查看/修改           | `engine/kernel/kernel.ts`                                                     | P2-03, P1-05 |  10h | C    | ✅     | getVar/setVar；$ 变量落库；**单测覆盖变量读写**      |
| P2-05 | Debugger Port + RPC     | `engine/transport/rpc.ts`、`debug-port.ts`                                    | P2-03        |  12h | D    | ✅     | UI 连接收事件流                                      |
| P2-06 | Debug UI MVP            | `sidepanel/components/rr-v3/DebuggerPanel.vue`                                | P2-05        |  18h | E    | ✅     | 事件流展示；控制按钮                                 |
| P2-07 | Debugger contract tests | `tests/record-replay-v3/{debugger-breakpoint,debugger-vars}.contract.test.ts` | P2-04        |  12h | T    | ✅     | 断点/stepOver/vars 契约测试                          |
| P2-08 | 手工验收清单            | `docs/rr-v3-debugger-mvp-checklist.md`                                        | P2-06        |   4h | T    | ✅     | 可复现步骤文档                                       |

**Phase 2 总计：90h**

---

## Phase 3（2-4周）：Run Queue + 多 Run 并行

| ID    | 任务                     | 文件                                                        | 依赖         | 估算 | Lane | 可并行 | 验收标准                                          |
| ----- | ------------------------ | ----------------------------------------------------------- | ------------ | ---: | ---- | ------ | ------------------------------------------------- |
| P3-01 | Queue 存储模型升级       | `storage/db.ts`、`storage/queue.ts`                         | P1-06        |  10h | B    | ✅     | lease 字段可查询                                  |
| P3-02 | claimNext 原子领取       | `storage/queue.ts`                                          | P3-01        |  16h | B    | ❌     | 不会双领取；优先级+FIFO；**单测覆盖原子性**       |
| P3-03 | 租约续约与回收           | `engine/queue/leasing.ts`、`queue.ts`                       | P3-02        |  12h | C    | ✅     | heartbeat 续约；过期回收；**单测覆盖续约/过期**   |
| P3-04 | maxParallelRuns 调度器   | `engine/queue/scheduler.ts`、`index.ts`                     | P3-02, P1-10 |  18h | C    | ❌     | 并行数不超限；自动拉起；**单测覆盖调度逻辑**      |
| P3-05 | Offscreen keepalive 接入 | `engine/keepalive/*`、`offscreen/main.ts`                   | P0-06, P3-04 |  16h | D    | ✅     | 有任务时 offscreen 存活                           |
| P3-06 | 崩溃恢复                 | `engine/queue/recovery.ts`、`kernel.ts:recover()`           | P3-03        |  14h | C    | ✅     | 超时后回 queued；重启可调度；**单测覆盖恢复流程** |
| P3-07 | 并行调度集成测试         | `tests/record-replay-v3/queue-parallel.integration.test.ts` | P3-04        |  16h | T    | ✅     | maxParallelRuns 生效；确定性测试                  |
| P3-08 | V3 run API               | `engine/transport/rpc.ts`、`index.ts`                       | P3-04        |   8h | D    | ✅     | enqueueRun/listRuns/listQueue                     |

**Phase 3 总计：110h**

---

## Phase 4（3周）：触发器系统

| ID    | 任务                | 文件                                                     | 依赖         | 估算 | Lane | 可并行 | 验收标准                                                  |
| ----- | ------------------- | -------------------------------------------------------- | ------------ | ---: | ---- | ------ | --------------------------------------------------------- |
| P4-01 | TriggerStore CRUD   | `storage/triggers.ts`                                    | P1-01        |   8h | B    | ✅     | save/get/list/delete；**单测覆盖 CRUD + schema 校验**     |
| P4-02 | TriggerManager      | `engine/triggers/trigger-manager.ts`                     | P4-01, P3-08 |  14h | F    | ❌     | 加载/安装/卸载/刷新；**单测覆盖生命周期**                 |
| P4-03 | URL trigger         | `engine/triggers/url-trigger.ts`                         | P4-02        |  12h | F    | ✅     | webNavigation 匹配→enqueue；**单测覆盖匹配规则**          |
| P4-04 | Command trigger     | `engine/triggers/command-trigger.ts`                     | P4-02        |  10h | F    | ✅     | 快捷键→enqueue；**单测覆盖命令绑定**                      |
| P4-05 | ContextMenu trigger | `engine/triggers/contextmenu-trigger.ts`                 | P4-02        |  10h | F    | ✅     | 右键菜单→enqueue；**单测覆盖菜单创建/清理**               |
| P4-06 | DOM trigger         | `engine/triggers/dom-trigger.ts`                         | P4-02        |  18h | F    | ❌     | 元素出现→enqueue；**单测覆盖 selector 匹配**              |
| P4-07 | Cron trigger        | `engine/triggers/cron-trigger.ts`                        | P4-02        |  20h | F    | ❌     | cron→alarm→enqueue；**单测覆盖 cron 解析 + 下次触发计算** |
| P4-08 | 防抖/防风暴         | `engine/triggers/trigger-manager.ts`、`storage/queue.ts` | P4-03~07     |  10h | F    | ✅     | cooldown；队列不爆炸；**单测覆盖防抖逻辑**                |
| P4-09 | 触发器管理 API      | `engine/transport/rpc.ts`、`index.ts`                    | P4-02        |  10h | D    | ✅     | list/save/delete/refresh                                  |
| P4-10 | Trigger tests       | `tests/record-replay-v3/triggers/*.test.ts`              | P4-03~07     |  20h | T    | ✅     | 覆盖各触发器类型；mock chrome API                         |

**Phase 4 总计：132h**

---

## Phase 5（3周）：Recorder V3

| ID    | 任务                    | 文件                                                                                   | 依赖         | 估算 | Lane | 可并行 | 验收标准                                                   |
| ----- | ----------------------- | -------------------------------------------------------------------------------------- | ------------ | ---: | ---- | ------ | ---------------------------------------------------------- |
| P5-01 | TS 构建方案决策         | `docs/rr-v3-recorder-build.md`                                                         | -            |   8h | G    | ✅     | 选型确认                                                   |
| P5-02 | TS→单文件 JS 构建       | `inject-scripts-src/recorder/*`、`wxt.config.ts`                                       | P5-01        |  18h | G    | ❌     | recorder.js 可注入                                         |
| P5-03 | Recorder 模块骨架       | `inject-scripts-src/recorder/{bootstrap,protocol,state}.ts`                            | P5-02        |  10h | G    | ✅     | ping/control 可响应；**单测覆盖状态机**                    |
| P5-04 | selector 复用           | `inject-scripts-src/recorder/selector.ts`                                              | P5-03        |  12h | G    | ✅     | candidates+fingerprint；**单测覆盖选择器生成**             |
| P5-05 | 事件捕获模块化          | `inject-scripts-src/recorder/events/{click,input,key,scroll,drag}.ts`                  | P5-04        |  40h | G    | ✅     | 稳定 payload；debounce；**单测覆盖各事件类型**             |
| P5-06 | batching + stop barrier | `inject-scripts-src/recorder/batching.ts`                                              | P5-05        |  20h | G    | ❌     | stop 必 flush；ack stats；**单测覆盖 debounce/flush/合并** |
| P5-07 | top 聚合模式            | `inject-scripts-src/recorder/iframe-bridge.ts`                                         | P5-05        |  22h | G    | ❌     | subframe→top→background；**单测覆盖消息转发**              |
| P5-08 | Recorder overlay        | `inject-scripts-src/recorder/overlay/*`                                                | P5-03        |  18h | G    | ✅     | 状态显示；控制按钮                                         |
| P5-09 | V3 RecordingSession     | `record-replay-v3/recording/{session-manager,flow-builder,content-message-handler}.ts` | P1-02, P5-06 |  24h | C    | ❌     | 事件→FlowV3 DAG；**单测覆盖 DAG 构建**                     |
| P5-10 | V3 RecorderManager      | `record-replay-v3/recording/{recorder-manager,content-injection}.ts`                   | P5-09        |  20h | C    | ❌     | 注入/广播/stop barrier；**单测覆盖生命周期**               |
| P5-11 | V3 录制 API + UI        | `record-replay-v3/index.ts`、UI 入口                                                   | P5-10        |  14h | E    | ✅     | start/stop/pause/resume                                    |
| P5-12 | Recorder 测试           | `tests/record-replay-v3/recorder/*.test.ts`                                            | P5-06, P5-09 |  24h | T    | ✅     | debounce/flush/ack/bridge 契约测试                         |
| P5-13 | 手工回归清单            | `docs/rr-v3-recorder-qa-checklist.md`                                                  | P5-11        |   6h | T    | ✅     | 10+ 场景验收                                               |

**Phase 5 总计：236h**

---

## 总工时汇总

| Phase    | 工时     | 周数（40h/周） |
| -------- | -------- | -------------- |
| Phase 0  | 42h      | ~1 周          |
| Phase 1  | 152h     | ~4 周          |
| Phase 2  | 90h      | ~2 周          |
| Phase 3  | 110h     | ~3 周          |
| Phase 4  | 132h     | ~3 周          |
| Phase 5  | 236h     | ~6 周          |
| **总计** | **762h** | **~19 周**     |

> 注：多人并行可压缩到 13-16 周

---

## 依赖关系图

```
Phase 0 ──→ Phase 1 ──→ Phase 2
                │
                ├──→ Phase 3 ──→ Phase 4
                │
                └──→ Phase 5 (可与 Phase 4 部分并行)
```

---

## 关键里程碑

| 里程碑            | 完成标志                         | Phase |
| ----------------- | -------------------------------- | ----- |
| M1: 类型系统就绪  | V3 类型编译通过，现有测试不破坏  | P0    |
| M2: 单 Run 可执行 | 能执行简单 flow，事件落库        | P1    |
| M3: 可调试        | 断点、单步、变量查看可用         | P2    |
| M4: 多 Run 并行   | maxParallelRuns 生效，崩溃可恢复 | P3    |
| M5: 触发器完整    | 5 种触发器可用                   | P4    |
| M6: 录制 V3       | TS 录制器，录制→保存→回放全链路  | P5    |

---

## 实施进度记录

### Phase 0 ✅ 已完成

| ID    | 状态 | 完成时间   | 备注                     |
| ----- | ---- | ---------- | ------------------------ |
| P0-01 | ✅   | 2025-12-27 | 目录骨架创建完成         |
| P0-02 | ✅   | 2025-12-27 | domain 类型全部实现      |
| P0-03 | ✅   | 2025-12-27 | engine 接口空实现        |
| P0-04 | ✅   | 2025-12-27 | transport/keepalive 接口 |
| P0-05 | ✅   | 2025-12-27 | storage 接口空实现       |
| P0-06 | ✅   | 2025-12-27 | Offscreen keepalive 占位 |
| P0-07 | ✅   | 2025-12-27 | 26 个 smoke 测试通过     |
| P0-08 | ✅   | 2025-12-27 | V2 功能未受影响          |

### Phase 1 🔄 进行中

| ID    | 状态 | 完成时间   | 备注                                          |
| ----- | ---- | ---------- | --------------------------------------------- |
| P1-01 | ✅   | 2025-12-27 | IndexedDB schema 含 Phase 3 索引              |
| P1-02 | ✅   | 2025-12-27 | FlowsStore CRUD 实现                          |
| P1-03 | ✅   | 2025-12-27 | RunsStore 实现                                |
| P1-04 | ✅   | 2025-12-27 | EventsStore 原子 seq 分配实现                 |
| P1-05 | ✅   | 2025-12-27 | PersistentVarsStore 实现                      |
| P1-06 | ✅   | 2025-12-27 | RunQueue 基础实现                             |
| P1-07 | ✅   | 2025-12-27 | PluginRegistry 实现                           |
| P1-08 | ✅   | 2025-12-27 | DAG 校验 + traversal 实现                     |
| P1-09 | ✅   | 2025-12-27 | StorageBackedEventsBus 实现                   |
| P1-10 | ✅   | 2025-12-27 | StorageBackedRunRunner 核心执行循环实现       |
| P1-11 | ✅   | 2025-12-27 | onError 策略完整实现 + 8个契约测试            |
| P1-12 | ✅   | 2025-12-27 | createChromeArtifactService 实现              |
| P1-13 | ✅   | 2025-12-27 | 契约测试完成 (Events 13个 + onError 8个)      |
| P1-14 | ✅   | 2025-12-27 | RpcServer 实现 (listRuns/getEvents/subscribe) |

**当前测试状态**: 47 个测试全部通过

**关键实现**:

- `EventsStore.append()` 原子 seq 分配（单事务 runs+events）
- `StorageBackedEventsBus` 广播在 commit 后发生
- `StorageBackedRunRunner` 核心执行循环
  - DAG 遍历执行
  - 状态持久化 (RunRecordV3)
  - pause/resume/cancel
  - 断点支持 (BreakpointManager)
  - SerialQueue 保证事件顺序
  - onError: stop/continue/goto/retry
- `createChromeArtifactService` - 基于 chrome.tabs.captureVisibleTab
- `RpcServer` - Port RPC 服务端
  - listRuns/getRun/getEvents/getFlow/listFlows
  - subscribe/unsubscribe 事件订阅

### Phase 2 ✅ 已完成

| ID    | 状态 | 完成时间   | 备注                                                    |
| ----- | ---- | ---------- | ------------------------------------------------------- |
| P2-01 | ✅   | 2025-12-27 | BreakpointManager 已在 Phase 1 实现                     |
| P2-02 | ✅   | 2025-12-27 | pause/resume/stepOver 通过 DebugController              |
| P2-03 | ✅   | 2025-12-27 | DebugController 命令路由完成                            |
| P2-04 | ✅   | 2025-12-27 | 变量查看/修改（getVar/setVar + 事件回放兜底）           |
| P2-05 | ✅   | 2025-12-27 | RpcServer 集成 DebugController                          |
| P2-06 | ✅   | 2025-12-27 | Debug UI MVP 完成                                       |
| P2-07 | ✅   | 2025-12-27 | 9 个 Debugger 契约测试通过                              |
| P2-08 | ✅   | 2025-12-27 | 手工验收清单完成 (docs/rr-v3-debugger-mvp-checklist.md) |

**当前测试状态**: 56 个测试全部通过

**Phase 2 关键实现**:

- `DebugController` - 调试器控制面单一入口
  - attach/detach 连接管理
  - pause/resume/stepOver 执行控制
  - setBreakpoints/add/remove 断点管理
  - getVar/setVar 变量操作（支持事件回放兜底）
  - getState 状态查询
  - subscribe 状态订阅
- `RunnerRegistry` - 活跃 Runner 管理
- `RpcServer` 集成 - `rr_v3.debug` 方法路由到 DebugController
- **UI Composables (2025-12-27 新增)**:
  - `useRRV3Rpc` - Port-RPC 客户端
    - chrome.runtime.Port 连接管理
    - request/response RPC (超时/取消)
    - 事件流订阅
    - 自动重连 + 订阅恢复
  - `useRRV3Debugger` - 调试器状态管理
    - DebuggerCommand 封装
    - DebuggerState 响应式维护
    - autoRefreshOnEvents 自动刷新
- **DebuggerPanel.vue** - Debug UI MVP
  - 连接状态显示 + 重连按钮
  - DebuggerState 实时显示
  - 调试控制按钮 (Attach/Detach/Pause/Resume/StepOver)
  - 断点列表展示
  - 自动订阅/取消订阅事件流
- **手工验收清单** - `docs/rr-v3-debugger-mvp-checklist.md`
  - 9 大测试类别，30+ 测试用例
  - Port-RPC 控制台辅助脚本
  - 覆盖: Transport, UI, Attach/Detach, Pause/Resume, StepOver, Breakpoints, Variables, Reconnect, Edge Cases

### Phase 3 ✅ 已完成

| ID    | 状态 | 完成时间   | 备注                                 |
| ----- | ---- | ---------- | ------------------------------------ |
| P3-01 | ✅   | 2025-12-27 | Queue 存储模型已在 Phase 1 预先完成  |
| P3-02 | ✅   | 2025-12-27 | claimNext 原子领取 + 23个契约测试    |
| P3-03 | ✅   | 2025-12-27 | 租约续约与回收 + 10个契约测试        |
| P3-04 | ✅   | 2025-12-27 | maxParallelRuns 调度器 + 9个单元测试 |
| P3-05 | ✅   | 2025-12-27 | Offscreen keepalive 接入             |
| P3-06 | ✅   | 2025-12-28 | 崩溃恢复 + 13个单元测试              |
| P3-07 | ✅   | 2025-12-28 | 并行调度集成测试 + 13个集成测试      |
| P3-08 | ✅   | 2025-12-27 | V3 run API + 16个单元测试            |

**当前测试状态**: 140 个测试全部通过

**P3-02 关键实现**:

- `claimNext()` 原子领取实现
  - 两步游标方案：step1 (prev) 找最高优先级，step2 (next) 找 FIFO
  - 同一 readwrite 事务保证原子性（IndexedDB 串行化）
  - IDBKeyRange.bound 使用 ±MAX_VALUE 覆盖完整数值范围
  - 输入校验：ownerId 必填，now 必须有限
- 23 个契约测试覆盖
  - Basic CRUD (5 tests)
  - Atomic claimNext (11 tests): 空队列、优先级排序、FIFO、原子更新、持久化、并发唯一性
  - Status transitions (6 tests)
  - Priority edge cases (2 tests): 负数、MAX_SAFE_INTEGER

**P3-03 关键实现**:

- `heartbeat()` 租约续约
  - 续约 running + paused 状态（paused 也需要，避免调试时被 TTL 回收）
  - 使用 status 索引 + cursor 迭代
  - 只续约 ownerId 匹配的项
- `reclaimExpiredLeases()` 过期回收
  - 使用 lease_expiresAt 索引高效扫描
  - IDBKeyRange.upperBound(now, true) 实现 strictly < now
  - 过期的 running/paused → queued，清除 lease
  - 保留 attempt 计数（不清零）
- `LeaseManager` 更新：委托给 queue.reclaimExpiredLeases()
- 10 个契约测试覆盖
  - Heartbeat (4 tests): 续约、无项、无效输入
  - Reclamation (6 tests): 过期回收、边界条件、多项回收、闭环验证

**P3-04 关键实现**:

- `createRunScheduler()` 调度器工厂
  - kick + polling 混合策略（低延迟 + 兜底）
  - 内存中 activeRunIds Set 跟踪并行执行
  - re-entrancy 控制（pendingKick + pumpPromise）
  - 周期性 reclaimExpiredLeases 回收过期租约
  - 依赖注入支持测试（queue, leaseManager, execute）
  - stop 安全保护（防止 stop 后继续 claim）
- 9 个单元测试覆盖
  - maxParallelRuns enforcement (3 tests)
  - Lease reclamation interval (2 tests)
  - Error handling (2 tests)
  - State inspection (2 tests)

**P3-08 关键实现**:

- `rr_v3.enqueueRun` API
  - 参数校验：flowId 必填，priority/maxAttempts 有限数值校验
  - 创建 RunRecordV3 并持久化
  - 入队到 RunQueue
  - 通过 EventsBus 发布 run.queued 事件（确保 UI 广播）
  - 触发 scheduler.kick() 启动调度
  - 返回 { runId, position }（position 按调度顺序计算）
- `rr_v3.listQueue` API
  - 可选 status 过滤（白名单校验：queued/running/paused）
  - 按 priority DESC + createdAt ASC 排序
- `rr_v3.cancelQueueItem` API
  - 仅允许取消 queued 状态（running/paused 需用 cancelRun）
  - 从队列移除 + 更新 Run 状态为 canceled
  - 通过 EventsBus 发布 run.canceled 事件
- 16 个单元测试覆盖
  - enqueueRun (8 tests): 完整流程、参数校验、NaN/Infinity 拒绝、maxAttempts >= 1
  - listQueue (3 tests): 排序、过滤、无效 status 拒绝
  - cancelQueueItem (5 tests): 完整流程、状态限制、reason 传递

**P3-05 关键实现**:

- 架构设计（解决 MV3 SW 30s 空闲终止问题）
  - **Offscreen 主动连接**：Offscreen Document 使用 `chrome.runtime.connect()` 连接到 Background
  - **Offscreen 发起心跳**：Offscreen 定时发送 `keepalive.ping`，Background 响应 `pong`
  - **Background 控制**：通过 `keepalive.start/stop` 命令控制 Offscreen 的心跳循环
- 协议常量下沉到 `common/rr-v3-keepalive-protocol.ts`，避免层级倒挂
- `OffscreenKeepaliveController` 实现
  - 引用计数机制（acquire/release）
  - 第一次 acquire 时创建 Offscreen 并注册连接监听
  - syncPromise 串行化避免竞态
  - 不主动关闭 Offscreen（避免影响其他模块如语义相似度引擎）
- Scheduler 集成：`start()` 时 acquire，`stop()` 时 release

**P3-06 关键实现**:

- `run.recovered` 事件类型
  - `reason`: `sw_restart` | `lease_expired`
  - `fromStatus`: 恢复前状态 (`running` | `paused`)
  - `toStatus`: 恢复后状态 (`queued`)
  - `prevOwnerId`: 原 ownerId（用于审计）
- `recoverOrphanLeases(ownerId, now)` 队列方法
  - 扫描所有 running/paused 项
  - 孤儿判定：无 lease 或 `lease.ownerId !== currentOwnerId`
  - 孤儿 running：回收为 queued，清除 lease，保留 attempt
  - 孤儿 paused：接管 lease（更新 ownerId + 续约 TTL），保持 paused 状态
  - 单一 readwrite 事务，原子性保证
- `RecoveryCoordinator` 恢复协调器
  - Step 1: 预清理（清除已终态或无 RunRecord 的队列项）
  - Step 2: `recoverOrphanLeases()` 回收/接管孤儿租约（best-effort）
  - Step 3: 同步 requeued running 的 RunRecord + 发送 `run.recovered` 事件
  - Step 4: 同步 adopted paused 的 RunRecord
  - 全程 best-effort，不阻止 SW 启动
- `RecoveryEnabledKernel` 支持恢复的 Kernel 实现
  - `recover()` 委托给 RecoveryCoordinator
  - `getRunStatus()` 查询 RunRecord
- 13 个单元测试覆盖
  - Queue-level (6 tests): requeue/adopt、ownerId 匹配跳过、无 lease、attempt 保留、参数校验
  - Coordinator-level (7 tests): requeue 发事件、adopt 不发事件、清理终态、清理无 RunRecord、混合场景、参数校验

**P3-07 关键实现**:

- 端到端调度测试 (4 tests)
  - scheduler claims from real queue, executes, and marks done
  - respects maxParallelRuns with real queue
  - maintains FIFO within same priority
  - higher priority runs first
- 租约管理测试 (2 tests)
  - heartbeat keeps leases alive during long runs
  - expired leases are reclaimed by periodic scan
- 崩溃恢复模拟 (5 tests)
  - recovers orphan running items after restart
  - adopts orphan paused items after restart
  - preserves attempt count across recovery
  - cleans terminal runs left in queue due to crash
  - recovery then scheduler works correctly
- 并发测试 (2 tests)
  - handles multiple concurrent enqueue/claim cycles
  - no double execution under concurrent kicks

---

## 里程碑状态

| 里程碑            | 状态 | 完成标志                                          |
| ----------------- | ---- | ------------------------------------------------- |
| M1: 类型系统就绪  | ✅   | V3 类型编译通过，现有测试不破坏                   |
| M2: 单 Run 可执行 | ✅   | 能执行简单 flow，事件落库                         |
| M3: 可调试        | ✅   | 断点、单步、变量查看可用                          |
| M4: 多 Run 并行   | ✅   | maxParallelRuns 生效，崩溃可恢复                  |
| M5: 触发器完整    | 🔄   | 5 种触发器可用（已完成 4 种，DOM trigger 待完成） |
| M6: 录制 V3       | ⏳   | TS 录制器，录制→保存→回放全链路                   |
| **M7: UI 集成**   | 🔄   | WorkflowsView V3 ✅，Builder V3 重构待开始        |

---

## Phase 4 🔄 进行中

| ID    | 状态 | 完成时间   | 备注                         |
| ----- | ---- | ---------- | ---------------------------- |
| P4-01 | ✅   | 2025-12-28 | TriggerStore CRUD + 契约测试 |
| P4-02 | ✅   | 2025-12-28 | TriggerManager 完整实现      |
| P4-03 | ✅   | 2025-12-28 | URL trigger                  |
| P4-04 | ✅   | 2025-12-28 | Command trigger              |
| P4-05 | ✅   | 2025-12-28 | ContextMenu trigger          |
| P4-06 | ⏳   | -          | DOM trigger                  |
| P4-07 | ✅   | 2025-12-28 | Cron trigger                 |
| P4-08 | ⏳   | -          | 防抖/防风暴                  |
| P4-09 | ✅   | 2025-12-28 | 触发器管理 RPC API           |
| P4-10 | ⏳   | -          | Trigger tests                |

**当前测试状态**: 599 个测试全部通过

---

## UI 集成进度 (2025-12-29)

### 已完成

| 任务                                | 状态 | 完成时间   | 备注                                                          |
| ----------------------------------- | ---- | ---------- | ------------------------------------------------------------- |
| Flow CRUD RPC APIs                  | ✅   | 2025-12-28 | rr_v3.saveFlow/getFlow/listFlows/deleteFlow                   |
| V3 Workflows UI (useWorkflowsV3)    | ✅   | 2025-12-29 | Sidepanel WorkflowsView 使用 V3 数据源                        |
| WorkflowsView V3 run status display | ✅   | 2025-12-29 | 支持 queued/running/paused/succeeded/failed/canceled 状态显示 |

### 待确认问题 ⚠️

在继续 Builder 重构之前，需要产品决策：

**问题 1: V3 Builder 节点支持范围**

V3 运行时目前**不支持**以下节点（handler 未实现或被排除）：

- `foreach` - 循环迭代
- `while` - 条件循环
- `loopElements` - 循环元素
- `executeFlow` - 调用子流程
- `triggerEvent` - 触发 DOM 事件
- `setAttribute` - 设置元素属性

**选项**：

- A) 从 Builder palette 移除这些节点（用户无法创建，避免生成不可运行的 Flow）
- B) 保留但置灰/禁用，给出明确提示"V3 暂不支持"
- C) 优先实现这些节点的 V3 handler（需要额外开发工作）

**问题 2: 触发器/定时器 UI 位置**

当前 V2 Builder 的触发器是放在画布的 "trigger 节点" 里，但 V3 触发器模型是独立的 `TriggerSpec`。

**选项**：

- A) 继续放在画布的 "trigger 节点" 里，保存时同步到 V3 TriggerSpec
- B) 升级成 Builder 顶栏/独立面板，更符合 V3 触发器模型（更清晰但改动更大）

---

### 后续待办

#### 🔴 高优先级（Builder V3 重构）

1. **删除不需要的 V2 兼容代码**
   - 删除 `storage/import/` 目录（v2-to-v3.ts, v2-reader.ts）
   - 用户确认不需要旧数据迁移

2. **Builder 数据层重构**
   - 复用 `useRRV3Rpc` 上移到共享目录
   - 替换 V2 消息通路 (`RR_GET_FLOW/RR_SAVE_FLOW`) → V3 RPC (`rr_v3.getFlow/saveFlow`)
   - `useBuilderStore` 使用 V3 类型 (FlowV3, NodeV3)

3. **Builder 保存/加载 V3 Flow**
   - 保存时：计算 `entryNodeId`（排除 trigger 类型节点，找入度为 0 的可执行节点）
   - 字段映射：`type` → `kind`

4. **Builder palette 对齐 V3 能力**
   - 根据产品决策处理不支持的节点类型
   - 修复 Sidebar Flow 分类 bug（当前 Flow 区块永远为空）

5. **Builder UX 改进**
   - 修复自动保存状态机（dirty/saving/saved/error），所有保存 await 并处理失败
   - 打通 Sidepanel 编辑入口（去掉 alert 占位符）

6. **扩展 enqueueRun 支持 startNodeId**
   - 当前 `rr_v3.enqueueRun` 不支持 `startNodeId` 入参
   - 需要扩展 RPC 以支持"从选中节点运行"功能

#### 🟡 中优先级（Trigger UI）

7. **Sidepanel Trigger UI 连接 V3 RPC**
   - 替换 alert 占位符
   - 调用 `rr_v3.createTrigger/updateTrigger/deleteTrigger`

#### 🟢 低优先级（清理）

8. **删除 V2 相关代码**（在确认 V3 Builder 稳定后）
   - `BACKGROUND_MESSAGE_TYPES.RR_*` 消息类型
   - `entrypoints/background/record-replay/flow-store.ts` 相关
   - 注意：这一步影响面大，需要谨慎评估

---

### 技术分析备忘

#### V2 和 V3 Flow 结构差异

| 字段         | V2 Flow                     | V3 FlowV3                    |
| ------------ | --------------------------- | ---------------------------- |
| 节点类型字段 | `type: NodeType`            | `kind: NodeKind`             |
| 入口节点     | 无（根据入度推断）          | `entryNodeId: NodeId` (必填) |
| 时间戳       | `meta?.createdAt/updatedAt` | `createdAt/updatedAt` (顶级) |
| 绑定         | `meta.bindings[].type`      | `meta.bindings[].kind`       |
| 版本         | `version: number`           | `schemaVersion: 3`           |

**关键发现**: `node.config` 格式完全兼容！V3 ActionAdapter 直接将 `node.config` 作为 V2 Handler 的 `action.params` 传递。

#### Builder 当前依赖的 V2 消息类型

- `RR_GET_FLOW` → `rr_v3.getFlow`
- `RR_SAVE_FLOW` → `rr_v3.saveFlow`
- `RR_LIST_FLOWS` → `rr_v3.listFlows`
- `RR_RUN_FLOW` → `rr_v3.enqueueRun`
- `RR_EXPORT_FLOW` → 直接导出 FlowV3 JSON
- `RR_LIST_TRIGGERS` → `rr_v3.listTriggers`

---

_最后更新: 2025-12-29_
