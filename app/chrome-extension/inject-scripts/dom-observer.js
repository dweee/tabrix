/* global chrome, window, document, location, MutationObserver */

// dom-observer.js - observe DOM for triggers and notify background
(function () {
  if (window.__RR_DOM_OBSERVER__) return;
  window.__RR_DOM_OBSERVER__ = true;

  const active = { triggers: [], hits: new Map() };
  const diagnosticsKey = '__TABRIX_INJECT_SCRIPT_DIAGNOSTICS__';

  function recordDiagnostic(source, error) {
    try {
      const bucket = (window[diagnosticsKey] = Array.isArray(window[diagnosticsKey])
        ? window[diagnosticsKey]
        : []);
      bucket.push({
        source,
        message: String(error && error.message ? error.message : error),
        at: Date.now(),
      });
      if (bucket.length > 25) bucket.splice(0, bucket.length - 25);
    } catch (_diagnosticError) {
      return;
    }
  }

  function now() {
    return Date.now();
  }

  function applyTriggers(list) {
    try {
      active.triggers = Array.isArray(list) ? list.slice() : [];
      active.hits.clear();
      checkAll();
    } catch (e) {
      recordDiagnostic('dom_observer.apply_triggers', e);
    }
  }

  function checkAll() {
    try {
      for (const t of active.triggers) {
        maybeFire(t);
      }
    } catch (e) {
      recordDiagnostic('dom_observer.check_all', e);
    }
  }

  function maybeFire(t) {
    try {
      const appear = t.appear !== false; // default true
      const sel = String(t.selector || '').trim();
      if (!sel) return;
      const exists = !!document.querySelector(sel);
      const key = t.id;
      const last = active.hits.get(key) || 0;
      const debounce = Math.max(0, Number(t.debounceMs ?? 800));
      if (now() - last < debounce) return;
      const should = appear ? exists : !exists;
      if (should) {
        active.hits.set(key, now());
        chrome.runtime.sendMessage({
          action: 'dom_trigger_fired',
          triggerId: t.id,
          url: location.href,
        });
        if (t.once !== false) removeTrigger(t.id);
      }
    } catch (e) {
      recordDiagnostic('dom_observer.maybe_fire', e);
    }
  }

  function removeTrigger(id) {
    try {
      active.triggers = active.triggers.filter((x) => x.id !== id);
    } catch (e) {
      recordDiagnostic('dom_observer.remove_trigger', e);
    }
  }

  const mo = new MutationObserver(() => {
    checkAll();
  });
  try {
    mo.observe(document.documentElement || document, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false,
    });
  } catch (e) {
    recordDiagnostic('dom_observer.observe', e);
  }

  chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
    try {
      if (req && req.action === 'dom_observer_ping') {
        sendResponse({ status: 'pong' });
        return false;
      }
      if (req && req.action === 'set_dom_triggers') {
        applyTriggers(req.triggers || []);
        sendResponse({ success: true, count: active.triggers.length });
        return true;
      }
    } catch (e) {
      sendResponse({ success: false, error: String(e && e.message ? e.message : e) });
      return true;
    }
    return false;
  });
})();
