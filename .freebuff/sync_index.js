'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const staged = execSync('git show :index.html', { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
const reps = [
  // Revert ONLY the canAccessPage gate to the original Phase 34.1 string
  // (pinned verbatim by the pre-existing Phase 33 frontendPlatformGating test).
  ["if (page === 'platform-master') return !!(typeof platformRole !== 'undefined' && platformRole) && USE_BACKEND;", "if (page === 'platform-master') return !!platformRole && USE_BACKEND;"]
];
let out = staged;
reps.forEach(([a, b]) => {
  const n = out.split(a).length - 1;
  out = out.split(a).join(b);
  console.log('replacements of', JSON.stringify(a.slice(0, 60)), '->', n);
});
const tmp = path.join(os.tmpdir(), 'staged_index_fixed.html');
fs.writeFileSync(tmp, out);
const hash = execSync('git hash-object -w ' + tmp, { encoding: 'utf8' }).trim();
execSync('git update-index --cacheinfo 100644 ' + hash + ' index.html');
console.log('index.html index blob updated to', hash);
