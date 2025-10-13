// node-util.ts - shared UI helpers for node components
// Note: comments in English

import type { NodeBase } from '@/entrypoints/background/record-replay/types';
import { summarizeNode as summarize } from '../../model/transforms';
import ILucideMousePointerClick from '~icons/lucide/mouse-pointer-click';
import ILucideEdit3 from '~icons/lucide/edit-3';
import ILucideKeyboard from '~icons/lucide/keyboard';
import ILucideCompass from '~icons/lucide/compass';
import ILucideGlobe from '~icons/lucide/globe';
import ILucideFileCode2 from '~icons/lucide/file-code-2';
import ILucideScan from '~icons/lucide/scan';
import ILucideHourglass from '~icons/lucide/hourglass';
import ILucideCheckCircle2 from '~icons/lucide/check-circle-2';
import ILucideGitBranch from '~icons/lucide/git-branch';
import ILucideRepeat from '~icons/lucide/repeat';
import ILucideRefreshCcw from '~icons/lucide/refresh-ccw';
import ILucideSquare from '~icons/lucide/square';
import ILucideArrowLeftRight from '~icons/lucide/arrow-left-right';
import ILucideX from '~icons/lucide/x';

export function iconComp(t?: string) {
  switch (t) {
    case 'click':
    case 'dblclick':
      return ILucideMousePointerClick;
    case 'fill':
      return ILucideEdit3;
    case 'key':
      return ILucideKeyboard;
    case 'navigate':
      return ILucideCompass;
    case 'http':
      return ILucideGlobe;
    case 'script':
      return ILucideFileCode2;
    case 'extract':
      return ILucideScan;
    case 'wait':
      return ILucideHourglass;
    case 'assert':
      return ILucideCheckCircle2;
    case 'if':
      return ILucideGitBranch;
    case 'foreach':
      return ILucideRepeat;
    case 'while':
      return ILucideRefreshCcw;
    case 'openTab':
      return ILucideSquare;
    case 'switchTab':
      return ILucideArrowLeftRight;
    case 'closeTab':
      return ILucideX;
    case 'delay':
      return ILucideHourglass;
    default:
      return ILucideSquare;
  }
}

export function getTypeLabel(type?: string) {
  const labels: Record<string, string> = {
    click: '点击',
    fill: '填充',
    navigate: '导航',
    wait: '等待',
    extract: '提取',
    http: 'HTTP',
    script: '脚本',
    if: '条件',
    foreach: '循环',
    assert: '断言',
    key: '键盘',
    dblclick: '双击',
    openTab: '打开标签',
    switchTab: '切换标签',
    closeTab: '关闭标签',
    delay: '延迟',
    while: '循环',
  };
  return labels[String(type || '')] || type || '';
}

export function nodeSubtitle(node?: NodeBase | null): string {
  if (!node) return '';
  const summary = summarize(node);
  if (!summary) return node.type || '';
  return summary.length > 40 ? summary.slice(0, 40) + '...' : summary;
}
