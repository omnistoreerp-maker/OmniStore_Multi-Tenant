'use strict';

// Release packaging contract: the frontend shells and their shared assets must
// be present in the production archive. Regression for the gap where the ZIP
// shipped only index.html while the server rewrites `/` to platform.html and
// sw.js precaches the other shells.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'build-release.js'), 'utf8');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('PASS  ' + name); }
  catch (err) { failed += 1; console.error('FAIL  ' + name + ' :: ' + err.message); process.exitCode = 1; }
}
function assert(cond, message) { if (!cond) throw new Error(message); }

function includeBlock() {
  const m = SRC.match(/const INCLUDE = \[([\s\S]*?)\];/);
  assert(m, 'INCLUDE array missing');
  return m[1];
}
function excludeBlock() {
  const m = SRC.match(/const EXCLUDE = \[([\s\S]*?)\];/);
  assert(m, 'EXCLUDE array missing');
  return m[1];
}

check('release INCLUDE keeps all original entries', () => {
  const block = includeBlock();
  ['package.json', '.env.example', 'index.html', 'manifest.json', 'sw.js', 'icons',
    'services', 'plugins', 'templates', 'backend', 'scripts/install-windows.ps1',
    'scripts/build-release.js'].forEach(function (entry) {
    assert(block.includes("'" + entry + "'"), 'missing original include: ' + entry);
  });
});

check('release INCLUDE ships all frontend shells and shared assets', () => {
  const block = includeBlock();
  ['platform.html', 'business.html', 'terms-of-service.html', 'privacy-policy.html',
    'platform'].forEach(function (entry) {
    assert(block.includes("'" + entry + "'"), 'missing frontend include: ' + entry);
  });
});

check('release EXCLUDE keeps runtime data and dev tests out of the archive', () => {
  const block = excludeBlock();
  ['backend/data', 'backend/tests', 'backend/coverage', 'backend/logs',
    'platform/tests', 'platform/education/education.test.cjs'].forEach(function (entry) {
    assert(block.includes("'" + entry + "'"), 'missing exclusion: ' + entry);
  });
});

check('real .env is still denied by basename', () => {
  assert(/isExcludedName/.test(SRC) && /\.env\.local/.test(SRC), 'basename deny missing');
  assert(!/INCLUDE[\s\S]{0,800}'\.env'/.test(SRC), 'real .env must not be included');
});

if (!failed) console.log('\nBUILD RELEASE PACKAGING TESTS PASSED');
