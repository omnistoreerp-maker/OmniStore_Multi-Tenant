'use strict';

// Platform Service — Master Control Center (Phase 33).
//
// Everything here operates at PLATFORM scope: company catalog, cross-tenant
// user directory, licenses, integrations, presence, audit. It is the ONLY
// backend surface that may read across tenants, and it is gated exclusively
// by requirePlatformAdmin (server-authoritative). Tenant repositories and
// tenant services are NEVER reused to reach across tenants; this module talks
// to the raw stores directly, exactly like the company catalog does.
//
// Suspension model:
//   company.status = 'SUSPENDED' (+ active=false), persisted on the company
//   record; every user bound to that tenant gets tokenVersion bumped so all
//   outstanding JWTs (access + refresh) are invalidated server-side. No user
//   is deleted, no business data is touched, no local DB is removed.

const storageAdapter = require('../repositories/storageAdapter');
const usersService = require('./users.service');
const CompanyService = require('./company.service');
const auditService = require('./audit.service');
const presenceService = require('./presence.service');
const platformAdmin = require('./platformAdmin.service');

const COMPANY_STORE = 'companies';
const LICENSE_STORE = 'licenses';
const INTEGRATION_STORE = 'platformIntegrations';

// ---------------- stores ----------------

function _companiesStore() {
  const data = storageAdapter.read(COMPANY_STORE);
  if (Array.isArray(data)) return { shape: 'array', list: data };
  if (data && Array.isArray(data.companies)) return { shape: 'object', list: data.companies };
  return { shape: 'array', list: [] };
}

function _saveCompanies(store) {
  if (store.shape === 'object') storageAdapter.write(COMPANY_STORE, { companies: store.list });
  else storageAdapter.write(COMPANY_STORE, store.list);
}

function _licenseStore() {
  const data = storageAdapter.read(LICENSE_STORE);
  return (data && Array.isArray(data.entries)) ? data.entries : [];
}

function _saveLicenses(entries) {
  storageAdapter.write(LICENSE_STORE, { entries });
}

function _integrationStore() {
  const data = storageAdapter.read(INTEGRATION_STORE);
  return (data && Array.isArray(data.entries)) ? data.entries : [];
}

function _saveIntegrations(entries) {
  storageAdapter.write(INTEGRATION_STORE, { entries });
}

function _maskToken(token) {
  const raw = String(token || '');
  if (!raw) return '';
  if (raw.length <= 8) return '••••';
  return '••••••••••••' + raw.slice(-4);
}

// A user is bound to a tenant via tenantIds or tenantRoles.
function _boundTenants(user) {
  const set = new Set();
  if (user && Array.isArray(user.tenantIds)) {
    for (const t of user.tenantIds) if (t != null) set.add(String(t));
  }
  if (user && user.tenantRoles && typeof user.tenantRoles === 'object') {
    for (const t of Object.keys(user.tenantRoles)) if (t) set.add(String(t));
  }
  return set;
}

function _isBoundToTenant(user, tenantId) {
  return _boundTenants(user).has(String(tenantId));
}

function _tenantUsers(tenantId) {
  const all = (usersService.list().users) || [];
  return all.filter(u => _isBoundToTenant(u, tenantId));
}

function _companyName(tenantId) {
  const c = CompanyService.getCompany(tenantId);
  return c ? c.name : null;
}

function _licenseFor(tenantId) {
  const entry = _licenseStore().find(l => String(l.tenantId) === String(tenantId));
  return entry || null;
}

// ---------------- audit helper ----------------

function _audit(actor, action, resource, resourceId, changes) {
  try {
    auditService.record({
      method: 'POST',
      path: '/api/v1/platform/' + resource + (resourceId ? '/' + resourceId : ''),
      statusCode: 200,
      userId: actor ? actor.id : null,
      action,
      resource,
      resourceId: resourceId || null,
      changes
    });
  } catch (err) {
    // audit must never break the platform operation
  }
}

// ---------------- summary / dashboard ----------------

function summary() {
  const companies = _companiesStore().list;
  const users = usersService.list().users || [];
  const now = new Date();
  const onlineCount = presenceService.countOnline();
  const licenses = _licenseStore();

  const activeCompanies = companies.filter(c => c && c.active !== false);
  const suspendedCompanies = companies.filter(c => c && String(c.status || '').toUpperCase() === 'SUSPENDED');
  const activeLicenses = licenses.filter(l => String(l.status || 'ACTIVE').toUpperCase() === 'ACTIVE');
  const expiredLicenses = licenses.filter(l => l.licenseEnd && new Date(l.licenseEnd).getTime() < now.getTime());
  const expiringSoon = licenses.filter(l => {
    if (!l.licenseEnd) return false;
    const end = new Date(l.licenseEnd).getTime();
    const soon = now.getTime() + 30 * 24 * 60 * 60 * 1000;
    return end > now.getTime() && end <= soon;
  });

  return {
    companies: {
      total: companies.length,
      active: activeCompanies.length,
      suspended: suspendedCompanies.length,
      inactive: companies.length - activeCompanies.length
    },
    users: {
      total: users.length,
      online: onlineCount
    },
    licenses: {
      total: licenses.length,
      active: activeLicenses.length,
      expired: expiredLicenses.length,
      expiringSoon: expiringSoon.length
    }
  };
}

// ---------------- companies ----------------

function listCompanies() {
  const companies = _companiesStore().list;
  return companies.map(c => {
    const tenantId = String(c.id || '');
    const tenantUsers = _tenantUsers(tenantId);
    const branches = (c && Array.isArray(c.branches)) ? c.branches : [];
    return {
      id: c.id,
      code: c.code || '',
      name: c.name || '',
      status: String(c.status || (c.active === false ? 'SUSPENDED' : 'ACTIVE')).toUpperCase(),
      active: c.active !== false,
      plan: (_licenseFor(tenantId) || {}).plan || 'NONE',
      licenseStatus: (_licenseFor(tenantId) || {}).status || 'NONE',
      licenseStart: (_licenseFor(tenantId) || {}).licenseStart || null,
      licenseEnd: (_licenseFor(tenantId) || {}).licenseEnd || null,
      maxUsers: (_licenseFor(tenantId) || {}).maxUsers || null,
      maxBranches: (_licenseFor(tenantId) || {}).maxBranches || null,
      userCount: tenantUsers.length,
      onlineCount: presenceService.listPresence().filter(p => p.online && String(p.tenantId) === tenantId).length,
      branchCount: branches.length,
      createdAt: c.createdAt || null,
      updatedAt: c.updatedAt || null
    };
  });
}

function suspendCompany(actor, tenantId) {
  const store = _companiesStore();
  const company = store.list.find(c => c && String(c.id) === String(tenantId));
  if (!company) return { error: 'Company not found', status: 404 };

  const already = String(company.status || (company.active === false ? 'SUSPENDED' : 'ACTIVE')).toUpperCase() === 'SUSPENDED';
  company.status = 'SUSPENDED';
  company.active = false;
  company.updatedAt = new Date().toISOString();
  _saveCompanies(store);

  // Server-side session revocation: bump tokenVersion for every user bound to
  // this tenant so all outstanding access/refresh JWTs are invalidated.
  let revokedUsers = 0;
  for (const u of _tenantUsers(tenantId)) {
    const bump = usersService.bumpTokenVersion(u.id);
    if (!bump.error) revokedUsers++;
  }

  _audit(actor, 'PLATFORM_COMPANY_SUSPENDED', 'companies', tenantId, {
    companyId: tenantId, companyName: company.name, revokedUsers
  });
  return { company: { id: company.id, name: company.name, status: 'SUSPENDED', active: false }, revokedUsers, already };
}

function activateCompany(actor, tenantId) {
  const store = _companiesStore();
  const company = store.list.find(c => c && String(c.id) === String(tenantId));
  if (!company) return { error: 'Company not found', status: 404 };
  company.status = 'ACTIVE';
  company.active = true;
  company.updatedAt = new Date().toISOString();
  _saveCompanies(store);
  _audit(actor, 'PLATFORM_COMPANY_ACTIVATED', 'companies', tenantId, {
    companyId: tenantId, companyName: company.name
  });
  return { company: { id: company.id, name: company.name, status: 'ACTIVE', active: true } };
}

function getCompanyDetails(tenantId) {
  const company = CompanyService.getCompany(tenantId);
  if (!company) return null;
  const users = _tenantUsers(tenantId).map(u => usersService.sanitizeUser(u));
  const branches = (company && Array.isArray(company.branches)) ? company.branches : [];
  const presence = presenceService.listPresence().filter(p => String(p.tenantId) === String(tenantId));
  const license = _licenseFor(tenantId);
  const integrations = _integrationStore()
    .filter(i => String(i.tenantId) === String(tenantId))
    .map(i => ({ provider: i.provider, connected: i.connected, updatedAt: i.updatedAt, masked: i.masked }));
  return {
    company: {
      id: company.id, code: company.code || '', name: company.name,
      status: String(company.status || (company.active === false ? 'SUSPENDED' : 'ACTIVE')).toUpperCase(),
      active: company.active !== false,
      createdAt: company.createdAt || null
    },
    branches,
    users,
    presence,
    license,
    integrations
  };
}

// ---------------- global user directory ----------------

function listUsers() {
  const all = usersService.list().users || [];
  return all.map(u => {
    const sanitized = usersService.sanitizeUser(u);
    const tenants = Array.from(_boundTenants(u));
    return {
      ...sanitized,
      companies: tenants.map(t => ({ tenantId: t, name: _companyName(t) || t })),
      status: String(u.status || 'active').toLowerCase()
    };
  });
}

function _isLastOwnerInAnyTenant(target) {
  for (const tenantId of _boundTenants(target)) {
    const tenantUsers = _tenantUsers(tenantId);
    const owners = tenantUsers.filter(u => {
      const role = u.tenantRoles && u.tenantRoles[tenantId] ? u.tenantRoles[tenantId] : u.role;
      return role === 'Owner';
    });
    if (owners.length === 1 && owners.some(o => String(o.id) === String(target.id))) return true;
  }
  return false;
}

function disableUser(actor, userId) {
  const target = usersService.getById(userId);
  if (!target) return { error: 'User not found', status: 404 };
  if (_isLastOwnerInAnyTenant(target)) {
    return { error: 'Cannot disable the last Owner of a tenant', status: 409, code: 'LAST_OWNER_PROTECTION' };
  }
  if (String(target.status || 'active').toLowerCase() === 'disabled') {
    return { user: usersService.sanitizeUser(target), already: true };
  }
  const updated = usersService.update(userId, { status: 'disabled' });
  if (updated.error) return { error: updated.error, status: 400 };
  const bump = usersService.bumpTokenVersion(userId);
  _audit(actor, 'PLATFORM_USER_DISABLED', 'users', userId, { username: target.username });
  return { user: usersService.sanitizeUser(updated.user), tokenVersion: bump.tokenVersion || null };
}

function enableUser(actor, userId) {
  const target = usersService.getById(userId);
  if (!target) return { error: 'User not found', status: 404 };
  if (String(target.status || 'active').toLowerCase() !== 'disabled') {
    return { user: usersService.sanitizeUser(target), already: true };
  }
  const updated = usersService.update(userId, { status: 'active' });
  if (updated.error) return { error: updated.error, status: 400 };
  _audit(actor, 'PLATFORM_USER_ENABLED', 'users', userId, { username: target.username });
  return { user: usersService.sanitizeUser(updated.user) };
}

function forceLogout(actor, userId) {
  const target = usersService.getById(userId);
  if (!target) return { error: 'User not found', status: 404 };
  const bump = usersService.bumpTokenVersion(userId);
  if (bump.error) return { error: bump.error, status: 400 };
  // Also drop their presence heartbeats so the dashboard shows them offline.
  const store = storageAdapter.read('presence');
  if (store && Array.isArray(store.entries)) {
    storageAdapter.write('presence', { entries: store.entries.filter(e => String(e.userId) !== String(userId)) });
  }
  _audit(actor, 'PLATFORM_USER_FORCE_LOGOUT', 'users', userId, { username: target.username });
  return { userId, tokenVersion: bump.tokenVersion, forced: true };
}

function resetUserPassword(actor, userId, newPassword) {
  const { validatePassword } = require('../utils/passwordPolicy');
  if (!newPassword) return { error: 'newPassword is required', status: 400 };
  const policy = validatePassword(newPassword);
  if (!policy.valid) {
    return { error: 'Password does not meet policy requirements: ' + policy.errors.join('; '), status: 400 };
  }
  const target = usersService.getById(userId);
  if (!target) return { error: 'User not found', status: 404 };
  const updated = usersService.update(userId, { password: newPassword });
  if (updated.error) return { error: updated.error, status: 400 };
  const bump = usersService.bumpTokenVersion(userId);
  _audit(actor, 'PLATFORM_USER_PASSWORD_RESET', 'users', userId, { username: target.username });
  return { user: usersService.sanitizeUser(updated.user), tokenVersion: bump.tokenVersion || null };
}

// ---------------- licenses ----------------

function listLicenses() {
  return _licenseStore().map(l => ({
    tenantId: l.tenantId,
    companyName: _companyName(l.tenantId) || l.tenantId,
    plan: l.plan || 'NONE',
    status: String(l.status || 'ACTIVE').toUpperCase(),
    licenseStart: l.licenseStart || null,
    licenseEnd: l.licenseEnd || null,
    maxUsers: l.maxUsers != null ? Number(l.maxUsers) : null,
    maxBranches: l.maxBranches != null ? Number(l.maxBranches) : null,
    updatedAt: l.updatedAt || null
  }));
}

function setLicense(actor, data) {
  const tenantId = String(data.tenantId || '').trim();
  if (!tenantId) return { error: 'tenantId is required', status: 400 };
  if (!CompanyService.getCompany(tenantId)) return { error: 'Company not found', status: 404 };
  const plan = String(data.plan || 'BASIC').toUpperCase();
  const allowedPlans = ['TRIAL', 'BASIC', 'PROFESSIONAL', 'ENTERPRISE'];
  if (!allowedPlans.includes(plan)) return { error: 'plan must be one of ' + allowedPlans.join(', '), status: 400 };
  const status = String(data.status || 'ACTIVE').toUpperCase();
  if (!['ACTIVE', 'EXPIRED', 'SUSPENDED'].includes(status)) return { error: 'status must be ACTIVE, EXPIRED or SUSPENDED', status: 400 };

  const entries = _licenseStore();
  const now = new Date().toISOString();
  const idx = entries.findIndex(l => String(l.tenantId) === tenantId);
  const existing = idx !== -1 ? entries[idx] : null;
  const entry = {
    tenantId,
    plan,
    status,
    licenseStart: data.licenseStart || (existing && existing.licenseStart) || now,
    licenseEnd: data.licenseEnd || (existing && existing.licenseEnd) || null,
    maxUsers: data.maxUsers != null ? Number(data.maxUsers) : (existing && existing.maxUsers) || null,
    maxBranches: data.maxBranches != null ? Number(data.maxBranches) : (existing && existing.maxBranches) || null,
    updatedAt: now
  };
  if (idx === -1) entries.push(entry);
  else entries[idx] = entry;
  _saveLicenses(entries);

  const action = existing && data.licenseEnd && new Date(data.licenseEnd) > new Date(existing.licenseEnd || 0)
    ? 'PLATFORM_LICENSE_EXTENDED'
    : 'PLATFORM_LICENSE_UPDATED';
  _audit(actor, action, 'licenses', tenantId, {
    tenantId, plan, status, licenseStart: entry.licenseStart, licenseEnd: entry.licenseEnd
  });
  return { license: entry };
}

// ---------------- integrations (masked, never secrets) ----------------

function listIntegrations() {
  return _integrationStore().map(i => ({
    tenantId: i.tenantId,
    companyName: _companyName(i.tenantId) || i.tenantId,
    provider: i.provider,
    connected: !!i.connected,
    masked: i.masked || '',
    updatedAt: i.updatedAt || null
  }));
}

// Save/update a company integration. `token`, when provided, is NEVER stored
// in full — only a masked marker (••••…LAST4) is persisted so the frontend can
// render connection state without any secret leaving the server boundary.
function setIntegration(actor, data) {
  const tenantId = String(data.tenantId || '').trim();
  if (!tenantId) return { error: 'tenantId is required', status: 400 };
  const provider = String(data.provider || '').trim();
  if (!provider) return { error: 'provider is required', status: 400 };

  const entries = _integrationStore();
  const now = new Date().toISOString();
  const idx = entries.findIndex(i => String(i.tenantId) === tenantId && String(i.provider) === provider);
  const entry = {
    tenantId,
    provider,
    connected: data.connected !== undefined ? !!data.connected : true,
    masked: data.token !== undefined && data.token !== null && data.token !== '' ? _maskToken(data.token) : (entries[idx] ? entries[idx].masked : ''),
    updatedAt: now
  };
  if (idx === -1) entries.push(entry);
  else entries[idx] = entry;
  _saveIntegrations(entries);
  _audit(actor, 'PLATFORM_INTEGRATION_UPDATED', 'integrations', tenantId + ':' + provider, {
    tenantId, provider, connected: entry.connected
  });
  return { integration: { tenantId, provider, connected: entry.connected, masked: entry.masked } };
}

// ---------------- platform audit / admins ----------------

function listPlatformAudit(limit) {
  const result = auditService.query({ page: 1, limit: Math.min(200, Math.max(1, Number(limit) || 100)) });
  return result.entries.filter(e => String(e.action || '').startsWith('PLATFORM_'));
}

function listPlatformAdmins() {
  return platformAdmin.listAdmins();
}

function grantPlatformAdmin(actor, username, platformRole) {
  const result = platformAdmin.grant(username, platformRole);
  if (result.error) return { error: result.error, status: 400 };
  _audit(actor, 'PLATFORM_ADMIN_GRANTED', 'platform-admins', result.username, {
    username: result.username, platformRole: result.platformRole
  });
  return { admin: result };
}

function revokePlatformAdmin(actor, username) {
  const result = platformAdmin.revoke(username);
  if (result.error) return { error: result.error, status: 400 };
  _audit(actor, 'PLATFORM_ADMIN_REVOKED', 'platform-admins', username, { username });
  return { ok: true };
}

module.exports = {
  summary,
  listCompanies,
  suspendCompany,
  activateCompany,
  getCompanyDetails,
  listUsers,
  disableUser,
  enableUser,
  forceLogout,
  resetUserPassword,
  listLicenses,
  setLicense,
  listIntegrations,
  setIntegration,
  listPlatformAudit,
  listPlatformAdmins,
  grantPlatformAdmin,
  revokePlatformAdmin
};
