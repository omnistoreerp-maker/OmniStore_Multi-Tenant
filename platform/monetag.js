'use strict';

/**
 * OmniStore Monetag integration boundary (SAFE / DISABLED by default).
 *
 * Purpose:
 *   - Isolate third-party monetization from ERP/business core.
 *   - Never become a dependency of sign-in, tenant/branch isolation, ledger
 *     balances, payment flows, or Visitors Now / platform activity.
 *   - Remain inert until the repository owner supplies a real publisher ID
 *     and official script URL (OWNER_REQUIRED - not invented here).
 *
 * Activation (owner only, separate decision):
 *   1. Set data-monetag-enabled="true" on the platform.html script tag.
 *   2. Set data-monetag-publisher-id to the real Monetag publisher/site id.
 *   3. Set data-monetag-script-url to the official https Monetag script URL.
 *   4. Coordinate CSP/script-src allowlisting with ops if required.
 *   Until all three are present and valid, load() is a no-op.
 *
 * Constraints honored by this module:
 *   - Single loader (idempotent).
 *   - Fail-closed: any error is swallowed; core pages keep working.
 *   - No network I/O while disabled.
 *   - No mutation of platform.js / Visitors Now / backend services.
 */
(function (global) {
  var MARKER = 'omnistoreMonetagBoundary';
  // A) Boundary/config element (platform.html local module tag) — never an external loader.
  var CONFIG_ATTR = 'data-omnistore-monetag-boundary';
  var CONFIG_VALUE = 'config';
  // B) Actual external Monetag <script> loader (injected only).
  var EXTERNAL_ATTR = 'data-omnistore-monetag-external';

  var defaultConfig = {
    enabled: false,
    publisherId: '',
    scriptUrl: ''
  };

  var state = {
    config: {
      enabled: defaultConfig.enabled,
      publisherId: defaultConfig.publisherId,
      scriptUrl: defaultConfig.scriptUrl
    },
    loaded: false,
    loading: false,
    lastError: null
  };

  function isPlaceholder(value) {
    var v = String(value == null ? '' : value).trim();
    if (!v) return true;
    if (/^(owner_required|placeholder|your[_-]|change[_-]me|xxx+|todo)/i.test(v)) return true;
    return false;
  }

  function isSafeScriptUrl(value) {
    var v = String(value == null ? '' : value).trim();
    if (!v || isPlaceholder(v)) return false;
    if (v.indexOf('javascript:') === 0 || v.indexOf('data:') === 0 || v.indexOf('blob:') === 0) {
      return false;
    }
    return /^https:\/\//i.test(v);
  }

  function readConfigFromScriptTag() {
    try {
      var scripts = global.document && global.document.getElementsByTagName
        ? global.document.getElementsByTagName('script')
        : [];
      for (var i = 0; i < scripts.length; i++) {
        var s = scripts[i];
        if (!s.getAttribute) continue;
        if (s.getAttribute(CONFIG_ATTR) === CONFIG_VALUE ||
            s.getAttribute('data-monetag-enabled') != null ||
            (s.getAttribute('src') || '').indexOf('platform/monetag.js') !== -1) {
          var enabledRaw = s.getAttribute('data-monetag-enabled');
          var publisher = s.getAttribute('data-monetag-publisher-id');
          var scriptUrl = s.getAttribute('data-monetag-script-url');
          if (enabledRaw != null) {
            state.config.enabled = String(enabledRaw).toLowerCase() === 'true';
          }
          if (publisher != null) state.config.publisherId = String(publisher).trim();
          if (scriptUrl != null) state.config.scriptUrl = String(scriptUrl).trim();
          break;
        }
      }
    } catch (err) {
      state.lastError = err;
    }
  }

  function canActivate(config) {
    var c = config || state.config;
    if (!c || c.enabled !== true) return false;
    if (isPlaceholder(c.publisherId)) return false;
    if (!isSafeScriptUrl(c.scriptUrl)) return false;
    return true;
  }

  function isBoundaryConfigScript(el) {
    if (!el || !el.getAttribute) return false;
    if (el.getAttribute(CONFIG_ATTR) === CONFIG_VALUE) return true;
    if (el.getAttribute('data-monetag-enabled') != null) return true;
    var src = el.getAttribute('src') || '';
    return src.indexOf('platform/monetag.js') !== -1;
  }

  function isExternalLoaderScript(el) {
    if (!el || !el.getAttribute) return false;
    if (isBoundaryConfigScript(el)) return false;
    return el.getAttribute(EXTERNAL_ATTR) === 'true';
  }

  function hasExistingLoader() {
    try {
      var doc = global.document;
      if (!doc || !doc.querySelectorAll) return false;
      // Only actual external loaders — boundary/config alone never counts.
      var nodes = doc.querySelectorAll('script[' + EXTERNAL_ATTR + '="true"]');
      if (!nodes) return false;
      for (var i = 0; i < nodes.length; i++) {
        if (isExternalLoaderScript(nodes[i])) return true;
      }
      return false;
    } catch (err) {
      return false;
    }
  }

  function injectScript(config) {
    var doc = global.document;
    if (!doc || !doc.createElement) {
      throw new Error('document unavailable');
    }
    if (hasExistingLoader()) {
      state.loaded = true;
      return null;
    }
    var el = doc.createElement('script');
    el.setAttribute(EXTERNAL_ATTR, 'true');
    el.setAttribute('data-monetag-publisher-id', String(config.publisherId));
    el.async = true;
    el.src = config.scriptUrl;
    el.setAttribute('data-monetag-boundary', 'omnistore');
    (doc.head || doc.body || doc.documentElement).appendChild(el);
    return el;
  }

  function load() {
    try {
      if (state.loaded || state.loading) return { ok: false, reason: state.loaded ? 'already_loaded' : 'loading' };
      if (!canActivate(state.config)) {
        state.lastError = null;
        return { ok: false, reason: 'disabled_or_owner_input_required' };
      }
      state.loading = true;
      var el = injectScript(state.config);
      state.loaded = true;
      state.loading = false;
      return { ok: true, reason: el ? 'injected' : 'already_present' };
    } catch (err) {
      state.loading = false;
      state.lastError = err;
      return { ok: false, reason: 'error' };
    }
  }

  function getConfig() {
    return {
      enabled: state.config.enabled === true,
      publisherId: state.config.publisherId,
      scriptUrl: state.config.scriptUrl,
      canActivate: canActivate(state.config),
      activation: canActivate(state.config) ? 'READY' : 'OWNER_INPUT_REQUIRED'
    };
  }

  function isLoaded() {
    return state.loaded === true;
  }

  function configure(partial) {
    try {
      if (!partial || typeof partial !== 'object') return getConfig();
      if (Object.prototype.hasOwnProperty.call(partial, 'enabled')) {
        state.config.enabled = partial.enabled === true || String(partial.enabled).toLowerCase() === 'true';
      }
      if (Object.prototype.hasOwnProperty.call(partial, 'publisherId')) {
        state.config.publisherId = String(partial.publisherId == null ? '' : partial.publisherId).trim();
      }
      if (Object.prototype.hasOwnProperty.call(partial, 'scriptUrl')) {
        state.config.scriptUrl = String(partial.scriptUrl == null ? '' : partial.scriptUrl).trim();
      }
    } catch (err) {
      state.lastError = err;
    }
    return getConfig();
  }

  var api = {
    version: 1,
    name: 'OmniMonetagBoundary',
    load: load,
    isLoaded: isLoaded,
    getConfig: getConfig,
    configure: configure,
    canActivate: function () { return canActivate(state.config); }
  };

  readConfigFromScriptTag();

  // Attach without replacing an existing global (idempotent require).
  if (!global[MARKER]) {
    try {
      global[MARKER] = api;
    } catch (err) { /* non-configurable global — boundary still local */ }
  }

  // Safe auto-load attempt: no-op while disabled / OWNER_INPUT_REQUIRED.
  try {
    api.load();
  } catch (err) { /* never break page init */ }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
