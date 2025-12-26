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

_最后更新: 2025-12_
