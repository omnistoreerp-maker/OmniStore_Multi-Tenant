// OmniGoogleLogin — Universal Google Login for EXISTING linked accounts.
//
// The browser obtains a Google ID token from Google Identity Services and
// posts it to /api/v1/auth/google-login. Everything that decides identity,
// MFA and tenant scope happens on the server; this module only drives the
// requests and reports what the server said.
//
// Deliberate properties:
//   * The Google ID token is sent once and never stored, logged or rendered.
//   * The intermediate challenge token (tempToken) lives in memory only —
//     never localStorage/sessionStorage/cookies — and is cleared on every
//     outcome (success, rejection, network failure).
//   * Tenant options come exclusively from the server response; a tenant id
//     that is not in that list is rejected before any request is made.
//   * A Google SDK success is NOT a login: only a server-issued access token
//     completes the flow.
//   * Overlapping submissions are refused while a request is in flight.
//
// Loaded by platform.html before platform.js. No credentials are hardcoded.
(function (global) {
  'use strict';

  var URLS = {
    config: '/api/v1/auth/google-login/config',
    login: '/api/v1/auth/google-login',
    mfa: '/api/v1/auth/google-login/mfa-verify',
    tenant: '/api/v1/auth/google-login/select-tenant'
  };
  var GIS_SRC = 'https://accounts.google.com/gsi/client';

  function createFlow(options) {
    var opts = options || {};
    var doFetch = typeof opts.fetch === 'function'
      ? opts.fetch
      : function (url, init) { return global.fetch(url, init); };
    var onSession = typeof opts.onSession === 'function' ? opts.onSession : function () {};
    var onChallenge = typeof opts.onChallenge === 'function' ? opts.onChallenge : function () {};
    var onError = typeof opts.onError === 'function' ? opts.onError : function () {};

    var state = { busy: false, tempToken: '', tenants: [] };

    function reset() {
      state.tempToken = '';
      state.tenants = [];
    }

    function fail(code) {
      if (code) onError(code);
      return { ok: false, error: code || 'server_error' };
    }

    function postJson(url, body) {
      return doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body)
      }).then(function (res) {
        return res.json().catch(function () { return null; }).then(function (data) {
          return { status: res.status, ok: res.ok, body: data };
        });
      });
    }

    // Status/code → stable message key. The server is the only authority on
    // WHY a request was refused; this only picks the wording.
    // The backend error envelope carries the machine code in
    // `body.details.code`: utils/apiResponse.error(res, message, status,
    // details) serializes details as-is, which is how every other endpoint
    // reports it. A legacy top-level `body.code` is still honoured so an
    // older server keeps its wording. Missing, null or non-object details,
    // or a non-string code, yield NO code — never a guess from the message
    // text — and the caller falls through to the generic refusal.
    function errorCode(body) {
      if (!body || typeof body !== 'object') return '';
      var details = body.details;
      if (details && typeof details === 'object' &&
          typeof details.code === 'string' && details.code) {
        return details.code;
      }
      if (typeof body.code === 'string' && body.code) return body.code;
      return '';
    }

    function mapError(status, body, context) {
      var code = errorCode(body);
      if (status === 429) return 'rate_limited';
      if (status === 503) return 'unavailable';
      if (status === 400) return 'invalid_request';
      if (status === 401) return context === 'mfa' ? 'mfa_invalid' : 'invalid_identity';
      if (status === 403) {
        if (code === 'ACCOUNT_DISABLED') return 'account_disabled';
        if (code === 'COMPANY_SUSPENDED') return 'company_suspended';
        if (code === 'TENANT_MEMBERSHIP_REQUIRED') return 'membership_required';
        return context === 'tenant' ? 'tenant_denied' : 'denied';
      }
      return 'server_error';
    }

    // Reads ONLY fields the backend actually returns. No invented properties,
    // no client-supplied identity, no default tenant.
    function applySuccess(body) {
      var data = body && body.data ? body.data : null;
      if (!data) return fail('server_error');

      if (data.tenantSelectionRequired === true) {
        var rich = Array.isArray(data.availableTenants) ? data.availableTenants : [];
        state.tempToken = typeof data.tempToken === 'string' ? data.tempToken : '';
        state.tenants = rich
          .filter(function (t) { return t && t.id !== undefined && t.id !== null; })
          .map(function (t) { return { id: String(t.id), name: String(t.name || t.id) }; });
        if (!state.tempToken || state.tenants.length === 0) return fail('challenge_invalid');
        onChallenge({ type: 'tenant', tenants: state.tenants.slice() });
        return { ok: true, step: 'tenant' };
      }

      if (data.mfaRequired === true) {
        state.tempToken = typeof data.tempToken === 'string' ? data.tempToken : '';
        if (!state.tempToken) return fail('challenge_invalid');
        onChallenge({ type: 'mfa' });
        return { ok: true, step: 'mfa' };
      }

      if (typeof data.accessToken === 'string' && data.accessToken) {
        reset();
        onSession(data);
        return { ok: true, step: 'session' };
      }

      return fail('server_error');
    }

    function loginWithIdToken(idToken) {
      if (state.busy) return Promise.resolve({ ok: false, error: 'busy' });
      if (!idToken || typeof idToken !== 'string') return Promise.resolve(fail('invalid_request'));
      state.busy = true;
      return postJson(URLS.login, { idToken: idToken })
        .then(function (r) {
          if (!r.ok || !r.body || r.body.success !== true) {
            reset();
            return fail(mapError(r.status, r.body, 'login'));
          }
          return applySuccess(r.body);
        })
        .catch(function () { reset(); return fail('network_error'); })
        .then(function (out) { state.busy = false; return out; });
    }

    function submitMfa(code) {
      if (state.busy) return Promise.resolve({ ok: false, error: 'busy' });
      var trimmed = typeof code === 'string' ? code.trim() : '';
      if (!trimmed) return Promise.resolve(fail('invalid_request'));
      if (!state.tempToken) return Promise.resolve(fail('challenge_missing'));
      state.busy = true;
      return postJson(URLS.mfa, { tempToken: state.tempToken, mfaToken: trimmed })
        .then(function (r) {
          if (!r.ok || !r.body || r.body.success !== true) {
            // The server burns the challenge BEFORE evaluating the code, so a
            // rejected attempt leaves nothing reusable: drop local state and
            // require a fresh Google sign-in.
            reset();
            return fail(mapError(r.status, r.body, 'mfa'));
          }
          return applySuccess(r.body);
        })
        .catch(function () { reset(); return fail('network_error'); })
        .then(function (out) { state.busy = false; return out; });
    }

    function selectTenant(tenantId) {
      if (state.busy) return Promise.resolve({ ok: false, error: 'busy' });
      if (!state.tempToken) return Promise.resolve(fail('challenge_missing'));
      var id = (tenantId === undefined || tenantId === null) ? '' : String(tenantId);
      if (!id) return Promise.resolve(fail('invalid_request'));
      // Server-provided list is the ONLY source of acceptable tenants; a
      // hand-edited id never reaches the network.
      var allowed = state.tenants.some(function (t) { return t.id === id; });
      if (!allowed) return Promise.resolve(fail('tenant_not_allowed'));
      state.busy = true;
      return postJson(URLS.tenant, { tempToken: state.tempToken, tenantId: id })
        .then(function (r) {
          if (!r.ok || !r.body || r.body.success !== true) {
            reset();
            return fail(mapError(r.status, r.body, 'tenant'));
          }
          return applySuccess(r.body);
        })
        .catch(function () { reset(); return fail('network_error'); })
        .then(function (out) { state.busy = false; return out; });
    }

    return {
      loginWithIdToken: loginWithIdToken,
      submitMfa: submitMfa,
      selectTenant: selectTenant,
      reset: reset,
      isBusy: function () { return state.busy; },
      // Read-only view for the UI and tests; never contains tokens for storage.
      snapshot: function () {
        return { busy: state.busy, pendingChallenge: Boolean(state.tempToken), tenants: state.tenants.map(function (t) { return t.name; }) };
      }
    };
  }

  // Public, non-secret browser configuration. A disabled/unreachable endpoint
  // means "no linked-account Google button": fail closed, never a fake entry.
  function loadConfig(options) {
    var doFetch = (options && typeof options.fetch === 'function')
      ? options.fetch
      : function (url, init) { return global.fetch(url, init); };
    return doFetch(URLS.config, { credentials: 'same-origin' })
      .then(function (res) { return res.json().catch(function () { return null; }); })
      .then(function (body) {
        var data = body && body.success === true && body.data ? body.data : null;
        if (!data || data.enabled !== true || typeof data.clientId !== 'string' || !data.clientId) {
          return { enabled: false, clientId: '' };
        }
        return { enabled: true, clientId: data.clientId };
      })
      .catch(function () { return { enabled: false, clientId: '' }; });
  }

  // Loads Google Identity Services once. Resolves only when the SDK is usable.
  function loadGis(doc) {
    var d = doc || global.document;
    if (global.google && global.google.accounts && global.google.accounts.id) {
      return Promise.resolve(true);
    }
    return new Promise(function (resolve, reject) {
      if (!d || typeof d.createElement !== 'function') { reject(new Error('gis_unavailable')); return; }
      var existing = typeof d.querySelector === 'function' ? d.querySelector('script[data-omni-gis="1"]') : null;
      if (existing) {
        existing.addEventListener('load', function () { resolve(true); });
        existing.addEventListener('error', function () { reject(new Error('gis_failed')); });
        return;
      }
      var s = d.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.defer = true;
      s.setAttribute('data-omni-gis', '1');
      s.onload = function () { resolve(true); };
      s.onerror = function () { reject(new Error('gis_failed')); };
      (d.head || d.documentElement).appendChild(s);
    });
  }

  global.OmniGoogleLogin = {
    createFlow: createFlow,
    loadConfig: loadConfig,
    loadGis: loadGis,
    URLS: URLS,
    GIS_SRC: GIS_SRC
  };
})(typeof window !== 'undefined' ? window : this);
