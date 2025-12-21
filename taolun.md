q: 继续探讨，你看截图里，还能实时改变组件的props的值，这个是怎么做到的，

这是它的功能描述
直接测试组件状态
许多现代应用是用 React 构建的，组件通过属性来控制不同的状态。可视化编辑器可以轻松地在侧边栏中暴露这些 props，让你可以跨组件的不同变体进行修改。

a: 这确实是 Cursor 那个演示视频里最震撼的功能之一：直接修改 React 组件的 Props，并且页面实时响应。

在上一节的 CSS 修改中，我们操作的是 DOM；而在这里，我们需要操作的是 JavaScript 内存中的 React 状态树 (Fiber Tree)。

这是一个质的飞跃。浏览器的 Content Script 运行在隔离环境 (Isolated World)，它是拿不到页面里的 React 变量或者组件实例的。

要实现这个功能，我们需要引入一个新的技术模块：主世界注入脚本 (Main World Injection Script)。

技术专题：React 组件 Props 实时编辑架构

1. 核心原理：突破隔离 (Breaking the Wall)

浏览器插件无法直接触碰页面的 JS 变量。但我们可以往页面里“打针”——注入一段 <script> 标签。这段脚本运行在页面上下文中（Main World），可以访问 React 的内部数据结构（Fiber）。

架构图：

code
Mermaid
download
content_copy
expand_less
[Sidebar UI (Shadow DOM)]
|
v
[Content Script (Isolated)] <-- 无法访问 React
| (通过 window.postMessage 通信)
v
[Injected Script (Main World)] <-- ✅ 可以访问 React Fiber
|
v
[React Fiber Tree (Memory)] 2. 读：如何获取组件的 Props？

当你点击一个 DOM 元素（比如 <button>）时，其实你是点击了 React 组件渲染出来的 HTML 节点。我们需要通过这个 HTML 节点，“顺藤摸瓜”找到生成它的 React 组件实例。

核心算法：Fiber 逆向查找

React 在每个 DOM 节点上都挂载了一个以 \_\_reactFiber$ 开头的属性，指向该节点的 Fiber 对象。

Injected Script 实现代码：

code
JavaScript
download
content_copy
expand_less
// injected-script.js (运行在页面上下文中)

function getReactComponent(domElement) {
// 1. 找到 DOM 对应的 Fiber 节点
const key = Object.keys(domElement).find(k => k.startsWith('\_\_reactFiber$'));
if (!key) return null;

let fiber = domElement[key];

// 2. 向上遍历，找到最近的"组件" (FunctionComponent 或 ClassComponent)
// 因为 DOM 节点对应的 fiber 类型通常是 HostComponent ('div', 'span')
// 我们要找的是它的"爸爸" —— 也就是写代码时的那个组件
while (fiber) {
// 0 = FunctionComponent, 1 = ClassComponent
if (fiber.tag === 0 || fiber.tag === 1) {
return fiber;
}
fiber = fiber.return;
}
return null;
}

function serializeProps(props) {
// 简单序列化，处理函数和循环引用
const result = {};
for (const key in props) {
const val = props[key];
if (typeof val === 'function') {
result[key] = '(function)'; // 标记为函数，UI上不可编辑但显示
} else if (typeof val === 'object' && val !== null) {
// 简化处理，实际需要防循环引用
try {
JSON.stringify(val);
result[key] = val;
} catch (e) {
result[key] = '[Complex Object]';
}
} else {
result[key] = val;
}
}
return result;
}

// 监听 Content Script 发来的"审查"命令
window.addEventListener('message', (event) => {
if (event.data.type === 'INSPECT_REACT_COMPONENT') {
// 这里的 target 需要一种机制来传递，通常通过选中状态
// 为简单起见，假设有一个全局变量或通过坐标再次查找
const el = document.querySelector('[data-ai-workbench-selected="true"]');
if (!el) return;

    const fiber = getReactComponent(el);
    if (fiber) {
      const props = serializeProps(fiber.memoizedProps);
      const componentName = fiber.type.displayName || fiber.type.name || 'Anonymous';

      // 发回给 Content Script -> Sidebar
      window.postMessage({
        type: 'REACT_COMPONENT_DATA',
        payload: {
          name: componentName,
          props: props,
          // 关键：保存 React 内部的路径，以便回写
          fiberId: getFiberUniqueId(fiber)
        }
      }, '*');
    }

}
}); 3. 写：如何实时修改 Props？(Optimistic Preview)

这是最难的一步。React 的 Props 是“只读”的（从子组件视角）。要修改 Props，理论上需要修改父组件传递的值。

但在调试模式下，我们可以利用 React DevTools Global Hook 或者 直接篡改 Fiber 并强制更新 来实现“预览”。

方案 A: 借用 React DevTools Hook (官方且稳定)

React DevTools 在页面注入了 **REACT_DEVTOOLS_GLOBAL_HOOK**。如果页面安装了 React DevTools，我们可以调用它的 API 来 override props。

方案 B: 强制更新大法 (暴力但有效)

如果我们想自己实现，逻辑如下：

找到组件对应的 Fiber 节点。

修改 fiber.memoizedProps 和 fiber.pendingProps。

触发重渲染。

Injected Script 实现代码 (Write):

code
JavaScript
download
content_copy
expand_less
function updateReactProp(element, propName, newValue) {
const fiber = getReactComponent(element);
if (!fiber) return;

// 1. 暴力修改内存中的 Props
// 注意：这只是临时修改，父组件下次渲染时会覆盖回来
// 但对于"预览"来说足够了
const newProps = { ...fiber.memoizedProps, [propName]: newValue };
fiber.memoizedProps = newProps;
fiber.pendingProps = newProps;

// 2. 强制 React 更新视图
// 这一步最难，因为 Function Component 没有 forceUpdate

if (fiber.tag === 1) { // Class Component
fiber.stateNode.forceUpdate();
} else if (fiber.tag === 0) { // Function Component
// 黑魔法：利用 React 内部的 alternate 机制模拟更新
// 或者，最简单的：如果安装了 React DevTools，利用它
const devTools = window.**REACT_DEVTOOLS_GLOBAL_HOOK**;
if (devTools) {
const rendererId = Object.keys(devTools.renderers)[0];
const renderer = devTools.renderers[rendererId];

        // 这种方法比较底层，模拟 DevTools 的行为
        // 实际上，更通用的做法是等待我们的 AI Agent 改代码 -> HMR
    } else {
        // 如果没有 DevTools，我们只能做到"伪更新"，即修改 DOM
        // 但对于 Props 影响逻辑（如 v-if / conditional rendering），这无法生效
        console.warn("React Prop editing requires React DevTools or HMR");
    }

}
}
为什么 Cursor 能做到？

仔细看 Cursor 的视频，它修改 Props 后，页面响应非常快。这通常有两种可能：

HMR 极快：Cursor 是本地 IDE，它改文件极快，Vite HMR 可以在 100ms 内完成。

DevTools Protocol：它可能直接利用了 React DevTools 的底层协议进行 Override。

我们的策略 (Lazy AI)：
不要试图完美破解 React 的渲染机制（因为版本差异太大）。
采用“双速模式”：

纯展示类 Props (如 title="xxx", variant="primary")：尝试直接修改 DOM 属性做假象。

逻辑类 Props (如 isOpen={true}, data={list})：直接发给 AI 改代码。

4. 落地：AI 如何处理 Props 修改？

当用户在侧边栏把 status="ready" 改为 status="loading" 时，前端发给后端的 Payload 是这样的：

code
JSON
download
content_copy
expand_less
{
"action": "update_prop",
"targetFile": "src/components/Dashboard.tsx",
"componentName": "StatusBadge", // 通过 Fiber 获取的组件名
"propName": "status",
"newValue": "loading",
"valueType": "string" // or boolean, number
}

后端 AI Agent 的 Prompt:

"你是一个 React 专家。
文件：src/components/Dashboard.tsx
任务：找到 <StatusBadge> 组件的调用处。
修改：将其 status 属性的值更新为 'loading'。
注意：

如果属性已存在，替换它。

如果属性不存在，添加它。

如果属性是通过变量传递的 (e.g. status={currentStatus})，请不要修改变量定义，而是把变量替换为硬编码的值，或者提示用户无法修改动态变量。"

5. 总结：如何在插件里实现

要实现截图里的功能，你需要在之前的架构上增加 Bridge 模块。

manifest.json: 增加 web_accessible_resources，允许注入 injected.js。

content.js: 启动时注入脚本：

code
JavaScript
download
content_copy
expand_less
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
(document.head || document.documentElement).appendChild(script);

injected.js (Main World):

实现 getReactComponent (Fiber 遍历)。

监听 window.postMessage。

当收到 READ_PROPS，序列化 Props 并发回。

Sidebar UI:

接收到 Props 数据，渲染成 Form 表单。

对于 boolean 渲染 Toggle 开关，string 渲染 Input。

用户修改时，发送 Payload 给 AI。

结论：
通过注入脚本访问 Fiber Tree，你可以拿到 React 组件的“上帝视角”。配合 AI 的代码修改能力，就能完美复刻 Cursor 这个功能。这比单纯的 DOM 编辑要高级得多，也是“企业级”工具的分水岭。

q: 先不考虑AI的功能，因为这一步实际上更多是偏向调试用的，本质上并不需要改动代码

a: 这是一个纯粹的 Runtime Hacking 需求。你希望像使用 React DevTools 一样，在页面运行时直接修改组件状态，用于调试或预览，而不涉及源码修改。

要实现这一点，浏览器的 Content Script（隔离世界） 做不到，必须使用 Injected Script（主世界） 直接操作 React 内存中的 Fiber Tree。

以下是实现这一“调试模式”的完整技术方案和代码。

核心架构：The React Runtime Bridge

我们需要建立一条数据管道：
DOM 元素 -> React Fiber -> 提取 Props -> 发送给 Sidebar -> 用户修改 -> 强制 React 更新。

第一步：注入器 (Content Script)

在 content.js 中，我们需要把“间谍脚本”注入到页面里，让它能访问 window.React 和 DOM 节点上的 \_\_reactFiber 属性。

code
JavaScript
download
content_copy
expand_less
// content.js

// 1. 注入主世界脚本
const script = document.createElement('script');
script.src = chrome.runtime.getURL('react-spy.js');
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

// 2. 建立双向通信中转
// Sidebar (ShadowDOM) <-> Content Script <-> Injected Script (Main World)

// 监听来自 Sidebar 的命令，转发给 Injected Script
window.addEventListener('message', (event) => {
// 仅处理来自我们插件的消息
if (event.data.source !== 'ai-workbench-sidebar') return;

// 转发给 Main World
window.postMessage({
source: 'ai-workbench-content',
...event.data
}, '\*');
});

// 监听来自 Injected Script 的数据，转发给 Sidebar
window.addEventListener('message', (event) => {
if (event.data.source !== 'ai-workbench-injected') return;

// 这里需要一种机制把数据传回 ShadowDOM 里的 Sidebar
// 通常通过 CustomEvent 或者直接调用挂载在 window 上的 Sidebar 实例方法
// 假设 Sidebar 监听了一个 CustomEvent
const customEvent = new CustomEvent('workbench:react-data', { detail: event.data.payload });
window.dispatchEvent(customEvent);
});
第二步：React 间谍 (Injected Script)

这是核心。我们需要编写 react-spy.js，它运行在页面上下文中。

核心难点解决：

Fiber 查找：从 DOM 找到组件 Fiber。

Props 序列化：React Props 里可能有函数、Symbol、循环引用，不能直接 JSON.stringify。

强制更新 (Force Update)：修改 Props 后，如何让 React 重新渲染？

code
JavaScript
download
content_copy
expand_less
// react-spy.js (放入 web_accessible_resources)

(function() {
const HOOK_NAME = '**REACT_DEVTOOLS_GLOBAL_HOOK**';

/\*\*

- 工具：从 DOM 节点获取 React Fiber
  \*/
  function getFiberFromDom(dom) {
  const key = Object.keys(dom).find(k => k.startsWith('\_\_reactFiber$'));
  return key ? dom[key] : null;
  }

/\*\*

- 工具：向上查找最近的组件 Fiber
- 我们点的可能是 <button> (HostComponent)，但我们要编辑的是 <Button> (FunctionComponent)
  \*/
  function findComponentFiber(startFiber) {
  let fiber = startFiber;
  while (fiber) {
  // tag: 0 = FunctionComponent, 1 = ClassComponent
  // 过滤掉 host component (div, span) 和 fragment
  if (fiber.tag === 0 || fiber.tag === 1) {
  return fiber;
  }
  fiber = fiber.return;
  }
  return null;
  }

/\*\*

- 工具：Props 安全序列化 (避免 postMessage 报错)
  \*/
  function serializeProps(props) {
  if (!props) return {};
  const result = {};


    for (const key in props) {
      const val = props[key];
      const type = typeof val;

      if (type === 'function') {
        result[key] = { type: 'function', label: 'ƒ ()' };
      } else if (React.isValidElement(val)) {
        result[key] = { type: 'react-node', label: `<${val.type.displayName || val.type.name || 'Component'} />` };
      } else if (type === 'object' && val !== null) {
        // 简单防循环引用，实际可用 weakSet
        try {
          JSON.stringify(val);
          result[key] = { type: 'json', value: val };
        } catch (e) {
          result[key] = { type: 'blob', label: '[Complex Object]' };
        }
      } else {
        result[key] = { type: 'primitive', value: val };
      }
    }
    return result;

}

/\*\*

- 核心：读取组件信息
  \*/
  function inspectComponent(domData) {
  // 这里的 domData 只能是标记，我们无法直接传 DOM 元素
  // 假设我们之前通过 Content Script 给选中的 DOM 加了个特殊标记
  const el = document.querySelector('[data-ai-workbench-inspect]');
  if (!el) return;


    const domFiber = getFiberFromDom(el);
    const compFiber = findComponentFiber(domFiber);

    if (!compFiber) return;

    // 缓存 Fiber，用于后续更新 (使用 WeakMap 防止内存泄漏)
    if (!window.__ai_fiber_cache__) window.__ai_fiber_cache__ = new Map();
    const fiberId = Math.random().toString(36).substr(2, 9);
    window.__ai_fiber_cache__.set(fiberId, compFiber);

    const componentName = compFiber.type.displayName || compFiber.type.name || 'Anonymous';

    // 发送数据回 Sidebar
    window.postMessage({
      source: 'ai-workbench-injected',
      payload: {
        fiberId: fiberId,
        name: componentName,
        props: serializeProps(compFiber.memoizedProps),
        // 甚至可以获取 State (hook 链表)
        // state: inspectHooks(compFiber)
      }
    }, '*');

}

/\*\*

- 核心：写入 Props 并强制更新
- 这是最 Hacker 的部分
  \*/
  function updateComponentProps(fiberId, propName, newValue) {
  const fiber = window.**ai_fiber_cache**?.get(fiberId);
  if (!fiber) return;


    console.log(`[ReactSpy] Hacking props of <${fiber.type.name}>: ${propName} =`, newValue);

    // 1. 修改 Props (内存层面)
    // 此时 React 并不知道数据变了，因为我们绕过了父组件
    const newProps = { ...fiber.memoizedProps, [propName]: newValue };
    fiber.memoizedProps = newProps;
    fiber.pendingProps = newProps; // 某些版本需要改 pendingProps

    // 2. 触发更新 (视图层面)
    triggerReRender(fiber);

}

/\*\*

- 触发 React 重渲染的黑魔法
  \*/
  function triggerReRender(fiber) {
  // 策略 A: 如果是 Class Component (最简单)
  if (fiber.tag === 1 && fiber.stateNode && fiber.stateNode.forceUpdate) {
  fiber.stateNode.forceUpdate();
  return;
  }


    // 策略 B: Function Component (困难模式)
    // FC 没有实例，没有 forceUpdate。我们通常通过找它的 Class 父级来触发更新。
    let current = fiber.return;
    while (current) {
      if (current.tag === 1 && current.stateNode) {
        current.stateNode.forceUpdate();
        return; // 找到父级并更新，通常会级联更新子组件
      }
      current = current.return;
    }

    // 策略 C: 既然找不到父级 Class，尝试利用 React DevTools Hook (如果存在)
    // 这需要模拟 DevTools 的内部事件，非常复杂且不稳定。

    // 策略 D: 替代方案 (Dirty Hack)
    // 我们可以尝试修改 DOM 节点的属性来欺骗 React？不行。

    // 策略 E: 寻找 React Root 并调度更新 (终极方案)
    // 这是一个非常底层的操作，通常只有 React DevTools 才会做。
    // 在简单的调试场景下，我们可以告诉用户："修改 Props 后，尝试触发一次页面交互（如点击任意处）来刷新视图。"
    // 或者，我们可以尝试找到最近的 Context Provider 触发更新。

    // 实用的妥协方案：
    // 大多数项目根节点附近会有 Router 或 Context Provider。
    // 如果我们修改了 props，React 下次任何更新都会使用新 Props。

    // 尝试调度一个微小的更新 (如果能找到 state hook)
    // 这里代码省略，因为太长，逻辑是遍历 fiber.memoizedState 找到 useState 的 dispatch 函数并调用。
    console.warn("Function Component props updated. UI may not reflect changes until next render.");

}

// 消息监听路由
window.addEventListener('message', (event) => {
if (event.data.source !== 'ai-workbench-content') return;

    const { action, data } = event.data;

    if (action === 'inspect') {
      inspectComponent();
    } else if (action === 'update_prop') {
      updateComponentProps(data.fiberId, data.propName, data.value);
    }

});

})();
第三步：Sidebar UI 实现 (Props 编辑器)

在 Shadow DOM 里的 React 代码。

code
JavaScript
download
content_copy
expand_less
// SidebarPropsPanel.jsx

export const PropsPanel = () => {
const [componentData, setComponentData] = useState(null);

// 监听来自 Injected Script 的数据
useEffect(() => {
const handler = (e) => {
// 收到 React 组件数据
setComponentData(e.detail);
};
window.addEventListener('workbench:react-data', handler);
return () => window.removeEventListener('workbench:react-data', handler);
}, []);

const handlePropChange = (key, newVal) => {
// 1. 本地乐观更新 UI
setComponentData(prev => ({
...prev,
props: { ...prev.props, [key]: { ...prev.props[key], value: newVal } }
}));

    // 2. 发送命令给 Injected Script
    window.postMessage({
      source: 'ai-workbench-sidebar',
      action: 'update_prop',
      data: {
        fiberId: componentData.fiberId,
        propName: key,
        value: newVal
      }
    }, '*');

};

if (!componentData) return <div className="p-4 text-gray-500">Select an element to edit props</div>;

return (
<div className="props-panel">
<h2 className="text-xs font-bold uppercase text-gray-400 mb-2">
Component: {componentData.name}
</h2>

      {Object.entries(componentData.props).map(([key, item]) => (
        <div key={key} className="prop-row mb-2 flex items-center">
          <label className="text-xs text-blue-300 w-1/3 truncate" title={key}>
            {key}
          </label>

          <div className="w-2/3">
            {/* 根据类型渲染不同的输入框 */}
            {item.type === 'primitive' && typeof item.value === 'boolean' ? (
              <input
                type="checkbox"
                checked={item.value}
                onChange={e => handlePropChange(key, e.target.checked)}
              />
            ) : item.type === 'primitive' ? (
              <input
                className="bg-slate-700 w-full text-xs px-1 rounded"
                value={item.value}
                onChange={e => handlePropChange(key, e.target.value)} // 注意：数字类型需要 parse
              />
            ) : (
              <span className="text-xs text-gray-500 italic">{item.label}</span>
            )}
          </div>
        </div>
      ))}
    </div>

);
};
第四步：使用流程 (User Flow)

选中：用户在 Canvas Overlay 上点击一个按钮。

标记：Content Script 给该 DOM 元素加上 data-ai-workbench-inspect="true" 属性。

触发：Sidebar 发送 inspect 消息。

捕获：react-spy.js 找到 DOM -> 找到 Fiber -> 找到 <Button> 组件 Fiber。

回传：react-spy.js 将 { title: "Click Me", disabled: false } 发回 Sidebar。

修改：用户把 disabled 勾选为 true。

注入：react-spy.js 修改 Fiber 内存中的 props。

刷新：react-spy.js 尝试触发父级更新，或者用户稍微交互一下页面，按钮变灰。

总结

这套方案不需要 AI，也不需要修改源码，它是一个纯粹的 Runtime Debugger。

关键技术点总结：

Main World Injection：必须注入 JS 到页面才能访问 React 变量。

Fiber Traversal：通过 \_\_reactFiber 属性找到组件实例。

Hacking Props：直接修改 fiber.memoizedProps。

Force Update：这是最不稳定的部分（Function Component 难触发更新），但在调试场景下，通常可以通过触发任意页面更新来“捎带”更新该组件。

这就是 Cursor 那个“Props 实时编辑”背后的技术原理。有了这个，你的编辑器就不只是改样式的“美工刀”，而是深入逻辑层的“手术刀”。

q: React DevTools是怎么实现的呢？能否直接集成React DevTools，问题不就解决了
a: 这是一个非常敏锐且极具工程价值的问题！

结论先行：

直接集成 React DevTools 的 UI：不推荐。因为它的 UI 是为了“调试”设计的（密密麻麻的树结构），而不是为了“可视化编辑”设计的（像 Webflow/Figma 那样的属性面板）。直接嵌入会导致用户体验割裂，不像 Cursor。

复用 React DevTools 的底层逻辑（Backend）：强烈推荐。这是“企业级”做法。不要自己写蹩脚的 react-spy.js，而是利用 React 官方维护的 react-devtools-inline 包中的后端逻辑，来实现 Fiber 遍历、Props 修改和强制更新。

一、 React DevTools (RDT) 是怎么实现的？

RDT 的架构非常经典，它分为三部分，完全解耦：

The Hook (**REACT_DEVTOOLS_GLOBAL_HOOK**)：

这是一个全局变量，必须在 React 加载之前注入到页面中。

当 React 初始化时，它会检查这个 Hook 是否存在。如果存在，React 就会把自己“注册”进去（把 renderers 注入给 Hook）。

这就是为什么所有 React 调试工具都需要预先注入脚本。

The Backend (运行在页面主线程)：

负责与 React 内部机制（Fiber Tree）打交道。

功能：遍历 Fiber 树、读取 Props/State、修改 Props/State、高亮组件。

The Frontend (运行在 DevTools 面板)：

负责显示 UI（组件树、属性面板）。

它通过 Bridge（基于 postMessage）与 Backend 通信。

二、 为什么不能直接把 RDT 的 UI 拿过来用？

如果你直接把 RDT 的界面嵌入到你的侧边栏，会有以下问题：

信息过载：RDT 显示了完整的组件树（Context.Provider, Memo, ForwardRef...），而你的用户只想选个按钮改颜色。

样式冲突：RDT 的暗黑模式/UI 风格很难魔改成 Cursor 那种清爽的风格。

交互逻辑不同：

RDT：在树里选组件 -> 看属性。

Cursor：在页面上点元素 -> 侧边栏只显示这个组件的 Props。

三、 最佳方案：Headless Integration (无头集成)

“企业级”的做法是：只用 React DevTools 的大脑 (Backend)，自己写脸 (UI)。

Meta 官方其实发布了一个包叫 react-devtools-inline，它允许你在 iframe 或普通页面中运行 DevTools。我们可以利用它的核心逻辑。

或者，更轻量地，参考 RDT 的 Backend 源码 来实现一个稳健的 Bridge。

方案 A：引入 react-devtools-inline (重量级，最稳)

这个包封装了 RDT 的所有能力。

code
JavaScript
download
content_copy
expand_less
// content-script 注入的代码
import { initialize } from 'react-devtools-inline/backend';
import { activate } from 'react-devtools-inline/backend';

// 1. 初始化后端 (它会自动寻找全局 Hook)
const bridge = initialize(window);

// 2. 激活后端
activate(window);

// 3. 监听 Bridge 消息
// RDT 的 Backend 会通过 bridge 发送组件树更新
bridge.addListener('operations', (operations) => {
// 这里是很底层的二进制操作码，解析起来很麻烦
// 但这是最“正统”的数据源
});

// 4. 发送命令修改 Props
bridge.send('overrideValueAtPath', {
type: 'props',
id: fiberId, // RDT 内部生成的 ID
path: ['style', 'backgroundColor'],
value: 'red'
});

评价：虽然稳，但 RDT 的通信协议（Bridge Protocol）非常复杂，解析成本极高。对于只想要“改 Props”功能的插件来说，有点大炮打蚊子。

方案 B：劫持官方 Hook (轻量级，最实用)

我们可以模仿 RDT Backend 的核心逻辑，利用 React 暴露给 DevTools 的官方接口。这是比我自己手写的 react-spy.js 更靠谱、且比引入完整 RDT 更轻量的方案。

这是真正的“企业级 Hacker”方案：

code
JavaScript
download
content_copy
expand_less
// injected-script.js (运行在 Main World)

(function() {
// 1. 确保 Hook 存在
if (!window.**REACT_DEVTOOLS_GLOBAL_HOOK**) {
// 如果页面没装 DevTools，我们需要自己 Mock 一个 Hook 让 React 注册进来
// 这一步非常关键，要在 React 加载前执行
window.**REACT_DEVTOOLS_GLOBAL_HOOK** = {
isDisabled: false,
supportsFiber: true,
inject: (renderer) => {
// React 加载时会调用这个 inject
window.**REACT_RENDERER** = renderer; // 拿到渲染器实例！
},
onCommitFiberRoot: () => {},
onCommitFiberUnmount: () => {},
};
}

// 2. 核心：利用 Renderer 修改 Props
// 这是 React 内部暴露给 DevTools 的修改状态的能力
function updateReactProp(fiber, propPath, value) {
const renderer = window.**REACT_RENDERER**; // 或者是从 hook.renderers 获取
if (!renderer) return;

    // React DevTools 源码里修改 Props 的核心逻辑
    // 它们不直接改 memoizedProps，那是只读的
    // 它们通过 cleanup 和 调度更新 来实现

    const { overrideHookState, overrideProps } = renderer;

    if (overrideProps) {
        // 这是官方提供的 API！稳得一批
        overrideProps(fiber, propPath, value);

        // 强制更新
        const root = fiber.return || fiber;
        renderer.scheduleUpdate(root);
    } else {
        // Fallback: 如果没有暴露 overrideProps (旧版本 React)
        // 使用我们之前的 Dirty Hack
        fiber.memoizedProps = { ...fiber.memoizedProps, [propPath]: value };
        // 触发更新...
    }

}

// ... 剩下的逻辑和之前一样：找到 Fiber -> 传给 Sidebar
})();
四、 为什么说这解决了“企业级”问题？

使用官方 Hook/Renderer 接口解决了以下痛点：

版本兼容性：React 16, 17, 18, 19 的内部结构（Fiber 属性名）可能不同。但 renderer.overrideProps 接口是 React 团队为了 DevTools 维护的，相对稳定。

强制更新：你自己写 forceUpdate 很难覆盖所有场景（比如 Hooks 重度使用的组件）。但 renderer.scheduleUpdate 是 React 调度器的官方入口，它能正确地触发重渲染。

Context/State 访问：RDT 的接口还能让你读取和修改 useState / useContext 的值，不仅限于 Props。

五、 最终建议的技术路线

不要引入整个 react-devtools 包，也不要完全手写土办法。

Copy-Paste 策略：去阅读 react-devtools-shared 源码，特别是 src/backend/renderer.js。

提取核心：把其中关于 inspect (查找) 和 overrideValueAtPath (修改) 的逻辑提取出来。

封装：封装成你的 react-bridge.js，注入到页面中。

这样做，你既拥有了 RDT 的稳定性（基于官方接口），又拥有了 Cursor 的定制 UI（自绘侧边栏）。

代码参考指引：
搜索 React 源码仓库中的 react-devtools-shared/src/backend/renderer.js 文件。关注 overrideValueAtPath 函数。这就是“上帝之手”的源码。

q: 我不需要它的完整UI啊，实际上我只需要把修改组件属性那部分的能力集成进来就行了
a: 这正是最明智的选择。“弱水三千，只取一瓢”。你不需要 RDT 那复杂的通信协议、Profiler 分析器或组件树 UI，你只需要它的核心能力：Runtime Prop Injection。

要实现这个“单点能力”，我们需要编写一个精简版的 React Runtime Bridge。这个 Bridge 运行在页面主线程（Injected Script），专门负责干两件事：

Read: 给定一个 DOM，把它的 React Props 读出来。

Write: 接收新的值，写入 Fiber，并通知 React 渲染。

以下是剥离了所有 RDT UI 代码，仅保留核心修改能力的纯净版实现方案。

1. 架构图
   code
   Mermaid
   download
   content_copy
   expand_less
   graph TD
   A[SideBar UI (你的插件)] -- postMessage --> B[Content Script]
   B -- postMessage --> C[Injected Script (Main World)]
   C -- 1. 获取 Renderer --> D[React Global Hook]
   D -- 2. 注入 --> E[React Reconciler (Fiber Tree)]
   C -- 3. scheduleUpdate --> E
2. 代码实现：react-core.js

这是你需要注入到页面 main world 的核心脚本。它不依赖任何第三方库，直接操作 React 内部接口。

code
JavaScript
download
content_copy
expand_less
/\*\*

- react-core.js
- 一个极简的 React Runtime 读写器，用于提取和修改组件 Props
  \*/

(function () {
// 1. 全局存储：用于建立 Fiber 与 UUID 的稳定映射
// 使用 WeakMap 防止内存泄漏
const fiberCache = new Map();
let uidCounter = 0;

function getFiberId(fiber) {
if (!fiber.stateNode && !fiber.memoizedProps) return null;
// 简单的 ID 生成策略，实际可用更复杂的
if (!fiber.**debugID) fiber.**debugID = ++uidCounter;
fiberCache.set(fiber.**debugID, fiber);
return fiber.**debugID;
}

// 2. 劫持/查找 React Hook
// React 启动时会寻找 window.**REACT_DEVTOOLS_GLOBAL_HOOK**
// 我们必须在 React 加载前（document_start）注入此代码，或者在加载后查找已存在的 Hook
let renderer = null;

if (!window.**REACT_DEVTOOLS_GLOBAL_HOOK**) {
// 场景 A: 页面没装 React DevTools，我们需要手动 Shim
window.**REACT_DEVTOOLS_GLOBAL_HOOK** = {
checkDCE: () => {},
supportsFiber: true,
renderers: new Map(),
onScheduleFiberRoot: () => {},
onCommitFiberRoot: () => {},
onCommitFiberUnmount: () => {},
inject: (injectedRenderer) => {
// 捕获 React Renderer!
renderer = injectedRenderer;
window.**REACT_RENDERER_INSTANCE** = renderer; // 方便调试
}
};
} else {
// 场景 B: 页面已装 React DevTools，直接偷它的 renderers
const hook = window.**REACT_DEVTOOLS_GLOBAL_HOOK**;
if (hook.renderers && hook.renderers.size > 0) {
renderer = hook.renderers.values().next().value;
} else {
// 监听注入
const oldInject = hook.inject;
hook.inject = (injectedRenderer) => {
renderer = injectedRenderer;
if (oldInject) oldInject(injectedRenderer);
};
}
}

// --- 核心能力 A: 查找与读取 ---

window.**AI_WORKBENCH_READ** = function(domElement) {
if (!renderer) return { error: 'React renderer not found' };

    // 1. 利用 Renderer 官方方法查找 Fiber (比手动遍历 __reactFiber$ 更稳)
    let fiber = renderer.findFiberByHostInstance(domElement);

    // 2. 向上查找真正的组件 (Function/Class)
    // 过滤掉 host components (div, span)
    while (fiber) {
      if (fiber.tag === 0 || fiber.tag === 1 || fiber.tag === 11) { // 0:Fn, 1:Class, 11:ForwardRef
        break;
      }
      fiber = fiber.return;
    }

    if (!fiber) return { error: 'Component not found' };

    const id = getFiberId(fiber);
    const name = fiber.type.displayName || fiber.type.name || 'Anonymous';

    // 3. 序列化 Props (处理函数、ReactElement等不可传输对象)
    const safeProps = safeSerialize(fiber.memoizedProps);

    return {
      id,
      name,
      props: safeProps,
      // 还可以返回 hooks/state
    };

};

// --- 核心能力 B: 修改与更新 ---

window.**AI_WORKBENCH_WRITE** = function(fiberId, propPath, newValue) {
if (!renderer) return;
const fiber = fiberCache.get(fiberId);
if (!fiber) return;

    console.log(`[AI Workbench] Patching props for <${fiber.type.name}>:`, propPath, newValue);

    // 1. 修改 Fiber 内存数据
    // 注意：我们需要同时修改 memoizedProps (当前) 和 pendingProps (WIP)
    // 对于深层属性 (style.width)，需要做浅拷贝合并
    const newProps = { ...fiber.memoizedProps };
    newProps[propPath] = newValue; // 简化版：仅支持顶层属性，深层需递归合并

    fiber.memoizedProps = newProps;

    // 2. 如果存在 alternate (双缓存机制)，也要同步修改，防止下次 commit 覆盖
    if (fiber.alternate) {
      fiber.alternate.memoizedProps = newProps;
    }

    // 3. 强制 React 更新 (The Secret Sauce)
    // 这是 RDT 能够实时预览的关键。
    // 我们调用 React 内部调度器，告诉它这个节点变脏了。
    renderer.scheduleUpdate(fiber);

};

// --- 辅助工具 ---

function safeSerialize(obj) {
if (!obj) return {};
const res = {};
for (let k in obj) {
const v = obj[k];
const type = typeof v;
if (type === 'function') res[k] = { type: 'fn', name: v.name || 'fn' };
else if (React.isValidElement(v)) res[k] = { type: 'element', name: v.type.name };
else if (type === 'object' && v !== null) {
try {
// 简单防循环
JSON.stringify(v);
res[k] = v;
} catch { res[k] = '[Complex Object]'; }
}
else res[k] = v;
}
return res;
}

// 简单的 React 探测器 (如果页面没暴露 React 全局变量)
const React = { isValidElement: (o) => o && o.$$typeof === Symbol.for('react.element') };

})(); 3. 如何集成到你的插件

你只需要在 content.js 中通过 window.postMessage 加上上面的全局函数来调用。

Content Script (content.js):

code
JavaScript
download
content_copy
expand_less
// 注入上面的 react-core.js
const script = document.createElement('script');
script.src = chrome.runtime.getURL('react-core.js');
(document.head || document.documentElement).appendChild(script);

// 监听 Sidebar 的请求
window.addEventListener('message', (event) => {
if (event.data.type === 'WORKBENCH_UPDATE_PROP') {
const { fiberId, key, value } = event.data;

    // 在 Main World 执行写入
    // 注意：Content Script 不能直接调 window.__AI_WORKBENCH_WRITE__
    // 必须通过 postMessage 或 executeScript
    window.postMessage({
      type: 'EXECUTE_REACT_WRITE',
      fiberId, key, value
    }, '*');

}
});

Main World Listener (追加到 react-core.js):

code
JavaScript
download
content_copy
expand_less
window.addEventListener('message', (event) => {
if (event.data.type === 'EXECUTE_REACT_WRITE') {
const { fiberId, key, value } = event.data;
window.**AI_WORKBENCH_WRITE**(fiberId, key, value);
}
}); 4. 关键技术点解释

renderer.findFiberByHostInstance(dom):

这是 React 内部暴露给 DevTools 的 API。它比我们自己去遍历 \_\_reactFiber$ 更健壮，因为它能处理 Portal、Fragment 等边缘情况。

renderer.scheduleUpdate(fiber):

这就是你一直在找的 “开关”。

普通的 forceUpdate 只能用于 Class Component。

scheduleUpdate 是 React 协调器（Reconciler）层面的 API，它标记该 Fiber 节点为“脏”且需要更新。React 会在下一个 Tick 重新运行该组件的 render 函数（使用我们刚刚篡改过的 memoizedProps），从而更新视图。

Fiber Cache:

Sidebar 和 Injected Script 通信只能传 JSON，传不了 Fiber 对象。

所以我们生成一个 ID (uidCounter) 传给 Sidebar。Sidebar 改的时候把 ID 传回来，我们在 Map 里找回 Fiber 对象。

5. 局限性与“企业级”声明

虽然这实现了实时预览，但作为技术负责人，必须明确它的边界：

易失性 (Ephemeral): 这种修改只存在于内存中。一旦父组件重新渲染（比如父组件 state 变了），它传下来的 props 会覆盖我们 Hack 的 props。

Cursor 怎么解决的？ Cursor 也是这样的。它只是为了让你快速预览。确认要改后，必须走 AI 改代码流程。

Hooks 状态: 这套代码只改了 Props。如果你想改 useState 的值，需要遍历 fiber.memoizedState 链表，逻辑会更复杂一些（参考 RDT 源码的 inspectHooks 部分）。对于 MVP，只改 Props 足够覆盖 80% 场景。

这套方案极其轻量（核心代码 < 100 行），没有外部依赖，却精准复用了 React 官方 DevTools 的核心机制，完全符合你“只要修改能力，不要 UI”的需求。

q: 假设是vue的应用，能实现类似的功能吗
a: 答案是肯定的。Vue 3 实现这个功能的难度甚至比 React 更低，体验也更丝滑。

虽然 Vue 和 React 的底层机制不同（Vue 基于响应式 Proxy，React 基于 Fiber 树），但核心思路是一模一样的：在主世界（Main World）找到组件实例，劫持数据，强制更新。

以下是针对 Vue 3 的企业级 Runtime Bridge 实现方案。

一、 核心原理：Vue 的“后门”

Vue 3 在开发环境（甚至生产环境）下，会在 DOM 元素上挂载一个非常关键的属性：\_\_vueParentComponent。

Read（读）：通过 DOM 拿到 ComponentInternalInstance，直接读取 instance.props。

Write（写）：

Vue 的 Props 是单向数据流，子组件内是 shallowReadonly 的。

Hack 技巧：我们不直接改 instance.props（会报警告且可能无效），而是修改 instance.vnode.props（虚拟节点的属性配置），然后调用 instance.proxy.$forceUpdate()。

二、 代码实现：vue-core.js

这是你需要注入到页面 Main World 的核心脚本。

code
JavaScript
download
content_copy
expand_less
/\*\*

- vue-core.js
- Vue 3 Runtime Bridge - 用于实时读写组件 Props
  \*/
  (function () {
  // 缓存实例，用 ID 通信
  const instanceCache = new Map();
  let uidCounter = 0;

function getInstanceId(instance) {
if (!instance.uid) instance.uid = ++uidCounter;
instanceCache.set(instance.uid, instance);
return instance.uid;
}

// --- 核心能力 A: 查找与读取 ---

window.**AI_WORKBENCH_VUE_READ** = function (domElement) {
// 1. 查找 Vue 实例
// Vue 3 会在 DOM 上挂载 **vueParentComponent
const instance = domElement.**vueParentComponent;

    if (!instance) return { error: 'Vue component not found' };

    // 2. 获取组件名
    // Vue 组件名可能在 type.name, type.__name (script setup), 或者 file 路径里
    const name = instance.type.name ||
                 instance.type.__name ||
                 (instance.type.__file ? instance.type.__file.split('/').pop() : 'Anonymous');

    // 3. 序列化 Props
    // 注意：instance.props 是 Proxy，需要解构或 clone
    const rawProps = { ...instance.props };
    const safeProps = safeSerialize(rawProps);

    return {
      id: getInstanceId(instance),
      name,
      props: safeProps,
      // file 属性对 Vue 来说是现成的，直接送给 Sidebar 做定位
      file: instance.type.__file
    };

};

// --- 核心能力 B: 修改与更新 ---

window.**AI_WORKBENCH_VUE_WRITE** = function (instanceId, key, value) {
const instance = instanceCache.get(instanceId);
if (!instance) return;

    console.log(`[Vue Bridge] Patching <${instance.type.name}>: ${key} =`, value);

    // 1. 突破单向流限制 (The Hack)
    // 直接修改 props 在 dev 模式下会报 console warn，并且可能被 reactivity 重置
    // 正确的做法是修改 vnode 的 props，这是下一次渲染的蓝图

    if (instance.vnode && instance.vnode.props) {
      // Vue 的 vnode props 通常混合了 kebab-case 和 camelCase
      // 我们尝试同时修补它们，以防万一
      instance.vnode.props[key] = value;

      // 处理 kebab-case (例如 someProp -> some-prop)
      const kebabKey = key.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, '$1-$2').toLowerCase();
      if (kebabKey !== key) {
        instance.vnode.props[kebabKey] = value;
      }
    }

    // 2. 同时也强行修改 instance.props (为了立即生效，尽管有 warn)
    // 在某些 Vue 版本中，只要不是从子组件内部修改，外部赋值有时是允许的
    try {
      instance.props[key] = value;
    } catch (e) {
      // 忽略 readonly 警告
    }

    // 3. 强制更新 (Force Update)
    // Vue 的响应式系统有时需要推一把
    if (instance.proxy && instance.proxy.$forceUpdate) {
      instance.proxy.$forceUpdate();
    } else {
      // 降级策略：如果 $forceUpdate 不存在，尝试触发 render
      instance.update();
    }

};

// --- 辅助：序列化 (同 React) ---
function safeSerialize(obj) {
const res = {};
for (let k in obj) {
const v = obj[k];
const type = typeof v;
if (type === 'function') res[k] = { type: 'fn', name: v.name };
else if (type === 'object' && v !== null) {
// Vue 的 Ref/Reactive 对象解包
if (v.\_\_v_isRef) res[k] = v.value;
else {
try { JSON.stringify(v); res[k] = v; }
catch { res[k] = '[Object]'; }
}
}
else res[k] = v;
}
return res;
}

})();
三、 Vue 与 React 实现的差异点 (注意事项)

大小写敏感 (Kebab vs Camel)：

React 全是 camelCase (e.g., className, onClick)。

Vue 很灵活。DOM 里的属性是 some-prop="1"，但组件里接收的是 someProp。

解决方案：在 Write 阶段，我做了一个处理：同时尝试写入 camelCase 和 kebab-case 到 vnode.props，确保命中。

Fragment (多根节点)：

Vue 3 支持多根节点。如果你点击了其中一个根节点 DOM，\_\_vueParentComponent 能正确指向该组件。

不需要像 React 那样写复杂的 findFiberByHostInstance，DOM 上的属性引用非常稳定。

响应式解包：

Vue 的 Props 可能是 Ref 或 Reactive 对象。读取时最好做一次 Deep Clone 或者展开 {...instance.props}，否则传给 postMessage 可能会因为包含 Proxy 导致报错（Clone Error）。

四、 如何在你的插件中同时支持 React 和 Vue？

你的 content.js 不用改，只需要在注入脚本时，同时注入 React 和 Vue 的探测逻辑。或者写一个统一的 bridge.js。

统一的 Bridge 接口设计：

code
JavaScript
download
content_copy
expand_more
总结

Vue 3 的实现甚至比 React 更简单，因为：

文件定位：instance.type.\_\_file 原生自带，无需 SourceMap 也能拿到文件粒度路径。

强制更新：$forceUpdate() 是公开 API，比 React 的 scheduleUpdate 更黑盒、更稳定。

所以，这个功能完全可以做成**框架无关（Framework Agnostic）**的，给用户提供统一的“上帝视角”修改体验。
