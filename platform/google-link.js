// OmniGoogleLink — the shared Google account LINKING flow for the
// signed-in Platform Master. This is NOT a login path: it only runs from
// an authenticated session, asks for the CURRENT password (server-side
// step-up via POST /auth/google/master/link-session — same contract as
// changePassword), and then follows the server-issued single-use ticket
// into the link-mode OIDC round-trip. The password travels only in the
// step-up JSON body — never in a URL, never to Google, never persisted.
//
// Loaded by BOTH shells:
//   - platform.html (homepage auth drawer) — platform.js wires the drawer
//     buttons to these functions and keeps its own session-gate refresh;
//   - index.html (Master Control Center) — boots via OmniGoogleLink.boot()
//     which wires the control-center section, consumes the round-trip
//     outcome (?glink=1 / ?gerr=code) and probes the linked state.
//
// The server is authoritative for identity, role, ticket validity and the
// link policy; this module only starts the round-trip and surfaces the
// safe outcomes the server reports. No credentials are hardcoded here.
(function (global) {
  'use strict';

  var LINK_SESSION_URL = '/auth/google/master/link-session';
  var LINK_ENTRY_URL = '/auth/google/master/link';
  var LINK_STATUS_URL = '/auth/google/master/link-status';

  // Safe, server-set outcome codes → Arabic messages. The codes are
  // emitted by the backend (_failRedirect); internal error details never
  // reach the client.
  var GERR_MESSAGES = {
    state_invalid: 'انتهت جلسة الربط — أعد المحاولة',
    nonce_invalid: 'جلسة ربط غير صالحة — أعد المحاولة',
    idtoken_invalid: 'تعذّر التحقق من هوية Google',
    not_linked: 'حساب Google غير مرتبط — سجّل الدخول بكلمة المرور ثم اربط Google',
    account_disabled: 'هذا الحساب معطّل',
    provider_error: 'تعذّر الاتصال بـ Google — أعد المحاولة',
    not_configured: 'الربط عبر Google غير مفعّل على الخادم',
    email_mismatch: 'بريد Google لا يطابق سياسة الربط المعتمدة',
    session_mismatch: 'انتهت جلسة الربط — أعد المحاولة',
    sub_taken: 'حساب Google هذا مرتبط بمستخدم آخر',
    link_policy_unconfigured: 'سياسة ربط Google غير مكوّنة على الخادم',
    link_failed: 'تعذّر إتمام الربط',
    session_invalid: 'الجلسة غير صالحة — أعد المحاولة'
  };

  // Same session token key the ERP app (index.html) and the platform
  // homepage (platform.js) read. Reusing it — never a parallel mechanism —
  // is what lets this flow ride the existing authenticated session.
  function authTokens() {
    try {
      return { access: localStorage.getItem('access_token') || '' };
    } catch (_) {
      return { access: '' };
    }
  }

  // Error sink shared by both shells: writes the same message to the
  // homepage drawer's #platformAuthError (identical hide/show contract to
  // platform.js's authError) and to the control center's #googleLinkStatus
  // live region when either element exists.
  function surfaceError(msg) {
    var el = document.getElementById('platformAuthError');
    if (el) {
      if (!msg) {
        el.textContent = '';
        el.setAttribute('hidden', '');
      } else {
        el.textContent = msg;
        el.removeAttribute('hidden');
      }
    }
    var st = document.getElementById('googleLinkStatus');
    if (st) st.textContent = msg || '';
  }

  function toast(msg, type) {
    try {
      if (typeof global.showToast === 'function') global.showToast(msg, type);
    } catch (_) {}
  }

  // returnTo for the server-issued round-trip: the current page's last
  // path segment (index.html → index.html, platform.html → platform.html);
  // the server's _safeReturnTo collapses anything hostile to the app root.
  function returnToPage() {
    var page = 'platform.html';
    try {
      var seg = (global.location.pathname || '').split('/').pop();
      if (seg) page = seg;
    } catch (_) {}
    return page;
  }

  // ------------------------------------------------------------------
  // Step-up: reveal the current-password confirmation. Session-gated —
  // linking never exists without an authenticated Master session.
  // ------------------------------------------------------------------
  function openStepUp() {
    var tokens = authTokens();
    if (!tokens.access) {
      surfaceError('سجّل الدخول بكلمة المرور أولًا لربط حساب Google');
      return;
    }
    surfaceError(null);
    var step = document.getElementById('platformAuthLinkStepUp');
    if (step) step.removeAttribute('hidden');
    var pass = document.getElementById('platformAuthLinkPass');
    if (pass) { pass.value = ''; if (typeof pass.focus === 'function') pass.focus(); }
  }

  function cancelStepUp() {
    var step = document.getElementById('platformAuthLinkStepUp');
    if (step) step.setAttribute('hidden', '');
    var pass = document.getElementById('platformAuthLinkPass');
    if (pass) pass.value = '';
    surfaceError(null);
  }

  // ------------------------------------------------------------------
  // Step-up submit: password re-auth → single-use ticket → navigate to
  // the LINK entry (never the login entry). The password travels ONLY in
  // the JSON body over same-origin fetch, is never persisted, and is
  // cleared on every outcome.
  // ------------------------------------------------------------------
  function submitStepUp() {
    var tokens = authTokens();
    if (!tokens.access) {
      surfaceError('انتهت الجلسة — سجّل الدخول من جديد');
      return;
    }
    var passEl = document.getElementById('platformAuthLinkPass');
    var currentPassword = passEl ? passEl.value : '';
    if (!currentPassword) {
      surfaceError('أدخل كلمة المرور الحالية لتأكيد الربط');
      return;
    }
    var submitBtn = document.getElementById('platformAuthLinkSubmit');
    if (submitBtn) submitBtn.disabled = true;
    surfaceError(null);
    fetch(LINK_SESSION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tokens.access },
      credentials: 'same-origin',
      body: JSON.stringify({ currentPassword: currentPassword })
    })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (j) {
          return { status: r.status, body: j };
        });
      })
      .then(function (res) {
        if (passEl) passEl.value = '';
        var ticket = res.body && res.body.success && res.body.data && res.body.data.ticket;
        if (res.status === 200 && ticket) {
          // Server-issued, single-use ticket: the ONLY credential that may
          // start link mode. Navigates to the link entry — never the login
          // entry — and the browser keeps the session cookies the server
          // re-checks on /auth/google/master/link.
          global.location.assign(
            LINK_ENTRY_URL + '?ticket=' + encodeURIComponent(ticket) +
            '&returnTo=' + encodeURIComponent(returnToPage())
          );
          return;
        }
        if (res.status === 400) surfaceError('تحقق من البيانات المدخلة');
        else if (res.status === 401) surfaceError('كلمة المرور غير صحيحة');
        else if (res.status === 403) surfaceError('غير مصرح — يلزم حساب ماستر نشط في المنصة');
        else if (res.status === 404) surfaceError('المستخدم غير موجود');
        else if (res.status === 501) surfaceError('الربط عبر Google غير مفعّل على الخادم');
        else surfaceError('تعذّر بدء ربط Google — أعد المحاولة');
      })
      .catch(function () {
        if (passEl) passEl.value = '';
        surfaceError('تعذّر الاتصال بالخادم — أعد المحاولة');
      })
      .then(function () {
        if (submitBtn) submitBtn.disabled = false;
      });
  }

  // ------------------------------------------------------------------
  // Round-trip outcome consumer (Master Control Center): a completed
  // link returns to this page with ?glink=1 (server-set ONLY after the
  // sub is bound); a denied one returns with ?gerr=<safe code>. Both
  // flags are stripped from the URL; the session itself is untouched —
  // linking never mints one.
  // ------------------------------------------------------------------
  function consumeResult() {
    var search = '';
    try { search = (global.location && global.location.search) || ''; } catch (_) { search = ''; }
    if (!search) return false;
    var glink = /[?&]glink=1(?:&|$)/.test(search);
    var gm = search.match(/[?&]gerr=([^&#]*)/);
    if (!glink && !gm) return false;
    try {
      var u = new URL(global.location.href);
      u.searchParams.delete('glink');
      u.searchParams.delete('gerr');
      global.history.replaceState({}, document.title, u.pathname + u.search + u.hash);
    } catch (_) {}
    var step = document.getElementById('platformAuthLinkStepUp');
    if (step) step.setAttribute('hidden', '');
    var pass = document.getElementById('platformAuthLinkPass');
    if (pass) pass.value = '';
    if (glink) {
      var okMsg = 'تم ربط حساب Google بهذا الحساب بنجاح';
      surfaceError(okMsg);
      toast(okMsg, 'success');
      refreshStatus();
      return true;
    }
    var raw = '';
    try { raw = decodeURIComponent(gm[1]); } catch (_) { raw = gm[1]; }
    var msg = GERR_MESSAGES[raw] || 'تعذّر إتمام العملية عبر Google';
    surfaceError(msg);
    toast(msg, 'error');
    refreshStatus();
    return true;
  }

  // ------------------------------------------------------------------
  // Read-only linked/configured probe for the control-center section.
  // GET /auth/google/master/link-status answers booleans only (no email,
  // no sub) for the CURRENT session; server enforces session + membership.
  // ------------------------------------------------------------------
  function refreshStatus() {
    var pill = document.getElementById('googleLinkPill');
    var section = document.getElementById('platformAuthGoogleLinkSection');
    var tokens = authTokens();
    if (!tokens.access) {
      if (pill) pill.textContent = 'سجّل الدخول لعرض حالة الربط';
      return;
    }
    fetch(LINK_STATUS_URL, {
      headers: { 'Authorization': 'Bearer ' + tokens.access },
      credentials: 'same-origin'
    })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (j) {
          return { status: r.status, body: j };
        });
      })
      .then(function (res) {
        if (!pill) return;
        if (res.status === 200 && res.body && res.body.success && res.body.data) {
          var d = res.body.data;
          if (!d.configured) { pill.textContent = 'الربط عبر Google غير مفعّل على الخادم'; return; }
          pill.textContent = d.linked
            ? '🟢 حساب Google مرتبط بهذه الحساب'
            : '⚪ حساب Google غير مرتبط بعد';
          return;
        }
        if (res.status === 401) { pill.textContent = 'انتهت الجلسة — سجّل الدخول من جديد'; return; }
        if (res.status === 403) {
          pill.textContent = 'غير مصرح — حساب ماستر فقط';
          if (section) section.style.display = 'none';
          return;
        }
        pill.textContent = '—';
      })
      .catch(function () {
        if (pill) pill.textContent = '—';
      });
  }

  // Idempotent boot for the Master Control Center: wires the section's
  // controls once, consumes any round-trip outcome in the URL, then probes
  // the linked state. platform.html does NOT call this — its drawer wiring
  // and session-gate refresh stay in platform.js.
  function boot() {
    var linkBtn = document.getElementById('platformAuthGoogleLink');
    if (linkBtn && !linkBtn.__omniGoogleLinkWired) {
      linkBtn.__omniGoogleLinkWired = true;
      linkBtn.addEventListener('click', openStepUp);
    }
    var submitBtn = document.getElementById('platformAuthLinkSubmit');
    if (submitBtn && !submitBtn.__omniGoogleLinkWired) {
      submitBtn.__omniGoogleLinkWired = true;
      submitBtn.addEventListener('click', submitStepUp);
    }
    var cancelBtn = document.getElementById('platformAuthLinkCancel');
    if (cancelBtn && !cancelBtn.__omniGoogleLinkWired) {
      cancelBtn.__omniGoogleLinkWired = true;
      cancelBtn.addEventListener('click', cancelStepUp);
    }
    var pass = document.getElementById('platformAuthLinkPass');
    if (pass && !pass.__omniGoogleLinkWired) {
      pass.__omniGoogleLinkWired = true;
      pass.addEventListener('keydown', function (e) {
        if (e && e.key === 'Enter') { e.preventDefault(); submitStepUp(); }
      });
    }
    consumeResult();
    refreshStatus();
  }

  global.OmniGoogleLink = {
    openStepUp: openStepUp,
    cancelStepUp: cancelStepUp,
    submitStepUp: submitStepUp,
    consumeResult: consumeResult,
    refreshStatus: refreshStatus,
    boot: boot,
    // Exposed for the static contract suites (never secrets).
    LINK_SESSION_URL: LINK_SESSION_URL,
    LINK_ENTRY_URL: LINK_ENTRY_URL,
    LINK_STATUS_URL: LINK_STATUS_URL,
    GERR_MESSAGES: GERR_MESSAGES
  };
})(typeof window !== 'undefined' ? window : this);
