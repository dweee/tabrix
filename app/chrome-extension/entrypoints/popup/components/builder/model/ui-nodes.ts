// ui-nodes.ts — UI registry for builder nodes (sidebar, canvas, properties)
// Comments in English to explain intent.

import type { Component } from 'vue';
import type { NodeType } from '@/entrypoints/background/record-replay/types';

// Canvas renderer components
import NodeCard from '@/entrypoints/popup/components/builder/components/nodes/NodeCard.vue';
import NodeIf from '@/entrypoints/popup/components/builder/components/nodes/NodeIf.vue';

// Property components (per-node or shared)
import PropClick from '@/entrypoints/popup/components/builder/components/properties/PropertyClick.vue';
import PropFill from '@/entrypoints/popup/components/builder/components/properties/PropertyFill.vue';
import PropTriggerEvent from '@/entrypoints/popup/components/builder/components/properties/PropertyTriggerEvent.vue';
import PropSetAttribute from '@/entrypoints/popup/components/builder/components/properties/PropertySetAttribute.vue';
import PropNavigate from '@/entrypoints/popup/components/builder/components/properties/PropertyNavigate.vue';
import PropWait from '@/entrypoints/popup/components/builder/components/properties/PropertyWait.vue';
import PropAssert from '@/entrypoints/popup/components/builder/components/properties/PropertyAssert.vue';
import PropDelay from '@/entrypoints/popup/components/builder/components/properties/PropertyDelay.vue';
import PropHttp from '@/entrypoints/popup/components/builder/components/properties/PropertyHttp.vue';
import PropExtract from '@/entrypoints/popup/components/builder/components/properties/PropertyExtract.vue';
import PropScreenshot from '@/entrypoints/popup/components/builder/components/properties/PropertyScreenshot.vue';
import PropLoopElements from '@/entrypoints/popup/components/builder/components/properties/PropertyLoopElements.vue';
import PropSwitchFrame from '@/entrypoints/popup/components/builder/components/properties/PropertySwitchFrame.vue';
import PropHandleDownload from '@/entrypoints/popup/components/builder/components/properties/PropertyHandleDownload.vue';
import PropExecuteFlow from '@/entrypoints/popup/components/builder/components/properties/PropertyExecuteFlow.vue';
import PropOpenTab from '@/entrypoints/popup/components/builder/components/properties/PropertyOpenTab.vue';
import PropSwitchTab from '@/entrypoints/popup/components/builder/components/properties/PropertySwitchTab.vue';
import PropCloseTab from '@/entrypoints/popup/components/builder/components/properties/PropertyCloseTab.vue';
import PropKey from '@/entrypoints/popup/components/builder/components/properties/PropertyKey.vue';
import PropIf from '@/entrypoints/popup/components/builder/components/properties/PropertyIf.vue';
import PropForeach from '@/entrypoints/popup/components/builder/components/properties/PropertyForeach.vue';
import PropWhile from '@/entrypoints/popup/components/builder/components/properties/PropertyWhile.vue';
import PropScript from '@/entrypoints/popup/components/builder/components/properties/PropertyScript.vue';

export type NodeCategory = 'Actions' | 'Logic' | 'Tools' | 'Tabs' | 'Page';

export interface NodeUIConfig {
  type: NodeType;
  label: string;
  category: NodeCategory;
  iconClass: string; // reuse existing Sidebar.css color classes
  canvas: Component; // canvas renderer
  property: Component; // property renderer
}

// Registry contents; use existing color/icon CSS classes from Sidebar.vue
const baseCard = NodeCard as Component;

export const NODE_UI_LIST: NodeUIConfig[] = [
  {
    type: 'navigate',
    label: '导航',
    category: 'Actions',
    iconClass: 'icon-navigate',
    canvas: baseCard,
    property: PropNavigate,
  },
  {
    type: 'click',
    label: '点击',
    category: 'Actions',
    iconClass: 'icon-click',
    canvas: baseCard,
    property: PropClick,
  },
  {
    type: 'dblclick',
    label: '双击',
    category: 'Actions',
    iconClass: 'icon-click',
    canvas: baseCard,
    property: PropClick,
  },
  {
    type: 'fill',
    label: '填充',
    category: 'Actions',
    iconClass: 'icon-fill',
    canvas: baseCard,
    property: PropFill,
  },
  {
    type: 'key',
    label: '键盘',
    category: 'Actions',
    iconClass: 'icon-key',
    canvas: baseCard,
    property: PropKey,
  },
  {
    type: 'wait',
    label: '等待',
    category: 'Actions',
    iconClass: 'icon-wait',
    canvas: baseCard,
    property: PropWait,
  },
  {
    type: 'assert',
    label: '断言',
    category: 'Actions',
    iconClass: 'icon-assert',
    canvas: baseCard,
    property: PropAssert,
  },
  {
    type: 'delay',
    label: '延迟',
    category: 'Actions',
    iconClass: 'icon-delay',
    canvas: baseCard,
    property: PropDelay,
  },

  {
    type: 'if',
    label: '条件',
    category: 'Logic',
    iconClass: 'icon-if',
    canvas: NodeIf as Component,
    property: PropIf,
  },
  {
    type: 'foreach',
    label: '循环',
    category: 'Logic',
    iconClass: 'icon-foreach',
    canvas: baseCard,
    property: PropForeach,
  },
  {
    type: 'while',
    label: '循环',
    category: 'Logic',
    iconClass: 'icon-while',
    canvas: baseCard,
    property: PropWhile,
  },

  {
    type: 'http',
    label: 'HTTP',
    category: 'Tools',
    iconClass: 'icon-http',
    canvas: baseCard,
    property: PropHttp,
  },
  {
    type: 'extract',
    label: '提取',
    category: 'Tools',
    iconClass: 'icon-extract',
    canvas: baseCard,
    property: PropExtract,
  },
  {
    type: 'screenshot',
    label: '截图',
    category: 'Tools',
    iconClass: 'icon-screenshot',
    canvas: baseCard,
    property: PropScreenshot,
  },
  {
    type: 'triggerEvent',
    label: '触发事件',
    category: 'Tools',
    iconClass: 'icon-trigger',
    canvas: baseCard,
    property: PropTriggerEvent,
  },
  {
    type: 'setAttribute',
    label: '设置属性',
    category: 'Tools',
    iconClass: 'icon-attr',
    canvas: baseCard,
    property: PropSetAttribute,
  },
  {
    type: 'loopElements',
    label: '循环元素',
    category: 'Tools',
    iconClass: 'icon-loop',
    canvas: baseCard,
    property: PropLoopElements,
  },
  {
    type: 'switchFrame',
    label: '切换Frame',
    category: 'Tools',
    iconClass: 'icon-frame',
    canvas: baseCard,
    property: PropSwitchFrame,
  },
  {
    type: 'handleDownload',
    label: '下载处理',
    category: 'Tools',
    iconClass: 'icon-download',
    canvas: baseCard,
    property: PropHandleDownload,
  },
  {
    type: 'script',
    label: '脚本',
    category: 'Tools',
    iconClass: 'icon-script',
    canvas: baseCard,
    property: PropScript,
  },

  {
    type: 'openTab',
    label: '打开标签',
    category: 'Tabs',
    iconClass: 'icon-openTab',
    canvas: baseCard,
    property: PropOpenTab,
  },
  {
    type: 'switchTab',
    label: '切换标签',
    category: 'Tabs',
    iconClass: 'icon-switchTab',
    canvas: baseCard,
    property: PropSwitchTab,
  },
  {
    type: 'closeTab',
    label: '关闭标签',
    category: 'Tabs',
    iconClass: 'icon-closeTab',
    canvas: baseCard,
    property: PropCloseTab,
  },
];

export const NODE_UI_REGISTRY: Record<NodeType, NodeUIConfig> = Object.fromEntries(
  NODE_UI_LIST.map((n) => [n.type, n]),
) as any;

export const NODE_CATEGORIES: NodeCategory[] = ['Actions', 'Logic', 'Tools', 'Tabs', 'Page'];

export function listByCategory(): Record<NodeCategory, NodeUIConfig[]> {
  const out: Record<NodeCategory, NodeUIConfig[]> = {
    Actions: [],
    Logic: [],
    Tools: [],
    Tabs: [],
    Page: [],
  };
  for (const n of NODE_UI_LIST) out[n.category].push(n);
  return out;
}

export function canvasTypeKey(t: NodeType): string {
  // Map to VueFlow node-types key, unique per node type
  return `rr-${t}`;
}
