'use strict';

// ============================================================================
// COMPANY PROVISIONING SERVICE — "تهيئة شركة جديدة"
// ============================================================================
// Creates a FULLY INDEPENDENT company/tenant from inside the application
// (Settings → Company Management). The new company receives:
//   - a Company record in the companies catalog
//   - a default Branch record (metadata on the company record; the frontend
//     seeds the scoped local DB via ensureBranches())
//   - an Owner user with company-scoped membership + tenantRoles
//   - an optional opening treasury balance (tenant-stamped to the NEW tenant)
//   - an audit record (COMPANY_CREATED)
//
// SECURITY INVARIANTS (preserved exactly):
//   - the tenantId is generated server-side (or validated against the existing
//     catalog) and is UNIQUE — a duplicate is rejected
//   - the new tenant's records are stamped with the NEW tenantId only; no data
//     from the current tenant is copied, migrated, or shared
//   - GitHub / Supabase / API credentials are NEVER inherited or copied
//   - the admin password is bcrypt-hashed, never logged, never returned
//   - on ANY failure, prior writes are rolled back (compensating writes) so a
//     half-provisioned tenant is never left behind
//
// Writes go through the storage adapter directly (exactly like the CLI
// provision-company.js) because the operation targets the NEW tenant while the
// request context belongs to the CURRENT tenant — the tenant-scoped repository
// must not stamp/filter against the caller's tenant.
// ============================================================================

const { v4: uuidv4 } = require('uuid');
const storageAdapter = require('../repositories/storageAdapter');
const { hashPassword } = require('../utils/password');
const { validatePassword } = require('../utils/passwordPolicy');
const auditService = require('./audit.service');
const logger = require('../utils/logger');

// Tenant id / company id / branch code charset — mirrors provision-company.js.
const ID_RE = /^[A-Za-z0-9_-]{2,40}$/;
const CODE_RE = /^[A-Za-z0-9_-]{1,20}$/;

// Normalize the companies catalog into an array regardless of on-disk shape.
function _companiesToArray(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.companies)) return data.companies;
  return [];
}

// Write the catalog back in the SAME shape found on disk.
function _companiesFromArray(arr, originalShapeIsArray) {
  return originalShapeIsArray ? arr : { companies: arr };
}

function _toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function _normalizeString(v, maxLen) {
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  return maxLen && s.length > maxLen ? s.slice(0, maxLen) : s;
}

// Read a store via the async adapter, tolerating missing/corrupt files.
async function _readStore(name, fallback) {
  try {
    const data = await storageAdapter.readAsync(name);
    return data && typeof data === 'object' ? data : fallback;
  } catch (e) {
    return fallback;
  }
}

/**
 * Provision a new company/tenant.
 *
 * @param {object} input
 * @param {object} actor  req.user (the authenticated provisioner)
 * @returns {Promise<{company: object, admin: object, branch: object,
 *           openingBalance: number, error?: string}>}
 */
async function provision(input = {}, actor) {
  const errors = [];

  // ---- normalize + validate -------------------------------------------------
  const companyName = _normalizeString(input.companyName, 100);
  const companyId = _normalizeString(input.companyId || input.tenantId || '', 40);
  const branchName = _normalizeString(input.branchName, 100) || 'Main Branch';
  const branchCode = _normalizeString(input.branchCode || 'MAIN', 20) || 'MAIN';
  const adminUsername = _normalizeString(input.adminUsername, 40);
  const adminFullName = _normalizeString(input.adminDisplayName || input.adminFullName, 100);
  const adminPassword = input.adminPassword === undefined || input.adminPassword === null ? '' : String(input.adminPassword);
  const phone = _normalizeString(input.phone, 40);
  const email = _normalizeString(input.email, 120);
  const address = _normalizeString(input.address, 250);
  const currency = _normalizeString(input.currency, 10) || 'EGP';
  const language = _normalizeString(input.language, 10) || 'ar';

  let openingBalance = 0;
  if (input.openingBalance !== undefined && input.openingBalance !== null && String(input.openingBalance).trim() !== '') {
    openingBalance = _toNumber(input.openingBalance);
    if (Number.isNaN(openingBalance) || openingBalance < 0) {
      errors.push('openingBalance must be a non-negative number');
    } else {
      openingBalance = Math.round(openingBalance * 100) / 100;
    }
  }

  if (!companyName) errors.push('companyName is required');
  if (!ID_RE.test(companyId)) errors.push('companyId must be 2-40 chars of letters/digits/_-');
  if (!CODE_RE.test(branchCode)) errors.push('branchCode must be 1-20 chars of letters/digits/_-');
  if (!adminUsername) errors.push('adminUsername is required');
  if (!/^[A-Za-z0-9_.-]{2,40}$/.test(adminUsername)) errors.push('adminUsername must be 2-40 chars of letters/digits/_.-');

  const passwordPolicy = validatePassword(adminPassword);
  if (!passwordPolicy.valid) {
    errors.push('adminPassword: ' + passwordPolicy.errors.join('; '));
  }

  if (errors.length) return { error: errors.join('; ') };

  const stamp = new Date().toISOString();

  // ---- read current state (for validation + rollback snapshots) --------------
  const companiesRaw = await _readStore('companies', { companies: [] });
  const companiesArray = _companiesToArray(companiesRaw);
  const companiesShapeIsArray = Array.isArray(companiesRaw);

  const usersRaw = await _readStore('users', { users: [] });
  if (!Array.isArray(usersRaw.users)) usersRaw.users = [];

  const treasuryRaw = await _readStore('treasury', { entries: [] });
  if (!Array.isArray(treasuryRaw.entries)) treasuryRaw.entries = [];

  // ---- uniqueness checks -----------------------------------------------------
  const idLower = companyId.toLowerCase();
  const duplicateCompany = companiesArray.find(c => {
    if (!c) return false;
    return String(c.id || '').toLowerCase() === idLower ||
           String(c.code || '').toLowerCase() === idLower;
  });
  if (duplicateCompany) return { error: 'A company with this id/code already exists' };

  const userLower = adminUsername.toLowerCase();
  if (usersRaw.users.some(u => String(u.username || '').toLowerCase() === userLower)) {
    return { error: 'A user with this username already exists' };
  }

  // ---- build the new records -------------------------------------------------
  const company = {
    id: companyId,
    code: companyId.toUpperCase(),
    name: companyName,
    active: true,
    contact: { phone, email, address },
    currency,
    language,
    branches: [
      { id: branchCode, name: branchName, code: branchCode, isDefault: true, active: true }
    ],
    defaultBranch: branchCode,
    provisionedBy: actor && actor.username ? actor.username : 'system',
    createdAt: stamp,
    updatedAt: stamp
  };

  const admin = {
    id: 'u-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    username: adminUsername,
    password: hashPassword(adminPassword),
    role: 'Owner',
    fullName: adminFullName || `${companyName} Admin`,
    phone,
    email,
    tenantIds: [companyId],
    tenantRoles: { [companyId]: 'Owner' },
    tokenVersion: 0,
    createdAt: stamp,
    updatedAt: stamp
  };

  // ---- write with compensating rollback --------------------------------------
  const snapshots = {
    companies: JSON.parse(JSON.stringify(companiesRaw)),
    users: JSON.parse(JSON.stringify(usersRaw)),
    treasury: JSON.parse(JSON.stringify(treasuryRaw))
  };

  const persist = async (name, data) => storageAdapter.writeAsync(name, data);
  const restore = async () => {
    await persist('companies', snapshots.companies);
    await persist('users', snapshots.users);
    await persist('treasury', snapshots.treasury);
  };

  try {
    // 1. company catalog
    companiesArray.push(company);
    const okCompany = await persist('companies', _companiesFromArray(companiesArray, companiesShapeIsArray));
    if (!okCompany) throw new Error('failed to persist company');

    // 2. owner user (company-scoped membership)
    usersRaw.users.push(admin);
    const okUser = await persist('users', usersRaw);
    if (!okUser) throw new Error('failed to persist user');

    // 3. optional opening treasury balance (stamped to the NEW tenant)
    if (openingBalance > 0) {
      treasuryRaw.entries.push({
        id: uuidv4(),
        type: 'in',
        amount: openingBalance,
        balance: openingBalance,
        method: 'opening',
        desc: 'رصيد افتتاحي',
        tenantId: companyId,
        entryKind: 'opening_balance',
        sourceModule: 'company_provision',
        createdAt: stamp,
        updatedAt: stamp
      });
      const okTreasury = await persist('treasury', treasuryRaw);
      if (!okTreasury) throw new Error('failed to persist opening balance');
    }
  } catch (err) {
    // Compensating rollback — never leave a half-provisioned tenant.
    logger.error('companyProvision rollback:', err.message);
    try { await restore(); } catch (restoreErr) {
      logger.error('companyProvision rollback failed:', restoreErr.message);
    }
    return { error: 'Provisioning failed — no company was created' };
  }

  // ---- audit (COMPANY_CREATED) — never any password/secret -------------------
  try {
    auditService.record({
      method: 'POST',
      path: '/api/v1/companies/provision',
      statusCode: 201,
      userId: actor && actor.id ? actor.id : null,
      action: 'COMPANY_CREATED',
      resource: 'company',
      resourceId: companyId,
      changes: {
        actor: actor && actor.username ? actor.username : 'system',
        currentCompany: actor && actor.tenantId ? actor.tenantId : null,
        newCompany: companyId,
        newTenant: companyId,
        branch: branchCode,
        openingBalance,
        result: 'success'
      }
    });
  } catch (err) {
    logger.error('companyProvision audit error:', err.message);
  }

  // The response NEVER includes the password (admin.password stays internal).
  const { password, ...adminSafe } = admin;
  return {
    company,
    admin: adminSafe,
    branch: { id: branchCode, name: branchName, code: branchCode },
    openingBalance
  };
}

module.exports = { provision };
