'use strict';

// Compact login + Master entry regression suite (Phase: compact-login).
//
// Pins the public homepage auth drawer contract without a browser:
//   - visitor browsing is untouched (no auto-open, no redirect on load)
//   - drawer open/close mechanics, focus, and responsive-safe markup
//   - login submit against stubbed fetch: 401/403/network outcomes, token
//     storage, server-authoritative role probe, constant-only redirect target
//   - a signed-in Platform Master STAYS in the homepage drawer (link flow
//     reachable without opening /index.html manually) while tenant logins
//     keep the exact hand-off to the app entry
//   - logout clears every credential
//   - index.html consumes the one-shot redirect key only for an internal,
//     allowed page behind canAccessPage
//
// Live-master login (real platform admin credentials) is deliberately NOT
// covered here: no test credentials exist in this repository and none may be
// invented. Backend API authorization is covered by backend/tests/auth.test.js,
// backend/tests/platformMaster.test.js and backend/tests/tenantEnforcement.test.js.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const PLATFORM_HTML = fs.readFileSync(path.join(ROOT, 'platform.html'), 'utf8');
const PLATFORM_JS = fs.readFileSync(path.join(ROOT, 'platform', 'platform.js'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === 'function') {
      return out.then(() => { passed += 1; console.log('PASS  ' + name); })
        .catch((err) => { failed += 1; console.error('FAIL  ' + name + ' :: ' + (err && err.message)); process.exitCode = 1; });
    }
    passed += 1;
    console.log('PASS  ' + name);
  } catch (err) {
    failed += 1;
    console.error('FAIL  ' + name + ' :: ' + (err && err.message));
    process.exitCode = 1;
  }
  return null;
}
function assert(cond, message) {
  if (!cond) throw new Error(message || 'assertion failed');
}

// Extract a top-level function by name (brace matching), mirroring the
// approach used by backend/tests/frontendServiceNavigation.test.js.
function extractFunction(src, name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'g');
  const match = re.exec(src);
  if (!match) throw new Error('function not found: ' + name);
  const start = match.index;
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('unterminated function: ' + name);
}

function elementStub() {
  const attrs = {};
  return {
    value: '', textContent: '', disabled: false, type: '',
    style: {}, dataset: {},
    _focused: false, _listeners: {},
    hasAttribute: (k) => Object.prototype.hasOwnProperty.call(attrs, k),
    setAttribute: (k, v) => { attrs[k] = String(v); },
    removeAttribute: (k) => { delete attrs[k]; },
    getAttribute: (k) => (Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null),
    focus: function () { this._focused = true; },
    addEventListener: function (t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    click: function () { (this._listeners.click || []).forEach((fn) => fn()); }
  };
}

// ---------------------------------------------------------------------------
// 1. Visitor browsing untouched
// ---------------------------------------------------------------------------
check('homepage has no auto-open login behavior', () => {
  // The drawer opens only inside an explicit click handler; nothing invokes it
  // during page boot.
  const opens = (PLATFORM_JS.match(/openAuthDrawer\(\)/g) || []).length;
  assert(opens >= 1, 'openAuthDrawer wiring missing');
  assert(!/openAuthDrawer\(\);\s*\n?\s*initAuthDrawer/.test(PLATFORM_JS), 'drawer must not open during init');
  assert(!/autofocus/.test(PLATFORM_HTML), 'no autofocus that would steal the visitor context');
});

check('drawer markup starts hidden and never covers the page by default', () => {
  assert(PLATFORM_HTML.includes('id="platformAuthOverlay" class="auth-drawer-overlay" hidden'), 'overlay markup missing');
  assert(PLATFORM_HTML.includes('aria-labelledby="platformAuthTitle" hidden'), 'drawer markup missing');
  assert(PLATFORM_HTML.includes('id="platformLoginBtn"'), 'header login button missing');
});

// ---------------------------------------------------------------------------
// 2. Markup contract
// ---------------------------------------------------------------------------
check('login form has identity, password with toggle, error and logout controls', () => {
  assert(PLATFORM_HTML.includes('id="platformAuthUser"'), 'username input missing');
  assert(PLATFORM_HTML.includes('id="platformAuthPass"'), 'password input missing');
  assert(PLATFORM_HTML.includes('type="password" id="platformAuthPass"'), 'password field must mask input');
  assert(PLATFORM_HTML.includes('id="platformAuthShowPass"'), 'show/hide toggle missing');
  assert(PLATFORM_HTML.includes('id="platformAuthError"') && PLATFORM_HTML.includes('role="alert"'), 'assertive error region missing');
  assert(PLATFORM_HTML.includes('id="platformAuthLogout"'), 'logout control missing');
});

check('message region lives outside the session-hidden login form', () => {
  // refreshAuthDrawer hides the ENTIRE form whenever a session exists; the
  // error/message region must survive that so link step-up errors, ?glink=1
  // success and the post-login guidance all render for a signed-in master.
  const formStart = PLATFORM_HTML.indexOf('<form id="platformAuthForm"');
  const formClose = PLATFORM_HTML.indexOf('</form>', formStart);
  const err = PLATFORM_HTML.indexOf('id="platformAuthError"');
  assert(formStart !== -1 && formClose !== -1, 'login form landmarks missing');
  assert(err > formClose, 'platformAuthError must sit outside (after) the login form');
  assert(err < PLATFORM_HTML.indexOf('id="platformAuthGoogleLinkSection"'), 'message region must precede the link section');
});

check('state_invalid guidance advises one retry without parallel Google windows', () => {
  // The OAuth binding-mismatch path (?gerr=state_invalid) is a retryable
  // race: a second simultaneous Google initiate overwrites the binding
  // cookie. The homepage message must steer the master to a single retry.
  const m = PLATFORM_JS.match(/state_invalid:\s*'([^']+)'/);
  assert(m, 'state_invalid message missing from platform.js gerr map');
  assert(m[1].indexOf('أعد المحاولة') !== -1, 'state_invalid must still advise retrying');
  assert(m[1].indexOf('مرة واحدة') !== -1, 'state_invalid must advise exactly one retry');
  assert(/نوافذ|نافذة/.test(m[1]), 'state_invalid must warn against parallel Google windows');
});

check('no default credentials or secrets in shipped files', () => {
  for (const [name, src] of [['platform.html', PLATFORM_HTML], ['platform.js', PLATFORM_JS]]) {
    assert(!/admin123|password123|let\s+\w*[Pp]assword\s*=\s*['"]/.test(src), name + ' contains a hardcoded credential');
    assert(!/sk_live|sk_test|BEGIN [A-Z ]*PRIVATE KEY/.test(src), name + ' contains a secret-like value');
  }
});

check('auth endpoints referenced are the real backend contracts', () => {
  assert(PLATFORM_JS.includes("const AUTH_API = '/api/v1/auth'"), 'auth API base missing');
  assert(PLATFORM_JS.includes("const PLATFORM_API = '/api/v1/platform'"), 'platform API base missing');
  assert(PLATFORM_JS.includes("AUTH_API + '/login'"), 'login call missing');
  assert(PLATFORM_JS.includes("PLATFORM_API + '/me'"), 'platform role probe missing');
  assert(PLATFORM_JS.includes("AUTH_API + '/logout'"), 'logout call missing');
});

check('session handoff reuses the ERP app session key, byte-identical', () => {
  assert(PLATFORM_JS.includes("const SESSION_USER_KEY = 'cairo_session_user';"), 'handoff key missing');
  assert(INDEX_HTML.includes("const SESSION_USER_KEY = 'cairo_session_user';"), 'ERP session key drifted');
});

check('redirect target is a constant internal page, never caller input', () => {
  assert(PLATFORM_JS.includes("const POST_LOGIN_PAGE = 'platform-master'"), 'redirect constant missing');
  const assigns = (PLATFORM_JS.match(/window\.location\.href\s*=\s*([^\n;]+)/g) || []);
  assert(assigns.length >= 1, 'no navigation assignment found');
  for (const a of assigns) {
    assert(/target\.href/.test(a), 'navigation must use the resolved constant target, found: ' + a);
  }
  assert(!/location\.search|location\.hash|getQueryParam|URLSearchParams/.test(
    PLATFORM_JS.slice(PLATFORM_JS.indexOf('resolvePostLoginTarget'))),
    'redirect logic must not read URLs or query strings');
});

// ---------------------------------------------------------------------------
// 3. i18n coverage for every new string
// ---------------------------------------------------------------------------
check('every new drawer string exists in both language tables', () => {
  for (const key of ['nav_login', 'nav_logout', 'auth_title', 'auth_sub', 'auth_user',
    'auth_pass', 'auth_submit', 'auth_logout', 'auth_error_invalid',
    'auth_error_denied', 'auth_error_network']) {
    assert(new RegExp(key + ":\\s*'[^']+'").test(PLATFORM_JS), 'key missing: ' + key);
  }
  const enBlock = PLATFORM_JS.slice(PLATFORM_JS.indexOf('en: {'), PLATFORM_JS.indexOf('ar: {'));
  const arBlock = PLATFORM_JS.slice(PLATFORM_JS.indexOf('ar: {'));
  for (const key of ['nav_login', 'auth_title', 'auth_error_invalid']) {
    assert(enBlock.includes(key + ':'), 'en table missing ' + key);
    assert(arBlock.includes(key + ':'), 'ar table missing ' + key);
  }
});

// ---------------------------------------------------------------------------
// 4. Drawer behavior in a sandbox (stubbed DOM + fetch, real functions)
// ---------------------------------------------------------------------------
function authSandbox(responder) {
  const store = new Map();
  const session = new Map();
  const elements = {};
  const ids = ['platformLoginBtn', 'platformAuthOverlay', 'platformAuthDrawer',
    'platformAuthClose', 'platformAuthForm', 'platformAuthUser', 'platformAuthPass',
    'platformAuthShowPass', 'platformAuthError', 'platformAuthSubmit', 'platformAuthLogout',
    'platformAuthGoogleLinkSection', 'platformAuthLinkStepUp', 'platformAuthLinkPass'];
  for (const id of ids) elements[id] = elementStub();
  elements.platformAuthOverlay.setAttribute('hidden', '');
  elements.platformAuthDrawer.setAttribute('hidden', '');
  elements.platformAuthLogout.setAttribute('hidden', '');
  const listeners = {};
  const context = {
    console,
    document: {
      getElementById: (id) => elements[id] || null,
      addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
      querySelectorAll: () => []
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    },
    sessionStorage: {
      getItem: (k) => (session.has(k) ? session.get(k) : null),
      setItem: (k, v) => session.set(k, String(v)),
      removeItem: (k) => session.delete(k)
    },
    window: { location: { href: '' } },
    fetch: responder,
    getLang: () => 'en',
    TRANSLATIONS: { en: {
      nav_login: 'Sign in', nav_logout: 'Sign out', auth_submit: 'Sign in',
      auth_error_invalid: 'Bad.', auth_error_denied: 'Denied.', auth_error_network: 'Net.'
    } }
  };
  context.globalThis = context;
  context.window = context.window;
  vm.createContext(context);
  const consts = [
    "const AUTH_API = '/api/v1/auth';",
    "const PLATFORM_API = '/api/v1/platform';",
    "const TOKEN_KEY = 'access_token';",
    "const REFRESH_KEY = 'refresh_token';",
    "const SESSION_USER_KEY = 'cairo_session_user';",
    "const POST_LOGIN_PAGE = 'platform-master';",
    "const POST_LOGIN_KEY = '__omniPostLoginPage';"
  ].join('\n');
  const fns = ['authText', 'authTokens', 'storeAuthTokens', 'clearAuthTokens',
    'resolvePostLoginTarget', 'authError', 'setAuthLoading', 'refreshAuthDrawer',
    'openAuthDrawer', 'closeAuthDrawer', 'submitAuthDrawer', 'logoutPlatform',
    'initAuthDrawer'].map((n) => extractFunction(PLATFORM_JS, n)).join('\n');
  vm.runInContext(consts + '\n' + fns + '\ninitAuthDrawer();', context, { filename: 'platform-auth-sandbox.js' });
  return { context, elements, store, session, listeners };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

check('open/close toggles visibility and manages focus', () => {
  const { elements } = authSandbox(async () => { throw new Error('no fetch expected'); });
  elements.platformLoginBtn.click();
  assert(!elements.platformAuthDrawer.hasAttribute('hidden'), 'drawer did not open');
  assert(!elements.platformAuthOverlay.hasAttribute('hidden'), 'overlay did not open');
  assert(elements.platformAuthUser._focused === true, 'first field not focused');
  elements.platformAuthClose.click();
  assert(elements.platformAuthDrawer.hasAttribute('hidden'), 'drawer did not close');
  assert(elements.platformLoginBtn._focused === true, 'focus did not return to the button');
});

check('escape closes an open drawer', async () => {
  const { elements, listeners } = authSandbox(async () => { throw new Error('no fetch expected'); });
  elements.platformLoginBtn.click();
  assert(!elements.platformAuthDrawer.hasAttribute('hidden'), 'drawer did not open');
  for (const fn of listeners.keydown || []) fn({ key: 'Escape' });
  assert(elements.platformAuthDrawer.hasAttribute('hidden'), 'escape did not close the drawer');
});

check('successful master login stores tokens, records the redirect key, and STAYS for linking', async () => {
  const calls = [];
  const sb = authSandbox(async (url, opts) => {
    calls.push(url);
    if (String(url).endsWith('/auth/login')) {
      return jsonResponse(200, { success: true, data: { user: { username: 'master' }, accessToken: 'AT', refreshToken: 'RT' } });
    }
    if (String(url).endsWith('/platform/me')) {
      return jsonResponse(200, { success: true, data: { username: 'master', platformRole: 'MASTER_OWNER' } });
    }
    throw new Error('unexpected fetch: ' + url);
  });
  // Mirror the shipped markup: the link section starts hidden and is
  // revealed only by refreshAuthDrawer once the session exists.
  sb.elements.platformAuthGoogleLinkSection.setAttribute('hidden', '');
  sb.elements.platformAuthUser.value = 'master';
  sb.elements.platformAuthPass.value = 'secret-password';
  await sb.context.submitAuthDrawer({ preventDefault: () => {} });
  assert(sb.store.get('access_token') === 'AT', 'access token not stored');
  assert(sb.store.get('refresh_token') === 'RT', 'refresh token not stored');
  assert(sb.store.get('cairo_session_user') === 'master', 'session username not stored for app handoff');
  assert(sb.session.get('__omniPostLoginPage') === 'platform-master', 'redirect key not recorded');
  assert(sb.context.window.location.href === '', 'master login must NOT navigate away — the homepage drawer hosts the Google link flow');
  assert(!sb.elements.platformAuthGoogleLinkSection.hasAttribute('hidden'), 'session-gated link section must be revealed for the signed-in master');
  assert(sb.elements.platformAuthError.textContent.indexOf('ربط حساب Google') !== -1, 'post-login guidance message missing');
  assert(calls[0].endsWith('/auth/login'), 'login endpoint not called first');
});

check('login fetch carries same-origin credentials so the httpOnly session cookie is stored', async () => {
  let loginOpts = null;
  const sb = authSandbox(async (url, opts) => {
    if (String(url).endsWith('/auth/login')) {
      loginOpts = opts;
      return jsonResponse(200, { success: true, data: { user: { username: 'master' }, accessToken: 'AT', refreshToken: 'RT' } });
    }
    if (String(url).endsWith('/platform/me')) {
      return jsonResponse(200, { success: true, data: { username: 'master', platformRole: 'MASTER_OWNER' } });
    }
    throw new Error('unexpected fetch: ' + url);
  });
  sb.elements.platformAuthUser.value = 'master';
  sb.elements.platformAuthPass.value = 'secret-password';
  await sb.context.submitAuthDrawer({ preventDefault: () => {} });
  assert(loginOpts && loginOpts.credentials === 'same-origin', 'login fetch does not carry same-origin credentials (session cookie would be discarded by the browser)');
});

check('tenant login navigates without a master redirect key', async () => {
  const sb = authSandbox(async (url) => {
    if (String(url).endsWith('/auth/login')) {
      return jsonResponse(200, { success: true, data: { user: { username: 'owner' }, accessToken: 'AT', refreshToken: 'RT' } });
    }
    return jsonResponse(404, { success: false });
  });
  sb.elements.platformAuthUser.value = 'owner';
  sb.elements.platformAuthPass.value = 'secret-password';
  await sb.context.submitAuthDrawer({ preventDefault: () => {} });
  assert(sb.store.get('access_token') === 'AT', 'access token not stored');
  assert(!sb.session.has('__omniPostLoginPage'), 'tenant login must not record a master redirect');
  assert(sb.context.window.location.href === 'index.html', 'tenant did not land on the app entry');
});

check('bad credentials show a safe error and store nothing', async () => {
  const sb = authSandbox(async () => jsonResponse(401, { success: false, message: 'Invalid username or password' }));
  sb.elements.platformAuthUser.value = 'nobody';
  sb.elements.platformAuthPass.value = 'wrong-password';
  await sb.context.submitAuthDrawer({ preventDefault: () => {} });
  assert(!sb.store.has('access_token'), 'token stored after failed login');
  assert(sb.context.window.location.href === '', 'navigation happened after failed login');
  assert(sb.elements.platformAuthError.textContent.length > 0, 'no visible error');
  assert(!/Invalid username or password/.test(sb.elements.platformAuthError.textContent), 'raw backend wording leaked');
});

check('membership denial maps to the access message, not the credential one', async () => {
  const sb = authSandbox(async () => jsonResponse(403, { success: false, message: 'denied' }));
  sb.elements.platformAuthUser.value = 'owner';
  sb.elements.platformAuthPass.value = 'secret-password';
  await sb.context.submitAuthDrawer({ preventDefault: () => {} });
  assert(sb.elements.platformAuthError.textContent === 'Denied.', 'wrong message for 403');
  assert(!sb.store.has('access_token'), 'token stored after denied login');
});

check('network failure shows the network message without navigation', async () => {
  const sb = authSandbox(async () => { throw new Error('boom'); });
  sb.elements.platformAuthUser.value = 'owner';
  sb.elements.platformAuthPass.value = 'secret-password';
  await sb.context.submitAuthDrawer({ preventDefault: () => {} });
  assert(sb.elements.platformAuthError.textContent === 'Net.', 'wrong message for network failure');
  assert(sb.context.window.location.href === '', 'navigation happened after network failure');
});

check('logout calls the backend then clears every credential', async () => {
  const calls = [];
  const sb = authSandbox(async (url) => { calls.push(String(url)); return jsonResponse(200, { success: true }); });
  sb.store.set('access_token', 'AT');
  sb.store.set('refresh_token', 'RT');
  sb.store.set('cairo_session_user', 'master');
  await sb.context.logoutPlatform();
  assert(calls.some((u) => u.endsWith('/auth/logout')), 'backend logout not called');
  assert(!sb.store.has('access_token') && !sb.store.has('refresh_token'), 'tokens survived logout');
  assert(!sb.store.has('cairo_session_user'), 'session username survived logout');
});

// ---------------------------------------------------------------------------
// 5. index.html redirect consumer
// ---------------------------------------------------------------------------
check('redirect key honoured only for an allowed internal page', () => {
  const src = extractFunction(INDEX_HTML, 'consumePostLoginRedirect');
  const shown = [];
  const store = new Map([['__omniPostLoginPage', 'platform-master']]);
  const context = {
    console,
    sessionStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    },
    canAccessPage: () => true,
    showPage: (p) => shown.push(p)
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(src + '\nconsumePostLoginRedirect();', context);
  assert(shown.join(',') === 'platform-master', 'allowed redirect not honoured');
  assert(!store.has('__omniPostLoginPage'), 'one-shot key not cleared');
});

check('redirect key ignored for foreign values and denied pages', () => {
  const src = extractFunction(INDEX_HTML, 'consumePostLoginRedirect');
  for (const [stored, gate] of [['https://evil.example/', true], ['platform-master', false]]) {
    const shown = [];
    const store = new Map([['__omniPostLoginPage', stored]]);
    const context = {
      console,
      sessionStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k)
      },
      canAccessPage: () => gate,
      showPage: (p) => shown.push(p)
    };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(src + '\nconsumePostLoginRedirect();', context);
    assert(shown.length === 0, 'unsafe redirect honoured for ' + stored);
    assert(!store.has('__omniPostLoginPage'), 'key not cleared for ' + stored);
  }
});

check('redirect consumer is hooked into both login refresh chains', () => {
  const hits = (INDEX_HTML.match(/rebuildNavigation\(\); consumePostLoginRedirect\(\);/g) || []).length;
  assert(hits === 2, 'expected both login chains to consume the redirect, found ' + hits);
});

check('logout still clears the platform role and hides Master UI', () => {
  const src = extractFunction(INDEX_HTML, 'doLogout');
  assert(/platformRole\s*=\s*null/.test(src), 'platform role not cleared on logout');
  assert(/platformMasterNav/.test(src), 'Master nav not hidden on logout');
  assert(/localStorage\.removeItem\('access_token'\)/.test(src), 'access token not cleared on logout');
});

// ---------------------------------------------------------------------------
// 6. Existing visitor + lockdown invariants
// ---------------------------------------------------------------------------
check('drawer adds no navigation links that could disturb lockdown counts', () => {
  const drawer = PLATFORM_HTML.slice(PLATFORM_HTML.indexOf('id="platformAuthOverlay"'));
  assert(!/<a[\s>]/.test(drawer), 'drawer must not introduce navigation links');
});

setTimeout(() => {
  console.log('\ncompact-login.test.cjs: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
}, 500);
