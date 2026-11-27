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
//   - Pushes require a non-null baseRevision (content sha256) that matches
//     BOTH the tracked lastRevision (when set) AND the current remote sha;
//     any mismatch — including a missing base — returns 409 CONFLICT with
//     currentRevision. Never silent last-write-wins. Partial upstream
//     failures leave state unchanged. Per-tenant async lock serializes
//     pull/push inside this process (single-writer); cross-process
//     interleaving remains a documented limitation (GIST_SYNC_MIGRATION_PLAN).
//   - Safe error codes only cross the boundary (VAULT_LOCKED, NOT_CONFIGURED,
//     CREDENTIAL_INVALID, GIST_NOT_FOUND, UPSTREAM_UNAVAILABLE, UPSTREAM_TIMEOUT,
//     TOO_LARGE, INVALID_PAYLOAD, CROSS_TENANT_PAYLOAD, CONFLICT). Provider
//     response bodies and dataset contents are never logged or audited.

const crypto = require('crypto');
const storageAdapter = require('../repositories/storageAdapter');
const auditService = require('./audit.service');
const CompanyService = require('./company.service');

const STATE_STORE = 'gistSyncState';
const LEGACY_STORE = 'legacyMigrationState';
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

// Legacy-report evidence bounds (FIX A). Device ids are non-secret, stable
// identifiers chosen by the client; the server validates and bounds every
// client-supplied field and never accepts token material or dataset content.
const MAX_REPORT_BODY_BYTES = 4096;
const MAX_REPORT_DEVICES = 64;
const MAX_INVENTORY_DEVICES = 64;
const DEVICE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

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

// ---------------------------------------------------------------------------
// Legacy migration state model (GATE 4).
//
// Six states, derived server-side from SERVER evidence (binding + pull/push
// history) plus a device-DECLARED legacy-presence boolean. The device report
// is advisory only: it never grants access, never influences tenant
// resolution (still trustedTenantId(req) exclusively) and NEVER carries token
// material — only "does this device still hold the old localStorage PAT".
//
//   LEGACY_NOT_SEEN             no server binding, no legacy report
//   LEGACY_PRESENT_NOT_MIGRATED device still holds the old PAT, migration
//                               not yet verified
//   SERVER_SYNC_AVAILABLE       server binding live, verification pending,
//                               no lingering legacy PAT reported
//   MIGRATION_VERIFIED          server pull + push both observed; legacy
//                               report absent (unknown) or not yet cleared
//   LEGACY_REVOCATION_PENDING   verified, but a device still reports the PAT
//   LEGACY_REVOKED              verified and every report says cleared
// ---------------------------------------------------------------------------

function _readLegacy() {
  const data = storageAdapter.read(LEGACY_STORE);
  return (data && Array.isArray(data.entries)) ? data.entries : [];
}

function _findLegacy(tenantId) {
  const id = String(tenantId);
  return _readLegacy().find((e) => String(e.tenantId) === id) || null;
}

function _normalizeDeviceId(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim().toLowerCase();
  if (!DEVICE_ID_RE.test(id)) return null;
  return id;
}

// Effective "legacy PAT still held somewhere" OR across the device-less (v1)
// slot and every per-device v2 record. Conservative by design: any device
// still reporting holds=true keeps revocation incomplete.
function _legacyHolds(rec) {
  if (!rec) return false;
  if (rec.holdsLegacyToken === true) return true;
  const devices = rec.devices;
  if (devices && typeof devices === 'object') {
    const ids = Object.keys(devices);
    for (let i = 0; i < ids.length; i++) {
      const d = devices[ids[i]];
      if (d && d.holds === true) return true;
    }
  }
  return false;
}

// Revocation gate (FIX A). LEGACY_REVOKED requires ALL of:
//   1. a platform-owner attested, server-authoritative device inventory
//      (fail-closed: no inventory => never revoked), non-empty and well-formed;
//   2. affirmative clearance (holds === false) from EVERY expected device;
//   3. each clearance reported AFTER the attestation (stale evidence fails);
//   4. no device-less v1 record claiming holds=true and no device record
//      claiming holds=true (see _legacyHolds).
// Evidence from devices outside the trusted inventory is ignored for
// clearance and cannot shorten the gate; unknown devices reporting holds=true
// still block via _legacyHolds.
function _revocationGateClear(rec) {
  if (!rec) return false;
  const inv = rec.inventory;
  if (!inv || !Array.isArray(inv.devices) || inv.devices.length === 0) return false;
  const attestedMs = Date.parse(String(inv.attestedAt || ''));
  if (!Number.isFinite(attestedMs)) return false;
  const devices = (rec.devices && typeof rec.devices === 'object') ? rec.devices : {};
  // Evidence from a device outside the trusted inventory means the attested
  // inventory is incomplete => fail closed. (setDeviceInventory prunes stale
  // unknown holds=false records on re-attestation so retired devices can be
  // released by the owner; unknown holds=true records are retained.)
  const reportedIds = Object.keys(devices);
  for (let i = 0; i < reportedIds.length; i++) {
    if (inv.devices.indexOf(reportedIds[i]) === -1) return false;
  }
  // Every expected device needs affirmative clearance recorded after
  // the attestation (stale evidence fails the gate).
  for (let i = 0; i < inv.devices.length; i++) {
    const d = devices[inv.devices[i]];
    if (!d || d.holds !== false) return false;
    const clearedMs = Date.parse(String(d.reportedAt || ''));
    if (!Number.isFinite(clearedMs) || clearedMs < attestedMs) return false;
  }
  return true;
}

function _migrationState(entry, legacyRec) {
  const serverAvail = !!(entry && entry.enabled && entry.encryptedToken);
  const verified = !!(entry && entry.lastPullAt && entry.lastPushAt);
  const reported = !!(legacyRec && legacyRec.reportedAt);
  const holds = _legacyHolds(legacyRec);
  if (verified && holds) return 'LEGACY_REVOCATION_PENDING';
  if (verified && reported && !holds && _revocationGateClear(legacyRec)) return 'LEGACY_REVOKED';
  if (verified) return 'MIGRATION_VERIFIED';
  if (holds) return 'LEGACY_PRESENT_NOT_MIGRATED';
  if (serverAvail) return 'SERVER_SYNC_AVAILABLE';
  return 'LEGACY_NOT_SEEN';
}

// Device report of legacy PAT presence (advisory, never trusted for identity
// or authorization). v1 (device-less) reports write a single last-writer slot
// and can NEVER establish LEGACY_REVOKED on their own; v2 reports carry a
// validated non-secret deviceId and build the per-device evidence map the
// revocation gate consumes. No token material or dataset content is accepted.
function reportLegacy(tenantId, body) {
  const id = String(tenantId || '').trim();
  if (!id) return { error: 'tenantId is required', status: 400, code: 'INVALID_TENANT' };
  const holds = body && body.holdsLegacyToken;
  if (typeof holds !== 'boolean') {
    return { error: 'holdsLegacyToken must be a boolean', status: 400, code: 'INVALID_LEGACY_REPORT' };
  }
  if (body && body.reportVersion !== undefined && body.reportVersion !== 1 && body.reportVersion !== 2) {
    return { error: 'Unsupported report version', status: 400, code: 'INVALID_LEGACY_REPORT' };
  }
  let raw = '';
  try { raw = JSON.stringify(body) || ''; } catch (e) { raw = ''; }
  if (raw.length > MAX_REPORT_BODY_BYTES) {
    return { error: 'Report too large', status: 400, code: 'INVALID_LEGACY_REPORT' };
  }
  let device = null;
  if (body && body.deviceId !== undefined && body.deviceId !== null) {
    device = _normalizeDeviceId(body.deviceId);
    if (!device) {
      return { error: 'Invalid deviceId', status: 400, code: 'INVALID_LEGACY_REPORT' };
    }
  }
  const records = _readLegacy();
  const now = new Date().toISOString();
  let rec = records.find((e) => String(e.tenantId) === id);
  if (!rec) {
    rec = { tenantId: id, holdsLegacyToken: false, reportedAt: now, updatedAt: now };
    records.push(rec);
  }
  if (device) {
    const existing = (rec.devices && typeof rec.devices === 'object') ? rec.devices : null;
    const known = existing && Object.prototype.hasOwnProperty.call(existing, device);
    if (!known && existing && Object.keys(existing).length >= MAX_REPORT_DEVICES) {
      return { error: 'Device evidence limit reached', status: 400, code: 'INVALID_LEGACY_REPORT' };
    }
    rec.devices = Object.assign({}, existing || {});
    rec.devices[device] = { holds, reportedAt: now };
  } else {
    // v1 device-less report: last-writer slot only; never device clearance.
    rec.holdsLegacyToken = holds;
  }
  rec.reportedAt = now;
  rec.updatedAt = now;
  storageAdapter.write(LEGACY_STORE, { entries: records });
  const aggregate = _legacyHolds(rec);
  _audit(null, 'LEGACY_REPORT', id, 'success', { holdsLegacyToken: aggregate, deviceId: device || null });
  return {
    report: {
      tenantId: id,
      holdsLegacyToken: aggregate,
      reportedAt: now,
      migrationState: _migrationState(_find(id), rec)
    }
  };
}

// Trusted device inventory (FIX A). Server-authoritative and platform-owner
// controlled: writable ONLY through the requirePlatformAdmin master surface,
// never by tenant clients (devices cannot supply or override the expected
// device set). Stored in legacyMigrationState per tenant; contains only
// non-secret device ids + attestation metadata.
function getDeviceInventory(actor, tenantId) {
  const id = String(tenantId || '').trim();
  if (!id) return { error: 'tenantId is required', status: 400, code: 'INVALID_TENANT' };
  if (!_companyExists(id)) return { error: 'Unknown company', status: 400, code: 'UNKNOWN_TENANT' };
  const rec = _findLegacy(id);
  const inv = rec && rec.inventory;
  return {
    inventory: (inv && Array.isArray(inv.devices))
      ? { tenantId: id, devices: inv.devices.slice(), attestedAt: inv.attestedAt || null, attestedBy: inv.attestedBy || null }
      : { tenantId: id, devices: null, attestedAt: null, attestedBy: null }
  };
}

function setDeviceInventory(actor, tenantId, body) {
  const id = String(tenantId || '').trim();
  if (!id) return { error: 'tenantId is required', status: 400, code: 'INVALID_TENANT' };
  if (!_companyExists(id)) return { error: 'Unknown company', status: 400, code: 'UNKNOWN_TENANT' };
  const raw = body && body.devices;
  if (!Array.isArray(raw)) {
    return { error: 'devices must be an array', status: 400, code: 'INVALID_DEVICE_INVENTORY' };
  }
  if (raw.length < 1 || raw.length > MAX_INVENTORY_DEVICES) {
    return { error: 'devices must contain 1 to ' + MAX_INVENTORY_DEVICES + ' entries', status: 400, code: 'INVALID_DEVICE_INVENTORY' };
  }
  const ids = [];
  const seen = {};
  for (let i = 0; i < raw.length; i++) {
    const d = _normalizeDeviceId(raw[i]);
    if (!d) {
      return { error: 'Invalid device id in inventory', status: 400, code: 'INVALID_DEVICE_INVENTORY' };
    }
    if (seen[d]) {
      return { error: 'Duplicate device id in inventory', status: 400, code: 'INVALID_DEVICE_INVENTORY' };
    }
    seen[d] = true;
    ids.push(d);
  }
  const now = new Date().toISOString();
  const records = _readLegacy();
  let rec = records.find((e) => String(e.tenantId) === id);
  if (!rec) {
    rec = { tenantId: id };
    records.push(rec);
  }
  // Fresh attestation invalidates every clearance recorded before it (stale
  // evidence cannot satisfy the gate). Unknown-device holds=false evidence is
  // pruned so retired devices cannot pin a tenant forever; unknown-device
  // holds=true evidence is intentionally retained and keeps revocation
  // incomplete until that device clears or is attested and handled.
  if (rec.devices && typeof rec.devices === 'object') {
    const pruned = {};
    for (const k of Object.keys(rec.devices)) {
      const d = rec.devices[k];
      if (seen[k]) pruned[k] = d;
      else if (d && d.holds === true) pruned[k] = d;
    }
    rec.devices = pruned;
  }
  rec.inventory = {
    devices: ids,
    attestedAt: now,
    attestedBy: actor && actor.username ? actor.username : null
  };
  rec.updatedAt = now;
  storageAdapter.write(LEGACY_STORE, { entries: records });
  _audit(actor, 'PLATFORM_DEVICE_INVENTORY_ATTESTED', id, 'success', { deviceCount: ids.length });
  return {
    inventory: {
      tenantId: id,
      devices: ids.slice(),
      attestedAt: now,
      attestedBy: rec.inventory.attestedBy
    }
  };
}

function _maskToken(token) {
  const raw = String(token || '');
  if (!raw) return '';
  if (raw.length <= 8) return '••••';
  return '••••••••••••' + raw.slice(-4);
}

// Derived UI state (server is the single source of truth for the MCC):
//   NOT_CONFIGURED | LOCKED | ERROR | CONFLICT | CONNECTED
// SYNCING is a client-side transient while an action is in flight.
const CONNECTIVITY_CODES = ['CREDENTIAL_INVALID', 'GIST_NOT_FOUND', 'UPSTREAM_UNAVAILABLE', 'UPSTREAM_TIMEOUT'];

function _stateOf(entry, vaultIsLocked) {
  if (!entry || !entry.enabled || !entry.encryptedToken) return 'NOT_CONFIGURED';
  if (vaultIsLocked) return 'LOCKED';
  const code = entry.lastErrorCode;
  if (!code) return 'CONNECTED';
  if (code === 'CONFLICT') return 'CONFLICT';
  if (code === 'NOT_CONFIGURED') return 'NOT_CONFIGURED';
  return 'ERROR';
}

// Per-tenant async operation lock. Conflict-check + upstream write must be
// atomic with respect to other sync ops for the SAME tenant inside this
// process; without it two interleaved pushes could both pass the conflict
// probe and the second would silently win. Cross-process/replica runs are
// NOT covered (documented limitation).
const _opLocks = new Map();
function _withTenantLock(tenantId, fn) {
  const key = String(tenantId);
  const prev = _opLocks.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(() => undefined, () => undefined);
  _opLocks.set(key, tail);
  tail.then(() => {
    if (_opLocks.get(key) === tail) _opLocks.delete(key);
  });
  return run;
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

// Every company (from the companies store) plus any configured-but-orphaned
// binding, so the MCC can show NOT_CONFIGURED rows too. Masked-only: no
// encrypted token, no raw token, ever.
function listConfigs() {
  const locked = vaultLocked();
  const entries = _readState();
  const byTenant = {};
  for (const e of entries) byTenant[String(e.tenantId)] = e;

  let companies = [];
  try { companies = CompanyService.listCompanies() || []; } catch (e) { companies = []; }

  const ids = [];
  const seen = {};
  for (const c of companies) {
    if (!c || c.id == null) continue;
    const id = String(c.id);
    if (seen[id]) continue;
    seen[id] = true;
    ids.push({ id, company: c });
  }
  for (const id of Object.keys(byTenant)) {
    if (seen[id]) continue;
    seen[id] = true;
    ids.push({ id, company: null });
  }

  const legacyEntries = _readLegacy();
  const legacyByTenant = {};
  for (const l of legacyEntries) legacyByTenant[String(l.tenantId)] = l;

  return ids.map(({ id, company }) => {
    const e = byTenant[id] || null;
    return {
      tenantId: id,
      companyName: (company && company.name) || id,
      active: company ? company.active !== false : false,
      provider: PROVIDER,
      configured: !!(e && e.enabled && e.encryptedToken),
      enabled: !!(e && e.enabled),
      hasCredential: !!(e && e.encryptedToken),
      vaultLocked: !!(e && e.encryptedToken && locked),
      masked: (e && e.masked) || '',
      gistId: (e && e.gistId) || null,
      lastRevision: (e && e.lastRevision) || null,
      lastPullAt: (e && e.lastPullAt) || null,
      lastPushAt: (e && e.lastPushAt) || null,
      lastErrorCode: (e && e.lastErrorCode) || null,
      updatedAt: (e && e.updatedAt) || null,
      updatedBy: (e && e.updatedBy) || null,
      state: _stateOf(e, locked),
      migrationState: _migrationState(e, legacyByTenant[id] || null)
    };
  });
}

// Per-tenant audit trail (gist-sync resource only), metadata-only entries.
function listSyncAudit(tenantId, opts) {
  const id = String(tenantId || '').trim();
  if (!id) return { error: 'tenantId is required', status: 400, code: 'INVALID_TENANT' };
  const limit = Math.min(Math.max(parseInt((opts && opts.limit) || 50, 10) || 50, 1), 200);
  let entries = [];
  try {
    const q = auditService.query({ resource: 'gist-sync', page: 1, limit: 500 });
    entries = ((q && q.entries) || []).filter((e) => String(e.resourceId) === id);
  } catch (e) {
    entries = [];
  }
  entries = entries.slice(0, limit).map((e) => ({
    id: e.id || null,
    timestamp: e.timestamp || null,
    action: e.action || null,
    userId: e.userId || null,
    statusCode: e.statusCode || null,
    changes: e.changes || {}
  }));
  return { audit: { tenantId: id, entries } };
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
  const migrationState = _migrationState(entry, _findLegacy(tenantId));
  if (!entry) {
    return { status: { configured: false, provider: PROVIDER, migrationState } };
  }
  // No secrets, no gist id — tenants only learn whether sync is on and health.
  return {
    status: {
      configured: !!entry.enabled && !!entry.encryptedToken,
      provider: PROVIDER,
      enabled: !!entry.enabled,
      migrationState,
      vaultLocked: !!(entry.encryptedToken && vaultLocked()),
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

// Shared pull core. opts.action = audit action, opts.actor = audit actor,
// opts.includeContent = include dataset content in the result (tenant path
// only — the Master/MCC path NEVER receives dataset contents).
async function _doPull(tenantId, opts) {
  const action = (opts && opts.action) || 'SYNC_PULL';
  const actor = (opts && opts.actor) || null;
  const includeContent = !!(opts && opts.includeContent);
  const auth = _tenantEntry(tenantId);
  if (auth.error) {
    _safeFail(tenantId, auth.error, action);
    return { error: auth.error, status: auth.status };
  }
  const { entry, token } = auth;
  if (!entry.gistId) {
    _safeFail(tenantId, 'NOT_CONFIGURED', action);
    return { error: 'NOT_CONFIGURED', status: 404 };
  }
  return _withTenantLock(tenantId, async () => {
    const fresh = _find(tenantId) || entry;
    const r = await _ghGetGist(token, fresh.gistId);
    if (r.error) {
      _safeFail(tenantId, r.error, action);
      return { error: r.error, status: r.status };
    }
    // Binding guard on read: never return a gist tagged for a different
    // real company (misconfigured gistId = cross-tenant leak). Absent tag
    // and the legacy placeholder tag 'legacy' are allowed — legacy gists
    // were written by the browser flow as <tenantId> || 'legacy', and
    // index.html's client-side applyGhContent enforces the tenant binding.
    const binding = _bindingOf(r.content, tenantId);
    if (binding.error) {
      _safeFail(tenantId, binding.error, action);
      return { error: binding.error, status: binding.status };
    }
    const revision = _sha256(r.content);
    const bytes = Buffer.byteLength(r.content, 'utf8');
    fresh.lastRevision = revision;
    fresh.lastPullAt = new Date().toISOString();
    fresh.lastErrorCode = null;
    fresh.updatedAt = fresh.lastPullAt;
    _upsert(fresh);
    _audit(actor, action, tenantId, 'success', { bytes, binding: binding.tag });
    const pull = { revision, pulledAt: fresh.lastPullAt, bytes, binding: binding.tag };
    if (includeContent) pull.content = r.content;
    return { pull };
  });
}

// Parse a dataset and classify its tenant binding:
//   { tag: 'own'|'legacy'|'unbound' } or { error, status } on foreign tag.
function _bindingOf(content, tenantId) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return { error: 'INVALID_PAYLOAD', status: 502 };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'INVALID_PAYLOAD', status: 502 };
  }
  if (parsed._companyId === undefined || parsed._companyId === null) return { tag: 'unbound' };
  const bound = String(parsed._companyId);
  if (bound === String(tenantId)) return { tag: 'own' };
  if (bound === 'legacy') return { tag: 'legacy' };
  return { error: 'CROSS_TENANT_PAYLOAD', status: 403 };
}

async function tenantPull(tenantId) {
  return _doPull(tenantId, { action: 'SYNC_PULL', includeContent: true });
}

// Master pull (MCC): fetch + validate + record revision, NO dataset content.
async function masterPull(actor, tenantId) {
  return _doPull(tenantId, { action: 'PLATFORM_SYNC_PULL', actor, includeContent: false });
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

// Shared push core (tenant AND Master paths): strict conflict proof,
// authoritative tenant stamping, per-tenant lock. opts.action/opts.actor
// only differ in which audit trail the operation lands in.
async function _doPush(tenantId, body, opts) {
  const action = (opts && opts.action) || 'SYNC_PUSH';
  const actor = (opts && opts.actor) || null;
  const auth = _tenantEntry(tenantId);
  if (auth.error) {
    _safeFail(tenantId, auth.error, action);
    return { error: auth.error, status: auth.status };
  }
  const { token } = auth;
  const content = body && body.content;
  // baseRevision is REQUIRED for every push against an already-bound gist.
  // A missing/null base is treated as a conflict — never as "trust me".
  const baseRevision = body && body.baseRevision != null && String(body.baseRevision).trim() !== ''
    ? String(body.baseRevision).trim()
    : null;
  const check = _validatePushPayload(content, tenantId);
  if (check.error) {
    _safeFail(tenantId, check.error, action);
    return { error: check.error, status: check.status };
  }

  // Authoritative tenant binding: the SERVER stamps the trusted tenant id
  // onto the dataset (after the confused-deputy foreign-tag check above).
  // Client-supplied 'legacy'/missing tags are replaced so every other
  // device of this tenant passes its client-side binding guard on pull.
  check.parsed._companyId = String(tenantId);
  let stamped;
  try {
    stamped = JSON.stringify(check.parsed);
  } catch (e) {
    _safeFail(tenantId, 'INVALID_PAYLOAD', action);
    return { error: 'INVALID_PAYLOAD', status: 400 };
  }
  const bytes = Buffer.byteLength(stamped, 'utf8');
  if (bytes > MAX_PUSH_BYTES) {
    _safeFail(tenantId, 'TOO_LARGE', action);
    return { error: 'TOO_LARGE', status: 413 };
  }

  return _withTenantLock(tenantId, async () => {
    const entry = _find(tenantId) || auth.entry;
    if (!entry.enabled || !entry.encryptedToken) {
      _safeFail(tenantId, 'NOT_CONFIGURED', action);
      return { error: 'NOT_CONFIGURED', status: 404 };
    }

    // Strict conflict detection BEFORE any upstream write:
    //   - bound gist  => base must be present AND equal to both the tracked
    //     lastRevision (when one exists) AND the actual remote sha. This
    //     closes (a) null-base silent overwrite, (b) never-pulled devices
    //     echoing a status-seeded revision, (c) adopted gists being patched
    //     before the first pull, (d) external divergence of the gist.
    //   - unbound gist => bootstrap create (no remote to conflict with).
    if (entry.gistId) {
      const remote = await _ghGetGist(token, entry.gistId);
      if (remote.error) {
        _safeFail(tenantId, remote.error, action);
        return { error: remote.error, status: remote.status };
      }
      const remoteRevision = _sha256(remote.content);
      const serverBase = entry.lastRevision || remoteRevision;
      if (!baseRevision || baseRevision !== serverBase || baseRevision !== remoteRevision) {
        _safeFail(tenantId, 'CONFLICT', action);
        return { error: 'CONFLICT', status: 409, details: { currentRevision: remoteRevision } };
      }
      const patched = await _ghPatchGist(token, entry.gistId, stamped);
      if (patched.error) {
        _safeFail(tenantId, patched.error, action);
        return { error: patched.error, status: patched.status };
      }
      const revision = _sha256(stamped);
      entry.lastRevision = revision;
      entry.lastPushAt = new Date().toISOString();
      entry.lastErrorCode = null;
      entry.updatedAt = entry.lastPushAt;
      _upsert(entry);
      _audit(actor, action, tenantId, 'success', { bytes });
      return { push: { revision, pushedAt: entry.lastPushAt } };
    }

    // No gist bound yet: create one server-side (bootstrap / migration adopt).
    const created = await _ghCreateGist(token, stamped);
    if (created.error) {
      _safeFail(tenantId, created.error, action);
      return { error: created.error, status: created.status };
    }
    entry.gistId = created.gistId;
    entry.lastRevision = _sha256(stamped);
    entry.lastPushAt = new Date().toISOString();
    entry.lastErrorCode = null;
    entry.updatedAt = entry.lastPushAt;
    _upsert(entry);
    _audit(actor, action, tenantId, 'success', { bytes, created: true });
    return { push: { revision: entry.lastRevision, pushedAt: entry.lastPushAt } };
  });
}

async function tenantPush(tenantId, body) {
  return _doPush(tenantId, body, { action: 'SYNC_PUSH' });
}

// Master push (MCC): identical safety rules, audited as a platform action.
async function masterPush(actor, tenantId, body) {
  return _doPush(tenantId, body, { action: 'PLATFORM_SYNC_PUSH', actor });
}

// Master connectivity test (MCC): validates credential (and gist + binding
// when bound) against the provider. Success clears a stale connectivity
// error code; CONFLICT and payload codes are deliberately preserved.
async function testConnection(actor, tenantId) {
  const id = String(tenantId || '').trim();
  if (!id) return { error: 'tenantId is required', status: 400, code: 'INVALID_TENANT' };
  const auth = _tenantEntry(id);
  if (auth.error) {
    _safeFail(id, auth.error, 'SYNC_TESTED');
    return { error: auth.error, status: auth.status };
  }
  const { entry, token } = auth;
  const started = Date.now();

  let result;
  if (entry.gistId) {
    const r = await _ghGetGist(token, entry.gistId);
    if (r.error) {
      _safeFail(id, r.error, 'SYNC_TESTED');
      return { error: r.error, status: r.status };
    }
    const binding = _bindingOf(r.content, id);
    if (binding.error) {
      _safeFail(id, binding.error, 'SYNC_TESTED');
      return { error: binding.error, status: binding.status };
    }
    result = {
      ok: true,
      latencyMs: Date.now() - started,
      credential: 'ok',
      gist: 'ok',
      binding: binding.tag,
      currentRevision: _sha256(r.content),
      gistBound: true
    };
  } else {
    // Credential-only probe: an authenticated, cheap list call.
    const r = await _gh(token, GH_API + '/gists?per_page=1');
    if (r.error) {
      _safeFail(id, r.error, 'SYNC_TESTED');
      return { error: r.error, status: r.status };
    }
    result = {
      ok: true,
      latencyMs: Date.now() - started,
      credential: 'ok',
      gist: 'not_bound',
      binding: null,
      currentRevision: null,
      gistBound: false
    };
  }

  // Clear only stale connectivity errors — keep CONFLICT/payload signals.
  const entryNow = _find(id) || entry;
  if (entryNow.lastErrorCode && CONNECTIVITY_CODES.indexOf(entryNow.lastErrorCode) !== -1) {
    entryNow.lastErrorCode = null;
    entryNow.updatedAt = new Date().toISOString();
    _upsert(entryNow);
  }
  result.checkedAt = new Date().toISOString();
  _audit(actor, 'SYNC_TESTED', id, 'success', {
    latencyMs: result.latencyMs,
    gistBound: result.gistBound,
    binding: result.binding
  });
  return { test: result };
}

module.exports = {
  VAULT_KEY_ENV,
  MAX_PUSH_BYTES,
  PROVIDER,
  vaultLocked,
  encryptSecret,
  decryptSecret,
  listConfigs,
  listSyncAudit,
  configure,
  disconnect,
  reportLegacy,
  getDeviceInventory,
  setDeviceInventory,
  testConnection,
  tenantStatus,
  tenantPull,
  tenantPush,
  masterPull,
  masterPush,
  // exported for focused unit tests
  _sha256,
  _maskToken
};
