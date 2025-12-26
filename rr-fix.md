# 录制回放功能问题清单

## 审查背景

目标：达到超越 Automa 的商业级产品水准，确保录制/工作流管理/回放/工作流编排的整个闭环链路稳定可靠。

审查方法：按三个核心场景进行深度代码审查

1. 录制功能：功能完整性、代码架构、潜在 bug
2. 回放引擎：执行器覆盖、架构评估、健壮性、可测试性
3. 编排画布：节点类型、执行调试、状态管理

---

## 🔴 P0 级问题（必须修复，否则无法正常使用）

### 录制功能

#### 1. 右键/拖拽/下载/特殊键未录制

- **位置**: `app/chrome-extension/inject-scripts/recorder.js:813`
- **问题**: 监听器仅注册了 `click/focusin/focusout/input/change/scroll/keydown/keyup/pagehide/visibilitychange/message`，没有 `contextmenu/auxclick/drag*`
- **影响**: 用户关键操作丢失，录制不完整
- **修复方向**:
  - 添加 `contextmenu` 监听，生成 `rightclick` step
  - 添加 `dragstart/dragend/drop` 监听，生成 `drag` step
  - 添加 `chrome.downloads.onCreated` 监听，生成 `handleDownload` step
  - 扩展特殊键录制（箭头键、Backspace/Delete、F1~F12）

#### 2. 嵌套 iframe 丢录

- **位置**: `app/chrome-extension/inject-scripts/recorder.js:1748`
- **问题**: top 聚合用 `document.querySelectorAll('iframe,frame')` 只枚举顶层 document 的 frame 元素来匹配 `ev.source`，无法识别"非直接子 frame"的 source window
- **影响**: 嵌套 iframe（iframe 里再 iframe）内的操作丢失
- **修复方向**: 递归遍历所有 frame 层级，建立 window → frameSelector 映射

#### 3. 子 frame 导航后不 reinject

- **位置**: `app/chrome-extension/entrypoints/background/record-replay/recording/browser-event-listener.ts:35`
- **问题**: `webNavigation.onCommitted` 对 `frameId!==0` 直接 return，iframe 自己导航会销毁 content world，后续未必 reinject
- **影响**: iframe 导航后的操作丢失
- **修复方向**:
  - 监听所有 frameId 的 `onCommitted`
  - 或使用 MutationObserver 监听 iframe 创建并注入

#### 4. 键盘组合可能产生无效串

- **位置**: `app/chrome-extension/inject-scripts/recorder.js:1670`, `:1706`, `:1719`
- **问题**: `_onKeyDown` 对任何修饰键按下都会走"special 或有 modifier"分支，当 `e.key` 本身是 `Control/Shift/...` 时容易产生 `Ctrl+Control`/`Shift+Shift` 的无效串
- **影响**: 回放侧解析器会判定无效
- **修复方向**: 过滤掉 `e.key` 为修饰键本身的情况

#### 5. 导航前进/后退可能漏记

- **位置**: `app/chrome-extension/entrypoints/background/record-replay/recording/browser-event-listener.ts:38`
- **问题**: 仅依赖 `transitionType` 且 `link` 分支跳过，未使用 `transitionQualifiers`
- **影响**: history 前进/后退的显式 step 可能漏记
- **修复方向**: 检查 `transitionQualifiers` 包含 `forward_back`

#### 6. 多标签页 switchTab 可能重复

- **位置**: `app/chrome-extension/inject-scripts/recorder.js:1226` + `browser-event-listener.ts:8`
- **问题**: target=\_blank 时 recorder.js 已写 `switchTab`，随后 `tabs.onActivated` 也会再写一次
- **影响**: 回放时会执行两次 switchTab
- **修复方向**: 在 background 侧去重，或在 content 侧标记已处理

---

### 回放引擎

#### 7. legacy 路径 tab cursor 语义不成立

- **位置**:
  - `app/chrome-extension/entrypoints/background/record-replay/engine/runners/step-executor.ts:76-86`
  - `app/chrome-extension/entrypoints/background/record-replay/nodes/click.ts:14-17`
  - `nodes/fill.ts:15-18`, `nodes/wait.ts:20-23`, `nodes/script.ts:12-15`
  - `engine/runners/after-script-queue.ts:48-52`
- **问题**: Scheduler 传 `ctx.tabId`，但 LegacyStepExecutor 明确不使用，大量 legacy node 直接 `chrome.tabs.query({ active: true, currentWindow: true })`
- **影响**: 多 tab 流程在 legacy/hybrid 下，只要 active tab 不等于期望 tabId，就会操作到错误 tab
- **修复方向**:
  - 方案A: 让 legacy nodes 全部使用 `ctx.tabId`
  - 方案B: 在产品层面禁止多 tab flow 落到 legacy，强制 actions 执行

#### 8. 子流失败不计入 run 结果

- **位置**:
  - `app/chrome-extension/entrypoints/background/record-replay/engine/runners/subflow-runner.ts:118`
  - `engine/scheduler.ts:667`
- **问题**: 子流失败只 break 不 throw，主流 success 仅看 `this.failed`（只在主循环失败时累加）
- **影响**: 可能"显示成功但实际子流失败"
- **修复方向**: 子流失败时累加到主流的 failed 计数，或设置 subflowFailed 标记

#### 9. actions control-flow 条件评估协议不一致

- **位置**:
  - `app/chrome-extension/entrypoints/background/record-replay/actions/handlers/control-flow.ts:40-46`
  - `engine/scheduler.ts:747-760`
  - `engine/utils/expression.ts:114-116`
- **问题**:
  - actions control-flow 的 `Condition.kind='expr'` 直接返回 false
  - actions `while` 产生的 `control.condition` 是 `Condition` 对象，但 scheduler 的 `evalCondition` 只支持 `{expression}` 或 `{var,equals}`
- **影响**: actions-mode while 逻辑不可用，循环永远不执行
- **修复方向**: 统一 Condition 评估协议，让 scheduler 能正确解析 actions 产出的 Condition

#### 10. After-script 在错误 tab 执行

- **位置**: `app/chrome-extension/entrypoints/background/record-replay/engine/runners/after-script-queue.ts:48`
- **问题**: 直接取 active tab，与 `ctx.tabId` 脱钩
- **影响**: 多 tab 场景可能跑错 tab
- **修复方向**: 使用 `ctx.tabId` 而非 active tab

#### 11. legacy 节点不检查 tool 返回 isError

- **位置**:
  - `app/chrome-extension/entrypoints/background/record-replay/nodes/http.ts:10`
  - `nodes/download-screenshot-attr-event-frame-loop.ts:16`, `:33`
- **问题**: 对 tool bridge 返回值不检查 `isError`
- **影响**: "失败但返回 success"假阳性
- **修复方向**: 统一检查返回值的 isError 字段

#### 12. screenshotOnFailure 从未调用

- **位置**: `app/chrome-extension/entrypoints/background/record-replay/engine/logging/run-logger.ts:47`
- **问题**: 全 repo 仅定义无引用
- **影响**: `RunResult.screenshots.onFailure` 不可用
- **修复方向**: 在 step 失败时调用

#### 13. delay handler 不可达

- **位置**:
  - `packages/shared/src/rr-graph.ts:84`
  - `app/chrome-extension/entrypoints/background/record-replay/actions/handlers/delay.ts:14`
- **问题**: DAG 节点 `type='delay'` 会被强制映射为 `step.type='wait'` + `condition.sleep`，导致 `delayHandler` 不可达
- **影响**: actions 侧的 delay 实现无法被使用
- **修复方向**: 保持 delay 类型不变，或统一到 wait

---

### Builder 编排画布

#### 14. IF else 分支 label 契约断裂

- **位置**:
  - `app/chrome-extension/entrypoints/popup/components/builder/components/nodes/NodeIf.vue:34-39`
  - `app/chrome-extension/entrypoints/popup/components/builder/Canvas.vue:182-188`
  - `packages/shared/src/node-specs-builtin.ts:493-496`
  - `app/chrome-extension/entrypoints/background/record-replay/nodes/conditional.ts:32-33`
- **问题**:
  - Builder: else handle id 为 `case:else`，Canvas connect 时使用 `sourceHandle` 作为 edge.label
  - NodeSpec: IF 的 `else` 字段是 boolean
  - Engine: 未命中任何 branch 时 `nextLabel = String(s.else || 'default')`，当 `s.else` 为 boolean true 时变成字符串 `"true"`
- **影响**: else 分支永远不执行
- **修复方向**:
  - 统一 else edge.label 的标准（建议 `'else'`）
  - 让所有相关组件使用同一契约
  - 提供存量 flow 的迁移规则

#### 15. 目标定位器强制降级为 CSS

- **位置**:
  - `app/chrome-extension/entrypoints/popup/components/builder/widgets/FieldSelector.vue:54-63`
  - `app/chrome-extension/entrypoints/popup/components/builder/widgets/FieldTargetLocator.vue:60-74`
- **问题**: FieldTargetLocator 无论输入/拾取结果是什么，都 emit `candidates: [{ type: 'css', value: s }]`
- **影响**: aria/text/xpath 候选会被错误编码为 css，回放定位失败
- **修复方向**: 让拾取返回结构化 `{type, value}` 并保留候选类型

#### 16. Sidebar Flow 分类渲染 bug

- **位置**:
  - `app/chrome-extension/entrypoints/popup/components/builder/Sidebar.vue:17` vs `:148-164`
- **问题**: 模板使用 `filtered.Flow`，但 computed `filtered` 未返回 Flow key
- **影响**: Flow 分类节点不可见/不可用
- **修复方向**: 在 filtered 计算属性中添加 Flow 分类

---

## 🟡 P1 级问题（影响产品质量）

### 录制功能

#### 17. 动态 iframe 注入缺口

- **位置**: `app/chrome-extension/entrypoints/background/record-replay/recording/content-injection.ts:14`
- **问题**: 注入发生在"开始/切 tab/主框架 committed"，没有"持续注入/iframe 新建监听"机制
- **影响**: 录制中途新出现的 frame 不会被注入
- **修复方向**: 监听 `webNavigation.onCommitted` 的所有 frameId

#### 18. 录制中途崩溃丢失进度

- **位置**: `app/chrome-extension/entrypoints/background/record-replay/recording/recorder-manager.ts:166`, `:246`
- **问题**: `saveFlow` 只在 start 初始和 stop 最终落库，中途崩溃/重载可能丢录制进度
- **修复方向**: 定期自动保存或使用增量持久化

### 回放引擎

#### 19. executeFlow 是"拓扑线性化"而非真正 DAG 执行

- **位置**: `app/chrome-extension/entrypoints/background/record-replay/nodes/execute-flow.ts:20-36`
- **问题**: inline `executeFlow` 用 `topoOrder(defaultEdgesOnly(edges))` 顺序执行，不处理 label 分支/on_error/循环
- **影响**: 引用的 flow 只要非线性，执行语义就与主调 scheduler 不一致
- **修复方向**: 使用完整的 scheduler 执行子流程

#### 20. 表达式系统割裂

- **位置**:
  - `nodes/conditional.ts:18` - legacy `if` 走 `new Function`
  - `engine/scheduler.ts:747` - scheduler 走受限解析
  - `actions/registry.ts:204` - resolver 不支持 ExpressionValue
- **问题**: 多套表达式评估系统，语义/安全性不一致
- **影响**: 同样的表达式在不同路径下可能有不同结果
- **修复方向**: 统一表达式评估系统

### Builder

#### 21. 无单步执行/断点调试

- **位置**: Builder 全局
- **问题**: 引擎有 breakpoint plugin，但 builder 无编辑入口和"继续运行"入口
- **影响**: 调试困难
- **修复方向**:
  - 添加 `$breakpoint` 字段编辑入口
  - 订阅 runState 展示 per-step 执行日志
  - 高亮当前执行节点

#### 22. Subflow UI 未接线

- **位置**:
  - `Sidebar.vue:127-133` - 声明了 emits
  - `PropertyPanel.vue:262-269` - 有创建逻辑
- **问题**: 声明了 subflow 相关功能但模板未使用
- **影响**: 子流程管理功能不可用
- **修复方向**: 完成 subflow UI 接线

---

## 🟢 P2 级问题（可优化项）

#### 23. stop barrier 语义容易误读

- **位置**: `recorder-manager.ts:219`, `:227`, `:234`
- **问题**: `barrierOk` 只看 top frame ACK，可能 `ok: true` 但 `failed` 非空

#### 24. Scheduler 级测试覆盖不足

- **问题**: if 分支/else label 路由、actions while 迭代、multi-tab 场景等缺少自动化测试

#### 25. unknown step type 被静默降级

- **位置**: `session-manager.ts:281`, `rr-graph.ts:275`
- **问题**: 未知类型 fallback 到 script，可能掩盖数据漂移

---

## 与 Automa 的差距

| 能力          | Automa                                            | 我们                                | 差距             |
| ------------- | ------------------------------------------------- | ----------------------------------- | ---------------- |
| 模板/变量系统 | mustache + `!!` 表达式 + secrets/table/持久化变量 | `{var}` 纯字符串替换                | 显著落后         |
| 错误处理      | block/workflow 两级可配置 onError                 | step.retry + ON_ERROR 边            | 产品化配置面不足 |
| 触发器        | cron/regex/SPA/特定星期                           | once/interval/daily + 简单 url 规则 | 丰富度不足       |
| Block 生态    | GoogleSheets/Proxy/Cookie/Clipboard 等            | 偏浏览器自动化内核                  | 外部集成少       |
| 并发运行保护  | 运行中则入队/跳过                                 | 直接 runFlow                        | 无保护           |

---

## 修复优先级建议

### 第一批（闭环可用）

1. [P0-Builder] 修复 IF else 分支 label 契约断裂
2. [P0-回放] 统一 tab cursor 语义
3. [P0-回放] 修复子流失败不计入 run 结果
4. [P0-Builder] 修复目标定位器强制降级为 CSS

### 第二批（录制完整）

5. [P0-录制] 补充右键/拖拽/下载/特殊键录制能力
6. [P0-录制] 修复嵌套 iframe 丢录问题
7. [P0-录制] 修复子 frame 导航后 reinject 缺失

### 第三批（引擎健壮）

8. [P0-回放] 修复 actions control-flow 条件评估不一致
9. [P1-回放] 修复 After-script tab 问题
10. [P1-回放] 修复 legacy 节点不检查 isError

### 第四批（体验提升）

11. [P1-Builder] 补充运行状态可视化/断点调试
12. [P1] 升级模板/变量系统
13. [P1] 引入可配置的 onError 策略
