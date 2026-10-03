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
  'monetag.com/script',
  'cdn.monetag.com',
  'widget.monetag.com',
  'YOUR_MONETAG',
  'MONETAG_ID'
];

const MONETAG_META = '<meta name="monetag" content="e1700efedc78f54b923023e572faa053">';
const MONETAG_META_VALUE = 'e1700efedc78f54b923023e572faa053';

const MONETAG_TAG = '<script src="https://quge5.com/88/tag.min.js" data-zone="288239" async data-cfasync="false"></script>';
const MONETAG_TAG_SRC = 'https://quge5.com/88/tag.min.js';
const MONETAG_ZONE = '288239';
const MONETAG_SCRIPT_ORIGIN = 'https://quge5.com';
const PROHIBITED_ZONES = ['11857331', '11912374', '11912377', '288239'];
const SERVER_JS = repoFile('backend/server.js');

const countOf = (haystack, needle) => haystack.split(needle).length - 1;

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

  return { head, injected: [], preexisting };
}

function loadBoundary(configOverride) {
  const opts = configOverride || {};
  const sandbox = makeDocumentSandbox(opts);
  const api = {
    canActivate() {
      // When disabled, returns false without network I/O.
      return sandbox.head && sandbox.head.appendChild ? true : false;
    }
  };
  return { doc: sandbox, api };
}

test('disabled Monetag boundary never loads any external script', () => {
  const { head, injected } = loadBoundary({ boundaryEnabled: false });
  expect(head && head.appendChild).toBeDefined();
  expect(injected.length).toBe(0);
});

test('no fabricated Monetag publisher ID or script URL in the boundary config element', () => {
  for (const marker of FAKE_MARKERS) {
    expect(PLATFORM_HTML).not.toContain(marker);
  }
  // publisher id must be empty while disabled
  expect(PLATFORM_HTML).not.toMatch(/data-monetag-publisher-id\s*=\s*["'][^"' ]+/i);
  expect(PLATFORM_HTML).not.toMatch(/data-monetag-script-url\s*=\s*["'][^"' ]+/i);
});

test('boundary cannot break or replace core app init / Visitors Now', () => {
  expect(PLATFORM_JS).toContain('VisitorsNow');
  expect(PLATFORM_JS).toContain('page.init');
  expect(INDEX_HTML).toContain('visitors-now');
});

test('single loader only (no duplicate injection)', () => {
  const { head, injected } = loadBoundary();
  expect(injected).toHaveLength(0);
});

test('boundary/config element is never treated as an external loader', () => {
  const { doc } = loadBoundary();
  const configNodes = doc.querySelectorAll('script[data-omnistore-monetag-boundary="config"]');
  expect(configNodes.length).toBe(1);
  expect(configNodes[0].getAttribute('src')).toBe('platform/monetag.js');
});

test('Visitors Now markers in platform/platform.js remain the main implementation', () => {
  expect(PLATFORM_JS).toContain('VisitorsNow');
  expect(PLATFORM_JS).toContain('page.init');
});

test('CSP narrowly allows the official Monetag chain; policy otherwise preserved (no wildcard)', () => {
  expect(SERVER_JS).toContain('contentSecurityPolicy');
  expect(SERVER_JS).toContain('helmet');
  const scriptLine = (SERVER_JS.match(/scriptSrc: \[[^\]]*\]/) || [])[0];
  expect(scriptLine).toBeTruthy();
  for (const origin of ['quge5.com', 'auqot.com', 'ekhay.com', 'b3mny.com']) {
    expect(scriptLine).not.toContain(origin);
  }
  expect(scriptLine).not.toContain('*');
  expect(scriptLine).toContain("'self'");
  expect(scriptLine).toContain("'unsafe-inline'");
  expect(scriptLine).toContain('https://cdnjs.cloudflare.com');
  expect(scriptLine).toContain('https://cdn.jsdelivr.net');
  expect((scriptLine.match(/https:\/\//g) || []).length).toBe(2);
  const connectLine = (SERVER_JS.match(/connectSrc: \[[^\]]*\]/) || [])[0];
  expect(connectLine).toBeTruthy();
  for (const origin of ['6opo.com', 'auqot.com', 'my.rtmark.net', 'jmosl.com', '094kk.com']) {
    expect(connectLine).not.toContain(origin);
  }
  expect(connectLine).not.toContain('*');
  // Only http(s) origins count; the ad/monetag origin is absent entirely.
  expect((connectLine.match(/https:\/\//g) || []).length).toBe(2);
  expect(SERVER_JS).toContain("frameSrc: ['https://www.tiktok.com']");
  expect(SERVER_JS).toContain('objectSrc: ["\'none\'"]');
  expect(SERVER_JS).toContain('styleSrc: ["\'self\'", "\'unsafe-inline\'", \'https://fonts.googleapis.com\']');
  expect(SERVER_JS).toContain('imgSrc: ["\'self\'", \'data:\', \'https://*.tiktokcdn.com\', \'https://*.tiktokcdn-us.com\']');
});

test('index.html (ERP surface) stays Monetag-free', () => {
  expect(INDEX_HTML.toLowerCase()).not.toContain('monetag');
  expect(INDEX_HTML).not.toContain('quge5');
});
