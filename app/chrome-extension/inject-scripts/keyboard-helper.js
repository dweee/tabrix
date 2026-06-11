/* global chrome, window, document, KeyboardEvent */
// keyboard-helper.js
// This script is injected into the page to handle keyboard event simulation

if (window.__KEYBOARD_HELPER_INITIALIZED__) {
  // Already initialized, skip
} else {
  window.__KEYBOARD_HELPER_INITIALIZED__ = true;

  // A map for special keys to their KeyboardEvent properties
  // Key names should be lowercase for matching
  const SPECIAL_KEY_MAP = {
    enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
    tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
    esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
    escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
    space: { key: ' ', code: 'Space', keyCode: 32 },
    backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
    delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
    del: { key: 'Delete', code: 'Delete', keyCode: 46 },
    up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
    arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
    down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
    arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
    left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
    arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
    right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
    arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
    home: { key: 'Home', code: 'Home', keyCode: 36 },
    end: { key: 'End', code: 'End', keyCode: 35 },
    pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
    pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
    insert: { key: 'Insert', code: 'Insert', keyCode: 45 },
    // Function keys
    ...Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [
        `f${i + 1}`,
        { key: `F${i + 1}`, code: `F${i + 1}`, keyCode: 112 + i },
      ]),
    ),
  };

  const MODIFIER_KEYS = {
    ctrl: 'ctrlKey',
    control: 'ctrlKey',
    alt: 'altKey',
    shift: 'shiftKey',
    meta: 'metaKey',
    command: 'metaKey',
    cmd: 'metaKey',
  };

  function nowMs() {
    return window.performance && typeof window.performance.now === 'function'
      ? window.performance.now()
      : Date.now();
  }

  function waitForFocusReady(element, { maxMs = 100 } = {}) {
    const startedAt = nowMs();
    if (document.activeElement === element) {
      return Promise.resolve({ waitedMs: 0, reason: 'already_focused', ready: true });
    }
    return new Promise((resolve) => {
      const deadline = startedAt + Math.max(0, maxMs);
      const finish = (reason, ready) => {
        resolve({
          waitedMs: Math.max(0, Math.round(nowMs() - startedAt)),
          reason,
          ready,
        });
      };
      const tick = () => {
        if (document.activeElement === element) {
          finish('focused', true);
          return;
        }
        if (nowMs() >= deadline) {
          finish('timeout', false);
          return;
        }
        if (typeof window.requestAnimationFrame !== 'function') {
          finish('raf_unavailable', false);
          return;
        }
        window.requestAnimationFrame(tick);
      };
      tick();
    });
  }

  function dispatchMouseLikeEvent(element, type) {
    if (!element || typeof element.dispatchEvent !== 'function') return false;
    try {
      return element.dispatchEvent(
        new window.MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );
    } catch {
      return false;
    }
  }

  function resolveElementRef(ref) {
    if (!ref || typeof ref !== 'string') return null;
    try {
      const map = window.__claudeElementMap;
      const weak = map && map[ref];
      const element = weak && typeof weak.deref === 'function' ? weak.deref() : null;
      return element instanceof window.Element ? element : null;
    } catch {
      return null;
    }
  }

  async function prepareKeyboardTarget(element) {
    if (!element || document.activeElement === element || typeof element.focus !== 'function') {
      return { waitedMs: 0, reason: 'already_focused', ready: document.activeElement === element };
    }

    if (typeof element.scrollIntoView === 'function') {
      try {
        element.scrollIntoView({ block: 'center', inline: 'nearest' });
      } catch {
        element.scrollIntoView();
      }
    }

    dispatchMouseLikeEvent(element, 'pointerdown');
    dispatchMouseLikeEvent(element, 'mousedown');
    try {
      element.focus({ preventScroll: true });
    } catch {
      element.focus();
    }
    dispatchMouseLikeEvent(element, 'mouseup');
    dispatchMouseLikeEvent(element, 'click');

    let focusWait = await waitForFocusReady(element, { maxMs: 250 });
    if (!focusWait.ready) {
      try {
        element.focus();
      } catch {
        // Keep the original focus wait diagnostics below.
      }
      const retry = await waitForFocusReady(element, { maxMs: 250 });
      focusWait = {
        waitedMs: focusWait.waitedMs + retry.waitedMs,
        reason: retry.ready ? 'focused_after_retry' : retry.reason,
        ready: retry.ready,
      };
    }
    return focusWait;
  }

  function getScrollDiagnostics() {
    const scrollingElement = document.scrollingElement || document.documentElement || document.body;
    const activeElement = document.activeElement || document.body;
    const activeScroll = getElementScrollMetrics(activeElement);
    return {
      window: {
        scrollX: Math.round(window.scrollX || 0),
        scrollY: Math.round(window.scrollY || 0),
        innerWidth: Math.round(window.innerWidth || 0),
        innerHeight: Math.round(window.innerHeight || 0),
      },
      document: {
        scrollTop: Math.round(scrollingElement ? scrollingElement.scrollTop || 0 : 0),
        scrollLeft: Math.round(scrollingElement ? scrollingElement.scrollLeft || 0 : 0),
        scrollHeight: Math.round(scrollingElement ? scrollingElement.scrollHeight || 0 : 0),
        scrollWidth: Math.round(scrollingElement ? scrollingElement.scrollWidth || 0 : 0),
        clientHeight: Math.round(scrollingElement ? scrollingElement.clientHeight || 0 : 0),
        clientWidth: Math.round(scrollingElement ? scrollingElement.clientWidth || 0 : 0),
      },
      activeElement: {
        tagName: activeElement && activeElement.tagName,
        id: activeElement && activeElement.id,
        className: activeElement && activeElement.className,
        type: activeElement && activeElement.type,
        ...activeScroll,
      },
    };
  }

  function getElementScrollMetrics(element) {
    if (!element) return {};
    return {
      scrollTop: Math.round(Number(element.scrollTop || 0)),
      scrollLeft: Math.round(Number(element.scrollLeft || 0)),
      scrollHeight: Math.round(Number(element.scrollHeight || 0)),
      scrollWidth: Math.round(Number(element.scrollWidth || 0)),
      clientHeight: Math.round(Number(element.clientHeight || 0)),
      clientWidth: Math.round(Number(element.clientWidth || 0)),
    };
  }

  function hasScrollChanged(before, after) {
    if (!before || !after) return false;
    return (
      before.window.scrollX !== after.window.scrollX ||
      before.window.scrollY !== after.window.scrollY ||
      before.document.scrollTop !== after.document.scrollTop ||
      before.document.scrollLeft !== after.document.scrollLeft ||
      before.activeElement?.scrollTop !== after.activeElement?.scrollTop ||
      before.activeElement?.scrollLeft !== after.activeElement?.scrollLeft
    );
  }

  function isScrollableElement(element) {
    if (!element) return false;
    return Number(element.scrollHeight || 0) > Number(element.clientHeight || 0) + 1;
  }

  function findFallbackScrollElement(startElement) {
    const scrollingElement = document.scrollingElement || document.documentElement || document.body;
    if (isScrollableElement(scrollingElement)) {
      return { element: scrollingElement, kind: 'document' };
    }

    let current = startElement && startElement.nodeType === 1 ? startElement : null;
    while (current && current !== document.body && current !== document.documentElement) {
      if (isScrollableElement(current)) {
        return { element: current, kind: 'element' };
      }
      current = current.parentElement;
    }

    return null;
  }

  function getFallbackViewportHeight(scrollTarget) {
    if (scrollTarget?.kind === 'element') {
      return Math.max(1, scrollTarget.element.clientHeight || window.innerHeight || 0);
    }
    return Math.max(1, window.innerHeight || scrollTarget?.element?.clientHeight || 0);
  }

  function maybeFallbackScroll(parsedKeyInfo, before, after, eventTarget) {
    if (!parsedKeyInfo || hasScrollChanged(before, after)) {
      return null;
    }

    const scrollTarget = findFallbackScrollElement(
      eventTarget || document.activeElement || document.body,
    );
    if (!scrollTarget) {
      return null;
    }

    const scrollingElement = scrollTarget.element;
    const viewportHeight = getFallbackViewportHeight(scrollTarget);
    const key = parsedKeyInfo.key;
    let deltaY = 0;
    let targetTop = null;

    if (key === 'PageDown') {
      deltaY = Math.max(1, Math.round(viewportHeight * 0.85));
    } else if (key === 'PageUp') {
      deltaY = -Math.max(1, Math.round(viewportHeight * 0.85));
    } else if (key === 'ArrowDown') {
      deltaY = 80;
    } else if (key === 'ArrowUp') {
      deltaY = -80;
    } else if (key === 'Home') {
      targetTop = 0;
    } else if (key === 'End') {
      targetTop = scrollingElement.scrollHeight;
    } else {
      return null;
    }

    const beforeTop = scrollingElement.scrollTop || window.scrollY || 0;
    if (targetTop !== null) {
      scrollingElement.scrollTop = targetTop;
      if (scrollTarget.kind === 'document') {
        window.scrollTo(window.scrollX || 0, targetTop);
      }
    } else {
      scrollingElement.scrollTop = beforeTop + deltaY;
      if (scrollTarget.kind === 'document') {
        window.scrollBy(0, deltaY);
      }
    }

    const fallbackAfter = getScrollDiagnostics();
    const applied =
      scrollTarget.kind === 'document'
        ? hasScrollChanged(before, fallbackAfter)
        : scrollingElement.scrollTop !== beforeTop;
    return {
      applied,
      key,
      reason:
        scrollTarget.kind === 'document'
          ? 'synthetic_keyboard_did_not_scroll_page'
          : 'synthetic_keyboard_did_not_scroll_container',
      targetKind: scrollTarget.kind,
      targetTagName: scrollingElement.tagName || null,
      targetId: scrollingElement.id || null,
      targetClassName: String(scrollingElement.className || '').slice(0, 120) || null,
      beforeTop: Math.round(beforeTop),
      deltaY,
      targetTop,
      afterTop:
        scrollTarget.kind === 'document'
          ? fallbackAfter.document.scrollTop
          : Math.round(scrollingElement.scrollTop || 0),
      diagnosticsAfter: fallbackAfter,
    };
  }

  /**
   * Parses a key string (e.g., "Ctrl+Shift+A", "Enter") into a main key and modifiers.
   * @param {string} keyString - String representation of a single key press (can include modifiers).
   * @returns { {key: string, code: string, keyCode: number, charCode?: number, modifiers: {ctrlKey:boolean, altKey:boolean, shiftKey:boolean, metaKey:boolean}} | null }
   *          Returns null if the keyString is invalid or represents only modifiers.
   */
  function parseSingleKeyCombination(keyString) {
    const parts = keyString.split('+').map((part) => part.trim().toLowerCase());
    const modifiers = {
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    };
    let mainKeyPart = null;

    for (const part of parts) {
      if (MODIFIER_KEYS[part]) {
        modifiers[MODIFIER_KEYS[part]] = true;
      } else if (mainKeyPart === null) {
        // First non-modifier is the main key
        mainKeyPart = part;
      } else {
        // Invalid format: multiple main keys in a single combination (e.g., "Ctrl+A+B")
        return null;
      }
    }

    if (!mainKeyPart) {
      // This case could happen if the keyString is something like "Ctrl+" or just "Ctrl"
      // If the intent was to press JUST 'Control', the input should be 'Control' not 'Control+'
      // Let's check if mainKeyPart is actually a modifier name used as a main key
      if (Object.keys(MODIFIER_KEYS).includes(parts[parts.length - 1]) && parts.length === 1) {
        mainKeyPart = parts[parts.length - 1]; // e.g. user wants to press "Control" key itself
        // For "Control" key itself, key: "Control", code: "ControlLeft" (or Right)
        if (mainKeyPart === 'ctrl' || mainKeyPart === 'control')
          return { key: 'Control', code: 'ControlLeft', keyCode: 17, modifiers };
        if (mainKeyPart === 'alt') return { key: 'Alt', code: 'AltLeft', keyCode: 18, modifiers };
        if (mainKeyPart === 'shift')
          return { key: 'Shift', code: 'ShiftLeft', keyCode: 16, modifiers };
        if (mainKeyPart === 'meta' || mainKeyPart === 'command' || mainKeyPart === 'cmd')
          return { key: 'Meta', code: 'MetaLeft', keyCode: 91, modifiers };
      } else {
        return null;
      }
    }

    const specialKey = SPECIAL_KEY_MAP[mainKeyPart];
    if (specialKey) {
      return { ...specialKey, modifiers };
    }

    // For single characters or other unmapped keys
    if (mainKeyPart.length === 1) {
      const charCode = mainKeyPart.charCodeAt(0);
      // If Shift is active and it's a letter, use the uppercase version for 'key'
      // This mimics more closely how keyboards behave.
      let keyChar = mainKeyPart;
      if (modifiers.shiftKey && mainKeyPart.match(/^[a-z]$/i)) {
        keyChar = mainKeyPart.toUpperCase();
      }

      return {
        key: keyChar,
        code: `Key${mainKeyPart.toUpperCase()}`, // 'a' -> KeyA, 'A' -> KeyA
        keyCode: charCode,
        charCode: charCode, // charCode is legacy, but some old systems might use it
        modifiers,
      };
    }

    return null; // Or handle as an error
  }

  /**
   * Simulates a single key press (keydown, (keypress), keyup) for a parsed key.
   * @param { {key: string, code: string, keyCode: number, charCode?: number, modifiers: object} } parsedKeyInfo
   * @param {Element} element - Target element.
   * @returns {{success: boolean, error?: string}}
   */
  function dispatchKeyEvents(parsedKeyInfo, element) {
    if (!parsedKeyInfo) return { success: false, error: 'Invalid key info provided for dispatch.' };

    const { key, code, keyCode, charCode, modifiers } = parsedKeyInfo;

    const eventOptions = {
      key: key,
      code: code,
      bubbles: true,
      cancelable: true,
      composed: true, // Important for shadow DOM
      ...modifiers, // ctrlKey, altKey, shiftKey, metaKey
      // keyCode/which are deprecated but often set for compatibility
      keyCode: keyCode || (key.length === 1 ? key.charCodeAt(0) : 0),
      which: keyCode || (key.length === 1 ? key.charCodeAt(0) : 0),
    };

    try {
      const kdRes = element.dispatchEvent(new KeyboardEvent('keydown', eventOptions));

      // keypress is deprecated, but simulate if it's a character key or Enter
      // Only dispatch if keydown was not cancelled and it's a character producing key
      if (kdRes && (key.length === 1 || key === 'Enter' || key === ' ')) {
        const keypressOptions = { ...eventOptions };
        if (charCode) keypressOptions.charCode = charCode;
        element.dispatchEvent(new KeyboardEvent('keypress', keypressOptions));
      }

      element.dispatchEvent(new KeyboardEvent('keyup', eventOptions));
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Error dispatching key events for "${key}": ${error.message}`,
      };
    }
  }

  /**
   * Simulate keyboard events on an element or document
   * @param {string} keysSequenceString - String representation of key(s) (e.g., "Enter", "Ctrl+C, A, B")
   * @param {Element} targetElement - Element to dispatch events on (optional)
   * @param {number} delay - Delay between key sequences in milliseconds (optional)
   * @returns {Promise<Object>} - Result of the keyboard operation
   */
  async function simulateKeyboard(keysSequenceString, targetElement = null, delay = 0) {
    try {
      const element = targetElement || document.activeElement || document.body;
      let focusWait = null;

      if (element !== document.activeElement && typeof element.focus === 'function') {
        focusWait = await prepareKeyboardTarget(element);
      }

      const keyCombinations = keysSequenceString
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k.length > 0);
      const hasSubmitKey = keyCombinations.some((combo) =>
        combo
          .toLowerCase()
          .split('+')
          .some((token) => token.trim() === 'enter'),
      );
      const tagName = element && element.tagName ? element.tagName.toUpperCase() : '';
      if (!targetElement && hasSubmitKey && (tagName === 'BODY' || tagName === 'HTML')) {
        return {
          success: false,
          error:
            'Refusing to send Enter to BODY/HTML. Provide a selector or read_page target ref for the input/control that should receive the submit key.',
          results: [],
          targetElement: {
            tagName: element.tagName,
            id: element.id,
            className: element.className,
            type: element.type,
            scrollDiagnostics: getScrollDiagnostics(),
            waitDiagnostics: {
              focus: { waitedMs: 0, reason: 'body_html_submit_guard', ready: false },
            },
          },
        };
      }
      const operationResults = [];

      for (let i = 0; i < keyCombinations.length; i++) {
        const comboString = keyCombinations[i];
        const parsedKeyInfo = parseSingleKeyCombination(comboString);

        if (!parsedKeyInfo) {
          operationResults.push({
            keyCombination: comboString,
            success: false,
            error: `Invalid key string or combination: ${comboString}`,
          });
          continue; // Skip to next combination in sequence
        }

        const scrollBefore = getScrollDiagnostics();
        const dispatchResult = dispatchKeyEvents(parsedKeyInfo, element);
        const scrollAfterDispatch = getScrollDiagnostics();
        const fallbackScroll = maybeFallbackScroll(
          parsedKeyInfo,
          scrollBefore,
          scrollAfterDispatch,
          element,
        );
        const scrollAfter = fallbackScroll?.diagnosticsAfter || scrollAfterDispatch;
        const scrollChanged =
          hasScrollChanged(scrollBefore, scrollAfter) || !!fallbackScroll?.applied;
        operationResults.push({
          keyCombination: comboString,
          ...dispatchResult,
          scrollDiagnostics: {
            before: scrollBefore,
            after: scrollAfter,
            changed: scrollChanged,
            fallback: fallbackScroll
              ? {
                  applied: fallbackScroll.applied,
                  reason: fallbackScroll.reason,
                  targetKind: fallbackScroll.targetKind,
                  targetTagName: fallbackScroll.targetTagName,
                  targetId: fallbackScroll.targetId,
                  targetClassName: fallbackScroll.targetClassName,
                  deltaY: fallbackScroll.deltaY,
                  targetTop: fallbackScroll.targetTop,
                  beforeTop: fallbackScroll.beforeTop,
                  afterTop: fallbackScroll.afterTop,
                }
              : null,
          },
        });

        if (dispatchResult.error) {
          // Optionally, decide if sequence should stop on first error
          // For now, we continue but log the error in results
        }

        if (delay > 0 && i < keyCombinations.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      // Check if all individual operations were successful
      const overallSuccess = operationResults.every((r) => r.success);

      return {
        success: overallSuccess,
        message: overallSuccess
          ? `Keyboard events simulated successfully: ${keysSequenceString}`
          : `Some keyboard events failed for: ${keysSequenceString}`,
        results: operationResults, // Detailed results for each key combination
        targetElement: {
          tagName: element.tagName,
          id: element.id,
          className: element.className,
          type: element.type, // if applicable e.g. for input
          scrollDiagnostics: getScrollDiagnostics(),
          waitDiagnostics: {
            focus: focusWait || { waitedMs: 0, reason: 'already_focused', ready: true },
          },
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Error simulating keyboard events: ${error.message}`,
        results: [],
      };
    }
  }

  // Listener for messages from the extension
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'simulateKeyboard') {
      let targetEl = null;
      if (request.selector) {
        targetEl = document.querySelector(request.selector);
        if (!targetEl) {
          sendResponse({
            success: false,
            error: `Element with selector "${request.selector}" not found`,
            results: [],
          });
          return true; // Keep channel open for async response
        }
      } else if (request.ref) {
        targetEl = resolveElementRef(request.ref);
        if (!targetEl) {
          sendResponse({
            success: false,
            error: `Element ref "${request.ref}" not found. Please call chrome_read_page first and ensure the ref is still valid.`,
            results: [],
          });
          return true;
        }
      }

      simulateKeyboard(request.keys, targetEl, request.delay)
        .then(sendResponse)
        .catch((error) => {
          // This catch is for unexpected errors in simulateKeyboard promise chain itself
          sendResponse({
            success: false,
            error: `Unexpected error during keyboard simulation: ${error.message}`,
            results: [],
          });
        });
      return true; // Indicates async response is expected
    } else if (request.action === 'chrome_keyboard_ping') {
      sendResponse({ status: 'pong', initialized: true }); // Respond that it's initialized
      return false; // Synchronous response
    }
    // Not our message, or no async response needed
    return false;
  });
}
