#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../backend');

let changes = 0;

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function save(rel, c) {
  const orig = read(rel);
  if (c !== orig) { fs.writeFileSync(path.join(ROOT, rel), c, 'utf8'); changes++; console.log(`  ✓ ${rel}`); }
  else console.log(`  ○ ${rel}`);
}

// Standard services (10): identical _load/_save pattern
console.log('=== Standard services ===');
const standardFiles = [
  'customers', 'suppliers', 'employees', 'partners', 'treasury',
  'inventory', 'inventoryTransactions', 'dashboard', 'reports', 'voucher'
];

for (const name of standardFiles) {
  const rel = `services/${name}.service.js`;
  let c = read(rel);
  
  // _load -> async _load with await
  c = c.replace(
    '  _load() {\r\n    const db = repository.read();',
    '  async _load() {\r\n    const db = await repository.read();'
  );
  
  // _save -> async _save
  c = c.replace(
    '  _save(db) { return repository.write(db); }',
    '  async _save(db) { return repository.write(db); }'
  );
  
  // Make each public method async
  for (const m of ['list', 'getById', 'stats', 'create', 'update', 'delete']) {
    // Only if not already async
    const re = new RegExp(`  (?!async )${m}\\(`);
    c = c.replace(re, `  async ${m}(`);
  }
  
  // Add await to this._load() (only in assignments)
  c = c.replace(/= this\._load\(\)/g, '= await this._load()');
  
  // Add await to this._save( (only in if statements, once per call)
  // Use a unique marker to avoid recursive matching
  c = c.replace(/if \(this\._save\(/g, 'if (await this._save(');
  
  save(rel, c);
}

// sales.service.js
console.log('\n=== sales.service.js ===');
{
  let c = read('services/sales.service.js');
  
  c = c.replace(
    '  _load(tenantContext) {\r\n    const repo = this._repoFor(tenantContext);\r\n    return repo.read();\r\n  }',
    '  async _load(tenantContext) {\r\n    const repo = this._repoFor(tenantContext);\r\n    return repo.read();\r\n  }'
  );
  
  c = c.replace(
    '  _save(db) { return repository.write(db); }',
    '  async _save(db) { return repository.write(db); }'
  );
  
  for (const m of ['list', 'getById', 'stats', 'create', 'update', 'delete']) {
    const re = new RegExp(`  (?!async )${m}\\(`);
    c = c.replace(re, `  async ${m}(`);
  }
  
  c = c.replace(/= this\._load\(/g, '= await this._load(');
  c = c.replace(/if \(this\._save\(/g, 'if (await this._save(');
  
  // Entity API calls (in isolation-active branches)
  c = c.replace(/const created = repo\.createEntity\(/g, 'const created = await repo.createEntity(');
  c = c.replace(/const merged = repo\.updateEntity\(/g, 'const merged = await repo.updateEntity(');
  c = c.replace(/const ok = repo\.deleteEntity\(/g, 'const ok = await repo.deleteEntity(');
  c = c.replace(/return repo\.findEntity\(/g, 'return await repo.findEntity(');
  
  save('services/sales.service.js', c);
}

// purchase.service.js (same as sales)
console.log('\n=== purchase.service.js ===');
{
  let c = read('services/purchase.service.js');
  
  c = c.replace(
    '  _load(tenantContext) {\r\n    const repo = this._repoFor(tenantContext);\r\n    return repo.read();\r\n  }',
    '  async _load(tenantContext) {\r\n    const repo = this._repoFor(tenantContext);\r\n    return repo.read();\r\n  }'
  );
  
  c = c.replace(
    '  _save(db) { return repository.write(db); }',
    '  async _save(db) { return repository.write(db); }'
  );
  
  for (const m of ['list', 'getById', 'stats', 'create', 'update', 'delete']) {
    const re = new RegExp(`  (?!async )${m}\\(`);
    c = c.replace(re, `  async ${m}(`);
  }
  
  c = c.replace(/= this\._load\(/g, '= await this._load(');
  c = c.replace(/if \(this\._save\(/g, 'if (await this._save(');
  c = c.replace(/const created = repo\.createEntity\(/g, 'const created = await repo.createEntity(');
  c = c.replace(/const merged = repo\.updateEntity\(/g, 'const merged = await repo.updateEntity(');
  c = c.replace(/const ok = repo\.deleteEntity\(/g, 'const ok = await repo.deleteEntity(');
  c = c.replace(/return repo\.findEntity\(/g, 'return await repo.findEntity(');
  
  save('services/purchase.service.js', c);
}

// users.service.js
console.log('\n=== users.service.js ===');
{
  let c = read('services/users.service.js');
  
  c = c.replace(
    '  _load() {\r\n    const db = repository.read();',
    '  async _load() {\r\n    const db = await repository.read();'
  );
  
  c = c.replace(
    '  _save(db) { return repository.write(db); }',
    '  async _save(db) { return repository.write(db); }'
  );
  
  for (const m of ['list', 'getById', 'getByUsername', 'stats', 'create', 'update', 'delete', 'bumpTokenVersion', 'authenticate']) {
    const re = new RegExp(`  (?!async )${m}\\(`);
    c = c.replace(re, `  async ${m}(`);
  }
  
  c = c.replace(/= this\._load\(\)/g, '= await this._load()');
  c = c.replace(/if \(this\._save\(/g, 'if (await this._save(');
  c = c.replace(/= this\.getByUsername\(/g, '= await this.getByUsername(');
  c = c.replace(/if \(this\.getByUsername\(/g, 'if (await this.getByUsername(');
  
  save('services/users.service.js', c);
}

// apiKey.service.js - standalone functions
console.log('\n=== apiKey.service.js ===');
{
  let c = read('services/apiKey.service.js');
  
  c = c.replace('function _store() {\r\n  return repository.read();\r\n}', 'async function _store() {\r\n  return repository.read();\r\n}');
  c = c.replace('function _save(data) {\r\n  return repository.write(data);\r\n}', 'async function _save(data) {\r\n  return repository.write(data);\r\n}');
  
  for (const fn of ['generateKey', 'validateKey', 'touchKey', 'listKeys', 'getKey', 'revokeKey', 'deleteKey', 'setKeyEnabled', 'getKeyStats']) {
    c = c.replace(new RegExp(`function ${fn}\\(`), `async function ${fn}(`);
  }
  
  c = c.replace(/= _store\(\)/g, '= await _store()');
  c = c.replace(/if \(_save\(/g, 'if (await _save(');
  c = c.replace(/  _save\(/g, '  await _save(');
  
  save('services/apiKey.service.js', c);
}

// audit.service.js
console.log('\n=== audit.service.js ===');
{
  let c = read('services/audit.service.js');
  
  c = c.replace('function _store() {\r\n  return repository.read();\r\n}', 'async function _store() {\r\n  return repository.read();\r\n}');
  c = c.replace('function _save(data) {\r\n  return repository.write(data);\r\n}', 'async function _save(data) {\r\n  return repository.write(data);\r\n}');
  
  for (const fn of ['record', 'query', 'getStats', 'getById']) {
    c = c.replace(new RegExp(`function ${fn}\\(`), `async function ${fn}(`);
  }
  
  c = c.replace(/= _store\(\)/g, '= await _store()');
  c = c.replace(/  _save\(/g, '  await _save(');
  
  save('services/audit.service.js', c);
}

// errorTracker.service.js
console.log('\n=== errorTracker.service.js ===');
{
  let c = read('services/errorTracker.service.js');
  
  for (const fn of ['capture', 'list', 'getById', 'setStatus', 'getStats']) {
    c = c.replace(new RegExp(`function ${fn}\\(`), `async function ${fn}(`);
  }
  
  // Direct repository calls
  c = c.replace(/const (\w+) = repository\.read\(\)/g, 'const $1 = await repository.read()');
  c = c.replace(/repository\.write\(/g, 'await repository.write(');
  
  save('services/errorTracker.service.js', c);
}

// job.service.js - class-based
console.log('\n=== job.service.js ===');
{
  let c = read('services/job.service.js');
  
  c = c.replace('  _load() {\r\n    const store = repository.read();', '  async _load() {\r\n    const store = await repository.read();');
  c = c.replace('  _save(store) {\r\n    return repository.write(store);\r\n  }', '  async _save(store) {\r\n    return repository.write(store);\r\n  }');
  
  for (const m of ['enqueue', '_dequeue', '_complete', '_fail', 'getById', 'getStats', 'list']) {
    const re = new RegExp(`  (?!async )${m}\\(`);
    c = c.replace(re, `  async ${m}(`);
  }
  
  c = c.replace(/= this\._load\(\)/g, '= await this._load()');
  c = c.replace(/this\._save\(store\)/g, 'await this._save(store)');
  c = c.replace(/this\._complete\(job/g, 'await this._complete(job');
  c = c.replace(/this\._fail\(job/g, 'await this._fail(job');
  
  // _tick uses _dequeue (now async)
  c = c.replace(
    '    const job = this._dequeue();\r\n    if (!job) {\r\n      this._workerTimer = setTimeout(() => this._tick(), this._pollMs);\r\n      return;\r\n    }\r\n\r\n    this._active++;\r\n    this._run(job).finally(() => {\r\n      this._active--;\r\n      this._workerTimer = setTimeout(() => this._tick(), this._pollMs);\r\n    });\r\n  }',
    '    this._dequeue().then(job => {\r\n      if (!job) {\r\n        this._workerTimer = setTimeout(() => this._tick(), this._pollMs);\r\n        return;\r\n      }\r\n      this._active++;\r\n      this._run(job).finally(() => {\r\n        this._active--;\r\n        this._workerTimer = setTimeout(() => this._tick(), this._pollMs);\r\n      });\r\n    }).catch(() => {\r\n      this._workerTimer = setTimeout(() => this._tick(), this._pollMs);\r\n    });\r\n  }'
  );
  
  save('services/job.service.js', c);
}

// company.service.js
console.log('\n=== company.service.js ===');
{
  let c = read('services/company.service.js');
  
  c = c.replace(
    '  listCompanies() {\r\n    return _toArray(storageAdapter.read(STORE));\r\n  },\r\n\r\n  getCompany(id) {\r\n    if (id == null || id === \'\') return null;\r\n    const key = String(id);\r\n    return this.listCompanies().find(c => c && String(c.id) === key) || null;\r\n  },\r\n\r\n  getActiveCompanies() {\r\n    return _sortAlphabetical(this.listCompanies().filter(c => c && c.active !== false));\r\n  }',
    '  async listCompanies() {\r\n    return _toArray(await storageAdapter.read(STORE));\r\n  },\r\n\r\n  async getCompany(id) {\r\n    if (id == null || id === \'\') return null;\r\n    const key = String(id);\r\n    return (await this.listCompanies()).find(c => c && String(c.id) === key) || null;\r\n  },\r\n\r\n  async getActiveCompanies() {\r\n    return _sortAlphabetical((await this.listCompanies()).filter(c => c && c.active !== false));\r\n  }'
  );
  
  save('services/company.service.js', c);
}

// webhook.service.js
console.log('\n=== webhook.service.js ===');
{
  let c = read('services/webhook.service.js');
  
  c = c.replace('function _store() {\r\n  const store = repository.read();', 'async function _store() {\r\n  const store = await repository.read();');
  
  for (const fn of ['register', 'list', 'getById', 'update', 'remove', 'dispatch', 'sendTest']) {
    c = c.replace(new RegExp(`function ${fn}\\(`), `async function ${fn}(`);
  }
  
  c = c.replace(/= _store\(\)/g, '= await _store()');
  // repository.write calls - be specific to avoid double-await
  c = c.replace(/\r\n  repository\.write\(store\);/g, '\r\n  await repository.write(store);');
  // sendTest special case
  c = c.replace(/await _store\(\)\.entries\.find/g, '(await _store()).entries.find');
  
  save('services/webhook.service.js', c);
}

console.log(`\nTotal files changed: ${changes}`);
