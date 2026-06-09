import type { ReadPageInteractiveElement, ReadPageMode } from '@tabrix/shared';

interface SnapshotNode {
  role: string;
  name: string;
  ref: string;
  depth: number;
  href: string | null;
  selector?: string | null;
  valueState: 'empty' | 'non_empty' | 'unknown' | null;
  checked: boolean | 'mixed' | 'unknown' | null;
  matchSource: string | null;
  actionability: string | null;
}

export type SnapshotInteractiveElement = ReadPageInteractiveElement;

const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'option',
  'menuitem',
  'tab',
  'treeitem',
  'spinbutton',
]);

const COMPACT_ROLE_PRIORITY = new Map<string, number>([
  ['textbox', 70],
  ['searchbox', 70],
  ['combobox', 68],
  ['button', 56],
  ['tab', 52],
  ['menuitem', 48],
  ['link', 34],
]);

const COMPACT_ACTION_KEYWORDS =
  /(issues?|pull requests?|actions?|search|filter|label|milestone|assignee|summary|jobs?|run\b|login|sign in|submit|save|continue|next|confirm|apply|checkout|export|archive|details?|settings|手机号|验证码|登录|提交|保存|搜索|筛选|过滤|详情|设置|导出)/i;

const COMPACT_SHELL_NAME_PATTERNS = [/^skip to content$/i, /^search or jump to/i, /^open copilot/i];

const COMPACT_STATUS_LABEL_PATTERNS =
  /\b\d+\s+jobs?\b|completed|failed|cancelled|succeeded|in progress|queued/i;

const COMPACT_RUN_DETAIL_PATTERNS = /\brun\s+\d+\s+of\b|workflow run/i;
const GITHUB_WORKFLOW_RUN_DETAIL_URL_PATTERN =
  /https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+/i;
const WORKFLOW_RUN_DETAIL_HREF_BASE_PATTERN = /\/actions\/runs\/\d+/i;
const WORKFLOW_RUN_DETAIL_HREF_SUMMARY_PATTERN = /\/actions\/runs\/\d+(?:[/?#]|$)/i;
const WORKFLOW_RUN_DETAIL_HREF_JOB_PATTERN = /\/actions\/runs\/\d+\/job\/\d+/i;
const WORKFLOW_RUN_DETAIL_HREF_USAGE_PATTERN = /\/actions\/runs\/\d+\/usage(?:[/?#]|$)/i;
const WORKFLOW_RUN_DETAIL_HREF_WORKFLOW_PATTERN = /\/actions\/runs\/\d+\/workflow(?:[/?#]|$)/i;
const WORKFLOW_RUN_DETAIL_HREF_STEP_PATTERN = /#step(?::|=)|\/actions\/runs\/\d+\/job\/\d+.*#step/i;

const WORKFLOW_RUN_DETAIL_NAME_PRIORITY_PATTERN =
  /(summary|show all jobs|jobs?|artifacts?|annotations?|logs?|steps?)/i;

const WORKFLOW_RUN_DETAIL_METADATA_COMMIT_PATTERN = /^[0-9a-f]{7,40}$/i;
const WORKFLOW_RUN_DETAIL_METADATA_BRANCH_PATTERN = /^(main|master|develop|dev)$/i;
const WORKFLOW_RUN_DETAIL_METADATA_DURATION_PATTERN = /^\d+[smhd]$/i;

interface CompactScoringContext {
  workflowRunDetail: boolean;
}

const DEFAULT_COMPACT_SCORING_CONTEXT: CompactScoringContext = {
  workflowRunDetail: false,
};

const MIN_ACTIONABLE_SNAPSHOT_ELEMENTS_FOR_FALLBACK = 3;
const TEXT_MENU_TARGET_RECOVERY_REF_PREFIX = 'ref_text_menu_';
const TEXT_FILTER_PANEL_TARGET_RECOVERY_REF_PREFIX = 'ref_text_filter_panel_';
const TEXT_CONTROL_TARGET_RECOVERY_REF_PREFIX = 'ref_text_control_';
const DYNAMIC_SURFACE_TARGET_RECOVERY_REF_PREFIX = 'ref_dynamic_surface_';
const AUTH_FORM_CONTROL_NAME_PATTERN =
  /手机号|手机号码|电话号码|短信验证码|输入验证码|获取验证码|发送验证码|重新发送|登录|同意并继续|我同意/i;

function isGithubWorkflowRunDetailUrl(url: string): boolean {
  return GITHUB_WORKFLOW_RUN_DETAIL_URL_PATTERN.test(String(url || '').trim());
}

function inferWorkflowRunDetailLabelFromHref(href: string): string {
  const normalizedHref = String(href || '')
    .trim()
    .toLowerCase();
  if (!normalizedHref) return '';

  if (WORKFLOW_RUN_DETAIL_HREF_STEP_PATTERN.test(normalizedHref)) return 'Logs';
  if (WORKFLOW_RUN_DETAIL_HREF_JOB_PATTERN.test(normalizedHref)) return 'Jobs';
  if (WORKFLOW_RUN_DETAIL_HREF_USAGE_PATTERN.test(normalizedHref)) return 'Artifacts';
  if (
    WORKFLOW_RUN_DETAIL_HREF_WORKFLOW_PATTERN.test(normalizedHref) ||
    WORKFLOW_RUN_DETAIL_HREF_SUMMARY_PATTERN.test(normalizedHref)
  ) {
    return 'Summary';
  }

  return '';
}

function scoreWorkflowRunDetailNode(node: SnapshotNode): number {
  const name = String(node.name || '').trim();
  const href = String(node.href || '')
    .trim()
    .toLowerCase();
  let score = 0;

  if (WORKFLOW_RUN_DETAIL_NAME_PRIORITY_PATTERN.test(name)) score += 72;

  if (href) {
    if (WORKFLOW_RUN_DETAIL_HREF_BASE_PATTERN.test(href)) score += 18;
    if (WORKFLOW_RUN_DETAIL_HREF_SUMMARY_PATTERN.test(href)) score += 82;
    if (WORKFLOW_RUN_DETAIL_HREF_JOB_PATTERN.test(href)) score += 94;
    if (WORKFLOW_RUN_DETAIL_HREF_USAGE_PATTERN.test(href)) score += 76;
    if (WORKFLOW_RUN_DETAIL_HREF_WORKFLOW_PATTERN.test(href)) score += 78;
    if (WORKFLOW_RUN_DETAIL_HREF_STEP_PATTERN.test(href)) score += 102;

    if (/\/commit\//i.test(href)) score -= 130;
    if (/\/tree\/refs\/heads\//i.test(href)) score -= 120;
    if (/^\/[^/]+$/.test(href) || /github\.com\/[^/]+\/?$/.test(href)) score -= 98;
  }

  if (WORKFLOW_RUN_DETAIL_METADATA_COMMIT_PATTERN.test(name)) score -= 86;
  if (WORKFLOW_RUN_DETAIL_METADATA_BRANCH_PATTERN.test(name)) score -= 72;
  if (WORKFLOW_RUN_DETAIL_METADATA_DURATION_PATTERN.test(name)) score -= 66;

  return score;
}

function parseSnapshotNodesFromPageContent(pageContent: string): SnapshotNode[] {
  const lines = String(pageContent || '')
    .split('\n')
    .filter((line) => line.trim());

  const nodes: SnapshotNode[] = [];
  for (const rawLine of lines) {
    const trimmedLine = rawLine.trim();
    const match = trimmedLine.match(/^- ([^\s"]+)(?: "([^"]*)")? \[ref=([^\]]+)\]/);
    if (!match) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    const hrefMatch = trimmedLine.match(/\shref="([^"]+)"/i);
    const valueMatch =
      trimmedLine.match(/\svalue="([^"]*)"/i) ??
      trimmedLine.match(/\svalue:\s*"([^"]*)"/i) ??
      trimmedLine.match(/\svalue='([^']*)'/i);
    const valueStateMatch =
      trimmedLine.match(/\svalueState="(empty|non_empty|unknown)"/i) ??
      trimmedLine.match(/\svalue-state="(empty|non_empty|unknown)"/i);
    const checkedMatch =
      trimmedLine.match(/\schecked="(true|false|mixed|unknown)"/i) ??
      trimmedLine.match(/\saria-checked="(true|false|mixed|unknown)"/i) ??
      trimmedLine.match(/\schecked:\s*(true|false|mixed|unknown)/i);
    const matchSourceMatch =
      trimmedLine.match(/\smatchSource="([^"]+)"/i) ??
      trimmedLine.match(/\smatch-source="([^"]+)"/i);
    const actionabilityMatch = trimmedLine.match(/\sactionability="([^"]+)"/i);
    nodes.push({
      role: String(match[1] || 'generic')
        .trim()
        .toLowerCase(),
      name: String(match[2] || '')
        .replace(/\\"/g, '"')
        .trim(),
      ref: String(match[3] || '').trim(),
      depth: Math.max(0, Math.floor(indent / 2)),
      href: hrefMatch ? String(hrefMatch[1] || '').trim() : null,
      valueState: valueStateMatch
        ? normalizeValueState(valueStateMatch[1])
        : valueMatch
          ? valueStateFromRaw(valueMatch[1])
          : null,
      checked: checkedMatch ? normalizeCheckedState(checkedMatch[1]) : null,
      matchSource: matchSourceMatch ? String(matchSourceMatch[1] || '').trim() : null,
      actionability: actionabilityMatch ? String(actionabilityMatch[1] || '').trim() : null,
    });
    if (nodes.length >= 300) break;
  }
  return nodes;
}

function findDescendantLabel(nodes: SnapshotNode[], index: number): string {
  const node = nodes[index];
  let bestLabel = '';
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let cursor = index + 1; cursor < nodes.length; cursor += 1) {
    const candidate = nodes[cursor];
    if (candidate.depth <= node.depth) break;
    if (!candidate.name) continue;
    if (INTERACTIVE_ROLES.has(candidate.role)) continue;
    let score = 0;
    if (COMPACT_ACTION_KEYWORDS.test(candidate.name)) score += 24;
    if (
      /show|open|view|go to|filter|search|summary|jobs?|artifacts?|logs?|workflow/i.test(
        candidate.name,
      )
    )
      score += 18;
    if (candidate.name.length >= 8) score += 6;
    if (candidate.name.length >= 40) score -= 12;
    if (COMPACT_STATUS_LABEL_PATTERNS.test(candidate.name)) score -= 20;
    if (score > bestScore) {
      bestScore = score;
      bestLabel = candidate.name;
    }
  }
  return bestLabel;
}

function scoreCompactInteractiveNode(
  node: SnapshotNode,
  index: number,
  context: CompactScoringContext,
): number {
  const role = String(node.role || '').toLowerCase();
  const name = String(node.name || '').trim();
  const normalizedName = name.toLowerCase();
  const isRunDetail = COMPACT_RUN_DETAIL_PATTERNS.test(name);
  let score = 0;

  score += COMPACT_ROLE_PRIORITY.get(role) ?? 24;
  score += name ? 90 : -120;

  if (name.length >= 4) score += 8;
  if (name.length >= 12) score += 6;
  if (name.length >= 48) score -= 28;
  if (name.length >= 80) score -= 44;
  if (COMPACT_ACTION_KEYWORDS.test(name)) score += 28;
  if (isRunDetail) score += 56;
  if (COMPACT_SHELL_NAME_PATTERNS.some((pattern) => pattern.test(normalizedName))) score -= 80;
  if (context.workflowRunDetail) {
    score += scoreWorkflowRunDetailNode(node);
  }

  // Keep nearby content slightly preferred without letting early chrome dominate compact mode.
  score -= Math.floor(index / 12);
  return score;
}

function toInteractiveElement(node: SnapshotNode): SnapshotInteractiveElement {
  const element: SnapshotInteractiveElement = {
    ref: node.ref,
    role: node.role || 'generic',
    name: node.name || '',
  };
  const href = typeof node.href === 'string' ? node.href.trim() : '';
  if (href) element.href = href;
  const selector = typeof node.selector === 'string' ? node.selector.trim() : '';
  if (selector) element.selector = selector;
  if (node.valueState) element.valueState = node.valueState;
  if (node.checked !== null) element.checked = node.checked;
  if (node.matchSource) element.matchSource = node.matchSource;
  if (node.actionability) element.actionability = node.actionability;
  return element;
}

function valueStateFromRaw(value: unknown): 'empty' | 'non_empty' | 'unknown' {
  if (value === null || value === undefined) return 'unknown';
  if (typeof value === 'boolean') return value ? 'non_empty' : 'empty';
  const raw = String(value);
  return raw.length > 0 ? 'non_empty' : 'empty';
}

function normalizeValueState(value: unknown): 'empty' | 'non_empty' | 'unknown' | null {
  return value === 'empty' || value === 'non_empty' || value === 'unknown' ? value : null;
}

function normalizeCheckedState(value: unknown): boolean | 'mixed' | 'unknown' {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  if (normalized === 'mixed') return 'mixed';
  return 'unknown';
}

function normalizeFallbackRole(item: any): string {
  const raw = String(item?.role || item?.type || '')
    .trim()
    .toLowerCase();
  switch (raw) {
    case 'input':
    case 'textarea':
    case 'text':
      return 'textbox';
    case 'select':
      return 'combobox';
    case 'interactive':
      return 'button';
    case 'button':
    case 'link':
    case 'checkbox':
    case 'radio':
    case 'tab':
    case 'menuitem':
    case 'slider':
    case 'option':
    case 'treeitem':
    case 'switch':
    case 'searchbox':
    case 'combobox':
    case 'textbox':
      return raw;
    default:
      return item?.isInteractive === true ? 'button' : 'generic';
  }
}

function buildFallbackNodes(fallbackElements: any[]): SnapshotNode[] {
  const fromFallback = Array.isArray(fallbackElements) ? fallbackElements : [];
  return fromFallback.map((item: any, index: number) => ({
    ref: String(item?.ref || item?.selector || `fallback_${index + 1}`),
    role: normalizeFallbackRole(item),
    name: String(item?.text || item?.name || item?.ariaLabel || '').trim(),
    depth: 0,
    href: typeof item?.href === 'string' ? item.href : null,
    selector: typeof item?.selector === 'string' ? item.selector : null,
    valueState:
      normalizeValueState(item?.valueState) ??
      (Object.prototype.hasOwnProperty.call(item ?? {}, 'value')
        ? valueStateFromRaw(item.value)
        : null),
    checked: Object.prototype.hasOwnProperty.call(item ?? {}, 'checked')
      ? normalizeCheckedState(item.checked)
      : null,
    matchSource: typeof item?.matchSource === 'string' ? item.matchSource : null,
    actionability: typeof item?.actionability === 'string' ? item.actionability : null,
  }));
}

function mergeSnapshotWithFallback(
  snapshotElements: SnapshotInteractiveElement[],
  fallbackNodes: SnapshotNode[],
  limit: number,
): SnapshotInteractiveElement[] {
  if (fallbackNodes.length === 0 || snapshotElements.length >= limit) return snapshotElements;
  const merged = [...snapshotElements];
  const seen = new Set(
    snapshotElements.map(
      (item) =>
        `${String(item.ref || '').trim()}|${String(item.role || '').trim()}|${String(item.name || '').trim()}`,
    ),
  );
  for (const node of fallbackNodes) {
    const element = toInteractiveElement(node);
    const key = `${String(element.ref || '').trim()}|${String(element.role || '').trim()}|${String(element.name || '').trim()}`;
    if (!element.ref || seen.has(key)) continue;
    seen.add(key);
    merged.push(element);
    if (merged.length >= limit) break;
  }
  return merged;
}

function isTextMenuTargetRecoveryNode(node: SnapshotNode): boolean {
  const ref = String(node.ref || '');
  return (
    ref.startsWith(TEXT_MENU_TARGET_RECOVERY_REF_PREFIX) ||
    ref.startsWith(TEXT_FILTER_PANEL_TARGET_RECOVERY_REF_PREFIX) ||
    ref.startsWith(TEXT_CONTROL_TARGET_RECOVERY_REF_PREFIX) ||
    ref.startsWith(DYNAMIC_SURFACE_TARGET_RECOVERY_REF_PREFIX)
  );
}

function mergeSnapshotWithTextMenuTargetRecovery(
  snapshotElements: SnapshotInteractiveElement[],
  fallbackNodes: SnapshotNode[],
  limit: number,
): SnapshotInteractiveElement[] {
  const textMenuTargetNodes = fallbackNodes.filter(isTextMenuTargetRecoveryNode);
  if (textMenuTargetNodes.length === 0) return snapshotElements;

  const merged = mergeSnapshotWithFallback(
    snapshotElements,
    textMenuTargetNodes,
    Number.MAX_SAFE_INTEGER,
  );
  if (merged.length <= limit) return merged;

  const targetRefs = new Set(
    textMenuTargetNodes.map((node) => String(node.ref || '').trim()).filter(Boolean),
  );
  const targetRecoveryElements = merged.filter((item) =>
    targetRefs.has(String(item.ref || '').trim()),
  );
  const regularElements = merged.filter((item) => !targetRefs.has(String(item.ref || '').trim()));
  return [
    ...regularElements.slice(0, Math.max(0, limit - targetRecoveryElements.length)),
    ...targetRecoveryElements,
  ].slice(0, limit);
}

function isAuthFormControlRecoveryNode(node: SnapshotNode): boolean {
  if (!AUTH_FORM_CONTROL_NAME_PATTERN.test(String(node.name || ''))) return false;
  if (node.actionability === 'blocked') return false;
  return (
    node.role === 'textbox' ||
    node.role === 'searchbox' ||
    node.role === 'spinbutton' ||
    node.role === 'button' ||
    node.role === 'checkbox' ||
    node.role === 'switch'
  );
}

function mergeSnapshotWithAuthFormControlRecovery(
  snapshotElements: SnapshotInteractiveElement[],
  fallbackNodes: SnapshotNode[],
  limit: number,
): SnapshotInteractiveElement[] {
  const authControlNodes = fallbackNodes.filter(isAuthFormControlRecoveryNode);
  if (authControlNodes.length === 0) return snapshotElements;
  return mergeSnapshotWithFallback(snapshotElements, authControlNodes, limit);
}

function prioritizeCompactNodes(
  nodes: SnapshotNode[],
  limit: number,
  context: CompactScoringContext = DEFAULT_COMPACT_SCORING_CONTEXT,
): SnapshotInteractiveElement[] {
  return nodes
    .filter((node) => node.ref)
    .map((node, index) => ({
      node,
      index,
      score: scoreCompactInteractiveNode(node, index, context),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ node }) => toInteractiveElement(node));
}

export function buildInteractiveElements(
  pageContent: string,
  fallbackElements: any[],
  limit: number,
  mode: ReadPageMode,
  currentUrl: string,
): SnapshotInteractiveElement[] {
  const scoringContext: CompactScoringContext = {
    workflowRunDetail: isGithubWorkflowRunDetailUrl(currentUrl),
  };
  const nodes = parseSnapshotNodesFromPageContent(pageContent);
  const parsedInteractive = nodes
    .filter((node) => INTERACTIVE_ROLES.has(node.role))
    .map((node) => {
      const nodeIndex = nodes.findIndex((candidate) => candidate.ref === node.ref);
      const descendantLabel = nodeIndex >= 0 ? findDescendantLabel(nodes, nodeIndex) : '';
      const hrefLabel = scoringContext.workflowRunDetail
        ? inferWorkflowRunDetailLabelFromHref(node.href || '')
        : '';
      return {
        ...node,
        name: node.name || descendantLabel || hrefLabel,
      };
    });
  const source = parsedInteractive.length > 0 ? parsedInteractive : nodes;
  const fromSnapshot =
    mode === 'compact'
      ? prioritizeCompactNodes(source, limit, scoringContext)
      : source
          .filter((node) => node.ref)
          .slice(0, limit)
          .map((node) => toInteractiveElement(node));

  const fallbackNodes = buildFallbackNodes(fallbackElements);
  if (fromSnapshot.length > 0) {
    if (fromSnapshot.length >= MIN_ACTIONABLE_SNAPSHOT_ELEMENTS_FOR_FALLBACK) {
      return mergeSnapshotWithAuthFormControlRecovery(
        mergeSnapshotWithTextMenuTargetRecovery(fromSnapshot, fallbackNodes, limit),
        fallbackNodes,
        limit,
      );
    }
    return mergeSnapshotWithFallback(fromSnapshot, fallbackNodes, limit);
  }

  if (mode === 'compact') {
    return prioritizeCompactNodes(fallbackNodes, limit, scoringContext);
  }
  return fallbackNodes.slice(0, limit).map((node) => toInteractiveElement(node));
}
