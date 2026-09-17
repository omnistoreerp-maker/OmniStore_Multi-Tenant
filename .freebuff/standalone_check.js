'use strict';
// Phase 34.5 standalone validation (round 2) — after hardening.
const fs = require('fs');
const vm = require('vm');
const { execSync } = require('child_process');

function extractFunction(html, name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\(', 'g');
  const match = re.exec(html);
  if (!match) throw new Error('function not found: ' + name);
  const start = match.index;
  const open = html.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error('unterminated function: ' + name);
}

const staged = execSync('git show :index.html', { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
const codeIsMaster = extractFunction(staged, 'isPlatformMaster');
const codeApplyNavScope = extractFunction(staged, 'applyNavScope');

function run(platformRole, useBackend, label) {
  const ctx = { USE_BACKEND: useBackend, console, document: { querySelectorAll: () => [], getElementById: () => ({ style: {} }) } };
  ctx.globalThis = ctx; ctx.window = ctx;
  if (platformRole !== '__undeclared__') ctx.platformRole = platformRole;
  vm.createContext(ctx);
  vm.runInContext(codeIsMaster, ctx);
  vm.runInContext(codeApplyNavScope, ctx);
  let r, threw = null;
  try { r = ctx.isPlatformMaster(); ctx.applyNavScope(); }
  catch (e) { threw = e.name + ': ' + e.message; }
  console.log(label, '-> isPlatformMaster:', r, '| applyNavScope:', threw ? 'THROWS ' + threw : 'ran clean');
}

run('__undeclared__', true,  '[A] platformRole UNDECLARED, backend on  (HEAD standalone)');
run('__undeclared__', false, '[B] platformRole UNDECLARED, backend off');
run('MASTER_OWNER',   true,  '[C] platformRole MASTER_OWNER, backend on  (behavior preserved)');
run(null,             true,  '[D] platformRole null, backend on        (tenant user)');

// Settings hub link guards present in staged blob
console.log('[E] staged guards:', {
  usersManagerGuarded: staged.includes("typeof openUsersManager === 'function' && openUsersManager()"),
  provisionWizardGuarded: staged.includes("typeof openProvisionWizard === 'function' && openProvisionWizard()")
});
