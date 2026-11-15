'use strict';

// Universal Google Login UI regression suite (P6.71).
//
// Drives the shipped platform/google-login.js flow core with a stubbed
// fetch. NO real Google request is made, so nothing here is a Google
// integration test: it pins THIS FILE's behaviour against the documented
// backend contract. The server-side truth (token verification, membership
// isolation, challenge burning, rate limits) is pinned by
// backend/tests/googleLogin.test.js and
// backend/tests/googleLoginChallenge.integration.test.js.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const MODULE_SRC = fs.readFileSync(path.join(ROOT, 'platform', 'google-login.js'), 'utf8');
const PLATFORM_HTML = fs.readFileSync(path.join(ROOT, 'platform.html'), 'utf8');
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

function loadModule() {
  const sandbox = { console, Promise, JSON, Object, Array, String, Boolean, Error, setTimeout };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(MODULE_SRC, sandbox, { filename: 'google-login.js' });
  return sandbox.OmniGoogleLogin;
}

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
function okLogin(data) {
  return response(200, { success: true, data });
}
function makeFetch(script) {
  const calls = [];
  function fetch(url, init) {
    calls.push({ url, method: init && init.method, body: init && init.body ? JSON.parse(init.body) : null });
    const next = script.shift();
    if (!next) return Promise.reject(new Error('unexpected request: ' + url));
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  }
  return { fetch, calls };
}
function makeFlow(script) {
  const mod = loadModule();
  const transport = makeFetch(script);
  const events = { sessions: [], challenges: [], errors: [] };
  const flow = mod.createFlow({
    fetch: transport.fetch,
    onSession: (d) => events.sessions.push(d),
    onChallenge: (c) => events.challenges.push(c),
    onError: (e) => events.errors.push(e)
  });
  return { mod, flow, calls: transport.calls, events };
}

// ---------------------------------------------------------------------------
// 1. Shipped markup wiring
// ---------------------------------------------------------------------------
check('login drawer ships the Google section, MFA and tenant containers', () => {
  assert(PLATFORM_HTML.includes('id="platformGoogleLoginSection" hidden'), 'Google section must start hidden');
  assert(PLATFORM_HTML.includes('id="platformGoogleLoginButton"'), 'Google Identity Services host missing');
  assert(PLATFORM_HTML.includes('id="platformGoogleMfa" hidden'), 'MFA block must start hidden');
  assert(PLATFORM_HTML.includes('id="platformGoogleMfaCode"'), 'MFA input missing');
  assert(PLATFORM_HTML.includes('id="platformGoogleTenantList"'), 'tenant list missing');
  const flowIdx = PLATFORM_HTML.indexOf('platform/google-login.js');
  const jsIdx = PLATFORM_HTML.indexOf('platform/platform.js');
  assert(flowIdx > 0 && flowIdx < jsIdx, 'google-login.js must load before platform.js');
  assert(PLATFORM_HTML.includes('id="platformAuthGoogle"'), 'Master Google entry must stay');
});

check('module holds no credentials, no browser storage and no logging', () => {
  assert(!/client_secret|CLIENT_SECRET/i.test(MODULE_SRC), 'client secret must never appear client-side');
  assert(!/(localStorage|sessionStorage)s*[.[]/.test(MODULE_SRC), 'no credential/challenge storage');
  assert(!/document.cookie/.test(MODULE_SRC), 'no cookie access');
  assert(!/console\.(log|info|warn|error)/.test(MODULE_SRC), 'no token logging');
});

// ---------------------------------------------------------------------------
// 2. Primary authentication
// ---------------------------------------------------------------------------
check('the Google ID token is posted to /api/v1/auth/google-login', async () => {
  const { flow, calls } = makeFlow([okLogin({ user: { username: 'u1' }, accessToken: 'a', refreshToken: 'r' })]);
  const out = await flow.loginWithIdToken('id-token-value');
  assert(out.ok && out.step === 'session', 'server tokens must complete the flow');
  assert(calls.length === 1, 'exactly one request');
  assert(calls[0].url === '/api/v1/auth/google-login', 'wrong URL: ' + calls[0].url);
  assert(calls[0].method === 'POST', 'must POST');
  assert(calls[0].body.idToken === 'id-token-value', 'idToken field name must match the backend');
});

check('an unlinked Google identity (401) yields no session', async () => {
  const { flow, events } = makeFlow([response(401, { success: false, message: 'Invalid Google token' })]);
  const out = await flow.loginWithIdToken('x');
  assert(!out.ok && out.error === 'invalid_identity', 'must map to invalid_identity');
  assert(events.sessions.length === 0, 'no session on rejection');
  assert(events.errors[0] === 'invalid_identity');
});

check('SDK success alone never authenticates', async () => {
  const { flow, events } = makeFlow([okLogin({ mfaRequired: true, tempToken: 'temp-sdk' })]);
  const out = await flow.loginWithIdToken('credential-from-sdk');
  assert(out.ok && out.step === 'mfa', 'the server decides the next step');
  assert(events.sessions.length === 0, 'no session before the backend issues tokens');
});

// ---------------------------------------------------------------------------
// 3. MFA
// ---------------------------------------------------------------------------
check('mfaRequired reveals the MFA step and mints no session', async () => {
  const { flow, events } = makeFlow([okLogin({ mfaRequired: true, tempToken: 'temp-1', userId: 7 })]);
  const out = await flow.loginWithIdToken('x');
  assert(out.ok && out.step === 'mfa');
  assert(events.sessions.length === 0, 'MFA challenge is not a login');
  assert(events.challenges[0].type === 'mfa', 'mfa challenge must be reported');
  assert(flow.snapshot().pendingChallenge === true, 'challenge must be held in memory');
});

check('a rejected MFA code is surfaced and the challenge is discarded', async () => {
  const { flow, events, calls } = makeFlow([
    okLogin({ mfaRequired: true, tempToken: 'temp-1' }),
    response(401, { success: false, message: 'Invalid MFA code' })
  ]);
  await flow.loginWithIdToken('x');
  const out = await flow.submitMfa('000000');
  assert(!out.ok && out.error === 'mfa_invalid', 'must map to mfa_invalid');
  assert(calls[1].url === '/api/v1/auth/google-login/mfa-verify', 'wrong MFA URL');
  assert(calls[1].body.tempToken === 'temp-1' && calls[1].body.mfaToken === '000000', 'MFA body must match the contract');
  assert(flow.snapshot().pendingChallenge === false, 'a burned challenge must not be reusable');
  assert(events.sessions.length === 0);
});

check('a valid MFA code completes the session', async () => {
  const { flow, events } = makeFlow([
    okLogin({ mfaRequired: true, tempToken: 'temp-2' }),
    okLogin({ user: { username: 'u' }, accessToken: 'acc', refreshToken: 'ref' })
  ]);
  await flow.loginWithIdToken('x');
  const out = await flow.submitMfa('123456');
  assert(out.ok && out.step === 'session');
  assert(events.sessions.length === 1 && events.sessions[0].accessToken === 'acc');
});

// ---------------------------------------------------------------------------
// 4. Tenant selection
// ---------------------------------------------------------------------------
check('tenantSelectionRequired exposes only the tenants the server returned', async () => {
  const { flow, events } = makeFlow([okLogin({
    tenantSelectionRequired: true,
    tempToken: 'temp-3',
    availableTenants: [{ id: 't1', name: 'Alpha' }, { id: 2, name: 'Beta' }]
  })]);
  const out = await flow.loginWithIdToken('x');
  assert(out.ok && out.step === 'tenant');
  const challenge = events.challenges[0];
  assert(challenge.type === 'tenant', 'tenant challenge must be reported');
  assert(challenge.tenants.length === 2, 'exactly the server list');
  assert(challenge.tenants[0].id === 't1' && challenge.tenants[0].name === 'Alpha');
  assert(challenge.tenants[1].id === '2', 'ids are normalized to strings, not invented');
  assert(events.sessions.length === 0, 'selection is not a session');
});

check('an authorized tenant is submitted with its server id', async () => {
  const { flow, calls } = makeFlow([
    okLogin({ tenantSelectionRequired: true, tempToken: 'temp-4', availableTenants: [{ id: 't1', name: 'A' }] }),
    okLogin({ user: { username: 'u' }, accessToken: 'a', refreshToken: 'r' })
  ]);
  await flow.loginWithIdToken('x');
  const out = await flow.selectTenant('t1');
  assert(out.ok && out.step === 'session');
  assert(calls[1].url === '/api/v1/auth/google-login/select-tenant', 'wrong tenant URL');
  assert(calls[1].body.tenantId === 't1' && calls[1].body.tempToken === 'temp-4', 'tenant body must match the contract');
});

check('a tenant outside the server list never reaches the network', async () => {
  const { flow, calls, events } = makeFlow([
    okLogin({ tenantSelectionRequired: true, tempToken: 'temp-5', availableTenants: [{ id: 't1', name: 'A' }] })
  ]);
  await flow.loginWithIdToken('x');
  const out = await flow.selectTenant('t9');
  assert(!out.ok && out.error === 'tenant_not_allowed', 'unauthorized id must be refused locally');
  assert(calls.length === 1, 'no selection request may be sent');
  assert(events.sessions.length === 0);
});

check('a server-rejected tenant selection (403) yields no session', async () => {
  const { flow, events } = makeFlow([
    okLogin({ tenantSelectionRequired: true, tempToken: 'temp-6', availableTenants: [{ id: 't1', name: 'A' }] }),
    response(403, { success: false, message: 'Unauthorized tenant selection' })
  ]);
  await flow.loginWithIdToken('x');
  const out = await flow.selectTenant('t1');
  assert(!out.ok && out.error === 'tenant_denied');
  assert(events.sessions.length === 0);
});

check('tenant selection may itself require MFA and then complete', async () => {
  const { flow, events } = makeFlow([
    okLogin({ tenantSelectionRequired: true, tempToken: 'temp-7', availableTenants: [{ id: 't1', name: 'A' }] }),
    okLogin({ mfaRequired: true, tempToken: 'temp-8' }),
    okLogin({ user: { username: 'u' }, accessToken: 'acc2', refreshToken: 'ref2' })
  ]);
  await flow.loginWithIdToken('x');
  const step2 = await flow.selectTenant('t1');
  assert(step2.ok && step2.step === 'mfa', 'tenant choice can hand off to MFA');
  const final = await flow.submitMfa('654321');
  assert(final.ok && final.step === 'session');
  assert(events.sessions[0].accessToken === 'acc2');
});

// ---------------------------------------------------------------------------
// 5. Failure mapping
// ---------------------------------------------------------------------------
check('401/403/429/503 are mapped and never reported as success', async () => {
  const cases = [
    [401, {}, 'invalid_identity'],
    [403, { code: 'ACCOUNT_DISABLED' }, 'account_disabled'],
    [403, { code: 'COMPANY_SUSPENDED' }, 'company_suspended'],
    [403, { code: 'TENANT_MEMBERSHIP_REQUIRED' }, 'membership_required'],
    [403, {}, 'denied'],
    [429, {}, 'rate_limited'],
    [503, {}, 'unavailable'],
    [500, {}, 'server_error']
  ];
  for (const [status, extra, expected] of cases) {
    const { flow, events } = makeFlow([response(status, Object.assign({ success: false }, extra))]);
    const out = await flow.loginWithIdToken('x');
    assert(!out.ok, status + ' must not succeed');
    assert(out.error === expected, status + ' -> ' + out.error + ' (want ' + expected + ')');
    assert(events.sessions.length === 0, status + ' must not mint a session');
  }
});

check('a network failure never produces a session', async () => {
  const { flow, events } = makeFlow([new Error('offline')]);
  const out = await flow.loginWithIdToken('x');
  assert(!out.ok && out.error === 'network_error');
  assert(events.sessions.length === 0);
});

check('a challenge cannot be reused after it is spent', async () => {
  const { flow, calls } = makeFlow([
    okLogin({ mfaRequired: true, tempToken: 'temp-9' }),
    okLogin({ user: {}, accessToken: 'a', refreshToken: 'r' })
  ]);
  await flow.loginWithIdToken('x');
  const first = await flow.submitMfa('111111');
  assert(first.ok, 'first use succeeds');
  const replay = await flow.submitMfa('111111');
  assert(!replay.ok && replay.error === 'challenge_missing', 'second use must be refused locally');
  assert(calls.length === 2, 'replay must not reach the network');
});

// ---------------------------------------------------------------------------
// 6. UI safety
// ---------------------------------------------------------------------------
check('overlapping submissions are refused while a request is in flight', async () => {
  const { flow, calls } = makeFlow([okLogin({ user: {}, accessToken: 'a', refreshToken: 'r' })]);
  const first = flow.loginWithIdToken('x');
  const second = await flow.loginWithIdToken('x');
  assert(!second.ok && second.error === 'busy', 'second click must be refused');
  await first;
  assert(calls.length === 1, 'only one request may leave the browser');
});

check('an unconfigured backend keeps the Google section hidden', async () => {
  const mod = loadModule();
  const disabled = makeFetch([response(200, { success: true, data: { enabled: false, clientId: '' } })]);
  const cfg = await mod.loadConfig({ fetch: disabled.fetch });
  assert(cfg.enabled === false && cfg.clientId === '', 'disabled config must not enable the button');
  const offline = makeFetch([new Error('offline')]);
  const cfg2 = await mod.loadConfig({ fetch: offline.fetch });
  assert(cfg2.enabled === false, 'an unreachable config must fail closed');
});

check('password login path is unchanged', () => {
  assert(PLATFORM_JS.includes("AUTH_API + '/login'"), 'password submit must keep hitting /auth/login');
  assert(PLATFORM_JS.includes('JSON.stringify({ username, password })'), 'password body unchanged');
  assert(PLATFORM_HTML.includes('id="platformAuthForm"'), 'password form intact');
  assert(PLATFORM_HTML.includes('id="platformAuthUser"') && PLATFORM_HTML.includes('id="platformAuthPass"'), 'password fields intact');
});

check('Master sign-in remains a separate OIDC path', () => {
  assert(PLATFORM_JS.includes("/auth/google/master?returnTo="), 'master entry unchanged');
  assert(!/auth\/google\/master/.test(MODULE_SRC), 'universal flow must not touch master routes');
  assert(PLATFORM_JS.includes("id + '/google-login/config'") === false, 'config URL lives in the module only');
});
