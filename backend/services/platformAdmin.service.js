'use strict';

// Platform Admin Store — Master Control Center (Phase 33) + Platform Control
// Center team management.
//
// The platform scope is SEPARATE from every tenant/company scope. A platform
// member is identified by username in a dedicated server-side store, never by
// tenant role, never by ACTIVE_TENANT_ID, never by a fake tenant.
//
// Store shape (backend/data/platformAdmins.json):
//   { admins: [{ username, platformRole, status, permissions, displayName,
//                addedBy, createdAt, updatedAt }] }
//
// platformRole values (see ../permissions/platformRegistry.js):
//   MASTER_OWNER   — full platform access (team, roles, security, config)
//   PLATFORM_ADMIN — platform operator / operations access
//   DEVELOPER      — technical diagnostics (read-only, no secrets)
//   DATA_ENTRY     — operational content entry (never team/role/security)
//
// `status` defaults to 'active'; a 'disabled' member is treated exactly like a
// removed one by every authorization path (platformRoleFor returns null), so a
// deleted/inactive team member can never authenticate into platform scope.
//
// `permissions` (optional) holds per-member ADDITIVE overrides; only a
// team.manage holder (MASTER_OWNER) may set them, so a member can never
// escalate its own permissions.
//
// On first read, if the store is empty/missing, the PLATFORM_ADMINS
// environment variable (comma-separated usernames) seeds MASTER_OWNER
// entries — a safe, secret-free bootstrap for the platform operator.

const storageAdapter = require('../repositories/storageAdapter');
const config = require('../config');
const platformRegistry = require('../permissions/platformRegistry');

const STORE = 'platformAdmins';

function _load() {
  const data = storageAdapter.read(STORE);
  if (data && Array.isArray(data.admins)) return data.admins;
  return [];
}

function _save(admins) {
  return storageAdapter.write(STORE, { admins });
}

function _normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

// A member is active unless explicitly disabled. Missing status = active
// (every legacy entry stays valid).
function _isActive(entry) {
  return !!entry && String(entry.status || 'active').toLowerCase() !== 'disabled';
}

// Raw member record (regardless of status) keyed by username.
function memberFor(username) {
  const uname = _normalizeUsername(username);
  if (!uname) return null;
  return _load().find(a => a && _normalizeUsername(a.username) === uname) || null;
}

// Active platform member of ANY platform role.
function isPlatformAdmin(username) {
  const entry = memberFor(username);
  return !!entry && _isActive(entry);
}

// Active member's platform role, or null. A disabled/removed member resolves to
// null so authorization gates reject them.
function platformRoleFor(username) {
  const entry = memberFor(username);
  if (!entry || !_isActive(entry)) return null;
  return entry.platformRole || 'PLATFORM_ADMIN';
}

// Effective platform permissions for an authenticated username (server-side).
function resolvePermissionsFor(username) {
  const entry = memberFor(username);
  if (!entry || !_isActive(entry)) return [];
  const role = entry.platformRole || 'PLATFORM_ADMIN';
  return platformRegistry.resolvePermissions(role, entry.permissions);
}

function listAdmins() {
  return _load().map(a => ({
    username: a.username,
    platformRole: a.platformRole || 'PLATFORM_ADMIN',
    createdAt: a.createdAt || null,
    updatedAt: a.updatedAt || null
  }));
}

// Full team listing for the Control Center (includes status + overrides).
function listMembers() {
  return _load().map(a => ({
    username: a.username,
    platformRole: a.platformRole || 'PLATFORM_ADMIN',
    status: String(a.status || 'active').toLowerCase(),
    displayName: a.displayName || null,
    permissions: Array.isArray(a.permissions) ? a.permissions.slice() : [],
    addedBy: a.addedBy || null,
    createdAt: a.createdAt || null,
    updatedAt: a.updatedAt || null
  }));
}

// Seed from the environment ONLY when the store has no entries yet.
function ensureSeeded() {
  const existing = _load();
  if (existing.length > 0) return existing;
  const fromEnv = (config.platformAdmins || []).filter(Boolean);
  if (fromEnv.length === 0) return existing;
  const now = new Date().toISOString();
  const seeded = fromEnv.map(username => ({
    username,
    platformRole: 'MASTER_OWNER',
    status: 'active',
    createdAt: now,
    updatedAt: now
  }));
  _save(seeded);
  return seeded;
}

// Grant (or update) a platform role for a username. Server-authoritative.
function grant(username, platformRole) {
  const uname = String(username || '').trim();
  if (!uname) return { error: 'username is required' };
  const role = platformRegistry.normalizeRole(platformRole || 'PLATFORM_ADMIN');
  if (!platformRegistry.isPlatformRole(role)) {
    return { error: 'platformRole must be one of ' + platformRegistry.PLATFORM_ROLES.join(', ') };
  }
  const admins = _load();
  const now = new Date().toISOString();
  const idx = admins.findIndex(a => a && _normalizeUsername(a.username) === _normalizeUsername(uname));
  if (idx === -1) {
    admins.push({ username: uname, platformRole: role, status: 'active', createdAt: now, updatedAt: now });
  } else {
    admins[idx].platformRole = role;
    if (!admins[idx].status) admins[idx].status = 'active';
    admins[idx].updatedAt = now;
  }
  _save(admins);
  return { ok: true, username: uname, platformRole: role };
}

// Revoke platform access for a username. Never removes the user record.
function revoke(username) {
  const uname = _normalizeUsername(username);
  const admins = _load();
  const filtered = admins.filter(a => a && _normalizeUsername(a.username) !== uname);
  if (filtered.length === admins.length) return { error: 'Not a platform admin' };
  _save(filtered);
  return { ok: true };
}

// ---- Team management primitives (audit recorded by the Control Center svc) ----

function _sanitizeOverrides(permissions) {
  if (permissions === undefined || permissions === null) return { permissions: [] };
  if (!Array.isArray(permissions)) return { error: 'permissions must be an array' };
  const out = [];
  for (const p of permissions) {
    const norm = String(p || '').trim();
    if (!norm) continue;
    if (norm === platformRegistry.ALL_WILDCARD) return { error: 'wildcard permission override is not allowed' };
    if (!platformRegistry.ALL_PLATFORM_PERMISSIONS.includes(norm)) {
      return { error: 'Unknown platform permission: ' + norm };
    }
    if (!out.includes(norm)) out.push(norm);
  }
  return { permissions: out };
}

function _publicMember(entry) {
  return {
    username: entry.username,
    platformRole: entry.platformRole || 'PLATFORM_ADMIN',
    status: String(entry.status || 'active').toLowerCase(),
    displayName: entry.displayName || null,
    permissions: Array.isArray(entry.permissions) ? entry.permissions.slice() : [],
    addedBy: entry.addedBy || null,
    createdAt: entry.createdAt || null,
    updatedAt: entry.updatedAt || null
  };
}

function addMember(username, platformRole, opts) {
  const uname = String(username || '').trim();
  if (!uname) return { error: 'username is required' };
  const role = platformRegistry.normalizeRole(platformRole || 'DATA_ENTRY');
  if (!platformRegistry.isPlatformRole(role)) {
    return { error: 'platformRole must be one of ' + platformRegistry.PLATFORM_ROLES.join(', ') };
  }
  const overrides = _sanitizeOverrides(opts && opts.permissions);
  if (overrides.error) return overrides;
  const admins = _load();
  if (admins.some(a => a && _normalizeUsername(a.username) === _normalizeUsername(uname))) {
    return { error: 'Member already exists' };
  }
  const now = new Date().toISOString();
  const entry = {
    username: uname,
    platformRole: role,
    status: 'active',
    displayName: (opts && opts.displayName) ? String(opts.displayName).trim() : null,
    permissions: overrides.permissions,
    addedBy: (opts && opts.addedBy) ? opts.addedBy : null,
    createdAt: now,
    updatedAt: now
  };
  admins.push(entry);
  _save(admins);
  return { ok: true, member: _publicMember(entry) };
}

function setMemberRole(username, platformRole) {
  const uname = _normalizeUsername(username);
  const role = platformRegistry.normalizeRole(platformRole);
  if (!platformRegistry.isPlatformRole(role)) {
    return { error: 'platformRole must be one of ' + platformRegistry.PLATFORM_ROLES.join(', ') };
  }
  const admins = _load();
  const idx = admins.findIndex(a => a && _normalizeUsername(a.username) === uname);
  if (idx === -1) return { error: 'Member not found' };
  admins[idx].platformRole = role;
  admins[idx].updatedAt = new Date().toISOString();
  _save(admins);
  return { ok: true, member: _publicMember(admins[idx]) };
}

function setMemberStatus(username, status) {
  const uname = _normalizeUsername(username);
  const normalized = String(status || '').toLowerCase();
  if (!['active', 'disabled'].includes(normalized)) return { error: "status must be 'active' or 'disabled'" };
  const admins = _load();
  const idx = admins.findIndex(a => a && _normalizeUsername(a.username) === uname);
  if (idx === -1) return { error: 'Member not found' };
  admins[idx].status = normalized;
  admins[idx].updatedAt = new Date().toISOString();
  _save(admins);
  return { ok: true, member: _publicMember(admins[idx]) };
}

function setMemberPermissions(username, permissions) {
  const uname = _normalizeUsername(username);
  const overrides = _sanitizeOverrides(permissions);
  if (overrides.error) return overrides;
  const admins = _load();
  const idx = admins.findIndex(a => a && _normalizeUsername(a.username) === uname);
  if (idx === -1) return { error: 'Member not found' };
  admins[idx].permissions = overrides.permissions;
  admins[idx].updatedAt = new Date().toISOString();
  _save(admins);
  return { ok: true, member: _publicMember(admins[idx]) };
}

function removeMember(username) {
  const uname = _normalizeUsername(username);
  const admins = _load();
  const idx = admins.findIndex(a => a && _normalizeUsername(a.username) === uname);
  if (idx === -1) return { error: 'Member not found' };
  const removed = admins.splice(idx, 1)[0];
  _save(admins);
  return { ok: true, username: removed.username };
}

// Count of ACTIVE MASTER_OWNER members — guards against locking the platform
// out (the last owner can never be demoted / removed / disabled).
function activeOwnerCount() {
  return _load().filter(a => _isActive(a) && platformRegistry.normalizeRole(a.platformRole) === 'MASTER_OWNER').length;
}

module.exports = {
  isPlatformAdmin,
  platformRoleFor,
  resolvePermissionsFor,
  listAdmins,
  listMembers,
  memberFor,
  ensureSeeded,
  grant,
  revoke,
  addMember,
  setMemberRole,
  setMemberStatus,
  setMemberPermissions,
  removeMember,
  activeOwnerCount
};
