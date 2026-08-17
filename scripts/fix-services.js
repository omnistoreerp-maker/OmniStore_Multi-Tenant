#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../backend');

// Standard services: identical _load/_save pattern, same collection key
const STANDARD = [
  { file: 'customers.service.js', collection: 'customers' },
  { file: 'suppliers.service.js', collection: 'suppliers' },
  { file: 'employees.service.js', collection: 'employees' },
  { file: 'partners.service.js', collection: 'partners' },
  { file: 'treasury.service.js', collection: 'entries' },
  { file: 'inventory.service.js', collection: 'products' },
  { file: 'inventoryTransactions.service.js', collection: 'transactions' },
  { file: 'dashboard.service.js', collection: 'dashboard' },
  { file: 'reports.service.js', collection: 'reports' },
  { file: 'voucher.service.js', collection: 'vouchers' },
];

for (const svc of STANDARD) {
  const filePath = path.join(ROOT, 'services', svc.file);
  let c = fs.readFileSync(filePath, 'utf8');
  const orig = c;
  
  // 1. Make _load() async and await repository.read()
  c = c.replace(
    /_load\(\)\s*\{\s*\r?\n\s*const db = repository\.read\(\);/,
    'async _load() {\r\n    const db = await repository.read();'
  );
  
  // 2. Make _save() async (already async in some, skip those)
  if (!c.includes('async _save')) {
    c = c.replace(
      /_save\(db\)\s*\{\s*return repository\.write\(db\);\s*\}/,
      'async _save(db) { return repository.write(db); }'
    );
  }
  
  // 3. Find all public methods that call this._load() or this._save()
  //    and make them async, add await
  const lines = c.split(/\r?\n/);
  const output = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    
    // Check if this line starts a method definition
    const methodMatch = line.match(/^(\s+)(list|getById|getByUsername|stats|create|update|delete|bumpTokenVersion|authenticate)\(([^)]*)\)\s*\{/);
    if (methodMatch) {
      // Check if method body contains this._load() or this._save()
      let bodyStart = i;
      let bodyEnd = i;
      let depth = 0;
      let foundOpen = false;
      for (let j = i; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === '{') { depth++; foundOpen = true; }
          if (ch === '}') depth--;
        }
        if (foundOpen && depth === 0) { bodyEnd = j; break; }
      }
      
      const body = lines.slice(bodyStart, bodyEnd + 1).join('\n');
      if (body.includes('this._load()') || body.includes('this._save(') ||
          body.includes('this.getByUsername(') || body.includes('this.getById(')) {
        // Make this method async
        output.push(line.replace(
          new RegExp(`^(\\s+)(${methodMatch[2]}\\()([^)]*)\\)(\\s*\\{)`),
          '$1async $2$3)$4'
        ));
        i++;
        
        // Now process the body: add await to this._load() and this._save()
        while (i <= bodyEnd) {
          let bodyLine = lines[i];
          // this._load() -> await this._load()
          bodyLine = bodyLine.replace(/=\s*this\._load\(\)/g, '= await this._load()');
          // this._save( -> await this._save(
          bodyLine = bodyLine.replace(/(\s+)(if\s*\(\s*)this\._save\(/g, '$1$2await this._save(');
          bodyLine = bodyLine.replace(/(\s+)(if\s*\(\s*await\s+)this\._save\(/g, '$1$2await this._save(');
          // this.getByUsername( -> await this.getByUsername(
          bodyLine = bodyLine.replace(/=\s*this\.getByUsername\(/g, '= await this.getByUsername(');
          output.push(bodyLine);
          i++;
        }
        continue;
      }
    }
    
    output.push(line);
    i++;
  }
  
  c = output.join('\n');
  
  if (c !== orig) {
    fs.writeFileSync(filePath, c, 'utf8');
    console.log(`✓ Fixed: ${svc.file}`);
  } else {
    console.log(`○ No changes: ${svc.file}`);
  }
}

// Handle sales.service.js separately (has _load(tenantContext))
{
  const filePath = path.join(ROOT, 'services', 'sales.service.js');
  let c = fs.readFileSync(filePath, 'utf8');
  const orig = c;
  
  // Make _load async
  c = c.replace(
    /_load\(tenantContext\)\s*\{\s*\r?\n\s*const repo = this\._repoFor\(tenantContext\);\s*\r?\n\s*return repo\.read\(\);/,
    'async _load(tenantContext) {\r\n    const repo = this._repoFor(tenantContext);\r\n    return repo.read();'
  );
  
  // Make _save async (if not already)
  if (!c.includes('async _save')) {
    c = c.replace(
      /_save\(db\)\s*\{\s*return repository\.write\(db\);\s*\}/,
      'async _save(db) { return repository.write(db); }'
    );
  }
  
  // Make all public methods that call this._load() async + add await
  const lines = c.split(/\r?\n/);
  const output = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    
    // Match class methods (inside a class)
    const methodMatch = line.match(/^(\s+)(list|getById|getStats|create|update|delete)\(([^)]*)\)\s*\{/);
    if (methodMatch) {
      // Find method body end
      let bodyStart = i;
      let bodyEnd = i;
      let depth = 0;
      let foundOpen = false;
      for (let j = i; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === '{') { depth++; foundOpen = true; }
          if (ch === '}') depth--;
        }
        if (foundOpen && depth === 0) { bodyEnd = j; break; }
      }
      
      const body = lines.slice(bodyStart, bodyEnd + 1).join('\n');
      if (body.includes('this._load(') || body.includes('this._save(') ||
          body.includes('this.createEntity') || body.includes('this.updateEntity') ||
          body.includes('this.deleteEntity') || body.includes('this.findEntity')) {
        // Make async
        output.push(line.replace(
          new RegExp(`^(\\s+)(${methodMatch[2]}\\()([^)]*)\\)(\\s*\\{)`),
          '$1async $2$3)$4'
        ));
        i++;
        
        // Add awaits in body
        while (i <= bodyEnd) {
          let bodyLine = lines[i];
          bodyLine = bodyLine.replace(/=\s*this\._load\(/g, '= await this._load(');
          bodyLine = bodyLine.replace(/(\s+)(if\s*\(\s*)this\._save\(/g, '$1$2await this._save(');
          bodyLine = bodyLine.replace(/(\s+)(if\s*\(\s*await\s+)this\._save\(/g, '$1$2await this._save(');
          bodyLine = bodyLine.replace(/(\s+)(if\s*\(\s*!)this\.createEntity\(/g, '$1$2await this.createEntity(');
          bodyLine = bodyLine.replace(/(\s+)(if\s*\(\s*!)this\.updateEntity\(/g, '$1$2await this.updateEntity(');
          bodyLine = bodyLine.replace(/(\s+)(if\s*\(\s*!)this\.deleteEntity\(/g, '$1$2await this.deleteEntity(');
          bodyLine = bodyLine.replace(/(\s+)const\s+(\w+)\s*=\s*this\.findEntity\(/g, '$1const $2 = await this.findEntity(');
          bodyLine = bodyLine.replace(/(\s+)const\s+(\w+)\s*=\s*this\.readCollection\(/g, '$1const $2 = await this.readCollection(');
          output.push(bodyLine);
          i++;
        }
        continue;
      }
    }
    
    output.push(line);
    i++;
  }
  
  c = output.join('\n');
  
  if (c !== orig) {
    fs.writeFileSync(filePath, c, 'utf8');
    console.log('✓ Fixed: sales.service.js');
  } else {
    console.log('○ No changes: sales.service.js');
  }
}

// Handle purchase.service.js (same as sales)
{
  const filePath = path.join(ROOT, 'services', 'purchase.service.js');
  let c = fs.readFileSync(filePath, 'utf8');
  const orig = c;
  
  c = c.replace(
    /_load\(tenantContext\)\s*\{\s*\r?\n\s*const repo = this\._repoFor\(tenantContext\);\s*\r?\n\s*return repo\.read\(\);/,
    'async _load(tenantContext) {\r\n    const repo = this._repoFor(tenantContext);\r\n    return repo.read();'
  );
  
  if (!c.includes('async _save')) {
    c = c.replace(
      /_save\(db\)\s*\{\s*return repository\.write\(db\);\s*\}/,
      'async _save(db) { return repository.write(db); }'
    );
  }
  
  const lines = c.split(/\r?\n/);
  const output = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const methodMatch = line.match(/^(\s+)(list|getById|getStats|create|update|delete)\(([^)]*)\)\s*\{/);
    if (methodMatch) {
      let bodyStart = i;
      let bodyEnd = i;
      let depth = 0;
      let foundOpen = false;
      for (let j = i; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === '{') { depth++; foundOpen = true; }
          if (ch === '}') depth--;
        }
        if (foundOpen && depth === 0) { bodyEnd = j; break; }
      }
      
      const body = lines.slice(bodyStart, bodyEnd + 1).join('\n');
      if (body.includes('this._load(') || body.includes('this._save(') ||
          body.includes('this.createEntity') || body.includes('this.updateEntity') ||
          body.includes('this.deleteEntity') || body.includes('this.findEntity')) {
        output.push(line.replace(
          new RegExp(`^(\\s+)(${methodMatch[2]}\\()([^)]*)\\)(\\s*\\{)`),
          '$1async $2$3)$4'
        ));
        i++;
        
        while (i <= bodyEnd) {
          let bodyLine = lines[i];
          bodyLine = bodyLine.replace(/=\s*this\._load\(/g, '= await this._load(');
          bodyLine = bodyLine.replace(/(\s+)(if\s*\(\s*)this\._save\(/g, '$1$2await this._save(');
          bodyLine = bodyLine.replace(/(\s+)(if\s*\(\s*await\s+)this\._save\(/g, '$1$2await this._save(');
          bodyLine = bodyLine.replace(/(\s+)(if\s*\(\s*!)this\.createEntity\(/g, '$1$2await this.createEntity(');
          bodyLine = bodyLine.replace(/(\s+)(if\s*\(\s*!)this\.updateEntity\(/g, '$1$2await this.updateEntity(');
          bodyLine = bodyLine.replace(/(\s+)(if\s*\(\s*!)this\.deleteEntity\(/g, '$1$2await this.deleteEntity(');
          bodyLine = bodyLine.replace(/(\s+)const\s+(\w+)\s*=\s*this\.findEntity\(/g, '$1const $2 = await this.findEntity(');
          bodyLine = bodyLine.replace(/(\s+)const\s+(\w+)\s*=\s*this\.readCollection\(/g, '$1const $2 = await this.readCollection(');
          output.push(bodyLine);
          i++;
        }
        continue;
      }
    }
    
    output.push(line);
    i++;
  }
  
  c = output.join('\n');
  
  if (c !== orig) {
    fs.writeFileSync(filePath, c, 'utf8');
    console.log('✓ Fixed: purchase.service.js');
  } else {
    console.log('○ No changes: purchase.service.js');
  }
}

console.log('\nDone. Run npm test to verify.');
