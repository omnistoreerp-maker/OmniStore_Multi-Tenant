#!/usr/bin/env node
'use strict';

/**
 * Phase 3B.2 — Precise async conversion script.
 * 
 * This script makes targeted, minimal changes:
 * 1. storageAdapter.js — read/write become async
 * 2. BaseRepository.js — read/write + entity methods become async
 * 3. All services — _load/_save become async, public methods become async
 * 4. All controllers — handlers become async with await
 * 5. All routes — wrap with asyncHandler
 * 
 * Uses Node's Buffer-safe string operations to avoid CRLF issues.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../backend');

let changes = 0;
const changed = [];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function write(rel, content) {
  const orig = read(rel);
  if (content !== orig) {
    fs.writeFileSync(path.join(ROOT, rel), content, 'utf8');
    changes++;
    changed.push(rel);
    console.log(`  ✓ ${rel}`);
  }
}

// ============================================================
// 1. storageAdapter.js
// ============================================================
console.log('\n=== storageAdapter.js ===');
{
  let c = read('repositories/storageAdapter.js');
  c = c.replace('  read(name) {\r\n    return storageEngine.read(name);\r\n  },',
                 '  async read(name) {\r\n    return storageEngine.read(name);\r\n  },');
  c = c.replace('  write(name, data) {\r\n    return storageEngine.write(name, data);\r\n  },',
                 '  async write(name, data) {\r\n    return storageEngine.write(name, data);\r\n  },');
  write('repositories/storageAdapter.js', c);
}

// ============================================================
// 2. BaseRepository.js — manual targeted replacements
// ============================================================
console.log('\n=== BaseRepository.js ===');
{
  let c = read('repositories/BaseRepository.js');
  
  // read()
  c = c.replace(
    '  read() {\r\n    const data = storageAdapter.read(this.storeName);\r\n    return this._filterTenantData(data);\r\n  }',
    '  async read() {\r\n    const data = await storageAdapter.read(this.storeName);\r\n    return this._filterTenantData(data);\r\n  }'
  );
  
  // write()
  c = c.replace(
    '  write(data) {\r\n    if (this._shouldStampTenant()) {\r\n      data = this._stampTenantOnCreate(data);\r\n    }\r\n    return storageAdapter.write(this.storeName, data);\r\n  }',
    '  async write(data) {\r\n    if (this._shouldStampTenant()) {\r\n      data = await this._stampTenantOnCreate(data);\r\n    }\r\n    return storageAdapter.write(this.storeName, data);\r\n  }'
  );
  
  // readCollection
  c = c.replace(
    '  readCollection(key) {\r\n    const db = this.read();',
    '  async readCollection(key) {\r\n    const db = await this.read();'
  );
  
  // _saveCollection
  c = c.replace(
    '  _saveCollection(collectionName, collection) {\r\n    if (typeof collectionName !== \'string\' || collectionName === \'\') return false;\r\n    const db = this._readOnDisk();\r\n    if (db == null || typeof db !== \'object\') return false;\r\n    db[collectionName] = collection;\r\n    return this.write(db);\r\n  }',
    '  async _saveCollection(collectionName, collection) {\r\n    if (typeof collectionName !== \'string\' || collectionName === \'\') return false;\r\n    const db = this._readOnDisk();\r\n    if (db == null || typeof db !== \'object\') return false;\r\n    db[collectionName] = collection;\r\n    return this.write(db);\r\n  }'
  );
  
  // createEntity
  c = c.replace(
    '  createEntity(collectionName, entity) {',
    '  async createEntity(collectionName, entity) {'
  );
  c = c.replace(
    '    if (!this._saveCollection(collectionName, target)) return null;\r\n\r\n    // Return the record as it now exists in the store (Phase 12 CREATE\r\n    // stamping may have enriched the persisted copy), not the raw input.\r\n    const stored = this.read();',
    '    if (!(await this._saveCollection(collectionName, target))) return null;\r\n\r\n    const stored = await this.read();'
  );
  
  // updateEntity
  c = c.replace(
    '  updateEntity(collectionName, id, patchOrEntity) {',
    '  async updateEntity(collectionName, id, patchOrEntity) {'
  );
  c = c.replace(
    '    if (!this._saveCollection(collectionName, target)) return null;\r\n    return merged;\r\n  }',
    '    if (!(await this._saveCollection(collectionName, target))) return null;\r\n    return merged;\r\n  }'
  );
  
  // deleteEntity
  c = c.replace(
    '  deleteEntity(collectionName, id) {',
    '  async deleteEntity(collectionName, id) {'
  );
  c = c.replace(
    '    return this._saveCollection(collectionName, target);\r\n  }\r\n\r\n  // Return the record matching',
    '    return this._saveCollection(collectionName, target);\r\n  }\r\n\r\n  async findEntity'
  );
  
  // findEntity
  c = c.replace(
    '  async findEntity(collectionName, id) {\r\n    if (typeof collectionName !== \'string\' || collectionName === \'\') return null;\r\n\r\n    const db = this.read();',
    '  async findEntity(collectionName, id) {\r\n    if (typeof collectionName !== \'string\' || collectionName === \'\') return null;\r\n\r\n    const db = await this.read();'
  );
  
  write('repositories/BaseRepository.js', c);
}

// ============================================================
// 3. asyncHandler.js
// ============================================================
console.log('\n=== asyncHandler.js ===');
{
  const content = `'use strict';

const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;
`;
  fs.writeFileSync(path.join(ROOT, 'utils/asyncHandler.js'), content, 'utf8');
  changes++;
  changed.push('utils/asyncHandler.js');
  console.log('  ✓ utils/asyncHandler.js');
}

// ============================================================
// 4. Convert all 19 services
// ============================================================
console.log('\n=== Services ===');

// Helper: convert a service with standard _load/_save pattern
function convertStandardService(relPath, collectionKey) {
  let c = read(relPath);
  
  // _load
  c = c.replace(
    '  _load() {\r\n    const db = repository.read();',
    '  async _load() {\r\n    const db = await repository.read();'
  );
  
  // _save (may already be async from _load, check first)
  if (!c.includes('async _save')) {
    c = c.replace(
      '  _save(db) { return repository.write(db); }',
      '  async _save(db) { return repository.write(db); }'
    );
  }
  
  // Make each public method async and add await
  const methods = ['list', 'getById', 'stats', 'create', 'update', 'delete'];
  for (const m of methods) {
    // Make async
    const re = new RegExp(`  ${m}\\(`);
    c = c.replace(re, `  async ${m}(`);
    // Add await to this._load()
    c = c.replace(/(\s+const\s+\w+\s*=\s*)this\._load\(\)/g, '$1await this._load()');
    // Add await to this._save(
    c = c.replace(/(\s+if\s*\(\s*)this\._save\(/g, '$1await this._save(');
  }
  
  write(relPath, c);
}

// Standard services
const standard = [
  'services/customers.service.js',
  'services/suppliers.service.js',
  'services/employees.service.js',
  'services/partners.service.js',
  'services/treasury.service.js',
  'services/inventory.service.js',
  'services/inventoryTransactions.service.js',
  'services/dashboard.service.js',
  'services/reports.service.js',
  'services/voucher.service.js',
];

for (const f of standard) {
  convertStandardService(f);
}

// sales.service.js — special: _load(tenantContext), entity API
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
  
  const methods = ['list', 'getById', 'getStats', 'create', 'update', 'delete'];
  for (const m of methods) {
    const re = new RegExp(`  ${m}\\(`);
    c = c.replace(re, `  async ${m}(`);
    // this._load( -> await this._load(
    c = c.replace(/(\s+const\s+\w+\s*=\s*)this\._load\(/g, '$1await this._load(');
    // this._save( -> await this._save(
    c = c.replace(/(\s+if\s*\(\s*)this\._save\(/g, '$1await this._save(');
    // Entity API calls
    c = c.replace(/(\s+(?:const\s+\w+\s*=\s*|return\s+|if\s*\(\s*!?))this\.createEntity\(/g, '$1await this.createEntity(');
    c = c.replace(/(\s+(?:const\s+\w+\s*=\s*|return\s+|if\s*\(\s*!?))this\.updateEntity\(/g, '$1await this.updateEntity(');
    c = c.replace(/(\s+(?:const\s+\w+\s*=\s*|return\s+|if\s*\(\s*!?))this\.deleteEntity\(/g, '$1await this.deleteEntity(');
    c = c.replace(/(\s+(?:const\s+\w+\s*=\s*|return\s+))this\.findEntity\(/g, '$1await this.findEntity(');
  }
  
  // Also convert stats() which isn't in the methods list
  c = c.replace('  stats(', '  async stats(');
  c = c.replace(/(\s+const\s+\w+\s*=\s*)this\._load\(/g, '$1await this._load(');
  
  write('services/sales.service.js', c);
}

// purchase.service.js — same as sales
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
  
  const methods = ['list', 'getById', 'getStats', 'create', 'update', 'delete'];
  for (const m of methods) {
    const re = new RegExp(`  ${m}\\(`);
    c = c.replace(re, `  async ${m}(`);
    c = c.replace(/(\s+const\s+\w+\s*=\s*)this\._load\(/g, '$1await this._load(');
    c = c.replace(/(\s+if\s*\(\s*)this\._save\(/g, '$1await this._save(');
    c = c.replace(/(\s+(?:const\s+\w+\s*=\s*|return\s+|if\s*\(\s*!?))this\.createEntity\(/g, '$1await this.createEntity(');
    c = c.replace(/(\s+(?:const\s+\w+\s*=\s*|return\s+|if\s*\(\s*!?))this\.updateEntity\(/g, '$1await this.updateEntity(');
    c = c.replace(/(\s+(?:const\s+\w+\s*=\s*|return\s+|if\s*\(\s*!?))this\.deleteEntity\(/g, '$1await this.deleteEntity(');
    c = c.replace(/(\s+(?:const\s+\w+\s*=\s*|return\s+))this\.findEntity\(/g, '$1await this.findEntity(');
  }
  
  c = c.replace('  stats(', '  async stats(');
  c = c.replace(/(\s+const\s+\w+\s*=\s*)this\._load\(/g, '$1await this._load(');
  
  write('services/purchase.service.js', c);
}

// users.service.js
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
  
  // Make all methods that call _load/_save/getByUsername/getById async
  const methods = ['list', 'getById', 'getByUsername', 'stats', 'create', 'update', 'delete', 'bumpTokenVersion', 'authenticate'];
  for (const m of methods) {
    const re = new RegExp(`  ${m}\\(`);
    c = c.replace(re, `  async ${m}(`);
    c = c.replace(/(\s+const\s+\w+\s*=\s*)this\._load\(\)/g, '$1await this._load()');
    c = c.replace(/(\s+if\s*\(\s*)this\._save\(/g, '$1await this._save(');
    c = c.replace(/(\s+const\s+\w+\s*=\s*)this\.getByUsername\(/g, '$1await this.getByUsername(');
    c = c.replace(/(\s+const\s+\w+\s*=\s*)this\.getById\(/g, '$1await this.getById(');
    c = c.replace(/(\s+if\s*\(\s*)this\.getByUsername\(/g, '$1await this.getByUsername(');
  }
  
  write('services/users.service.js', c);
}

// apiKey.service.js — uses repository.read/write directly
{
  let c = read('services/apiKey.service.js');
  // Make _load/_save/store async
  c = c.replace('function _load() {\r\n  return repository.read();\r\n}',
                 'async function _load() {\r\n  return repository.read();\r\n}');
  c = c.replace('function _save(data) {\r\n  return repository.write(data);\r\n}',
                 'async function _save(data) {\r\n  return repository.write(data);\r\n}');
  
  // Make all functions that use _load/_save async
  const funcs = ['generateKey', 'validateKey', 'touchKey', 'listKeys', 'getKey',
                 'revokeKey', 'deleteKey', 'setKeyEnabled', 'getKeyStats'];
  for (const fn of funcs) {
    c = c.replace(new RegExp(`function ${fn}\\(`), `async function ${fn}(`);
    c = c.replace(/(\s+const\s+\w+\s*=\s*)_load\(\)/g, '$1await _load()');
    c = c.replace(/(\s+if\s*\(\s*)_save\(/g, '$1await _save(');
    c = c.replace(/(\s+)_save\(/g, '$1await _save(');
  }
  
  write('services/apiKey.service.js', c);
}

// audit.service.js
{
  let c = read('services/audit.service.js');
  c = c.replace('function _load() {\r\n  return repository.read();\r\n}',
                 'async function _load() {\r\n  return repository.read();\r\n}');
  c = c.replace('function _save(data) {\r\n  return repository.write(data);\r\n}',
                 'async function _save(data) {\r\n  return repository.write(data);\r\n}');
  
  const funcs = ['record', 'query', 'getStats', 'getById'];
  for (const fn of funcs) {
    c = c.replace(new RegExp(`function ${fn}\\(`), `async function ${fn}(`);
    c = c.replace(/(\s+const\s+\w+\s*=\s*)_load\(\)/g, '$1await _load()');
    c = c.replace(/(\s+)_save\(/g, '$1await _save(');
  }
  
  write('services/audit.service.js', c);
}

// errorTracker.service.js
{
  let c = read('services/errorTracker.service.js');
  
  const funcs = ['capture', 'list', 'getById', 'setStatus', 'getStats'];
  for (const fn of funcs) {
    c = c.replace(new RegExp(`function ${fn}\\(`), `async function ${fn}(`);
    c = c.replace(/const\s+(\w+)\s*=\s*repository\.read\(\)/g, 'const $1 = await repository.read()');
    c = c.replace(/repository\.write\(/g, 'await repository.write(');
  }
  
  write('services/errorTracker.service.js', c);
}

// job.service.js
{
  let c = read('services/job.service.js');
  // _load/_save
  c = c.replace('  _load() {\r\n    const store = repository.read();',
                 '  async _load() {\r\n    const store = await repository.read();');
  c = c.replace('  _save(store) {\r\n    return repository.write(store);\r\n  }',
                 '  async _save(store) {\r\n    return repository.write(store);\r\n  }');
  
  // All methods
  const methods = ['enqueue', '_dequeue', '_complete', '_fail', 'getById', 'getStats', 'list'];
  for (const m of methods) {
    const re = new RegExp(`  ${m}\\(`);
    c = c.replace(re, `  async ${m}(`);
  }
  
  // Add await to all this._load() and this._save() calls
  c = c.replace(/const store = this\._load\(\)/g, 'const store = await this._load()');
  c = c.replace(/this\._save\(store\)/g, 'await this._save(store)');
  c = c.replace(/this\._complete\(job/g, 'await this._complete(job');
  c = c.replace(/this\._fail\(job/g, 'await this._fail(job');
  
  // _tick uses _dequeue (now async) - convert to .then chain
  c = c.replace(
    '    const job = this._dequeue();\r\n    if (!job) {\r\n      this._workerTimer = setTimeout(() => this._tick(), this._pollMs);\r\n      return;\r\n    }\r\n\r\n    this._active++;\r\n    this._run(job).finally(() => {\r\n      this._active--;\r\n      this._workerTimer = setTimeout(() => this._tick(), this._pollMs);\r\n    });\r\n  }',
    '    this._dequeue().then(job => {\r\n      if (!job) {\r\n        this._workerTimer = setTimeout(() => this._tick(), this._pollMs);\r\n        return;\r\n      }\r\n      this._active++;\r\n      this._run(job).finally(() => {\r\n        this._active--;\r\n        this._workerTimer = setTimeout(() => this._tick(), this._pollMs);\r\n      });\r\n    }).catch(() => {\r\n      this._workerTimer = setTimeout(() => this._tick(), this._pollMs);\r\n    });\r\n  }'
  );
  
  write('services/job.service.js', c);
}

// company.service.js
{
  let c = read('services/company.service.js');
  c = c.replace(
    '  listCompanies() {\r\n    return _toArray(storageAdapter.read(STORE));\r\n  },\r\n\r\n  getCompany(id) {\r\n    if (id == null || id === \'\') return null;\r\n    const key = String(id);\r\n    return this.listCompanies().find(c => c && String(c.id) === key) || null;\r\n  },\r\n\r\n  getActiveCompanies() {\r\n    return _sortAlphabetical(this.listCompanies().filter(c => c && c.active !== false));\r\n  }',
    '  async listCompanies() {\r\n    return _toArray(await storageAdapter.read(STORE));\r\n  },\r\n\r\n  async getCompany(id) {\r\n    if (id == null || id === \'\') return null;\r\n    const key = String(id);\r\n    return (await this.listCompanies()).find(c => c && String(c.id) === key) || null;\r\n  },\r\n\r\n  async getActiveCompanies() {\r\n    return _sortAlphabetical((await this.listCompanies()).filter(c => c && c.active !== false));\r\n  }'
  );
  
  write('services/company.service.js', c);
}

// webhook.service.js
{
  let c = read('services/webhook.service.js');
  c = c.replace('function _store() {\r\n  const store = repository.read();',
                 'async function _store() {\r\n  const store = await repository.read();');
  
  const funcs = ['register', 'list', 'getById', 'update', 'remove', 'dispatch', 'sendTest'];
  for (const fn of funcs) {
    c = c.replace(new RegExp(`function ${fn}\\(`), `async function ${fn}(`);
    c = c.replace(/(\s+const\s+\w+\s*=\s*)_store\(\)/g, '$1await _store()');
    c = c.replace(/(\s+)(repository\.write\()/g, '$1await $2');
  }
  
  write('services/webhook.service.js', c);
}

// ============================================================
// 5. Convert all controllers
// ============================================================
console.log('\n=== Controllers ===');

const controllerFiles = fs.readdirSync(path.join(ROOT, 'controllers'))
  .filter(f => f.endsWith('.js'));

for (const file of controllerFiles) {
  let c = read('controllers/' + file);
  
  // Find all function declarations that take req/res and call a service
  // Make them async and add await to service calls
  const funcRegex = /^(function\s+)(\w+)\((req|_req),\s*res/gm;
  let match;
  const funcs = [];
  
  while ((match = funcRegex.exec(c)) !== null) {
    // Find function body
    const start = match.index;
    let depth = 0, end = start, found = false;
    for (let i = start; i < c.length; i++) {
      if (c[i] === '{') { depth++; found = true; }
      if (c[i] === '}') depth--;
      if (found && depth === 0) { end = i + 1; break; }
    }
    const body = c.substring(start, end);
    
    // Check if body has service calls (potential async)
    if (body.match(/\w+Service\.\w+\(/) || body.match(/\w+service\.\w+\(/) ||
        body.match(/CompanyService\.\w+\(/) || body.match(/errorTracker\.\w+\(/) ||
        body.match(/require\(.*service.*\)\.\w+\(/)) {
      funcs.push({ match, start, name: match[2], end });
    }
  }
  
  // Convert in reverse
  for (let i = funcs.length - 1; i >= 0; i--) {
    const f = funcs[i];
    const old = `function ${f.name}`;
    const rep = `async function ${f.name}`;
    c = c.substring(0, f.start) + rep + c.substring(f.start + old.length);
  }
  
  // Add await to service method calls
  // Pattern: serviceMethod( at start of assignment or return
  c = c.replace(/(\s+(?:const|let|var)\s+[\w, ]+\s*=\s*)(\w+Service\.\w+)\(/g, '$1await $2(');
  c = c.replace(/(\s+(?:const|let|var)\s+[\w, ]+\s*=\s*)(\w+service\.\w+)\(/g, '$1await $2(');
  c = c.replace(/(\s+(?:const|let|var)\s+[\w, ]+\s*=\s*)(CompanyService\.\w+)\(/g, '$1await $2(');
  c = c.replace(/(\s+(?:const|let|var)\s+[\w, ]+\s*=\s*)(errorTracker\.\w+)\(/g, '$1await $2(');
  c = c.replace(/(\s+return\s+)(\w+Service\.\w+)\(/g, '$1await $2(');
  c = c.replace(/(\s+return\s+)(\w+service\.\w+)\(/g, '$1await $2(');
  c = c.replace(/(\s+return\s+)(CompanyService\.\w+)\(/g, '$1await $2(');
  c = c.replace(/(\s+return\s+)(errorTracker\.\w+)\(/g, '$1await $2(');
  c = c.replace(/(\s+return\s+success\(res,\s+)(\w+Service\.\w+)\(/g, '$1await $2(');
  c = c.replace(/(\s+return\s+success\(res,\s+await\s+)(\w+Service\.\w+)\(/g, '$1await $2(');
  c = c.replace(/(\s+if\s*\(\s*)(\w+Service\.\w+)\(/g, '$1await $2(');
  c = c.replace(/(\s+if\s*\(\s*)(\w+service\.\w+)\(/g, '$1await $2(');
  
  // Handle inline require patterns (mfa.controller.js)
  c = c.replace(/(\s+(?:const|let|var)\s+[\w, ]+\s*=\s*)require\(([^)]+)\)\.(\w+)\(/g, '$1await require($2).$3(');
  
  write('controllers/' + file, c);
}

// ============================================================
// 6. Wrap routes with asyncHandler
// ============================================================
console.log('\n=== Routes ===');

const routeFiles = fs.readdirSync(path.join(ROOT, 'routes'))
  .filter(f => f.endsWith('.js') && f !== 'index.js' && f !== 'health.routes.js' && f !== 'metrics.routes.js');

for (const file of routeFiles) {
  let c = read('routes/' + file);
  
  // Add import
  if (!c.includes('asyncHandler')) {
    const lastReq = c.lastIndexOf('require(');
    if (lastReq !== -1) {
      const lineEnd = c.indexOf('\r\n', lastReq);
      if (lineEnd !== -1) {
        c = c.substring(0, lineEnd + 2) + "const asyncHandler = require('../utils/asyncHandler');\r\n" + c.substring(lineEnd + 2);
      }
    }
  }
  
  // Wrap handlers
  c = c.replace(/router\.(get|post|put|delete|patch)\(([^,]+),\s*ctrl\.(\w+)\)/g,
    'router.$1($2, asyncHandler(ctrl.$3))');
  
  write('routes/' + file, c);
}

// ============================================================
// Summary
// ============================================================
console.log(`\n${'='.repeat(50)}`);
console.log(`FILES MODIFIED: ${changes}`);
for (const f of changed) console.log(`  - ${f}`);
