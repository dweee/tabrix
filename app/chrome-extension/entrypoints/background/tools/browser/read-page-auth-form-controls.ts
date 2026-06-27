import { buildFallbackRefMap } from './read-page-fallback-format';
import { attachFallbackRefs } from './read-page-target-recovery';

export const AUTH_FORM_TARGETED_CONTROL_QUERIES = [
  '输入手机号',
  '手机号',
  '输入验证码',
  '验证码',
  '获取验证码',
  '发送验证码',
  '重新发送',
  '阅读并同意',
  '同意并继续',
  '登录',
] as const;

export interface AuthFormInteractiveCollectionResult {
  elements?: any[];
}

export type AuthFormInteractiveCollector = (
  tabId: number,
  options?: { textQuery?: string; includeCoordinates?: boolean; frameId?: number },
) => Promise<AuthFormInteractiveCollectionResult | null | undefined>;

export function hasAuthFormInteractiveContext(
  pageContent: string,
  visibleTextContent?: string | null,
): boolean {
  const text = `${pageContent || ''}\n${visibleTextContent || ''}`;
  if (!text.trim()) return false;
  return /手机号|手机号码|电话号码|短信验证码|输入验证码|获取验证码|发送验证码|重新发送|同意.*协议|隐私条款/i.test(
    text,
  );
}

export async function supplementAuthFormInteractiveControls(params: {
  tabId: number;
  basePayload: Record<string, any>;
  frameId?: number;
  collectInteractiveElementsFallback: AuthFormInteractiveCollector;
}): Promise<boolean> {
  if (
    !hasAuthFormInteractiveContext(
      String(params.basePayload.pageContent || ''),
      params.basePayload.visibleTextContent,
    )
  ) {
    return false;
  }

  const targetedElements: any[] = [];
  const seenTargetKeys = new Set<string>();
  for (const query of AUTH_FORM_TARGETED_CONTROL_QUERIES) {
    const targeted = await params.collectInteractiveElementsFallback(params.tabId, {
      textQuery: query,
      includeCoordinates: true,
      frameId: params.frameId,
    });
    const first = Array.isArray(targeted?.elements) ? targeted.elements[0] : null;
    if (!first) continue;
    const key = [
      String(first.selector || '').trim(),
      String(first.text || first.name || '').trim(),
      String(first.tagName || first.role || '').trim(),
    ].join('|');
    if (!key.trim() || seenTargetKeys.has(key)) continue;
    seenTargetKeys.add(key);
    targetedElements.push(first);
  }

  const fallback = await params.collectInteractiveElementsFallback(params.tabId, {
    frameId: params.frameId,
  });
  const broadElements = Array.isArray(fallback?.elements) ? fallback.elements : [];
  const fallbackElements = [...targetedElements, ...broadElements];
  if (fallbackElements.length === 0) return false;

  const merged = fallbackElements.slice(0, 150);
  const fallbackRefMap = buildFallbackRefMap(merged);
  const mergedWithRefs = attachFallbackRefs(merged, fallbackRefMap);
  const existingElements = Array.isArray(params.basePayload.elements)
    ? params.basePayload.elements
    : [];
  const existingRefMap = Array.isArray(params.basePayload.refMap) ? params.basePayload.refMap : [];

  params.basePayload.elements = [...existingElements, ...mergedWithRefs];
  params.basePayload.count = Math.max(
    Number(params.basePayload.count || 0),
    fallbackElements.length,
  );
  params.basePayload.refMap = [...existingRefMap, ...fallbackRefMap];
  params.basePayload.refMapCount = params.basePayload.refMap.filter(
    (entry: unknown) => entry != null,
  ).length;
  params.basePayload.fallbackUsed = true;
  params.basePayload.fallbackSource = params.basePayload.fallbackSource
    ? `${params.basePayload.fallbackSource}+auth_form_interactive_supplement`
    : 'auth_form_interactive_supplement';

  return true;
}
