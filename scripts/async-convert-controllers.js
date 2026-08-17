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
}

// Controllers
console.log('=== Controllers ===');
const ctrlFiles = fs.readdirSync(path.join(ROOT, 'controllers')).filter(f => f.endsWith('.js'));

for (const file of ctrlFiles) {
  let c = read('controllers/' + file);
  
  // Find function declarations with req/res that have service calls
  // Pattern: function name(req, res) { ... service.method() ... }
  const regex = /^(function )(\w+)\((req|_req),\s*res\b/gm;
  let match;
  const toConvert = [];
  
  while ((match = regex.exec(c)) !== null) {
    const start = match.index;
    const funcName = match[2];
    let depth = 0, found = false, end = start;
    for (let i = start; i < c.length; i++) {
      if (c[i] === '{') { depth++; found = true; }
      if (c[i] === '}') depth--;
      if (found && depth === 0) { end = i + 1; break; }
    }
    const body = c.substring(start, end);
    // Check for any service method calls
    if (body.match(/\w+[Ss]ervice\.\w+\(|CompanyService\.\w+\(|errorTracker\.\w+\(|auditService\.\w+\(|usersService\.\w+\(|mfaService\.\w+\(|require\(.*service.*\)\.\w+\(/)) {
      toConvert.push({ start, end, funcName, oldPrefix: match[1] });
    }
  }
  
  // Convert in reverse to preserve indices
  for (let i = toConvert.length - 1; i >= 0; i--) {
    const t = toConvert[i];
    c = c.substring(0, t.start) + 'async ' + c.substring(t.start);
  }
  
  // Add await to service method calls
  // Handle: const x = Service.method(
  c = c.replace(/(const\s+[\w, ]+\s*=\s*)(\w+Service\.\w+)\(/g, '$1await $2(');
  c = c.replace(/(const\s+[\w, ]+\s*=\s*)(\w+service\.\w+)\(/g, '$1await $2(');
  c = c.replace(/(const\s+[\w, ]+\s*=\s*)(CompanyService\.\w+)\(/g, '$1await $2(');
  c = c.replace(/(const\s+[\w, ]+\s*=\s*)(errorTracker\.\w+)\(/g, '$1await $2(');
  c = c.replace(/(const\s+[\w, ]+\s*=\s*)(auditService\.\w+)\(/g, '$1await $2(');
  
  // Handle: return Service.method(
  c = c.replace(/(return\s+)(\w+Service\.\w+)\(/g, '$1await $2(');
  c = c.replace(/(return\s+)(\w+service\.\w+)\(/g, '$1await $2(');
  c = c.replace(/(return\s+)(CompanyService\.\w+)\(/g, '$1await $2(');
  c = c.replace(/(return\s+)(errorTracker\.\w+)\(/g, '$1await $2(');
  
  // Handle: if (Service.method(
  c = c.replace(/(if\s*\(\s*)(\w+Service\.\w+)\(/g, '$1await $2(');
  c = c.replace(/(if\s*\(\s*)(\w+service\.\w+)\(/g, '$1await $2(');
  
  // Handle: success(res, Service.method(
  c = c.replace(/(success\(res,\s+)(\w+Service\.\w+)\(/g, '$1await $2(');
  c = c.replace(/(success\(res,\s+)(\w+service\.\w+)\(/g, '$1await $2(');
  c = c.replace(/(success\(res,\s+)(CompanyService\.\w+)\(/g, '$1await $2(');
  
  // Handle: return success(res, await Service.method(
  c = c.replace(/(return\s+success\(res,\s+await\s+)(\w+Service\.\w+)\(/g, '$1await $2(');
  
  // Handle require().method patterns (mfa.controller.js)
  c = c.replace(/(const\s+[\w, ]+\s*=\s*)require\(([^)]+)\)\.(\w+)\(/g, '$1await require($2).$3(');
  c = c.replace(/(require\('([^']+)'\)\.(\w+)\()/g, 'await $1');
  
  save('controllers/' + file, c);
}

// Routes
console.log('\n=== Routes ===');
const routeDir = path.join(ROOT, 'routes');
const routeFiles = fs.readdirSync(routeDir)
  .filter(f => f.endsWith('.js') && f !== 'index.js' && f !== 'health.routes.js' && f !== 'metrics.routes.js');

for (const file of routeFiles) {
  let c = read('routes/' + file);
  
  // Add asyncHandler import
  if (!c.includes('asyncHandler')) {
    const lastReq = c.lastIndexOf('require(');
    if (lastReq !== -1) {
      const lineEnd = c.indexOf('\r\n', lastReq);
      if (lineEnd !== -1) {
        c = c.substring(0, lineEnd + 2) + "const asyncHandler = require('../utils/asyncHandler');\r\n" + c.substring(lineEnd + 2);
      }
    }
  }
  
  // Wrap route handlers
  c = c.replace(/router\.(get|post|put|delete|patch)\(([^,]+),\s*ctrl\.(\w+)\)/g,
    'router.$1($2, asyncHandler(ctrl.$3))');
  
  save('routes/' + file, c);
}

console.log(`\nTotal files changed: ${changes}`);
