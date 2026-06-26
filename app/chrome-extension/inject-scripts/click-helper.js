/* global window, document, Element, MouseEvent, PointerEvent, HTMLElement, SVGElement, HTMLInputElement, HTMLButtonElement, HTMLAnchorElement, HTMLLabelElement, HTMLTextAreaElement, HTMLSelectElement, HTMLOptionElement, MutationObserver, chrome */

// click-helper.js
// This script is injected into the page to handle click operations

const TABRIX_CLICK_HELPER_VERSION = 'click-helper-v3-delegated-action-targets';

if (
  window.__CLICK_HELPER_INITIALIZED__ &&
  window.__TABRIX_CLICK_HELPER_VERSION__ === TABRIX_CLICK_HELPER_VERSION
) {
  // Already initialized, skip
} else {
  window.__CLICK_HELPER_INITIALIZED__ = true;
  window.__TABRIX_CLICK_HELPER_VERSION__ = TABRIX_CLICK_HELPER_VERSION;

  const SCROLL_READY_MAX_MS = 150;
  const RECT_STABLE_EPSILON_PX = 1;

  function nowMs() {
    return window.performance && typeof window.performance.now === 'function'
      ? window.performance.now()
      : Date.now();
  }

  function rectToPlain(rect) {
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
    };
  }

  function rectsBasicallyEqual(left, right) {
    if (!left || !right) return false;
    return (
      Math.abs(left.left - right.left) <= RECT_STABLE_EPSILON_PX &&
      Math.abs(left.top - right.top) <= RECT_STABLE_EPSILON_PX &&
      Math.abs(left.right - right.right) <= RECT_STABLE_EPSILON_PX &&
      Math.abs(left.bottom - right.bottom) <= RECT_STABLE_EPSILON_PX &&
      Math.abs(left.width - right.width) <= RECT_STABLE_EPSILON_PX &&
      Math.abs(left.height - right.height) <= RECT_STABLE_EPSILON_PX
    );
  }

  function rectIntersectsViewport(rect) {
    return (
      rect.bottom >= 0 &&
      rect.top <= window.innerHeight &&
      rect.right >= 0 &&
      rect.left <= window.innerWidth
    );
  }

  function requestNextFrame(callback) {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(callback);
      return true;
    }
    return false;
  }

  function waitForElementReadyAfterScroll(element, { maxMs = SCROLL_READY_MAX_MS } = {}) {
    const startedAt = nowMs();
    try {
      element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
    } catch {
      return Promise.resolve({ waitedMs: 0, reason: 'scroll_failed', ready: false });
    }

    if (document.visibilityState === 'hidden') {
      const rect = element instanceof Element ? element.getBoundingClientRect() : null;
      return Promise.resolve({
        waitedMs: Math.max(0, Math.round(nowMs() - startedAt)),
        reason: 'hidden_document_fast_path',
        ready: !!rect && rect.width > 0 && rect.height > 0,
        stableFrames: 0,
      });
    }

    return new Promise((resolve) => {
      let lastRect = null;
      let stableFrames = 0;
      const deadline = startedAt + Math.max(0, maxMs);
      let done = false;
      let timeoutId = null;

      const finish = (reason, ready) => {
        if (done) return;
        done = true;
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
        resolve({
          waitedMs: Math.max(0, Math.round(nowMs() - startedAt)),
          reason,
          ready,
          stableFrames,
        });
      };

      const check = () => {
        if (done) return;
        if (!(element instanceof Element) || !element.isConnected) {
          if (nowMs() >= deadline) {
            finish('timeout_disconnected', false);
            return;
          }
          if (!requestNextFrame(check)) finish('raf_unavailable', false);
          return;
        }

        const rect = element.getBoundingClientRect();
        const usable =
          Number.isFinite(rect.width) &&
          Number.isFinite(rect.height) &&
          rect.width > 0 &&
          rect.height > 0 &&
          rectIntersectsViewport(rect);

        if (usable && rectsBasicallyEqual(rect, lastRect)) {
          stableFrames += 1;
        } else {
          stableFrames = usable ? 1 : 0;
        }
        lastRect = rectToPlain(rect);

        if (stableFrames >= 2) {
          finish('ready', true);
          return;
        }
        if (nowMs() >= deadline) {
          finish('timeout', false);
          return;
        }
        if (!requestNextFrame(check)) finish('raf_unavailable', false);
      };

      timeoutId = setTimeout(
        () => {
          finish(
            element instanceof Element && element.isConnected ? 'timeout' : 'timeout_disconnected',
            false,
          );
        },
        Math.max(0, maxMs),
      );
      check();
    });
  }

  /**
   * Click on an element matching the selector or at specific coordinates
   * @param {string} selector - CSS selector for the element to click
   * @param {boolean} waitForNavigation - Whether to wait for navigation to complete after click
   * @param {number} timeout - Timeout in milliseconds for waiting for the element or navigation
   * @param {Object} coordinates - Optional coordinates for clicking at a specific position
   * @param {number} coordinates.x - X coordinate relative to the viewport
   * @param {number} coordinates.y - Y coordinate relative to the viewport
   * @returns {Promise<Object>} - Result of the click operation
   */
  async function clickElement(
    selector,
    waitForNavigation = false,
    timeout = 5000,
    coordinates = null,
    ref = null,
    double = false,
    options = {},
  ) {
    try {
      let element = null;
      let elementInfo = null;
      let clickX, clickY;

      const isFormControl = (candidate) =>
        candidate instanceof HTMLInputElement ||
        candidate instanceof HTMLTextAreaElement ||
        candidate instanceof HTMLSelectElement;

      const compactVisibleText = (candidate) => {
        try {
          return String(candidate.innerText || candidate.textContent || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 80);
        } catch {
          return '';
        }
      };

      const GENERIC_ACTION_SELECTOR =
        'button, a[href], label, summary, option, input, textarea, select, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [onclick], [tabindex]:not([tabindex^="-"])';
      const ACTION_LIKE_CLASS_PATTERN =
        /\b(action|button|btn|click|select|selected|option|filter|sort|tab|menu|item|chip|tag|pill)\b/i;

      const isGenericActionControl = (candidate) => {
        if (!(candidate instanceof Element)) return false;
        if (!candidate.matches?.(GENERIC_ACTION_SELECTOR)) return false;
        const rect = candidate.getBoundingClientRect();
        const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
        const area = Math.max(1, rect.width * rect.height);
        if (rect.width <= 0 || rect.height <= 0) return false;
        if (area > viewportArea * 0.35) return false;
        return true;
      };

      const isDelegatedActionControl = (candidate) => {
        if (!(candidate instanceof Element)) return false;
        if (isFormControl(candidate)) return false;
        if (
          candidate instanceof HTMLLabelElement &&
          candidate.querySelector?.('input, textarea, select')
        ) {
          return false;
        }
        const rect = candidate.getBoundingClientRect();
        const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
        const area = Math.max(1, rect.width * rect.height);
        if (rect.width <= 0 || rect.height <= 0) return false;
        if (area > viewportArea * 0.18) return false;
        const text = compactVisibleText(candidate);
        if (!text || text.length > 100) return false;
        const className =
          typeof candidate.className === 'string'
            ? candidate.className
            : candidate.className?.baseVal || '';
        const stateSignal = [
          candidate.getAttribute('aria-selected'),
          candidate.getAttribute('aria-current'),
          candidate.getAttribute('aria-pressed'),
          candidate.getAttribute('data-selected'),
          candidate.getAttribute('data-active'),
          candidate.getAttribute('data-state'),
        ].some((value) => value !== null && value !== 'false');
        const classSignal = ACTION_LIKE_CLASS_PATTERN.test(className);
        let pointerSignal = false;
        try {
          pointerSignal = window.getComputedStyle(candidate).cursor === 'pointer';
        } catch {
          /* best-effort click sensing fallback */
        }
        if (!pointerSignal && !classSignal && !stateSignal) return false;
        const nestedActions = candidate.querySelectorAll?.(GENERIC_ACTION_SELECTOR).length || 0;
        return nestedActions <= 2;
      };

      const isActionControl = (candidate) =>
        isGenericActionControl(candidate) || isDelegatedActionControl(candidate);

      const isCompactLeafClickTarget = (candidate) => {
        if (!(candidate instanceof Element)) return false;
        if (isFormControl(candidate)) return false;
        if (candidate.querySelector?.(GENERIC_ACTION_SELECTOR)) return false;
        const text = compactVisibleText(candidate);
        if (!text || text.length > 40) return false;
        const rect = candidate.getBoundingClientRect();
        const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
        const area = Math.max(1, rect.width * rect.height);
        if (rect.width <= 0 || rect.height <= 0) return false;
        return area <= viewportArea * 0.1;
      };

      const resolvePreferredClickTarget = (candidate) => {
        if (!(candidate instanceof Element)) return null;
        if (isGenericActionControl(candidate)) return candidate;
        if (isCompactLeafClickTarget(candidate)) return candidate;
        const candidateRect = candidate.getBoundingClientRect();
        const candidateArea = Math.max(1, candidateRect.width * candidateRect.height);
        const candidateText = (candidate.innerText || candidate.textContent || '').trim();
        const candidateIsActionable = candidate.matches?.(GENERIC_ACTION_SELECTOR) === true;
        const comboAncestor = !candidateIsActionable
          ? candidate.closest?.(
              '[role="combobox"], .arco-cascader, .arco-select-view, .arco-picker, .arco-input-tag',
            ) || null
          : null;
        if (comboAncestor instanceof Element && comboAncestor !== candidate) {
          return comboAncestor;
        }
        const ancestors = [];
        let current = candidate;
        let depth = 0;
        while (current && current instanceof Element && depth < 8) {
          if (current.matches?.(GENERIC_ACTION_SELECTOR)) {
            ancestors.push(current);
          }
          current = current.parentElement;
          depth += 1;
        }
        const scored = ancestors
          .map((el) => {
            const rect = el.getBoundingClientRect();
            const area = Math.max(1, rect.width * rect.height);
            const text = (el.innerText || el.textContent || '').trim();
            let score = 0;

            if (text && candidateText && text === candidateText) score += 30;
            if (el.tagName === 'BUTTON' || el.tagName === 'A') score += 28;
            if (
              el.matches?.(
                '[role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"]',
              )
            ) {
              score += 24;
            }
            if (el.matches?.('[aria-haspopup], [aria-expanded], [aria-controls]')) score += 12;
            if (area <= candidateArea * 6) score += 18;
            if (area > candidateArea * 20) score -= 35;
            if (/^arco-tabs-\d+-panel-\d+$/.test(el.id || '')) score -= 80;
            if (
              el.tagName === 'DIV' &&
              area > 30000 &&
              el.querySelectorAll?.(GENERIC_ACTION_SELECTOR).length > 3
            ) {
              score -= 40;
            }

            return { el, score, area };
          })
          .sort((left, right) => {
            if (right.score !== left.score) return right.score - left.score;
            return left.area - right.area;
          });

        if (scored.length > 0 && scored[0].score > 0) {
          return scored[0].el;
        }

        return candidate;
      };

      const describeHitTarget = (candidate) => {
        if (!(candidate instanceof Element)) return null;
        const rect = candidate.getBoundingClientRect();
        return {
          tagName: candidate.tagName,
          id: candidate.id || '',
          className:
            typeof candidate.className === 'string'
              ? candidate.className
              : candidate.className?.baseVal || '',
          text: (candidate.textContent || '').trim().slice(0, 100),
          role: candidate.getAttribute('role') || '',
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
        };
      };

      const looksLikeOverlay = (candidate) => {
        if (!(candidate instanceof Element)) return false;
        const text = (candidate.textContent || '').trim();
        const signature = [
          candidate.id,
          typeof candidate.className === 'string'
            ? candidate.className
            : candidate.className?.baseVal,
          candidate.getAttribute('role'),
          candidate.getAttribute('aria-modal'),
        ]
          .filter(Boolean)
          .join(' ');
        if (/\b(mask|modal|overlay|backdrop|drawer|dialog|popup|layer)\b/i.test(signature)) {
          return true;
        }
        const rect = candidate.getBoundingClientRect();
        const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
        const area = Math.max(1, rect.width * rect.height);
        return area >= viewportArea * 0.45 && text.length < 20;
      };

      const buildActionRecovery = (verdict) => {
        if (verdict === 'blocked_by_overlay') {
          return {
            status: 'blocked',
            reason: 'blocked_by_overlay',
            requiredNextAction: 'handle_blocking_surface_then_retry',
            recommendedTool: 'chrome_read_page',
            sameTabRequired: true,
            instruction:
              'The intended click target is covered by another visible surface. Read the same tab again, identify the blocking modal/overlay/dialog, handle that surface first, then retry the original action only after the target is clear.',
            claimBoundary:
              'This proves only that the intended click point is currently blocked; it does not prove which user-facing action will close the blocking surface.',
          };
        }
        if (verdict === 'target_mismatch') {
          return {
            status: 'not_proven',
            reason: 'target_mismatch',
            requiredNextAction: 'fresh_read_page_and_select_actual_target',
            recommendedTool: 'chrome_read_page',
            sameTabRequired: true,
            instruction:
              'The intended click point resolves to a different element. Read the same tab again and choose a fresher, more specific targetRef/candidateAction instead of retrying coordinates or the same broad selector.',
            claimBoundary:
              'This proves only a target mismatch at the click point; it does not prove the page changed or that the intended business action happened.',
          };
        }
        return {
          status: 'not_proven',
          reason: String(verdict || 'verification_unavailable'),
          requiredNextAction: 'stop_or_retry_after_fresh_read',
          recommendedTool: 'chrome_read_page',
          sameTabRequired: true,
          instruction:
            'The click target could not be proven actionable. Read the same tab again before retrying or choosing another action.',
          claimBoundary:
            'This is recovery guidance for click execution only; it does not prove business success.',
        };
      };

      const inspectTargetConsistency = (expected, x, y, clickMethod) => {
        const actual = document.elementFromPoint(x, y);
        const expectedInfo = describeHitTarget(expected);
        const actualInfo = describeHitTarget(actual);
        const nearestActionAncestor = (candidate) => {
          if (!(candidate instanceof Element)) return null;
          let current = candidate;
          let depth = 0;
          while (current && current instanceof Element && depth < 8) {
            if (isActionControl(current)) return current;
            current = current.parentElement;
            depth += 1;
          }
          return null;
        };
        const linkHrefFor = (candidate) => {
          if (!(candidate instanceof Element)) return '';
          const anchor =
            candidate instanceof HTMLAnchorElement ? candidate : candidate.closest?.('a[href]');
          return anchor instanceof HTMLAnchorElement ? String(anchor.href || '') : '';
        };
        if (!(expected instanceof Element)) {
          return {
            verdict: actual ? 'coordinate_target_observed' : 'target_unknown',
            clickMethod,
            expectedTarget: expectedInfo,
            actualTarget: actualInfo,
          };
        }
        if (actual === expected) {
          return {
            verdict: 'matched',
            clickMethod,
            expectedTarget: expectedInfo,
            actualTarget: actualInfo,
          };
        }
        if (actual instanceof Element && expected.contains(actual)) {
          const actualIsNestedIndependentAction =
            actual !== expected && typeof actual.matches === 'function'
              ? actual.matches(GENERIC_ACTION_SELECTOR)
              : false;
          if (
            actualIsNestedIndependentAction ||
            (isFormControl(actual) && !isFormControl(expected))
          ) {
            return {
              verdict: 'target_mismatch',
              clickMethod,
              expectedTarget: expectedInfo,
              actualTarget: actualInfo,
            };
          }
          return {
            verdict: 'matched',
            clickMethod,
            expectedTarget: expectedInfo,
            actualTarget: actualInfo,
          };
        }
        if (actual instanceof Element && actual.contains(expected)) {
          return {
            verdict: 'matched_by_clickable_ancestor',
            clickMethod,
            expectedTarget: expectedInfo,
            actualTarget: actualInfo,
          };
        }
        if (actual instanceof Element) {
          const expectedAction = nearestActionAncestor(expected);
          const actualAction = nearestActionAncestor(actual);
          if (expectedAction && actualAction && expectedAction === actualAction) {
            return {
              verdict: 'matched_by_shared_action_ancestor',
              clickMethod,
              expectedTarget: expectedInfo,
              actualTarget: actualInfo,
            };
          }
        }
        if (actual instanceof Element) {
          const expectedHref = linkHrefFor(expected);
          const actualHref = linkHrefFor(actual);
          if (expectedHref && actualHref && expectedHref === actualHref) {
            return {
              verdict: 'matched_by_same_href_action',
              clickMethod,
              expectedTarget: expectedInfo,
              actualTarget: actualInfo,
            };
          }
        }
        return {
          verdict: looksLikeOverlay(actual) ? 'blocked_by_overlay' : 'target_mismatch',
          clickMethod,
          expectedTarget: expectedInfo,
          actualTarget: actualInfo,
        };
      };

      const findConsistentClickPoint = (expected, rect, clickMethod) => {
        if (!(expected instanceof Element) || !rect || rect.width <= 0 || rect.height <= 0) {
          return null;
        }
        const left = Math.max(0, rect.left);
        const right = Math.min(window.innerWidth, rect.right);
        const top = Math.max(0, rect.top);
        const bottom = Math.min(window.innerHeight, rect.bottom);
        const width = right - left;
        const height = bottom - top;
        if (width <= 0 || height <= 0) return null;
        const points = [
          [0.5, 0.5],
          [0.35, 0.5],
          [0.65, 0.5],
          [0.5, 0.35],
          [0.5, 0.65],
          [0.25, 0.5],
          [0.75, 0.5],
        ];
        for (const [xRatio, yRatio] of points) {
          const x = left + width * xRatio;
          const y = top + height * yRatio;
          const consistency = inspectTargetConsistency(expected, x, y, clickMethod);
          if (!['blocked_by_overlay', 'target_mismatch'].includes(consistency.verdict)) {
            return { x, y, consistency };
          }
        }
        return null;
      };

      if (ref && typeof ref === 'string') {
        // Resolve element from weak map
        let target = null;
        try {
          const map = window.__claudeElementMap;
          const weak = map && map[ref];
          target = weak && typeof weak.deref === 'function' ? weak.deref() : null;
        } catch (e) {
          // ignore
        }

        if (!target || !(target instanceof Element)) {
          return {
            error: `Element ref "${ref}" not found. Please call chrome_read_page first and ensure the ref is still valid.`,
          };
        }

        element = resolvePreferredClickTarget(target);
        const scrollWait = await waitForElementReadyAfterScroll(element);

        const rect = element.getBoundingClientRect();
        clickX = rect.left + rect.width / 2;
        clickY = rect.top + rect.height / 2;
        elementInfo = {
          tagName: element.tagName,
          id: element.id,
          className: element.className,
          text: element.textContent?.trim().substring(0, 100) || '',
          href: element.href || null,
          type: element.type || null,
          isVisible: true,
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            left: rect.left,
          },
          clickMethod: 'ref',
          ref,
          waitDiagnostics: { scroll: scrollWait },
        };
      } else if (
        coordinates &&
        typeof coordinates.x === 'number' &&
        typeof coordinates.y === 'number'
      ) {
        clickX = coordinates.x;
        clickY = coordinates.y;

        element = resolvePreferredClickTarget(document.elementFromPoint(clickX, clickY));

        if (element) {
          const rect = element.getBoundingClientRect();
          elementInfo = {
            tagName: element.tagName,
            id: element.id,
            className: element.className,
            text: element.textContent?.trim().substring(0, 100) || '',
            href: element.href || null,
            type: element.type || null,
            isVisible: true,
            rect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
              left: rect.left,
            },
            clickMethod: 'coordinates',
            clickPosition: { x: clickX, y: clickY },
          };
        } else {
          elementInfo = {
            clickMethod: 'coordinates',
            clickPosition: { x: clickX, y: clickY },
            warning: 'No element found at the specified coordinates',
          };
        }
      } else {
        element = resolvePreferredClickTarget(document.querySelector(selector));
        if (!element) {
          return {
            error: `Element with selector "${selector}" not found`,
          };
        }

        const rect = element.getBoundingClientRect();
        elementInfo = {
          tagName: element.tagName,
          id: element.id,
          className: element.className,
          text: element.textContent?.trim().substring(0, 100) || '',
          href: element.href || null,
          type: element.type || null,
          isVisible: true,
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            left: rect.left,
          },
          clickMethod: 'selector',
        };

        // First scroll so that the element is in view, then check visibility.
        const scrollWait = await waitForElementReadyAfterScroll(element);
        elementInfo.isVisible = isElementVisible(element);
        elementInfo.waitDiagnostics = { scroll: scrollWait };
        if (!elementInfo.isVisible) {
          const blockedConsistency = inspectTargetConsistency(
            element,
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
            elementInfo.clickMethod,
          );
          elementInfo.targetConsistency = blockedConsistency;
          const visibilityProvenByHit = [
            'matched',
            'matched_by_clickable_ancestor',
            'matched_by_shared_action_ancestor',
            'matched_by_same_href_action',
          ].includes(blockedConsistency.verdict);
          if (['blocked_by_overlay', 'target_mismatch'].includes(blockedConsistency.verdict)) {
            return {
              success: false,
              dispatchSucceeded: false,
              observedOutcome: 'no_observed_change',
              error: blockedConsistency.verdict,
              reason: blockedConsistency.verdict,
              message:
                blockedConsistency.verdict === 'blocked_by_overlay'
                  ? 'Click target is covered by an overlay or dialog; handle the blocking surface first.'
                  : 'Click target center resolves to a different element; refresh read_page or choose the blocking target first.',
              elementInfo,
              targetConsistency: blockedConsistency,
              actionRecovery: buildActionRecovery(blockedConsistency.verdict),
            };
          }
          if (visibilityProvenByHit) {
            elementInfo.isVisible = true;
            elementInfo.visibilityRecoveredByHitTarget = true;
          } else {
            return {
              error: `Element with selector "${selector}" is not visible`,
              elementInfo,
            };
          }
        }

        const updatedRect = element.getBoundingClientRect();
        clickX = updatedRect.left + updatedRect.width / 2;
        clickY = updatedRect.top + updatedRect.height / 2;
      }

      const targetConsistency = inspectTargetConsistency(
        element,
        clickX,
        clickY,
        elementInfo?.clickMethod || 'unknown',
      );
      let finalTargetConsistency = targetConsistency;
      if (
        element &&
        ['blocked_by_overlay', 'target_mismatch'].includes(finalTargetConsistency.verdict)
      ) {
        const fallbackPoint = findConsistentClickPoint(
          element,
          element.getBoundingClientRect(),
          elementInfo?.clickMethod || 'unknown',
        );
        if (fallbackPoint) {
          clickX = fallbackPoint.x;
          clickY = fallbackPoint.y;
          finalTargetConsistency = fallbackPoint.consistency;
          if (elementInfo) {
            elementInfo.clickPosition = { x: clickX, y: clickY };
            elementInfo.targetConsistencyFallbackUsed = true;
          }
        }
      }
      if (elementInfo) elementInfo.targetConsistency = finalTargetConsistency;
      if (
        element &&
        (elementInfo?.clickMethod === 'selector' || elementInfo?.clickMethod === 'ref') &&
        ['blocked_by_overlay', 'target_mismatch'].includes(finalTargetConsistency.verdict)
      ) {
        return {
          success: false,
          dispatchSucceeded: false,
          observedOutcome: 'no_observed_change',
          error: finalTargetConsistency.verdict,
          reason: finalTargetConsistency.verdict,
          message:
            finalTargetConsistency.verdict === 'blocked_by_overlay'
              ? 'Click target is covered by an overlay or dialog; handle the blocking surface first.'
              : 'Click target center resolves to a different element; refresh read_page or choose the blocking target first.',
          elementInfo,
          targetConsistency: finalTargetConsistency,
          actionRecovery: buildActionRecovery(finalTargetConsistency.verdict),
        };
      }

      const allowDownloadClick = options.allowDownloadClick === true;
      const resolvedAnchor =
        element && typeof element.closest === 'function' ? element.closest('a[href]') : null;
      if (resolvedAnchor && !allowDownloadClick) {
        const href = resolvedAnchor.href || '';
        const downloadAttr = resolvedAnchor.getAttribute('download');
        const anchorText = (resolvedAnchor.textContent || '').trim();
        const parsed = (() => {
          try {
            return new URL(href, window.location.href);
          } catch {
            return null;
          }
        })();
        const path = parsed?.pathname || '';
        const lowerPath = path.toLowerCase();
        const lowerHref = href.toLowerCase();
        const lowerText = anchorText.toLowerCase();
        const isHashOrJs =
          href.startsWith('#') || lowerHref.startsWith('javascript:') || lowerHref.length === 0;
        const hasFileExt =
          /\.(zip|rar|7z|pdf|csv|xlsx?|docx?|pptx?|txt|json|xml|html?|md|png|jpe?g|gif|webp|mp4|mp3|wav|apk|dmg|exe)$/i.test(
            path,
          );
        const queryLooksDownload =
          /(?:[?&](download|dl|export|attachment|response-content-disposition)=)/i.test(href);
        const hrefKeyword = /\b(download|export|attachment|file)\b/i.test(href);
        const textKeyword = /\b(download|export|下载|导出)\b/i.test(anchorText);
        const likelyApiCall = /\/api(\/|$)/i.test(lowerPath) && !hasFileExt;
        // Score-based interception: only intercept high-confidence download intent.
        // This avoids one-size-fits-all behavior for normal clicks or API-triggered actions.
        let score = 0;
        if (downloadAttr !== null) score += 3;
        if (hasFileExt) score += 2;
        if (queryLooksDownload) score += 2;
        if (hrefKeyword) score += 1;
        if (textKeyword) score += 1;
        if (likelyApiCall) score -= 2;
        if (!isHashOrJs && score >= 2) {
          return {
            success: true,
            interceptedDownload: true,
            message:
              'High-confidence download click intercepted to avoid browser Save As dialog. Use extension-side download path.',
            downloadUrl: href,
            downloadFilename: (downloadAttr || '').trim() || null,
            elementInfo,
          };
        }
      }

      // Verification window. Length depends on the caller's intent:
      //   - waitForNavigation === true  →  full `timeout` (legacy behaviour).
      //   - waitForNavigation === false →  short ~400ms window so fast-click
      //     callers still get signal without long blocking.
      // `beforeunload` short-circuits the window (we already have the verdict).
      const VERIFY_FAST_WINDOW_MS = 400;
      const intent = typeof options.intent === 'string' ? options.intent : '';
      const needsDynamicPostActionWindow =
        intent.startsWith('filter.') ||
        intent === 'search.open_filters' ||
        intent.startsWith('search.apply_filter.');
      const verifyWindowMs =
        waitForNavigation || needsDynamicPostActionWindow
          ? Math.max(0, Number(timeout) || VERIFY_FAST_WINDOW_MS)
          : VERIFY_FAST_WINDOW_MS;

      // Page-local pre-click snapshot.
      const urlBefore = String(window.location.href || '');
      const hashBefore = String(window.location.hash || '');
      const focusBefore = document.activeElement;
      const stateBefore = snapshotTargetState(element);

      // Raw signals, no verdict.
      let beforeUnloadFired = false;
      let domChanged = false;
      let domAddedDialog = false;
      let domAddedMenu = false;

      const DIALOG_SELECTOR = '[role="dialog"], [aria-modal="true"], dialog[open]';
      const MENU_SELECTOR =
        '[role="menu"]:not([aria-hidden="true"]), [role="listbox"]:not([aria-hidden="true"])';

      const beforeUnloadListener = () => {
        beforeUnloadFired = true;
      };
      window.addEventListener('beforeunload', beforeUnloadListener);

      const mutationObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'childList' || mutation.type === 'attributes') {
            domChanged = true;
          }
          if (mutation.type === 'childList') {
            for (const node of mutation.addedNodes) {
              if (!(node instanceof Element)) continue;
              if (node.matches?.(DIALOG_SELECTOR) || node.querySelector?.(DIALOG_SELECTOR)) {
                domAddedDialog = true;
              }
              if (node.matches?.(MENU_SELECTOR) || node.querySelector?.(MENU_SELECTOR)) {
                domAddedMenu = true;
              }
            }
          }
        }
      });
      try {
        mutationObserver.observe(document.body || document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: [
            'aria-expanded',
            'aria-selected',
            'aria-hidden',
            'open',
            'checked',
            'value',
            'disabled',
          ],
        });
      } catch {
        // Detached body edge case — treat the observer as absent rather than crash.
      }

      let dispatchSucceeded = false;
      try {
        if (
          element &&
          (elementInfo.clickMethod === 'selector' || elementInfo.clickMethod === 'ref')
        ) {
          if (double) {
            dispatchClickSequence(element, clickX, clickY, options, true);
          } else {
            dispatchClickSequence(element, clickX, clickY, options, false);
          }
          dispatchSucceeded = true;
        } else {
          if (double) simulateDoubleClick(clickX, clickY, options);
          else simulateClick(clickX, clickY, options);
          // coordinate-based path is best-effort; treat as dispatched iff an
          // element was resolvable at the coord.
          dispatchSucceeded = element != null;
        }
      } catch {
        dispatchSucceeded = false;
      }

      const outcomeWait = await waitForClickOutcomeWindow(
        verifyWindowMs,
        () => {
          const hrefNow = String(window.location.href || '');
          const hashNow = String(window.location.hash || '');
          if (beforeUnloadFired) return 'beforeunload';
          if (hrefNow !== urlBefore) return hashNow !== hashBefore ? 'hash_changed' : 'url_changed';
          if (hashNow !== hashBefore) return 'hash_changed';
          if (domAddedDialog) return 'dialog_opened';
          if (domAddedMenu) return 'menu_opened';
          if (diffTargetState(stateBefore, snapshotTargetState(element)) != null) {
            return 'target_state_changed';
          }
          if (!waitForNavigation && document.activeElement !== focusBefore) return 'focus_changed';
          return null;
        },
        { allowHiddenFastPath: !needsDynamicPostActionWindow },
      );

      window.removeEventListener('beforeunload', beforeUnloadListener);
      try {
        mutationObserver.disconnect();
      } catch {
        // ignore
      }

      const urlAfter = String(window.location.href || '');
      const hashAfter = String(window.location.hash || '');
      const stateAfter = snapshotTargetState(element);
      const focusChanged = document.activeElement !== focusBefore;
      const targetStateDelta = diffTargetState(stateBefore, stateAfter);

      return {
        // Compat alias for callers that only ever looked at `success`.
        // The real success verdict is computed in the background layer from
        // `signals` — see `mergeClickSignals()` in interaction.ts. A caller
        // reading `success` at this layer is getting "dispatch succeeded",
        // not "outcome verified".
        success: dispatchSucceeded,
        dispatchSucceeded,
        message: dispatchSucceeded
          ? 'Click dispatched; awaiting outcome verification in background layer'
          : 'Click dispatch failed',
        elementInfo,
        targetConsistency,
        // Compat: background layer will overwrite with verification.navigationOccurred.
        navigationOccurred: beforeUnloadFired,
        signals: {
          beforeUnloadFired,
          urlBefore,
          urlAfter,
          hashBefore,
          hashAfter,
          domChanged,
          domAddedDialog,
          domAddedMenu,
          focusChanged,
          targetStateDelta,
          waitDiagnostics: {
            verification: outcomeWait,
          },
        },
      };
    } catch (error) {
      return {
        error: `Error clicking element: ${error.message}`,
      };
    }
  }

  function snapshotTargetState(element) {
    if (!(element instanceof Element)) return null;
    const get = (name) => {
      try {
        return element.getAttribute(name);
      } catch {
        return null;
      }
    };
    return {
      className:
        typeof element.className === 'string'
          ? element.className
          : element.className && typeof element.className.baseVal === 'string'
            ? element.className.baseVal
            : null,
      ariaExpanded: get('aria-expanded'),
      ariaSelected: get('aria-selected'),
      ariaPressed: get('aria-pressed'),
      ariaChecked: get('aria-checked'),
      ariaCurrent: get('aria-current'),
      dataState: get('data-state'),
      dataSelected: get('data-selected'),
      dataActive: get('data-active'),
      open: get('open'),
      disabled: get('disabled'),
      checked: element instanceof HTMLInputElement ? String(element.checked) : get('checked'),
      selected: element instanceof HTMLOptionElement ? String(element.selected) : get('selected'),
      value:
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
          ? String(element.value ?? '')
          : null,
    };
  }

  function diffTargetState(before, after) {
    if (!before || !after) return null;
    const changed = {};
    let anyChanged = false;
    for (const key of Object.keys(before)) {
      if (before[key] !== after[key]) {
        changed[key] = { before: before[key], after: after[key] };
        anyChanged = true;
      }
    }
    return anyChanged ? changed : null;
  }

  function waitForClickOutcomeWindow(ms, earlyExitCheck, options = {}) {
    return new Promise((resolve) => {
      const startedAt = nowMs();
      if (options.allowHiddenFastPath !== false && document.visibilityState === 'hidden') {
        resolve({
          waitedMs: Math.max(0, Math.round(nowMs() - startedAt)),
          reason: 'hidden_document_fast_path',
        });
        return;
      }
      let done = false;
      let timeoutId = null;
      const finish = (reason) => {
        if (done) return;
        done = true;
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
        resolve({
          waitedMs: Math.max(0, Math.round(nowMs() - startedAt)),
          reason,
        });
      };
      const initialReason = earlyExitCheck ? earlyExitCheck() : null;
      if (initialReason) {
        finish(initialReason);
        return;
      }
      const deadline = startedAt + Math.max(0, ms);
      const scheduleNext = () => {
        if (document.visibilityState === 'hidden') {
          setTimeout(tick, 50);
          return;
        }
        if (!requestNextFrame(tick)) {
          setTimeout(tick, 50);
        }
      };
      const tick = () => {
        if (done) return;
        const reason = earlyExitCheck ? earlyExitCheck() : null;
        if (reason) {
          finish(reason);
          return;
        }
        if (nowMs() >= deadline) {
          finish('timeout');
          return;
        }
        scheduleNext();
      };
      timeoutId = setTimeout(() => finish('timeout'), Math.max(0, ms));
      tick();
    });
  }

  /**
   * Simulate a mouse click at specific coordinates
   * @param {number} x - X coordinate relative to the viewport
   * @param {number} y - Y coordinate relative to the viewport
   */
  function simulateClick(x, y, options = {}) {
    const element = document.elementFromPoint(x, y);
    if (!element) return;
    dispatchClickSequence(element, x, y, options, false);
  }

  /**
   * Simulate a double click sequence at specific coordinates
   */
  function simulateDoubleClick(x, y, options = {}) {
    const element = document.elementFromPoint(x, y);
    if (!element) return;
    dispatchClickSequence(element, x, y, options, true);
  }

  /**
   * Simulate double click using element when available
   */
  function simulateDomDoubleClick(element, x, y, options) {
    dispatchClickSequence(element, x, y, options, true);
  }

  function normalizeMouseOpts(x, y, options = {}) {
    const bubbles = options.bubbles !== false; // default true
    const cancelable = options.cancelable !== false; // default true
    const altKey = !!(options.modifiers && options.modifiers.altKey);
    const ctrlKey = !!(options.modifiers && options.modifiers.ctrlKey);
    const metaKey = !!(options.modifiers && options.modifiers.metaKey);
    const shiftKey = !!(options.modifiers && options.modifiers.shiftKey);
    const btn = String(options.button || 'left');
    const button = btn === 'right' ? 2 : btn === 'middle' ? 1 : 0;
    const buttons = btn === 'right' ? 2 : btn === 'middle' ? 4 : 1;
    return {
      bubbles,
      cancelable,
      altKey,
      ctrlKey,
      metaKey,
      shiftKey,
      button,
      buttons,
      clientX: x,
      clientY: y,
      view: window,
    };
  }

  function shouldUseNativeClick(element, button) {
    if (button !== 0 || typeof element.click !== 'function') return false;
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLButtonElement ||
      element instanceof HTMLAnchorElement ||
      element instanceof HTMLLabelElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    ) {
      return true;
    }
    const tagName = String(element.tagName || '').toUpperCase();
    return tagName === 'OPTION' || tagName === 'SUMMARY';
  }

  function dispatchClickSequence(element, x, y, options = {}, isDouble = false) {
    const base = normalizeMouseOpts(x, y, options);
    const useNativeClick = shouldUseNativeClick(element, base.button);
    const pointerBase = {
      ...base,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    };
    try {
      element.dispatchEvent(new PointerEvent('pointerdown', pointerBase));
    } catch {
      /* best-effort click sensing fallback */
    }
    const down = new MouseEvent('mousedown', base);
    const up = new MouseEvent('mouseup', base);
    const click = new MouseEvent('click', base);
    try {
      element.dispatchEvent(down);
    } catch {
      /* best-effort click sensing fallback */
    }
    try {
      element.dispatchEvent(new PointerEvent('pointerup', pointerBase));
    } catch {
      /* best-effort click sensing fallback */
    }
    try {
      element.dispatchEvent(up);
    } catch {
      /* best-effort click sensing fallback */
    }
    if (useNativeClick && typeof element.click === 'function') {
      try {
        element.click();
      } catch {
        /* best-effort click sensing fallback */
      }
    } else {
      try {
        element.dispatchEvent(click);
      } catch {
        /* best-effort click sensing fallback */
      }
    }
    if (base.button === 2) {
      // right button contextmenu
      const ctx = new MouseEvent('contextmenu', base);
      try {
        element.dispatchEvent(ctx);
      } catch {
        /* best-effort click sensing fallback */
      }
    }
    if (isDouble) {
      // second sequence + dblclick
      setTimeout(() => {
        try {
          element.dispatchEvent(new MouseEvent('mousedown', base));
        } catch {
          /* best-effort click sensing fallback */
        }
        try {
          element.dispatchEvent(new MouseEvent('mouseup', base));
        } catch {
          /* best-effort click sensing fallback */
        }
        if (useNativeClick && typeof element.click === 'function') {
          try {
            element.click();
          } catch {
            /* best-effort click sensing fallback */
          }
        } else {
          try {
            element.dispatchEvent(new MouseEvent('click', base));
          } catch {
            /* best-effort click sensing fallback */
          }
        }
        try {
          element.dispatchEvent(new MouseEvent('dblclick', base));
        } catch {
          /* best-effort click sensing fallback */
        }
      }, 30);
    }
  }

  /**
   * Check if an element is visible
   * @param {Element} element - The element to check
   * @returns {boolean} - Whether the element is visible
   */
  function isElementVisible(element) {
    if (!element) return false;

    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }

    if (
      rect.bottom < 0 ||
      rect.top > window.innerHeight ||
      rect.right < 0 ||
      rect.left > window.innerWidth
    ) {
      return false;
    }

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const elementAtPoint = document.elementFromPoint(centerX, centerY);
    if (!elementAtPoint) return false;

    return element === elementAtPoint || element.contains(elementAtPoint);
  }

  try {
    if (
      window.__TABRIX_CLICK_HELPER_MESSAGE_HANDLER__ &&
      typeof chrome?.runtime?.onMessage?.removeListener === 'function'
    ) {
      chrome.runtime.onMessage.removeListener(window.__TABRIX_CLICK_HELPER_MESSAGE_HANDLER__);
    }
  } catch {
    /* best-effort click sensing fallback */
  }

  // Listen for messages from the extension
  const tabrixClickHelperMessageHandler = (request, _sender, sendResponse) => {
    if (request.action === 'clickElement') {
      clickElement(
        request.selector,
        request.waitForNavigation,
        request.timeout,
        request.coordinates,
        request.ref,
        !!request.double,
        {
          button: request.button,
          bubbles: request.bubbles,
          cancelable: request.cancelable,
          modifiers: request.modifiers,
          allowDownloadClick: request.allowDownloadClick === true,
          intent: request.intent,
        },
      )
        .then(sendResponse)
        .catch((error) => {
          sendResponse({
            error: `Unexpected error: ${error.message}`,
          });
        });
      return true; // Indicates async response
    } else if (request.action === 'chrome_click_element_ping') {
      sendResponse({ status: 'pong' });
      return false;
    }
  };

  window.__TABRIX_CLICK_HELPER_MESSAGE_HANDLER__ = tabrixClickHelperMessageHandler;
  chrome.runtime.onMessage.addListener(tabrixClickHelperMessageHandler);
}
