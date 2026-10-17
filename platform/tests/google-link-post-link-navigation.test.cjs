'use strict';

// Post-link navigation regression suite (Phase: master-post-link-redirect).
//
// P0 defect: after a completed Google LINK round-trip (?glink=1) the homepage
// drawer showed the success message and STAYED, leaving an already
// authenticated Master stranded on the login modal with no way into the
// Master Control Center.
//
// This suite pins the fix: a completed LINK is still NOT a login (no session
// is minted), but when the authenticated session that started the round-trip
// is still present the handler hands the Master off to the verified Control
// Center using the SAME server-authoritative role probe and constant internal
// target as a password drawer login. Without a session, or when the probe
// fails, the success message stays visible and nothing navigates.
//
// Static assertions pin the shipped bytes; the vm sandbox drives the REAL
// functions (handlePlatformGoogleSigninResult + handoffAfterGoogleLink) over a
// stubbed DOM/fetch, mirroring compact-login.test.cjs.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const PLATFORM_JS = fs.readFileSync(path.join(ROOT, 'platform', 'platform.js'), 'utf8');

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

const EXTRACT = [
  'authTokens', 'resolvePostLoginTarget',
  'handlePlatformGoogleSigninResult', 'handoffAfterGoogleLink'
];

// ---------------------------------------------------------------------------
// 1. Static contract: the LINK branch delegates to a session-gated handoff
// ---------------------------------------------------------------------------
check('completed link branch hands off after surfacing success', () => {
  const handler = extractFunction(PLATFORM_JS, 'handlePlatformGoogleSigninResult');
  assert(handler.includes("query.indexOf('glink=1') !== -1"), 'glink branch missing');
  assert(handler.includes('handoffAfterGoogleLink();'), 'glink success must invoke the handoff');
  // The original success contract must survive the change.
  assert(handler.includes('تم ربط حساب Google بهذا الحساب بنجاح'), 'link success message missing');
  assert(handler.includes("stepAfter.setAttribute('hidden', '')"), 'step-up must still hide on success');
  assert(handler.includes("passAfter.value = ''"), 'password field must still clear on success');
});

check('handoff is session-gated and never mints a session', () => {
  const fn = extractFunction(PLATFORM_JS, 'handoffAfterGoogleLink');
  assert(fn.includes('authTokens()'), 'handoff must read the existing session');
  assert(fn.includes('if (!access) return'), 'handoff must bail without a session');
  assert(!/storeAuthTokens|localStorage\.setItem|setItem\(TOKEN_KEY/.test(fn), 'handoff must never store/mint a session');
});

check('handoff resolves the role server-authoritatively and uses the constant target', () => {
  const fn = extractFunction(PLATFORM_JS, 'handoffAfterGoogleLink');
  assert(fn.includes("PLATFORM_API + '/me'"), 'handoff must probe the server-side role endpoint');
  assert(fn.includes("Authorization: 'Bearer ' + access"), 'probe must carry the existing Bearer session');
  assert(fn.includes('resolvePostLoginTarget(platformRole)'), 'target must come from resolvePostLoginTarget');
  assert(fn.includes('sessionStorage.setItem(POST_LOGIN_KEY, target.postLoginPage)'), 'one-shot key must be recorded for a platform role');
  assert(fn.includes('window.location.href = target.href'), 'navigation must use the resolved constant target');
  assert(/\.catch\(function \(\)/.test(fn), 'a probe failure must be handled (fail closed, no navigation)');
});

check('the only external navigation assignments remain constant-target', () => {
  const assigns = (PLATFORM_JS.match(/window\.location\.href\s*=\s*([^\n;]+)/g) || []);
  assert(assigns.length >= 1, 'no navigation assignment found');
  for (const a of assigns) {
    assert(/target\.href/.test(a), 'navigation must use the resolved constant target, found: ' + a);
  }
});

// ---------------------------------------------------------------------------
// 2. Behavioral contract over the REAL functions (stubbed DOM + fetch)
// ---------------------------------------------------------------------------
function harness(opts) {
  const storage = new Map();
  const session = new Map();
  if (opts.access) storage.set('access_token', opts.access);
  const elements = {};
  for (const id of ['platformAuthLinkStepUp', 'platformAuthLinkPass']) {
    elements[id] = {
      value: '', _attrs: {},
      setAttribute(k, v) { this._attrs[k] = String(v); },
      removeAttribute(k) { delete this._attrs[k]; },
      hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k); }
    };
  }
  const messages = [];
  const location = { href: opts.url, search: opts.search || '?glink=1' };
  const context = {
    console,
    document: { title: 'OmniStore', getElementById: (id) => elements[id] || null },
    window: { location, history: { replaceState: () => {} } },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k)
    },
    sessionStorage: {
      getItem: (k) => (session.has(k) ? session.get(k) : null),
      setItem: (k, v) => session.set(k, String(v)),
      removeItem: (k) => session.delete(k)
    },
    URL,
    fetch: opts.fetch,
    authError: (msg) => { messages.push(msg || ''); },
    openAuthDrawer: () => {}
  };
  context.globalThis = context;
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
  const fns = EXTRACT.map((n) => extractFunction(PLATFORM_JS, n)).join('\n');
  vm.runInContext(consts + '\n' + fns + '\nhandlePlatformGoogleSigninResult();', context, { filename: 'platform-post-link-sandbox.js' });
  return { context, location, session, elements, messages };
}

function jsonResponse(body) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body });
}

check('link success with a live master session lands on the Control Center', async () => {
  const h = harness({
    url: 'https://omnistoreerp.com/platform.html?glink=1',
    access: 'AT',
    fetch: () => jsonResponse({ success: true, data: { username: 'omnistore', platformRole: 'MASTER_OWNER' } })
  });
  await new Promise((r) => setTimeout(r, 20));
  assert(h.location.href === 'index.html', 'master must be handed off to index.html, got: ' + h.location.href);
  assert(h.session.get('__omniPostLoginPage') === 'platform-master', 'one-shot Control Center key not recorded');
  assert(h.elements.platformAuthLinkStepUp.hasAttribute('hidden'), 'step-up must be hidden on success');
  assert(h.elements.platformAuthLinkPass.value === '', 'password field must be cleared on success');
  assert(h.messages.some((m) => m.indexOf('تم ربط حساب Google بهذا الحساب بنجاح') !== -1), 'success message missing');
});

check('link success without a session stays put and only shows the message', async () => {
  const h = harness({
    url: 'https://omnistoreerp.com/platform.html?glink=1',
    access: '',
    fetch: () => { throw new Error('fetch must not run without a session'); }
  });
  await new Promise((r) => setTimeout(r, 20));
  assert(h.location.href === 'https://omnistoreerp.com/platform.html?glink=1', 'must not navigate without a session');
  assert(!h.session.has('__omniPostLoginPage'), 'no Control Center key without a session');
  assert(h.messages.some((m) => m.indexOf('تم ربط حساب Google بهذا الحساب بنجاح') !== -1), 'success message missing');
});

check('link success with a non-master session still reaches the app without a platform key', async () => {
  const h = harness({
    url: 'https://omnistoreerp.com/platform.html?glink=1',
    access: 'AT',
    fetch: () => jsonResponse({ success: true, data: { username: 'tenant', platformRole: null } })
  });
  await new Promise((r) => setTimeout(r, 20));
  assert(h.location.href === 'index.html', 'non-master must still reach the app entry');
  assert(!h.session.has('__omniPostLoginPage'), 'no platform key for a non-master session');
});

check('a failed role probe fails closed (no navigation)', async () => {
  const h = harness({
    url: 'https://omnistoreerp.com/platform.html?glink=1',
    access: 'AT',
    fetch: () => Promise.reject(new Error('network'))
  });
  await new Promise((r) => setTimeout(r, 20));
  assert(h.location.href === 'https://omnistoreerp.com/platform.html?glink=1', 'must not navigate when the probe fails');
  assert(!h.session.has('__omniPostLoginPage'), 'no key recorded on probe failure');
});

setTimeout(() => {
  console.log('\ngoogle-link-post-link-navigation.test.cjs: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
}, 500);
