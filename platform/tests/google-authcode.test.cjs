'use strict';

// Google Authorization Code frontend regression suite.
// Drives the shipped platform/google-authcode.js module with stubbed fetch and
// DOM. No real Google request is made. Backend truth is pinned by Jest tests.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const MODULE_SRC = fs.readFileSync(path.join(ROOT, 'platform', 'google-authcode.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const PLATFORM_HTML = fs.readFileSync(path.join(ROOT, 'platform.html'), 'utf8');
const PLATFORM_JS = fs.readFileSync(path.join(ROOT, 'platform', 'platform.js'), 'utf8');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === 'function') {
      return out.then(function () { passed += 1; console.log('PASS  ' + name); })
        .catch(function (err) { failed += 1; console.error('FAIL  ' + name + ' :: ' + (err && err.message)); process.exitCode = 1; });
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
function assert(cond, message) { if (!cond) throw new Error(message || 'assertion failed'); }

function response(status, data) {
  return { ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(data); } };
}

function loadModule(search) {
  const navigations = [];
  const posts = [];
  const elements = {};
  function makeEl(tag, id) {
    return {
      tagName: tag, id: id || '', children: [], handlers: {}, style: { cssText: '' },
      value: '', disabled: false, textContent: '', innerHTML: '',
      appendChild: function (child) {
        this.children.push(child);
        if (child && child.id) elements[child.id] = child;
        return child;
      },
      addEventListener: function (event, fn) { this.handlers[event] = fn; },
      setAttribute: function () {}, removeAttribute: function () {}, focus: function () {}
    };
  }
  const sandbox = {
    console: console, Promise: Promise, JSON: JSON, Object: Object, Array: Array,
    String: String, Boolean: Boolean, Error: Error, setTimeout: setTimeout,
    URL: URL, URLSearchParams: URLSearchParams,
    fetch: function (url, init) {
      const body = init && init.body ? JSON.parse(init.body) : null;
      posts.push({ url: url, method: init && init.method, body: body });
      return Promise.resolve(posts.shiftResponse || response(200, { success: true, data: {} }));
    },
    localStorage: { getItem: function () { return 'ar'; } },
    history: { replaceState: function () {} },
    document: {
      title: 't',
      getElementById: function (id) { return elements[id] || null; },
      createElement: function (tag) { return makeEl(tag, ''); },
      body: { appendChild: function (el) { elements[el.id] = el; } }
    }
  };
  sandbox.window = sandbox;
  sandbox.location = {
    href: 'http://localhost/platform.html' + (search || ''),
    search: search || '',
    pathname: '/platform.html',
    assign: function (url) { navigations.push(url); }
  };
  sandbox.fetch = function (url, init) {
    const body = init && init.body ? JSON.parse(init.body) : null;
    const call = { url: url, method: init && init.method, body: body };
    posts.push(call);
    const next = sandbox.__script.shift();
    if (!next) return Promise.reject(new Error('unexpected fetch: ' + url));
    return Promise.resolve(next);
  };
  vm.createContext(sandbox);
  vm.runInContext(MODULE_SRC, sandbox, { filename: 'google-authcode.js' });
  return { mod: sandbox.OmniGoogleAuthCode, sandbox: sandbox, posts: posts, navigations: navigations, elements: elements };
}

check('module exposes the browser contract', function () {
  const env = loadModule('');
  ['start', 'boot', 'challengeStatus', 'submitMfa', 'selectTenant'].forEach(function (key) {
    assert(typeof env.mod[key] === 'function', 'missing ' + key);
  });
});

check('start() uses the exact backend initiation route and encodes returnTo', function () {
  const env = loadModule('');
  env.mod.start('/dashboard?tab=users');
  assert(env.navigations.length === 1, 'no navigation');
  assert(env.navigations[0] === '/auth/google-login-code?returnTo=%2Fdashboard%3Ftab%3Dusers', env.navigations[0]);
});

check('no secret, ID token or challenge token is ever put in a URL', function () {
  const env = loadModule('');
  env.mod.start('/');
  const url = env.navigations[0];
  assert(!/client_secret|id_token|code_verifier|tempToken|access_token/i.test(url), url);
});

check('MFA marker loads read-only status and posts only the code', function () {
  const env = loadModule('?mfa_required=1');
  env.sandbox.__script = [
    response(200, { success: true, data: { purpose: 'google_mfa' } }),
    response(200, { success: true, data: { accessToken: 'a', refreshToken: 'r' } })
  ];
  return env.mod.boot().then(function () {
    assert(env.posts[0].url === '/api/v1/auth/google-login-code/challenge', env.posts[0].url);
    assert(env.posts[0].method === undefined, 'status must be GET');
    const input = env.elements['omniGoogleAuthCodeMfa'];
    const btn = env.elements['omniGoogleAuthCodeMfaSubmit'];
    assert(input && btn, 'MFA UI not rendered');
    input.value = '123456';
    return btn.handlers.click().then(function () {
      const mfaCall = env.posts[1];
      assert(mfaCall.url === '/api/v1/auth/google-login-code/mfa-verify', mfaCall.url);
      assert(mfaCall.method === 'POST', mfaCall.method);
      assert(mfaCall.body.mfaToken === '123456', JSON.stringify(mfaCall.body));
      assert(mfaCall.body.tempToken === undefined, 'token must come from the httpOnly cookie');
      assert(env.navigations.length === 1, 'session bootstrap navigation missing');
      assert(env.navigations[0].indexOf('gsignin=1') !== -1, env.navigations[0]);
      assert(env.navigations[0].indexOf('mfa_required') === -1, env.navigations[0]);
    });
  });
});

check('failed MFA never triggers session bootstrap', function () {
  const env = loadModule('?mfa_required=1');
  env.sandbox.__script = [
    response(200, { success: true, data: { purpose: 'google_mfa' } }),
    response(401, { success: false })
  ];
  return env.mod.boot().then(function () {
    const btn = env.elements['omniGoogleAuthCodeMfaSubmit'];
    env.elements['omniGoogleAuthCodeMfa'].value = '000000';
    return btn.handlers.click().then(function () {
      assert(env.navigations.length === 0, 'navigated after failure');
    });
  });
});

check('tenant marker renders server-owned choices and posts the selected tenant', function () {
  const env = loadModule('?tenant_selection_required=1');
  env.sandbox.__script = [
    response(200, { success: true, data: {
      purpose: 'google_tenant_selection',
      availableTenants: [{ id: 't1', name: 'One' }, { id: 't2', name: 'Two' }],
      allowedTenantIds: ['t1', 't2']
    } }),
    response(200, { success: true, data: { accessToken: 'a' } })
  ];
  return env.mod.boot().then(function () {
    const buttons = env.elements['omniGoogleAuthCodeTenants'].children;
    assert(buttons.length === 2, 'tenant buttons: ' + buttons.length);
    return buttons[1].handlers.click().then(function () {
      const call = env.posts[1];
      assert(call.url === '/api/v1/auth/google-login-code/select-tenant', call.url);
      assert(call.body.tenantId === 't2', JSON.stringify(call.body));
      assert(call.body.tempToken === undefined, 'token must come from cookie');
      assert(env.navigations.length === 1 && env.navigations[0].indexOf('gsignin=1') !== -1, 'no bootstrap');
    });
  });
});

check('tenant selection that requires MFA switches to the MFA prompt', function () {
  const env = loadModule('?tenant_selection_required=1');
  env.sandbox.__script = [
    response(200, { success: true, data: {
      purpose: 'google_tenant_selection',
      availableTenants: [{ id: 't1', name: 'One' }], allowedTenantIds: ['t1']
    } }),
    response(200, { success: true, data: { mfaRequired: true } }),
    response(200, { success: true, data: { accessToken: 'a' } })
  ];
  return env.mod.boot().then(function () {
    return env.elements['omniGoogleAuthCodeTenants'].children[0].handlers.click().then(function () {
      assert(env.elements['omniGoogleAuthCodeMfaSubmit'], 'MFA prompt not shown after tenant selection');
      env.elements['omniGoogleAuthCodeMfa'].value = '654321';
      return env.elements['omniGoogleAuthCodeMfaSubmit'].handlers.click().then(function () {
        assert(env.posts[2].url === '/api/v1/auth/google-login-code/mfa-verify', env.posts[2].url);
        assert(env.navigations.length === 1, 'no bootstrap after chained MFA');
      });
    });
  });
});

check('invalid status shows an error and never navigates', function () {
  const env = loadModule('?mfa_required=1');
  env.sandbox.__script = [response(401, { success: false })];
  return env.mod.boot().then(function () {
    assert(env.elements['omniGoogleAuthCodePanel'], 'no error panel');
    assert(env.navigations.length === 0, 'navigated on invalid status');
  });
});

check('both login surfaces expose the normal Google button and load the module', function () {
  assert(INDEX.indexOf('id="normalGoogleSignInBtn"') !== -1, 'ERP button missing');
  assert(INDEX.indexOf('platform/google-authcode.js') !== -1, 'ERP module include missing');
  assert(INDEX.indexOf('OmniGoogleAuthCode.start') !== -1, 'ERP wiring missing');
  assert(PLATFORM_HTML.indexOf('id="platformNormalGoogleSignIn"') !== -1, 'platform button missing');
  assert(PLATFORM_HTML.indexOf('platform/google-authcode.js') !== -1, 'platform module include missing');
  assert(PLATFORM_JS.indexOf('OmniGoogleAuthCode.start') !== -1, 'platform wiring missing');
});

check('master OIDC entry points remain separate', function () {
  assert(INDEX.indexOf("'/auth/google/master?returnTo='") !== -1, 'master entry changed');
  assert(PLATFORM_JS.indexOf("startGoogleSignIn") !== -1, 'master handler changed');
  assert(PLATFORM_HTML.indexOf('id="platformAuthGoogle"') !== -1, 'master button changed');
});

check('bilingual messages exist for the new flow', function () {
  assert(envMessages().ar.google && envMessages().en.google, 'button label missing');
  assert(envMessages().ar.mfa && envMessages().en.mfa, 'MFA message missing');
  assert(envMessages().ar.tenant && envMessages().en.tenant, 'tenant message missing');
});
function envMessages() {
  return loadModule('').mod.messages;
}

if (!failed) console.log('\nALL FRONTEND GOOGLE AUTHCODE TESTS PASSED (' + passed + ')');
