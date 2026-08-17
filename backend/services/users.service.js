const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const { hashPassword, verifyPassword, verifyDummy, isBcryptHash } = require('../utils/password');
const { validatePassword } = require('../utils/passwordPolicy');
const repository = require('../repositories').users;
const config = require('../config');
const tenantMembership = require('./tenantMembership.service');
const tenantRole = require('./tenantRole.service');

class UsersService {
  _load() {
    const db = repository.read();
    if (!db || typeof db !== 'object') return { users: [] };
    if (!Array.isArray(db.users)) db.users = [];
    return db;
  }
  _save(db) { return repository.write(db); }

  _validateRequired(data, forCreate) {
    const errors = [];
    if (forCreate && (data.username === undefined || data.username === null || String(data.username).trim() === '')) errors.push('username is required');
    if (data.username !== undefined && typeof data.username !== 'string') errors.push('username must be a string');
    if (data.password !== undefined && typeof data.password !== 'string') errors.push('password must be a string');
    if (data.role !== undefined && typeof data.role !== 'string') errors.push('role must be a string');
    if (data.fullName !== undefined && typeof data.fullName !== 'string') errors.push('fullName must be a string');
    if (data.phone !== undefined && typeof data.phone !== 'string') errors.push('phone must be a string');
    return errors;
  }

  _normalizeId(id) {
    return String(id).trim();
  }

  _matchesId(user, normalized) {
    return this._normalizeId(user.id) === normalized || this._normalizeId(user._backendId || '') === normalized;
  }

  // Phase G — tenant visibility for the user READ surface. A record is visible
  // to a tenant when it is legacy/unbound (shared space) or explicitly bound to
  // that tenant. Never leaks records bound to another tenant. This mirrors the
  // controller's isTargetInTenant (users.controller.js) used by the Phase E
  // sub-resource endpoints; it is applied ONLY when a trusted tenant scope is
  // supplied on reads (list/stats), leaving the legacy global view untouched.
  _tenantVisible(user, tenantId) {
    const bound = new Set();
    if (user && Array.isArray(user.tenantIds)) {
      for (const t of user.tenantIds) if (t != null) bound.add(String(t));
    }
    if (user && user.tenantRoles && typeof user.tenantRoles === 'object') {
      for (const t of Object.keys(user.tenantRoles)) if (t) bound.add(String(t));
    }
    if (bound.size === 0) return true;
    return bound.has(String(tenantId));
  }

  list(query = {}, tenantScope) {
    const db = this._load();
    let users = db.users || [];

    // Phase G — optional trusted-tenant read scope. Absent in legacy mode, so
    // existing callers (owner-count uses, unauthenticated default view) are
    // byte-for-byte unchanged.
    if (tenantScope !== undefined && tenantScope !== null) {
      users = users.filter((u) => this._tenantVisible(u, tenantScope));
    }

    if (query.search) {
      const q = String(query.search).toLowerCase();
      users = users.filter(u =>
        String(u.username || '').toLowerCase().includes(q) ||
        String(u.fullName || '').toLowerCase().includes(q) ||
        String(u.role || '').toLowerCase().includes(q) ||
        String(u.phone || '').toLowerCase().includes(q)
      );
    }
    if (query.role) {
      const q = String(query.role).toLowerCase();
      users = users.filter(u => String(u.role || '').toLowerCase() === q);
    }

    const sortBy = query.sortBy || 'createdAt';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    users.sort((a, b) => {
      let va = a[sortBy], vb = b[sortBy];
      if (sortBy === 'createdAt' || sortBy === 'updatedAt') {
        va = new Date(va || 0).getTime();
        vb = new Date(vb || 0).getTime();
      } else {
        va = String(va || '').toLowerCase();
        vb = String(vb || '').toLowerCase();
      }
      return va < vb ? -sortOrder : va > vb ? sortOrder : 0;
    });

    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
    const total = users.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const paginated = users.slice(start, start + limit);

    return { users: paginated, total, page, limit, totalPages };
  }

  getById(id) {
    const db = this._load();
    const normalized = this._normalizeId(id);
    return (db.users || []).find(u => this._matchesId(u, normalized)) || null;
  }

  getByUsername(username) {
    const db = this._load();
    const normalized = this._normalizeId(username).toLowerCase();
    return (db.users || []).find(u => String(u.username || '').toLowerCase() === normalized) || null;
  }

  stats(tenantScope) {
    const db = this._load();
    let users = db.users || [];

    // Phase G — optional trusted-tenant read scope (see list()); absent in
    // legacy mode so the global stats view is unchanged.
    if (tenantScope !== undefined && tenantScope !== null) {
      users = users.filter((u) => this._tenantVisible(u, tenantScope));
    }

    const roles = {};
    users.forEach(u => {
      const r = String(u.role || '').toLowerCase();
      if (r) roles[r] = (roles[r] || 0) + 1;
    });
    return { count: users.length, roles };
  }

  create(data) {
    const errors = this._validateRequired(data, true);
    if (errors.length) return { error: errors.join('; ') };

    // Phase D — enforce the centralized password policy on plaintext
    // credentials at creation. Already-hashed passwords (legacy migration,
    // pre-hashed seeds) bypass validation: hashPassword accepts them verbatim.
    if (data.password !== undefined && !isBcryptHash(data.password)) {
      const policy = validatePassword(data.password);
      if (!policy.valid) {
        return { error: 'Password does not meet policy requirements: ' + policy.errors.join('; ') };
      }
    }

    // Phase 15: when tenant user membership is enabled, normalize any
    // provided tenantIds. When disabled (default) OR when no tenantIds are
    // provided, the record is passed through exactly as GoLive-1 did.
    const payload = { ...data };
    if (config.tenantUserMembershipEnabled && payload.tenantIds !== undefined) {
      payload.tenantIds = tenantMembership.normalize(payload.tenantIds);
    }
    // Phase 17: normalize the tenantRoles map when the feature is enabled.
    if (config.tenantRolesEnabled && payload.tenantRoles !== undefined) {
      payload.tenantRoles = tenantRole.normalize(payload.tenantRoles);
    }

    const db = this._load();
    const user = {
      id: payload.id !== undefined && payload.id !== null ? payload.id : uuidv4(),
      ...payload,
      createdAt: payload.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (user.password !== undefined) user.password = hashPassword(user.password);
    // Phase D — every new account starts at tokenVersion 0 so its tokens carry
    // a matching `ver` claim and password changes invalidate them.
    if (user.tokenVersion === undefined) user.tokenVersion = 0;

    const normalized = this._normalizeId(user.id);
    if ((db.users || []).some(u => this._normalizeId(u.id) === normalized)) {
      return { error: 'Duplicate user ID: ' + user.id };
    }
    if (this.getByUsername(user.username)) {
      return { error: 'Duplicate username: ' + user.username };
    }

    if (!Array.isArray(db.users)) db.users = [];
    db.users.push(user);
    if (this._save(db)) return { user };
    return { error: 'Failed to persist user' };
  }

  update(id, data) {
    const db = this._load();
    const normalized = this._normalizeId(id);
    const idx = (db.users || []).findIndex(u => this._matchesId(u, normalized));
    if (idx === -1) return { error: 'User not found' };

    const errors = this._validateRequired(data, false);
    if (errors.length) return { error: errors.join('; ') };

    if (data.username !== undefined) {
      const clash = (db.users || []).find((u, i) => i !== idx && String(u.username || '').toLowerCase() === String(data.username).toLowerCase());
      if (clash) return { error: 'Duplicate username: ' + data.username };
    }

    const merged = { ...db.users[idx], ...data, id: db.users[idx].id, updatedAt: new Date().toISOString() };
    // Phase 15: only normalize tenantIds when the feature flag is ON.
    if (config.tenantUserMembershipEnabled && data.tenantIds !== undefined) {
      merged.tenantIds = tenantMembership.normalize(data.tenantIds);
    }
    // Phase 17: only normalize tenantRoles when the feature flag is ON.
    if (config.tenantRolesEnabled && data.tenantRoles !== undefined) {
      merged.tenantRoles = tenantRole.normalize(data.tenantRoles);
    }
    // Phase D — same centralized policy on password updates (plaintext only).
    if (data.password !== undefined && !isBcryptHash(data.password)) {
      const policy = validatePassword(data.password);
      if (!policy.valid) {
        return { error: 'Password does not meet policy requirements: ' + policy.errors.join('; ') };
      }
    }
    if (data.password !== undefined) merged.password = hashPassword(data.password);
    db.users[idx] = merged;
    if (this._save(db)) return { user: db.users[idx] };
    return { error: 'Failed to persist update' };
  }

  delete(id) {
    const db = this._load();
    const normalized = this._normalizeId(id);
    const idx = (db.users || []).findIndex(u => this._matchesId(u, normalized));
    if (idx === -1) return { error: 'User not found' };
    db.users.splice(idx, 1);
    if (this._save(db)) return { success: true };
    return { error: 'Failed to persist deletion' };
  }

  // Phase D — invalidate every outstanding token for a user by incrementing
  // their tokenVersion. Tokens carry `ver` = the version they were signed
  // against; access/refresh verification rejects versions that no longer match.
  bumpTokenVersion(id) {
    const db = this._load();
    const normalized = this._normalizeId(id);
    const idx = (db.users || []).findIndex(u => this._matchesId(u, normalized));
    if (idx === -1) return { error: 'User not found' };
    const next = (Number(db.users[idx].tokenVersion) || 0) + 1;
    db.users[idx].tokenVersion = next;
    db.users[idx].updatedAt = new Date().toISOString();
    if (this._save(db)) return { user: db.users[idx], tokenVersion: next };
    return { error: 'Failed to persist token version update' };
  }

  authenticate(username, password) {
    const user = this.getByUsername(username);
    if (!user) {
      // Timing equalization (Phase 22B): pay a bcrypt compare even when the
      // username is unknown so response time does not reveal existence.
      verifyDummy(password);
      return null;
    }
    const result = verifyPassword(password, user.password);
    if (!result.match) return null;
    if (result.needsRehash) {
      // Password migration: legacy plaintext credential verified —
      // rehash with bcrypt and persist so plaintext never survives a login.
      try {
        const db = this._load();
        const normalized = this._normalizeId(user.id);
        const idx = (db.users || []).findIndex(u => this._matchesId(u, normalized));
        if (idx !== -1) {
          db.users[idx].password = hashPassword(password);
          db.users[idx].updatedAt = new Date().toISOString();
          this._save(db);
          user.password = db.users[idx].password;
        }
      } catch (err) {
        logger.error('users.authenticate migration error:', err.message);
      }
    }
    return user;
  }
}

// Strict allowlist for every user DTO exposed through the API (Phase D).
// Unlike the old delete-and-spread approach, only the fields below are ever
// emitted, so no secret, hash, token, apiKey, or arbitrary stored field can
// leak into client responses — even if mirrored onto the record by a future
// feature or a careless update. Internal flows (authenticate, token signing,
// persistence) keep the full record untouched.
const SAFE_USER_FIELDS = [
  'id', 'username', 'fullName', 'role', 'phone', 'email',
  'tenantIds', 'tenantRoles', 'tenantPermissions', 'branchId',
  'mfaEnabled', 'status', 'lastLogin', 'createdAt', 'updatedAt'
];

function _coerceBoolean(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
}

function sanitizeUser(user) {
  if (!user || typeof user !== 'object') return user;
  const safe = {};
  for (const field of SAFE_USER_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(user, field)) {
      safe[field] = field === 'mfaEnabled' ? _coerceBoolean(user[field]) : user[field];
    }
  }
  return safe;
}

module.exports = new UsersService();
module.exports.sanitizeUser = sanitizeUser;
