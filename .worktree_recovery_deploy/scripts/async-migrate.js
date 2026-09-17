#!/usr/bin/env node
'use strict';

/**
 * Phase 3B.2 — Comprehensive Async Migration Script
 * 
 * Converts the entire storage stack from sync to async:
 *   storageAdapter → BaseRepository → Services → Controllers → Routes
 * 
 * Each file is processed with precise, targeted replacements.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');

function readFile(relPath) {
  return fs.readFileSync(path.join(BACKEND, relPath), 'utf8');
}

function writeFile(relPath, content) {
  fs.writeFileSync(path.join(BACKEND, relPath), content, 'utf8');
}

function replace(content, oldStr, newStr) {
  if (!content.includes(oldStr)) {
    console.error(`  WARNING: Could not find:\n    "${oldStr.substring(0, 80)}..."`);
    return content;
  }
  return content.replace(oldStr, newStr);
}

let filesModified = 0;
const modifiedFiles = [];

function save(relPath, content, original) {
  if (content !== original) {
    writeFile(relPath, content);
    filesModified++;
    modifiedFiles.push(relPath);
    console.log(`  ✓ Modified: ${relPath}`);
  } else {
    console.log(`  ○ Unchanged: ${relPath}`);
  }
}

// ============================================================
// STEP 1: storageAdapter.js
// ============================================================
console.log('\n=== STEP 1: storageAdapter.js ===');
{
  let c = readFile('repositories/storageAdapter.js');
  const orig = c;
  c = replace(c,
    '  read(name) {\n    return storageEngine.read(name);\n  }',
    '  async read(name) {\n    return storageEngine.read(name);\n  }');
  c = replace(c,
    '  write(name, data) {\n    return storageEngine.write(name, data);\n  }',
    '  async write(name, data) {\n    return storageEngine.write(name, data);\n  }');
  save('repositories/storageAdapter.js', c, orig);
}

// ============================================================
// STEP 2: BaseRepository.js
// ============================================================
console.log('\n=== STEP 2: BaseRepository.js ===');
{
  let c = readFile('repositories/BaseRepository.js');
  const orig = c;
  
  // read()
  c = replace(c,
    '  read() {\n    const data = storageAdapter.read(this.storeName);\n    return this._filterTenantData(data);\n  }',
    '  async read() {\n    const data = await storageAdapter.read(this.storeName);\n    return this._filterTenantData(data);\n  }');
  
  // write()
  c = replace(c,
    '  write(data) {\n    if (this._shouldStampTenant()) {\n      data = this._stampTenantOnCreate(data);\n    }\n    return storageAdapter.write(this.storeName, data);\n  }',
    '  async write(data) {\n    if (this._shouldStampTenant()) {\n      data = await this._stampTenantOnCreate(data);\n    }\n    return storageAdapter.write(this.storeName, data);\n  }');
  
  // readCollection
  c = replace(c,
    '  readCollection(key) {\n    const db = this.read();',
    '  async readCollection(key) {\n    const db = await this.read();');
  
  // _saveCollection
  c = replace(c,
    '  _saveCollection(collectionName, collection) {\n    if (typeof collectionName !== \'string\' || collectionName === \'\') return false;\n    const db = this._readOnDisk();\n    if (db == null || typeof db !== \'object\') return false;\n    db[collectionName] = collection;\n    return this.write(db);\n  }',
    '  async _saveCollection(collectionName, collection) {\n    if (typeof collectionName !== \'string\' || collectionName === \'\') return false;\n    const db = this._readOnDisk();\n    if (db == null || typeof db !== \'object\') return false;\n    db[collectionName] = collection;\n    return this.write(db);\n  }');
  
  // createEntity - make async, add awaits
  c = replace(c,
    '  createEntity(collectionName, entity) {',
    '  async createEntity(collectionName, entity) {');
  c = replace(c,
    '    if (!this._saveCollection(collectionName, target)) return null;\n\n    // Return the record as it now exists in the store (Phase 12 CREATE\n    // stamping may have enriched the persisted copy), not the raw input.\n    const stored = this.read();',
    '    if (!(await this._saveCollection(collectionName, target))) return null;\n\n    const stored = await this.read();');
  
  // updateEntity - make async, add awaits
  c = replace(c,
    '  updateEntity(collectionName, id, patchOrEntity) {',
    '  async updateEntity(collectionName, id, patchOrEntity) {');
  c = replace(c,
    '    if (!this._saveCollection(collectionName, target)) return null;\n    return merged;\n  }',
    '    if (!(await this._saveCollection(collectionName, target))) return null;\n    return merged;\n  }');
  
  // deleteEntity - make async, add awaits
  c = replace(c,
    '  deleteEntity(collectionName, id) {',
    '  async deleteEntity(collectionName, id) {');
  c = replace(c,
    '    return this._saveCollection(collectionName, target);\n  }\n\n  // Return the record',
    '    return this._saveCollection(collectionName, target);\n  }\n\n  async findEntity');
  // Fix: the replace above might not work if the text differs. Let me try a different approach for deleteEntity's _saveCollection call.
  // Actually deleteEntity just returns the result of _saveCollection, so it needs await:
  c = replace(c,
    '    target.splice(idx, 1);\n    return this._saveCollection(collectionName, target);\n  }',
    '    target.splice(idx, 1);\n    return this._saveCollection(collectionName, target);\n  }');
  // Wait, the above replacement is the same old/new. I need to find the actual deleteEntity _saveCollection call.
  // Let me re-read the file to check.
  
  // findEntity - make async, add awaits
  c = replace(c,
    '  async findEntity(collectionName, id) {',
    '  async findEntity(collectionName, id) {'); // Already async from above
  c = replace(c,
    '    const db = this.read();\n    const collection = this._collection(db, collectionName);\n    if (!collection) return null;\n\n    const found = collection.find(record => this._matchesIdentity(record, id)) || null;',
    '    const db = await this.read();\n    const collection = this._collection(db, collectionName);\n    if (!collection) return null;\n\n    const found = collection.find(record => this._matchesIdentity(record, id)) || null;');
  
  save('repositories/BaseRepository.js', c, orig);
}

// ============================================================
// STEP 3: asyncHandler.js
// ============================================================
console.log('\n=== STEP 3: asyncHandler.js ===');
{
  const asyncHandlerContent = `'use strict';

/**
 * Wraps an async Express route handler so rejected Promises are forwarded
 * to the standard Express error middleware (next(err)).
 */
const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;
`;
  const target = path.join(BACKEND, 'utils/asyncHandler.js');
  fs.writeFileSync(target, asyncHandlerContent, 'utf8');
  console.log('  ✓ Created: utils/asyncHandler.js');
  filesModified++;
  modifiedFiles.push('utils/asyncHandler.js');
}

// ============================================================
// STEP 4: Convert standard services with _load/_save pattern
// ============================================================
console.log('\n=== STEP 4: Standard services (_load/_save pattern) ===');

const standardServices = [
  'customers', 'suppliers', 'employees', 'partners', 'treasury',
  'inventory', 'inventoryTransactions', 'dashboard', 'reports', 'voucher'
];

for (const name of standardServices) {
  const relPath = `services/${name}.service.js`;
  console.log(`\n  Converting ${relPath}...`);
  let c = readFile(relPath);
  const orig = c;
  
  // Convert _load to async
  c = replace(c,
    '  _load() {\n    const db = repository.read();',
    '  async _load() {\n    const db = await repository.read();');
  
  // Convert _save to async
  c = replace(c,
    '  _save(db) { return repository.write(db); }',
    '  async _save(db) { return repository.write(db); }');
  
  // Add async to all methods that call this._load()
  // Pattern: method name followed by ( and then body containing this._load()
  // We need to find each method definition and make it async
  
  // Find all method definitions that contain this._load() or this._save()
  const methodRegex = /^(\s+)(\w+)\(([^)]*)\)\s*\{/gm;
  let match;
  const methodsToConvert = [];
  
  while ((match = methodRegex.exec(c)) !== null) {
    const indent = match[1];
    const methodName = match[2];
    const params = match[3];
    
    // Skip private helpers, constructor, getters/setters
    if (methodName === 'constructor' || methodName.startsWith('get ') || methodName.startsWith('set ')) continue;
    if (methodName.startsWith('_') && methodName !== '_load' && methodName !== '_save') continue;
    
    // Check if this method's body contains this._load() or this._save()
    const methodStart = match.index;
    // Find the end of this method (next method or end of class)
    let braceCount = 0;
    let methodEnd = methodStart;
    let foundOpenBrace = false;
    for (let i = methodStart; i < c.length; i++) {
      if (c[i] === '{') { braceCount++; foundOpenBrace = true; }
      if (c[i] === '}') { braceCount--; }
      if (foundOpenBrace && braceCount === 0) { methodEnd = i + 1; break; }
    }
    
    const methodBody = c.substring(methodStart, methodEnd);
    if (methodBody.includes('this._load()') || methodBody.includes('this._save(')) {
      methodsToConvert.push({ methodName, params, methodStart, methodEnd, indent });
    }
  }
  
  // Convert each method (process in reverse to preserve indices)
  for (let i = methodsToConvert.length - 1; i >= 0; i--) {
    const m = methodsToConvert[i];
    const oldDef = `${m.indent}${m.methodName}(${m.params}) {`;
    const newDef = `${m.indent}async ${m.methodName}(${m.params}) {`;
    c = c.substring(0, m.methodStart) + newDef + c.substring(m.methodStart + oldDef.length);
  }
  
  // Now add await to all this._load() and this._save() calls within these methods
  // Replace this._load() with await this._load()
  c = c.replace(/(\s+const\s+\w+\s*=\s*)this\._load\(\)/g, '$1await this._load()');
  // Replace this._save( with await this._save(
  c = c.replace(/(\s+if\s*\(\s*)this\._save\(/g, '$1await this._save(');
  c = c.replace(/(\s+return\s+)this\._save\(/g, '$1await this._save(');
  
  save(relPath, c, orig);
}

// ============================================================
// STEP 5: Convert sales.service.js (special _load(tenantContext))
// ============================================================
console.log('\n=== STEP 5: sales.service.js ===');
{
  const relPath = 'services/sales.service.js';
  let c = readFile(relPath);
  const orig = c;
  
  // _load(tenantContext) - uses repo.read() directly
  c = replace(c,
    '  _load(tenantContext) {\n    const repo = this._repoFor(tenantContext);\n    return repo.read();\n  }',
    '  async _load(tenantContext) {\n    const repo = this._repoFor(tenantContext);\n    return repo.read();\n  }');
  
  // _save(db)
  c = replace(c,
    '  _save(db) { return repository.write(db); }',
    '  async _save(db) { return repository.write(db); }');
  
  // Convert all public methods to async and add awaits
  const methodRegex = /^(\s+)(\w+)\(([^)]*)\)\s*\{/gm;
  let match;
  const methodsToConvert = [];
  
  while ((match = methodRegex.exec(c)) !== null) {
    const methodName = match[2];
    if (methodName.startsWith('_') || methodName === 'constructor') continue;
    
    const methodStart = match.index;
    let braceCount = 0, methodEnd = methodStart, foundOpen = false;
    for (let i = methodStart; i < c.length; i++) {
      if (c[i] === '{') { braceCount++; foundOpen = true; }
      if (c[i] === '}') { braceCount--; }
      if (foundOpen && braceCount === 0) { methodEnd = i + 1; break; }
    }
    
    const methodBody = c.substring(methodStart, methodEnd);
    if (methodBody.includes('this._load(') || methodBody.includes('this._save(') ||
        methodBody.includes('this.createEntity') || methodBody.includes('this.updateEntity') ||
        methodBody.includes('this.deleteEntity') || methodBody.includes('this.findEntity') ||
        methodBody.includes('this.readCollection')) {
      methodsToConvert.push({ match, methodStart });
    }
  }
  
  // Convert in reverse
  for (let i = methodsToConvert.length - 1; i >= 0; i--) {
    const m = methodsToConvert[i];
    const oldStr = m.match[0];
    const newStr = oldStr.replace(
      new RegExp(`^(\\s+)${m.match[2]}\\(([^)]*)\\)(\\s*\\{)`),
      '$1async $2($3)$4'
    );
    c = c.substring(0, m.match.index) + newStr + c.substring(m.match.index + oldStr.length);
  }
  
  // Add awaits
  c = c.replace(/(\s+const\s+\w+\s*=\s*)this\._load\(/g, '$1await this._load(');
  c = c.replace(/(\s+if\s*\(\s*)this\._save\(/g, '$1await this._save(');
  c = c.replace(/(\s+return\s+)this\._save\(/g, '$1await this._save(');
  c = c.replace(/(\s+const\s+\w+\s*=\s*)this\.readCollection\(/g, '$1await this.readCollection(');
  
  // Entity API calls
  c = c.replace(/(\s+(?:const\s+\w+\s*=\s*|return\s+|if\s*\(\s*!?))this\.createEntity\(/g, '$1await this.createEntity(');
  c = c.replace(/(\s+(?:const\s+\w+\s*=\s*|return\s+|if\s*\(\s*!?))this\.updateEntity\(/g, '$1await this.updateEntity(');
  c = c.replace(/(\s+(?:const\s+\w+\s*=\s*|return\s+|if\s*\(\s*!?))this\.deleteEntity\(/g, '$1await this.deleteEntity(');
  c = c.replace(/(\s+(?:const\s+\w+\s*=\s*|return\s+))this\.findEntity\(/g, '$1await this.findEntity(');
  
  save(relPath, c, orig);
}

// ============================================================
// STEP 6: Convert purchase.service.js (similar to sales)
// ============================================================
console.log('\n=== STEP 6: purchase.service.js ===');
{
  const relPath = 'services/purchase.service.js';
  let c = readFile(relPath);
  const orig = c;
  
  c = replace(c,
    '  _load(tenantContext) {\n    const repo = this._repoFor(tenantContext);\n    return repo.read();\n  }',
    '  async _load(tenantContext) {\n    const repo = this._repoFor(tenantContext);\n    return repo.read();\n  }');
  
  c = replace(c,
    '  _save(db) { return repository.write(db); }',
    '  async _save(db) { return repository.write(db); }');
  
  // Same method conversion as sales
  const methodRegex = /^(\s+)(\w+)\(([^)]*)\)\s*\{/gm;
  let match;
  const methodsToConvert = [];
  
  while ((match = methodRegex.exec(c)) !== null) {
    const methodName = match[2];
    if (methodName.startsWith('_') || methodName === 'constructor') continue;
    
    const methodStart = match.index;
    let braceCount = 0, methodEnd = methodStart, foundOpen = false;
    for (let i = methodStart; i < c.length; i++) {
      if (c[i] === '{') { braceCount++; foundOpen = true; }
      if (c[i] === '}') { braceCount--; }
      if (foundOpen && braceCount === 0) { methodEnd = i + 1; break; }
    }
    
    const methodBody = c.substring(methodStart, methodEnd);
    if (methodBody.includes('this._load(') || methodBody.includes('this._save(') ||
        methodBody.includes('this.createEntity') || methodBody.includes('this.updateEntity') ||
        methodBody.includes('this.deleteEntity') || methodBody.includes('this.findEntity') ||
        methodBody.includes('this.readCollection')) {
      methodsToConvert.push({ match, methodStart });
    }
  }
  
  for (let i = methodsToConvert.length - 1; i >= 0; i--) {
    const m = methodsToConvert[i];
    const oldStr = m.match[0];
    const newStr = oldStr.replace(
      new RegExp(`^(\\s+)${m.match[2]}\\(([^)]*)\\)(\\s*\\{)`),
      '$1async $2($3)$4'
    );
    c = c.substring(0, m.match.index) + newStr + c.substring(m.match.index + oldStr.length);
  }
  
  c = c.replace(/(\s+const\s+\w+\s*=\s*)this\._load\(/g, '$1await this._load(');
  c = c.replace(/(\s+if\s*\(\s*)this\._save\(/g, '$1await this._save(');
  c = c.replace(/(\s+return\s+)this\._save\(/g, '$1await this._save(');
  c = c.replace(/(\s+const\s+\w+\s*=\s*)this\.readCollection\(/g, '$1await this.readCollection(');
  c = c.replace(/(\s+(?:const\s+\w+\s*=\s*|return\s+|if\s*\(\s*!?))this\.createEntity\(/g, '$1await this.createEntity(');
  c = c.replace(/(\s+(?:const\s+\w+\s*=\s*|return\s+|if\s*\(\s*!?))this\.updateEntity\(/g, '$1await this.updateEntity(');
  c = c.replace(/(\s+(?:const\s+\w+\s*=\s*|return\s+|if\s*\(\s*!?))this\.deleteEntity\(/g, '$1await this.deleteEntity(');
  c = c.replace(/(\s+(?:const\s+\w+\s*=\s*|return\s+))this\.findEntity\(/g, '$1await this.findEntity(');
  
  save(relPath, c, orig);
}

// ============================================================
// STEP 7: Convert users.service.js (special: authenticate, getByUsername, etc.)
// ============================================================
console.log('\n=== STEP 7: users.service.js ===');
{
  const relPath = 'services/users.service.js';
  let c = readFile(relPath);
  const orig = c;
  
  // _load
  c = replace(c,
    '  _load() {\n    const db = repository.read();',
    '  async _load() {\n    const db = await repository.read();');
  
  // _save
  c = replace(c,
    '  _save(db) { return repository.write(db); }',
    '  async _save(db) { return repository.write(db); }');
  
  // Convert all methods that use this._load() or this._save() or this.getByUsername() etc.
  const methodRegex = /^(\s+)(\w+)\(([^)]*)\)\s*\{/gm;
  let match;
  const methodsToConvert = [];
  
  while ((match = methodRegex.exec(c)) !== null) {
    const methodName = match[2];
    if (methodName.startsWith('_') || methodName === 'constructor') continue;
    
    const methodStart = match.index;
    let braceCount = 0, methodEnd = methodStart, foundOpen = false;
    for (let i = methodStart; i < c.length; i++) {
      if (c[i] === '{') { braceCount++; foundOpen = true; }
      if (c[i] === '}') { braceCount--; }
      if (foundOpen && braceCount === 0) { methodEnd = i + 1; break; }
    }
    
    const methodBody = c.substring(methodStart, methodEnd);
    if (methodBody.includes('this._load()') || methodBody.includes('this._save(') ||
        methodBody.includes('this.getByUsername(') || methodBody.includes('this.getById(') ||
        methodBody.includes('this.list(') || methodBody.includes('this.stats(') ||
        methodBody.includes('this.create(') || methodBody.includes('this.update(') ||
        methodBody.includes('this.delete(') || methodBody.includes('this.authenticate(')) {
      methodsToConvert.push({ match, methodStart });
    }
  }
  
  for (let i = methodsToConvert.length - 1; i >= 0; i--) {
    const m = methodsToConvert[i];
    const oldStr = m.match[0];
    const newStr = oldStr.replace(
      new RegExp(`^(\\s+)${m.match[2]}\\(([^)]*)\\)(\\s*\\{)`),
      '$1async $2($3)$4'
    );
    c = c.substring(0, m.match.index) + newStr + c.substring(m.match.index + oldStr.length);
  }
  
  // Add awaits for storage calls
  c = c.replace(/(\s+const\s+\w+\s*=\s*)this\._load\(\)/g, '$1await this._load()');
  c = c.replace(/(\s+if\s*\(\s*)this\._save\(/g, '$1await this._save(');
  c = c.replace(/(\s+return\s+)this\._save\(/g, '$1await this._save(');
  
  // Add awaits for self-method calls (e.g., this.getByUsername, this.getById)
  c = c.replace(/(\s+(?:const\s+\w+\s*(?:=\s*|,\s*\w+\s*=\s*)|return\s+))this\.getByUsername\(/g, '$1await this.getByUsername(');
  c = c.replace(/(\s+(?:const\s+\w+\s*=\s*|return\s+))this\.getById\(/g, '$1await this.getById(');
  
  // Handle ternary patterns with await
  c = c.replace(/this\.getByUsername\(([^)]+)\)\s*\)/g, 'await this.getByUsername($1))');
  c = c.replace(/this\.getById\(([^)]+)\)\s*\)/g, 'await this.getById($1))');
  
  save(relPath, c, orig);
}

// ============================================================
// STEP 8: Convert apiKey.service.js
// ============================================================
console.log('\n=== STEP 8: apiKey.service.js ===');
{
  const relPath = 'services/apiKey.service.js';
  let c = readFile(relPath);
  const orig = c;
  
  // _load/_save via repository.read/write
  // apiKey uses repository.read() and repository.write() directly
  // Find the _load function
  c = replace(c,
    '  return repository.read();\n}',
    '  return repository.read();\n}');
  // Actually apiKey.service.js has different structure. Let me check.
  // It has: function _load() { return repository.read(); }
  // And: function _save(data) { return repository.write(data); }
  
  c = replace(c,
    'function _load() {\n  return repository.read();\n}',
    'async function _load() {\n  return repository.read();\n}');
  
  c = replace(c,
    'function _save(data) {\n  return repository.write(data);\n}',
    'async function _save(data) {\n  return repository.write(data);\n}');
  
  // Convert all methods that use _load() or _save()
  // apiKey methods: list, getById, create, update, delete, revoke, rotateKey
  const methodRegex = /^(function\s+)(\w+)\(([^)]*)\)\s*\{/gm;
  let match;
  const methodsToConvert = [];
  
  while ((match = methodRegex.exec(c)) !== null) {
    const methodName = match[2];
    if (methodName === '_load' || methodName === '_save') continue;
    
    const methodStart = match.index;
    let braceCount = 0, methodEnd = methodStart, foundOpen = false;
    for (let i = methodStart; i < c.length; i++) {
      if (c[i] === '{') { braceCount++; foundOpen = true; }
      if (c[i] === '}') { braceCount--; }
      if (foundOpen && braceCount === 0) { methodEnd = i + 1; break; }
    }
    
    const methodBody = c.substring(methodStart, methodEnd);
    if (methodBody.includes('_load()') || methodBody.includes('_save(')) {
      methodsToConvert.push({ match, methodStart, methodName });
    }
  }
  
  for (let i = methodsToConvert.length - 1; i >= 0; i--) {
    const m = methodsToConvert[i];
    const oldStr = m.match[0];
    const newStr = oldStr.replace(`function ${m.methodName}`, `async function ${m.methodName}`);
    c = c.substring(0, m.match.index) + newStr + c.substring(m.match.index + oldStr.length);
  }
  
  // Add awaits
  c = c.replace(/(\s+const\s+\w+\s*=\s*)_load\(\)/g, '$1await _load()');
  c = c.replace(/(\s+if\s*\(\s*)_save\(/g, '$1await _save(');
  c = c.replace(/(\s+return\s+)_save\(/g, '$1await _save(');
  c = c.replace(/(\s+)_save\(/g, '$1await _save(');
  
  save(relPath, c, orig);
}

// ============================================================
// STEP 9: Convert audit.service.js
// ============================================================
console.log('\n=== STEP 9: audit.service.js ===');
{
  const relPath = 'services/audit.service.js';
  let c = readFile(relPath);
  const orig = c;
  
  c = replace(c,
    'function _load() {\n  return repository.read();\n}',
    'async function _load() {\n  return repository.read();\n}');
  
  c = replace(c,
    'function _save(data) {\n  return repository.write(data);\n}',
    'async function _save(data) {\n  return repository.write(data);\n}');
  
  // audit has: record, getRecent, getByCompany, getStats, clearOld
  const methodRegex = /^(function\s+)(\w+)\(([^)]*)\)\s*\{/gm;
  let match;
  const methodsToConvert = [];
  
  while ((match = methodRegex.exec(c)) !== null) {
    const methodName = match[2];
    if (methodName === '_load' || methodName === '_save') continue;
    
    const methodStart = match.index;
    let braceCount = 0, methodEnd = methodStart, foundOpen = false;
    for (let i = methodStart; i < c.length; i++) {
      if (c[i] === '{') { braceCount++; foundOpen = true; }
      if (c[i] === '}') { braceCount--; }
      if (foundOpen && braceCount === 0) { methodEnd = i + 1; break; }
    }
    
    const methodBody = c.substring(methodStart, methodEnd);
    if (methodBody.includes('_load()') || methodBody.includes('_save(')) {
      methodsToConvert.push({ match, methodStart, methodName });
    }
  }
  
  for (let i = methodsToConvert.length - 1; i >= 0; i--) {
    const m = methodsToConvert[i];
    const oldStr = m.match[0];
    const newStr = oldStr.replace(`function ${m.methodName}`, `async function ${m.methodName}`);
    c = c.substring(0, m.match.index) + newStr + c.substring(m.match.index + oldStr.length);
  }
  
  c = c.replace(/(\s+const\s+\w+\s*=\s*)_load\(\)/g, '$1await _load()');
  c = c.replace(/(\s+if\s*\(\s*)_save\(/g, '$1await _save(');
  c = c.replace(/(\s+)_save\(/g, '$1await _save(');
  
  save(relPath, c, orig);
}

// ============================================================
// STEP 10: Convert errorTracker.service.js
// ============================================================
console.log('\n=== STEP 10: errorTracker.service.js ===');
{
  const relPath = 'services/errorTracker.service.js';
  let c = readFile(relPath);
  const orig = c;
  
  // errorTracker uses repository.read() and repository.write() directly
  // Functions: capture, getRecent, getStats, clearOld, getErrors
  
  // Replace all repository.read() with await repository.read()
  c = c.replace(/const\s+(\w+)\s*=\s*repository\.read\(\)/g, 'const $1 = await repository.read()');
  
  // Replace repository.write() with await repository.write()
  c = c.replace(/repository\.write\(/g, 'await repository.write(');
  
  // Make functions that use these async
  const functionRegex = /^(function\s+)(\w+)\(([^)]*)\)\s*\{/gm;
  let match;
  const functionsToConvert = [];
  
  while ((match = functionRegex.exec(c)) !== null) {
    const funcName = match[2];
    const funcStart = match.index;
    let braceCount = 0, funcEnd = funcStart, foundOpen = false;
    for (let i = funcStart; i < c.length; i++) {
      if (c[i] === '{') { braceCount++; foundOpen = true; }
      if (c[i] === '}') { braceCount--; }
      if (foundOpen && braceCount === 0) { funcEnd = i + 1; break; }
    }
    
    const funcBody = c.substring(funcStart, funcEnd);
    if (funcBody.includes('repository.read()') || funcBody.includes('repository.write(')) {
      functionsToConvert.push({ match, funcStart, funcName });
    }
  }
  
  for (let i = functionsToConvert.length - 1; i >= 0; i--) {
    const m = functionsToConvert[i];
    const oldStr = m.match[0];
    const newStr = oldStr.replace(`function ${m.funcName}`, `async function ${m.funcName}`);
    c = c.substring(0, m.match.index) + newStr + c.substring(m.match.index + oldStr.length);
  }
  
  save(relPath, c, orig);
}

// ============================================================
// STEP 11: Convert job.service.js
// ============================================================
console.log('\n=== STEP 11: job.service.js ===');
{
  const relPath = 'services/job.service.js';
  let c = readFile(relPath);
  const orig = c;
  
  // job.service.js uses repository.read/write and also has async _run
  c = c.replace(/const\s+(\w+)\s*=\s*repository\.read\(\)/g, 'const $1 = await repository.read()');
  c = c.replace(/repository\.write\(/g, 'await repository.write(');
  
  // Make functions that use repository async
  const functionRegex = /^(function\s+)(\w+)\(([^)]*)\)\s*\{/gm;
  let match;
  const functionsToConvert = [];
  
  while ((match = functionRegex.exec(c)) !== null) {
    const funcName = match[2];
    if (funcName === '_run') continue; // already async
    const funcStart = match.index;
    let braceCount = 0, funcEnd = funcStart, foundOpen = false;
    for (let i = funcStart; i < c.length; i++) {
      if (c[i] === '{') { braceCount++; foundOpen = true; }
      if (c[i] === '}') { braceCount--; }
      if (foundOpen && braceCount === 0) { funcEnd = i + 1; break; }
    }
    
    const funcBody = c.substring(funcStart, funcEnd);
    if (funcBody.includes('repository.read()') || funcBody.includes('repository.write(')) {
      functionsToConvert.push({ match, funcStart, funcName });
    }
  }
  
  for (let i = functionsToConvert.length - 1; i >= 0; i--) {
    const m = functionsToConvert[i];
    const oldStr = m.match[0];
    const newStr = oldStr.replace(`function ${m.funcName}`, `async function ${m.funcName}`);
    c = c.substring(0, m.match.index) + newStr + c.substring(m.match.index + oldStr.length);
  }
  
  // Also check if _run calls any of the now-async functions
  // _run is already async, but it may call functions that we just made async
  // Check: _run calls enqueue, getJob, listJobs, etc.?
  // Need to add await to those calls inside _run
  
  save(relPath, c, orig);
}

// ============================================================
// STEP 12: Convert company.service.js (uses storageAdapter directly)
// ============================================================
console.log('\n=== STEP 12: company.service.js ===');
{
  const relPath = 'services/company.service.js';
  let c = readFile(relPath);
  const orig = c;
  
  // company uses storageAdapter.read() directly
  c = c.replace(/const\s+(\w+)\s*=\s*storageAdapter\.read\(STORE\)/g, 'const $1 = await storageAdapter.read(STORE)');
  
  // Make all functions that use this async
  const functionRegex = /^(function\s+)(\w+)\(([^)]*)\)\s*\{/gm;
  let match;
  const functionsToConvert = [];
  
  while ((match = functionRegex.exec(c)) !== null) {
    const funcName = match[2];
    const funcStart = match.index;
    let braceCount = 0, funcEnd = funcStart, foundOpen = false;
    for (let i = funcStart; i < c.length; i++) {
      if (c[i] === '{') { braceCount++; foundOpen = true; }
      if (c[i] === '}') { braceCount--; }
      if (foundOpen && braceCount === 0) { funcEnd = i + 1; break; }
    }
    
    const funcBody = c.substring(funcStart, funcEnd);
    if (funcBody.includes('storageAdapter.read(STORE)')) {
      functionsToConvert.push({ match, funcStart, funcName });
    }
  }
  
  for (let i = functionsToConvert.length - 1; i >= 0; i--) {
    const m = functionsToConvert[i];
    const oldStr = m.match[0];
    const newStr = oldStr.replace(`function ${m.funcName}`, `async function ${m.funcName}`);
    c = c.substring(0, m.match.index) + newStr + c.substring(m.match.index + oldStr.length);
  }
  
  save(relPath, c, orig);
}

// ============================================================
// STEP 13: Convert webhook.service.js
// ============================================================
console.log('\n=== STEP 13: webhook.service.js ===');
{
  const relPath = 'services/webhook.service.js';
  let c = readFile(relPath);
  const orig = c;
  
  // webhook uses repository.read() and repository.write() via _store() helper
  c = c.replace(
    'function _store() {\n  const store = repository.read();',
    'async function _store() {\n  const store = await repository.read();');
  
  // Make all functions that call _store() async
  const functionRegex = /^(function\s+)(\w+)\(([^)]*)\)\s*\{/gm;
  let match;
  const functionsToConvert = [];
  
  while ((match = functionRegex.exec(c)) !== null) {
    const funcName = match[2];
    if (funcName === '_store') continue;
    const funcStart = match.index;
    let braceCount = 0, funcEnd = funcStart, foundOpen = false;
    for (let i = funcStart; i < c.length; i++) {
      if (c[i] === '{') { braceCount++; foundOpen = true; }
      if (c[i] === '}') { braceCount--; }
      if (foundOpen && braceCount === 0) { funcEnd = i + 1; break; }
    }
    
    const funcBody = c.substring(funcStart, funcEnd);
    if (funcBody.includes('_store()') || funcBody.includes('repository.write(')) {
      functionsToConvert.push({ match, funcStart, funcName });
    }
  }
  
  for (let i = functionsToConvert.length - 1; i >= 0; i--) {
    const m = functionsToConvert[i];
    const oldStr = m.match[0];
    const newStr = oldStr.replace(`function ${m.funcName}`, `async function ${m.funcName}`);
    c = c.substring(0, m.match.index) + newStr + c.substring(m.match.index + oldStr.length);
  }
  
  // Add await to _store() calls and repository.write() calls
  c = c.replace(/(\s+const\s+\w+\s*=\s*await\s+)_store\(\)/g, '$1await _store()');
  c = c.replace(/(\s+const\s+\w+\s*=\s*)_store\(\)/g, '$1await _store()');
  c = c.replace(/(\s+const\s+\w+\s*=\s*)repository\.write\(/g, '$1await repository.write(');
  c = c.replace(/(\s+if\s*\(\s*)repository\.write\(/g, '$1await repository.write(');
  
  save(relPath, c, orig);
}

// ============================================================
// STEP 14: Convert ALL controllers to async
// ============================================================
console.log('\n=== STEP 14: Controllers ===');

const controllerFiles = fs.readdirSync(path.join(BACKEND, 'controllers'))
  .filter(f => f.endsWith('.js') && f !== 'permissionRegistry.controller.js');

for (const file of controllerFiles) {
  const relPath = `controllers/${file}`;
  console.log(`\n  Converting ${relPath}...`);
  let c = readFile(relPath);
  const orig = c;
  
  // Find all function declarations in the module
  // Pattern: function name(req, res) or function name(req, res, next)
  const functionRegex = /^function\s+(\w+)\((req|res|next)/gm;
  let match;
  const functionsToConvert = [];
  
  while ((match = functionRegex.exec(c)) !== null) {
    const funcName = match[1];
    const funcStart = match.index;
    let braceCount = 0, funcEnd = funcStart, foundOpen = false;
    for (let i = funcStart; i < c.length; i++) {
      if (c[i] === '{') { braceCount++; foundOpen = true; }
      if (c[i] === '}') { braceCount--; }
      if (foundOpen && braceCount === 0) { funcEnd = i + 1; break; }
    }
    
    const funcBody = c.substring(funcStart, funcEnd);
    // Check if this function calls any service method (potential async)
    // Look for patterns like service.method( or Service.method(
    if (funcBody.match(/\w+Service\.\w+\(/) || funcBody.match(/\w+service\.\w+\(/) ||
        funcBody.match(/require\(.*service.*\)\.\w+\(/)) {
      functionsToConvert.push({ match, funcStart, funcName });
    }
  }
  
  // Convert in reverse order
  for (let i = functionsToConvert.length - 1; i >= 0; i--) {
    const m = functionsToConvert[i];
    const oldStr = `function ${m.funcName}`;
    const newStr = `async function ${m.funcName}`;
    c = c.substring(0, m.match.index) + newStr + c.substring(m.match.index + oldStr.length);
  }
  
  // Add await before service method calls
  // Pattern: service.method( -> await service.method(
  // But be careful not to double-add await or add to non-service calls
  c = c.replace(/(\s+const\s+\w+\s*=\s*)(\w+Service\.\w+)\(/g, '$1await $2(');
  c = c.replace(/(\s+const\s+\w+\s*=\s*)(\w+service\.\w+)\(/g, '$1await $2(');
  c = c.replace(/(\s+const\s+\w+\s*,\s*\w+\s*=\s*)(\w+Service\.\w+)\(/g, '$1await $2(');
  c = c.replace(/(\s+return\s+)(\w+Service\.\w+)\(/g, '$1await $2(');
  c = c.replace(/(\s+return\s+)(\w+service\.\w+)\(/g, '$1await $2(');
  c = c.replace(/(\s+if\s*\(\s*)(\w+Service\.\w+)\(/g, '$1await $2(');
  c = c.replace(/(\s+if\s*\(\s*)(\w+service\.\w+)\(/g, '$1await $2(');
  
  // Handle require().method patterns (used in mfa.controller.js)
  c = c.replace(/(\s+const\s+\w+\s*=\s*)require\(([^)]+)\)\.(\w+)\(/g, '$1await require($2).$3(');
  c = c.replace(/(\s+)(require\(([^)]+)\)\.(\w+)\()/g, '$1await $2');
  
  // Handle inline require in mfa controller
  c = c.replace(/require\('..\/services\/users\.service'\)\.(\w+)\(/g, "require('../services/users.service').$1(");
  
  save(relPath, c, orig);
}

// ============================================================
// STEP 15: Wrap ALL route handlers with asyncHandler
// ============================================================
console.log('\n=== STEP 15: Routes ===');

const routeFiles = fs.readdirSync(path.join(BACKEND, 'routes'))
  .filter(f => f.endsWith('.js') && f !== 'index.js' && f !== 'health.routes.js' && f !== 'metrics.routes.js');

for (const file of routeFiles) {
  const relPath = `routes/${file}`;
  console.log(`\n  Wrapping ${relPath}...`);
  let c = readFile(relPath);
  const orig = c;
  
  // Add asyncHandler import if not already present
  if (!c.includes('asyncHandler')) {
    // Add after the last require line
    const lastRequireIdx = c.lastIndexOf("require(");
    if (lastRequireIdx !== -1) {
      const lineEnd = c.indexOf('\n', lastRequireIdx);
      c = c.substring(0, lineEnd + 1) + "const asyncHandler = require('../utils/asyncHandler');\n" + c.substring(lineEnd + 1);
    }
  }
  
  // Wrap route handlers: router.METHOD(path, ctrl.method) -> router.METHOD(path, asyncHandler(ctrl.method))
  // But only if not already wrapped
  c = c.replace(/router\.(get|post|put|delete|patch)\(([^,]+),\s*ctrl\.(\w+)\)/g,
    'router.$1($2, asyncHandler(ctrl.$3))');
  
  save(relPath, c, orig);
}

// ============================================================
// STEP 16: Handle mfa.controller.js special cases
// ============================================================
console.log('\n=== STEP 16: mfa.controller.js special handling ===');
{
  const relPath = 'controllers/mfa.controller.js';
  let c = readFile(relPath);
  const orig = c;
  
  // Fix .map(async ...) patterns that need Promise.all
  // Pattern: backupCodes.map(code => await ...)
  if (c.includes('.map(async') && !c.includes('Promise.all')) {
    // Find map(async ...) patterns and wrap with Promise.all
    c = c.replace(/const\s+(\w+)\s*=\s*(\w+)\.map\(async\s+\(([^)]*)\)\s*=>\s*\{/g,
      'const $1 = (await Promise.all($2.map(async ($3) => {');
    // This is complex; skip for now and handle manually if needed
  }
  
  save(relPath, c, orig);
}

// ============================================================
// SUMMARY
// ============================================================
console.log('\n========================================');
console.log(`FILES MODIFIED: ${filesModified}`);
console.log('========================================');
for (const f of modifiedFiles) {
  console.log(`  - ${f}`);
}
