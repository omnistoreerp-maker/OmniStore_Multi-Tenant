'use strict';

// omniAdSlot.test.cjs — behaviour contract for the platform ad-slot engine.
//
// The engine is the ONLY sanctioned ad surface. These checks run the real
// module (not a copy) against a minimal DOM stub and prove, from the outside:
//   1. Disabled by default → zero injected scripts, placeholder only.
//   2. Placeholder zone → still zero injected scripts (OWNER_INPUT_REQUIRED).
//   3. Every prohibited zone (288239, 11912374, 11912377, 11857331) is
//      hard-blocked even when the config says enabled with a valid URL.
//   4. A safe owner config injects EXACTLY ONE script, inside the slot's own
//      inner root — nothing is appended to the page anywhere else.
//   5. Non-https / pseudo-scheme URLs are rejected.
//   6. The engine never hardcodes a zone id and never touches the visitor
//      counter, cart or heartbeat machinery.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ENGINE_PATH = path.join(__dirname, '..', 'omniAdSlot.js');
const ENGINE_SRC = fs.readFileSync(ENGINE_PATH, 'utf8');

const PROHIBITED = ['288239', '11912374', '11912377', '11857331'];
const SAFE_ZONE = '555123456';

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('PASS  ' + name);
  } catch (err) {
    failed += 1;
    console.error('FAIL  ' + name + ' :: ' + err.message);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Minimal DOM stub — only what the engine actually uses.
// ---------------------------------------------------------------------------
function makeSlot() {
  const root = {
    children: [],
    textContent: '',
    firstChild: null,
    classList: { added: [], add(c) { this.added.push(c); } },
    appendChild(el) { this.children.push(el); },
    removeChild(el) { this.children = this.children.filter((c) => c !== el); }
  };
  const attrs = {};
  const slot = {
    querySelector(sel) { return sel === '[data-omni-ad-root]' ? root : null; },
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; }
  };
  return { slot, root, attrs };
}

function makeDoc(slots) {
  return {
    querySelectorAll(sel) { return sel === '[data-omni-ad]' ? slots : []; },
    createElement(tag) {
      const attrs = {};
      return {
        tagName: String(tag).toUpperCase(),
        attrs,
        src: '',
        async: false,
        setAttribute(k, v) { attrs[k] = String(v); },
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; }
      };
    }
  };
}

// Load the real engine fresh for each scenario (it caches config at call time).
function loadEngine(config, slots) {
  delete require.cache[require.resolve(ENGINE_PATH)];
  const { slot, root, attrs } = slots || makeSlot();
  global.OMNI_AD_CONFIG = config;
  global.document = makeDoc([slot]);
  const api = require(ENGINE_PATH);
  return { api, slot, root, attrs };
}

function cleanup() {
  delete global.OMNI_AD_CONFIG;
  delete global.document;
}

// ---------------------------------------------------------------------------
// 1. default = fully inert
// ---------------------------------------------------------------------------
check('engine source hardcodes no zone id and no ad URL', () => {
  assert.ok(!/data-zone="\d/.test(ENGINE_SRC), 'a literal zone attribute found in the engine');
  assert.strictEqual(ENGINE_SRC.split('quge5').length - 1, 0, 'engine must not carry the ad tag origin');
  for (const zone of PROHIBITED) {
    assert.ok(ENGINE_SRC.includes("'" + zone + "'"), 'prohibited zone must be listed: ' + zone);
  }
});

check('engine never touches visitor counter / heartbeat / cart machinery', () => {
  // Comments may name what the engine must never do; only code is scanned.
  const code = ENGINE_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const token of ['initOmniVisitors', 'visitorsNow', 'activity/heartbeat', 'localStorage', 'cart', 'fetch(', 'XMLHttpRequest']) {
    assert.ok(!code.includes(token), 'engine must stay isolated from: ' + token);
  }
});

check('DEFAULT: disabled → zero scripts injected, placeholder rendered', () => {
  const { api, root, attrs } = loadEngine(undefined);
  const result = api.init();
  assert.strictEqual(root.children.length, 0, 'no script may be injected while disabled');
  assert.strictEqual(result.state, 'disabled', 'state must report disabled');
  assert.ok(String(root.textContent).includes('Placeholder'), 'placeholder text missing');
  assert.strictEqual(attrs['data-omni-ad-state'], 'placeholder', 'slot state marker must be placeholder');
  assert.strictEqual(api.getConfig().activation, 'OWNER_INPUT_REQUIRED', 'activation must stay owner-input');
  cleanup();
});

check('PLACEHOLDER ZONE: enabled but OWNER_INPUT_REQUIRED → still inert', () => {
  for (const zone of ['OWNER_INPUT_REQUIRED', '', 'your_zone_here', 'todo']) {
    const { api, root } = loadEngine({ enabled: 'true', zone, scriptUrl: 'https://example.com/ads.js' });
    const result = api.init();
    assert.strictEqual(root.children.length, 0, 'zone "' + zone + '" must not inject');
    assert.strictEqual(result.state, 'owner_input_required', 'zone "' + zone + '" must report owner input');
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 2. prohibited zones are hard-blocked
// ---------------------------------------------------------------------------
check('PROHIBITED ZONES: all four are blocked even with enabled + valid https URL', () => {
  for (const zone of PROHIBITED) {
    const { api, root, attrs } = loadEngine({ enabled: 'true', zone, scriptUrl: 'https://example.com/ads.js' });
    const result = api.init();
    assert.strictEqual(root.children.length, 0, 'prohibited zone injected a script: ' + zone);
    assert.strictEqual(result.state, 'prohibited_zone_blocked', 'wrong state for ' + zone);
    assert.strictEqual(api.getConfig().enabled, false, 'config must refuse ' + zone);
    assert.strictEqual(attrs['data-omni-ad-state'], 'placeholder', 'slot must fall back to placeholder for ' + zone);
    cleanup();
  }
});

check('PROHIBITED ZONE LIST is exactly the documented four', () => {
  const { api } = loadEngine(undefined);
  assert.deepStrictEqual(api.getProhibitedZones().sort(), [...PROHIBITED].sort(), 'blocklist drifted');
  for (const zone of PROHIBITED) {
    assert.strictEqual(api.isProhibitedZone(zone), true, zone + ' must be prohibited');
  }
  assert.strictEqual(api.isProhibitedZone(SAFE_ZONE), false, 'safe zone wrongly flagged');
  cleanup();
});

// ---------------------------------------------------------------------------
// 3. insecure URLs rejected
// ---------------------------------------------------------------------------
check('INSECURE URLS: http / javascript: / data: / blob: all rejected', () => {
  for (const url of ['http://insecure.example/ads.js', 'javascript:alert(1)', 'data:text/javascript,x', 'blob:https://x/y']) {
    const { api, root } = loadEngine({ enabled: 'true', zone: SAFE_ZONE, scriptUrl: url });
    const result = api.init();
    assert.strictEqual(root.children.length, 0, 'insecure URL injected: ' + url);
    assert.strictEqual(result.state, 'invalid_script_url', 'wrong state for ' + url);
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 4. safe owner config → exactly one script, inside the slot only
// ---------------------------------------------------------------------------
check('SAFE CONFIG: injects exactly ONE script inside the slot root', () => {
  const { api, root, attrs } = loadEngine({ enabled: 'true', zone: SAFE_ZONE, scriptUrl: 'https://example.com/ads.js' });
  const result = api.init();
  assert.strictEqual(result.state, 'active', 'safe config must activate');
  assert.strictEqual(root.children.length, 1, 'exactly one script must be injected inside the slot');
  const script = root.children[0];
  assert.strictEqual(script.tagName, 'SCRIPT', 'injected node must be a script');
  assert.strictEqual(script.src, 'https://example.com/ads.js', 'script src must be the owner URL');
  assert.strictEqual(script.getAttribute('data-zone'), SAFE_ZONE, 'script must carry the owner zone');
  assert.strictEqual(script.async, true, 'script must stay async (never blocking)');
  assert.strictEqual(attrs['data-omni-ad-state'], 'active', 'slot state marker must be active');
  assert.strictEqual(api.getConfig().activation, 'READY', 'activation must report READY');
  cleanup();
});

check('ENGINE SOURCE: inline-only, no overlay/popup machinery in code', () => {
  const stripped = ENGINE_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const banned of ['position:fixed', 'position: fixed', 'z-index', 'zIndex', 'window.open', 'popunder', 'onclick', 'iframe', 'innerHTML']) {
    assert.ok(!stripped.toLowerCase().includes(banned.toLowerCase()), 'banned machinery: ' + banned);
  }
  assert.ok(stripped.includes("querySelectorAll('[data-omni-ad]')"), 'slot discovery must stay scoped');
  assert.ok(stripped.includes('root.appendChild(script)'), 'script must be appended inside the slot root');
});

console.log('\nomniAdSlot.test.cjs: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
