# 元素标注功能优化计划

> 目标：打造商业级应用的丝滑体验，统一高亮/选择能力，重构管理界面

## 一、问题诊断总结

### 1.1 性能问题（严重）

| 问题                                        | 位置                              | 影响                                     |
| ------------------------------------------- | --------------------------------- | ---------------------------------------- |
| mousemove 未节流                            | `element-marker.js:1761`          | 每帧触发，大页面卡顿明显                 |
| hover 时频繁计算 selector                   | `element-marker.js:1797` (iframe) | `generateSelector()` 每帧执行全 DOM 遍历 |
| `isDeepSelectorUnique()` 全 DOM+Shadow 遍历 | `element-marker.js:1479`          | 单次调用可遍历上万节点                   |
| listMode 每帧重建所有高亮 div               | `element-marker.js:1649`          | `innerHTML=''` + N 次 `appendChild`      |
| 遗留 console.log                            | `element-marker.js:1633`          | 刷屏影响性能与可观测性                   |

### 1.2 Bug 与隐患

| 问题                            | 位置                                                             | 影响                               |
| ------------------------------- | ---------------------------------------------------------------- | ---------------------------------- |
| 注入脚本无幂等保护              | `background/element-marker/index.ts:65`, `sidepanel/App.vue:799` | 重复注入导致监听器叠加、内存泄漏   |
| 编辑走 SAVE 导致 createdAt 重置 | `element-marker-storage.ts:40`, `sidepanel/App.vue:717`          | 更新语义不清，数据异常             |
| UPDATE 消息定义了但未使用       | `message-types.ts:51`                                            | 协议与实现不一致                   |
| 存储查询未使用索引              | `element-marker-storage.ts:40`                                   | `getAll()` 后 filter，标注量大时慢 |

### 1.3 能力重叠问题

`element-marker` 与 `web-editor-v2` 存在大量功能重叠：

| 能力            | element-marker     | web-editor-v2           | 建议             |
| --------------- | ------------------ | ----------------------- | ---------------- |
| Hover 高亮      | DOM div + 无节流   | Canvas + rAF 节流       | **统一到 v2**    |
| Selection 高亮  | DOM div            | Canvas                  | **统一到 v2**    |
| Shadow DOM 选择 | composedPath       | composedPath + 智能评分 | **统一到 v2**    |
| Selector 生成   | 自实现 + 深度遍历  | locator 系统            | **统一到 v2**    |
| iframe 支持     | postMessage bridge | 未实现                  | **在 v2 中实现** |

### 1.4 UI 风格不一致

- 元素标注管理使用独立的 `.em-*` 样式体系
- 智能助手使用 `agent-theme` token 系统（`--ac-*` 变量）
- 两者在颜色、圆角、阴影、交互节奏上不统一

---

## 二、能力归属设计

### 2.1 沉入 web-editor-v2 内核（通用能力）

| 能力                | 当前状态  | 改造要点                           |
| ------------------- | --------- | ---------------------------------- |
| Hover 高亮 (60FPS)  | ✅ 已实现 | 作为唯一实现，提供服务化接口       |
| Selection 高亮      | ✅ 已实现 | 支持多 rect 模式                   |
| Canvas Overlay      | ✅ 已实现 | 扩展 `setRects()` / `flashRects()` |
| 事件控制 (rAF 节流) | ✅ 已实现 | 提供 Marker Pick Mode              |
| 智能选中引擎        | ✅ 已实现 | 复用评分系统                       |
| Locator 生成/解析   | ✅ 已实现 | 作为标准定位能力                   |
| iframe 跨帧支持     | ❌ 未实现 | **需新增**（最大缺口）             |

### 2.2 保留在 element-marker 业务层

| 能力                     | 说明                              |
| ------------------------ | --------------------------------- |
| Marker 存储 (CRUD)       | IndexedDB + URL 匹配策略          |
| Marker 校验 (MCP 工具链) | hover/click/type/keys/scroll 动作 |
| read_page 优先提示       | markedElements 作为高优先级 hints |
| 管理界面 (Sidepanel)     | **需按 agent-theme 重写**         |

### 2.3 需要新增

| 能力                 | 说明                                      |
| -------------------- | ----------------------------------------- |
| 统一选择器解析层     | 合并 3 套重复实现，首选 v2 locator        |
| HighlightService     | v2 提供的高亮服务（不进入编辑模式也可用） |
| iframe hit-test 协议 | builder-plan 已设计，需实现               |

---

## 三、重构路线图

### Phase 0：止血（性能 + 幂等 + 明显 bug）✅ 已完成

**优先级：P0（立即执行）**

#### 任务 0.1：mousemove 性能优化 ✅

- [x] 在 `element-marker.js` 中添加 rAF 节流
- [x] 仅在 hover 目标变化时更新 UI
- [x] iframe hover 消息不再携带 `innerSel`（selector 延迟到 click 时计算）

**改造文件：**

- `app/chrome-extension/inject-scripts/element-marker.js:1761`

**代码示例：**

```javascript
let hoverRafId = null;
let lastHoverTarget = null;

function onMouseMove(ev) {
  if (!STATE.active) return;
  const target = getDeepPageTarget(ev) || ev.target;
  if (target === lastHoverTarget) return; // 目标未变化，跳过

  if (hoverRafId !== null) return;
  hoverRafId = requestAnimationFrame(() => {
    hoverRafId = null;
    lastHoverTarget = target;
    // ... 实际更新逻辑
  });
}
```

#### 任务 0.2：listMode 高亮优化 ✅

- [x] 实现 DOM 节点池化复用
- [x] 避免每帧 `innerHTML = ''` 重建
- [x] 添加最大池大小限制 (100)

**改造文件：**

- `app/chrome-extension/inject-scripts/element-marker.js:1649`

#### 任务 0.3：注入幂等保护 ✅

- [x] 注入前先发送 `element_marker_ping` 检测
- [x] 脚本内添加全局初始化 guard（已有）
- [x] 统一 background 和 sidepanel 的注入逻辑
- [x] 添加 300ms 超时防止 sendMessage 悬挂

**改造文件：**

- `app/chrome-extension/entrypoints/background/element-marker/index.ts:65`
- `app/chrome-extension/entrypoints/sidepanel/App.vue:799`
- `app/chrome-extension/inject-scripts/element-marker.js` (添加 guard)

**代码示例：**

```typescript
// background/element-marker/index.ts
async function ensureInjected(tabId: number): Promise<boolean> {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'element_marker_ping' });
    return pong?.type === 'element_marker_pong';
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['inject-scripts/element-marker.js'],
    });
    return true;
  }
}
```

#### 任务 0.4：修复存储 bug ✅

- [x] 编辑时使用 `ELEMENT_MARKER_UPDATE` 而非 `SAVE`
- [x] 保留 `createdAt`，更新 `updatedAt`
- [x] 添加 fallback 处理 existingMarker 找不到的情况

**改造文件：**

- `app/chrome-extension/entrypoints/sidepanel/App.vue:717`
- `app/chrome-extension/entrypoints/background/element-marker/element-marker-storage.ts:40`

#### 任务 0.5：清理调试日志 ✅

- [x] 移除 `clearHighlighter` 中的 `console.log`
- [x] 移除 `verifyHighlightOnly` 中的调试日志

**改造文件：**

- `app/chrome-extension/inject-scripts/element-marker.js:1633`

**验收标准：**

- [ ] 大页面 hover 流畅，无明显卡顿
- [ ] iframe hover 不再触发 selector 生成
- [ ] 多次点击"高亮/验证"不造成监听器叠加
- [ ] 编辑 marker 不会重置 createdAt

---

### Phase 1：抽出统一高亮服务

**优先级：P1**

#### 任务 1.1：扩展 CanvasOverlay 接口

- [ ] 添加 `setRects(rects: ViewportRect[], style: RectStyle)` 方法
- [ ] 添加 `flashRects(rects: ViewportRect[], style: RectStyle, duration: number)` 方法
- [ ] 支持多种绘制风格（hover/selection/highlight/验证成功/验证失败）

**改造文件：**

- `app/chrome-extension/entrypoints/web-editor-v2/overlay/canvas-overlay.ts`

**接口设计：**

```typescript
export interface CanvasOverlay {
  // 现有接口
  setHoverRect(rect: ViewportRect | null): void;
  setSelectionRect(rect: ViewportRect | null): void;

  // 新增接口
  setRects(rects: ViewportRect[], style?: RectStyle): void;
  flashRects(rects: ViewportRect[], style: RectStyle, duration?: number): void;
  clearRects(): void;
}

export interface RectStyle {
  strokeColor: string;
  fillColor?: string;
  strokeWidth?: number;
  dashPattern?: number[];
  cornerRadius?: number;
}
```

#### 任务 1.2：创建 HighlightService

- [ ] 封装高亮能力为独立服务
- [ ] 支持在非编辑模式下使用
- [ ] 提供 API 给 element-marker 调用

**新建文件：**

- `app/chrome-extension/entrypoints/web-editor-v2/services/highlight-service.ts`

**接口设计：**

```typescript
export interface HighlightService {
  highlight(selector: string | ElementLocator, options?: HighlightOptions): Promise<void>;
  highlightElements(elements: Element[], options?: HighlightOptions): void;
  flash(selector: string | ElementLocator, options?: FlashOptions): Promise<void>;
  clear(): void;
  dispose(): void;
}

export interface HighlightOptions {
  style?: RectStyle;
  scroll?: boolean;
  duration?: number;
}
```

#### 任务 1.3：统一高亮入口

- [ ] Sidepanel 的"高亮"操作统一走 HighlightService
- [ ] element-marker 的 DOM 高亮作为 fallback（短期）

**改造文件：**

- `app/chrome-extension/entrypoints/sidepanel/App.vue`
- `app/chrome-extension/entrypoints/background/element-marker/index.ts`

**验收标准：**

- [ ] 同一套渲染风格覆盖：hover、select、verify、多匹配 listMode
- [ ] Canvas 绘制性能稳定，60FPS

---

### Phase 2：统一定位模型

**优先级：P1**

#### 任务 2.1：扩展 ElementMarker 数据模型

- [ ] 升级 DB_VERSION
- [ ] 添加新字段：`enabled`, `locator`, `lastValidatedAt`, `lastValidation`, `tags`

**改造文件：**

- `app/chrome-extension/common/element-marker-types.ts`
- `app/chrome-extension/entrypoints/background/element-marker/element-marker-storage.ts`

**数据模型：**

```typescript
export interface ElementMarker {
  id: string;
  name: string;
  url: string;

  // 旧字段（向后兼容）
  selector: string;
  selectorType: 'css' | 'xpath';
  matchType: 'exact' | 'prefix' | 'host';

  // 新字段
  enabled: boolean;
  locator?: ElementLocator; // 结构化定位器
  lastValidatedAt?: number;
  lastValidation?: {
    ok: boolean;
    error?: string;
    matchCount?: number;
  };
  tags?: string[];

  createdAt: number;
  updatedAt: number;
}
```

#### 任务 2.2：实现数据迁移

- [ ] 编写迁移脚本，为旧数据添加默认值
- [ ] 实现渐进式 backfill 能力

#### 任务 2.3：优先使用 locator 定位

- [ ] 新建 marker 时自动生成 locator
- [ ] 验证时优先使用 locator，fallback 到 selector
- [ ] UI 展示定位来源，支持"重新采集"

**验收标准：**

- [ ] Shadow DOM 元素可稳定复定位
- [ ] 旧数据无损迁移
- [ ] 定位优先级清晰：locator > selector

---

### Phase 3：跨 iframe 统一

**优先级：P2**

#### 任务 3.1：实现 FrameAgent

- [ ] 为每个 frame 注入轻量 agent
- [ ] 负责采集 hover/点击、计算本 frame 内目标

**新建文件：**

- `app/chrome-extension/inject-scripts/frame-agent.js`

#### 任务 3.2：实现跨帧通信协议

- [ ] 定义 `web_editor_hit_test` 请求/响应消息
- [ ] 实现坐标系转换（iframe offset 累加）
- [ ] 支持 nested iframe

**协议设计：**

```typescript
interface FrameHitTestRequest {
  type: 'web_editor_hit_test';
  x: number;
  y: number;
  requestId: string;
}

interface FrameHitTestResponse {
  type: 'web_editor_hit_test_result';
  requestId: string;
  element: SerializedElement | null;
  rect: DOMRect | null;
  frameChain: string[];
}
```

#### 任务 3.3：v2 支持 iframe 高亮

- [ ] background 注入支持 `allFrames: true`
- [ ] locator 解析支持 `frameChain`
- [ ] CanvasOverlay 支持跨 frame rect 绘制

**改造文件：**

- `app/chrome-extension/entrypoints/background/web-editor/index.ts:530`
- `app/chrome-extension/entrypoints/web-editor-v2/core/locator.ts:689`

**验收标准：**

- [ ] nested iframe 内 hover/选择/高亮全通
- [ ] 坐标不漂移
- [ ] 跨域 iframe 有明确提示

---

### Phase 4：element-marker 瘦身

**优先级：P3**

#### 任务 4.1：实现 Marker Pick Mode

- [ ] 在 v2 的模式系统中添加 "Marker Pick Mode"
- [ ] 复用 EventController + SelectionEngine + Locator + CanvasOverlay

#### 任务 4.2：迁移选取逻辑

- [ ] element-marker 的选取逻辑迁移到 v2
- [ ] 保留 element-marker 的兼容处理

#### 任务 4.3：逐步下线 element-marker.js

- [ ] 评估可删除的代码范围
- [ ] 制定下线时间表

**验收标准：**

- [ ] 选取体验与 web-editor-v2 一致
- [ ] element-marker.js 从"核心实现"变成"可选兼容层"

---

## 四、UI 重写方案

### 4.1 设计规范

#### 必须遵循的 agent-theme 规范

所有颜色、阴影、圆角、字体只使用 token 变量：

```css
/* 引用方式 */
.marker-container {
  background: var(--ac-bg);
  color: var(--ac-text);
  border: 1px solid var(--ac-border);
  border-radius: var(--ac-radius-card);
  box-shadow: var(--ac-shadow-card);
}

/* 关键 token */
--ac-bg: #fdfcf8; /* 背景色 */
--ac-surface: #ffffff; /* 卡片表面 */
--ac-text: #1a1a1a; /* 主文本 */
--ac-text-muted: #78716c; /* 次要文本 */
--ac-border: #e7e5e4; /* 边框 */
--ac-accent: #d97757; /* 强调色 */
--ac-success: #22c55e; /* 成功 */
--ac-danger: #ef4444; /* 危险 */
--ac-radius-card: 12px; /* 卡片圆角 */
--ac-motion-fast: 120ms; /* 快速动效 */
```

#### 页面容器要求

```vue
<div class="agent-theme" :data-agent-theme="themeState.theme.value">
  <!-- 内容 -->
</div>
```

### 4.2 组件结构设计

```
ElementMarkersPage.vue          # 页级容器
├── MarkerToolbar.vue           # 工具栏（搜索、过滤）
├── MarkerForm.vue              # 新增/编辑表单
├── MarkerList.vue              # 分组列表
│   └── MarkerGroup.vue         # 域名分组
│       └── MarkerRow.vue       # 单条 marker
└── MarkerBulkActions.vue       # 批量操作
```

#### 组件职责

| 组件                     | 职责                                                   |
| ------------------------ | ------------------------------------------------------ |
| `ElementMarkersPage.vue` | 页面布局、状态管理、协调子组件                         |
| `MarkerToolbar.vue`      | 搜索框、过滤器（scope/matchType/selectorType/enabled） |
| `MarkerForm.vue`         | 新增/编辑表单，支持"从页面选取"                        |
| `MarkerList.vue`         | 虚拟滚动列表，按 domain → url 分组                     |
| `MarkerRow.vue`          | 单条展示（状态徽章 + 操作按钮）                        |
| `MarkerBulkActions.vue`  | 批量验证/导出/启用禁用                                 |

### 4.3 交互模式优化

#### 状态展示完善

- [ ] 显示 `updatedAt`、`lastValidatedAt`
- [ ] 显示 `matchCount`（验证时匹配到的元素数）
- [ ] 状态徽章：enabled/disabled、验证成功/失败/未验证

#### 一键能力

- [ ] "只看当前页面可用标注"
- [ ] "批量验证当前域名/当前页面"
- [ ] "导入/导出 JSON"

#### 质量控制

- [ ] 编辑时不允许误改 URL 归属
- [ ] 对 iframe/shadow 的 marker 展示定位来源
- [ ] 提供"重新采集"功能

### 4.4 UI 任务拆解

#### 任务 UI.1：创建基础组件

- [ ] 新建 `ElementMarkersPage.vue`
- [ ] 应用 `agent-theme` 样式
- [ ] 实现 Shell 布局（header/content/footer）

#### 任务 UI.2：实现 MarkerToolbar

- [ ] 搜索框（名称/选择器模糊搜索）
- [ ] 范围过滤（当前页面/当前域名/全部）
- [ ] 状态过滤（启用/禁用/全部）
- [ ] 类型过滤（CSS/XPath/全部）

#### 任务 UI.3：实现 MarkerForm

- [ ] 表单字段：名称、选择器类型、匹配类型、选择器
- [ ] "从页面选取"按钮（调用 Marker Pick Mode）
- [ ] 表单验证
- [ ] 保存/取消操作

#### 任务 UI.4：实现 MarkerList

- [ ] 按 domain 分组折叠
- [ ] 虚拟滚动（大数据量优化）
- [ ] 空状态展示

#### 任务 UI.5：实现 MarkerRow

- [ ] 信息展示：名称、选择器、标签、时间戳
- [ ] 状态徽章：enabled、lastValidation
- [ ] 操作按钮：高亮、验证、编辑、删除、启用/禁用

#### 任务 UI.6：实现批量操作

- [ ] 批量选择
- [ ] 批量验证
- [ ] 批量启用/禁用
- [ ] 批量删除（需确认）
- [ ] 导出 JSON
- [ ] 导入 JSON

---

## 五、关键文件索引

### 需要修改的文件

| 文件                                                  | 改动类型           | 优先级 |
| ----------------------------------------------------- | ------------------ | ------ |
| `inject-scripts/element-marker.js`                    | 性能优化、幂等保护 | P0     |
| `background/element-marker/index.ts`                  | 注入逻辑、消息处理 | P0     |
| `background/element-marker/element-marker-storage.ts` | 存储 bug 修复      | P0     |
| `sidepanel/App.vue`                                   | 注入逻辑、消息调用 | P0     |
| `web-editor-v2/overlay/canvas-overlay.ts`             | 扩展接口           | P1     |
| `web-editor-v2/core/locator.ts`                       | iframe 支持        | P2     |
| `background/web-editor/index.ts`                      | allFrames 注入     | P2     |
| `common/element-marker-types.ts`                      | 数据模型扩展       | P1     |

### 需要新建的文件

| 文件                                          | 用途           | 优先级 |
| --------------------------------------------- | -------------- | ------ |
| `web-editor-v2/services/highlight-service.ts` | 统一高亮服务   | P1     |
| `inject-scripts/frame-agent.js`               | 跨帧通信 agent | P2     |
| `sidepanel/pages/ElementMarkersPage.vue`      | 新管理界面     | P1     |
| `sidepanel/components/marker/*.vue`           | UI 组件        | P1     |

---

## 六、验收清单

### Phase 0 验收

- [ ] 大页面 hover 流畅（60FPS）
- [ ] iframe hover 无卡顿
- [ ] 无监听器叠加
- [ ] 编辑不重置 createdAt

### Phase 1 验收

- [ ] HighlightService 可用
- [ ] Canvas 统一渲染 hover/selection/verify
- [ ] Sidepanel 高亮走新服务

### Phase 2 验收

- [ ] 新数据模型上线
- [ ] Shadow DOM 稳定定位
- [ ] 旧数据平滑迁移

### Phase 3 验收

- [ ] iframe 内元素可选择
- [ ] nested iframe 支持
- [ ] 跨域提示友好

### Phase 4 验收

- [ ] Marker Pick Mode 可用
- [ ] element-marker.js 可选化

### UI 重写验收

- [ ] 风格与智能助手一致
- [ ] 功能完整（CRUD + 批量 + 导入导出）
- [ ] 交互流畅

---

## 七、风险与注意事项

1. **向后兼容**：数据模型变更需要迁移脚本，确保旧数据不丢失
2. **跨域限制**：iframe 跨域场景需要明确提示，不能静默失败
3. **性能回归**：每次改动后需要在大页面上测试 hover 性能
4. **渐进式发布**：建议按 Phase 分批发布，降低风险
5. **消息安全**：postMessage 需要做来源校验，防止恶意注入

---

## 八、参考资料

- `builder-plan.md`：高亮/选择系统设计
- `app/chrome-extension/entrypoints/sidepanel/styles/agent-chat.css`：agent-theme token 定义
- `app/chrome-extension/entrypoints/sidepanel/components/AgentChat.vue`：智能助手 UI 参考
