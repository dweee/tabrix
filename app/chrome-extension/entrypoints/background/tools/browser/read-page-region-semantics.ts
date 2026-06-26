import type {
  ReadPageRegionLayoutHint,
  ReadPageRegionObject,
  ReadPageRegionTargetability,
  ReadPageRegionType,
} from '@tabrix/shared';
import {
  classifySensitiveOperationText,
  isLogoutOperationText,
  REGION_MATCHERS,
} from './read-page-perception-neutral';

export const REGION_PRIORITY: readonly ReadPageRegionType[] = [
  'modal',
  'qr_code',
  'account',
  'menu',
  'filter_panel',
  'search_area',
  'form',
  'feedback',
  'navigation',
  'result_list',
  'detail_area',
  'content',
  'unknown',
];

export function dominantLayoutHint(
  hints: readonly ReadPageRegionLayoutHint[],
): ReadPageRegionLayoutHint {
  const counts = new Map<ReadPageRegionLayoutHint, number>();
  for (const hint of hints) {
    if (!hint || hint === 'unknown' || hint === 'inline') continue;
    counts.set(hint, (counts.get(hint) ?? 0) + 1);
  }
  let best: ReadPageRegionLayoutHint = 'unknown';
  let bestCount = 0;
  for (const [hint, count] of counts) {
    if (count > bestCount) {
      best = hint;
      bestCount = count;
    }
  }
  return bestCount >= 2 ? best : 'unknown';
}

export function classifyRegionObject(object: ReadPageRegionObject): ReadPageRegionType {
  return classifyRegionText(
    `${object.objectType ?? ''} ${object.role ?? ''} ${object.label} ${object.actionTypes.join(' ')} ${object.reason}`,
  );
}

export function classifyRegionText(text: string): ReadPageRegionType {
  for (const regionType of REGION_PRIORITY) {
    if (regionType === 'unknown') continue;
    if (REGION_MATCHERS[regionType].some((pattern) => pattern.test(text))) return regionType;
  }
  return 'unknown';
}

export function redactSensitiveRegionObjects(
  regionType: ReadPageRegionType,
  objects: readonly ReadPageRegionObject[],
): ReadPageRegionObject[] {
  return objects.map((object) => {
    const label = safeRegionObjectLabel(regionType, object);
    const reason = safeRegionObjectReason(regionType, object);
    return label === object.label && reason === object.reason
      ? object
      : { ...object, label, reason };
  });
}

export function aggregateTargetability(
  objects: readonly ReadPageRegionObject[],
): ReadPageRegionTargetability {
  if (objects.some((object) => object.targetability === 'target_ref')) return 'target_ref';
  if (objects.some((object) => object.targetability === 'locator_chain')) return 'locator_chain';
  if (objects.some((object) => object.targetability === 'unknown')) return 'unknown';
  return objects.length > 0 ? 'not_clickable' : 'unknown';
}

export function aggregateLayoutHint(
  objects: readonly ReadPageRegionObject[],
): ReadPageRegionLayoutHint {
  return dominantLayoutHint(objects.map((object) => object.layoutHint ?? 'unknown'));
}

export function inferRegionState(
  regionType: ReadPageRegionType,
  objects: readonly ReadPageRegionObject[],
): string {
  const text = objects
    .map(
      (object) =>
        `${object.label} ${object.role ?? ''} ${object.actionTypes.join(' ')} ${object.reason}`,
    )
    .join(' ')
    .toLowerCase();
  switch (regionType) {
    case 'account':
      if (
        /candidate_action_(menu_trigger|logout_action)_signal/.test(text) ||
        /\b(menu|more|settings?|expand|dropdown|popover|drawer)\b|菜单|更多|设置|展开/i.test(text)
      ) {
        return 'account_menu_trigger_candidate';
      }
      if (/candidate_action_auth_trigger_signal/.test(text)) return 'logged_out_candidate';
      if (
        /candidate_action_profile_route_signal/.test(text) ||
        /\b(profile|user[ -]?home|homepage|personal page|member center)\b|个人主页|主页|个人中心|用户主页/i.test(
          text,
        )
      ) {
        return 'profile_route_candidate';
      }
      return /log\s?in|sign\s?in|登录|登陆/.test(text)
        ? 'logged_out_candidate'
        : 'logged_in_candidate';
    case 'menu':
      if (/logout|log\s?out|sign\s?out|退出|注销|settings?|设置/.test(text)) {
        return 'action_available_candidate';
      }
      return /expand|more|menu|更多|菜单/.test(text)
        ? 'collapsed_or_expandable_candidate'
        : 'unknown';
    case 'modal':
      return 'open_candidate';
    case 'qr_code':
      if (/expired|invalid|timed[ -]?out|过期|失效/i.test(text)) {
        return 'expired_or_refresh_available_candidate';
      }
      return 'waiting_scan_candidate';
    case 'form':
      return 'input_available_candidate';
    case 'search_area':
      return 'input_available_candidate';
    case 'filter_panel':
      return /option_select|time_range_select|filter option|筛选项|排序项/i.test(text)
        ? 'open_candidate'
        : 'filter_trigger_candidate';
    case 'result_list':
      return 'content_available_candidate';
    case 'detail_area':
      return 'content_available_candidate';
    case 'feedback':
      if (/error|failed|错误|失败/.test(text)) return 'error_candidate';
      if (/success|成功/.test(text)) return 'success_candidate';
      if (/loading|progress|加载|进度/.test(text)) return 'loading_candidate';
      return 'feedback_available_candidate';
    case 'content':
      return 'content_available_candidate';
    case 'navigation':
      if (/global_menu_item_signal/.test(text)) return 'global_menu_available_candidate';
      return 'navigation_available_candidate';
    case 'unknown':
      return 'unknown';
  }
}

export function buildRegionLabel(
  regionType: ReadPageRegionType,
  objects: readonly ReadPageRegionObject[],
): string {
  if (
    regionType === 'navigation' &&
    objects.some((object) => object.reason === 'global_menu_item_signal')
  ) {
    const layout = aggregateLayoutHint(objects);
    const layoutLabel = layout === 'unknown' ? 'global menu' : `${layout} global menu`;
    return `navigation: ${layoutLabel}`;
  }
  const firstLabel = objects[0]?.label ? `: ${objects[0].label}` : '';
  if (regionType === 'search_area') return 'search area';
  if (regionType === 'filter_panel') return 'filter panel';
  if (regionType === 'result_list') return 'result list';
  if (regionType === 'detail_area') return 'detail area';
  return `${regionType}${firstLabel}`;
}

export function claimBoundaryForRegion(regionType: ReadPageRegionType): string {
  switch (regionType) {
    case 'account':
      return 'account region candidate only; auth success or logout success requires post-action state change evidence';
    case 'menu':
      return 'menu/action region candidate only; needsVerification=post_action_state_change; click success or timeout is not business success';
    case 'modal':
      return 'modal region candidate only; blocked/auth state must be verified separately';
    case 'qr_code':
      return 'qr region candidate only; login success is not proven until account state changes';
    case 'navigation':
      return 'navigation/menu map candidate only; needsVerification=post_action_state_change; selected page, menu expansion, and business success require post-action verification';
    case 'search_area':
      return 'search area candidate derived from current read_page evidence; entering or submitting a query still requires post-action verification';
    case 'filter_panel':
      return 'filter panel candidate derived from current read_page evidence; selected filters and refreshed results require post-action verification';
    case 'result_list':
      return 'result list candidate derived from current read_page evidence; opening a card/detail requires candidateActions and post-action verification';
    case 'detail_area':
      return 'detail area candidate derived from current read_page evidence; content completeness requires task-specific verification';
    default:
      return 'page region candidate derived from current read_page evidence; not product-grade browser proof';
  }
}

function safeRegionObjectLabel(
  regionType: ReadPageRegionType,
  object: ReadPageRegionObject,
): string {
  switch (regionType) {
    case 'account':
      return object.targetability === 'not_clickable'
        ? 'account state candidate'
        : 'account action candidate';
    case 'menu':
      return isLogoutOperationText(`${object.label} ${object.reason}`)
        ? 'logout action candidate'
        : 'menu action candidate';
    case 'modal':
      return 'auth modal candidate';
    case 'qr_code':
      return 'QR scan area candidate';
    default:
      return object.label;
  }
}

function safeRegionObjectReason(
  regionType: ReadPageRegionType,
  object: ReadPageRegionObject,
): string {
  if (/^visible_text_/.test(object.reason)) return object.reason;
  switch (regionType) {
    case 'account':
      return object.targetability === 'not_clickable'
        ? 'redacted_account_state_signal'
        : 'redacted_account_action_signal';
    case 'menu':
      return isLogoutOperationText(`${object.label} ${object.reason}`)
        ? 'redacted_logout_action_signal'
        : 'redacted_menu_action_signal';
    case 'modal':
      return 'redacted_auth_modal_signal';
    case 'qr_code':
      return 'redacted_qr_region_signal';
    default:
      return object.reason;
  }
}
