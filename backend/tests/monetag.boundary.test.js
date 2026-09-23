'use strict';

// Monetag integration boundary — focused static + behavioral checks.
//
// Proves:
//   1. Disabled boundary → zero external Monetag network loads.
//   2. No fabricated publisher ID / Monetag script URL in shipped surfaces.
//   3. Boundary cannot break or replace core app init / Visitors Now.
//   4. Single loader only (no duplicate injection).
//   5. Boundary/config element is never treated as an external loader.
//   6. Visitors Now markers in platform/platform.js remain the main implementation.
//
// Document model mirrors shipped platform.html: querySelectorAll includes the
// boundary/config element, not only scripts injected during the test.

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

function makeExternalLoaderScript(src) {
  const attrs = {
    'data-omnistore-monetag-external': 'true',
    'data-monetag-boundary': 'omnistore',
    src: String(src)
  };
  return {
    tagName: 'SCRIPT',
    async: true,
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null;
    },
    setAttribute(k, v) {
      attrs[k] = String(v);
    }
  };
}

function makeDocumentSandbox(options) {
  const opts = options || {};
  const injected = [];
  const head = {
    appendChild(el) {
      injected.push(el);
    }
  };

  // Shipped platform.html boundary/config element (present before any injection).
  const boundaryConfig = {
    tagName: 'SCRIPT',
    getAttribute(k) {
      if (k === 'src') return 'platform/monetag.js';
      if (k === 'data-omnistore-monetag-boundary') return 'config';
      if (k === 'data-monetag-enabled') return opts.boundaryEnabled != null ? String(opts.boundaryEnabled) : 'false';
      if (k === 'data-monetag-publisher-id') return opts.boundaryPublisherId != null ? String(opts.boundaryPublisherId) : '';
      if (k === 'data-monetag-script-url') return opts.boundaryScriptUrl != null ? String(opts.boundaryScriptUrl) : '';
      return null;
    },
    setAttribute() { /* config tag attrs are fixed by the page */ }
  };

  // Optional pre-existing external Monetag loader (not injected by this run).
  const preexisting = [];
  if (opts.existingExternalSrc) {
    preexisting.push(makeExternalLoaderScript(opts.existingExternalSrc));
  }

  function allScripts() {
    return [boundaryConfig].concat(preexisting, injected);
  }

  function matchesSelector(el, sel) {
    if (!el || !el.getAttribute) return false;
    const m = /^(?:script)?\[([a-zA-Z0-9_-]+)="([^"]*)"\]$/.exec(String(sel).trim());
    if (!m) return false;
    return el.getAttribute(m[1]) === m[2];
  }

  const doc = {
    head,
    body: head,
    documentElement: head,
    createElement(tag) {
      const attrs = {};
      const el = {
        tagName: String(tag).toUpperCase(),
        setAttribute(k, v) {
          attrs[k] = String(v);
        },
        getAttribute(k) {
          return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null;
        },
        async: false,
        src: '',
        attrs
      };
      return el;
    },
    getElementsByTagName(name) {
      if (String(name).toLowerCase() !== 'script') return [];
      return [boundaryConfig];
    },
    querySelectorAll(sel) {
      // Real-document behavior: includes boundary/config + preexisting + injected.
      return allScripts().filter(el => matchesSelector(el, sel));
    }
  };

  return { doc, injected, boundaryConfig };
}

function loadBoundary(configOverride, sandboxOptions) {
  const { doc, injected, boundaryConfig } = makeDocumentSandbox(sandboxOptions);
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
  return { api, injected, sandbox, doc, boundaryConfig };
}

function validOwnerConfig() {
  return {
    enabled: true,
    publisherId: 'owner-supplied-real-id',
    scriptUrl: 'https://example.com/owner-approved-monetag.js'
  };
}

describe('Monetag boundary — shipped HTML surfaces', () => {
  test('platform.html includes local boundary script once, disabled, empty owner fields', () => {
    const matches = PLATFORM_HTML.match(/platform\/monetag\.js/g) || [];
    expect(matches.length).toBe(1);
    expect(PLATFORM_HTML).toContain('data-monetag-enabled="false"');
    expect(PLATFORM_HTML).toContain('data-monetag-publisher-id=""');
    expect(PLATFORM_HTML).toContain('data-monetag-script-url=""');
    expect(PLATFORM_HTML).toContain('data-omnistore-monetag-boundary="config"');
    expect(PLATFORM_HTML).not.toContain('data-omnistore-monetag="true"');
    expect(PLATFORM_HTML).not.toContain('data-omnistore-monetag-external="true"');
  });

  test('no fabricated Monetag publisher ID or third-party script URL on public surfaces', () => {
    const surfaces = PLATFORM_HTML + '\n' + INDEX_HTML + '\n' + MONETAG_SRC;
    for (const marker of FAKE_MARKERS) {
      expect(surfaces).not.toContain(marker);
    }
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

describe('Monetag boundary — document model matches platform.html', () => {
  test('querySelectorAll includes boundary/config element', () => {
    const { doc } = loadBoundary();
    const configNodes = doc.querySelectorAll('script[data-omnistore-monetag-boundary="config"]');
    expect(configNodes.length).toBe(1);
    expect(configNodes[0].getAttribute('src')).toBe('platform/monetag.js');
    const externalNodes = doc.querySelectorAll('script[data-omnistore-monetag-external="true"]');
    expect(externalNodes.length).toBe(0);
  });

  test('boundary/config element alone is not an external loader', () => {
    const { api, injected, doc } = loadBoundary(validOwnerConfig());
    expect(api.canActivate()).toBe(true);
    // Boundary present in document must not block a first real injection.
    const result = api.load();
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('injected');
    expect(injected.length).toBe(1);
    expect(doc.querySelectorAll('script[data-omnistore-monetag-external="true"]').length).toBe(1);
    expect(doc.querySelectorAll('script[data-omnistore-monetag-boundary="config"]').length).toBe(1);
    expect(api.isLoaded()).toBe(true);
  });
});

describe('Monetag boundary — disabled = zero external load', () => {
  test('default/disabled configure never injects a script tag', () => {
    const { api, injected, doc } = loadBoundary({ enabled: false, publisherId: '', scriptUrl: '' });
    const result = api.load();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('disabled_or_owner_input_required');
    expect(injected.length).toBe(0);
    expect(api.isLoaded()).toBe(false);
    expect(api.getConfig().activation).toBe('OWNER_INPUT_REQUIRED');
    expect(doc.querySelectorAll('script[data-omnistore-monetag-external="true"]').length).toBe(0);
  });

  test('empty owner config still blocks load', () => {
    const cases = [
      { enabled: true, publisherId: '', scriptUrl: '' },
      { enabled: true, publisherId: 'OWNER_REQUIRED', scriptUrl: 'https://example.com/a.js' },
      { enabled: true, publisherId: 'real-id-value', scriptUrl: '' },
      { enabled: true, publisherId: 'real-id-value', scriptUrl: 'http://insecure.example/a.js' },
      { enabled: true, publisherId: 'real-id-value', scriptUrl: 'javascript:alert(1)' },
      { enabled: true, publisherId: 'real-id-value', scriptUrl: 'data:text/javascript,alert(1)' }
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
    api.configure({ publisherId: 'YOUR_MONETAG_ID', scriptUrl: 'https://cdn.monetag.com/script.js' });
    const result = api.load();
    expect(result.ok).toBe(false);
    expect(injected.length).toBe(0);
  });

  test('disabled boundary tag attrs on document model never inject', () => {
    const { api, injected } = loadBoundary(null, {
      boundaryEnabled: 'false',
      boundaryPublisherId: '',
      boundaryScriptUrl: ''
    });
    expect(api.getConfig().enabled).toBe(false);
    expect(api.load().ok).toBe(false);
    expect(injected.length).toBe(0);
    expect(api.isLoaded()).toBe(false);
  });
});

describe('Monetag boundary — real activation + loader singleton', () => {
  test('valid owner configuration injects exactly ONE external script; load success is real', () => {
    const { api, injected, doc } = loadBoundary(validOwnerConfig());
    const first = api.load();
    expect(first.ok).toBe(true);
    expect(first.reason).toBe('injected');
    expect(injected.length).toBe(1);
    expect(injected[0].getAttribute('data-omnistore-monetag-external')).toBe('true');
    expect(injected[0].src).toBe('https://example.com/owner-approved-monetag.js');
    expect(api.isLoaded()).toBe(true);
    expect(doc.querySelectorAll('script[data-omnistore-monetag-external="true"]').length).toBe(1);
    expect(doc.querySelectorAll('script[data-omnistore-monetag-boundary="config"]').length).toBe(1);
  });

  test('duplicate load: second call does not inject a second external script', () => {
    const { api, injected } = loadBoundary(validOwnerConfig());
    expect(api.load().ok).toBe(true);
    expect(injected.length).toBe(1);
    const second = api.load();
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('already_loaded');
    expect(injected.length).toBe(1);
    expect(api.isLoaded()).toBe(true);
  });

  test('existing actual external loader is recognized; no duplicate injection', () => {
    const { api, injected, doc } = loadBoundary(validOwnerConfig(), {
      existingExternalSrc: 'https://example.com/already-loaded.js'
    });
    expect(doc.querySelectorAll('script[data-omnistore-monetag-external="true"]').length).toBe(1);
    const result = api.load();
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('already_present');
    expect(api.isLoaded()).toBe(true);
    expect(injected.length).toBe(0);
    expect(doc.querySelectorAll('script[data-omnistore-monetag-external="true"]').length).toBe(1);
  });

  test('pre-existing external loader is not duplicated when boundary already active in state', () => {
    const { api, injected } = loadBoundary(validOwnerConfig(), {
      existingExternalSrc: 'https://example.com/already-loaded.js'
    });
    api.load();
    api.load();
    expect(injected.length).toBe(0);
    expect(api.isLoaded()).toBe(true);
  });
});

describe('Monetag boundary — core isolation', () => {
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
    expect(MONETAG_SRC).not.toContain('platform/platform.js');
    expect(MONETAG_SRC).not.toMatch(/innerHTML\s*=|document\.write/);
  });

  test('core init markers: platform.js still owns Visitors Now heartbeat', () => {
    expect(PLATFORM_JS).toContain('visitorsNow');
    expect(PLATFORM_JS).toContain("API + '/activity/heartbeat'");
    expect(PLATFORM_JS).toContain('setInterval(sendHeartbeat, 60000)');
    expect(PLATFORM_HTML).toContain('id="activity-visitors-now"');
    expect(PLATFORM_JS.toLowerCase()).not.toContain('monetag');
  });

  test('test-only reset helper is not exposed on the production API', () => {
    const { api } = loadBoundary();
    expect(api.resetForTests).toBeUndefined();
    expect(typeof api.load).toBe('function');
    expect(typeof api.configure).toBe('function');
    expect(typeof api.isLoaded).toBe('function');
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
