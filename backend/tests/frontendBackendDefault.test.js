'use strict';

// Frontend regression tests for default backend authentication mode (Phase 22A):
//   - getBackendConfig() defaults `enabled` to TRUE when no runtime config
//     exists in localStorage (fresh browser → backend-first authentication)
//   - getBackendConfig() honors an explicit `enabled: false` from localStorage
//     (preserves local/offline fallback when explicitly requested)
//   - getBackendConfig() defaults to TRUE on malformed JSON (safe fallback)
//   - getBackendConfig() treats missing `enabled` key as TRUE (default)
//
// The REAL getBackendConfig() is extracted from the shipped index.html (not a
// reimplementation) and evaluated against a mock localStorage, mirroring the
// existing frontendProvisionGating suite.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_PATH = path.resolve(__dirname, '..', '..', 'index.html');

function extractFunction(source, name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\(', 'g');
  const match = re.exec(source);
  if (!match) throw new Error('function not found: ' + name);
  const start = match.index;
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('unterminated function: ' + name);
}

function buildSandbox(localStorageData) {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const store = localStorageData || {};

  const context = {
    console,
    document: {
      getElementById: () => ({ style: {}, value: '', textContent: '', display: '' }),
      createElement: () => ({ style: {}, value: '', textContent: '', innerHTML: '' }),
      querySelectorAll: () => [],
      addEventListener: () => {}
    },
    localStorage: {
      _data: store,
      getItem(key) { return this._data[key] !== undefined ? this._data[key] : null; },
      setItem(key, value) { this._data[key] = value; },
      removeItem(key) { delete this._data[key]; }
    },
    navigator: { onLine: true, userAgent: 'node' },
    location: { href: 'http://localhost/', reload: () => {} },
    setTimeout,
    clearTimeout,
    window: {}
  };
  context.globalThis = context;
  context.window = context;

  const code = [
    "const BACKEND_CONFIG_KEY = 'esoBackendRuntimeConfig';",
    extractFunction(html, 'getBackendConfig')
  ].join('\n');

  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'index.html-backend-default.js' });

  return context;
}

describe('frontend backend-default mode (Phase 22A)', () => {
  test('fresh browser (no localStorage config) defaults to backend-enabled=true', () => {
    const ctx = buildSandbox({});
    const cfg = ctx.getBackendConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.apiBaseUrl).toBe('');
  });

  test('explicit enabled:false preserves local/offline mode', () => {
    const ctx = buildSandbox({ esoBackendRuntimeConfig: JSON.stringify({ enabled: false, apiBaseUrl: '' }) });
    const cfg = ctx.getBackendConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.apiBaseUrl).toBe('');
  });

  test('explicit enabled:true uses backend mode', () => {
    const ctx = buildSandbox({ esoBackendRuntimeConfig: JSON.stringify({ enabled: true, apiBaseUrl: 'http://api.local:3001' }) });
    const cfg = ctx.getBackendConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.apiBaseUrl).toBe('http://api.local:3001');
  });

  test('malformed JSON defaults to backend-enabled=true', () => {
    const ctx = buildSandbox({ esoBackendRuntimeConfig: 'not-json{' });
    const cfg = ctx.getBackendConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.apiBaseUrl).toBe('');
  });

  test('config with missing enabled key defaults to true', () => {
    const ctx = buildSandbox({ esoBackendRuntimeConfig: JSON.stringify({ apiBaseUrl: 'http://api.local:3001' }) });
    const cfg = ctx.getBackendConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.apiBaseUrl).toBe('http://api.local:3001');
  });
});
