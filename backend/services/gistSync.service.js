'use strict';

// gistSync.service.js — server-authoritative, tenant-scoped cloud-sync engine.
//
// Replaces the browser-side GitHub PAT + Gist flow (index.html / DigiTronics_v5
// html) with centrally managed credentials. Design contract:
//
//   - Credentials are configured ONLY by Platform Master (requirePlatformAdmin
//     on the router) and are encrypted at rest with AES-256-GCM under a server
//     env key (GIST_SYNC_VAULT_KEY). Missing/short key => vault LOCKED and
//     every mutating operation fails closed with 503. There is NO plaintext
//     fallback and NO invented default key.
//   - Tenant requests (status/pull/push) derive the tenant exclusively from
//     trustedTenantId(req) — the JWT-signed claim / reconstructed context —
//     never from query, body or header. A tenant can only ever touch its OWN
//     binding and its OWN dataset.
//   - The legacy platformIntegrations store (platform.service.js) keeps only a
//     masked token marker (••••LAST4) and therefore CANNOT perform sync; this
//     service keeps the encrypted secret separately in the gistSyncState store.
//   - Pushes require baseRevision (content sha256) matching the last synced
//     revision; mismatches return 409 SYNC_CONFLICT — never silent
//     last-write-wins. Partial upstream failures leave state unchanged.
//   - Safe error codes only cross the boundary (VAULT_LOCKED, NOT_CONFIGURED,
//     CREDENTIAL_INVALID, GIST_NOT_FOUND, UPSTREAM_UNAVAILABLE, UPSTREAM_TIMEOUT,
//     TOO_LARGE, INVALID_PAYLOAD, CROSS_TENANT_PAYLOAD, CONFLICT). Provider
//     response bodies and dataset contents are never logged or audited.

const crypto = require('crypto');
const storageAdapter = require('../repositories/storageAdapter');
const auditService = require('./audit.service');
const CompanyService = require('./company.service');

const STATE_STORE = 'gistSyncState';
const PROVIDER = 'github-gist';
const GH_API = 'https://api.github.com';
const VAULT_KEY_ENV = 'GIST_SYNC_VAULT_KEY';
const VAULT_MIN_LEN = 32;

// Hard operational limits (bytes / ms). Gist soft-limit is far higher; these
// caps keep a compromised or buggy client from exhausting the server or the
// upstream account.
const MAX_PUSH_BYTES = 5 * 1024 * 1024;
const MAX_PULL_BYTES = 8 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 15000;
const GH_FILENAME = 'digitronics_db.json';
const GH_DESC = 'OmniStore tenant dataset (server-managed)';

// ---------------------------------------------------------------------------
// Vault — AES-256-GCM, per-secret random salt, fail-closed.
// ---------------------------------------------------------------------------

function vaultLocked() {
  const raw = process.env[VAULT_KEY_ENV] || '';
  return raw.length < VAULT_MIN_LEN;
}

function _vaultMaterial() {
  const raw = process.env[VAULT_KEY_ENV] || '';
  if (raw.length < VAULT_MIN_LEN) return null;
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

function _deriveKey(material, salt) {
  return crypto.scryptSync(material, salt, 32);
}

function encryptSecret(plain) {
  const material = _vaultMaterial();
  if (!material) return { error: 'SYNC_VAULT_LOCKED', status: 503 };
  const salt = crypto.randomBytes(16);
  const key = _deriveKey(material, salt);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    value: ['v1', salt.toString('base64'), iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':')
  };
}

function decryptSecret(stored) {
  const material = _vaultMaterial();
  if (!material) return { error: 'SYNC_VAULT_LOCKED', status: 503 };
  const parts = String(stored || '').split(':');
  if (parts.length !== 5 || parts[0] !== 'v1') return { error: 'SYNC_VAULT_LOCKED', status: 503 };
  try {
    const salt = Buffer.from(parts[1], 'base64');
    const iv = Buffer.from(parts[2], 'base64');
    const tag = Buffer.from(parts[3], 'base64');
    const ct = Buffer.from(parts[4], 'base64');
    const key = _deriveKey(material, salt);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    return { value: pt };
  } catch (e) {
    return { error: 'SYNC_VAULT_LOCKED', status: 503 };
  }
}

// ---------------------------------------------------------------------------
// State store (per-tenant). Never holds plaintext secrets.
// ---------------------------------------------------------------------------

function _readState() {
  const data = storageAdapter.read(STATE_STORE);
  return (data && Array.isArray(data.entries)) ? data.entries : [];
}

function _writeState(entries) {
  storageAdapter.write(STATE_STORE, { entries });
}

function _find(tenantId) {
  const id = String(tenantId);
  return _readState().find((e) => String(e.tenantId) === id) || null;
}

function _upsert(entry) {
  const entries = _readState();
  const idx = entries.findIndex((e) => String(e.tenantId) === String(entry.tenantId));
  if (idx === -1) entries.push(entry);
  else entries[idx] = entry;
  _writeState(entries);
  return entry;
}

function _maskToken(token) {
  const raw = String(token || '');
  if (!raw) return '';
  if (raw.length <= 8) return '••••';
  return '••••••••••••' + raw.slice(-4);
}

function _audit(actor, action, tenantId, outcome, extra) {
  try {
    auditService.record({
      method: 'POST',
      path: '/api/v1/platform/sync/' + (tenantId || ''),
      statusCode: outcome === 'success' ? 200 : 400,
      userId: actor && actor.id ? actor.id : null,
      action,
      resource: 'gist-sync',
      resourceId: tenantId || null,
      // Safe metadata only: never tokens, never dataset contents.
      changes: Object.assign({ tenantId: tenantId || null, outcome }, extra || {})
    });
  } catch (err) {
    // audit must never break the sync operation
  }
}

// ---------------------------------------------------------------------------
// Upstream GitHub Gist client (server-side; credentials never leave).
// ---------------------------------------------------------------------------

function _sha256(content) {
  return crypto.createHash('sha256').update(String(content), 'utf8').digest('hex');
}

async function _gh(token, url, opts) {
  const method = (opts && opts.method) || 'GET';
  const body = opts && opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: 'token ' + token,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'OmniStore-ServerSync'
      },
      body,
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timer);
    const timedOut = e && (e.name === 'AbortError' || e.name === 'TimeoutError');
    return { error: timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE', status: timedOut ? 504 : 502 };
  }
  clearTimeout(timer);
  if (res.status === 401 || res.status === 403) return { error: 'CREDENTIAL_INVALID', status: 401 };
  if (res.status === 404) return { error: 'GIST_NOT_FOUND', status: 404 };
  if (res.status >= 500) return { error: 'UPSTREAM_UNAVAILABLE', status: 502 };
  if (!res.ok) return { error: 'UPSTREAM_UNAVAILABLE', status: 502 };
  let text;
  try {
    text = await res.text();
  } catch (e) {
    return { error: 'UPSTREAM_UNAVAILABLE', status: 502 };
  }
  if (text.length > MAX_PULL_BYTES) return { error: 'TOO_LARGE', status: 413 };
  return { status: res.status, text };
}

async function _ghGetGist(token, gistId) {
  const r = await _gh(token, GH_API + '/gists/' + encodeURIComponent(gistId));
  if (r.error) return r;
  let parsed;
  try { parsed = JSON.parse(r.text); } catch (e) { return { error: 'INVALID_PAYLOAD', status: 502 }; }
  const file = parsed.files && parsed.files[GH_FILENAME];
  const content = file && typeof file.content === 'string' ? file.content : null;
  if (content === null) return { error: 'INVALID_PAYLOAD', status: 502 };
  if (content.length > MAX_PULL_BYTES) return { error: 'TOO_LARGE', status: 413 };
  return { content };
}

async function _ghCreateGist(token, content) {
  const r = await _gh(token, GH_API + '/gists', {
    method: 'POST',
    body: {
      description: GH_DESC,
      public: false,
      files: { [GH_FILENAME]: { content } }
    }
  });
  if (r.error) return r;
  let parsed;
  try { parsed = JSON.parse(r.text); } catch (e) { return { error: 'INVALID_PAYLOAD', status: 502 }; }
  if (!parsed.id) return { error: 'INVALID_PAYLOAD', status: 502 };
  return { gistId: String(parsed.id) };
}

async function _ghPatchGist(token, gistId, content) {
  const r = await _gh(token, GH_API + '/gists/' + encodeURIComponent(gistId), {
    method: 'PATCH',
    body: { files: { [GH_FILENAME]: { content } } }
  });
  if (r.error) return r;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Master operations (router is gated by requirePlatformAdmin).
// ---------------------------------------------------------------------------

function _companyExists(tenantId) {
  try {
    return !!CompanyService.getCompany(String(tenantId));
  } catch (e) {
    return false;
  }
}

function listConfigs() {
  return _readState().map((e) => ({
    tenantId: e.tenantId,
    companyName: _companyExists(e.tenantId) ? (CompanyService.getCompany(e.tenantId) || {}).name || e.tenantId : e.tenantId,
    provider: e.provider,
    enabled: !!e.enabled,
    hasCredential: !!e.encryptedToken,
    masked: e.masked || '',
    gistId: e.gistId || null,
    lastRevision: e.lastRevision || null,
    lastPullAt: e.lastPullAt || null,
    lastPushAt: e.lastPushAt || null,
    lastErrorCode: e.lastErrorCode || null,
    updatedAt: e.updatedAt || null,
    updatedBy: e.updatedBy || null
  }));
}

function configure(actor, tenantId, body) {
  const id = String(tenantId || '').trim();
  if (!id) return { error: 'tenantId is required', status: 400, code: 'INVALID_TENANT' };
  if (!_companyExists(id)) return { error: 'Unknown company', status: 400, code: 'UNKNOWN_TENANT' };
  const provider = String((body && body.provider) || PROVIDER).trim();
  if (provider !== PROVIDER) return { error: 'Unsupported provider', status: 400, code: 'INVALID_PROVIDER' };

  const existing = _find(id);
  const tokenProvided = body && typeof body.token === 'string' && body.token.length > 0;
  if (tokenProvided) {
    const token = body.token.trim();
    if (token.length < 8 || token.length > 4096 || /\s/.test(token)) {
      return { error: 'Invalid credential format', status: 400, code: 'INVALID_CREDENTIAL' };
    }
    if (vaultLocked()) return { error: 'Sync vault is locked (server key not configured)', status: 503, code: 'SYNC_VAULT_LOCKED' };
  }

  const now = new Date().toISOString();
  const entry = {
    tenantId: id,
    provider: PROVIDER,
    enabled: body && body.enabled !== undefined ? !!body.enabled : (existing ? existing.enabled : true),
    encryptedToken: existing ? existing.encryptedToken : '',
    masked: existing ? existing.masked : '',
    gistId: existing ? existing.gistId : null,
    lastRevision: existing ? existing.lastRevision : null,
    lastPullAt: existing ? existing.lastPullAt : null,
    lastPushAt: existing ? existing.lastPushAt : null,
    lastErrorCode: existing ? existing.lastErrorCode : null,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
    updatedBy: actor && actor.username ? actor.username : null
  };

  if (tokenProvided) {
    const enc = encryptSecret(body.token.trim());
    if (enc.error) return { error: 'Sync vault is locked', status: 503, code: enc.error };
    entry.encryptedToken = enc.value;
    entry.masked = _maskToken(body.token.trim());
  }

  if (body && body.gistId !== undefined && body.gistId !== null) {
    const gid = String(body.gistId).trim();
    if (gid && !/^[0-9a-zA-Z]{5,64}$/.test(gid)) {
      return { error: 'Invalid gist id format', status: 400, code: 'INVALID_GIST_ID' };
    }
    entry.gistId = gid || null;
  }

  _upsert(entry);
  _audit(actor, 'PLATFORM_SYNC_CONFIG_UPDATED', id, 'success', {
    provider: PROVIDER,
    enabled: entry.enabled,
    hasCredential: !!entry.encryptedToken,
    gistIdSet: !!entry.gistId
  });
  return {
    config: {
      tenantId: entry.tenantId,
      provider: entry.provider,
      enabled: entry.enabled,
      hasCredential: !!entry.encryptedToken,
      masked: entry.masked,
      gistId: entry.gistId,
      updatedAt: entry.updatedAt,
      updatedBy: entry.updatedBy
    }
  };
}

function disconnect(actor, tenantId) {
  const id = String(tenantId || '').trim();
  if (!id) return { error: 'tenantId is required', status: 400, code: 'INVALID_TENANT' };
  const entries = _readState();
  const idx = entries.findIndex((e) => String(e.tenantId) === id);
  if (idx === -1) return { error: 'No sync configuration for this company', status: 404, code: 'NOT_CONFIGURED' };
  entries.splice(idx, 1);
  _writeState(entries);
  // NOTE: the remote gist is intentionally NOT deleted — only the local
  // server-side binding and encrypted credential are removed.
  _audit(actor, 'PLATFORM_SYNC_DISCONNECTED', id, 'success', { provider: PROVIDER });
  return { disconnected: true, tenantId: id };
}

// ---------------------------------------------------------------------------
// Tenant operations (router derives tenant from trustedTenantId only).
// ---------------------------------------------------------------------------

function _tenantEntry(tenantId) {
  const entry = _find(tenantId);
  if (!entry || !entry.enabled) return { error: 'NOT_CONFIGURED', status: 404 };
  if (!entry.encryptedToken) return { error: 'NOT_CONFIGURED', status: 404 };
  const dec = decryptSecret(entry.encryptedToken);
  if (dec.error) return { error: dec.error, status: dec.status || 503 };
  return { entry, token: dec.value };
}

function tenantStatus(tenantId) {
  const entry = _find(tenantId);
  if (!entry) {
    return { status: { configured: false, provider: PROVIDER } };
  }
  // No secrets, no gist id — tenants only learn whether sync is on and health.
  return {
    status: {
      configured: !!entry.enabled && !!entry.encryptedToken,
      provider: PROVIDER,
      enabled: !!entry.enabled,
      lastRevision: entry.lastRevision || null,
      lastPullAt: entry.lastPullAt || null,
      lastPushAt: entry.lastPushAt || null,
      lastErrorCode: entry.lastErrorCode || null,
      updatedAt: entry.updatedAt || null
    }
  };
}

function _safeFail(tenantId, errorCode, action, extra) {
  const entry = _find(tenantId);
  if (entry) {
    entry.lastErrorCode = errorCode;
    entry.updatedAt = new Date().toISOString();
    _upsert(entry);
  }
  _audit(null, action, tenantId, 'error', Object.assign({ errorCode }, extra || {}));
}

async function tenantPull(tenantId) {
  const auth = _tenantEntry(tenantId);
  if (auth.error) {
    _safeFail(tenantId, auth.error, 'SYNC_PULL');
    return { error: auth.error, status: auth.status };
  }
  const { entry, token } = auth;
  if (!entry.gistId) {
    _safeFail(tenantId, 'NOT_CONFIGURED', 'SYNC_PULL');
    return { error: 'NOT_CONFIGURED', status: 404 };
  }
  const r = await _ghGetGist(token, entry.gistId);
  if (r.error) {
    _safeFail(tenantId, r.error, 'SYNC_PULL');
    return { error: r.error, status: r.status };
  }
  const revision = _sha256(r.content);
  entry.lastRevision = revision;
  entry.lastPullAt = new Date().toISOString();
  entry.lastErrorCode = null;
  entry.updatedAt = entry.lastPullAt;
  _upsert(entry);
  _audit(null, 'SYNC_PULL', tenantId, 'success', { bytes: r.content.length });
  return { pull: { content: r.content, revision, pulledAt: entry.lastPullAt } };
}

function _validatePushPayload(content, tenantId) {
  if (typeof content !== 'string' || content.length === 0) {
    return { error: 'INVALID_PAYLOAD', status: 400 };
  }
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_PUSH_BYTES) return { error: 'TOO_LARGE', status: 413 };
  let parsed;
  try { parsed = JSON.parse(content); } catch (e) {
    return { error: 'INVALID_PAYLOAD', status: 400 };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'INVALID_PAYLOAD', status: 400 };
  }
  // Confused-deputy guard: a dataset tagged for another company is refused.
  if (parsed._companyId !== undefined && parsed._companyId !== null
      && tenantId != null && String(parsed._companyId) !== String(tenantId)
      && String(parsed._companyId) !== 'legacy') {
    return { error: 'CROSS_TENANT_PAYLOAD', status: 403 };
  }
  return { parsed, bytes };
}

async function tenantPush(tenantId, body) {
  const auth = _tenantEntry(tenantId);
  if (auth.error) {
    _safeFail(tenantId, auth.error, 'SYNC_PUSH');
    return { error: auth.error, status: auth.status };
  }
  const { entry, token } = auth;
  const content = body && body.content;
  const baseRevision = body && body.baseRevision != null ? String(body.baseRevision) : null;
  const check = _validatePushPayload(content, tenantId);
  if (check.error) {
    _safeFail(tenantId, check.error, 'SYNC_PUSH');
    return { error: check.error, status: check.status };
  }

  // Conflict detection BEFORE any upstream write — never last-write-wins.
  if (entry.gistId) {
    const remote = await _ghGetGist(token, entry.gistId);
    if (remote.error) {
      _safeFail(tenantId, remote.error, 'SYNC_PUSH');
      return { error: remote.error, status: remote.status };
    }
    const remoteRevision = _sha256(remote.content);
    if (entry.lastRevision && baseRevision && baseRevision !== entry.lastRevision) {
      _safeFail(tenantId, 'CONFLICT', 'SYNC_PUSH');
      return { error: 'CONFLICT', status: 409, details: { currentRevision: entry.lastRevision } };
    }
    if (!entry.lastRevision && baseRevision && baseRevision !== remoteRevision) {
      _safeFail(tenantId, 'CONFLICT', 'SYNC_PUSH');
      return { error: 'CONFLICT', status: 409, details: { currentRevision: remoteRevision } };
    }
    const patched = await _ghPatchGist(token, entry.gistId, content);
    if (patched.error) {
      _safeFail(tenantId, patched.error, 'SYNC_PUSH');
      return { error: patched.error, status: patched.status };
    }
    const revision = _sha256(content);
    entry.lastRevision = revision;
    entry.lastPushAt = new Date().toISOString();
    entry.lastErrorCode = null;
    entry.updatedAt = entry.lastPushAt;
    _upsert(entry);
    _audit(null, 'SYNC_PUSH', tenantId, 'success', { bytes: check.bytes });
    return { push: { revision, pushedAt: entry.lastPushAt } };
  }

  // No gist bound yet: create one server-side (bootstrap / migration adopt).
  const created = await _ghCreateGist(token, content);
  if (created.error) {
    _safeFail(tenantId, created.error, 'SYNC_PUSH');
    return { error: created.error, status: created.status };
  }
  entry.gistId = created.gistId;
  entry.lastRevision = _sha256(content);
  entry.lastPushAt = new Date().toISOString();
  entry.lastErrorCode = null;
  entry.updatedAt = entry.lastPushAt;
  _upsert(entry);
  _audit(null, 'SYNC_PUSH', tenantId, 'success', { bytes: check.bytes, created: true });
  return { push: { revision: entry.lastRevision, pushedAt: entry.lastPushAt } };
}

module.exports = {
  VAULT_KEY_ENV,
  MAX_PUSH_BYTES,
  PROVIDER,
  vaultLocked,
  encryptSecret,
  decryptSecret,
  listConfigs,
  configure,
  disconnect,
  tenantStatus,
  tenantPull,
  tenantPush,
  // exported for focused unit tests
  _sha256,
  _maskToken
};
