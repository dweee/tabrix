# Web-Editor-V2 与 AgentChat 联动功能

## 需求理解

用户需要实现 web-editor-v2 与 AgentChat 的联动功能，核心需求包括：

1. Apply联动：点击Apply时，如果sidepanel未打开则自动拉起，使用最近的session发送消息
2. 修改元素展示：所有修改过的元素在AgentChat对话框中展示（Chips形式），支持hover显示改动上下文
3. 双向联动：从对话框移除元素时，web-editor需要undo该元素的修改
4. 两种使用场景：
   - 场景1：用户在web-editor做修改后点Apply自动发送
   - 场景2：用户选中元素后在AgentChat中描述修改并发送

---

## 实施进度

| 阶段    | 任务                           | 状态      | 备注                                  |
| ------- | ------------------------------ | --------- | ------------------------------------- |
| 分析    | 需求分析与决策点确认           | ✅ 完成   | 与 Codex 协作完成                     |
| 分析    | 上下文收集 - 深挖关键技术细节  | ✅ 完成   | 识别了关键代码位置和接口缺口          |
| 规划    | 任务规划 - 制定详细实施计划    | ✅ 完成   | 详细方案已定稿                        |
| P1.1    | 定义消息类型和数据结构         | ✅ 完成   | message-types.ts, web-editor-types.ts |
| P1.2    | 实现 elementKey 生成器         | ✅ 完成   | element-key.ts                        |
| P1.3    | 实现 Transaction 聚合器        | ✅ 完成   | transaction-aggregator.ts             |
| P1.4    | 改造 Apply 流程 + TX 广播      | ✅ 完成   | editor.ts                             |
| P1.5    | Background 处理和 batch prompt | 🔄 进行中 | background/web-editor/index.ts        |
| P1.6-11 | Sidepanel UI 组件              | ⏳ 待开始 | -                                     |
| P2      | 双向联动（Selective Undo）     | ⏳ 待开始 | -                                     |

---

## 关键架构决策（经 Codex 验证）

### 1. Session 统一方案

- Apply 时从 `chrome.storage.local['agent-selected-session-id']` 读取当前选中的 DB session
- 使用这个 DB sessionId 作为 native server API 的 URL path 参数
- 同时在 payload 里传 `dbSessionId` 以加载 session 配置
- 若无选中 session，需创建新 session（依赖 `projectId + engineName`）

### 2. elementKey 稳定标识方案

- **不使用** `locatorKey()`（基于 selector candidates，class 变化会导致不稳定）
- **新方案**：`shadowHostChain + (id || assignedKey)`
  - 优先使用 `tag#id` 作为标识
  - 无 id 时使用 WeakMap<Element, key> 分配稳定 key
  - 将 key 写入 Transaction 的 `elementKey` 字段

### 3. 批量 Apply 语义

- 新增 `WEB_EDITOR_APPLY_BATCH` 消息类型
- 聚合 undoStack 中所有 tx，按元素分组计算净效果
- Batch payload 发送"净效果指令数组"（非 summary）
- Apply 失败不自动回滚，仅提示用户

### 4. 补偿交易（Revert）方案

- 使用现有 TransactionManager API 实现
- style: `tm.beginMultiStyle()` + `handle.set(baselineValues)`
- text: `element.textContent = baselineText` + `tm.recordText()`
- 补偿交易入栈，用户可再次 undo

### 5. TX 变化广播

- 在 `editor.ts:handleTransactionChange()` 中触发（非 transaction-manager.ts）
- 使用 debounce/throttle 避免高频广播
- 通过 `chrome.runtime.sendMessage` 广播到 sidepanel
- 需要 `chrome.storage.session` 缓存状态供 sidepanel 冷启动时拉取

---

## 一、代码库现状

### 1. Web-Editor-V2 架构

| 模块            | 位置                                              | 功能                            |
| --------------- | ------------------------------------------------- | ------------------------------- |
| 入口            | app/chrome-extension/entrypoints/web-editor-v2.ts | 注入脚本，创建编辑器实例        |
| 核心编辑器      | .../web-editor-v2/core/editor.ts                  | 编辑器主控，协调各子系统        |
| 事务管理        | .../web-editor-v2/core/transaction-manager.ts     | Undo/Redo 线性栈管理            |
| 元素定位        | .../web-editor-v2/core/locator.ts                 | CSS 选择器生成、元素定位        |
| Payload 构建    | .../web-editor-v2/core/payload-builder.ts         | 构建发送给 Agent 的 prompt      |
| 工具栏 UI       | .../web-editor-v2/ui/toolbar.ts                   | Apply/Undo/Redo 按钮            |
| Background 处理 | .../background/web-editor/index.ts                | 处理 Apply 请求，调用 Agent API |

### 2. AgentChat 架构

| 模块          | 位置                                   | 功能                   |
| ------------- | -------------------------------------- | ---------------------- |
| 主组件        | .../sidepanel/components/AgentChat.vue | 对话界面主组件         |
| 输入组件      | .../agent-chat/AgentComposer.vue       | 输入框组件             |
| 会话管理      | .../composables/useAgentSessions.ts    | Session CRUD 和选择    |
| 聊天逻辑      | .../composables/useAgentChat.ts        | 消息发送、SSE 订阅     |
| Native Server | app/native-server/src/agent/\*         | 会话持久化、Agent 执行 |

### 3. 关键代码位置（经 Codex 扫描确认）

| 功能                    | 文件位置                                            | 说明                                               |
| ----------------------- | --------------------------------------------------- | -------------------------------------------------- |
| Transaction 定义        | `common/web-editor-types.ts:239`                    | 包含 id, type, targetLocator, before, after        |
| ElementLocator 定义     | `common/web-editor-types.ts:147`                    | 包含 selectors, fingerprint, path, shadowHostChain |
| locatorKey 生成         | `web-editor-v2/core/locator.ts:747`                 | 用 selectors.join 生成 key（不稳定）               |
| fingerprint 生成        | `web-editor-v2/core/locator.ts:501`                 | 包含 tag+id+class+text（会变化）                   |
| Apply 入口              | `web-editor-v2/core/editor.ts:519`                  | 当前只发送栈顶一条                                 |
| Apply payload 构建      | `web-editor-v2/core/payload-builder.ts:471`         | `buildApplyPayload()`                              |
| prompt 构建             | `background/web-editor/index.ts:363`                | `buildAgentPrompt()`                               |
| Sidepanel 消息监听      | `sidepanel/App.vue:1020`                            | `runtime.onMessage`                                |
| URL 参数处理            | `sidepanel/App.vue:1007`                            | 只识别 `tab=element-markers`                       |
| 元素高亮                | `inject-scripts/element-marker.js:2290`             | `highlightSelectorExternal`                        |
| Session 存储            | `chrome.storage.local['agent-selected-session-id']` | DB session ID                                      |
| handleTransactionChange | `editor.ts:406`                                     | TX 变化统一入口（适合加广播）                      |

### 4. 关键发现

**Session 不一致问题：**

- Web-editor Apply 使用固定的 `web-editor-${tabId}` 作为 sessionId（`background/web-editor/index.ts:823`）
- AgentChat 使用 DB session（存储在 `chrome.storage.local['agent-selected-session-id']`）
- native server 的 `sessionId` 决定 SSE channel 和消息落库（`chat-service.ts:147`）
- **两者完全独立，消息不会出现在同一个对话中**

**Apply 只发送单条 Transaction：**

```typescript
// editor.ts:519-524 - 当前只发送栈顶一条
const tx = undoStack.length > 0 ? undoStack[undoStack.length - 1] : null;
```

**elementKey 不稳定问题：**

- `locatorKey()` 用 `selectors.join('|')` 生成 key
- selector candidates 依赖 class，class 变化会导致 key 变化
- 需要新方案保证稳定标识

**已有可复用组件：**

- `locatorKey()` - 生成元素唯一标识（需改进）
- `buildStyleDescription()` - 生成变更描述
- `computeStyleDiff()` - 计算样式差异（`payload-builder.ts:383`）
- Element Marker 高亮脚本（支持 Shadow DOM 深查询）

---

## 二、详细实现方案

### Phase 1：核心链路打通（优先实现）

#### 1.1 新增消息类型

**文件**: `app/chrome-extension/common/message-types.ts`

```typescript
export const BACKGROUND_MESSAGE_TYPES = {
  // ... 现有类型

  // Web Editor 联动消息
  WEB_EDITOR_TX_CHANGED: 'web_editor_tx_changed', // TX列表变化广播
  WEB_EDITOR_SELECTION_CHANGED: 'web_editor_selection_changed', // 选中元素变化
  WEB_EDITOR_APPLY_BATCH: 'web_editor_apply_batch', // 批量 Apply
  WEB_EDITOR_GET_STATE: 'web_editor_get_state', // Sidepanel 冷启动拉取状态
} as const;
```

#### 1.2 数据结构定义

**文件**: `app/chrome-extension/common/web-editor-types.ts`

```typescript
// 扩展 Transaction 类型
export interface Transaction {
  // ... 现有字段
  elementKey: string; // 新增：稳定的元素标识
}

// 元素变更摘要（用于 Chips 展示）
export interface ElementChangeSummary {
  key: string; // 稳定的元素标识
  label: string; // 展示文本（如 div#app）
  fullLabel: string; // 完整标签（tooltip 用）
  selectors: string[]; // 用于高亮的选择器
  shadowHostChain?: string[]; // Shadow DOM 链
  type: 'style' | 'text' | 'class' | 'mixed'; // 变更类型
  changes: {
    style?: {
      added: number;
      removed: number;
      modified: number;
      details: string[]; // 具体属性名
    };
    text?: {
      beforePreview: string; // 截断的前值
      afterPreview: string; // 截断的后值
    };
    class?: {
      added: string[];
      removed: string[];
    };
  };
  transactionIds: string[]; // 关联的 tx ids
  netEffect: NetEffectPayload; // 净效果 payload（用于 Apply）
}

// 净效果 payload（可直接用于构建 prompt）
export interface NetEffectPayload {
  elementKey: string;
  locator: ElementLocator;
  styleChanges?: {
    before: Record<string, string>;
    after: Record<string, string>;
  };
  textChange?: {
    before: string;
    after: string;
  };
  classChanges?: {
    before: string[];
    after: string[];
  };
}

// TX 变化广播 payload（sidepanel 监听）
export interface WebEditorTxChangedPayload {
  tabId: number;
  elements: ElementChangeSummary[];
  undoCount: number;
  redoCount: number;
  hasApplicableChanges: boolean;
}

// 批量 Apply payload
export interface WebEditorApplyBatchPayload {
  tabId: number;
  elements: ElementChangeSummary[];
  excludedKeys: string[];
}
```

#### 1.3 elementKey 生成器

**新文件**: `app/chrome-extension/entrypoints/web-editor-v2/core/element-key.ts`

```typescript
// WeakMap 存储已分配的 key
const elementKeyMap = new WeakMap<Element, string>();
let keyCounter = 0;

/**
 * 生成稳定的元素标识
 * 策略：
 * 1. 优先使用 tag#id（如果有 id）
 * 2. 否则分配一个稳定的 key（基于 WeakMap）
 * 3. 加上 shadowHostChain 前缀以区分不同上下文
 */
export function generateStableElementKey(element: Element, shadowHostChain?: string[]): string {
  // 检查是否已分配
  let baseKey = elementKeyMap.get(element);

  if (!baseKey) {
    const tag = element.tagName.toLowerCase();
    const id = element.id;

    if (id) {
      baseKey = `${tag}#${id}`;
    } else {
      baseKey = `${tag}_${++keyCounter}`;
    }

    elementKeyMap.set(element, baseKey);
  }

  // 加上 shadow 上下文前缀
  if (shadowHostChain && shadowHostChain.length > 0) {
    return `${shadowHostChain.join('>')}>>${baseKey}`;
  }

  return baseKey;
}
```

#### 1.4 Transaction 聚合器

**新文件**: `app/chrome-extension/entrypoints/web-editor-v2/core/transaction-aggregator.ts`

核心算法：

1. 按 `tx.elementKey` 分组
2. 对每个元素的 style 变更：合并为"净效果"（第一个 before → 最后一个 after）
3. 对每个元素的 text 变更：取首尾
4. 对每个元素的 class 变更：计算净效果
5. 过滤掉净效果为无变化的项
6. 生成 `ElementChangeSummary[]` 和 `NetEffectPayload`

#### 1.5 Apply 流程改造

**核心改动点：**

1. **editor.ts** - 新增 `applyAllTransactions()` 方法
   - 调用 `aggregateByElement()` 获取聚合后的变更
   - 发送 `WEB_EDITOR_APPLY_BATCH` 消息给 background

2. **editor.ts** - 在 `handleTransactionChange()` 中增加广播
   - 使用 debounce 避免高频广播
   - 同时缓存状态到 `chrome.storage.session`

3. **background/web-editor/index.ts** - 处理新的 Apply 消息
   - 尝试打开 sidepanel（带 `?tab=agent-chat` 参数）
   - 从 `chrome.storage.local` 读取 `selectedSessionId`
   - 过滤 excludedKeys
   - 调用 `buildAgentPromptBatch()` 构建批量 prompt
   - 调用 `/agent/chat/:sessionId/act`

4. **toolbar.ts** - Apply 按钮调用新方法

#### 1.6 Sidepanel UI 增强

**新增组件**: `app/chrome-extension/entrypoints/sidepanel/components/agent-chat/WebEditorChanges.vue`

功能：

- 监听 `WEB_EDITOR_TX_CHANGED` 消息
- 冷启动时从 storage 拉取状态
- 展示修改的元素 Chips
- Include/Exclude 切换
- Hover 触发页面高亮（复用 element-marker）

**新增组件**: `ElementChip.vue`

功能：

- 展示元素标签（tag#id 格式）
- Include/Exclude 切换按钮
- Hover 显示变更详情（Tooltip）
- Hover 时高亮页面元素

#### 1.7 通信与存储设计

| 存储 Key                         | 类型    | 用途                     |
| -------------------------------- | ------- | ------------------------ |
| agent-selected-session-id        | local   | 当前选中的 DB session    |
| web-editor-excluded-keys-{tabId} | session | 被排除的元素 keys        |
| web-editor-state-{tabId}         | session | 冷启动时的 pending state |

---

### Phase 2：双向联动（后续迭代）

#### 2.1 补偿交易机制（推荐方案）

**替代 Selective Undo，使用补偿交易：**

```typescript
function revertElement(key: string): void {
  const txs = undoStack.filter((tx) => tx.elementKey === key);
  if (txs.length === 0) return;

  const element = locateElement(txs[0].targetLocator);
  if (!element) {
    showError('元素已不存在，无法撤销');
    return;
  }

  // 计算净效果的 baseline（第一个 tx 的 before）
  const firstTx = txs[0];

  // 生成补偿交易
  if (firstTx.before.styles) {
    const handle = tm.beginMultiStyle(element, Object.keys(firstTx.before.styles));
    handle.set(firstTx.before.styles);
    handle.commit();
  }

  if (firstTx.before.text !== undefined) {
    element.textContent = firstTx.before.text;
    tm.recordText(element, element.textContent, firstTx.before.text);
  }
}
```

#### 2.2 Chips "Revert" 功能

- 在 ElementChip 上增加 "×" 按钮
- 点击触发 `WEB_EDITOR_REVERT_ELEMENT` 消息
- Content script 执行 `revertElement()`
- 补偿交易入栈，用户可再次 undo

---

## 三、任务拆解

### Phase 1 任务列表（核心链路）

| #    | 任务                                                 | 优先级 | 依赖    | 状态 |
| ---- | ---------------------------------------------------- | ------ | ------- | ---- |
| 1.1  | 定义新消息类型（message-types.ts）                   | P0     | -       | ✅   |
| 1.2  | 扩展数据结构（web-editor-types.ts）                  | P0     | 1.1     | ✅   |
| 1.3  | 实现 elementKey 生成器（element-key.ts）             | P0     | -       | ✅   |
| 1.4  | 实现 Transaction 聚合器（transaction-aggregator.ts） | P0     | 1.2,1.3 | ✅   |
| 1.5  | 改造 Apply 流程（editor.ts）                         | P0     | 1.4     | ✅   |
| 1.6  | 增加 TX 变化广播（editor.ts）                        | P0     | 1.4     | ✅   |
| 1.7  | Background 处理 APPLY_BATCH（index.ts）              | P0     | 1.5     | ⏳   |
| 1.8  | 实现 batch prompt 构建（index.ts）                   | P0     | 1.7     | ⏳   |
| 1.9  | Sidepanel URL 参数增加 agent-chat（App.vue）         | P1     | -       | ⏳   |
| 1.10 | Sidepanel 监听 TX 变化消息                           | P1     | 1.6     | ⏳   |
| 1.11 | 实现 WebEditorChanges 组件                           | P1     | 1.10    | ⏳   |
| 1.12 | 实现 ElementChip 组件                                | P1     | 1.11    | ⏳   |
| 1.13 | 实现 Include/Exclude 切换逻辑                        | P1     | 1.12    | ⏳   |
| 1.14 | 实现 Hover 高亮（复用 element-marker）               | P2     | 1.12    | ⏳   |
| 1.15 | 实现 Hover Tooltip（变更详情）                       | P2     | 1.12    | ⏳   |
| 1.16 | Sidepanel 自动打开（best-effort）                    | P2     | 1.7     | ⏳   |

### Phase 2 任务列表（双向联动）

| #   | 任务                 | 优先级 | 依赖    | 状态 |
| --- | -------------------- | ------ | ------- | ---- |
| 2.1 | 实现补偿交易机制     | P1     | Phase 1 | ⏳   |
| 2.2 | 增加 "Revert" 按钮   | P1     | 2.1     | ⏳   |
| 2.3 | 处理 revert 失败场景 | P2     | 2.2     | ⏳   |

---

## 四、风险点与预案

| 风险                                             | 影响                   | 预案                                   |
| ------------------------------------------------ | ---------------------- | -------------------------------------- |
| chrome.sidePanel.open 在 background 需要用户手势 | 无法自动打开 sidepanel | Best-effort + toolbar 提示用户手动打开 |
| 元素被删除导致 locator 失效                      | 无法高亮/撤销          | UI 显示"元素已不存在"状态              |
| 多 tab 编辑同一网站                              | 状态串线               | 所有消息/存储都带 tabId                |
| Apply 时有 move/structure 类型 tx                | 这些类型不支持 Apply   | 在 chips 上标记"仅本地有效"，不发送    |
| HMR 后 DOM 重建                                  | 修改被覆盖             | 这是预期行为，用户已理解               |
| 高频 merge 导致广播抖动                          | Sidepanel UI 闪烁      | 使用 debounce（100-200ms）             |
| 创建 session 需要 projectId + engineName         | 自动创建失败           | 默认 engineName='claude'               |
| element-marker 高亮默认 2s 自动清除              | hover 时高亮消失       | 改用 keepalive 模式或增加 clear 协议   |

---

## 五、已完成代码详情

### 5.1 消息类型定义 (Phase 1.1) ✅

**文件**: `app/chrome-extension/common/message-types.ts`

新增消息类型：

```typescript
WEB_EDITOR_APPLY_BATCH: 'web_editor_apply_batch',
WEB_EDITOR_TX_CHANGED: 'web_editor_tx_changed',
WEB_EDITOR_HIGHLIGHT_ELEMENT: 'web_editor_highlight_element',
```

### 5.2 数据结构扩展 (Phase 1.1) ✅

**文件**: `app/chrome-extension/common/web-editor-types.ts`

新增类型：

- `WebEditorElementKey` - 稳定元素标识类型
- `NetEffectPayload` - 净效果 payload，用于 batch Apply
- `ElementChangeType` - 变更类型枚举
- `ElementChangeSummary` - 元素变更摘要，用于 Chips 展示
- `WebEditorTxChangeAction` - TX 变化动作类型
- `WebEditorTxChangedPayload` - TX 变化广播 payload
- `WebEditorApplyBatchPayload` - 批量 Apply payload
- `WebEditorHighlightElementPayload` - 高亮元素 payload

扩展 `Transaction` 接口：

```typescript
elementKey?: string;  // 可选，向后兼容
```

### 5.3 elementKey 生成器 (Phase 1.2) ✅

**新文件**: `app/chrome-extension/entrypoints/web-editor-v2/core/element-key.ts`

主要函数：

- `generateStableElementKey(element, shadowHostChain?)` - 生成稳定的元素标识
- `generateElementLabel(element)` - 生成 UI 展示标签
- `generateFullElementLabel(element, shadowHostChain?)` - 生成包含上下文的完整标签
- `isStableIdBasedKey(key)` - 检查 key 是否基于稳定 ID
- `resetElementKeyState()` - 重置状态（测试用）

关键设计：

- 使用 WeakMap 缓存已分配的 key，确保同一元素始终返回相同 key
- 优先使用 `tag#id`，无 id 时使用自增计数器 `tag_N`
- Shadow DOM host 也使用独立的 WeakMap 和计数器
- 不依赖 class 或 selector，避免 class 变化影响 key 稳定性

### 5.4 Transaction 聚合器 (Phase 1.3) ✅

**新文件**: `app/chrome-extension/entrypoints/web-editor-v2/core/transaction-aggregator.ts`

主要函数：

- `aggregateTransactionsByElement(transactions)` - 核心聚合函数
- `hasApplicableChanges(transactions)` - 检查是否有可 Apply 的变更
- `getChangedElementKeys(transactions)` - 获取有变更的元素 key 集合

聚合算法：

1. 按 `elementKey` 分组（fallback 到 `locatorKey`）
2. 对 style 变更：计算净效果（first before → last after），统计 added/removed/modified
3. 对 text 变更：取首尾，生成 beforePreview/afterPreview
4. 对 class 变更：计算 added/removed classes
5. 过滤净效果为无变化的元素
6. 按 updatedAt 排序，最近变更的在前

### 5.5 Apply 流程改造 (Phase 1.4) ✅

**文件**: `app/chrome-extension/entrypoints/web-editor-v2/core/editor.ts`

新增函数：

- `broadcastTxChanged(action)` - 带 100ms debounce 的 TX 变化广播
- `applyAllTransactions()` - 批量 Apply 所有 transactions

关键改动：

1. 在 `handleTransactionChange()` 中调用 `broadcastTxChanged()`
2. toolbar 的 `onApply` 从 `applyLatestTransaction` 改为 `applyAllTransactions`
3. `getApplyBlockReason()` 改为检查所有 tx（而不只是栈顶），支持 class 类型
4. 移除 `getApplyBlockReason()` 中的聚合调用（性能优化），净效果检查在 `applyAllTransactions()` 中进行
5. 在 `stop()` 中清理 debounce timer

广播设计：

- 使用 100ms debounce 避免高频广播
- `tabId` 设为 0，由 background 填充实际值
- background 负责持久化到 `chrome.storage.session`（per-tab key）

---

## 六、待完成工作

### Phase 1.5 - Background 处理 (下一步)

需要在 `background/web-editor/index.ts` 中：

1. 处理 `WEB_EDITOR_TX_CHANGED` 消息
   - 从 `sender.tab.id` 获取 tabId
   - 填充 payload.tabId
   - 持久化到 `chrome.storage.session['web-editor-v2-tx-changed-{tabId}']`
   - 广播到 sidepanel

2. 处理 `WEB_EDITOR_APPLY_BATCH` 消息
   - 尝试打开 sidepanel（带 `?tab=agent-chat` 参数）
   - 从 storage 读取 selectedSessionId
   - 调用 `buildAgentPromptBatch()` 构建批量 prompt
   - 调用 `/agent/chat/:sessionId/act`

3. 新增 `buildAgentPromptBatch(elements)` 函数

### Phase 1.6-1.11 - Sidepanel UI

- Sidepanel URL 参数增加 `tab=agent-chat`
- 监听 `WEB_EDITOR_TX_CHANGED` 消息
- 实现 `WebEditorChanges.vue` 组件
- 实现 `ElementChip.vue` 组件
- Include/Exclude 切换逻辑
- Hover 高亮和 Tooltip

---

## 七、接口契约

### 1. WEB_EDITOR_TX_CHANGED 消息

```typescript
// 发送方: content script (editor.ts)
// 接收方: sidepanel, background
{
  type: 'web_editor_tx_changed',
  payload: WebEditorTxChangedPayload
}
```

### 2. WEB_EDITOR_APPLY_BATCH 消息

```typescript
// 发送方: content script (editor.ts)
// 接收方: background
{
  type: 'web_editor_apply_batch',
  payload: WebEditorApplyBatchPayload
}
```

### 3. batch prompt 格式

```markdown
## Batch Style Changes

### Change 1: div#header

**Selectors:** `#header`, `div.header-container`
**Before:**

- color: #000
- font-size: 14px

**After:**

- color: #333
- font-size: 16px

### Change 2: button.submit

...

## Instructions

Apply all the above style changes to the specified elements.
```
