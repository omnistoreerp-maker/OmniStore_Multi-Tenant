// Normal-user Google Sign-In — Authorization Code + PKCE (browser side).
//
// The browser never sees, stores or transmits a client secret, PKCE verifier,
// ID token or challenge token. It only starts the server-owned flow and, after
// the server asks for MFA / tenant selection, POSTs the user's answer with the
// httpOnly cookies the server set. A redirect marker is NEVER treated as proof
// of authentication: session hydration always goes through the existing
// /api/v1/auth/refresh + role probe path on the destination page.
(function (global) {
  'use strict';

  var START = '/auth/google-login-code';
  var API = '/api/v1/auth/google-login-code';
  var MFA = 'google_mfa';
  var TENANT = 'google_tenant_selection';

  var MESSAGES = {
    ar: {
      mfa: 'أدخل رمز التحقق الثنائي لإكمال الدخول عبر Google',
      tenant: 'اختر الشركة التي تريد الدخول إليها:',
      code: 'رمز التحقق',
      confirm: 'تأكيد',
      invalid: 'تعذّر استكمال الدخول عبر Google — ابدأ تسجيل الدخول من جديد',
      server: 'تعذّر الاتصال بالخادم',
      required: 'أدخل رمز التحقق',
      denied: 'هذا الخيار غير مسموح لحسابك',
      google: '🔵 الدخول عبر Google (حساب مرتبط)'
    },
    en: {
      mfa: 'Enter your verification code to finish signing in with Google',
      tenant: 'Choose the company you want to enter:',
      code: 'Verification code',
      confirm: 'Confirm',
      invalid: 'Google sign-in could not be completed — please start again',
      server: 'Could not reach the server',
      required: 'Enter the verification code',
      denied: 'This choice is not allowed for your account',
      google: '🔵 Sign in with Google (linked account)'
    }
  };

  function lang() {
    try {
      if (global.OmniI18n && typeof global.OmniI18n.getLang === 'function') {
        return global.OmniI18n.getLang() === 'en' ? 'en' : 'ar';
      }
    } catch (_) {}
    try {
      return global.localStorage.getItem('omnistore_language') === 'en' ? 'en' : 'ar';
    } catch (_) {
      return 'ar';
    }
  }

  function msg(key) {
    var table = MESSAGES[lang()] || MESSAGES.ar;
    return table[key] || MESSAGES.ar[key] || key;
  }

  function start(returnTo) {
    var target = typeof returnTo === 'string' && returnTo ? returnTo : (global.location && global.location.pathname) || '/';
    global.location.assign(START + '?returnTo=' + encodeURIComponent(target));
  }

  function request(path, body) {
    return fetch(API + path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (d) {
        return { ok: r.ok, status: r.status, data: d };
      });
    });
  }

  function challengeStatus() {
    return fetch(API + '/challenge', { credentials: 'same-origin' }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (d) {
        return { ok: r.ok, data: d && d.data ? d.data : null };
      });
    });
  }

  function panel() {
    var el = global.document.getElementById('omniGoogleAuthCodePanel');
    if (el) return el;
    el = global.document.createElement('div');
    el.id = 'omniGoogleAuthCodePanel';
    el.style.cssText = 'margin-top:10px;padding:10px;border:1px solid var(--border,#d1d5db);border-radius:10px;';
    var anchor = global.document.getElementById('loginError') || global.document.getElementById('platformAuthError');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(el, anchor.nextSibling);
    else global.document.body.appendChild(el);
    return el;
  }

  function clearPanel() {
    var el = global.document.getElementById('omniGoogleAuthCodePanel');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function notice(text) {
    var el = panel();
    el.innerHTML = '';
    var p = global.document.createElement('div');
    p.textContent = text;
    el.appendChild(p);
  }

  function clearMarkers() {
    try {
      var u = new global.URL(global.location.href);
      ['mfa_required', 'tenant_selection_required', 'gerr'].forEach(function (key) {
        u.searchParams.delete(key);
      });
      global.history.replaceState({}, global.document.title, u.pathname + u.search + u.hash);
    } catch (_) {}
  }

  // Called ONLY after a verified successful completion response. The marker
  // merely triggers the existing cookie-based session hydration; it is not
  // used as an authentication decision by this module.
  function enter() {
    try {
      var u = new global.URL(global.location.href);
      ['mfa_required', 'tenant_selection_required', 'gerr'].forEach(function (key) {
        u.searchParams.delete(key);
      });
      u.searchParams.set('gsignin', '1');
      global.location.assign(u.pathname + u.search + u.hash);
    } catch (_) {
      global.location.reload();
    }
  }

  function renderMfa() {
    notice(msg('mfa'));
    var el = panel();
    var input = global.document.createElement('input');
    input.type = 'text';
    input.id = 'omniGoogleAuthCodeMfa';
    input.inputMode = 'numeric';
    input.autocomplete = 'one-time-code';
    input.setAttribute('maxlength', '8');
    input.placeholder = msg('code');
    input.style.cssText = 'width:100%;padding:10px;margin-top:8px;box-sizing:border-box;';
    var btn = global.document.createElement('button');
    btn.type = 'button';
    btn.id = 'omniGoogleAuthCodeMfaSubmit';
    btn.textContent = msg('confirm');
    btn.className = 'btn-primary';
    btn.style.cssText = 'width:100%;margin-top:8px;';
    btn.addEventListener('click', function () {
      var code = String(input.value || '').trim();
      if (!code) { notice(msg('required')); return; }
      btn.disabled = true;
      return request('/mfa-verify', { mfaToken: code }).then(function (res) {
        btn.disabled = false;
        if (!res.ok || !res.data || !res.data.success || !res.data.data || !res.data.data.accessToken) {
          notice(msg('invalid'));
          return;
        }
        clearPanel();
        enter();
      }).catch(function () { btn.disabled = false; notice(msg('server')); });
    });
    el.appendChild(input);
    el.appendChild(btn);
    input.focus();
    return btn;
  }

  function renderTenants(tenants) {
    notice(msg('tenant'));
    var el = panel();
    var list = global.document.createElement('div');
    list.id = 'omniGoogleAuthCodeTenants';
    (tenants || []).forEach(function (tenant) {
      if (!tenant || tenant.id === undefined || tenant.id === null) return;
      var btn = global.document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-secondary';
      btn.style.cssText = 'width:100%;margin-top:6px;';
      btn.textContent = String(tenant.name || tenant.id);
      btn.addEventListener('click', function () {
        btn.disabled = true;
        return request('/select-tenant', { tenantId: String(tenant.id) }).then(function (res) {
          btn.disabled = false;
          if (!res.ok || !res.data || !res.data.success) {
            notice(msg(res.status === 403 ? 'denied' : 'invalid'));
            return;
          }
          var data = res.data.data || {};
          if (data.mfaRequired === true) { renderMfa(); return; }
          if (!data.accessToken) { notice(msg('invalid')); return; }
          clearPanel();
          enter();
        }).catch(function () { btn.disabled = false; notice(msg('server')); });
      });
      list.appendChild(btn);
    });
    el.appendChild(list);
    return list;
  }

  function boot() {
    try {
      var params = new global.URLSearchParams(global.location.search);
      var mfa = params.get('mfa_required') === '1';
      var tenant = params.get('tenant_selection_required') === '1';
      if (!mfa && !tenant) return Promise.resolve(null);
      return challengeStatus().then(function (res) {
        if (!res.ok || !res.data) { notice(msg('invalid')); return null; }
        if (res.data.purpose === TENANT && tenant) return renderTenants(res.data.availableTenants);
        if (res.data.purpose === MFA && mfa) return renderMfa();
        notice(msg('invalid'));
        return null;
      }).catch(function () { notice(msg('server')); return null; });
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  global.OmniGoogleAuthCode = {
    start: start,
    boot: boot,
    challengeStatus: challengeStatus,
    submitMfa: function (code) { return request('/mfa-verify', { mfaToken: String(code || '') }); },
    selectTenant: function (id) { return request('/select-tenant', { tenantId: String(id || '') }); },
    messages: MESSAGES,
    _clearMarkers: clearMarkers
  };
})(window);
