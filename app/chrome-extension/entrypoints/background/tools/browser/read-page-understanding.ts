import type {
  PageFamilyAdapter,
  PageRole,
  PageUnderstandingContext,
  PageUnderstandingSummary,
  RegionRule,
} from './read-page-understanding-core';
import {
  buildUnderstandingContext,
  hasAnySignal,
  resolvePrimaryRegion,
} from './read-page-understanding-core';
import {
  KNOWLEDGE_REGISTRY_MODE,
  isKnowledgeRegistryDiffMode,
  isKnowledgeRegistryEnabled,
} from '../../knowledge/feature-flag';
import { resolveSiteProfile } from '../../knowledge/lookup/resolve-site-profile';
import { resolvePageRole } from '../../knowledge/lookup/resolve-page-role';

export type { PageRole, PageUnderstandingSummary } from './read-page-understanding-core';

const PAGE_FAMILY_ADAPTERS: PageFamilyAdapter[] = [
  // No platform-specific adapters. Tabrix uses generic page understanding.
  // Platform knowledge comes from the Knowledge layer (MKEP), not hardcoded adapters.
];

const LOGIN_GATE_RULES: RegionRule[] = [
  {
    region: 'login_gate',
    patterns: [
      /登录/i,
      /login/i,
      /sign[ -]?in/i,
      /手机号/i,
      /验证码/i,
      /phone/i,
      /verification code/i,
      /one[- ]?time code/i,
      /security code/i,
    ],
    minMatches: 2,
    priority: 1000,
    confidence: 'high',
  },
];

const FOOTER_SHELL_RULES: RegionRule[] = [
  {
    region: 'footer_shell',
    patterns: [
      /用户服务协议/i,
      /隐私政策/i,
      /联系我们/i,
      /账号授权协议/i,
      /terms of service/i,
      /privacy policy/i,
      /contact us/i,
    ],
    minMatches: 1,
    priority: 1000,
    confidence: 'low',
  },
];

const CONTENT_DETAIL_SIGNAL_GROUPS: readonly RegExp[] = [
  /\b(article|post|story|detail|content|heading)\b|正文|内容|笔记/i,
  /\b(author|profile|follow)\b|作者|主页|关注/i,
  /\b(like|favorite|save|collect|share)\b|点赞|收藏|分享|转发/i,
  /\b(comment|reply)\b|评论|回复|说点什么/i,
  /\b(image|video|gallery|media)\b|图片|视频|图文/i,
];

const SEARCH_SHELL_PATTERN =
  /\b(search results?(?: for)?|results for|search query|result filters?)\b|搜索结果|搜索词|筛选|过滤/i;
const PUBLISH_WORKFLOW_TITLE_PATTERN =
  /\b(creator|publish|compose|create|upload|draft|workspace|studio)\b|创作|发布|上传|草稿|工作台|创作者/i;

const GENERIC_CONTENT_ROUTE_SEGMENTS = new Set([
  'article',
  'articles',
  'content',
  'explore',
  'item',
  'items',
  'note',
  'notes',
  'post',
  'posts',
  'story',
  'stories',
]);

const GENERIC_PUBLISH_WORKFLOW_ROUTE_SEGMENTS = new Set([
  'compose',
  'create',
  'creator',
  'draft',
  'editor',
  'publish',
  'studio',
  'upload',
  'workspace',
]);

function runFamilyAdapters(context: PageUnderstandingContext): PageUnderstandingSummary | null {
  for (const adapter of PAGE_FAMILY_ADAPTERS) {
    const summary = adapter.infer(context);
    if (summary) {
      return summary;
    }
  }
  return null;
}

function inferLoginRequired(context: PageUnderstandingContext): PageUnderstandingSummary | null {
  const loginSignals = [context.lowerUrl, context.lowerTitle, context.content];
  const hasLoginHint = hasAnySignal(loginSignals, [/登录/i, /login/i, /sign[ -]?in/i]);
  const hasCredentialHint = hasAnySignal(loginSignals, [
    /手机号/i,
    /验证码/i,
    /phone/i,
    /verification code/i,
    /one[- ]?time code/i,
    /security code/i,
    /password/i,
    /密码/i,
    /email/i,
    /邮箱/i,
  ]);
  if (!hasLoginHint || !hasCredentialHint) {
    return null;
  }
  const loginRegion = resolvePrimaryRegion(loginSignals, LOGIN_GATE_RULES, 'login_gate', 'high');
  return {
    pageRole: 'login_required',
    primaryRegion: loginRegion.region,
    primaryRegionConfidence: loginRegion.confidence,
    footerOnly: context.footerOnly,
    anchorTexts: context.anchorTexts,
  };
}

function countContentDetailSignalGroups(context: PageUnderstandingContext): number {
  const sources = [context.lowerUrl, context.lowerTitle, context.content];
  return CONTENT_DETAIL_SIGNAL_GROUPS.filter((pattern) =>
    sources.some((source) => pattern.test(source)),
  ).length;
}

function hasGenericContentDetailRoute(lowerUrl: string): boolean {
  try {
    const parsed = new URL(lowerUrl);
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length < 2) {
      return false;
    }
    const [collection, leaf] = segments;
    if (!GENERIC_CONTENT_ROUTE_SEGMENTS.has(collection)) {
      return false;
    }
    return /^[a-z0-9][a-z0-9_-]{7,}$/i.test(leaf);
  } catch {
    return false;
  }
}

function hasExactSearchResultsRoute(lowerUrl: string): boolean {
  try {
    const parsed = new URL(lowerUrl);
    const normalizedPath = parsed.pathname.toLowerCase().replace(/\/+$/u, '');
    return normalizedPath === '/search_result' || normalizedPath === '/search_result_ai';
  } catch {
    return /(?:^|\/)search_result(?:_ai)?\/?(?:[?#]|$)/i.test(lowerUrl);
  }
}

function hasGenericPublishWorkflowRoute(lowerUrl: string): boolean {
  try {
    const parsed = new URL(lowerUrl);
    const segments = parsed.pathname.toLowerCase().split('/').filter(Boolean);
    return segments.some((segment) => GENERIC_PUBLISH_WORKFLOW_ROUTE_SEGMENTS.has(segment));
  } catch {
    return /(?:^|\/)(?:compose|create|creator|draft|editor|publish|studio|upload|workspace)(?:\/|[?#]|$)/i.test(
      lowerUrl,
    );
  }
}

function inferSearchResultsRoute(
  context: PageUnderstandingContext,
): PageUnderstandingSummary | null {
  if (context.footerOnly || !hasExactSearchResultsRoute(context.lowerUrl)) {
    return null;
  }
  return {
    pageRole: 'search_results',
    primaryRegion: 'search_results',
    primaryRegionConfidence: 'medium',
    footerOnly: context.footerOnly,
    anchorTexts: context.anchorTexts,
  };
}

function inferPublishWorkflowRoute(
  context: PageUnderstandingContext,
): PageUnderstandingSummary | null {
  if (context.footerOnly || !hasGenericPublishWorkflowRoute(context.lowerUrl)) {
    return null;
  }
  const sources = [context.lowerTitle, context.content];
  const hasWorkflowHint = hasAnySignal(sources, [
    PUBLISH_WORKFLOW_TITLE_PATTERN,
    /\b(upload|submit|publish|save|attach|choose file|select file)\b|上传|提交|发布|保存|选择文件|添加(?:图片|文件)|配图/i,
  ]);
  if (!hasWorkflowHint) {
    return null;
  }
  return {
    pageRole: 'publish_form',
    primaryRegion: 'form',
    primaryRegionConfidence: 'medium',
    footerOnly: context.footerOnly,
    anchorTexts: context.anchorTexts,
  };
}

function hasMeaningfulContentTitle(lowerTitle: string): boolean {
  const title = lowerTitle
    .replace(/\s*[-|·]\s*[^-|·]{1,30}$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (title.length < 8) {
    return false;
  }
  return !SEARCH_SHELL_PATTERN.test(title);
}

function inferContentDetail(context: PageUnderstandingContext): PageUnderstandingSummary | null {
  if (context.footerOnly) {
    return null;
  }
  const detailSignalGroups = countContentDetailSignalGroups(context);
  const routeDetail = hasGenericContentDetailRoute(context.lowerUrl);
  const titleDetail = hasMeaningfulContentTitle(context.lowerTitle);
  const routeBackedDetail = routeDetail && (titleDetail || detailSignalGroups >= 3);
  const searchShellSignals = [context.lowerTitle, context.content];
  if (hasAnySignal(searchShellSignals, [SEARCH_SHELL_PATTERN]) && !routeBackedDetail) {
    return null;
  }
  if (detailSignalGroups < 3 && !routeBackedDetail) {
    return null;
  }
  return {
    pageRole: 'content_detail',
    primaryRegion: 'content_detail',
    primaryRegionConfidence: 'medium',
    footerOnly: context.footerOnly,
    anchorTexts: context.anchorTexts,
  };
}

function inferFallback(context: PageUnderstandingContext): PageUnderstandingSummary {
  if (context.footerOnly) {
    const footerRegion = resolvePrimaryRegion([context.content], FOOTER_SHELL_RULES, null, null);
    return {
      pageRole: 'outer_shell',
      primaryRegion: footerRegion.region || 'footer_shell',
      primaryRegionConfidence: footerRegion.confidence || 'low',
      footerOnly: true,
      anchorTexts: context.anchorTexts,
    };
  }
  return {
    pageRole: 'unknown',
    primaryRegion: null,
    primaryRegionConfidence: null,
    footerOnly: context.footerOnly,
    anchorTexts: context.anchorTexts,
  };
}

function runLegacyPipeline(ctx: PageUnderstandingContext): PageUnderstandingSummary {
  const familySummary = runFamilyAdapters(ctx);
  if (familySummary) {
    return familySummary;
  }

  const loginSummary = inferLoginRequired(ctx);
  if (loginSummary) {
    return loginSummary;
  }

  const searchResultsSummary = inferSearchResultsRoute(ctx);
  if (searchResultsSummary) {
    return searchResultsSummary;
  }

  const publishWorkflowSummary = inferPublishWorkflowRoute(ctx);
  if (publishWorkflowSummary) {
    return publishWorkflowSummary;
  }

  const contentDetailSummary = inferContentDetail(ctx);
  if (contentDetailSummary) {
    return contentDetailSummary;
  }

  return inferFallback(ctx);
}

function summariesEqual(
  a: PageUnderstandingSummary | null,
  b: PageUnderstandingSummary | null,
): boolean {
  if (!a || !b) {
    return a === b;
  }
  if (
    a.pageRole !== b.pageRole ||
    a.primaryRegion !== b.primaryRegion ||
    a.primaryRegionConfidence !== b.primaryRegionConfidence ||
    a.footerOnly !== b.footerOnly
  ) {
    return false;
  }
  if (a.anchorTexts.length !== b.anchorTexts.length) {
    return false;
  }
  for (let i = 0; i < a.anchorTexts.length; i += 1) {
    if (a.anchorTexts[i] !== b.anchorTexts[i]) {
      return false;
    }
  }
  return true;
}

function resolveViaRegistry(ctx: PageUnderstandingContext): PageUnderstandingSummary | null {
  const siteId = resolveSiteProfile(ctx.lowerUrl);
  if (!siteId) {
    return null;
  }
  return resolvePageRole({ siteId, context: ctx });
}

export function inferPageUnderstanding(
  url: string,
  title: string,
  pageContent: string,
): PageUnderstandingSummary {
  const neutralContext = buildUnderstandingContext(url, title, pageContent);

  if (!isKnowledgeRegistryEnabled(KNOWLEDGE_REGISTRY_MODE)) {
    return runLegacyPipeline(neutralContext);
  }

  if (isKnowledgeRegistryDiffMode(KNOWLEDGE_REGISTRY_MODE)) {
    const registryHit = resolveViaRegistry(neutralContext);
    const legacy = runLegacyPipeline(neutralContext);
    if (registryHit && !summariesEqual(registryHit, legacy)) {
      console.warn('[tabrix/knowledge] registry/legacy diff', {
        url,
        registry: registryHit,
        legacy,
      });
    }
    return legacy;
  }

  const registryHit = resolveViaRegistry(neutralContext);
  if (registryHit) {
    return registryHit;
  }

  return runLegacyPipeline(neutralContext);
}
