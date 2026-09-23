'use strict';

// Monetag integration boundary — focused static + behavioral checks.
//
// Proves:
//   1. Disabled boundary → zero external Monetag network loads.
//   2. No fabricated publisher ID / Monetag script URL in shipped surfaces.
//   3. Boundary cannot break or replace core app init / Visitors Now.
//   4. Single loader only (no duplicate injection).
//   5. Visitors Now markers in platform/platform.js remain the main implementation.
//
// READ-ONLY over repo files + vm sandbox for monetag.js behavior.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');

function repoFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const PLATFORM_HTML = repoFile('platform.html');
const INDEX_HTML = repoFile('index.html');
const MONETAG_SRC = repoFile('platform/monetag.js');
const PLATFORM_JS = repoFile('platform/platform.js');

const FAKE_MARKERS = [
  'e1700efedc78f54b923023e572faa053',
  'monetag.com/script',
  'cdn.monetag.com',
  'widget.monetag.com',
  'YOUR_MONETAG',
  'MONETAG_ID'
];

function makeDocumentSandbox() {
  const injected = [];
  const head = {
    appendChild(el) { injected.push(el); }
  };
  const doc = {
    head,
    body: head,
    documentElement: head,
    createElement(tag) {
      const attrs = {};
      return {
        tagName: String(tag).toUpperCase(),
        setAttribute(k, v) { attrs[k] = String(v); },
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
        async: false,
        src: '',
        attrs
      };
    },
    getElementsByTagName(name) {
      if (String(name).toLowerCase() !== 'script') return [];
      return [{
        getAttribute(k) {
          if (k === 'src') return 'platform/monetag.js';
          if (k === 'data-omnistore-monetag') return 'true';
          if (k === 'data-monetag-enabled') return 'false';
          if (k === 'data-monetag-publisher-id') return '';
          if (k === 'data-monetag-script-url') return '';
          return null;
        }
      }];
    },
    querySelectorAll(sel) {
      if (sel && sel.indexOf('data-omnistore-monetag') !== -1) {
        return injected.filter(el => el.getAttribute && el.getAttribute('data-omnistore-monetag') === 'true');
      }
      return [];
    }
  };
  return { doc, injected };
}

function loadBoundary(configOverride) {
  const { doc, injected } = makeDocumentSandbox();
  const sandbox = {
    console,
    document: doc,
    setTimeout,
    clearTimeout
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(MONETAG_SRC, sandbox, { filename: 'platform/monetag.js' });
  const api = sandbox.omnistoreMonetagBoundary;
  if (!api) throw new Error('boundary global missing');
  if (configOverride) api.configure(configOverride);
  // Clear any auto-load attempt from default disabled config.
  api.resetForTests();
  if (configOverride) api.configure(configOverride);
  return { api, injected, sandbox };
}

describe('Monetag boundary — shipped HTML surfaces', () => {
  test('platform.html includes local boundary script once, disabled, empty owner fields', () => {
    const matches = PLATFORM_HTML.match(/platform\/monetag\.js/g) || [];
    expect(matches.length).toBe(1);
    expect(PLATFORM_HTML).toContain('data-monetag-enabled="false"');
    expect(PLATFORM_HTML).toContain('data-monetag-publisher-id=""');
    expect(PLATFORM_HTML).toContain('data-monetag-script-url=""');
    expect(PLATFORM_HTML).toContain('data-omnistore-monetag="true"');
  });

  test('no fabricated Monetag publisher ID or third-party script URL on public surfaces', () => {
    const surfaces = PLATFORM_HTML + '\n' + INDEX_HTML + '\n' + MONETAG_SRC;
    for (const marker of FAKE_MARKERS) {
      expect(surfaces).not.toContain(marker);
    }
    // No external monetag host in any script src on platform/index HTML.
    expect(PLATFORM_HTML).not.toMatch(/<script[^>]+src=["']https?:\/\/[^"']*monetag/i);
    expect(INDEX_HTML).not.toMatch(/monetag/i);
  });

  test('ERP index.html does not load Monetag (private/auth surface)', () => {
    expect(INDEX_HTML.toLowerCase()).not.toContain('monetag');
    expect(INDEX_HTML).not.toContain('platform/monetag.js');
  });

  test('boundary is isolated after core platform script (single loader tag order)', () => {
    const pIdx = PLATFORM_HTML.indexOf('platform/platform.js');
    const mIdx = PLATFORM_HTML.indexOf('platform/monetag.js');
    expect(pIdx).toBeGreaterThan(-1);
    expect(mIdx).toBeGreaterThan(pIdx);
  });
});

describe('Monetag boundary — disabled = zero external load', () => {
  test('default/disabled configure never injects a script tag', () => {
    const { api, injected } = loadBoundary({ enabled: false, publisherId: '', scriptUrl: '' });
    const result = api.load();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('disabled_or_owner_input_required');
    expect(injected.length).toBe(0);
    expect(api.isLoaded()).toBe(false);
    expect(api.getConfig().activation).toBe('OWNER_INPUT_REQUIRED');
  });

  test('enabled without owner publisher id / script url still blocks load', () => {
    const cases = [
      { enabled: true, publisherId: '', scriptUrl: '' },
      { enabled: true, publisherId: 'OWNER_REQUIRED', scriptUrl: 'https://example.com/a.js' },
      { enabled: true, publisherId: 'real-id-value', scriptUrl: '' },
      { enabled: true, publisherId: 'real-id-value', scriptUrl: 'http://insecure.example/a.js' },
      { enabled: true, publisherId: 'real-id-value', scriptUrl: 'javascript:alert(1)' }
    ];
    for (const cfg of cases) {
      const { api, injected } = loadBoundary(cfg);
      const result = api.load();
      expect(result.ok).toBe(false);
      expect(injected.length).toBe(0);
      expect(api.isLoaded()).toBe(false);
    }
  });

  test('no fake ID is treated as activatable', () => {
    const { api, injected } = loadBoundary({
      enabled: true,
      publisherId: 'YOUR_MONETAG_ID',
      scriptUrl: 'https://cdn.monetag.com/script.js'
    });
    // placeholder publisher blocked even if URL looks complete
    api.configure({ publisherId: 'YOUR_MONETAG_ID', scriptUrl: 'https://cdn.monetag.com/script.js' });
    const result = api.load();
    expect(result.ok).toBe(false);
    expect(injected.length).toBe(0);
  });
});

describe('Monetag boundary — loader singleton + core isolation', () => {
  test('valid owner config injects exactly one script; second load is no-op', () => {
    const { api, injected } = loadBoundary({
      enabled: true,
      publisherId: 'owner-supplied-real-id',
      scriptUrl: 'https://example.com/owner-approved-monetag.js'
    });
    const first = api.load();
    expect(first.ok).toBe(true);
    expect(injected.length).toBe(1);
    expect(injected[0].src).toBe('https://example.com/owner-approved-monetag.js');
    const second = api.load();
    expect(injected.length).toBe(1);
    expect(api.isLoaded()).toBe(true);
  });

  test('boundary source does not touch Visitors Now / ledger / sign-in / tenant isolation', () => {
    const forbidden = [
      'visitorsNow',
      'activity/heartbeat',
      'platformActivity',
      'treasury',
      'branchStore',
      'ENABLE_BRANCH_ISOLATION',
      'auth/login',
      'tenantStore',
      'requireAuth',
      'payments/webhook'
    ];
    for (const token of forbidden) {
      expect(MONETAG_SRC).not.toContain(token);
    }
    // Boundary must not rewrite or import platform.js
    expect(MONETAG_SRC).not.toContain('platform/platform.js');
    expect(MONETAG_SRC).not.toMatch(/innerHTML\s*=|document\.write/);
  });

  test('core init markers: platform.js still owns Visitors Now heartbeat', () => {
    expect(PLATFORM_JS).toContain('visitorsNow');
    expect(PLATFORM_JS).toContain("API + '/activity/heartbeat'");
    expect(PLATFORM_JS).toContain('setInterval(sendHeartbeat, 60000)');
    expect(PLATFORM_HTML).toContain('id="activity-visitors-now"');
    // platform.js must not reference monetag
    expect(PLATFORM_JS.toLowerCase()).not.toContain('monetag');
  });

  test('duplicate loader prevention: existing injected tag short-circuits', () => {
    const { api, injected } = loadBoundary({
      enabled: true,
      publisherId: 'owner-supplied-real-id',
      scriptUrl: 'https://example.com/owner-approved-monetag.js'
    });
    expect(api.load().ok).toBe(true);
    expect(injected.length).toBe(1);
    api.resetForTests();
    api.configure({
      enabled: true,
      publisherId: 'owner-supplied-real-id',
      scriptUrl: 'https://example.com/owner-approved-monetag.js'
    });
    api.load();
    expect(injected.length).toBe(1);
  });
});

describe('Monetag boundary — source hygiene', () => {
  test('module is fail-closed and exposes owner activation state', () => {
    expect(MONETAG_SRC).toContain('OWNER_INPUT_REQUIRED');
    expect(MONETAG_SRC).toContain('disabled_or_owner_input_required');
    expect(MONETAG_SRC).toContain("enabled: false");
    expect(MONETAG_SRC).toMatch(/publisherId:\s*''/);
    expect(MONETAG_SRC).toMatch(/scriptUrl:\s*''/);
  });

  test('no secret-looking material in boundary', () => {
    expect(MONETAG_SRC).not.toMatch(/api[_-]?key\s*[:=]\s*['"][^'"]{8,}/i);
    expect(MONETAG_SRC).not.toMatch(/secret\s*[:=]\s*['"][^'"]{8,}/i);
    expect(MONETAG_SRC).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{10,}/);
  });
});
