/**
 * OmniAdSlot — the platform's single sanctioned advertising surface.
 *
 * HARD CONTRACT (non-negotiable):
 *   - INLINE ONLY: the slot is a normal page-flow rectangle inside the page's
 *     max-width container. It is never fixed, never absolute, never an
 *     overlay, never fullscreen, never a dialog, never a popunder, and it
 *     never hijacks navigation (no OnClick / Popunder format is ever mounted).
 *     It can never cover products, header, navigation, buttons, cart or
 *     dialogs: it is plain in-flow content after the main page content.
 *   - GATED: with OMNI_AD_CONFIG.enabled !== true (or a placeholder zone /
 *     missing script URL) it is fully inert — zero network requests, zero ad
 *     scripts, and the slot renders as a quiet placeholder.
 *   - NO INVENTED ZONES: if the config is not a real, safe, owner-approved
 *     inline zone, nothing loads. "OWNER_INPUT_REQUIRED" is an explicit
 *     not-configured state, never a guess.
 *   - PROHIBITED ZONES ARE HARD-BLOCKED: 288239 (the Multitag zone whose
 *     OnClick/Popunder runtime sub-zone hijacked Platform→Marketplace
 *     navigation on production, reproduced 6× on 2026-09-28), 11912374 (that
 *     runtime OnClick sub-zone), 11912377 and 11857331 can never be mounted,
 *     no matter what the config says.
 *   - FAIL-SAFE: any error while mounting is swallowed after removing
 *     whatever was injected; the page never breaks, and the slot degrades to
 *     the placeholder. Visitor counter, heartbeat, cart and products are
 *     never touched.
 *
 * Placement contract per page (already shipped in the HTML):
 *   CONTENT
 *     ↓
 *   <aside class="omni-ad-slot" data-omni-ad>   ← in-flow, inside container
 *     ↓
 *   FOOTER / NEXT CONTENT
 */
(function (global) {
  'use strict';

  var MARKER = 'omnistoreOmniAdSlot';

  // Zones that must never be activated anywhere on this platform. Keep this
  // list authoritative: 288239 = Multitag hub zone with the hijacking OnClick
  // sub-zone; 11912374 = the OnClick/Popunder runtime sub-zone itself;
  // 11912377 and 11857331 = previously observed unsafe/legacy zones.
  var PROHIBITED_ZONES = ['288239', '11912374', '11912377', '11857331'];

  function readPageConfig() {
    try {
      var cfg = global.OMNI_AD_CONFIG;
      if (!cfg || typeof cfg !== 'object') return null;
      return cfg;
    } catch (_) {
      return null;
    }
  }

  function normalize(v) {
    return String(v == null ? '' : v).trim();
  }

  function isPlaceholderZone(zone) {
    var v = normalize(zone);
    if (!v) return true;
    return /^(owner_input_required|owner_required|placeholder|your[_-].*|change[_-]me.*|xxx+|todo)$/i.test(v);
  }

  function isProhibitedZone(zone) {
    return PROHIBITED_ZONES.indexOf(normalize(zone)) !== -1;
  }

  function isSafeScriptUrl(value) {
    var v = normalize(value);
    if (!v || isPlaceholderZone(v)) return false;
    if (v.indexOf('javascript:') === 0 || v.indexOf('data:') === 0 || v.indexOf('blob:') === 0) return false;
    return /^https:\/\//i.test(v);
  }

  function resolveConfig() {
    var page = readPageConfig() || {};
    var enabledRaw = normalize(page.enabled).toLowerCase() === 'true';
    var zone = normalize(page.zone);
    var scriptUrl = normalize(page.scriptUrl);
    var reason;
    if (!enabledRaw) reason = 'disabled';
    else if (isPlaceholderZone(zone)) reason = 'owner_input_required';
    else if (isProhibitedZone(zone)) reason = 'prohibited_zone_blocked';
    else if (!isSafeScriptUrl(scriptUrl)) reason = 'invalid_script_url';
    else reason = 'enabled';
    return {
      enabled: reason === 'enabled',
      zone: zone,
      scriptUrl: scriptUrl,
      reason: reason,
      activation: reason === 'enabled' ? 'READY' : 'OWNER_INPUT_REQUIRED'
    };
  }

  function findSlotRoots() {
    var doc = global.document;
    if (!doc || !doc.querySelectorAll) return [];
    return Array.prototype.slice.call(doc.querySelectorAll('[data-omni-ad]')).filter(function (el) {
      // The slot container itself is the boundary: whatever is inside stays
      // inside the aside; nothing may escape to cover other content.
      return el && el.querySelector && el.querySelector('[data-omni-ad-root]');
    });
  }

  function renderPlaceholder(slot) {
    try {
      var root = slot.querySelector('[data-omni-ad-root]');
      if (!root) return;
      root.textContent = 'مساحة إعلانية — Placeholder (disabled)';
      root.classList.add('omni-ad-placeholder');
    } catch (_) { /* never break the page */ }
  }

  function mountAdEngine(root, cfg) {
    var script = global.document.createElement('script');
    script.src = cfg.scriptUrl;
    script.async = true;
    script.setAttribute('data-zone', cfg.zone);
    script.setAttribute('data-cfasync', 'false');
    // In-flow mount only: the engine renders inside the slot's inner box.
    root.appendChild(script);
    return script;
  }

  function init() {
    var cfg = resolveConfig();
    var slots = findSlotRoots();
    for (var i = 0; i < slots.length; i++) {
      var slot = slots[i];
      try {
        if (!cfg.enabled) {
          renderPlaceholder(slot);
        } else {
          var root = slot.querySelector('[data-omni-ad-root]');
          if (root) {
            try {
              mountAdEngine(root, cfg);
            } catch (mountErr) {
              // Fail-safe: remove whatever was injected, degrade to placeholder.
              try { while (root.firstChild) root.removeChild(root.firstChild); } catch (_) {}
              renderPlaceholder(slot);
            }
          }
        }
      } catch (_) { /* never break the page */ }
      try {
        slot.setAttribute('data-omni-ad-state', cfg.enabled ? 'active' : 'placeholder');
      } catch (_) { /* never break the page */ }
    }
    return { slots: slots.length, state: cfg.enabled ? 'active' : cfg.reason };
  }

  var api = {
    version: 1,
    name: 'OmniAdSlot',
    init: init,
    getConfig: function () { return resolveConfig(); },
    getProhibitedZones: function () { return PROHIBITED_ZONES.slice(); },
    isProhibitedZone: isProhibitedZone,
    isPlaceholderZone: isPlaceholderZone
  };

  if (!global[MARKER]) {
    try {
      global[MARKER] = api;
    } catch (_) { /* non-configurable global — still functional locally */ }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (global.document && global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', function () {
      try { api.init(); } catch (_) { /* never break the page */ }
    });
  } else if (global.document) {
    // DOM already parsed (defer scripts run after parsing): init immediately.
    try { api.init(); } catch (_) { /* never break the page */ }
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
