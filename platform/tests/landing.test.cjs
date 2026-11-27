'use strict';

// Landing page regression suite (Phase: landing).
//
// Pins the unified public landing page contract without a browser:
//   - page structure and required navigation
//   - Arabic/English language switching (lang/dir attributes, translations)
//   - real auth API integration (no simulated login/registration success)
//   - registration is NOT available through this page (honest message)
//   - dialog open/close and keyboard accessibility
//   - service navigation targets
//
// Backend API authorization is covered by backend/tests/auth.test.js.
//
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const LANDING_HTML = fs.readFileSync(path.join(ROOT, 'landing.html'), 'utf8');
const LANDING_JS = fs.readFileSync(path.join(ROOT, 'platform', 'landing.js'), 'utf8');
const LANDING_CSS = fs.readFileSync(path.join(ROOT, 'platform', 'landing.css'), 'utf8');

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

// ---------------------------------------------------------------------------
// 1. Page structure
// ---------------------------------------------------------------------------
check('landing.html has RTL defaults lang=ar dir=rtl', () => {
  assert(/<html[^>]*lang="ar"[^>]*dir="rtl"/.test(LANDING_HTML), 'html must default to lang=ar dir="rtl"');
});

check('landing.html references platform.css and landing.css', () => {
  assert(LANDING_HTML.includes('platform/platform.css'), 'platform.css missing');
  assert(LANDING_HTML.includes('platform/landing.css'), 'landing.css missing');
});

check('landing.html references landing.js', () => {
  assert(LANDING_HTML.includes('platform/landing.js'), 'landing.js script missing');
});

check('brand logo SVG referenced in header and hero', () => {
  assert(LANDING_HTML.includes('brand/logo/omnistore-logo-connected-o.svg'), 'brand logo missing');
  assert((LANDING_HTML.match(/brand\/logo\/omnistore-logo-connected-o\.svg/g) || []).length >= 2, 'brand logo must appear at least twice');
});

check('hero section present with title and CTA', () => {
  assert(LANDING_HTML.includes('<section class="hero"'), 'hero section missing');
  assert(LANDING_HTML.includes('id="home"'), 'hero home anchor missing');
  assert(LANDING_HTML.includes('data-i18n="hero_title_accent"'), 'hero title i18n missing');
});

check('services section present with 7 service cards', () => {
  assert(LANDING_HTML.includes('<section id="services"'), 'services section missing');
  // Verify each expected service title is present
  const expectedTitles = ['السوق', 'حلول الأعمال', 'خدمات الطلاب', 'التعليم', 'ألعاب أونلاين', 'الدعم الفني', 'استضافة الألعاب'];
  for (const title of expectedTitles) {
    assert(LANDING_HTML.includes(title), 'service title missing: ' + title);
  }
});

check('footer present with legal links', () => {
  assert(LANDING_HTML.includes('<section id="footer"'), 'footer section missing');
  assert(LANDING_HTML.includes('terms-of-service.html'), 'terms link missing');
  assert(LANDING_HTML.includes('privacy-policy.html'), 'privacy link missing');
});

check('bottom navigation present', () => {
  assert(LANDING_HTML.includes('<nav class="bottom-nav"'), 'bottom nav missing');
});

check('auth drawer present with login form', () => {
  assert(LANDING_HTML.includes('id="landingAuthDrawer"'), 'auth drawer missing');
  assert(LANDING_HTML.includes('id="landingAuthForm"'), 'auth form missing');
  assert(LANDING_HTML.includes('id="landingAuthUser"'), 'username input missing');
  assert(LANDING_HTML.includes('id="landingAuthPass"'), 'password input missing');
  assert(LANDING_HTML.includes('id="landingAuthSubmit"'), 'submit button missing');
  assert(LANDING_HTML.includes('id="landingAuthError"'), 'error region missing');
  assert(LANDING_HTML.includes('id="landingAuthLogout"'), 'logout button missing');
});

check('registration overlay present', () => {
  assert(LANDING_HTML.includes('id="landingRegOverlay"'), 'registration overlay missing');
  assert(LANDING_HTML.includes('id="landingRegForm"'), 'registration form missing');
  assert(LANDING_HTML.includes('id="landingRegSubmit"'), 'registration submit missing');
});

check('language switcher slot present in header', () => {
  assert(LANDING_HTML.includes('id="lang-switch"'), 'lang-switch slot missing');
  assert(LANDING_HTML.includes('data-omni-lang-slot'), 'lang slot data attribute missing');
});

// ---------------------------------------------------------------------------
// 2. No simulated authentication / no fake success
// ---------------------------------------------------------------------------
check('no localStorage simulated login state', () => {
  assert(!/omni_landing_user/.test(LANDING_JS), 'simulated login localStorage key must not exist');
  assert(!/localStorage\.setItem\('omni_landing_user'/.test(LANDING_JS), 'simulated login write must not exist');
});

check('no localStorage simulated registrations', () => {
  assert(!/omni_landing_registrations/.test(LANDING_JS), 'simulated registrations localStorage key must not exist');
  assert(!/refreshStats/.test(LANDING_JS), 'fake stats function must not exist');
});

check('no fake success messages on registration', () => {
  assert(!/تم حفظ البيانات بنجاح/.test(LANDING_JS), 'Arabic fake success message must not exist');
  assert(!/saved successfully|registration successful|account created/i.test(LANDING_JS), 'English fake success message must not exist');
});

check('no random statistics fabrication', () => {
  assert(!/Math\.random/.test(LANDING_JS), 'random stat fabrication must not exist');
  assert(!/stat-visitors|stat-users|stat-businesses/.test(LANDING_JS) || !/Math\.random/.test(LANDING_JS), 'stats must not use Math.random');
});

// ---------------------------------------------------------------------------
// 3. Real auth API integration
// ---------------------------------------------------------------------------
check('auth API base is the real backend contract', () => {
  assert(LANDING_JS.includes("const AUTH_API = '/api/v1/auth'"), 'auth API base missing');
});

check('login calls POST /api/v1/auth/login', () => {
  assert(LANDING_JS.includes("AUTH_API + '/login'"), 'login endpoint missing');
  assert(LANDING_JS.includes('method: \'POST\''), 'login must use POST');
  assert(LANDING_JS.includes('credentials: \'same-origin\''), 'login must send cookies');
});

check('logout calls POST /api/v1/auth/logout', () => {
  assert(LANDING_JS.includes("AUTH_API + '/logout'"), 'logout endpoint missing');
});

check('session check calls GET /api/v1/auth/me', () => {
  assert(LANDING_JS.includes("AUTH_API + '/me'"), 'me endpoint missing');
});

check('no hardcoded credentials or secrets', () => {
  assert(!/admin123|password123|let\s+\w*[Pp]assword\s*=\s*['"]/.test(LANDING_JS), 'hardcoded credential found');
  assert(!/sk_live|sk_test|BEGIN [A-Z ]*PRIVATE KEY/.test(LANDING_JS), 'secret-like value found');
});

// ---------------------------------------------------------------------------
// 4. Registration not available — honest message
// ---------------------------------------------------------------------------
check('registration inputs are disabled (no client-side account creation)', () => {
  const regSection = LANDING_HTML.slice(LANDING_HTML.indexOf('<form id="landingRegForm"'), LANDING_HTML.indexOf('</form>', LANDING_HTML.indexOf('<form id="landingRegForm"')) + 7);
  for (const id of ['regFullName', 'regPhone', 'regEmail', 'regAddress', 'regJob']) {
    assert(regSection.includes('id="' + id + '"'), 'registration input missing: ' + id);
    // Find the input tag and verify it has disabled attribute
    const inputStart = regSection.indexOf('id="' + id + '"');
    const tagStart = regSection.lastIndexOf('<input', inputStart);
    const tagEnd = regSection.indexOf('>', inputStart);
    const tagHtml = regSection.slice(tagStart, tagEnd + 1);
    assert(/disabled/.test(tagHtml), 'registration input must be disabled: ' + id);
  }
});

check('registration shows unavailability message in both languages', () => {
  assert(LANDING_JS.includes("reg_unavailable_msg"), 'reg_unavailable_msg translation key missing');
  assert(LANDING_JS.includes('reg_unavailable_title'), 'reg_unavailable_title translation key missing');
});

check('registration submit does not call any API', () => {
  const regFormSubmitStart = LANDING_JS.indexOf('regForm.addEventListener');
  const regFormSubmitEnd = LANDING_JS.indexOf('});', regFormSubmitStart);
  const regHandler = LANDING_JS.slice(regFormSubmitStart, regFormSubmitEnd > regFormSubmitStart ? regFormSubmitEnd : LANDING_JS.length);
  assert(!/fetch/.test(regHandler), 'registration submit must not call fetch');
});

// ---------------------------------------------------------------------------
// 5. Google sign-in NOT represented as working
// ---------------------------------------------------------------------------
check('no Google sign-in buttons or flows on landing page', () => {
  assert(!LANDING_HTML.includes('google'), 'Google references must not appear in landing.html');
  assert(!/google/i.test(LANDING_JS), 'Google sign-in must not be referenced in landing.js');
});

// ---------------------------------------------------------------------------
// 6. i18n translations exist in both languages
// ---------------------------------------------------------------------------
check('landing.js has TRANSLATIONS object with ar and en', () => {
  assert(/\bar\s*:\s*\{/.test(LANDING_JS), 'ar translation table missing');
  assert(/\ben\s*:\s*\{/.test(LANDING_JS), 'en translation table missing');
});

check('all data-i18n keys in landing.html exist in landing.js translations', () => {
  const keys = [];
  let m;
  const re = /data-i18n="([^"]+)"/g;
  while ((m = re.exec(LANDING_HTML)) !== null) keys.push(m[1]);
  assert(keys.length > 0, 'no data-i18n keys found in landing.html');
  for (const key of new Set(keys)) {
    assert(new RegExp(key + "\\s*:\\s*'[^']+'").test(LANDING_JS), 'translation key missing: ' + key);
  }
});

check('every translation key exists in both ar and en tables', () => {
  const arStart = LANDING_JS.indexOf('ar: {');
  const enStart = LANDING_JS.indexOf('en: {');
  assert(arStart !== -1 && enStart !== -1, 'both language tables must exist');
  const first = Math.min(arStart, enStart);
  const second = Math.max(arStart, enStart);
  const endBrace = LANDING_JS.indexOf('};', second);
  const arBlock = arStart < enStart ? LANDING_JS.slice(arStart, endBrace) : LANDING_JS.slice(second, endBrace);
  const enBlock = enStart > arStart ? LANDING_JS.slice(enStart, endBrace) : LANDING_JS.slice(first, endBrace);
  const keys = new Set();
  let m;
  const re = /data-i18n="([^"]+)"/g;
  while ((m = re.exec(LANDING_HTML)) !== null) keys.add(m[1]);
  for (const key of keys) {
    assert(new RegExp(key + "\\s*:\\s*'[^']+'").test(enBlock), 'en table missing: ' + key);
    assert(new RegExp(key + "\\s*:\\s*'[^']+'").test(arBlock), 'ar table missing: ' + key);
  }
});

check('translation tables have lang and dir values', () => {
  assert(/ar:\s*\{\s*lang:\s*'ar'\s*,\s*dir:\s*'rtl'/.test(LANDING_JS), 'ar table must have lang=ar dir=rtl');
  assert(/en:\s*\{\s*lang:\s*'en'\s*,\s*dir:\s*'ltr'/.test(LANDING_JS), 'en table must have lang=en dir=ltr');
});

// ---------------------------------------------------------------------------
// 7. Service navigation targets
// ---------------------------------------------------------------------------
check('all service links point to real files', () => {
  const links = [];
  let m;
  const re = /<a[^>]+href="([^"]+)"[^>]*data-i18n="svc_/g;
  while ((m = re.exec(LANDING_HTML)) !== null) links.push(m[1]);
  assert(links.length >= 5, 'expected at least 5 service links, found ' + links.length);
  const fs = require('fs');
  const path = require('path');
  for (const href of links) {
    let target;
    if (href.startsWith('/')) target = path.join(ROOT, href.slice(1));
    else target = path.join(ROOT, href);
    assert(fs.existsSync(target), 'service link target missing: ' + href);
  }
});

check('footer links point to real files', () => {
  const footerStart = LANDING_HTML.indexOf('<section id="footer"');
  const footerEnd = LANDING_HTML.indexOf('</section>', footerStart) + 10;
  const footerHtml = LANDING_HTML.slice(footerStart, footerEnd);
  const links = [];
  let m;
  const re = /href="([^"]+)"/g;
  while ((m = re.exec(footerHtml)) !== null) links.push(m[1]);
  const fs = require('fs');
  const path = require('path');
  for (const href of links) {
    if (href.startsWith('#')) continue;
    let target;
    if (href.startsWith('/')) target = path.join(ROOT, href.slice(1));
    else target = path.join(ROOT, href);
    assert(fs.existsSync(target), 'footer link target missing: ' + href);
  }
});

// ---------------------------------------------------------------------------
// 8. Auth drawer behavior in sandbox (stubbed DOM + fetch)
// ---------------------------------------------------------------------------
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

function landingSandbox(responder, initialLang) {
  const store = new Map();
  if (initialLang) store.set('omnistore_landing_lang', initialLang);
  const elements = {};
  const ids = ['landingLoginBtn', 'landingAuthOverlay', 'landingAuthDrawer',
    'landingAuthClose', 'landingAuthForm', 'landingAuthUser', 'landingAuthPass',
    'landingAuthShowPass', 'landingAuthError', 'landingAuthSubmit', 'landingAuthLogout',
    'landingAuthRegister', 'landingRegOverlay', 'landingRegClose', 'landingRegForm',
    'landingRegSubmit', 'landingRegMsg', 'landingRegToLogin', 'lang-switch',
    'regFullName', 'regPhone', 'regEmail', 'regAddress', 'regJob'];
  for (const id of ids) elements[id] = elementStub();
  elements.landingAuthOverlay.setAttribute('hidden', '');
  elements.landingAuthDrawer.setAttribute('hidden', '');
  elements.landingAuthLogout.setAttribute('hidden', '');
  elements.regOverlay.setAttribute('hidden', '');
  const listeners = {};
  const context = {
    console,
    document: {
      getElementById: (id) => elements[id] || null,
      addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
      querySelectorAll: () => [],
      documentElement: {
        setAttribute: (k, v) => { context._docElAttrs = context._docElAttrs || {}; context._docElAttrs[k] = v; },
        getAttribute: (k) => (context._docElAttrs && context._docElAttrs[k]) || null
      }
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    },
    window: { location: { href: '' } },
    fetch: responder,
    getLang: () => initialLang || 'ar',
    T: {
      ar: {
        lang: 'ar', dir: 'rtl',
        nav_login: 'تسجيل الدخول', nav_logout: 'تسجيل الخروج',
        auth_submit: 'دخول', auth_error_invalid: 'اسم المستخدم أو كلمة المرور غير صحيحة.',
        auth_error_denied: 'لا يملك حسابك صلاحية الوصول.', auth_error_network: 'تعذر الاتصال.',
        reg_unavailable_msg: 'التسجيل غير متاح.', reg_unavailable_title: 'التسجيل غير متاح هنا'
      },
      en: {
        lang: 'en', dir: 'ltr',
        nav_login: 'Sign in', nav_logout: 'Sign out',
        auth_submit: 'Sign in', auth_error_invalid: 'Invalid username or password.',
        auth_error_denied: 'Your account cannot access this company.', auth_error_network: 'Cannot connect.',
        reg_unavailable_msg: 'Registration not available.', reg_unavailable_title: 'Registration Not Available Here'
      }
    }
  };
  context.globalThis = context;
  context.window = context.window;
  vm.createContext(context);
  const consts = [
    "const AUTH_API = '/api/v1/auth';",
    "const LANG_KEY = 'omnistore_landing_lang';",
    "const SUPPORTED_LANGS = ['ar', 'en'];"
  ].join('\n');
  const fns = ['setError', 'hideDrawer', 'showDrawer', 'hideReg', 'showReg',
    'authSetLoading', 'refreshAuthUI', 'checkSession', 'buildLangSwitch',
    'setLang', 'applyText', 'updateLangButtons'].map((n) => {
      const re = new RegExp('(?:async\\s+)?function\\s+' + n + '\\s*\\(', 'g');
      const match = re.exec(LANDING_JS);
      if (!match) throw new Error('function not found: ' + n);
      const start = match.index;
      const open = LANDING_JS.indexOf('{', start);
      let depth = 0;
      for (let i = open; i < LANDING_JS.length; i++) {
        if (LANDING_JS[i] === '{') depth++;
        else if (LANDING_JS[i] === '}') {
          depth--;
          if (depth === 0) return LANDING_JS.slice(start, i + 1);
        }
      }
      throw new Error('unterminated function: ' + n);
    }).join('\n');
  vm.runInContext(consts + '\n' + fns + '\n', context, { filename: 'landing-sandbox.js' });
  return { context, elements, store, listeners };
}

check('lang switcher renders with Arabic/English buttons', () => {
  const ctxStore = new Map();
  const docElAttrs = {};
  const context = {
    console,
    document: {
      createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, className: '', innerHTML: '', children: [], addEventListener: () => {} }),
      documentElement: {
        setAttribute: (k, v) => { docElAttrs[k] = v; },
        getAttribute: (k) => docElAttrs[k] || null
      },
      querySelectorAll: () => [],
      querySelector: () => null
    },
    localStorage: {
      getItem: (k) => ctxStore.get(k) || null,
      setItem: (k, v) => ctxStore.set(k, String(v))
    },
    window: { location: { href: '' } },
    langSwitch: { innerHTML: '', appendChild: (el) => {}, setAttribute: () => {}, className: '' },
    getLang: () => 'ar',
    T: {
      ar: { lang: 'ar', dir: 'rtl', nav_login: 'تسجيل الدخول', nav_logout: 'تسجيل خروج',
        auth_submit: 'دخول', auth_error_invalid: 'خطأ', auth_error_denied: 'ممنوع',
        auth_error_network: 'شبكة', reg_unavailable_msg: 'غير متاح', reg_unavailable_title: 'غير متاح',
        lang_arabic: 'العربية', lang_english: 'English', lang_switch_label: 'اختر لغة' },
      en: { lang: 'en', dir: 'ltr', nav_login: 'Sign in', nav_logout: 'Sign Out',
        auth_submit: 'Sign in', auth_error_invalid: 'Error', auth_error_denied: 'Denied',
        auth_error_network: 'Network', reg_unavailable_msg: 'Not Available', reg_unavailable_title: 'Not Available',
        lang_arabic: 'العربية', lang_english: 'English', lang_switch_label: 'Choose language' }
    }
  };
  context.globalThis = context;
  context.window = context.window;
  vm.createContext(context);
  const consts = [
    "const AUTH_API = '/api/v1/auth';",
    "const LANG_KEY = 'omnistore_landing_lang';",
    "const SUPPORTED_LANGS = ['ar', 'en'];"
  ].join('\n');
  const fns = ['buildLangSwitch', 'setLang', 'applyText', 'updateLangButtons'].map((n) => {
    const re = new RegExp('(?:async\\s+)?function\\s+' + n + '\\s*\\(', 'g');
    const match = re.exec(LANDING_JS);
    if (!match) throw new Error('function not found: ' + n);
    const start = match.index;
    const open = LANDING_JS.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < LANDING_JS.length; i++) {
      if (LANDING_JS[i] === '{') depth++;
      else if (LANDING_JS[i] === '}') {
        depth--;
        if (depth === 0) return LANDING_JS.slice(start, i + 1);
      }
    }
    throw new Error('unterminated function: ' + n);
  }).join('\n');
  // Provide document.getElementById for lang-switch
  context.document.getElementById = (id) => {
    if (id === 'lang-switch') return context.langSwitch;
    return null;
  };
  vm.runInContext(consts + '\n' + fns + '\nbuildLangSwitch();', context, { filename: 'landing-lang-sandbox.js' });
  assert(true, 'buildLangSwitch executes without error');
});

check('setLang updates html lang and dir attributes', () => {
  const ctxStore = new Map();
  const docElAttrs = {};
  const context = {
    console,
    document: {
      createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, className: '', innerHTML: '', children: [], addEventListener: () => {} }),
      documentElement: {
        setAttribute: (k, v) => { docElAttrs[k] = v; },
        getAttribute: (k) => docElAttrs[k] || null
      },
      querySelectorAll: () => [],
      querySelector: () => null
    },
    localStorage: {
      getItem: (k) => ctxStore.get(k) || null,
      setItem: (k, v) => ctxStore.set(k, String(v))
    },
    window: { location: { href: '' } },
    htmlEl: { setAttribute: (k, v) => { docElAttrs[k] = v; }, getAttribute: (k) => docElAttrs[k] || null },
    getLang: () => 'ar',
    T: {
      ar: { lang: 'ar', dir: 'rtl', nav_login: 'تسجيل الدخول', nav_logout: 'تسجيل خروج',
        auth_submit: 'دخول', auth_error_invalid: 'خطأ', auth_error_denied: 'ممنوع',
        auth_error_network: 'شبكة', reg_unavailable_msg: 'غير متاح', reg_unavailable_title: 'غير متاح' },
      en: { lang: 'en', dir: 'ltr', nav_login: 'Sign in', nav_logout: 'Sign Out',
        auth_submit: 'Sign in', auth_error_invalid: 'Error', auth_error_denied: 'Denied',
        auth_error_network: 'Network', reg_unavailable_msg: 'Not Available', reg_unavailable_title: 'Not Available' }
    }
  };
  context.globalThis = context;
  context.window = context.window;
  vm.createContext(context);
  const consts = [
    "const AUTH_API = '/api/v1/auth';",
    "const LANG_KEY = 'omnistore_landing_lang';",
    "const SUPPORTED_LANGS = ['ar', 'en'];",
    "var htmlEl = document.documentElement;",
    "var langArBtn = null;",
    "var langEnBtn = null;"
  ].join('\n');
  const fns = ['setLang', 'applyText', 'updateLangButtons'].map((n) => {
    const re = new RegExp('(?:async\\s+)?function\\s+' + n + '\\s*\\(', 'g');
    const match = re.exec(LANDING_JS);
    if (!match) throw new Error('function not found: ' + n);
    const start = match.index;
    const open = LANDING_JS.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < LANDING_JS.length; i++) {
      if (LANDING_JS[i] === '{') depth++;
      else if (LANDING_JS[i] === '}') {
        depth--;
        if (depth === 0) return LANDING_JS.slice(start, i + 1);
      }
    }
    throw new Error('unterminated function: ' + n);
  }).join('\n');
  vm.runInContext(consts + '\n' + fns + '\nsetLang(\'en\');', context, { filename: 'landing-lang-sandbox.js' });
  assert(docElAttrs.lang === 'en', 'setLang(en) must set lang=en, got: ' + docElAttrs.lang);
  assert(docElAttrs.dir === 'ltr', 'setLang(en) must set dir=ltr, got: ' + docElAttrs.dir);
  assert(ctxStore.get('omnistore_landing_lang') === 'en', 'language must persist to localStorage');
});

check('escape key handler is registered', () => {
  assert(/Escape/.test(LANDING_JS), 'Escape key handling must be present');
  assert(/hideDrawer\(\)|hideReg\(\)/.test(LANDING_JS), 'dialog close on escape must be wired');
});

check('registration submit shows unavailability message (no API call)', () => {
  const regSubmitCode = LANDING_JS.slice(
    LANDING_JS.indexOf('regForm.addEventListener'),
    LANDING_JS.indexOf('});', LANDING_JS.indexOf('regForm.addEventListener')) + 3
  );
  assert(regSubmitCode.includes('e.preventDefault()'), 'registration submit must prevent default');
  assert(regSubmitCode.includes('reg_unavailable_msg'), 'registration must show unavailability message');
  assert(!/fetch\(/.test(regSubmitCode), 'registration submit must not call fetch API');
});

setTimeout(() => {
  console.log('\nlanding.test.cjs: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
}, 200);
