'use strict';

// ============================================================================
// FIRST COMPANY PROVISIONING (GO-LIVE)
// ============================================================================
// Deterministic, idempotent setup of the FIRST company + its initial admin
// user with company-scoped membership/role. Writes the same JSON stores the
// application uses (companies.json + users.json) through the storage adapter,
// so the exact same data is picked up on the next login.
//
//   npm run provision -- \
//     --company-name "Acme Trading" \
//     --company-code ACME \
//     --admin-username admin \
//     --admin-password '<strong-password>' \
//     --admin-role Owner
//
// All values can also come from environment variables (COMPANY_NAME,
// COMPANY_CODE, COMPANY_ID, ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_ROLE,
// ADMIN_FULLNAME). CLI flags win over env.
//
// SAFETY:
//   - idempotent: re-running never duplicates the company or the user
//   - the password is NEVER printed, logged, or stored anywhere but the
//     bcrypt hash inside users.json
//   - no credentials are hardcoded
//   - existing company data is never overwritten
// ============================================================================

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const storageAdapter = require('../repositories/storageAdapter');

// ----------------------------- arg parsing ---------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val !== undefined && !val.startsWith('--')) {
        args[key] = val;
        i++;
      } else {
        args[key] = 'true';
      }
    }
  }
  return args;
}

const argv = parseArgs(process.argv.slice(2));

function value(flag, envKey, fallback) {
  if (argv[flag] !== undefined) return argv[flag];
  if (process.env[envKey]) return process.env[envKey];
  return fallback;
}

// ----------------------------- validation ----------------------------------

function fail(msg) {
  console.error('ERROR: ' + msg);
  console.error('');
  console.error('Usage:');
  console.error('  npm run provision -- --company-name "Acme Trading" --company-code ACME \\');
  console.error('    --admin-username admin --admin-password "<strong-password>" [--admin-role Owner]');
  console.error('');
  console.error('Or via env: COMPANY_NAME COMPANY_CODE ADMIN_USERNAME ADMIN_PASSWORD [ADMIN_ROLE]');
  process.exit(1);
}

const companyName = (value('company-name', 'COMPANY_NAME', '') || '').trim();
const companyCode = (value('company-code', 'COMPANY_CODE', '') || '').trim();
const companyId = (value('company-id', 'COMPANY_ID', '') || '').trim() || companyCode.toLowerCase();
const adminUsername = (value('admin-username', 'ADMIN_USERNAME', 'admin') || 'admin').trim();
const adminPassword = value('admin-password', 'ADMIN_PASSWORD', '');
const adminRole = (value('admin-role', 'ADMIN_ROLE', 'Owner') || 'Owner').trim();
const adminFullName = (value('admin-fullname', 'ADMIN_FULLNAME', '') || '').trim() || `${companyName} Admin`;

if (!companyName) fail('--company-name (or COMPANY_NAME) is required');
if (!companyCode) fail('--company-code (or COMPANY_CODE) is required');
if (!/^[A-Za-z0-9_-]{2,20}$/.test(companyCode)) fail('company code must be 2-20 chars of letters/digits/_-');
if (!/^[A-Za-z0-9_-]{2,40}$/.test(companyId)) fail('company id must be 2-40 chars of letters/digits/_-');
if (!adminPassword) fail('--admin-password (or ADMIN_PASSWORD) is required — never reuse a known password');
if (adminPassword.length < 8) fail('admin password must be at least 8 characters');

// ----------------------------- store helpers -------------------------------

function readStore(name, empty) {
  try {
    const data = storageAdapter.read(name);
    return data && typeof data === 'object' ? data : empty;
  } catch (_) {
    return empty;
  }
}

function writeStore(name, data) {
  return storageAdapter.write(name, data);
}

// ----------------------------- main ----------------------------------------

// The company catalog may be persisted as a plain JSON array OR as a
// `{ companies: [...] }` object (company.service.js normalizes both shapes).
// Detect the on-disk shape, operate on the array, and write back in the SAME
// shape that was found so the catalog file is never reshaped in place.
function main() {
  const rawCompanies = readStore('companies', { companies: [] });
  const companiesAsArray = Array.isArray(rawCompanies)
    ? rawCompanies
    : (rawCompanies && Array.isArray(rawCompanies.companies) ? rawCompanies.companies : []);
  const preserveObjectShape = !Array.isArray(rawCompanies);

  const users = readStore('users', { users: [] });
  if (!Array.isArray(users.users)) users.users = [];

  // 1. Company (idempotent)
  const existingCompany = companiesAsArray.find(
    c => String(c.id) === companyId || String(c.code || '').toLowerCase() === companyCode.toLowerCase()
  );
  if (existingCompany) {
    console.log(`[company] already exists: ${existingCompany.id} (${existingCompany.name}) — reusing`);
  } else {
    const stamp = new Date().toISOString();
    companiesAsArray.push({
      id: companyId,
      code: companyCode,
      name: companyName,
      active: true,
      createdAt: stamp,
      updatedAt: stamp
    });
    // Write back in the same shape found on disk.
    const toPersist = preserveObjectShape ? { companies: companiesAsArray } : companiesAsArray;
    writeStore('companies', toPersist);
    console.log(`[company] created: ${companyId} (${companyName})`);
  }

  // 2. Admin user with company-scoped membership (idempotent)
  const existingUser = users.users.find(u => String(u.username).toLowerCase() === adminUsername.toLowerCase());
  const stamp = new Date().toISOString();

  if (existingUser) {
    // Never change an existing password; only ensure membership is present.
    const tenantIds = Array.isArray(existingUser.tenantIds) ? existingUser.tenantIds : [];
    const tenantRoles = existingUser.tenantRoles && typeof existingUser.tenantRoles === 'object' ? existingUser.tenantRoles : {};
    let changed = false;
    if (!tenantIds.includes(companyId)) { tenantIds.push(companyId); changed = true; }
    if (tenantRoles[companyId] !== adminRole) { tenantRoles[companyId] = adminRole; changed = true; }
    if (changed) {
      existingUser.tenantIds = tenantIds;
      existingUser.tenantRoles = tenantRoles;
      existingUser.updatedAt = stamp;
      writeStore('users', users);
      console.log(`[user] ${adminUsername}: membership for ${companyId} ensured (role ${adminRole}); password NOT changed`);
    } else {
      console.log(`[user] ${adminUsername} already has membership for ${companyId} (role ${adminRole})`);
    }
  } else {
    users.users.push({
      id: 'u-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      username: adminUsername,
      password: bcrypt.hashSync(adminPassword, 10),
      role: adminRole,
      fullName: adminFullName,
      tenantIds: [companyId],
      tenantRoles: { [companyId]: adminRole },
      createdAt: stamp,
      updatedAt: stamp
    });
    writeStore('users', users);
    console.log(`[user] created: ${adminUsername} with company-scoped role ${adminRole} on ${companyId}`);
  }

  // 3. Report (never prints secrets)
  const dataDir = process.env.DIGITRONICS_DATA_DIR
    ? path.resolve(process.env.DIGITRONICS_DATA_DIR)
    : path.join(__dirname, '..', 'data');
  console.log('');
  console.log('=== FIRST COMPANY READY ===');
  console.log('Data directory : ' + dataDir);
  console.log('Company        : ' + companyId + ' — ' + companyName + ' (code ' + companyCode + ')');
  console.log('Admin user     : ' + adminUsername + ' (role ' + adminRole + ')');
  console.log('');
  console.log('Start the application:  npm start   (or  npm run dev)');
  console.log('Open the app          :  http://localhost:' + (process.env.PORT || '3001'));
  console.log('Login flow            :  choose "' + companyName + '" at company selection, then log in with ' + adminUsername);
  console.log('');
  console.log('Recommended next: enable AUTH_REQUIRED=true in production and create a strong JWT_SECRET.');
}

main();
