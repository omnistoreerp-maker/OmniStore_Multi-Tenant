'use strict';

// Phase 34.3 — user-registration prompt removal regression tests.
//   (a) the automatic "برجاء تسجيل بيانات المستخدم" prompt can no longer be
//       auto-shown after login (the 5-minute timer no longer opens the overlay),
//   (b) the user-registration capability itself is preserved (saveUserRegistration,
//       USER_REG_KEY, #userRegOverlay markup, registration fields),
//   (c) the user-facing prompt phrase is absent from the shipped UI.
//
// Like the other frontend tests, the REAL functions/markers come from the
// shipped index.html (vm-extracted).

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML_PATH = path.join(ROOT, 'index.html');
const HTML = fs.readFileSync(HTML_PATH, 'utf8');

function extractFunction(name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\(', 'g');
  const match = re.exec(HTML);
  if (!match) throw new Error('function not found: ' + name);
  const start = match.index;
  const open = HTML.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') {
      depth--;
      if (depth === 0) return HTML.slice(start, i + 1);
    }
  }
  throw new Error('unterminated function: ' + name);
}

describe('Phase 34.3 — user registration prompt removal (shipped index.html)', () => {
  test('the automatic prompt is gone: timer can no longer show the registration overlay', () => {
    // The overlay may ONLY be shown automatically by startUserRegistrationTimer;
    // after the removal its body must not touch the overlay at all.
    const timer = extractFunction('startUserRegistrationTimer');
    expect(timer).not.toContain('userRegOverlay');
    // Belt and braces: no code path anywhere may auto-open the overlay.
    expect(HTML).not.toContain("userRegOverlay').style.display = 'flex'");
    expect(HTML).not.toContain('userRegOverlay").style.display = "flex"');
  });

  test('user registration capability is preserved', () => {
    expect(HTML).toContain('function saveUserRegistration()');
    expect(HTML).toContain("const USER_REG_KEY = 'cairo_user_registered'");
    expect(HTML).toContain('id="userRegOverlay"');
    ['regFullName', 'regPhone', 'regEmail', 'regAddress', 'regJob'].forEach(id => {
      expect(HTML).toContain('id="' + id + '"');
    });
    // The save handler still writes the registration record and closes the modal.
    const save = extractFunction('saveUserRegistration');
    expect(save).toContain('USER_REG_KEY');
    expect(save).toContain("getElementById('userRegOverlay').style.display = 'none'");
  });

  test('the user-facing prompt phrase is absent from the shipped UI', () => {
    expect(HTML).not.toContain('برجاء تسجيل بيانات المستخدم');
  });

  test('timer is a harmless no-op and login flow still references it safely', () => {
    const context = {
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      document: { getElementById: () => null },
      console
    };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(extractFunction('startUserRegistrationTimer'), context);
    // Must not throw and must not schedule anything.
    expect(() => context.startUserRegistrationTimer()).not.toThrow();
  });
});
