'use strict';

// gamesCatalog.service — PS4 Host Game Catalog (Phase 1: data layer only).
//
// Responsibilities (Phase 1, NO HTTP, NO RPI, NO install flow):
//   1. Tenant-isolated CRUD over the games_catalog store.
//   2. Strict input validation of every catalog field.
//   3. Path-traversal-safe handling of local_file_path (fail-closed whitelist).
//   4. URL-shape validation of local_download_url (no fetching, no proxying).
//
// This service does NOT:
//   - Serve HTTP routes (Phase 2 — controller + router).
//   - Talk to the RPI (Phase 4 — isolated integration boundary).
//   - Run the local game server (Phase 5 — separate process).
//   - Emit any eventBus events (no PlayStation event in EVENT_TYPES).
//   - Modify the permissions registry (Phase 2 will gate routes).
//
// The data store lives at backend/data/games_catalog.json and is read/written
// exclusively through the existing storageAdapter (no new persistence layer).
// The store document shape is { games: [ ... ] } — mirroring the existing
// { invoices }, { entries }, { products } conventions.

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const storageAdapter = require('../repositories/storageAdapter');

const STORE = 'games_catalog';

// Allowed filesystem root for local_file_path. Configurable via env so a
// deployment can scope to the real local game server directory. The default
// is intentionally non-existent on most hosts: the FIRST successful write
// would still validate, but the safe-by-default is to require a real root.
// If PS4_GAMES_ALLOWED_ROOT is unset, the service rejects every local_file_path
// (fail-closed). The operator MUST configure it before catalog writes succeed.
const ALLOWED_ROOT = process.env.PS4_GAMES_ALLOWED_ROOT
  ? path.resolve(process.env.PS4_GAMES_ALLOWED_ROOT)
  : null;

function _load() {
  const data = storageAdapter.read(STORE);
  if (!data || typeof data !== 'object') return { games: [] };
  if (!Array.isArray(data.games)) data.games = [];
  return data;
}

function _save(db) {
  return storageAdapter.write(STORE, db);
}

// Resolve the trusted tenant id from the supplied tenant context. NEVER taken
// from the request body. When no tenant context is present, the legacy global
// mode is used (no tenant filter) so the service stays testable.
function _trustedTenantId(tenantContext) {
  if (!tenantContext) return null;
  const t = tenantContext.tenantId;
  if (t == null || t === '') return null;
  return String(t);
}

function _visibleGames(games, tenantContext) {
  const tid = _trustedTenantId(tenantContext);
  if (!tid) return games;
  return games.filter(g => {
    if (!g || typeof g !== 'object') return true;
    if (g.tenant_id === undefined || g.tenant_id === null || g.tenant_id === '') return true;
    return String(g.tenant_id) === tid;
  });
}

function _ownershipBlocked(game, tenantContext) {
  const tid = _trustedTenantId(tenantContext);
  if (!tid) return false;
  if (!game || typeof game !== 'object') return true;
  if (game.tenant_id === undefined || game.tenant_id === null || game.tenant_id === '') return false;
  return String(game.tenant_id) !== tid;
}

// -----------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------

// URL-decode a path candidate so encoded traversal (`%2e%2e%2f`) cannot slip
// past the literal `..` check. The original candidate is also rejected if
// it contains percent-encoded characters that decode to traversal sequences.
function _decodeAll(s) {
  let prev = String(s);
  for (let i = 0; i < 5; i++) {
    try {
      const next = decodeURIComponent(prev);
      if (next === prev) return next;
      prev = next;
    } catch (_) { return prev; }
  }
  return prev;
}

function _normalizeSeparators(s) {
  // Treat both POSIX and Windows separators the same so an attacker cannot
  // escape the root by mixing them.
  return String(s).replace(/\\/g, '/');
}

// Strict, fail-closed path validation. Returns null on success (with the
// resolved absolute path) or an error string on any rejection.
function _validateLocalFilePath(candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return 'local_file_path is required';
  }
  if (candidate.length > 1024) {
    return 'local_file_path is too long';
  }

  // Reject NUL bytes outright.
  if (candidate.indexOf('\0') !== -1) {
    return 'local_file_path contains an illegal character';
  }

  // Decode to catch encoded traversal. If the decoded form contains `..` we
  // reject — the raw form is also checked separately so a string with BOTH
  // literal AND encoded `..` cannot pass.
  const decoded = _normalizeSeparators(_decodeAll(candidate));
  const raw = _normalizeSeparators(candidate);

  // Any `..` segment (literal or encoded) is a hard rejection.
  if (raw.split('/').includes('..') || decoded.split('/').includes('..')) {
    return 'local_file_path may not contain path traversal segments';
  }

  // Reject absolute paths. A safe relative path is the only accepted form.
  if (path.isAbsolute(raw) || path.isAbsolute(decoded)) {
    return 'local_file_path must be a relative path';
  }

  // Reject Windows-style drive letters in any form.
  if (/^[a-zA-Z]:[\\/]/.test(raw) || /^[a-zA-Z]:[\\/]/.test(decoded)) {
    return 'local_file_path must be a relative path';
  }

  // Fail-closed: if no allowed root is configured, every path is rejected.
  if (!ALLOWED_ROOT) {
    return 'local_file_path is not accepted: PS4_GAMES_ALLOWED_ROOT is not configured';
  }

  // Resolve against the allowed root and verify the result is contained.
  const resolved = path.resolve(ALLOWED_ROOT, decoded);
  const rootWithSep = ALLOWED_ROOT.endsWith(path.sep) ? ALLOWED_ROOT : ALLOWED_ROOT + path.sep;
  if (resolved !== ALLOWED_ROOT && !resolved.startsWith(rootWithSep)) {
    return 'local_file_path resolves outside the allowed root';
  }

  return null;
}

// URL-shape validation. The service does NOT fetch the URL — it only stores
// the string. Validation is purely lexical: must parse, must be http or https.
// Internal hostnames (loopback, link-local, private RFC1918, IPv6 ULA) are
// REJECTED so a catalog record cannot become an internal-network proxy target.
function _isPrivateHost(hostname) {
  if (!hostname) return true;
  const h = String(hostname).toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(h)) return true;
  if (/^fc[0-9a-f]{2}:/i.test(h)) return true;
  if (/^fd[0-9a-f]{2}:/i.test(h)) return true;
  if (/^fe80:/i.test(h)) return true;
  return false;
}

function _validateLocalDownloadUrl(candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return 'local_download_url is required';
  }
  if (candidate.length > 2048) {
    return 'local_download_url is too long';
  }
  let parsed;
  try { parsed = new URL(candidate); } catch (_) {
    return 'local_download_url must be a valid URL';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'local_download_url must use http or https';
  }
  if (!parsed.hostname) {
    return 'local_download_url must include a hostname';
  }
  if (_isPrivateHost(parsed.hostname)) {
    // Allow private hosts ONLY if PS4_DOWNLOAD_ALLOW_PRIVATE is explicitly set.
    // This lets a same-network RPI host be used in production while keeping
    // the default strict.
    if (process.env.PS4_DOWNLOAD_ALLOW_PRIVATE !== 'true') {
      return 'local_download_url points to a private or loopback host';
    }
  }
  return null;
}

function _validateForCreate(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['request body must be a JSON object'];
  }
  if (data.title === undefined || data.title === null || String(data.title).trim() === '') {
    errors.push('title is required');
  }
  if (data.title !== undefined && typeof data.title !== 'string') {
    errors.push('title must be a string');
  }
  if (data.title_id === undefined || data.title_id === null || String(data.title_id).trim() === '') {
    errors.push('title_id is required');
  }
  if (data.title_id !== undefined && typeof data.title_id !== 'string') {
    errors.push('title_id must be a string');
  }
  if (data.firmware_required === undefined || String(data.firmware_required).trim() === '') {
    errors.push('firmware_required is required');
  }
  if (data.firmware_required !== undefined && typeof data.firmware_required !== 'string') {
    errors.push('firmware_required must be a string');
  }
  if (data.size_in_bytes === undefined || data.size_in_bytes === null) {
    errors.push('size_in_bytes is required');
  }
  if (data.size_in_bytes !== undefined) {
    if (typeof data.size_in_bytes !== 'number' || !Number.isFinite(data.size_in_bytes)) {
      errors.push('size_in_bytes must be a number');
    } else if (data.size_in_bytes <= 0) {
      errors.push('size_in_bytes must be greater than zero');
    } else if (data.size_in_bytes > 1024 * 1024 * 1024 * 1024) {
      // 1 TiB hard cap; a sane ceiling for a single PS4 PKG.
      errors.push('size_in_bytes is unreasonably large');
    }
  }
  if (data.is_available !== undefined && typeof data.is_available !== 'boolean') {
    errors.push('is_available must be a boolean');
  }
  const pathErr = _validateLocalFilePath(data.local_file_path);
  if (pathErr) errors.push(pathErr);
  const urlErr = _validateLocalDownloadUrl(data.local_download_url);
  if (urlErr) errors.push(urlErr);
  return errors;
}

function _validateForUpdate(data) {
  // For update, every field is optional but if present must be the right type.
  const errors = [];
  if (data.title !== undefined && (typeof data.title !== 'string' || String(data.title).trim() === '')) {
    errors.push('title must be a non-empty string');
  }
  if (data.title_id !== undefined && (typeof data.title_id !== 'string' || String(data.title_id).trim() === '')) {
    errors.push('title_id must be a non-empty string');
  }
  if (data.firmware_required !== undefined && (typeof data.firmware_required !== 'string' || String(data.firmware_required).trim() === '')) {
    errors.push('firmware_required must be a non-empty string');
  }
  if (data.size_in_bytes !== undefined) {
    if (typeof data.size_in_bytes !== 'number' || !Number.isFinite(data.size_in_bytes) || data.size_in_bytes <= 0) {
      errors.push('size_in_bytes must be a positive number');
    }
  }
  if (data.is_available !== undefined && typeof data.is_available !== 'boolean') {
    errors.push('is_available must be a boolean');
  }
  if (data.local_file_path !== undefined) {
    const pathErr = _validateLocalFilePath(data.local_file_path);
    if (pathErr) errors.push(pathErr);
  }
  if (data.local_download_url !== undefined) {
    const urlErr = _validateLocalDownloadUrl(data.local_download_url);
    if (urlErr) errors.push(urlErr);
  }
  return errors;
}

// -----------------------------------------------------------------------
// Public service API
// -----------------------------------------------------------------------

function list({ query, tenantContext } = {}) {
  const db = _load();
  let games = _visibleGames(db.games, tenantContext);
  const q = (query && (query.q || query.search)) ? String(query.q || query.search).toLowerCase() : '';
  if (q) {
    games = games.filter(g => String(g.title || '').toLowerCase().includes(q));
  }
  if (query && query.title_id) {
    games = games.filter(g => String(g.title_id) === String(query.title_id));
  }
  if (query && query.is_available !== undefined && query.is_available !== '') {
    const want = String(query.is_available) === 'true';
    games = games.filter(g => !!g.is_available === want);
  }
  // Stable order: newest first by createdAt, then by id for determinism.
  games = games.slice().sort((a, b) => {
    const ta = a && a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b && b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (ta !== tb) return tb - ta;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
  const page = Math.max(1, parseInt(query && query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query && query.limit, 10) || 50));
  const total = games.length;
  const totalPages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  return { games: games.slice(start, start + limit), total, page, limit, totalPages };
}

function getById({ id, tenantContext } = {}) {
  if (id == null || id === '') return null;
  const target = String(id).trim();
  const db = _load();
  const found = (db.games || []).find(g => g && (String(g.id) === target || String(g._backendId || '') === target)) || null;
  if (!found) return null;
  if (_ownershipBlocked(found, tenantContext)) return null;
  return found;
}

function create({ data, tenantContext } = {}) {
  const errors = _validateForCreate(data);
  if (errors.length) return { error: errors.join('; ') };
  const trustedTid = _trustedTenantId(tenantContext);

  // Reject a foreign tenant_id claim before any persistence (same rule as
  // sales.service.js: a record claiming a DIFFERENT tenant is never accepted).
  if (data.tenant_id !== undefined && data.tenant_id !== null && data.tenant_id !== '') {
    if (trustedTid && String(data.tenant_id) !== trustedTid) {
      return { error: 'tenant_id claim does not match the trusted tenant' };
    }
  }

  // Auto-stamp tenant_id from the trusted context when client omits it.
  let stampedTid;
  if (trustedTid) {
    stampedTid = trustedTid;
  } else if (data.tenant_id !== undefined && data.tenant_id !== null && data.tenant_id !== '') {
    stampedTid = String(data.tenant_id);
  }

  const db = _load();
  const titleId = String(data.title_id).trim();
  // (tenant_id, title_id) must be unique per tenant.
  if ((db.games || []).some(g => g && String(g.tenant_id || '') === String(stampedTid || '') && String(g.title_id || '') === titleId)) {
    return { error: 'Duplicate title_id for this tenant' };
  }
  const now = new Date().toISOString();
  const game = {
    id: uuidv4(),
    tenant_id: stampedTid || null,
    title: String(data.title).trim(),
    title_id: titleId,
    firmware_required: String(data.firmware_required).trim(),
    size_in_bytes: Number(data.size_in_bytes),
    local_file_path: _normalizeSeparators(String(data.local_file_path)),
    local_download_url: String(data.local_download_url),
    is_available: data.is_available === undefined ? true : !!data.is_available,
    createdAt: now,
    updatedAt: now
  };
  if (!Array.isArray(db.games)) db.games = [];
  db.games.push(game);
  if (_save(db)) return { game: Object.assign({}, game) };
  return { error: 'Failed to persist game catalog record' };
}

function update({ id, data, tenantContext } = {}) {
  if (id == null || id === '') return { error: 'id is required' };
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { error: 'request body must be a JSON object' };
  }
  const errors = _validateForUpdate(data);
  if (errors.length) return { error: errors.join('; ') };
  const target = String(id).trim();
  const db = _load();
  const idx = (db.games || []).findIndex(g => g && (String(g.id) === target || String(g._backendId || '') === target));
  if (idx === -1) return { error: 'Game not found' };
  if (_ownershipBlocked(db.games[idx], tenantContext)) return { error: 'Game not found' };

  // Reject a foreign tenant_id claim in an update.
  if (data.tenant_id !== undefined && data.tenant_id !== null && data.tenant_id !== '') {
    const trustedTid = _trustedTenantId(tenantContext);
    if (trustedTid && String(data.tenant_id) !== trustedTid) {
      return { error: 'tenant_id claim does not match the trusted tenant' };
    }
  }

  // If title_id is being changed, enforce per-tenant uniqueness.
  if (data.title_id !== undefined) {
    const newTitleId = String(data.title_id).trim();
    const tid = db.games[idx].tenant_id;
    const conflict = (db.games || []).some(g => g && String(g.id) !== String(db.games[idx].id) && String(g.tenant_id || '') === String(tid || '') && String(g.title_id || '') === newTitleId);
    if (conflict) return { error: 'Duplicate title_id for this tenant' };
    db.games[idx].title_id = newTitleId;
  }
  if (data.title !== undefined) db.games[idx].title = String(data.title).trim();
  if (data.firmware_required !== undefined) db.games[idx].firmware_required = String(data.firmware_required).trim();
  if (data.size_in_bytes !== undefined) db.games[idx].size_in_bytes = Number(data.size_in_bytes);
  if (data.local_file_path !== undefined) db.games[idx].local_file_path = _normalizeSeparators(String(data.local_file_path));
  if (data.local_download_url !== undefined) db.games[idx].local_download_url = String(data.local_download_url);
  if (data.is_available !== undefined) db.games[idx].is_available = !!data.is_available;
  db.games[idx].updatedAt = new Date().toISOString();
  if (_save(db)) return { game: Object.assign({}, db.games[idx]) };
  return { error: 'Failed to persist catalog update' };
}

function remove({ id, tenantContext } = {}) {
  if (id == null || id === '') return { error: 'id is required' };
  const target = String(id).trim();
  const db = _load();
  const idx = (db.games || []).findIndex(g => g && (String(g.id) === target || String(g._backendId || '') === target));
  if (idx === -1) return { error: 'Game not found' };
  if (_ownershipBlocked(db.games[idx], tenantContext)) return { error: 'Game not found' };
  db.games.splice(idx, 1);
  if (_save(db)) return { success: true };
  return { error: 'Failed to persist catalog delete' };
}

module.exports = {
  list,
  getById,
  create,
  update,
  remove,
  // Exported for tests and for the Phase 2 PS4 service to reuse.
  _validateLocalFilePath,
  _validateLocalDownloadUrl,
  _validateForCreate,
  _validateForUpdate,
  STORE
};
