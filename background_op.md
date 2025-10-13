# 静默执行（不抢焦点）方案 — background_op

本文档描述在不影响现有工具默认行为的前提下，为 Chrome MCP Server 增加“静默执行（不抢焦点）”能力的设计方案与落地细节。静默执行指：当用户正在使用页面 A 时，自动化流程可以在后台页面/标签 B 完成全流程，而不切换当前焦点、不前置窗口。

## 原始需求（来自业务方）

- 我正在操作 A 页面时，需要自动化去 B 页面完成“打开 URL、点击按钮、填表、截图”等动作。
- 希望这些动作在后台完成，不抢占我的焦点，不切换到 B 标签，不前置窗口。
- 同时，不能影响现有 tools 的能力与默认行为（已有脚本必须零改动可继续工作）。

## 范围与目标

- 目标：为主要页面相关工具提供“后台执行/不抢焦点”能力，支持在后台标签或最小化窗口中运行完整流程。
- 范围：导航、读页、交互、截图等常用工具；可选扩展到控制台与网络工具。
- 约束：默认行为保持不变；仅当显式传入新增选项时启用静默语义。

## 兼容性原则

- 向后兼容：不改动现有参数默认值与行为；新增参数均可选。
- 调用优先级：`tabId` 指定目标 > 当前活动标签（未提供 `tabId` 时才使用活动标签）。
- 便捷开关：`silent` 为快捷语义，不覆盖已显式传入的更细粒度参数（如 `activate/focusWindow`）。

## API 设计（仅新增可选参数）

为尽量减小侵入性，本方案仅做“参数增量”，并保证默认值与当前一致。

### 统一参数（适用于需要页面上下文的工具）

- `tabId?: number`（可选）
  - 将操作定向到指定标签；未提供时沿用“活动标签页”。
- `silent?: boolean`（可选，默认 false）
  - 静默模式快捷语义，对导航类等效于 `activate:false` + `focusWindow:false`；对读页/交互类仅表示“不会主动切换焦点”，实际行为由是否提供 `tabId` 决定。

### 导航工具 `chrome_navigate`（新增参数，默认不变）

- 新增：
  - `activate?: boolean`（默认 true）新开或复用目标标签时，是否激活该标签。
  - `focusWindow?: boolean`（默认 true）是否前置包含该标签的窗口。
  - `newWindowState?: 'normal'|'minimized'`（默认 'normal'）新窗口状态。
  - `silent?: boolean`（默认 false）为便捷开关，等效于 `activate:false` + `focusWindow:false`（若同时显式传入 `activate/focusWindow`，以显式参数为准）。
- 返回：在保持既有返回结构的基础上，补充 `tabId` 与 `windowId` 字段，便于链式调用（已有调用可忽略该字段）。

### 读页与交互类

- `chrome_read_page`、`chrome_computer`、`chrome_click_element`、`chrome_fill_or_select`、`chrome_keyboard`、`chrome_screenshot`：
  - 新增 `tabId?: number`，用于在后台标签执行。
  - 未提供 `tabId` 时，仍使用活动标签（与当前行为一致）。

### 网络/控制台类（建议，非 MVP 必须）

- `chrome_console`、`chrome_network_capture_start/stop`、`chrome_network_debugger_start/stop`：
  - 新增 `tabId?: number`；如参数包含 `url` 导航，则遵循 `activate/focusWindow/silent` 的语义。

## 行为语义（静默模式）

### 静默导航

- 复用既有标签：`activate:false` 时不切换至该标签，不前置窗口，仅返回 `tabId`。
- 新建标签：使用 `active:false` 打开，且 `focusWindow:false` 时不前置窗口。
- 新建窗口（可选）：使用 `focused:false` 与 `newWindowState:'minimized'`，实现“完全后台”。

### 静默交互

- DOM 路径优先：在内容脚本中执行 `HTMLElement.click`、输入赋值并触发事件、`scrollIntoView/scrollBy` 等，不依赖可见焦点。
- CDP 兜底：仅在 DOM 路径失败时使用 CDP 的 Input/鼠标滚轮等；完成后及时 detach，避免资源占用。
- 输入策略：优先“设置值 + dispatch 事件”，减少对真实键盘焦点的依赖。

### 等待与时序

- 导航等待：监听目标 `tabId` 的 `tabs.onUpdated`（状态 `complete`）或使用 CDP 的 `Page.loadEventFired`。
- 操作等待：基于 DOM 条件（元素可见、文本出现、属性匹配）替代依赖前台可见性的信号。

## 推荐调用范式（端到端不抢焦点）

1. 后台打开 B：

```json
{
  "name": "chrome_navigate",
  "args": { "url": "https://example.com/b", "silent": true }
}
```

响应中拿到 `tabId`。

2. 读页：

```json
{ "name": "chrome_read_page", "args": { "tabId": 123 } }
```

3. 交互：

```json
{ "name": "chrome_computer", "args": { "action": "left_click", "ref": "ref_14", "tabId": 123 } }
```

4. 截图：

```json
{ "name": "chrome_computer", "args": { "action": "screenshot", "tabId": 123 } }
```

5. 关闭：

```json
{ "name": "chrome_close_tabs", "args": { "tabIds": [123] } }
```

> 说明：若不使用 `silent`，也可手动设置 `activate:false` 与 `focusWindow:false` 达到相同效果。

## 边界与降级策略

- 需要“用户手势”的能力（文件选择对话框、系统权限弹窗、媒体自动播放、剪贴板写入等）在后台标签通常受限。
  - 策略：优先 DOM 路径；如检测到受限能力，返回“需前台确认”的提示，让用户一键 bring-to-front 再继续。
- 站点基于 `document.visibilityState/focus` 的行为门禁。
  - 策略：优先走后端 API/脚本方案；必要时提供“临时前置窗口（可配置时长）”可选项，或提示用户短暂聚焦继续。
- CDP 遗留差异：少数平台上 CDP 键鼠对非激活 tab 的行为差异。
  - 策略：DOM 为主、CDP 兜底且重试；执行完立即 detach。
- 并发与资源：后台标签过多可能带来内存/CPU 压力。
  - 策略：限制并发、执行完主动关闭标签；日志暴露执行耗时与失败原因，用于调优。

## 验收标准与用例

- 指标：
  - A 页面始终保持活动（执行前后 `activeTab` 未变化）
  - 静默流程成功率 ≥ 95%
  - 静默与非静默耗时差 ≤ 10%
- 用例：
  1. 新建后台标签执行完整流程（打开→读页→点击→截图→关闭）
  2. 复用既有标签静默执行（不切换、不前置）
  3. 受限能力触发“需前台确认”，前台继续后流程成功

## 实施分批（推荐顺序）

- P0（最小可用）
  - `chrome_navigate` 增加 `activate/focusWindow/newWindowState/silent`；返回补充 `tabId`/`windowId`
  - `chrome_read_page/chrome_computer/chrome_click_element/chrome_fill_or_select/chrome_keyboard/chrome_screenshot` 增加 `tabId`
  - 文档与示例更新（TOOLS.md/TOOLS_zh.md）
- P1（增强）
  - `chrome_console`、`chrome_network_*` 支持 `tabId` 与静默导航
- P2（配套）
  - 录制/回放 Runner 增加 `silent:true` 与 `startUrl`；Builder 运行面板提供“静默执行”开关

## 日志与监控

- 每次调用打印核心上下文：`{ tool, tabId, silent, activate, focusWindow }`；
- 统计：静默流程成功率、失败原因分布、自愈/兜底触发率、执行耗时分位（P50/P95）。

## 风险与回滚

- 发现强依赖前台可见性的站点时：允许配置“短暂前置窗口（如 2s）”应急；同时保留“完全静默”选项，避免全局退化。
- 若出现非预期聚焦变更：提供全局开关快速禁用静默路径，回滚至既有行为。

## 术语说明

- 静默执行：不切换当前活动标签，不前置窗口，在后台标签或最小化窗口中执行自动化。
- DOM 路径：通过内容脚本直接调用 DOM API 完成交互（更稳定且对焦依赖小）。
- CDP：Chrome DevTools Protocol，必要时用于兜底输入/滚动等行为。

## 附：行为片段（示意）

```ts
// Pseudocode — do not copy directly
// Navigate silently and return the new tab id
async function navigateSilently(url: string) {
  // create background tab without focusing
  const tab = await chrome.tabs.create({ url, active: false }); // no window focus
  return tab.id;
}

// Send action to a specific background tab
async function clickByRefSilently(tabId: number, ref: string) {
  // inject helper and dispatch click via DOM to avoid focus dependency
  // Prefer DOM path; CDP as fallback
}
```

---

本方案仅通过“新增可选参数 + 行为分支”实现静默执行，保证默认行为与现有能力不受影响；当且仅当调用方显式传入 `silent/tabId` 等参数时，才启用静默路径。
