/* eslint-disable */
// wait-helper.js
// Listen for text appearance/disappearance in the current document using MutationObserver.
// Returns a stable ref (compatible with accessibility-tree-helper) for the first matching element.

(function () {
  if (window.__WAIT_HELPER_INITIALIZED__) return;
  window.__WAIT_HELPER_INITIALIZED__ = true;

  // Ensure ref mapping infra exists (compatible with accessibility-tree-helper.js)
  if (!window.__claudeElementMap) window.__claudeElementMap = {};
  if (!window.__claudeRefCounter) window.__claudeRefCounter = 0;

  function describeError(error) {
    return String(error && error.message ? error.message : error);
  }

  function recordDiagnostic(diagnostics, source, error) {
    if (!Array.isArray(diagnostics) || diagnostics.length >= 5) return;
    diagnostics.push({ source, message: describeError(error) });
  }

  function isVisible(el, diagnostics) {
    try {
      if (!(el instanceof Element)) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
        return false;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      return true;
    } catch (error) {
      recordDiagnostic(diagnostics, 'visibility_check_failed', error);
      return false;
    }
  }

  function normalize(str) {
    return String(str || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function candidateHasText(el, needle) {
    const t = normalize(needle);
    if (!t) return false;
    const aria = el.getAttribute('aria-label');
    if (aria && normalize(aria).includes(t)) return true;
    const title = el.getAttribute('title');
    if (title && normalize(title).includes(t)) return true;
    const alt = el.getAttribute('alt');
    if (alt && normalize(alt).includes(t)) return true;
    const placeholder = el.getAttribute('placeholder');
    if (placeholder && normalize(placeholder).includes(t)) return true;
    // input/textarea value
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const value = el.value || el.getAttribute('value');
      if (value && normalize(value).includes(t)) return true;
    }
    const text = el.innerText || el.textContent || '';
    return normalize(text).includes(t);
  }

  function matchesText(el, needle, diagnostics) {
    try {
      if (!candidateHasText(el, needle)) return false;
      return isVisible(el, diagnostics);
    } catch (error) {
      recordDiagnostic(diagnostics, 'matches_text_failed', error);
    }
    return false;
  }

  function findElementByText(text, diagnostics) {
    // Fast path: query common interactive elements first
    const prioritized = Array.from(
      document.querySelectorAll('a,button,input,textarea,select,label,summary,[role]'),
    );
    for (const el of prioritized) if (matchesText(el, text, diagnostics)) return el;

    // Fallback: broader scan with cap to avoid blocking on huge pages
    const walker = document.createTreeWalker(
      document.body || document.documentElement,
      NodeFilter.SHOW_ELEMENT,
    );
    let count = 0;
    while (walker.nextNode()) {
      const el = /** @type {Element} */ (walker.currentNode);
      if (matchesText(el, text, diagnostics)) return el;
      if (++count > 5000) break; // Hard cap to avoid long scans
    }
    return null;
  }

  function ensureRefForElement(el) {
    // Try to reuse an existing ref
    for (const k in window.__claudeElementMap) {
      const weak = window.__claudeElementMap[k];
      if (weak && typeof weak.deref === 'function' && weak.deref() === el) return k;
    }
    const refId = `ref_${++window.__claudeRefCounter}`;
    window.__claudeElementMap[refId] = new WeakRef(el);
    return refId;
  }

  function centerOf(el) {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }

  function waitFor({ text, appear = true, timeout = 5000 }) {
    return new Promise((resolve) => {
      const start = Date.now();
      let resolved = false;
      const diagnostics = [];
      let timer = null;

      const check = () => {
        try {
          const match = findElementByText(text, diagnostics);
          if (appear) {
            if (match) {
              const ref = ensureRefForElement(match);
              const center = centerOf(match);
              done({ success: true, matched: { ref, center }, tookMs: Date.now() - start });
            }
          } else {
            // wait for disappearance
            const hasInconclusiveTextProbe = diagnostics.some(
              (entry) =>
                entry &&
                (entry.source === 'visibility_check_failed' ||
                  entry.source === 'matches_text_failed' ||
                  entry.source === 'wait_for_text_check_failed'),
            );
            if (!match && !hasInconclusiveTextProbe) {
              done({ success: true, matched: null, tookMs: Date.now() - start });
            }
          }
        } catch (error) {
          recordDiagnostic(diagnostics, 'wait_for_text_check_failed', error);
        }
      };

      const done = (result) => {
        if (resolved) return;
        resolved = true;
        obs && obs.disconnect();
        if (timer) clearTimeout(timer);
        resolve(result);
      };

      const obs = new MutationObserver(() => check());
      try {
        obs.observe(document.documentElement || document.body, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
        });
      } catch (error) {
        recordDiagnostic(diagnostics, 'mutation_observer_failed', error);
      }

      // Initial check
      check();
      timer = setTimeout(
        () => {
          done({
            success: false,
            reason: 'timeout',
            tookMs: Date.now() - start,
            ...(diagnostics.length ? { diagnostics } : {}),
          });
        },
        Math.max(0, timeout),
      );
    });
  }

  function waitForSelector({ selector, visible = true, timeout = 5000 }) {
    return new Promise((resolve) => {
      const start = Date.now();
      let resolved = false;
      const diagnostics = [];
      let timer = null;

      const isMatch = () => {
        try {
          const el = document.querySelector(selector);
          if (!el) return { el: null };
          if (!visible) return { el };
          return { el: isVisible(el) ? el : null };
        } catch (error) {
          const message = describeError(error);
          recordDiagnostic(diagnostics, 'selector_query_failed', error);
          return { el: null, error: message };
        }
      };

      const done = (result) => {
        if (resolved) return;
        resolved = true;
        obs && obs.disconnect();
        if (timer) clearTimeout(timer);
        resolve(result);
      };

      const check = () => {
        const result = isMatch();
        if (result.error) {
          done({
            success: false,
            reason: 'selector_error',
            error: result.error,
            tookMs: Date.now() - start,
            diagnostics,
          });
          return;
        }
        const el = result.el;
        if (el) {
          const ref = ensureRefForElement(el);
          const center = centerOf(el);
          done({ success: true, matched: { ref, center }, tookMs: Date.now() - start });
        }
      };

      const obs = new MutationObserver(check);
      try {
        obs.observe(document.documentElement || document.body, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
        });
      } catch (error) {
        recordDiagnostic(diagnostics, 'mutation_observer_failed', error);
      }

      // initial check
      check();
      timer = setTimeout(
        () =>
          done({
            success: false,
            reason: 'timeout',
            tookMs: Date.now() - start,
            ...(diagnostics.length ? { diagnostics } : {}),
          }),
        Math.max(0, timeout),
      );
    });
  }

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    try {
      if (request && request.action === 'wait_helper_ping') {
        sendResponse({ status: 'pong' });
        return false;
      }
      if (request && request.action === 'waitForText') {
        const text = String(request.text || '').trim();
        const appear = request.appear !== false; // default true
        const timeout = Number(request.timeout || 5000);
        if (!text) {
          sendResponse({ success: false, error: 'text is required' });
          return true;
        }
        waitFor({ text, appear, timeout }).then((res) => sendResponse(res));
        return true; // async
      }
      if (request && request.action === 'waitForSelector') {
        const selector = String(request.selector || '').trim();
        const visible = request.visible !== false; // default true
        const timeout = Number(request.timeout || 5000);
        if (!selector) {
          sendResponse({ success: false, error: 'selector is required' });
          return true;
        }
        waitForSelector({ selector, visible, timeout }).then((res) => sendResponse(res));
        return true; // async
      }
    } catch (e) {
      sendResponse({ success: false, error: String(e && e.message ? e.message : e) });
      return true;
    }
    return false;
  });
})();
