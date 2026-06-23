/* global window, document, Element, CSS, Node, XPathResult, HTMLAnchorElement, chrome */

// interactive-elements-helper.js
// This script is injected into the page to find interactive elements.
// Final version by Calvin, featuring a multi-layered fallback strategy
// and comprehensive element support, built on a performant and reliable core.

(function () {
  // Prevent re-initialization
  if (window.__INTERACTIVE_ELEMENTS_HELPER_INITIALIZED__) {
    return;
  }
  window.__INTERACTIVE_ELEMENTS_HELPER_INITIALIZED__ = true;

  /**
   * @typedef {Object} ElementInfo
   * @property {string} type - The type of the element (e.g., 'button', 'link').
   * @property {string} selector - A CSS selector to uniquely identify the element.
   * @property {string} text - The visible text or accessible name of the element.
   * @property {boolean} isInteractive - Whether the element is currently interactive.
   * @property {Object} [coordinates] - The coordinates of the element if requested.
   * @property {boolean} [disabled] - For elements that can be disabled.
   * @property {string} [href] - For links.
   * @property {boolean} [checked] - for checkboxes and radio buttons.
   */

  /**
   * Configuration for element types and their corresponding selectors.
   * Now more comprehensive with common ARIA roles.
   */
  const ELEMENT_CONFIG = {
    button:
      'button, input[type="button"], input[type="submit"], [role="button"], svg[role="button"]',
    link: 'a[href], [role="link"]',
    input:
      'input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"])',
    checkbox: 'input[type="checkbox"], [role="checkbox"]',
    radio: 'input[type="radio"], [role="radio"]',
    textarea: 'textarea, [role="textbox"], [role="searchbox"], [contenteditable="true"]',
    select: 'select, [role="combobox"]',
    tab: '[role="tab"]',
    // Generic interactive elements: combines tabindex, common roles, and explicit handlers.
    // Includes SVG elements with interactive attributes.
    interactive: `[onclick], [tabindex]:not([tabindex^="-"]), [role="menuitem"], [role="slider"], [role="option"], [role="treeitem"], [role="switch"], svg[onclick], svg[tabindex]:not([tabindex^="-"])`,
  };

  // A combined selector for ANY interactive element, used in the fallback logic.
  const ANY_INTERACTIVE_SELECTOR = Object.values(ELEMENT_CONFIG).join(', ');
  const AUTH_ACTION_TEXT_PATTERN =
    /获取验证码|发送验证码|重新发送|重发验证码|同意并继续|确认同意|我同意|登录|get code|send code|request code|resend code|agree and continue|accept and continue|log\s*in|sign\s*in/i;
  const AUTH_ACTION_SIGNATURE_PATTERN =
    /\b(code|otp|sms|verify|verification|captcha|send|resend|auth-code|code-button|agree|agreement|terms|privacy|submit|login)\b/i;
  const SEARCH_QUERY_PATTERN = /\b(search|find|query)\b|搜索|查找/i;
  const SEARCH_IDENTITY_PATTERN = /\b(search|query)\b|搜索|查找/i;

  // Query helpers that pierce open shadow roots. These are used only in fallback paths or
  // when a selector is explicitly provided, to keep costs bounded.
  function* walkAllNodesDeep(root) {
    const stack = [root];
    const MAX = 12000; // safety bound
    let count = 0;
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      if (++count > MAX) break;
      yield node;
      const anyNode = /** @type {any} */ (node);
      try {
        const children = node.children ? Array.from(node.children) : [];
        for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
        const sr = anyNode && anyNode.shadowRoot ? anyNode.shadowRoot : null;
        if (sr && sr.children) {
          const srChildren = Array.from(sr.children);
          for (let i = srChildren.length - 1; i >= 0; i--) stack.push(srChildren[i]);
        }
      } catch (_) {
        /* ignore */
      }
    }
  }

  function querySelectorAllDeep(selector, root = document) {
    const results = [];
    for (const node of walkAllNodesDeep(root)) {
      if (!(node instanceof Element)) continue;
      try {
        if (node.matches && node.matches(selector)) results.push(node);
      } catch (_) {
        /* ignore invalid selectors for given node */
      }
    }
    return results;
  }

  function toXPathStringLiteral(value) {
    const text = String(value || '');
    if (!text.includes("'")) return `'${text}'`;

    const singleQuoteLiteral = `"'"`;
    return `concat(${text
      .split("'")
      .map((part) => `'${part}'`)
      .join(`, ${singleQuoteLiteral}, `)})`;
  }

  // --- Core Helper Functions ---

  /**
   * Checks if an element is genuinely visible on the page.
   * "Visible" means it's not styled with display:none, visibility:hidden, etc.
   * This check intentionally IGNORES whether the element is within the current viewport.
   * @param {Element} el The element to check.
   * @returns {boolean} True if the element is visible.
   */
  function isElementVisible(el) {
    if (!el || !el.isConnected) return false;

    const style = window.getComputedStyle(el);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      parseFloat(style.opacity) === 0
    ) {
      return false;
    }

    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0 || el.tagName === 'A'; // Allow zero-size anchors as they can still be navigated
  }

  function isElementInViewport(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    return (
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth
    );
  }

  function computeTargetVisibility(el) {
    const domVisible = isElementVisible(el);
    const inViewport = isElementInViewport(el);
    let centerHitTarget = null;
    let occluded = null;
    let reason = '';

    if (!domVisible) {
      reason = 'dom_hidden';
    } else if (!inViewport) {
      reason = 'offscreen';
    } else {
      try {
        const rect = el.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const hit =
          Number.isFinite(centerX) &&
          Number.isFinite(centerY) &&
          centerX >= 0 &&
          centerY >= 0 &&
          centerX <= window.innerWidth &&
          centerY <= window.innerHeight
            ? document.elementFromPoint(centerX, centerY)
            : null;
        centerHitTarget = Boolean(hit && (hit === el || el.contains(hit)));
        occluded = hit ? !centerHitTarget : null;
        reason = centerHitTarget
          ? 'visible_unobstructed'
          : hit
            ? 'center_covered'
            : 'hit_test_unavailable';
      } catch (_) {
        reason = 'hit_test_failed';
      }
    }

    return {
      source: 'dom',
      domVisible,
      inViewport,
      centerHitTarget,
      occluded,
      reason,
    };
  }

  /**
   * Checks if an element is considered interactive (not disabled or hidden from accessibility).
   * @param {Element} el The element to check.
   * @returns {boolean} True if the element is interactive.
   */
  function isElementInteractive(el) {
    if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') {
      return false;
    }
    if (el.closest('[aria-hidden="true"]')) {
      return false;
    }
    return true;
  }

  /**
   * Generates a reasonably stable CSS selector for a given element.
   * @param {Element} el The element.
   * @returns {string} A CSS selector.
   */
  function generateSelector(el) {
    if (!(el instanceof Element)) return '';

    if (el.id) {
      const idSelector = `#${CSS.escape(el.id)}`;
      if (document.querySelectorAll(idSelector).length === 1) return idSelector;
    }

    for (const attr of ['data-testid', 'data-cy', 'name']) {
      const attrValue = el.getAttribute(attr);
      if (attrValue) {
        const attrSelector = `[${attr}="${CSS.escape(attrValue)}"]`;
        if (document.querySelectorAll(attrSelector).length === 1) return attrSelector;
      }
    }

    let path = '';
    let current = el;
    while (current && current.nodeType === Node.ELEMENT_NODE && current.tagName !== 'BODY') {
      let selector = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (child) => child.tagName === current.tagName,
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }
      path = path ? `${selector} > ${path}` : selector;
      current = parent;
    }
    return path ? `body > ${path}` : 'body';
  }

  function classNameOf(el) {
    try {
      const attr = el.getAttribute && el.getAttribute('class');
      if (typeof attr === 'string') return attr;
      const className = el.className;
      if (typeof className === 'string') return className;
      if (className && typeof className.baseVal === 'string') return className.baseVal;
    } catch (_) {
      /* ignore */
    }
    return '';
  }

  function ownVisibleText(el) {
    let text = '';
    try {
      for (let i = 0; i < el.childNodes.length; i++) {
        const node = el.childNodes[i];
        if (node.nodeType === Node.TEXT_NODE) text += node.textContent || '';
      }
    } catch (_) {
      /* ignore */
    }
    return text.replace(/\s+/g, ' ').trim();
  }

  function isTextEntryElement(el) {
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    const role = String(el.getAttribute('role') || '').toLowerCase();
    const inputType = String(el.getAttribute('type') || '').toLowerCase();
    return (
      tag === 'textarea' ||
      role === 'textbox' ||
      role === 'searchbox' ||
      role === 'combobox' ||
      el.getAttribute('contenteditable') === 'true' ||
      (tag === 'input' && !['button', 'submit', 'reset', 'checkbox', 'radio'].includes(inputType))
    );
  }

  function queryRequestsSearch(textQuery) {
    return SEARCH_QUERY_PATTERN.test(String(textQuery || ''));
  }

  function elementHasSearchIdentity(el) {
    if (!(el instanceof Element)) return false;
    return SEARCH_IDENTITY_PATTERN.test(elementIdentityTextForQuery(el));
  }

  function looksLikeAuthActionControl(el, textQuery = '') {
    if (!(el instanceof Element)) return false;
    if (isTextEntryElement(el)) return false;
    const rect = el.getBoundingClientRect();
    const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
    const area = Math.max(1, rect.width * rect.height);
    if (area > viewportArea * 0.35) return false;
    const nestedText = area < viewportArea * 0.08 ? (el.textContent || '').trim() : '';
    const text =
      ownVisibleText(el) || el.getAttribute('aria-label') || el.getAttribute('title') || nestedText;
    const query = String(textQuery || '').trim();
    if (query && getQueryMatchKind(text, query) === 'none') return false;
    if (!AUTH_ACTION_TEXT_PATTERN.test(text)) return false;
    const signature = `${el.id || ''} ${classNameOf(el)} ${el.getAttribute('role') || ''} ${
      el.getAttribute('data-testid') || ''
    }`;
    return AUTH_ACTION_SIGNATURE_PATTERN.test(signature) || text.length <= 30;
  }

  function elementTextForQuery(el) {
    if (!(el instanceof Element)) return '';
    return (
      getAccessibleName(el) ||
      ownVisibleText(el) ||
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.textContent ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim();
  }

  function elementArea(el) {
    try {
      const rect = el.getBoundingClientRect();
      return Math.max(1, rect.width * rect.height);
    } catch (_) {
      return 1;
    }
  }

  function hasSmallerMatchingActionDescendant(el, query, containerArea) {
    try {
      const descendants = Array.from(el.querySelectorAll('*'));
      return descendants.some((child) => {
        if (!(child instanceof Element)) return false;
        if (!isElementVisible(child) || isTextEntryElement(child)) return false;
        if (elementArea(child) >= containerArea) return false;
        return getQueryMatchKind(elementTextForQuery(child), query) !== 'none';
      });
    } catch (_) {
      return false;
    }
  }

  function isOverBroadActionTextContainer(el, textQuery) {
    const query = String(textQuery || '').trim();
    if (!query || !isActionTextQuery(query) || !(el instanceof Element)) return false;
    if (isTextEntryElement(el)) return false;

    const containerText = elementTextForQuery(el);
    if (getQueryMatchKind(containerText, query) === 'none') return false;

    const directText =
      ownVisibleText(el) || el.getAttribute('aria-label') || el.getAttribute('title') || '';
    const directMatch = getQueryMatchKind(directText, query) !== 'none';
    const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
    const area = elementArea(el);
    const looksCompact = area <= viewportArea * 0.08 && containerText.length <= query.length + 18;
    if (directMatch && looksCompact) return false;

    return (
      (area > viewportArea * 0.08 || containerText.length > query.length + 30) &&
      hasSmallerMatchingActionDescendant(el, query, area)
    );
  }

  function looksLikeCompactTextActionControl(el, textQuery = '') {
    const query = String(textQuery || '').trim();
    if (!query || !(el instanceof Element)) return false;
    if (!isElementVisible(el) || isTextEntryElement(el)) return false;

    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (['html', 'body', 'main', 'section', 'article', 'form', 'table', 'ul', 'ol'].includes(tag)) {
      return false;
    }

    const directText = ownVisibleText(el);
    const text = (
      directText ||
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.textContent ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim();
    if (!text || getQueryMatchKind(text, query) === 'none') return false;

    const maxTextLength = Math.max(32, query.length + 18);
    if (text.length > maxTextLength) return false;

    try {
      const rect = el.getBoundingClientRect();
      const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
      const area = Math.max(1, rect.width * rect.height);
      if (area > viewportArea * 0.08) return false;
      if (rect.width > window.innerWidth * 0.6 || rect.height > window.innerHeight * 0.25) {
        return false;
      }
      if (hasSmallerMatchingActionDescendant(el, query, area)) return false;
    } catch (_) {
      return false;
    }

    if (!directText) {
      const childCount = el.children ? el.children.length : 0;
      if (childCount > 1) return false;
    }

    if (countInteractiveDescendants(el, 1) > 0) return false;
    return true;
  }

  function elementMatchesTextQuery(el, textQuery) {
    const query = String(textQuery || '').trim();
    if (!query) return true;
    if (!(el instanceof Element)) return false;
    if (isOverBroadActionTextContainer(el, query)) return false;
    return (
      getQueryMatchKind(elementTextForQuery(el), query) !== 'none' ||
      getQueryMatchKind(elementIdentityTextForQuery(el), query) !== 'none' ||
      (queryRequestsSearch(query) && isTextEntryElement(el) && elementHasSearchIdentity(el)) ||
      looksLikeAuthActionControl(el, query) ||
      looksLikeCompactTextActionControl(el, query)
    );
  }

  function elementIdentityTextForQuery(el) {
    if (!(el instanceof Element)) return '';
    const attrs = [
      el.getAttribute('aria-label'),
      el.getAttribute('placeholder'),
      el.getAttribute('title'),
      el.getAttribute('name'),
      el.getAttribute('id'),
      el.getAttribute('type'),
      el.getAttribute('role'),
      el.getAttribute('class'),
      el.getAttribute('data-testid'),
      el.getAttribute('data-test'),
      el.getAttribute('data-cy'),
    ];
    return attrs
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(' ');
  }

  /**
   * Finds the accessible name for an element (label, aria-label, etc.).
   * @param {Element} el The element.
   * @returns {string} The accessible name.
   */
  function getAccessibleName(el) {
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const labelElement = document.getElementById(labelledby);
      if (labelElement) return labelElement.textContent?.trim() || '';
    }
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label) return label.textContent?.trim() || '';
    }
    const parentLabel = el.closest('label');
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    const placeholder = el.getAttribute('placeholder') || '';
    if (tag === 'input' && placeholder && parentLabel) {
      const labelText = parentLabel.textContent?.trim() || '';
      const normalizedLabelText = labelText.replace(/\s+/g, '');
      const labelIsShortOrDecorative =
        normalizedLabelText.length < placeholder.trim().length ||
        /^[+\d\-[\]()（）\sA-Za-zIcon图标svgSVG]+$/.test(normalizedLabelText);
      if (
        AUTH_ACTION_TEXT_PATTERN.test(labelText) ||
        labelText.length > placeholder.length + 12 ||
        labelIsShortOrDecorative
      ) {
        return placeholder.trim();
      }
    }
    if (parentLabel) return parentLabel.textContent?.trim() || '';
    if (tag === 'input') {
      const inputType = String(el.getAttribute('type') || '').toLowerCase();
      if (inputType === 'submit' || inputType === 'button' || inputType === 'reset') {
        const valueLabel = el.getAttribute('value');
        if (valueLabel && valueLabel.trim()) return valueLabel.trim();
      }
    }
    return placeholder || el.textContent?.trim() || el.getAttribute('title') || '';
  }

  function getValueState(el) {
    if (!(el instanceof Element)) return null;
    const tag = el.tagName.toLowerCase();
    const role = String(el.getAttribute('role') || '').toLowerCase();
    if (
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'select' ||
      el.getAttribute('contenteditable') === 'true'
    ) {
      const rawValue =
        tag === 'select'
          ? /** @type {HTMLSelectElement} */ (el).value
          : tag === 'textarea'
            ? /** @type {HTMLTextAreaElement} */ (el).value
            : tag === 'input'
              ? /** @type {HTMLInputElement} */ (el).value
              : el.textContent || '';
      return String(rawValue || '').length > 0 ? 'non_empty' : 'empty';
    }
    if (
      role === 'textbox' ||
      role === 'searchbox' ||
      role === 'combobox' ||
      role === 'spinbutton'
    ) {
      const ariaValue =
        el.getAttribute('aria-valuetext') ||
        el.getAttribute('aria-valuenow') ||
        el.getAttribute('data-value') ||
        '';
      if (ariaValue) return 'non_empty';
      return 'unknown';
    }
    return null;
  }

  function queryTextMatches(text, query) {
    return getQueryMatchKind(text, query) !== 'none';
  }

  function inferMatchSource(el, textQuery) {
    const query = String(textQuery || '').trim();
    if (!query) return 'none';
    const visibleText = (el.textContent || '').trim();
    if (queryTextMatches(visibleText, query)) return 'visible_text';
    const ariaLabel = el.getAttribute('aria-label') || '';
    if (queryTextMatches(ariaLabel, query)) return 'aria';
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const labelElement = document.getElementById(labelledby);
      if (labelElement && queryTextMatches(labelElement.textContent || '', query)) return 'label';
    }
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label && queryTextMatches(label.textContent || '', query)) return 'label';
    }
    const parentLabel = el.closest('label');
    if (parentLabel && queryTextMatches(parentLabel.textContent || '', query)) return 'label';
    const placeholder = el.getAttribute('placeholder') || '';
    if (queryTextMatches(placeholder, query)) return 'placeholder';
    const value = el.getAttribute('value') || '';
    if (queryTextMatches(value, query)) return 'value';
    const title = el.getAttribute('title') || '';
    if (queryTextMatches(title, query)) return 'title';
    if (queryTextMatches(elementIdentityTextForQuery(el), query)) return 'attribute';
    if (queryRequestsSearch(query) && isTextEntryElement(el) && elementHasSearchIdentity(el)) {
      return 'attribute';
    }
    return 'accessible_name';
  }

  function isActionTextQuery(textQuery) {
    return /\b(click|submit|continue|confirm|login|sign\s*in|send|get|request|resend)\b|获取验证码|发送验证码|重新发送|同意|继续|确认|登录|提交/i.test(
      String(textQuery || ''),
    );
  }

  function inferActionability(el, type, textQuery, matchSource, isInteractive) {
    if (!isInteractive) return 'blocked';
    if (type === 'text') return 'not_actionable';
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    const role = String(el.getAttribute('role') || '').toLowerCase();
    const inputType = String(el.getAttribute('type') || '').toLowerCase();
    const isTextEntry = isTextEntryElement(el);
    if (matchSource === 'placeholder' && isTextEntry && isActionTextQuery(textQuery)) {
      return 'not_actionable';
    }
    if (matchSource === 'label' && isTextEntry && isActionTextQuery(textQuery)) {
      return 'not_actionable';
    }
    return 'actionable';
  }

  function getCheckedState(el) {
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    const role = String(el.getAttribute('role') || '').toLowerCase();
    if (tag === 'input' && ['checkbox', 'radio'].includes(String(el.getAttribute('type') || ''))) {
      return Boolean(/** @type {HTMLInputElement} */ (el).checked);
    }
    if (role === 'checkbox' || role === 'radio' || role === 'switch') {
      const ariaChecked = String(el.getAttribute('aria-checked') || '').toLowerCase();
      if (ariaChecked === 'true') return true;
      if (ariaChecked === 'false') return false;
      if (ariaChecked === 'mixed') return 'mixed';
    }
    const ariaSelected = String(el.getAttribute('aria-selected') || '').toLowerCase();
    if (ariaSelected === 'true') return true;
    if (ariaSelected === 'false') return false;

    const ariaPressed = String(el.getAttribute('aria-pressed') || '').toLowerCase();
    if (ariaPressed === 'true') return true;
    if (ariaPressed === 'false') return false;
    if (ariaPressed === 'mixed') return 'mixed';

    const ariaCurrent = String(el.getAttribute('aria-current') || '').toLowerCase();
    if (ariaCurrent && ariaCurrent !== 'false') return true;

    const className = classNameOf(el);
    if (/(^|[\s_-])(active|selected|current|applied|checked)([\s_-]|$)/i.test(className)) {
      return true;
    }
    return null;
  }

  /**
   * Simple subsequence matching for fuzzy search.
   * @param {string} text The text to search within.
   * @param {string} query The query subsequence.
   * @returns {boolean}
   */
  function fuzzyMatch(text, query) {
    if (!text || !query) return false;
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let textIndex = 0;
    let queryIndex = 0;
    while (textIndex < lowerText.length && queryIndex < lowerQuery.length) {
      if (lowerText[textIndex] === lowerQuery[queryIndex]) {
        queryIndex++;
      }
      textIndex++;
    }
    return queryIndex === lowerQuery.length;
  }

  /**
   * Creates the standardized info object for an element.
   * Modified to handle the new 'text' type from the final fallback.
   */
  function createElementInfo(
    el,
    type,
    includeCoordinates,
    isInteractiveOverride = null,
    matchContext = {},
  ) {
    const isActuallyInteractive = isElementInteractive(el);
    const isInteractive =
      isInteractiveOverride !== null ? isInteractiveOverride : isActuallyInteractive;
    const textQuery = matchContext.textQuery || '';
    const matchSource = matchContext.matchSource || inferMatchSource(el, textQuery);
    const info = {
      type,
      selector: generateSelector(el),
      text: getAccessibleName(el) || el.textContent?.trim(),
      isInteractive,
      disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
      tagName: el.tagName ? el.tagName.toLowerCase() : '',
      className:
        typeof el.className === 'string'
          ? el.className
          : el.className && typeof el.className.baseVal === 'string'
            ? el.className.baseVal
            : '',
      alt: el.getAttribute('alt') || '',
      title: el.getAttribute('title') || '',
      role: el.getAttribute('role') || '',
      matchSource,
      actionability: inferActionability(el, type, textQuery, matchSource, isInteractive),
    };
    const valueState = getValueState(el);
    if (valueState) info.valueState = valueState;
    const checked = getCheckedState(el);
    if (checked !== null) info.checked = checked;
    const visualSignature = getVisualSignature(el);
    if (visualSignature) info.visualSignature = visualSignature;
    info.visibility = computeTargetVisibility(el);
    if (includeCoordinates) {
      const rect = el.getBoundingClientRect();
      info.coordinates = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
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
      };
    }
    info.inViewport = isElementInViewport(el);
    if (el instanceof HTMLAnchorElement && el.href) {
      info.href = el.getAttribute('href') || el.href;
    }
    return info;
  }

  function getVisualSignature(el) {
    const tagName = el && el.tagName ? String(el.tagName).toLowerCase() : '';
    if (!/^(img|canvas|svg)$/.test(tagName)) return '';
    const rawParts = [
      tagName,
      el.getAttribute && el.getAttribute('src'),
      typeof el.currentSrc === 'string' ? el.currentSrc : '',
      el.getAttribute && el.getAttribute('data-src'),
      el.getAttribute && el.getAttribute('data-url'),
      el.getAttribute && el.getAttribute('aria-label'),
      el.getAttribute && el.getAttribute('alt'),
      el.getAttribute && el.getAttribute('title'),
      typeof el.className === 'string' ? el.className : '',
    ]
      .filter(Boolean)
      .join('|');
    if (!rawParts) return '';
    let hash = 2166136261;
    for (let i = 0; i < rawParts.length; i += 1) {
      hash ^= rawParts.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `visual_${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }

  function countInteractiveDescendants(el, limit = 12) {
    if (!el || !(el instanceof Element)) return 0;
    let count = 0;
    const descendants = el.querySelectorAll(ANY_INTERACTIVE_SELECTOR);
    for (const node of descendants) {
      if (!(node instanceof Element)) continue;
      if (!isElementVisible(node) || !isElementInteractive(node)) continue;
      count += 1;
      if (count >= limit) return count;
    }
    return count;
  }

  function getQueryMatchKind(text, query) {
    const normalizedText = String(text || '')
      .trim()
      .toLowerCase();
    const normalizedQuery = String(query || '')
      .trim()
      .toLowerCase();
    if (!normalizedText || !normalizedQuery) return 'none';
    if (normalizedText === normalizedQuery) return 'exact';
    if (normalizedText.startsWith(normalizedQuery)) return 'prefix';
    if (normalizedText.includes(normalizedQuery)) return 'substring';
    if (fuzzyMatch(normalizedText, normalizedQuery)) return 'fuzzy';
    return 'none';
  }

  function scoreElementForQuery(el, textQuery) {
    const accessibleName = (getAccessibleName(el) || '').trim();
    const text = (accessibleName || el.textContent || '').trim();
    const rect = el.getBoundingClientRect();
    const area = Math.max(1, rect.width * rect.height);
    const tag = el.tagName.toLowerCase();
    const query = String(textQuery || '').trim();
    const matchKind = getQueryMatchKind(text, query);
    const searchIdentityMatch =
      queryRequestsSearch(query) && isTextEntryElement(el) && elementHasSearchIdentity(el);
    const interactiveDescendants = countInteractiveDescendants(el);
    const textLength = text.length;
    const queryLength = query.length;
    let score = 0;

    if (query) {
      if (matchKind === 'exact') score += 120;
      else if (matchKind === 'prefix') score += 80;
      else if (matchKind === 'substring') score += 50;
      else if (matchKind === 'fuzzy') score += 20;
      else if (searchIdentityMatch) score += 75;
    }

    if (isElementInViewport(el)) score += 40;
    if (isElementInteractive(el)) score += 15;

    if (tag === 'button' || tag === 'a') score += 20;
    if (
      el.matches('[role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"]')
    )
      score += 18;
    if (el.matches('select, [role="combobox"]')) score += 16;
    if (el.matches('input, textarea')) score += 12;
    if (el.matches('[aria-haspopup], [aria-expanded], [aria-controls]')) score += 14;
    if (
      el.matches(
        '.arco-btn, .arco-link, .arco-cascader-list-item, .arco-dropdown-option, .arco-table-cell',
      )
    )
      score += 10;

    if (queryLength > 0) {
      if (textLength > queryLength + 18) score -= 12;
      if (textLength > queryLength + 48) score -= 28;
      if (matchKind === 'exact' && textLength <= queryLength + 4) score += 18;
    }

    if (area < 2500) score += 12;
    else if (area < 12000) score += 6;
    else if (area > 150000) score -= 25;
    else if (area > 60000) score -= 12;

    if (interactiveDescendants >= 6) score -= 18;
    if (interactiveDescendants >= 10) score -= 18;

    if (tag === 'div' || tag === 'section' || tag === 'main' || tag === 'article') {
      score -= 10;
      if (area > 30000) score -= 18;
      if (interactiveDescendants >= 4) score -= 24;
    }

    if (
      tag === 'li' &&
      (el.matches('[role="option"], [role="menuitem"]') ||
        el.className.includes('option') ||
        el.className.includes('item'))
    ) {
      score += 12;
    }

    if (el.id && /^arco-tabs-\d+-panel-\d+$/.test(el.id)) {
      score -= 80;
    }

    return score;
  }

  function sortElementsForQuery(elements, textQuery) {
    return [...elements].sort((left, right) => {
      const scoreDiff =
        scoreElementForQuery(right, textQuery) - scoreElementForQuery(left, textQuery);
      if (scoreDiff !== 0) return scoreDiff;

      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      const leftArea = Math.max(1, leftRect.width * leftRect.height);
      const rightArea = Math.max(1, rightRect.width * rightRect.height);
      if (leftArea !== rightArea) return leftArea - rightArea;

      return leftRect.top - rightRect.top;
    });
  }

  function findTextElementsByContent(textQuery) {
    const query = String(textQuery || '').trim();
    if (!query) return [];

    const matched = new Set();
    const allElements = document.body ? Array.from(document.body.querySelectorAll('*')) : [];

    for (const el of allElements) {
      if (!(el instanceof Element)) continue;
      if (!isElementVisible(el)) continue;

      const text = (getAccessibleName(el) || el.textContent || '').trim();
      const matchKind = getQueryMatchKind(text, query);
      if (matchKind === 'none') continue;

      matched.add(el);
    }

    const reduced = Array.from(matched).filter((el) => {
      return !Array.from(matched).some((other) => other !== el && el.contains(other));
    });

    return sortElementsForQuery(reduced, query);
  }

  /**
   * [CORE UTILITY] Finds interactive elements based on a set of types.
   * This is our high-performance Layer 1 search function.
   */
  function findInteractiveElements(options = {}) {
    const { textQuery, includeCoordinates = true, types = Object.keys(ELEMENT_CONFIG) } = options;

    const selectorsToFind = types
      .map((type) => ELEMENT_CONFIG[type])
      .filter(Boolean)
      .join(', ');
    if (!selectorsToFind) return [];

    const targetElements = querySelectorAllDeep(selectorsToFind);
    if (textQuery) {
      for (const node of walkAllNodesDeep(document.body || document.documentElement)) {
        if (!(node instanceof Element)) continue;
        if (!isElementVisible(node)) continue;
        if (
          (isActionTextQuery(textQuery) &&
            isElementInteractive(node) &&
            looksLikeAuthActionControl(node, textQuery)) ||
          looksLikeCompactTextActionControl(node, textQuery)
        ) {
          targetElements.push(node);
        }
      }
    }
    const uniqueElements = new Set(targetElements);
    const results = [];

    for (const el of uniqueElements) {
      const isCompactTextAction = looksLikeCompactTextActionControl(el, textQuery);
      if (!isElementVisible(el) || (!isElementInteractive(el) && !isCompactTextAction)) continue;

      if (textQuery && !elementMatchesTextQuery(el, textQuery)) continue;

      let elementType = 'unknown';
      for (const [type, typeSelector] of Object.entries(ELEMENT_CONFIG)) {
        if (el.matches(typeSelector)) {
          elementType = type;
          break;
        }
      }
      if (elementType === 'unknown' && isCompactTextAction) elementType = 'text_action';
      results.push(
        createElementInfo(el, elementType, includeCoordinates, isCompactTextAction || null, {
          textQuery,
        }),
      );
    }
    if (!textQuery) return results;
    const sorted = sortElementsForQuery(
      Array.from(uniqueElements).filter((el) => {
        const isCompactTextAction = looksLikeCompactTextActionControl(el, textQuery);
        if (!isElementVisible(el) || (!isElementInteractive(el) && !isCompactTextAction)) {
          return false;
        }
        return elementMatchesTextQuery(el, textQuery);
      }),
      textQuery,
    );
    return sorted.map((el) => {
      const isCompactTextAction = looksLikeCompactTextActionControl(el, textQuery);
      let elementType = 'unknown';
      for (const [type, typeSelector] of Object.entries(ELEMENT_CONFIG)) {
        if (el.matches(typeSelector)) {
          elementType = type;
          break;
        }
      }
      if (elementType === 'unknown' && isCompactTextAction) elementType = 'text_action';
      return createElementInfo(el, elementType, includeCoordinates, isCompactTextAction || null, {
        textQuery,
      });
    });
  }

  /**
   * [ORCHESTRATOR] The main entry point that implements the 3-layer fallback logic.
   * @param {object} options - The main search options.
   * @returns {ElementInfo[]}
   */
  function findElementsByTextWithFallback(options = {}) {
    const { textQuery, includeCoordinates = true } = options;

    if (!textQuery) {
      return findInteractiveElements({ ...options, types: Object.keys(ELEMENT_CONFIG) });
    }

    // --- Layer 1: High-reliability search for interactive elements matching text ---
    let results = findInteractiveElements({ ...options, types: Object.keys(ELEMENT_CONFIG) });
    if (results.length > 0) {
      if (
        !(
          isActionTextQuery(textQuery) &&
          results.every((item) => item.actionability === 'not_actionable')
        )
      ) {
        return results;
      }
      // If an action query only hit placeholders, keep looking for real text/ancestor buttons.
    }

    // --- Layer 2: Find text, then find its interactive ancestor ---
    const lowerCaseText = textQuery.toLowerCase();
    const xPathQuery = toXPathStringLiteral(lowerCaseText);
    const xPath = `//text()[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), ${xPathQuery})]`;
    const textNodes = document.evaluate(
      xPath,
      document,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );

    const interactiveElements = new Set();
    if (textNodes.snapshotLength > 0) {
      for (let i = 0; i < textNodes.snapshotLength; i++) {
        const parentElement = textNodes.snapshotItem(i).parentElement;
        if (parentElement) {
          const candidates = [];
          let current = parentElement;
          let depth = 0;
          while (current && current instanceof Element && depth < 8) {
            const isStandardInteractive =
              current.matches &&
              current.matches(ANY_INTERACTIVE_SELECTOR) &&
              isElementVisible(current) &&
              isElementInteractive(current);
            const isAuthAction =
              isElementVisible(current) &&
              isElementInteractive(current) &&
              looksLikeAuthActionControl(current, textQuery);
            const isCompactTextAction = looksLikeCompactTextActionControl(current, textQuery);
            if (isStandardInteractive || isAuthAction || isCompactTextAction) {
              candidates.push(current);
            }
            current = current.parentElement;
            depth += 1;
          }

          const bestAncestor = sortElementsForQuery(candidates, textQuery)[0];
          if (bestAncestor) {
            interactiveElements.add(bestAncestor);
          }
        }
      }

      if (interactiveElements.size > 0) {
        return sortElementsForQuery(Array.from(interactiveElements), textQuery).map((el) => {
          let elementType = 'interactive';
          for (const [type, typeSelector] of Object.entries(ELEMENT_CONFIG)) {
            if (el.matches(typeSelector)) {
              elementType = type;
              break;
            }
          }
          return createElementInfo(el, elementType, includeCoordinates, null, { textQuery });
        });
      }
    }

    // --- Layer 3: Final fallback, return any element containing the text ---
    const leafElements = new Set();
    for (let i = 0; i < textNodes.snapshotLength; i++) {
      const parentElement = textNodes.snapshotItem(i).parentElement;
      if (parentElement && isElementVisible(parentElement)) {
        leafElements.add(parentElement);
      }
    }

    const fallbackMatches = findTextElementsByContent(textQuery);
    for (const el of fallbackMatches) {
      leafElements.add(el);
    }

    const finalElements = Array.from(leafElements).filter((el) => {
      return ![...leafElements].some((otherEl) => el !== otherEl && el.contains(otherEl));
    });

    return sortElementsForQuery(finalElements, textQuery).map((el) =>
      createElementInfo(el, 'text', includeCoordinates, false, {
        textQuery,
        matchSource: 'fallback',
      }),
    );
  }

  // --- Chrome Message Listener ---
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'getInteractiveElements') {
      try {
        let elements;
        if (request.selector) {
          // If a selector is provided, use it as the candidate set but still honor textQuery.
          const textQuery = request.textQuery || '';
          const foundEls = querySelectorAllDeep(request.selector).filter((el) =>
            elementMatchesTextQuery(el, textQuery),
          );
          elements = sortElementsForQuery(foundEls, request.textQuery || '').map((el) =>
            createElementInfo(
              el,
              'selected',
              request.includeCoordinates !== false,
              isElementInteractive(el),
              { textQuery },
            ),
          );
        } else {
          // Otherwise, use our powerful multi-layered text search
          elements = findElementsByTextWithFallback(request);
        }
        sendResponse({ success: true, elements });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
      return true; // Async response
    } else if (request.action === 'chrome_get_interactive_elements_ping') {
      sendResponse({ status: 'pong' });
      return false;
    }
  });
})();
