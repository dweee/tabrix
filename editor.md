# 技术白皮书：AI 驱动的 Web 前端可视化工作台

**Project Codename**: Localhost AR Workbench
**版本**: V3.0 (Final Architecture)
**核心理念**:

1.  **AR 架构**: 视觉层与逻辑层解耦，确保极致性能。
2.  **文件粒度定位**: 利用 LLM 的语义理解能力，降低定位的工程复杂度。
3.  **Lazy AI**: 本地算法优先，云端 AI 兜底。

---

## 1. 原始需求与设计意图 (Intent & Context)

### 1.1 原始问题 (The Problem)

- **割裂的开发体验**: 开发者在 Chrome DevTools 调样式，然后去 IDE 找文件、改代码，来回切换，上下文丢失。
- **Cursor 的局限**: Cursor 虽然强大，但它是基于文本（Code）的，无法直观地调整视觉属性（如 Margin, Flex 布局，阴影），也无法在运行时看到真实数据渲染的效果。
- **现有插件的痛点**: 类似 VisBug 的工具只能临时修改 DOM，刷新即逝，无法持久化到源码；且在 React/Vue 复杂页面中性能极差，交互手感像“玩具”。

### 1.2 产品目标 (The Solution)

构建一个**浏览器插件**，作为覆盖层（Overlay）运行在本地开发环境（Localhost）上。

- **视觉编辑**: 用户可以直接拖拽组件、修改样式、编辑文案。
- **代码落地**: 所有操作通过 AI Agent 自动逆向修改本地源代码，并触发 HMR（热更新）。
- **体验对标**: 达到 Figma/Webflow 级别的流畅度（60FPS）和智能度。

---

## 2. 核心架构设计 (System Architecture)

系统采用 **“三层分离”** 架构，解决性能与逻辑的冲突。

### 2.1 Layer 1: 宿主层 (The Host)

- **内容**: 用户原本运行的网页 (React/Vue/HTML)。
- **状态**: 被“冻结”。在编辑模式下，宿主页面的原生事件被拦截，DOM 仅作为渲染结果的提供者。

### 2.2 Layer 2: 视觉层 (The Visual Overlay)

- **技术栈**: **Canvas (Pixi.js / Konva)**。
- **决策原因**:
  - **性能**: 在万级节点的页面上（如淘宝），用 DOM 做高亮框会触发 Layout Thrashing (布局抖动)，导致卡顿。Canvas 绘制开销与 DOM 数量无关，稳定 60FPS。
  - **隔离**: 视觉元素（标尺、蓝框、残影）不会污染宿主页面的 CSS 继承关系。
  - **能力**: 方便绘制非矩形元素、距离标注红线等设计软件特有的 UI。
- **职责**: 只负责“画画”，不处理逻辑。

### 2.3 Layer 3: 逻辑与控制层 (The Brain)

- **技术栈**: Native JavaScript (Injected Script)。
- **职责**:
  - **定位**: 算出鼠标点到了哪个文件。
  - **交互**: 计算拖拽插入点、去噪算法。
  - **通信**: 将意图打包发给本地 Server。

---

## 3. 关键技术实现细节 (Deep Dive)

### 3.1 定位策略：文件粒度 (File-Level Localization)

**决策变更**: 从“精确行号”降级为“文件粒度”。
**决策原因**:

1.  获取精确行号（SourceMap）成本高、不稳定（Vue SFC 编译后行号偏移）。
2.  LLM 具备极强的语义搜索能力，只要给它文件内容和 DOM 上下文，它能自己找到代码位置。

**实现算法**:
插件遍历选中元素及其父级，寻找框架元数据：

- **React 场景**:
  - 检查 DOM 属性 `__reactFiber$xxxx`。
  - 遍历 Fiber 树：`fiber._debugSource.fileName`。
- **Vue 3 场景**:
  - 检查 DOM 属性 `__vueParentComponent`。
  - 获取 `instance.type.__file`。
- **Node Modules 处理**:
  - **逻辑**: 如果路径包含 `node_modules`，视为无效路径，继续向上遍历父节点。
  - **目的**: 用户点击 Antd Button，我们希望定位到调用 Button 的 `App.tsx`，而不是 Antd 的源码包。
- **兜底策略 (纯 HTML/老项目)**:
  - 如果找不到路径，提取 **DOM 指纹**（TagName + ID + Class + 关键文本）。
  - Payload: `{ type: "fingerprint_search", snippet: "..." }`。让后端用 `ripgrep` 全局搜。

### 3.2 智能选择与去噪 (Smart Selection Heuristics)

**问题**: 网页中充斥着用于布局的 Wrapper Div（无背景、无边框），用户很难选中真正的“卡片”。
**技术实现**:

1.  **穿透规则 (Passthrough Rule)**:
    - 当 `mousemove` 命中元素 `el` 时，检查：
      ```javascript
      const style = getComputedStyle(el);
      const isTransparent =
        style.backgroundColor === 'rgba(0, 0, 0, 0)' && style.borderWidth === '0px';
      const isSameSize = Math.abs(elRect.width - childRect.width) < 2;
      ```
    - 如果满足条件，**忽略当前元素**，递归检查其子元素，直到找到“实体”。
2.  **组件识别**:
    - 利用 DOM 结构哈希，识别页面中重复的结构。
    - 交互：选中一个 Item，Canvas 用虚线框出其他所有同类 Item。

### 3.3 事件接管与隔离 (Event Interception)

**问题**: 编辑模式下，点击“提交”按钮不应触发 Form 提交。
**技术实现**:

1.  **捕获阶段拦截 (Capture Phase)**:
    ```javascript
    window.addEventListener(
      'click',
      (e) => {
        if (!isEditingMode) return;
        e.stopPropagation(); // 阻止冒泡
        e.preventDefault(); // 阻止默认行为
        // 执行选中逻辑
      },
      true,
    ); // true = 开启捕获
    ```
2.  **Shadow DOM 穿透**:
    - 原生 `elementFromPoint` 遇到 Shadow Root 会停止。
    - **解决方案**: 使用 `event.composedPath()` 获取完整的冒泡路径，取路径中第一个非 ShadowRoot 的节点。

### 3.4 React/Vue 重渲染与一致性 (Optimistic UI)

**问题**: 用户拖拽修改了 DOM，React 状态更新触发重渲染，DOM 被重置，导致“闪烁”。
**技术实现**:

1.  **样式修改 (Style)**:
    - 直接修改 DOM `style` 属性。React 重渲染虽会覆盖，但 HMR 通常紧随其后，闪烁可接受。
2.  **结构修改 (Layout/Drag) - 幽灵模式**:
    - **严禁**直接操作真实 DOM (如 `insertBefore`)，这会导致 React 崩溃。
    - **策略**:
      - 拖拽时：Canvas 绘制“幽灵节点”跟随。
      - 松手时：**保持 Canvas 上的幽灵节点显示**，真实 DOM 不动。
      - 生效时：AI 修改源码 -> HMR 触发 -> 真实 DOM 变动 -> 移除 Canvas 幽灵。

### 3.5 坐标系统 (The Coordinate System)

**问题**: 页面 Zoom、High DPI 屏幕、Transform 导致 Canvas 对不齐。
**技术实现**:

- 统一坐标公式：
  ```javascript
  CanvasX = (ClientX + Window.scrollX) * window.devicePixelRatio;
  CanvasY = (ClientY + Window.scrollY) * window.devicePixelRatio;
  ```
- **Iframe 处理**:
  - 同源：脚本注入 Iframe 内部。
  - 跨域：UI 提示不可编辑。

---

## 4. 后端 Agent 执行逻辑 (The Executor)

**核心变更**: 不再依赖复杂的 AST 分析脚本，完全依赖 LLM。

### 4.1 数据协议 (The Payload)

前端发送给本地 Server 的 JSON 包：

```json
{
  "projectRoot": "/Users/dev/my-app",
  "targetFile": "src/components/UserProfile.tsx", // 优先使用文件路径
  "fallbackFingerprint": {
    // 如果没有文件路径，用这个搜
    "tag": "div",
    "classes": ["card", "p-4"],
    "text": "User Settings"
  },
  "instruction": {
    "type": "update_style",
    "description": "Change background color to soft gray (#f3f4f6)"
  },
  "techStackHint": ["Tailwind", "React"] // 前端探测到的技术栈
}
```

### 4.2 Agent 工作流 (The AI Workflow)

1.  **定位**:
    - 有 `targetFile` -> 直接读取文件内容。
    - 无 `targetFile` -> 使用 `ripgrep` 搜索 `fallbackFingerprint.text` 或 `classes` 找到文件。
2.  **Prompt 构建**:
    > "你是一个前端专家。我将给你一个 React 组件文件。
    > **任务**: 找到包含文本 'User Settings' 且类名为 'card' 的 `div`。
    > **修改**: 将其背景色改为软灰色。
    > **约束**: 检测文件是否使用 Tailwind。如果是，添加 `bg-gray-100`；如果是 CSS Modules，修改对应 .css 文件；如果是内联样式，修改 style 属性。
    > **输出**: 仅输出修改后的文件代码。"
3.  **写入**: 覆盖原文件 -> 触发 Webpack/Vite HMR。

---

## 5. 开发路线图 (Implementation Roadmap)

### Phase 1: 视觉与交互原型 (The "Lens")

- **目标**: 实现不卡顿的高亮与选中。
- **任务**:
  1.  搭建 Shadow DOM + Canvas 基础架构。
  2.  实现坐标转换与 `requestAnimationFrame` 渲染循环。
  3.  实现“去噪算法”，确保鼠标能精准吸附到卡片而非容器。
  4.  实现事件拦截，确保点击页面不跳转。

### Phase 2: 定位与通信 (The "Bridge")

- **目标**: 打通 浏览器 -> 本地文件系统 的链路。
- **任务**:
  1.  编写 `getFileSource` 算法 (React Fiber / Vue Instance 探测)。
  2.  搭建本地 Node.js Server + WebSocket。
  3.  实现“Node Modules 跳出”逻辑。

### Phase 3: AI 闭环 (The "Brain")

- **目标**: 实现样式与内容的真实修改。
- **任务**:
  1.  接入 LLM API (OpenAI/Claude)。
  2.  设计并调优 Prompt，专门处理 Tailwind、CSS-in-JS 等不同场景。
  3.  实现 HMR 后的 Canvas 状态同步 (避免 HMR 时高亮框错位)。

---

## 6. 总结 (Conclusion)

本项目通过 **“文件粒度定位”** 大幅降低了工程落地的复杂度，通过 **“Canvas 渲染层”** 解决了前端插件常见的性能瓶颈，通过 **“Lazy AI”** 策略平衡了成本与智能。这套架构在理论上完全可行，且能够提供远超现有开源工具的商业级体验。
