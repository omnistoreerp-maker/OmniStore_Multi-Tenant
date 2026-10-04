'use strict';
// ---------------------------------------------------------------------------
// Master Control discoverability contract.
//
// Production bug this pins: applyNavScope() revealed the scope switcher with
// `switcher.style.display = isPlatformMaster() ? '' : 'none'`, but the
// stylesheet hides it by default (`#omniScopeSwitch{display:none;...}`).
// Assigning '' therefore fell straight back to `none`: the 👑 MASTER scope
// pill never appeared, every data-nav-scope="master" nav item stayed hidden,
// and مركز تحكم OmniStore was unreachable through the real UI even for a
// logged-in MASTER_OWNER. The switcher must be given a CONCRETE inline
// display that overrides the stylesheet default.
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..', '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const BUILDER = fs.readFileSync(path.join(ROOT, 'services', 'modulePlatform', 'navigationBuilder.js'), 'utf8');

let passed = 0;
let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed++;
    console.log('ok - ' + name);
  } catch (err) {
    failed++;
    console.error('not ok - ' + name + ': ' + err.message);
  }
};

check('the stylesheet hides #omniScopeSwitch by default (why an inline display is mandatory)', () => {
  assert.ok(/#omniScopeSwitch\s*\{[^}]*display\s*:\s*none/.test(INDEX),
    'expected CSS rule `#omniScopeSwitch{display:none...}`');
});

check('applyNavScope reveals the switcher with a concrete inline display, never the empty string', () => {
  const m = INDEX.match(/function applyNavScope\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(m, 'function applyNavScope() missing from index.html');
  const body = m[0];
  const sw = body.match(/switcher\.style\.display\s*=\s*isPlatformMaster\(\)\s*\?\s*([^:]+?)\s*:\s*'none'/);
  assert.ok(sw, 'switcher.style.display must be driven by isPlatformMaster() ? ... : \'none\'');
  const truthy = sw[1].trim();
  assert.notStrictEqual(truthy, "''",
    "the truthy branch must not be '' — that reverts to the stylesheet's display:none and hides the MASTER pill forever");
  assert.ok(/^'(block|flex|inline-flex|grid)'$/.test(truthy),
    'the truthy branch must be a concrete display value, got: ' + truthy);
});

check('the master-scope visibility rules stay in place (scope pill + master nav items)', () => {
  assert.ok(/function isPlatformMaster\(\)\s*\{[\s\S]*?platformRole[\s\S]*?USE_BACKEND/.test(INDEX),
    'isPlatformMaster() must read platformRole && USE_BACKEND');
  assert.ok(INDEX.includes('function setOmniNavScope('), 'setOmniNavScope missing');
  assert.ok(/querySelectorAll\('\[data-nav-scope="master"\]'\)/.test(INDEX),
    'applyNavScope must toggle [data-nav-scope="master"] items');
  assert.ok(/data-scope="master"/.test(INDEX) && /setOmniNavScope\('master'\)/.test(INDEX),
    'the 👑 MASTER pill must call setOmniNavScope(\'master\')');
});

check('the nav builder emits the Master Control entry with id + master scope', () => {
  assert.ok(/item\('platform-master',\s*'مركز تحكم OmniStore'/.test(BUILDER),
    "MASTER_NAV must contain item('platform-master', 'مركز تحكم OmniStore')");
  assert.ok(BUILDER.includes("item.route === 'platform-master' ? ' id=\"platformMasterNav\"'"),
    'renderItem must stamp id="platformMasterNav" on the entry');
  assert.ok(/data-nav-scope=/.test(BUILDER),
    'renderItem must stamp data-nav-scope so applyNavScope can gate it');
  assert.ok(/scopeVisible[\s\S]*?'master'\s*\)\s*return\s*isPlatformMaster/.test(BUILDER),
    'master-scope items must render only when isPlatformMaster()');
});

check('showPage routes the entry to the Master Control page', () => {
  assert.ok(/if \(page === 'platform-master'\) return !!platformRole && USE_BACKEND/.test(INDEX),
    'canAccessPage gate for platform-master missing');
  assert.ok(/if \(page === 'platform-master'\) renderPlatformMaster\(\)/.test(INDEX),
    'showPage must renderPlatformMaster() for platform-master');
});

console.log('\nmaster-nav-scope.test.cjs: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
