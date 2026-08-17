'use strict';

// Platform Admin Store — Master Control Center (Phase 33).
//
// The platform scope is SEPARATE from every tenant/company scope. A platform
// admin is identified by username in a dedicated server-side store, never by
// tenant role, never by ACTIVE_TENANT_ID, never by a fake tenant.
//
// Store shape (backend/data/platformAdmins.json):
//   { admins: [{ username, platformRole, createdAt, updatedAt }] }
//
// platformRole values:
//   MASTER_OWNER  — full platform access
//   PLATFORM_ADMIN — platform operator access
//
// On first read, if the store is empty/missing, the PLATFORM_ADMINS
// environment variable (comma-separated usernames) seeds MASTER_OWNER
// entries — a safe, secret-free bootstrap for the platform operator.

const storageAdapter = require('../repositories/storageAdapter');
const config = require('../config');

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

function isPlatformAdmin(username) {
  const uname = _normalizeUsername(username);
  if (!uname) return false;
  return _load().some(a => a && _normalizeUsername(a.username) === uname);
}

function platformRoleFor(username) {
  const uname = _normalizeUsername(username);
  if (!uname) return null;
  const entry = _load().find(a => a && _normalizeUsername(a.username) === uname);
  return entry ? entry.platformRole || 'PLATFORM_ADMIN' : null;
}

function listAdmins() {
  return _load().map(a => ({
    username: a.username,
    platformRole: a.platformRole || 'PLATFORM_ADMIN',
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
  const role = String(platformRole || 'PLATFORM_ADMIN').toUpperCase();
  if (role !== 'MASTER_OWNER' && role !== 'PLATFORM_ADMIN') {
    return { error: 'platformRole must be MASTER_OWNER or PLATFORM_ADMIN' };
  }
  const admins = _load();
  const now = new Date().toISOString();
  const idx = admins.findIndex(a => a && _normalizeUsername(a.username) === _normalizeUsername(uname));
  if (idx === -1) {
    admins.push({ username: uname, platformRole: role, createdAt: now, updatedAt: now });
  } else {
    admins[idx].platformRole = role;
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

module.exports = {
  isPlatformAdmin,
  platformRoleFor,
  listAdmins,
  ensureSeeded,
  grant,
  revoke
};
