import { cdpSessionManager } from './cdp-session-manager';

export type CDPPageReadiness = 'loading' | 'interactive' | 'complete' | 'unknown';

export interface CDPPageUrlSummary {
  href: string;
  origin: string;
  host: string;
  pathname: string;
  scheme: string;
  hasQuery: boolean;
  hasHash: boolean;
}

export interface CDPActiveElementSummary {
  tagName: string;
  type?: string;
  role?: string;
  idPresent: boolean;
  namePresent: boolean;
}

export interface CDPNavigationTimingSummary {
  type?: string;
  responseEndMs: number | null;
  domContentLoadedMs: number | null;
  loadEventMs: number | null;
}

export interface CDPRouteSummary {
  href: string;
  pathname: string;
  hasQuery: boolean;
  hasHash: boolean;
  fingerprint?: string;
  historyLength: number | null;
}

export interface CDPNetworkEventSummary {
  requestStartedCount: number;
  inFlightCount: number;
  failedRequestCount: number;
}

export interface CDPNetworkResourceSummary {
  resourceEntryCount: number;
  resourceInFlightCount: number;
  failedResourceStatusCount: number;
}

export interface CDPConsoleSummary {
  errorCount: number;
  warningCount: number;
}

export interface CDPDomControlScanSummary {
  queriedCount: number;
  uniqueSelectorCount: number;
  visibleInViewportCount: number;
  candidateCount: number;
  parsedCandidateCount: number;
}

export interface CDPAccessibilityStateSignals {
  checkedCount: number;
  selectedCount: number;
  expandedCount: number;
  disabledCount: number;
}

export interface CDPAccessibilityObjectStateSignals {
  checked?: boolean;
  selected?: boolean;
  expanded?: boolean;
  disabled?: boolean;
}

export interface CDPAccessibilityObjectLocator {
  source: 'cdp_ax' | 'cdp_dom';
  axNodeId?: string;
  backendDOMNodeId?: number;
  cssSelector?: string;
  nodeName?: string;
  visualBounds?: CDPElementRect;
}

export interface CDPElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NodeVisibilityProbe {
  domVisible: boolean;
  inViewport: boolean;
  centerHitTarget: boolean | null;
  occluded: boolean;
  valueState?: 'empty' | 'non_empty' | 'unknown';
  occludedBy?: string;
  reason: string;
}

export interface CDPAccessibilityObjectCandidate {
  role: string;
  label?: string;
  locator?: CDPAccessibilityObjectLocator;
  actionTypes: string[];
  state: CDPAccessibilityObjectStateSignals;
  visibilityProbe?: NodeVisibilityProbe;
}

export interface CDPAccessibilityRoleFrequency {
  role: string;
  count: number;
}

export interface CDPAccessibilityLocatorCoverage {
  locatorCandidateCount: number;
  axNodeIdCount: number;
  backendDOMNodeIdCount: number;
  locatorCoverageRate: number;
}

export interface CDPAccessibilitySummary {
  totalNodes: number;
  actionableNodeCount: number;
  actionableRoleTop: CDPAccessibilityRoleFrequency[];
  actionableSampleLabels: string[];
  stateSignals: CDPAccessibilityStateSignals;
  locatorCoverage: CDPAccessibilityLocatorCoverage;
  objectCandidates: CDPAccessibilityObjectCandidate[];
}

export type CDPPageStabilityHint = 'stable' | 'spa_navigating' | 'loading' | 'restricted';

export interface CDPPageSensingSnapshot {
  tabId: number;
  capturedAt: number;
  source: 'cdp';
  available: boolean;
  readiness: CDPPageReadiness;
  likelyLoading: boolean;
  stabilityHint: CDPPageStabilityHint;
  url?: CDPPageUrlSummary;
  title?: string;
  route?: CDPRouteSummary;
  visibilityState?: string;
  focused?: boolean;
  activeElement?: CDPActiveElementSummary;
  frameCount?: number;
  topFrameUrl?: CDPPageUrlSummary;
  navigation?: CDPNavigationTimingSummary;
  networkActivity?: CDPNetworkEventSummary;
  networkResources?: CDPNetworkResourceSummary;
  console?: CDPConsoleSummary;
  domControlScan?: CDPDomControlScanSummary;
  accessibility?: CDPAccessibilitySummary;
  partialErrors?: string[];
  error?: string;
}

interface RuntimeEvaluateResponse {
  result?: {
    value?: unknown;
    objectId?: string;
  };
}

interface CDPFrameTreeResponse {
  frameTree?: CDPFrameTree;
}

interface CDPFrameTree {
  frame?: {
    url?: string;
  };
  childFrames?: CDPFrameTree[];
}

const CDP_PAGE_SENSING_OWNER = 'page-sensing';
const MAX_TEXT_LENGTH = 160;
const CDP_PAGE_SENSING_EVENT_WINDOW_MS = 90;
const SPA_NETWORK_BURST_REQUEST_THRESHOLD = 3;
const SPA_NETWORK_BURST_INFLIGHT_THRESHOLD = 2;
const MAX_ACCESSIBILITY_SAMPLE_LABELS = 6;
const MAX_ACCESSIBILITY_ACTIONABLE_ROLE_KEYS = 6;
const MAX_ACCESSIBILITY_OBJECT_CANDIDATES = 24;
const ACCESSIBILITY_OBJECT_CANDIDATE_POOL_LIMIT = 160;
const ACCESSIBILITY_ACTIONABLE_ROLES = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'textbox',
  'searchbox',
  'combobox',
  'spinbutton',
  'listbox',
  'menuitem',
  'tab',
  'menuitemcheckbox',
  'option',
  'switch',
]);

const PAGE_STATE_PROBE = String.raw`(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const active = document.activeElement;
  const resourceEntries = performance.getEntriesByType('resource');
  const resourceSummary = resourceEntries.reduce(
    (acc, entry) => {
      const perfEntry = entry;
      acc.resourceEntryCount += 1;
      const responseEnd = typeof perfEntry.responseEnd === 'number' ? perfEntry.responseEnd : null;
      const responseStatus = perfEntry.responseStatus;
      if (responseEnd === 0) acc.resourceInFlightCount += 1;
      if (typeof responseStatus === 'number' && responseStatus >= 400 && responseStatus < 600) {
        acc.failedResourceStatusCount += 1;
      }
      return acc;
    },
    { resourceEntryCount: 0, resourceInFlightCount: 0, failedResourceStatusCount: 0 },
  );
  const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
  const cssString = (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const safeText = (value) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 80) return '';
    if (/token|secret|password|passwd|authorization|bearer|cookie|session/i.test(text)) return '';
    return text;
  };
  const selectorCandidates = (element) => {
    const tag = String(element.tagName || '').toLowerCase();
    const candidates = [];
    const id = safeText(element.id);
    if (id && typeof CSS?.escape === 'function') candidates.push('#' + CSS.escape(id));
    for (const name of ['data-testid', 'data-test', 'data-cy', 'aria-label']) {
      const value = safeText(element.getAttribute(name));
      if (value) candidates.push(tag + '[' + name + '="' + cssString(value) + '"]');
    }
    const name = safeText(element.getAttribute('name'));
    const type = safeText(element.getAttribute('type'));
    if (name && type) {
      candidates.push(
        tag + '[name="' + cssString(name) + '"][type="' + cssString(type) + '"]',
      );
    }
    if (name) candidates.push(tag + '[name="' + cssString(name) + '"]');
    if (element.classList && typeof CSS?.escape === 'function') {
      const stableClasses = Array.from(element.classList)
        .map((value) => String(value || '').trim())
        .filter(
          (value) =>
            /^[A-Za-z_][A-Za-z0-9_-]{1,63}$/.test(value) &&
            !/^(css|jsx|sc|style)-?[a-f0-9]{6,}$/i.test(value),
        )
        .slice(0, 3);
      for (const className of stableClasses) {
        candidates.push(tag + '.' + CSS.escape(className));
      }
      if (stableClasses.length > 1) {
        candidates.push(
          tag + stableClasses.slice(0, 2).map((value) => '.' + CSS.escape(value)).join(''),
        );
      }
    }
    return candidates;
  };
  const uniqueSelector = (element) => {
    const candidates = selectorCandidates(element);
    for (const selector of candidates) {
      try {
        if (document.querySelectorAll(selector).length === 1) return selector;
      } catch {}
    }
    return '';
  };
  const anchoredDescendantSelector = (anchor, target) => {
    const anchorSelector = uniqueSelector(anchor);
    if (!anchorSelector) return '';
    const targetSelectors = selectorCandidates(target);
    let commonAncestor = anchor.parentElement;
    while (
      commonAncestor &&
      commonAncestor !== document.body &&
      commonAncestor !== document.documentElement
    ) {
      if (commonAncestor.contains(target)) {
        for (const containerSelector of selectorCandidates(commonAncestor)) {
          for (const targetSelector of targetSelectors) {
            const selector =
              containerSelector + ':has(' + anchorSelector + ') ' + targetSelector;
            try {
              const matches = document.querySelectorAll(selector);
              if (matches.length === 1 && matches[0] === target) return selector;
            } catch {}
          }
        }
      }
      commonAncestor = commonAncestor.parentElement;
    }
    for (const containerSelector of [
      'form',
      '[role="search"]',
      'header',
      'nav',
      'section',
      'div',
    ]) {
      for (const targetSelector of targetSelectors) {
        const selector =
          containerSelector + ':has(' + anchorSelector + ') ' + targetSelector;
        try {
          const matches = document.querySelectorAll(selector);
          if (matches.length === 1 && matches[0] === target) return selector;
        } catch {}
      }
    }
    return '';
  };
  const inferRole = (element) => {
    const explicit = String(element.getAttribute('role') || '').toLowerCase();
    if (['searchbox', 'textbox', 'combobox', 'spinbutton'].includes(explicit)) return explicit;
    const tag = String(element.tagName || '').toLowerCase();
    const type = String(element.getAttribute('type') || '').toLowerCase();
    if (tag === 'select') return 'combobox';
    if (type === 'search') return 'searchbox';
    const identity = [
      element.id,
      element.getAttribute('name'),
      element.getAttribute('aria-label'),
      element.getAttribute('placeholder'),
    ]
      .filter(Boolean)
      .join(' ');
    if (/\b(search|query|find)\b|搜索|查找|查询/i.test(identity)) return 'searchbox';
    if (tag === 'input' || tag === 'textarea' || element.getAttribute('contenteditable') === 'true') {
      return 'textbox';
    }
    return explicit || 'textbox';
  };
  const inferLabel = (element, role) => {
    const id = safeText(element.id);
    const associatedLabel =
      id && typeof CSS?.escape === 'function'
        ? document.querySelector('label[for="' + cssString(id) + '"]')
        : null;
    return (
      safeText(element.getAttribute('aria-label')) ||
      safeText(element.getAttribute('placeholder')) ||
      safeText(associatedLabel?.textContent) ||
      safeText(element.getAttribute('name')) ||
      safeText(element.getAttribute('title')) ||
      role
    );
  };
  const formControlElements = Array.from(
    document.querySelectorAll(
      'input,textarea,select,[contenteditable="true"],[role="searchbox"],[role="textbox"],[role="combobox"],[role="spinbutton"]',
    ),
  );
  let uniqueSelectorCount = 0;
  let visibleInViewportCount = 0;
  const visibleFormControls = formControlElements
    .flatMap((element) => {
      const tag = String(element.tagName || '').toLowerCase();
      const type = String(element.getAttribute('type') || '').toLowerCase();
      if (tag === 'input' && ['hidden', 'password', 'file', 'checkbox', 'radio', 'submit', 'button', 'reset', 'image'].includes(type)) {
        return [];
      }
      const selector = uniqueSelector(element);
      if (!selector) return [];
      uniqueSelectorCount += 1;
      const computed = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const domVisible =
        computed.display !== 'none' &&
        computed.visibility !== 'hidden' &&
        computed.visibility !== 'collapse' &&
        Number.parseFloat(computed.opacity || '1') !== 0 &&
        rect.width > 0 &&
        rect.height > 0;
      const inViewport =
        rect.right > 0 &&
        rect.bottom > 0 &&
        rect.left < viewportWidth &&
        rect.top < viewportHeight;
      if (!domVisible || !inViewport) return [];
      visibleInViewportCount += 1;
      const cx = Math.min(Math.max(rect.left + rect.width / 2, 0), Math.max(viewportWidth - 1, 0));
      const cy = Math.min(Math.max(rect.top + rect.height / 2, 0), Math.max(viewportHeight - 1, 0));
      const hit = document.elementFromPoint(cx, cy);
      const centerHitTarget = Boolean(hit && (hit === element || element.contains(hit)));
      const role = inferRole(element);
      let valueState = 'unknown';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        valueState = String(element.value || '').length > 0 ? 'non_empty' : 'empty';
      } else if (element.getAttribute('contenteditable') === 'true') {
        valueState = String(element.textContent || '').length > 0 ? 'non_empty' : 'empty';
      }
      return [{
        role,
        label: inferLabel(element, role),
        cssSelector: selector,
        nodeName: tag,
        actionTypes: ['focus', 'setvalue'],
        disabled: element.disabled === true || element.getAttribute('aria-disabled') === 'true',
        valueState,
        visualBounds: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        visibilityProbe: {
          domVisible,
          inViewport,
          centerHitTarget,
          occluded: !centerHitTarget,
          valueState,
          reason: centerHitTarget ? 'visible_unobstructed' : 'center_occluded',
        },
      }];
    })
    .slice(0, 16);
  const associatedSearchControls = [];
  for (const searchElement of formControlElements.filter(
    (element) => inferRole(element) === 'searchbox',
  )) {
    const searchComputed = window.getComputedStyle(searchElement);
    const searchRect = searchElement.getBoundingClientRect();
    const searchDomVisible =
      searchComputed.display !== 'none' &&
      searchComputed.visibility !== 'hidden' &&
      searchComputed.visibility !== 'collapse' &&
      Number.parseFloat(searchComputed.opacity || '1') !== 0 &&
      searchRect.width > 0 &&
      searchRect.height > 0;
    const searchInViewport =
      searchRect.right > 0 &&
      searchRect.bottom > 0 &&
      searchRect.left < viewportWidth &&
      searchRect.top < viewportHeight;
    if (!searchDomVisible || !searchInViewport) continue;
    const formOwnerOf = (element) => element.form || element.closest('form');
    const searchFormOwner = formOwnerOf(searchElement);
    const searchSurfaceIdentity = (element) =>
      [
        element.getAttribute('role'),
        element.getAttribute('aria-label'),
        element.getAttribute('id'),
        element.getAttribute('class'),
        element.getAttribute('data-testid'),
        element.getAttribute('data-test'),
        element.getAttribute('data-cy'),
      ]
        .map(safeText)
        .filter(Boolean)
        .join(' ');
    const isSemanticSearchSurface = (element) =>
      element.getAttribute('role') === 'search' ||
      /\b(search|find|query)\b|搜索|查找|查询/i.test(searchSurfaceIdentity(element));
    let semanticSearchSurface = searchElement.closest('[role="search"]');
    if (!semanticSearchSurface) {
      let current = searchElement.parentElement;
      const maxSearchSurfaceAncestorDepth = 5;
      for (let level = 0; current && level < maxSearchSurfaceAncestorDepth; level += 1) {
        if (current === document.body || current === document.documentElement) break;
        if (isSemanticSearchSurface(current)) {
          semanticSearchSurface = current;
          break;
        }
        current = current.parentElement;
      }
    }
    const scope = searchFormOwner || semanticSearchSurface || searchElement.parentElement;
    if (!scope || scope === document.body || scope === document.documentElement) continue;
    const ariaReferences = (source, target) => {
      const targetId = safeText(target.id);
      if (!targetId) return false;
      return ['aria-controls', 'aria-owns'].some((attribute) =>
        safeText(source.getAttribute(attribute))
          .split(/\s+/)
          .filter(Boolean)
          .includes(targetId),
      );
    };
    const iconSignalText = (element) =>
      Array.from(element.querySelectorAll('use'))
        .flatMap((icon) => [
          icon.getAttribute('href'),
          icon.getAttribute('xlink:href'),
          icon.getAttributeNS?.('http://www.w3.org/1999/xlink', 'href'),
        ])
        .concat([
          element.getAttribute('class'),
          ...Array.from(element.querySelectorAll('svg')).map((icon) =>
            icon.getAttribute('class'),
          ),
        ])
        .map(safeText)
        .filter(Boolean)
        .join(' ');
    const hasSearchIconSignal = (element) =>
      /\b(search|find|query|submit|magnif)\b|搜索|查找|查询/i.test(
        iconSignalText(element),
      );
    const clickableFacts = (element) => {
      const tag = String(element.tagName || '').toLowerCase();
      const type = String(element.getAttribute('type') || '').toLowerCase();
      const role = String(element.getAttribute('role') || '').toLowerCase();
      const style = window.getComputedStyle(element);
      return {
        semanticallyClickable:
          tag === 'button' ||
          tag === 'a' ||
          role === 'button' ||
          (tag === 'input' && ['submit', 'button', 'image'].includes(type)),
        behaviorallyClickable:
          element.tabIndex >= 0 ||
          typeof element.onclick === 'function' ||
          style.cursor === 'pointer' ||
          style.cursor === 'not-allowed',
        searchIconClickable: hasSearchIconSignal(element),
      };
    };
    const owningClickTarget = (element) => {
      let current = element;
      let behavioralOwner = null;
      let iconOwner = null;
      while (current && current !== scope && current !== searchElement) {
        const facts = clickableFacts(current);
        if (facts.semanticallyClickable) return current;
        if (!behavioralOwner && current instanceof HTMLElement && facts.behaviorallyClickable) {
          behavioralOwner = current;
        }
        if (!iconOwner && current instanceof HTMLElement && facts.searchIconClickable) {
          const rect = current.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && rect.width <= 180 && rect.height <= 120) {
            iconOwner = current;
          }
        }
        current = current.parentElement;
      }
      return iconOwner || behavioralOwner;
    };
    const rawNearbyCandidates = Array.from(scope.querySelectorAll('*'))
      .map((element) => owningClickTarget(element))
      .filter(Boolean);
    const nearbyCandidates = Array.from(new Set(rawNearbyCandidates))
      .filter((element) => {
        if (element === searchElement || element.contains(searchElement)) return false;
        const { semanticallyClickable, behaviorallyClickable, searchIconClickable } =
          clickableFacts(element);
        if (!semanticallyClickable && !behaviorallyClickable && !searchIconClickable) return false;
        const label =
          [
            element.getAttribute('aria-label'),
            element.getAttribute('title'),
            element.textContent,
          ]
            .map(safeText)
            .find(Boolean) || '';
        if (/\b(clear|reset|close|cancel)\b|清除|重置|关闭|取消/i.test(label)) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || rect.width > 180 || rect.height > 120) {
          return false;
        }
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        return (
          cx >= searchRect.left - 80 &&
          cx <= searchRect.right + 140 &&
          cy >= searchRect.top - 60 &&
          cy <= searchRect.bottom + 60
        );
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const tag = String(element.tagName || '').toLowerCase();
        const type = String(element.getAttribute('type') || '').toLowerCase();
        const role = String(element.getAttribute('role') || '').toLowerCase();
        const label =
          [
            element.getAttribute('aria-label'),
            element.getAttribute('title'),
            element.textContent,
          ]
            .map(safeText)
            .find(Boolean) || '';
        const iconSignal = iconSignalText(element);
        const semanticText = label + ' ' + iconSignal;
        if (
          /\b(clear|reset|close|cancel|voice|microphone|camera|image|settings?)\b|清除|重置|关闭|取消|语音|麦克风|相机|图片|设置/i.test(
            semanticText,
          )
        ) {
          return null;
        }
        const directSemanticText =
          label + ' ' + safeText(element.getAttribute('class'));
        const explicitSubmit =
          (tag === 'button' && type === 'submit') || ['submit', 'image'].includes(type);
        const searchSemantic = /\b(search|find|query|magnif)\b|搜索|查找|查询/i.test(
          semanticText,
        );
        const directSearchSemantic =
          /\b(search|find|query|magnif)\b|搜索|查找|查询/i.test(
            directSemanticText,
          );
        const directSubmitSemantic = /\bsubmit\b|提交/i.test(directSemanticText);
        if (!explicitSubmit && !searchSemantic) return null;
        const candidateFormOwner = formOwnerOf(element);
        const sameFormOwner = Boolean(
          searchFormOwner && candidateFormOwner === searchFormOwner,
        );
        const ariaRelated =
          ariaReferences(searchElement, element) || ariaReferences(element, searchElement);
        const boundedSearchSurfaceOwner = Boolean(
          semanticSearchSurface &&
          semanticSearchSurface.contains(searchElement) &&
          semanticSearchSurface.contains(element),
        );
        if (
          !sameFormOwner &&
          !ariaRelated &&
          !boundedSearchSurfaceOwner &&
          !searchSemantic
        ) {
          return null;
        }
        const semanticScore =
          explicitSubmit || tag === 'button' || role === 'button' ? 100 : 0;
        const searchLabelScore = directSearchSemantic
          ? 120
          : directSubmitSemantic && searchSemantic
            ? 100
            : searchSemantic
              ? 80
              : 0;
        const rightEdgeScore =
          rect.left + rect.width / 2 >= searchRect.left + searchRect.width / 2 ? 30 : 0;
        const distancePenalty = Math.abs(searchRect.right - (rect.left + rect.width / 2));
        return {
          element,
          rect,
          score: semanticScore + searchLabelScore + rightEdgeScore - distancePenalty / 10,
        };
      })
      .filter(Boolean)
      .sort((left, right) => right.score - left.score);
    const rankedCandidates = nearbyCandidates
      .map((candidate) => ({
        ...candidate,
        selector:
          uniqueSelector(candidate.element) ||
          anchoredDescendantSelector(searchElement, candidate.element),
      }))
      .filter((candidate) => candidate.selector);
    const selected = rankedCandidates[0];
    const runnerUp = rankedCandidates[1];
    if (selected && runnerUp && Math.abs(selected.score - runnerUp.score) < 2) {
      continue;
    }
    if (!selected) continue;
    const best = selected;
    const selector = selected.selector;
    const computed = window.getComputedStyle(best.element);
    const domVisible =
      computed.display !== 'none' &&
      computed.visibility !== 'hidden' &&
      computed.visibility !== 'collapse' &&
      Number.parseFloat(computed.opacity || '1') !== 0;
    const inViewport =
      best.rect.right > 0 &&
      best.rect.bottom > 0 &&
      best.rect.left < viewportWidth &&
      best.rect.top < viewportHeight;
    if (!domVisible || !inViewport) continue;
    const cx = Math.min(
      Math.max(best.rect.left + best.rect.width / 2, 0),
      Math.max(viewportWidth - 1, 0),
    );
    const cy = Math.min(
      Math.max(best.rect.top + best.rect.height / 2, 0),
      Math.max(viewportHeight - 1, 0),
    );
    const hit = document.elementFromPoint(cx, cy);
    const centerHitTarget = Boolean(
      hit && (hit === best.element || best.element.contains(hit)),
    );
    const hasDisabledSignal = (element) => {
      const className = String(element.getAttribute('class') || '');
      return (
        element.disabled === true ||
        element.getAttribute('aria-disabled') === 'true' ||
        element.hasAttribute('inert') ||
        element.inert === true ||
        /\b(?:is-)?disabled\b/i.test(className)
      );
    };
    const disabledOwnerChain = (() => {
      let current = best.element;
      while (current && current !== scope.parentElement) {
        const style = window.getComputedStyle(current);
        if (
          hasDisabledSignal(current) ||
          style.cursor === 'not-allowed' ||
          style.pointerEvents === 'none'
        ) {
          return true;
        }
        if (current === scope) break;
        current = current.parentElement;
      }
      return false;
    })();
    const disabledDescendant = Array.from(
      best.element.querySelectorAll('[disabled], [aria-disabled="true"], .disabled, .is-disabled'),
    ).some((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        hasDisabledSignal(element) &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number.parseFloat(style.opacity || '1') > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    });
    const disabled =
      disabledOwnerChain ||
      disabledDescendant ||
      computed.cursor === 'not-allowed' ||
      computed.pointerEvents === 'none';
    associatedSearchControls.push({
      role: 'button',
      label: 'search submit',
      cssSelector: selector,
      nodeName: String(best.element.tagName || '').toLowerCase(),
      actionTypes: disabled ? [] : ['click'],
      disabled,
      valueState: 'unknown',
      visualBounds: {
        x: Math.round(best.rect.left),
        y: Math.round(best.rect.top),
        width: Math.round(best.rect.width),
        height: Math.round(best.rect.height),
      },
      visibilityProbe: {
        domVisible,
        inViewport,
        centerHitTarget,
        occluded: !centerHitTarget,
        valueState: 'unknown',
        reason: centerHitTarget ? 'visible_unobstructed' : 'center_occluded',
      },
    });
  }
  const visibleDomControls = [...visibleFormControls, ...associatedSearchControls].slice(0, 20);
  const domControlScan = {
    queriedCount: formControlElements.length,
    uniqueSelectorCount,
    visibleInViewportCount,
    candidateCount: visibleDomControls.length,
  };
 return {
    readyState: document.readyState,
    visibilityState: document.visibilityState,
    focused: document.hasFocus(),
    networkResources: resourceSummary,
    url: location.href,
    title: document.title,
    route: {
      url: location.href,
      historyLength: Number.isFinite(history.length) ? history.length : null,
    },
    activeElement: active
      ? {
          tagName: active.tagName,
          type: active.getAttribute('type') || undefined,
          role: active.getAttribute('role') || undefined,
          idPresent: Boolean(active.id),
          namePresent: Boolean(active.getAttribute('name')),
        }
      : null,
    visibleFormControls: visibleDomControls,
    domControlScan,
    navigation: nav
      ? {
          type: nav.type,
          responseEndMs: nav.responseEnd || null,
          domContentLoadedMs: nav.domContentLoadedEventEnd || null,
          loadEventMs: nav.loadEventEnd || null,
        }
      : null,
  };
})()`;

const NODE_VISIBILITY_PROBE = String.raw`function() {
  const element = this;
  if (!(element instanceof Element)) {
    return {
      domVisible: true,
      inViewport: false,
      centerHitTarget: null,
      occluded: false,
      reason: 'backend_node_unresolved',
    };
  }
  const viewportWidth =
    typeof window.innerWidth === 'number'
      ? window.innerWidth
      : typeof document.documentElement?.clientWidth === 'number'
        ? document.documentElement.clientWidth
        : 0;
  const viewportHeight =
    typeof window.innerHeight === 'number'
      ? window.innerHeight
      : typeof document.documentElement?.clientHeight === 'number'
        ? document.documentElement.clientHeight
        : 0;
  const computed = window.getComputedStyle(element);
  const rect = typeof element.getBoundingClientRect === 'function' ? element.getBoundingClientRect() : null;
  const tagName = String(element.tagName || '').toLowerCase();
  const role = String(element.getAttribute('role') || '').toLowerCase();
  let valueState = 'unknown';
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
    valueState = String(element.value || '').length > 0 ? 'non_empty' : 'empty';
  } else if (element.getAttribute('contenteditable') === 'true') {
    valueState = String(element.textContent || '').length > 0 ? 'non_empty' : 'empty';
  } else if (
    role === 'textbox' ||
    role === 'searchbox' ||
    role === 'combobox' ||
    role === 'spinbutton'
  ) {
    const ariaValue =
      element.getAttribute('aria-valuetext') ||
      element.getAttribute('aria-valuenow') ||
      element.getAttribute('data-value') ||
      '';
    valueState = ariaValue ? 'non_empty' : 'unknown';
  }
  const offsetParentMissing = element instanceof HTMLElement && element.offsetParent === null;
  const position = computed.position || '';
  const displayNone = computed.display === 'none';
  const hiddenVisibility = computed.visibility === 'hidden' || computed.visibility === 'collapse';
  const opacityZero = Number.parseFloat(computed.opacity || '1') === 0;
  const zeroSize =
    !rect ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    element.clientWidth <= 0 ||
    element.clientHeight <= 0;
  const detachedByOffsetParent = offsetParentMissing && position !== 'fixed';
  const domVisible = !(displayNone || hiddenVisibility || opacityZero || zeroSize || detachedByOffsetParent);
  const inViewport = Boolean(
    rect && rect.right > 0 && rect.bottom > 0 && rect.left < viewportWidth && rect.top < viewportHeight,
  );
  let centerHitTarget = null;
  let occluded = false;
  let occludedBy;
  if (rect && rect.width > 0 && rect.height > 0) {
    const cx = Math.min(Math.max(rect.left + rect.width / 2, 0), Math.max(viewportWidth - 1, 0));
    const cy = Math.min(Math.max(rect.top + rect.height / 2, 0), Math.max(viewportHeight - 1, 0));
    const hit = document.elementFromPoint(cx, cy);
    if (hit) {
      centerHitTarget = element === hit || element.contains(hit);
      occluded = !centerHitTarget;
      if (occluded) {
        const tagName = typeof hit.tagName === 'string' ? hit.tagName.toLowerCase() : undefined;
        if (tagName) occludedBy = tagName;
      }
    } else {
      centerHitTarget = false;
      occluded = true;
    }
  }
  const reasons = [];
  if (displayNone) reasons.push('display_none');
  if (hiddenVisibility) reasons.push('visibility_hidden');
  if (opacityZero) reasons.push('opacity_zero');
  if (detachedByOffsetParent) reasons.push('offset_parent_null');
  if (zeroSize) reasons.push('zero_size');
  if (!inViewport) reasons.push('outside_viewport');
  if (occluded) reasons.push('center_occluded');
  if (reasons.length === 0) reasons.push('visible_unobstructed');
  return {
    domVisible,
    inViewport,
    centerHitTarget,
    occluded,
    valueState,
    ...(occludedBy ? { occludedBy } : {}),
    reason: reasons.join('+'),
  };
}`;

export async function captureCDPPageSensingSnapshot(
  tabId: number,
): Promise<CDPPageSensingSnapshot> {
  const capturedAt = Date.now();
  const networkActivity: CDPNetworkEventSummary = {
    requestStartedCount: 0,
    inFlightCount: 0,
    failedRequestCount: 0,
  };
  const consoleSummary: CDPConsoleSummary = { errorCount: 0, warningCount: 0 };
  const startedRequests = new Set<string>();
  const inFlightRequests = new Set<string>();
  const failedRequests = new Set<string>();
  let topFrameNavigatedAfterReady = false;
  let navigatedFrameUrl: string | undefined;
  const partialErrors: string[] = [];
  const recordPartialError = (code: string): void => {
    if (!partialErrors.includes(code)) partialErrors.push(code);
  };

  try {
    return await cdpSessionManager.withSession(tabId, CDP_PAGE_SENSING_OWNER, async () => {
      const eventListener = (
        source: { tabId?: number },
        method: string,
        params?: unknown,
      ): void => {
        if (source?.tabId !== tabId) return;
        if (method === 'Network.requestWillBeSent') {
          const requestId = asString((params as Record<string, unknown> | undefined)?.requestId);
          if (!requestId) return;
          if (!startedRequests.has(requestId)) {
            startedRequests.add(requestId);
            networkActivity.requestStartedCount += 1;
          }
          inFlightRequests.add(requestId);
          return;
        }
        if (method === 'Network.loadingFinished') {
          const requestId = asString((params as Record<string, unknown> | undefined)?.requestId);
          if (!requestId) return;
          inFlightRequests.delete(requestId);
          return;
        }
        if (method === 'Network.loadingFailed') {
          const requestId = asString((params as Record<string, unknown> | undefined)?.requestId);
          if (!requestId) return;
          inFlightRequests.delete(requestId);
          if (!failedRequests.has(requestId)) {
            failedRequests.add(requestId);
            networkActivity.failedRequestCount += 1;
          }
          return;
        }
        if (method === 'Page.frameNavigated') {
          const frame = asRecord((params as Record<string, unknown> | undefined)?.frame);
          const parentId = asString(frame?.parentId);
          if (parentId) return;
          topFrameNavigatedAfterReady = true;
          navigatedFrameUrl = asString(frame?.url);
          return;
        }
        if (method === 'Log.entryAdded') {
          const entry = asRecord((params as Record<string, unknown> | undefined)?.entry);
          const level = asString(entry?.level);
          if (!level) return;
          if (level === 'error' || level === 'fatal') consoleSummary.errorCount += 1;
          if (level === 'warning') consoleSummary.warningCount += 1;
        }
      };

      cdpSessionManager.addEventListener(eventListener);
      try {
        await Promise.all([
          cdpSessionManager.sendCommand(tabId, 'Runtime.enable').catch(() => {
            recordPartialError('runtime_enable_failed');
            return undefined;
          }),
          cdpSessionManager.sendCommand(tabId, 'Page.enable').catch(() => {
            recordPartialError('page_enable_failed');
            return undefined;
          }),
          cdpSessionManager.sendCommand(tabId, 'Network.enable').catch(() => {
            recordPartialError('network_enable_failed');
            return undefined;
          }),
          cdpSessionManager.sendCommand(tabId, 'Log.enable').catch(() => {
            recordPartialError('log_enable_failed');
            return undefined;
          }),
          cdpSessionManager.sendCommand(tabId, 'Accessibility.enable').catch(() => {
            recordPartialError('accessibility_enable_failed');
            return undefined;
          }),
        ]);

        const [runtimeResult, frameTreeResult, accessibilityTreeResult] = await Promise.all([
          cdpSessionManager.sendCommand<RuntimeEvaluateResponse>(tabId, 'Runtime.evaluate', {
            expression: PAGE_STATE_PROBE,
            returnByValue: true,
            silent: true,
          }),
          cdpSessionManager
            .sendCommand<CDPFrameTreeResponse>(tabId, 'Page.getFrameTree')
            .catch(() => {
              recordPartialError('frame_tree_unavailable');
              return undefined;
            }),
          cdpSessionManager
            .sendCommand(tabId, 'Accessibility.getFullAXTree', {
              depth: 6,
              fetchRelatives: false,
            })
            .catch(() => {
              recordPartialError('accessibility_tree_unavailable');
              return undefined;
            }),
        ]);

        await new Promise((resolve) => setTimeout(resolve, CDP_PAGE_SENSING_EVENT_WINDOW_MS));

        const networkResources = normalizeNetworkResources(asRecord(runtimeResult.result?.value));
        const pageState = asRecord(runtimeResult.result?.value);
        const navigation = parseNavigationTiming(pageState?.navigation);
        const readiness = normalizeReadiness(pageState?.readyState);
        const consoleSummaryBounded = applyZeroIfNegative(consoleSummary);
        const networkActivityResolved = {
          requestStartedCount: networkActivity.requestStartedCount,
          inFlightCount: inFlightRequests.size,
          failedRequestCount: networkActivity.failedRequestCount,
        };
        const route = parseRouteSummary(pageState?.route);
        const stabilityHint = inferStabilityHint({
          readiness,
          topFrameNavigatedAfterReady,
          networkActivity: networkActivityResolved,
          currentUrl: asString(pageState?.url),
          route,
          navigatedFrameUrl,
        });
        const accessibilityFromAx = await enrichAccessibilityTreeLocators(
          tabId,
          summarizeAccessibilityTree(accessibilityTreeResult),
          partialErrors,
        );
        const visibleDomControlCandidates = parseVisibleDomControlCandidates(
          pageState?.visibleFormControls,
        );
        const accessibility = mergeVisibleDomControlCandidates(
          accessibilityFromAx,
          visibleDomControlCandidates,
        );
        const domControlScan = parseDomControlScan(
          pageState?.domControlScan,
          visibleDomControlCandidates.length,
        );

        return {
          tabId,
          capturedAt,
          source: 'cdp',
          available: true,
          readiness,
          likelyLoading: isLikelyLoading(readiness, navigation, stabilityHint),
          stabilityHint,
          url: sanitizeUrlSummary(pageState?.url),
          title: truncateText(pageState?.title),
          route,
          visibilityState: truncateText(pageState?.visibilityState),
          focused: typeof pageState?.focused === 'boolean' ? pageState.focused : undefined,
          activeElement: parseActiveElement(pageState?.activeElement),
          frameCount: countFrames(frameTreeResult?.frameTree),
          topFrameUrl: sanitizeUrlSummary(frameTreeResult?.frameTree?.frame?.url),
          navigation,
          networkResources: networkResources ?? undefined,
          networkActivity: networkActivityResolved,
          console: consoleSummaryBounded,
          ...(domControlScan ? { domControlScan } : {}),
          accessibility: accessibility ?? undefined,
          ...(partialErrors.length > 0 ? { partialErrors } : {}),
        };
      } finally {
        cdpSessionManager.removeEventListener(eventListener);
      }
    });
  } catch (error) {
    return {
      tabId,
      capturedAt,
      source: 'cdp',
      available: false,
      readiness: 'unknown',
      likelyLoading: false,
      stabilityHint: 'stable',
      error: sanitizeError(error),
    };
  }
}

function normalizeReadiness(value: unknown): CDPPageReadiness {
  if (value === 'loading' || value === 'interactive' || value === 'complete') {
    return value;
  }
  return 'unknown';
}

function isLikelyLoading(
  readiness: CDPPageReadiness,
  navigation: CDPNavigationTimingSummary | undefined,
  stabilityHint: CDPPageStabilityHint,
): boolean {
  if (readiness === 'loading') return true;
  if (stabilityHint === 'loading' || stabilityHint === 'spa_navigating') return true;
  if (readiness !== 'interactive') return false;
  return navigation?.loadEventMs === null || navigation?.loadEventMs === undefined;
}

function inferStabilityHint(input: {
  readiness: CDPPageReadiness;
  topFrameNavigatedAfterReady: boolean;
  networkActivity: CDPNetworkEventSummary;
  currentUrl?: string;
  route?: CDPRouteSummary;
  navigatedFrameUrl?: string;
}): CDPPageStabilityHint {
  if (input.readiness === 'loading') return 'loading';
  const afterInitialReady = input.readiness === 'interactive' || input.readiness === 'complete';
  if (!afterInitialReady) return 'stable';

  const normalizedCurrentUrl = normalizeUrlIgnoringHash(input.currentUrl);
  const normalizedNavigatedUrl = normalizeUrlIgnoringHash(input.navigatedFrameUrl);
  const urlChangedAfterReady = Boolean(
    normalizedCurrentUrl &&
    normalizedNavigatedUrl &&
    normalizedCurrentUrl !== normalizedNavigatedUrl,
  );
  const frameNavigationSuggestsSpa = input.topFrameNavigatedAfterReady
    ? normalizedNavigatedUrl
      ? !normalizedCurrentUrl || normalizedCurrentUrl !== normalizedNavigatedUrl
      : true
    : false;
  if (frameNavigationSuggestsSpa || urlChangedAfterReady) {
    return 'spa_navigating';
  }

  const networkBurstDetected =
    input.networkActivity.requestStartedCount >= SPA_NETWORK_BURST_REQUEST_THRESHOLD ||
    input.networkActivity.inFlightCount >= SPA_NETWORK_BURST_INFLIGHT_THRESHOLD;
  if (networkBurstDetected && input.route) {
    return 'spa_navigating';
  }

  return 'stable';
}

function parseActiveElement(value: unknown): CDPActiveElementSummary | undefined {
  const activeElement = asRecord(value);
  if (!activeElement) return undefined;

  const tagName = truncateText(activeElement.tagName);
  if (!tagName) return undefined;

  return {
    tagName,
    type: truncateText(activeElement.type),
    role: truncateText(activeElement.role),
    idPresent: activeElement.idPresent === true,
    namePresent: activeElement.namePresent === true,
  };
}

function parseNavigationTiming(value: unknown): CDPNavigationTimingSummary | undefined {
  const navigation = asRecord(value);
  if (!navigation) return undefined;

  return {
    type: truncateText(navigation.type),
    responseEndMs: normalizeTiming(navigation.responseEndMs),
    domContentLoadedMs: normalizeTiming(navigation.domContentLoadedMs),
    loadEventMs: normalizeTiming(navigation.loadEventMs),
  };
}

function parseRouteSummary(value: unknown): CDPRouteSummary | undefined {
  const route = asRecord(value);
  const rawUrl = asString(route?.url);
  const url = sanitizeUrlSummary(rawUrl);
  if (!url || !rawUrl) return undefined;
  const fingerprint = buildRouteFingerprint(rawUrl);

  return {
    href: url.href,
    pathname: url.pathname,
    hasQuery: url.hasQuery,
    hasHash: url.hasHash,
    ...(fingerprint ? { fingerprint } : {}),
    historyLength:
      typeof route?.historyLength === 'number' && Number.isFinite(route.historyLength)
        ? Math.max(0, Math.trunc(route.historyLength))
        : null,
  };
}

function buildRouteFingerprint(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    const routeMaterial = `${url.origin}${url.pathname}?${url.searchParams.toString()}#${url.hash.replace(/^#/, '')}`;
    return `route_${hashString32(routeMaterial)}`;
  } catch {
    return undefined;
  }
}

function hashString32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

interface RawAXNode {
  nodeId?: unknown;
  backendDOMNodeId?: unknown;
  role?: unknown;
  name?: unknown;
  properties?: unknown;
  actions?: unknown;
}

interface RankedAccessibilityObjectCandidate {
  candidate: CDPAccessibilityObjectCandidate;
  index: number;
  score: number;
}

function summarizeAccessibilityTree(treeResult: unknown): CDPAccessibilitySummary | undefined {
  const result = asRecord(treeResult);
  if (!result) return undefined;
  const rawNodes = (result as { nodes?: unknown[] }).nodes;
  if (!Array.isArray(rawNodes) || rawNodes.length === 0) {
    return {
      totalNodes: 0,
      actionableNodeCount: 0,
      actionableRoleTop: [],
      actionableSampleLabels: [],
      stateSignals: { checkedCount: 0, selectedCount: 0, expandedCount: 0, disabledCount: 0 },
      locatorCoverage: {
        locatorCandidateCount: 0,
        axNodeIdCount: 0,
        backendDOMNodeIdCount: 0,
        locatorCoverageRate: 0,
      },
      objectCandidates: [],
    };
  }

  const roleCounts = new Map<string, number>();
  const sampleLabels = new Set<string>();
  const objectCandidateSet = new Set<string>();
  const objectCandidatePool: RankedAccessibilityObjectCandidate[] = [];
  const stateSignals: CDPAccessibilityStateSignals = {
    checkedCount: 0,
    selectedCount: 0,
    expandedCount: 0,
    disabledCount: 0,
  };
  let actionableNodeCount = 0;
  let locatorCandidateCount = 0;
  let axNodeIdCount = 0;
  let backendDOMNodeIdCount = 0;

  for (const rawNode of rawNodes) {
    const node = asRecord(rawNode);
    if (!node) continue;
    const typedNode = node as RawAXNode;
    const actionable = isAccessibilityNodeActionable(typedNode);
    const role = inferAccessibilityRole(typedNode);
    const label = inferAccessibilityLabel(typedNode);
    if (actionable) {
      actionableNodeCount += 1;
      const normalizedRole = role || 'unknown';
      roleCounts.set(normalizedRole, (roleCounts.get(normalizedRole) ?? 0) + 1);
      if (label && sampleLabels.size < MAX_ACCESSIBILITY_SAMPLE_LABELS * 4) {
        sampleLabels.add(label);
      }

      const state = inferAccessibilityNodeState(typedNode);
      const actionTypes = inferAccessibilityActions(typedNode);
      const locator = parseAccessibilityObjectLocator(typedNode);
      if (locator) {
        locatorCandidateCount += 1;
        if (locator.axNodeId) axNodeIdCount += 1;
        if (typeof locator.backendDOMNodeId === 'number') backendDOMNodeIdCount += 1;
      }
      const candidateKey =
        typeof locator?.backendDOMNodeId === 'number'
          ? `backendDOMNodeId:${locator.backendDOMNodeId}`
          : locator?.axNodeId
            ? `axNodeId:${locator.axNodeId}`
            : `${normalizedRole}||${label || ''}`;
      if (
        objectCandidatePool.length < ACCESSIBILITY_OBJECT_CANDIDATE_POOL_LIMIT &&
        !objectCandidateSet.has(candidateKey)
      ) {
        objectCandidateSet.add(candidateKey);
        const candidate: CDPAccessibilityObjectCandidate = {
          role: normalizedRole,
          ...(label ? { label } : {}),
          ...(locator ? { locator } : {}),
          actionTypes,
          state,
        };
        objectCandidatePool.push({
          candidate,
          index: objectCandidatePool.length,
          score: scoreAccessibilityObjectCandidate(candidate),
        });
      }
    }
    updateAccessibilityStateSignals(typedNode, stateSignals);
  }

  const actionableRoleTop = Array.from(roleCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_ACCESSIBILITY_ACTIONABLE_ROLE_KEYS)
    .map(([role, count]) => ({ role, count }));

  return {
    totalNodes: rawNodes.length,
    actionableNodeCount,
    actionableRoleTop,
    actionableSampleLabels: Array.from(sampleLabels).slice(0, MAX_ACCESSIBILITY_SAMPLE_LABELS),
    stateSignals,
    locatorCoverage: {
      locatorCandidateCount,
      axNodeIdCount,
      backendDOMNodeIdCount,
      locatorCoverageRate:
        actionableNodeCount > 0
          ? Number((locatorCandidateCount / actionableNodeCount).toFixed(4))
          : 0,
    },
    objectCandidates: selectAccessibilityObjectCandidates(objectCandidatePool),
  };
}

function parseVisibleDomControlCandidates(value: unknown): CDPAccessibilityObjectCandidate[] {
  if (!Array.isArray(value)) return [];
  const candidates: CDPAccessibilityObjectCandidate[] = [];
  const seenSelectors = new Set<string>();
  for (const rawCandidate of value.slice(0, 24)) {
    const record = asRecord(rawCandidate);
    if (!record) continue;
    const role = asString(record.role)?.trim().toLowerCase();
    const cssSelector = asString(record.cssSelector)?.trim();
    const nodeName = safeCssIdentifier(asString(record.nodeName) || '');
    if (
      !role ||
      !['searchbox', 'textbox', 'combobox', 'spinbutton', 'button'].includes(role) ||
      !cssSelector ||
      cssSelector.length > 240 ||
      !selectorLooksStableForDomControl(cssSelector) ||
      seenSelectors.has(cssSelector)
    ) {
      continue;
    }
    const visualBounds = parseElementRect(record.visualBounds);
    const visibilityProbe = parseNodeVisibilityProbe(record.visibilityProbe);
    if (
      !visualBounds ||
      !visibilityProbe ||
      !visibilityProbe.domVisible ||
      !visibilityProbe.inViewport
    ) {
      continue;
    }
    const rawLabel = truncateText(record.label);
    const label = safeAttributeValue(rawLabel) || role;
    const actionTypes = Array.isArray(record.actionTypes)
      ? Array.from(
          new Set(
            record.actionTypes
              .map((action) => asString(action)?.trim().toLowerCase())
              .filter(
                (action): action is string =>
                  action === 'focus' ||
                  action === 'setvalue' ||
                  action === 'open' ||
                  action === 'click',
              ),
          ),
        ).slice(0, 4)
      : ['focus', 'setvalue'];
    const disabled = typeof record.disabled === 'boolean' ? record.disabled : undefined;
    candidates.push({
      role,
      label,
      locator: {
        source: 'cdp_dom',
        cssSelector,
        ...(nodeName ? { nodeName } : {}),
        visualBounds,
      },
      actionTypes,
      state: typeof disabled === 'boolean' ? { disabled } : {},
      visibilityProbe,
    });
    seenSelectors.add(cssSelector);
  }
  return candidates;
}

function parseDomControlScan(
  value: unknown,
  parsedCandidateCount: number,
): CDPDomControlScanSummary | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const queriedCount = asNonNegativeInteger(record.queriedCount);
  const uniqueSelectorCount = asNonNegativeInteger(record.uniqueSelectorCount);
  const visibleInViewportCount = asNonNegativeInteger(record.visibleInViewportCount);
  const candidateCount = asNonNegativeInteger(record.candidateCount);
  if (
    queriedCount === undefined ||
    uniqueSelectorCount === undefined ||
    visibleInViewportCount === undefined ||
    candidateCount === undefined
  ) {
    return undefined;
  }
  return {
    queriedCount,
    uniqueSelectorCount,
    visibleInViewportCount,
    candidateCount,
    parsedCandidateCount,
  };
}

function mergeVisibleDomControlCandidates(
  summary: CDPAccessibilitySummary | undefined,
  domCandidates: CDPAccessibilityObjectCandidate[],
): CDPAccessibilitySummary | undefined {
  if (domCandidates.length === 0) return summary;
  const base: CDPAccessibilitySummary = summary ?? {
    totalNodes: 0,
    actionableNodeCount: 0,
    actionableRoleTop: [],
    actionableSampleLabels: [],
    stateSignals: { checkedCount: 0, selectedCount: 0, expandedCount: 0, disabledCount: 0 },
    locatorCoverage: {
      locatorCandidateCount: 0,
      axNodeIdCount: 0,
      backendDOMNodeIdCount: 0,
      locatorCoverageRate: 0,
    },
    objectCandidates: [],
  };
  const combined = [...base.objectCandidates];
  for (const domCandidate of domCandidates) {
    const selector = domCandidate.locator?.cssSelector;
    const matchingIndex = selector
      ? combined.findIndex((candidate) => candidate.locator?.cssSelector === selector)
      : -1;
    if (matchingIndex >= 0) {
      const existing = combined[matchingIndex];
      const disabled = existing.state.disabled === true || domCandidate.state.disabled === true;
      combined[matchingIndex] = {
        ...existing,
        actionTypes: disabled ? [] : existing.actionTypes,
        state: {
          ...existing.state,
          ...domCandidate.state,
          ...(disabled ? { disabled: true } : {}),
        },
        visibilityProbe: domCandidate.visibilityProbe ?? existing.visibilityProbe,
      };
      continue;
    }
    combined.push(domCandidate);
  }
  const ranked = combined.map((candidate, index) => ({
    candidate,
    index,
    score: scoreAccessibilityObjectCandidate(candidate),
  }));
  const objectCandidates = selectAccessibilityObjectCandidates(ranked);
  const disabledObjectCandidateCount = objectCandidates.filter(
    (candidate) => candidate.state.disabled === true,
  ).length;
  return {
    ...base,
    stateSignals: {
      ...base.stateSignals,
      disabledCount: Math.max(base.stateSignals.disabledCount, disabledObjectCandidateCount),
    },
    objectCandidates,
  };
}

function selectorLooksStableForDomControl(selector: string): boolean {
  const simpleSelectorLooksStable = (value: string): boolean =>
    /^#[A-Za-z0-9_-]+$/.test(value) ||
    /^(input|textarea|select|button|div|span|a|svg|\*)\[(data-testid|data-test|data-cy|aria-label|name)=/i.test(
      value,
    ) ||
    /^(input|textarea|select|button|div|span|a|svg)\.[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)?$/i.test(
      value,
    );
  if (simpleSelectorLooksStable(selector)) return true;
  const relational = selector.match(/^([^()\s]+):has\(([^()\s]+)\) ([^()\s]+)$/);
  return Boolean(
    relational &&
    simpleSelectorLooksStable(relational[1] || '') &&
    simpleSelectorLooksStable(relational[2] || '') &&
    simpleSelectorLooksStable(relational[3] || ''),
  );
}

function parseElementRect(value: unknown): CDPElementRect | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const x = Number(record.x);
  const y = Number(record.y);
  const width = Number(record.width);
  const height = Number(record.height);
  if (![x, y, width, height].every((item) => Number.isFinite(item))) return undefined;
  if (width <= 0 || height <= 0) return undefined;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function selectAccessibilityObjectCandidates(
  pool: RankedAccessibilityObjectCandidate[],
): CDPAccessibilityObjectCandidate[] {
  if (pool.length <= MAX_ACCESSIBILITY_OBJECT_CANDIDATES) {
    return pool.map((item) => item.candidate);
  }

  const ranked = [...pool].sort(
    (left, right) => right.score - left.score || left.index - right.index,
  );
  const reservedInputControls = ranked
    .filter((item) =>
      ['searchbox', 'textbox', 'combobox', 'spinbutton'].includes(
        item.candidate.role.toLowerCase(),
      ),
    )
    .slice(0, 4);
  const reservedDomControls = ranked
    .filter(
      (item) =>
        item.candidate.locator?.source === 'cdp_dom' &&
        item.candidate.actionTypes.some((action) =>
          ['click', 'focus', 'setvalue', 'open'].includes(action),
        ),
    )
    .slice(0, 4);
  const reserved = new Set([...reservedInputControls, ...reservedDomControls]);
  return [
    ...reservedInputControls,
    ...reservedDomControls.filter((item) => !reservedInputControls.includes(item)),
    ...ranked.filter((item) => !reserved.has(item)),
  ]
    .slice(0, MAX_ACCESSIBILITY_OBJECT_CANDIDATES)
    .map((item) => item.candidate);
}

function scoreAccessibilityObjectCandidate(candidate: CDPAccessibilityObjectCandidate): number {
  let score = 0;
  const role = candidate.role.toLowerCase();
  const label = candidate.label ?? '';

  if (candidate.locator?.backendDOMNodeId !== undefined) score += 24;
  if (candidate.locator?.axNodeId) score += 8;
  if (candidate.actionTypes.includes('click')) score += 16;
  if (candidate.actionTypes.includes('focus')) score += 12;
  if (candidate.actionTypes.includes('setvalue')) score += 18;

  if (role === 'searchbox' || role === 'textbox') score += 64;
  else if (role === 'link') score += 44;
  else if (role === 'button') score += 36;
  else if (role === 'checkbox' || role === 'radio' || role === 'switch') score += 34;
  else if (role === 'combobox' || role === 'listbox' || role === 'option') score += 30;
  else if (role === 'tab' || role === 'menuitem' || role === 'menuitemcheckbox') score += 22;

  if (looksLikeStableObjectLabel(label)) score += 56;
  if (looksLikeMeaningfulContentLabel(label)) score += 24;
  if (looksLikeUtilityAccessibilityLabel(label)) score -= 72;
  if (label.length <= 2 && !/[\p{Script=Han}]/u.test(label)) score -= 24;
  if (candidate.state.disabled === true) score -= 48;
  if (candidate.state.selected === true || candidate.state.checked === true) score += 6;

  return score;
}

function looksLikeStableObjectLabel(label: string): boolean {
  const normalized = label.trim();
  if (!normalized) return false;
  if (/^[\w.-]+\/[\w.-]+$/.test(normalized)) return true;
  if (/^[\w.-]+\.[a-z]{2,}(?:\/\S*)?$/i.test(normalized)) return true;
  if (/^https?:\/\//i.test(normalized)) return true;
  if (/#[0-9]{1,8}\b/.test(normalized)) return true;
  return false;
}

function looksLikeMeaningfulContentLabel(label: string): boolean {
  const normalized = label.trim();
  if (normalized.length < 6) return false;
  if (/[\p{Script=Han}]/u.test(normalized)) return normalized.length >= 6;
  return normalized.split(/\s+/).filter(Boolean).length >= 3;
}

function looksLikeUtilityAccessibilityLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase();
  if (!normalized) return true;
  if (
    /^(menu|more|close|cancel|back|next|previous|share|copy|refresh|reload|settings|help|search|sign in|sign up|login|logout|skip|open|collapse|expand)$/i.test(
      normalized,
    )
  ) {
    return true;
  }
  if (/^(star|fork|watch|notifications?|profile|avatar|theme|language|filter)$/i.test(normalized)) {
    return true;
  }
  return false;
}

export async function probeNodeVisibility(
  tabId: number,
  backendNodeIds: readonly number[],
): Promise<Map<number, NodeVisibilityProbe>> {
  const normalizedBackendNodeIds = [
    ...new Set(backendNodeIds.filter((id) => Number.isInteger(id) && id >= 0)),
  ];
  if (normalizedBackendNodeIds.length === 0) return new Map();

  try {
    await Promise.all([
      cdpSessionManager.sendCommand(tabId, 'DOM.enable').catch(() => undefined),
      cdpSessionManager.sendCommand(tabId, 'Runtime.enable').catch(() => undefined),
    ]);

    const output = new Map<number, NodeVisibilityProbe>();
    for (const backendNodeId of normalizedBackendNodeIds) {
      const resolvedNode = await cdpSessionManager
        .sendCommand<RuntimeEvaluateResponse>(tabId, 'DOM.resolveNode', { backendNodeId })
        .catch(() => undefined);
      const objectId = asString(resolvedNode?.result?.objectId);
      if (!objectId) continue;
      const probeResult = await cdpSessionManager
        .sendCommand<RuntimeEvaluateResponse>(tabId, 'Runtime.callFunctionOn', {
          objectId,
          functionDeclaration: NODE_VISIBILITY_PROBE,
          returnByValue: true,
          silent: true,
        })
        .catch(() => undefined);
      const parsed = parseNodeVisibilityProbe(probeResult?.result?.value);
      if (parsed) output.set(backendNodeId, parsed);
    }
    return output;
  } catch {
    return new Map();
  }
}

async function enrichAccessibilityTreeLocators(
  tabId: number,
  summary: CDPAccessibilitySummary | undefined,
  partialErrors?: string[],
): Promise<CDPAccessibilitySummary | undefined> {
  if (!summary?.objectCandidates?.length) return summary;
  const candidatesWithBackendNode = summary.objectCandidates.filter(
    (candidate) => typeof candidate.locator?.backendDOMNodeId === 'number',
  );
  if (candidatesWithBackendNode.length === 0) return summary;

  try {
    await cdpSessionManager.sendCommand(tabId, 'DOM.enable').catch(() => undefined);
    const visibilityByBackendNodeId = await probeNodeVisibility(
      tabId,
      candidatesWithBackendNode
        .map((candidate) => candidate.locator?.backendDOMNodeId)
        .filter((value): value is number => typeof value === 'number'),
    );
    const enrichedCandidates: CDPAccessibilityObjectCandidate[] = [];
    for (const candidate of summary.objectCandidates) {
      const locator = candidate.locator;
      if (!locator || typeof locator.backendDOMNodeId !== 'number') {
        enrichedCandidates.push(candidate);
        continue;
      }
      const backendNodeId = locator.backendDOMNodeId;
      const nodeDescription = await cdpSessionManager
        .sendCommand(tabId, 'DOM.describeNode', { backendNodeId })
        .catch(() => undefined);
      const boxModel = await cdpSessionManager
        .sendCommand(tabId, 'DOM.getBoxModel', { backendNodeId })
        .catch(() => undefined);
      const locatorExtension = {
        ...buildLocatorExtensionFromDomNode(nodeDescription),
        ...buildLocatorExtensionFromBoxModel(boxModel),
      };
      const visibilityProbe = visibilityByBackendNodeId.get(backendNodeId);
      const enrichedCandidate =
        Object.keys(locatorExtension).length > 0
          ? { ...candidate, locator: { ...locator, ...locatorExtension } }
          : candidate;
      enrichedCandidates.push(
        visibilityProbe ? { ...enrichedCandidate, visibilityProbe } : enrichedCandidate,
      );
    }
    return { ...summary, objectCandidates: enrichedCandidates };
  } catch {
    if (partialErrors && !partialErrors.includes('accessibility_locator_enrichment_failed')) {
      partialErrors.push('accessibility_locator_enrichment_failed');
    }
    return summary;
  }
}

function parseNodeVisibilityProbe(value: unknown): NodeVisibilityProbe | undefined {
  const record = asRecord(value);
  if (!record || typeof record.domVisible !== 'boolean' || typeof record.inViewport !== 'boolean') {
    return undefined;
  }
  return {
    domVisible: record.domVisible,
    inViewport: record.inViewport,
    centerHitTarget: typeof record.centerHitTarget === 'boolean' ? record.centerHitTarget : null,
    occluded: record.occluded === true,
    ...(record.valueState === 'empty' ||
    record.valueState === 'non_empty' ||
    record.valueState === 'unknown'
      ? { valueState: record.valueState }
      : {}),
    ...(typeof record.occludedBy === 'string' && record.occludedBy.trim()
      ? { occludedBy: record.occludedBy.trim().toLowerCase() }
      : {}),
    reason: asString(record.reason) ?? 'visibility_probe_unknown',
  };
}

function buildLocatorExtensionFromDomNode(
  value: unknown,
): Pick<CDPAccessibilityObjectLocator, 'cssSelector' | 'nodeName'> {
  const node = asRecord(asRecord(value)?.node);
  if (!node) return {};
  const rawNodeName = asString(node.localName) || asString(node.nodeName);
  const nodeName = rawNodeName?.toLowerCase();
  const attributes = readDomNodeAttributes(node.attributes);
  const cssSelector = buildSafeCssSelector(nodeName, attributes);
  return {
    ...(nodeName ? { nodeName } : {}),
    ...(cssSelector ? { cssSelector } : {}),
  };
}

function buildLocatorExtensionFromBoxModel(
  value: unknown,
): Pick<CDPAccessibilityObjectLocator, 'visualBounds'> {
  const model = asRecord(asRecord(value)?.model);
  const content = Array.isArray(model?.content) ? model.content : undefined;
  const visualBounds = rectFromQuad(content);
  return visualBounds ? { visualBounds } : {};
}

function rectFromQuad(value: unknown[] | undefined): CDPElementRect | undefined {
  if (!value || value.length < 8) return undefined;
  const points = value
    .slice(0, 8)
    .map((item) => (typeof item === 'number' && Number.isFinite(item) ? item : null));
  if (points.some((point) => point === null)) return undefined;
  const xs = [points[0], points[2], points[4], points[6]] as number[];
  const ys = [points[1], points[3], points[5], points[7]] as number[];
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  if (width === 0 || height === 0) return undefined;
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function readDomNodeAttributes(value: unknown): Map<string, string> {
  const output = new Map<string, string>();
  if (!Array.isArray(value)) return output;
  for (let index = 0; index < value.length - 1; index += 2) {
    const name = asString(value[index])?.toLowerCase();
    const attrValue = asString(value[index + 1]);
    if (!name || !attrValue) continue;
    output.set(name, attrValue);
  }
  return output;
}

function buildSafeCssSelector(
  nodeName: string | undefined,
  attributes: Map<string, string>,
): string | undefined {
  const tagName = safeCssIdentifier(nodeName || '') || undefined;
  const id = safeAttributeValue(attributes.get('id'));
  if (id) return `#${cssIdentifier(id)}`;

  const stableAttributeNames = [
    'data-testid',
    'data-test',
    'data-cy',
    'aria-label',
    'name',
    'type',
    'role',
  ];
  for (const attributeName of stableAttributeNames) {
    const value = safeAttributeValue(attributes.get(attributeName));
    if (!value) continue;
    return `${tagName || '*'}[${attributeName}="${cssString(value)}"]`;
  }
  return tagName;
}

function safeAttributeValue(value: string | undefined): string | undefined {
  const text = truncateText(value);
  if (!text) return undefined;
  if (/token|secret|password|passwd|authorization|bearer|cookie|session|email|phone/i.test(text)) {
    return undefined;
  }
  if (text.length > 80) return undefined;
  return text;
}

function safeCssIdentifier(value: string): string | undefined {
  const text = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]*$/.test(text)) return undefined;
  return text;
}

function cssIdentifier(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}

function cssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function parseAccessibilityObjectLocator(
  node: RawAXNode,
): CDPAccessibilityObjectLocator | undefined {
  const axNodeId = asString(node.nodeId);
  const backendDOMNodeId = asNonNegativeInteger(node.backendDOMNodeId);
  if (!axNodeId && typeof backendDOMNodeId !== 'number') return undefined;
  return {
    source: 'cdp_ax',
    ...(axNodeId ? { axNodeId } : {}),
    ...(typeof backendDOMNodeId === 'number' ? { backendDOMNodeId } : {}),
  };
}

function inferAccessibilityRole(node: RawAXNode): string | undefined {
  const role =
    asString(asRecord(node.role)?.name) ||
    asString(node.role) ||
    asString(asRecord(node.role)?.value);
  if (!role) return undefined;
  const normalized = role.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function inferAccessibilityLabel(node: RawAXNode): string | undefined {
  const namePayload = asRecord(node.name);
  const rawLabel = asString(namePayload?.value) || asString(namePayload?.name);
  if (!rawLabel) return undefined;
  return truncateText(rawLabel);
}

function isAccessibilityNodeActionable(node: RawAXNode): boolean {
  const role = inferAccessibilityRole(node);
  if (role && ACCESSIBILITY_ACTIONABLE_ROLES.has(role)) return true;
  const actions = asArray(node.actions);
  return actions.some((action) => {
    const actionRecord = asRecord(action);
    const actionName = asString(actionRecord?.name);
    return Boolean(
      actionName &&
      /^(click|focus|tap|press|expand|collapse|check|setvalue|open)$/i.test(actionName),
    );
  });
}

function parseAccessibilityStateValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  const record = asRecord(value);
  if (record?.value !== undefined) return parseAccessibilityStateValue(record.value);
  if (typeof record?.value === 'boolean') return record.value;
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return undefined;
}

function parseAccessibilityStateBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  const record = asRecord(value);
  if (record?.value !== undefined) return parseAccessibilityStateBoolean(record.value);
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return undefined;
}

function updateAccessibilityStateSignals(
  node: RawAXNode,
  stateSignals: CDPAccessibilityStateSignals,
): void {
  const properties = asArray(node.properties);
  for (const property of properties) {
    const propertyRecord = asRecord(property);
    const stateName = asString(propertyRecord?.name);
    if (!stateName) continue;
    const stateValue = parseAccessibilityStateValue(asRecord(propertyRecord)?.value);
    if (!stateValue) continue;
    const normalizedName = stateName.trim().toLowerCase();
    if (normalizedName === 'checked') stateSignals.checkedCount += 1;
    if (normalizedName === 'selected') stateSignals.selectedCount += 1;
    if (normalizedName === 'expanded') stateSignals.expandedCount += 1;
    if (normalizedName === 'disabled') stateSignals.disabledCount += 1;
  }
}

function inferAccessibilityActions(node: RawAXNode): string[] {
  const actions = asArray(node.actions);
  const collected = new Set<string>();
  for (const action of actions) {
    const name = asString(asRecord(action)?.name);
    if (!name) continue;
    const normalized = name.trim().toLowerCase();
    if (!normalized) continue;
    collected.add(normalized);
  }
  return [...collected];
}

function inferAccessibilityNodeState(node: RawAXNode): CDPAccessibilityObjectStateSignals {
  const properties = asArray(node.properties);
  const state: CDPAccessibilityObjectStateSignals = {};

  for (const property of properties) {
    const propertyRecord = asRecord(property);
    const stateName = asString(propertyRecord?.name);
    if (!stateName) continue;
    const normalizedName = stateName.trim().toLowerCase();
    const normalizedValue = parseAccessibilityStateBoolean(propertyRecord?.value);
    if (typeof normalizedValue !== 'boolean') continue;

    if (normalizedName === 'checked') state.checked = normalizedValue;
    if (normalizedName === 'selected') state.selected = normalizedValue;
    if (normalizedName === 'expanded') state.expanded = normalizedValue;
    if (normalizedName === 'disabled') state.disabled = normalizedValue;
  }

  return state;
}

function parseNetworkResourceSummary(value: unknown): CDPNetworkResourceSummary | undefined {
  const resources = asRecord(value);
  if (!resources) return undefined;

  const resourceEntryCount = asNonNegativeCount(resources.resourceEntryCount);
  if (resourceEntryCount === 0) {
    return {
      resourceEntryCount: 0,
      resourceInFlightCount: 0,
      failedResourceStatusCount: 0,
    };
  }

  return {
    resourceEntryCount,
    resourceInFlightCount: asNonNegativeCount(resources.resourceInFlightCount),
    failedResourceStatusCount: asNonNegativeCount(resources.failedResourceStatusCount),
  };
}

function normalizeNetworkResources(value: unknown): CDPNetworkResourceSummary | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const pageState = value as Record<string, unknown>;
  return parseNetworkResourceSummary(pageState.networkResources);
}

function applyZeroIfNegative(input: CDPConsoleSummary): CDPConsoleSummary {
  return {
    errorCount: Math.max(0, Math.round(input.errorCount)),
    warningCount: Math.max(0, Math.round(input.warningCount)),
  };
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNonNegativeCount(value: unknown): number {
  const normalized = typeof value === 'number' ? value : Number(value);

  return Math.max(0, Math.round(Number.isFinite(normalized) ? normalized : 0));
}

function asNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const normalized = Math.trunc(value);
  return normalized >= 0 ? normalized : undefined;
}

function normalizeUrlIgnoringHash(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return undefined;
  }
}

function sanitizeUrlSummary(value: unknown): CDPPageUrlSummary | undefined {
  const raw = typeof value === 'string' ? value : undefined;
  if (!raw) return undefined;

  try {
    const url = new URL(raw);
    const scheme = url.protocol.replace(/:$/, '');
    const pathname = url.pathname || '';
    const safePathname = sanitizeUrlPathname(url, pathname);
    const href = sanitizeUrlHref(url, scheme, safePathname);

    return {
      href,
      origin: url.origin === 'null' ? url.protocol : url.origin,
      host: url.host,
      pathname: safePathname,
      scheme,
      hasQuery: url.search.length > 0,
      hasHash: url.hash.length > 0,
    };
  } catch {
    return undefined;
  }
}

function sanitizeUrlPathname(url: URL, pathname: string): string {
  if (url.protocol === 'file:') return '';
  if (url.protocol === 'data:' || url.protocol === 'blob:') return '';
  return pathname;
}

function sanitizeUrlHref(url: URL, scheme: string, pathname: string): string {
  if (
    url.protocol === 'http:' ||
    url.protocol === 'https:' ||
    url.protocol === 'chrome:' ||
    url.protocol === 'chrome-extension:'
  ) {
    return `${url.protocol}//${url.host}${pathname}`;
  }
  if (url.protocol === 'about:') {
    return `about:${pathname}`;
  }
  if (url.protocol === 'file:') {
    return 'file://local-file';
  }
  return `${scheme}:redacted`;
}

function countFrames(frameTree: CDPFrameTree | undefined): number | undefined {
  if (!frameTree) return undefined;
  return countFrameTree(frameTree);
}

function countFrameTree(frameTree: CDPFrameTree): number {
  return 1 + (frameTree.childFrames ?? []).reduce((sum, child) => sum + countFrameTree(child), 0);
}

function normalizeTiming(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.round(value);
}

function truncateText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > MAX_TEXT_LENGTH ? `${trimmed.slice(0, MAX_TEXT_LENGTH)}...` : trimmed;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return truncateText(message) ?? 'CDP page sensing failed';
}
