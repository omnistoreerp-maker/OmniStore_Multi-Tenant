'use strict';

// Master Control Center Google LINK entry-point regression suite
// (Phase: google-master-link-entrypoint).
//
// PR #54 shipped the link UI only inside the platform.html auth drawer;
// after a master logs in, resolvePostLoginTarget hands off to index.html
// (page-platform-master) — which had NO link UI. This suite pins the
// entry point added there: the section markup, the shared-module boot,
// the round-trip outcome consumer (?glink=1 / ?gerr=), the cache-busting
// version queries, and the separation from the Google LOGIN button.
// Static assertions against the shipped bytes; server semantics stay in
// backend/tests/googleMasterSignin.test.js; the shared flow contract is
// pinned by google-link-ui.test.cjs.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const PLATFORM_HTML = fs.readFileSync(path.join(ROOT, 'platform.html'), 'utf8');
const PLATFORM_JS = fs.readFileSync(path.join(ROOT, 'platform', 'platform.js'), 'utf8');
const GOOGLE_LINK_JS = fs.readFileSync(path.join(ROOT, 'platform', 'google-link.js'), 'utf8');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('PASS  ' + name);
  } catch (err) {
    failed += 1;
    console.error('FAIL  ' + name + ' :: ' + (err && err.message));
    process.exitCode = 1;
  }
}
function assert(cond, message) {
  if (!cond) throw new Error(message || 'assertion failed');
}

// ---------------------------------------------------------------------------
// 1. Markup: the section exists on the Master Control Center page
// ---------------------------------------------------------------------------
check('Master Control Center ships the Google link section with step-up markup', () => {
  assert(INDEX_HTML.includes('id="page-platform-master"'), 'Master Control Center page missing');
  const pageStart = INDEX_HTML.indexOf('id="page-platform-master"');
  const pageEnd = INDEX_HTML.indexOf('</div>', INDEX_HTML.indexOf('id="platformTabBody"'));
  const page = INDEX_HTML.slice(pageStart, pageEnd === -1 ? undefined : pageEnd);
  assert(page.includes('id="platformAuthGoogleLinkSection"'), 'link section must live inside page-platform-master');
  assert(page.includes('id="platformAuthGoogleLink"'), 'link trigger button missing');
  assert(page.includes('id="platformAuthLinkStepUp"'), 'step-up container missing');
  assert(page.includes('type="password" id="platformAuthLinkPass"'), 'step-up password input missing or unmasked');
  assert(page.includes('id="platformAuthLinkSubmit"'), 'step-up submit missing');
  assert(page.includes('id="platformAuthLinkCancel"'), 'step-up cancel missing');
  assert(page.includes('id="googleLinkPill"'), 'linked-state pill missing');
  assert(page.includes('id="googleLinkStatus"'), 'live status region missing');
});

check('the section IDs match the shared module element contract', () => {
  for (const id of ['platformAuthLinkStepUp', 'platformAuthLinkPass',
    'platformAuthLinkSubmit', 'platformAuthLinkCancel']) {
    assert(GOOGLE_LINK_JS.includes("getElementById('" + id + "')"),
      'shared module must target ' + id);
  }
});

// ---------------------------------------------------------------------------
// 2. Boot wiring + round-trip outcome consumption
// ---------------------------------------------------------------------------
check('index.html loads the shared link module and boots it at startup', () => {
  assert(INDEX_HTML.includes('src="platform/google-link.js?v='), 'index.html must load google-link.js with a ?v= cache-buster');
  assert(/if \(window\.OmniGoogleLink\) OmniGoogleLink\.boot\(\);/.test(INDEX_HTML), 'boot() call missing');
});

check('a completed link round-trip (?glink=1) is consumed and cleaned from the URL', () => {
  const consume = GOOGLE_LINK_JS.match(/function consumeResult\(\)[\s\S]*?\n  \}/);
  assert(consume, 'consumeResult missing from the shared module');
  assert(consume[0].includes('glink=1'), 'glink outcome branch missing');
  assert(consume[0].includes("searchParams.delete('glink')"), 'glink flag must be stripped from the URL');
  assert(consume[0].includes("searchParams.delete('gerr')"), 'gerr flag must be stripped from the URL');
  assert(consume[0].includes('window.history.replaceState') || consume[0].includes('global.history.replaceState'),
    'URL cleanup must use history.replaceState');
  assert(consume[0].includes('تم ربط حساب Google بهذا الحساب بنجاح'), 'link success message missing');
  assert(consume[0].includes("step.setAttribute('hidden', '')"), 'glink success must hide the step-up');
  assert(consume[0].includes("pass.value = ''"), 'glink success must clear the password field');
});

check('server link error codes surface on the control center, not the login screen', () => {
  const consume = GOOGLE_LINK_JS.match(/function consumeResult\(\)[\s\S]*?\n  \}/);
  assert(consume, 'consumeResult missing from the shared module');
  assert(consume[0].includes('GERR_MESSAGES'), 'consumeResult must map gerr codes');
  assert(consume[0].includes('toast('), 'consumeResult must surface a visible toast');
  assert(consume[0].includes('refreshStatus()'), 'consumeResult must refresh the linked-state pill');
});

check('renderPlatformMaster refreshes the linked-state pill on every render', () => {
  assert(/if \(window\.OmniGoogleLink\) OmniGoogleLink\.refreshStatus\(\);/.test(INDEX_HTML),
    'renderPlatformMaster refresh hook missing');
});

// ---------------------------------------------------------------------------
// 3. Link flow contract (shared module) — session-gated, ticket-routed
// ---------------------------------------------------------------------------
check('the entry-point link start posts the password step-up with the Bearer session', () => {
  assert(GOOGLE_LINK_JS.includes("LINK_SESSION_URL = '/auth/google/master/link-session'"), 'link-session URL missing');
  assert(GOOGLE_LINK_JS.includes("LINK_ENTRY_URL = '/auth/google/master/link'"), 'link entry URL missing');
  assert(GOOGLE_LINK_JS.includes("'Authorization': 'Bearer ' + tokens.access"), 'Bearer session missing');
  assert(GOOGLE_LINK_JS.includes('currentPassword: currentPassword'), 'password must travel in the JSON body only');
});

check('the linked-state probe is read-only and session-scoped', () => {
  assert(GOOGLE_LINK_JS.includes("LINK_STATUS_URL = '/auth/google/master/link-status'"), 'link-status URL missing');
  const refresh = GOOGLE_LINK_JS.match(/function refreshStatus\(\)[\s\S]*?\n  \}/);
  assert(refresh, 'refreshStatus missing');
  assert(!/method:\s*'POST'/.test(refresh[0]), 'status probe must never be a POST');
  assert(refresh[0].includes("credentials: 'same-origin'"), 'status probe must stay same-origin');
});

check('the password never persists in the shared module', () => {
  assert(!/localStorage\.setItem\([^)]*[Pp]ass/.test(GOOGLE_LINK_JS), 'password must never be persisted to localStorage');
  assert(!/sessionStorage\.setItem\([^)]*[Pp]ass/.test(GOOGLE_LINK_JS), 'password must never be persisted to sessionStorage');
});

// ---------------------------------------------------------------------------
// 4. Separation from the Google LOGIN entry — linking is not a login path
// ---------------------------------------------------------------------------
check('the login-screen Google button stays login-only on index.html', () => {
  // The button tag and its click handler live in adjacent blocks; scope the
  // assertion to the button + the handler script that follows it.
  const region = INDEX_HTML.match(/id="googleSignInBtn"[\s\S]{0,1200}?<\/script>/);
  assert(region, 'googleSignInBtn + handler block missing');
  assert(region[0].includes('/auth/google/master?returnTo='), 'login button must route to login mode');
  assert(!region[0].includes('link-session'), 'login button must not touch link-session');
  assert(!region[0].includes('/auth/google/master/link'), 'login button must not navigate to the link path');
});

check('index.html still routes ?gsignin=1 / ?gmfa through the login bootstrap', () => {
  assert(INDEX_HTML.includes('function bootstrapGoogleSigninSession'), 'sign-in session bootstrap missing');
  assert(INDEX_HTML.includes('function handleGoogleSigninResult'), 'sign-in result handler missing');
  assert(INDEX_HTML.includes("params.get('gmfa') === '1'"), 'MFA challenge branch missing');
});

setTimeout(() => {
  console.log('\ngoogle-link-entrypoint.test.cjs: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
}, 500);
