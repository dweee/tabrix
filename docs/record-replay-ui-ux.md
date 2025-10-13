# 录制回放 UI/UX 重构说明

目标：极简入口、分离关注点，避免 Popup 页面堆叠，确保可用性与可维护性。

关键改动

- Popup 仅保留三项：`开始录制`、`停止并保存`、`工作流管理`（打开侧边栏）。
- 新增侧边栏页面 `sidepanel.html`：专注工作流列表、搜索与基础操作（回放、编辑、删除、新建）。
- 新增独立编辑器页面 `builder.html`：以新窗口打开，全屏画布编辑，避免在 Popup 内挤压空间。
- 录制器在页面端以浮层呈现（暂停/停止/隐藏输入值），交互更直接。

文件入口

- Popup：`app/chrome-extension/entrypoints/popup/App.vue`
- 侧边栏：`app/chrome-extension/entrypoints/sidepanel/App.vue`
- 编辑器（新窗口）：`app/chrome-extension/entrypoints/builder/App.vue`
- Manifest 配置：`app/chrome-extension/wxt.config.ts`

使用方式

1. 点击 Popup 中的“开始录制”开始；页面右上角出现红色录制浮层，可直接暂停/停止。
2. 点击“工作流管理”打开侧边栏，浏览/搜索工作流，点击“新建/编辑”将以新窗口打开编辑器。
3. 编辑器支持撤销/重做、自动排版、自适应视图、导入/导出、从选中节点回放与整流回放，保存实时写入。

主题与视觉

- 新增轻/暗双主题，编辑器右上角可切换，偏好会缓存到 `localStorage(rr-theme)`。
- 引入统一的设计令牌（CSS Variables）：背景、卡片、边框、文本、品牌色与状态色，贯穿 Sidebar/Canvas/属性面板。
- 节点卡片视觉：圆角卡片、悬停显隐操作区、类型彩色徽标与简洁摘要，连接点采用低干扰圆点风格。

注意事项与后续项

- 侧边栏当前样式与 Popup 共用基础变量，后续可进一步对齐视觉规范（参考图 3）。
- 运行记录、发布、定时等高级操作迁移到侧边栏后续子页或编辑器内页，避免 Popup 复用逻辑过多。
- 若需要编程打开侧边栏，已在 Popup 内提供 `openWorkflowSidepanel()` 示例。
