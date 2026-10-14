'use strict';

// Google account LINKING UI regression suite (Phase: google-master-link-ui,
// entry-point follow-up: google-master-link-entrypoint).
//
// Pins the shipped frontend contract for the authenticated Master's Google
// linking flow — the ONLY path that calls POST /auth/google/master/link-session
// and GET /auth/google/master/link. The flow itself lives in the shared
// platform/google-link.js module (OmniGoogleLink) loaded by BOTH shells;
// platform.js keeps the drawer wiring + session-gate refresh and delegates.
// Static assertions against the shipped bytes; the server-side ticket /
// policy / session semantics are pinned by backend/tests/googleMasterSignin.test.js.
//
//   - markup: the link section + password step-up exist in the auth drawer
//   - link start: step-up requires an authenticated session, posts the
//     current password (JSON body + Bearer), then navigates to the link
//     entry with the server-issued ticket
//   - password hygiene: never in a URL, never persisted, always cleared
//   - outcomes: ?glink=1 success + every gerr= link error message present
//   - delegation: platform.html loads the shared module BEFORE platform.js
//     and the drawer wrappers route through OmniGoogleLink
//   - login entry intact: the existing Google LOGIN button still routes to
//     /auth/google/master (login mode), never the link path

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
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

// Extract a top-level function body by name (brace matching), mirroring the
// approach used by compact-login.test.cjs / backend frontend suites.
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

// ---------------------------------------------------------------------------
// 1. Markup contract
// ---------------------------------------------------------------------------
check('auth drawer ships the Google link section and password step-up markup', () => {
  assert(PLATFORM_HTML.includes('id="platformAuthGoogleLinkSection"'), 'link section missing');
  assert(PLATFORM_HTML.includes('hidden style="margin-top:12px;border-top:1px solid var(--border);padding-top:10px"') ||
    PLATFORM_HTML.includes('id="platformAuthGoogleLinkSection" hidden'), 'link section must start hidden');
  assert(PLATFORM_HTML.includes('id="platformAuthGoogleLink"'), 'link trigger button missing');
  assert(PLATFORM_HTML.includes('id="platformAuthLinkStepUp"'), 'step-up container missing');
  assert(PLATFORM_HTML.includes('type="password" id="platformAuthLinkPass"'), 'step-up password input missing or unmasked');
  assert(PLATFORM_HTML.includes('id="platformAuthLinkSubmit"'), 'step-up submit missing');
  assert(PLATFORM_HTML.includes('id="platformAuthLinkCancel"'), 'step-up cancel missing');
});

check('link section sits between the login form and the logout button, outside the form', () => {
  const formClose = PLATFORM_HTML.indexOf('</form>');
  const linkSection = PLATFORM_HTML.indexOf('id="platformAuthGoogleLinkSection"');
  const logout = PLATFORM_HTML.indexOf('id="platformAuthLogout"');
  assert(formClose !== -1 && linkSection !== -1 && logout !== -1, 'expected landmarks missing');
  assert(formClose < linkSection, 'link section must be outside (after) the login form');
  assert(linkSection < logout, 'link section must precede the logout button');
});

// ---------------------------------------------------------------------------
// 2. Link start: step-up + single-use ticket navigation (shared module)
// ---------------------------------------------------------------------------
check('link step-up requires an authenticated session before showing', () => {
  const open = extractFunction(GOOGLE_LINK_JS, 'openStepUp');
  assert(open.includes('authTokens()'), 'openStepUp must read the session');
  assert(open.includes("if (!tokens.access)"), 'openStepUp must gate on the access token');
  assert(open.includes("step.removeAttribute('hidden')"), 'openStepUp must reveal the step-up');
  assert(open.includes("pass.value = ''"), 'openStepUp must clear any stale password');
});

check('link start posts the current password to link-session with the Bearer session', () => {
  const submit = extractFunction(GOOGLE_LINK_JS, 'submitStepUp');
  assert(GOOGLE_LINK_JS.includes("LINK_SESSION_URL = '/auth/google/master/link-session'"), 'link-session URL constant missing');
  assert(submit.includes('fetch(LINK_SESSION_URL'), 'link-session fetch missing');
  assert(submit.includes("method: 'POST'"), 'link-session must be POST');
  assert(submit.includes("'Authorization': 'Bearer ' + tokens.access"), 'link-session must send the Bearer session');
  assert(submit.includes("credentials: 'same-origin'"), 'link-session must send same-origin credentials');
  assert(submit.includes('currentPassword: currentPassword'), 'link-session must send the current password in the JSON body');
  assert(submit.includes("if (!tokens.access)"), 'submit must re-check the session before posting');
  assert(submit.includes("if (!currentPassword)"), 'submit must require a non-empty password');
});

check('a server-issued ticket is the only credential that starts the link round-trip', () => {
  const submit = extractFunction(GOOGLE_LINK_JS, 'submitStepUp');
  assert(GOOGLE_LINK_JS.includes("LINK_ENTRY_URL = '/auth/google/master/link'"), 'link entry URL constant missing');
  assert(submit.includes("LINK_ENTRY_URL + '?ticket=' + encodeURIComponent(ticket)"), 'link entry navigation missing');
  assert(submit.includes('res.body && res.body.success && res.body.data && res.body.data.ticket'), 'ticket must come from the server response envelope');
  assert(submit.includes('global.location.assign('), 'link start must navigate the browser');
  assert(!/\/auth\/google\/master\/link\?[^'"]*[Pp]assword/.test(submit), 'password must never travel in the link URL');
  assert(!/\/auth\/google\/master\?[^'"]*[Pp]assword/.test(submit), 'password must never travel in the login URL');
});

check('the password never persists and is cleared on every outcome', () => {
  for (const src of [PLATFORM_JS, GOOGLE_LINK_JS]) {
    assert(!/localStorage\.setItem\([^)]*[Pp]ass/.test(src), 'password must never be persisted to localStorage');
    assert(!/sessionStorage\.setItem\([^)]*[Pp]ass/.test(src), 'password must never be persisted to sessionStorage');
  }
  const submit = extractFunction(GOOGLE_LINK_JS, 'submitStepUp');
  // Two clear sites: once after any settled response (covers success and
  // every mapped error) and once in the network .catch.
  const clears = (submit.match(/pass(?:El)?\.value\s*=\s*''/g) || []).length;
  assert(clears >= 2, 'step-up password must be cleared after any response and on network failure; found ' + clears);
});

// ---------------------------------------------------------------------------
// 3. Outcomes: success + error surface
// ---------------------------------------------------------------------------
check('completed link round-trip surfaces success and cleans the URL', () => {
  const handler = extractFunction(PLATFORM_JS, 'handlePlatformGoogleSigninResult');
  assert(handler.includes("query.indexOf('glink=1') !== -1"), 'glink outcome branch missing');
  assert(handler.includes("gl.searchParams.delete('glink')"), 'glink flag must be stripped from the URL');
  assert(handler.includes('window.history.replaceState'), 'URL cleanup must use history.replaceState');
  assert(handler.includes('تم ربط حساب Google بهذا الحساب بنجاح'), 'link success message missing');
  assert(handler.includes("stepAfter.setAttribute('hidden', '')"), 'glink success must hide the step-up');
  assert(handler.includes("passAfter.value = ''"), 'glink success must clear the password field');
});

check('every server link error code maps to a safe Arabic message', () => {
  for (const code of ['email_mismatch', 'session_mismatch', 'sub_taken',
    'link_policy_unconfigured', 'link_failed', 'session_invalid', 'not_linked']) {
    assert(new RegExp(code + ":\\s*'").test(PLATFORM_JS), 'drawer gerr message missing for: ' + code);
    assert(new RegExp(code + ":\\s*'").test(GOOGLE_LINK_JS), 'shared-module gerr message missing for: ' + code);
  }
});

check('link-session failures map 400/401/403/404/501 to distinct safe messages', () => {
  const submit = extractFunction(GOOGLE_LINK_JS, 'submitStepUp');
  for (const status of ['400', '401', '403', '404', '501']) {
    assert(submit.includes('res.status === ' + status), 'link-session status mapping missing: ' + status);
  }
  assert(submit.includes(".catch(function ()"), 'network failure branch missing');
  assert(submit.includes("if (submitBtn) submitBtn.disabled = false"), 'submit button must be re-enabled after every outcome');
});

// ---------------------------------------------------------------------------
// 4. Session gating + wiring
// ---------------------------------------------------------------------------
check('link section is session-gated: hidden without a session, shown with one', () => {
  const refresh = extractFunction(PLATFORM_JS, 'refreshAuthDrawer');
  assert(refresh.includes("if (hasSession) linkSection.removeAttribute('hidden')"), 'link section must show with a session');
  assert(refresh.includes("else linkSection.setAttribute('hidden', '')"), 'link section must hide without a session');
  assert(refresh.includes("if (!hasSession && linkStepUp) linkStepUp.setAttribute('hidden', '')"), 'step-up must reset when the session ends');
  assert(refresh.includes("if (!hasSession && linkPass) linkPass.value = ''"), 'password must reset when the session ends');
});

check('link controls are wired: click opens step-up, submit/cancel/enter are hooked', () => {
  assert(PLATFORM_JS.includes("googleLinkBtn.addEventListener('click', openGoogleLinkStepUp)"), 'link button wiring missing');
  assert(PLATFORM_JS.includes("googleLinkSubmit.addEventListener('click', submitGoogleLinkStepUp)"), 'submit wiring missing');
  assert(PLATFORM_JS.includes("googleLinkCancel.addEventListener('click', cancelGoogleLinkStepUp)"), 'cancel wiring missing');
  assert(/platformAuthLinkPass[\s\S]{0,200}e\.key === 'Enter'/.test(PLATFORM_JS), 'Enter key on the password field must submit');
});

// ---------------------------------------------------------------------------
// 5. Login entry intact — linking is not a login path
// ---------------------------------------------------------------------------
check('the Google LOGIN entry is intact and never starts a link', () => {
  const login = extractFunction(PLATFORM_JS, 'startGoogleSignIn');
  assert(login.includes("window.location.assign('/auth/google/master?returnTo='"), 'login entry must navigate to the login mode');
  assert(!login.includes('link-session'), 'login entry must not touch link-session');
  assert(!login.includes('/auth/google/master/link'), 'login entry must not navigate to the link path');
});

check('the link flow never calls the login entry', () => {
  const submit = extractFunction(GOOGLE_LINK_JS, 'submitStepUp');
  assert(!submit.includes('startGoogleSignIn'), 'link start must never route through the login entry');
  const open = extractFunction(GOOGLE_LINK_JS, 'openStepUp');
  assert(!open.includes('startGoogleSignIn'), 'link step-up must never route through the login entry');
});

// ---------------------------------------------------------------------------
// 6. Shared-module wiring: load order + fail-closed delegation
// ---------------------------------------------------------------------------
check('platform.html loads the shared link module BEFORE platform.js', () => {
  const gIdx = PLATFORM_HTML.indexOf('platform/google-link.js');
  const pIdx = PLATFORM_HTML.indexOf('platform/platform.js');
  assert(gIdx !== -1, 'platform.html must load platform/google-link.js');
  assert(pIdx !== -1, 'platform.html must still load platform/platform.js');
  assert(gIdx < pIdx, 'google-link.js must load before platform.js');
});

check('platform.html cache-busts both platform scripts with a version query', () => {
  assert(/platform\/google-link\.js\?v=\d{8}/.test(PLATFORM_HTML), 'google-link.js must carry a ?v= cache-buster');
  assert(/platform\/platform\.js\?v=\d{8}/.test(PLATFORM_HTML), 'platform.js must carry a ?v= cache-buster');
});

check('drawer wrappers delegate to OmniGoogleLink and fail closed when absent', () => {
  for (const name of ['openGoogleLinkStepUp', 'submitGoogleLinkStepUp']) {
    const wrap = extractFunction(PLATFORM_JS, name);
    assert(wrap.includes('window.OmniGoogleLink'), name + ' must delegate to the shared module');
    assert(wrap.includes('authError('), name + ' must fail closed with a safe message');
  }
  const cancel = extractFunction(PLATFORM_JS, 'cancelGoogleLinkStepUp');
  assert(cancel.includes('window.OmniGoogleLink'), 'cancelGoogleLinkStepUp must delegate to the shared module');
});

setTimeout(() => {
  console.log('\ngoogle-link-ui.test.cjs: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
}, 500);
