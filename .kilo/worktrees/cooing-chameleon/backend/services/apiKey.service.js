const { randomBytes, createHash, timingSafeEqual } = require('crypto');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const repository = require('../repositories').apiKeys;

const KEY_PREFIX = 'dgv2_live_';
const KEY_BYTES = 32; // 256 bits

function _hashKey(rawKey) {
  return createHash('sha256').update(rawKey).digest('hex');
}

function _timingSafeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return timingSafeEqual(bufA, bufB);
}

function _store() {
  return repository.read();
}

function _save(data) {
  return repository.write(data);
}

// Generate a new API key. Returns { id, key, keyHash, ... }.
// The raw key is returned ONCE — only the hash is stored.
function generateKey({ name, userId, scopes, rateLimitMax, expiresAt }) {
  const rawKey = KEY_PREFIX + randomBytes(KEY_BYTES).toString('hex');
  const keyHash = _hashKey(rawKey);

  const record = {
    id: uuidv4(),
    keyHash,
    name: name || 'Unnamed Key',
    userId: userId || null,
    scopes: scopes || ['read'],
    rateLimitMax: rateLimitMax || config.apiKeyRateLimitMax,
    enabled: true,
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt || null,
    lastUsedAt: null,
    revokedAt: null
  };

  const store = _store();
  if (!store.keys) store.keys = [];
  store.keys.push(record);
  _save(store);

  // Return the raw key alongside the record — this is the ONLY time
  // the raw key is available.
  return { ...record, key: rawKey, keyHash: undefined };
}

// Validate a raw API key. Returns the stored record or null.
function validateKey(rawKey) {
  if (!rawKey || !rawKey.startsWith(KEY_PREFIX)) return null;

  const providedHash = _hashKey(rawKey);
  const store = _store();
  const keys = store.keys || [];

  for (const record of keys) {
    if (record.revokedAt) continue;
    if (record.enabled === false) continue;
    if (record.expiresAt && new Date(record.expiresAt) < new Date()) continue;
    if (_timingSafeCompare(record.keyHash, providedHash)) {
      return record;
    }
  }
  return null;
}

// Touch lastUsedAt (fire-and-forget).
function touchKey(id) {
  const store = _store();
  const keys = store.keys || [];
  const record = keys.find(k => k.id === id);
  if (record) {
    record.lastUsedAt = new Date().toISOString();
    _save(store);
  }
}

// List all keys (hashed, no raw keys).
function listKeys({ userId, enabled } = {}) {
  const store = _store();
  let keys = store.keys || [];
  if (userId) keys = keys.filter(k => k.userId === userId);
  if (enabled !== undefined) keys = keys.filter(k => k.enabled === enabled);
  return keys.map(k => ({ ...k, keyHash: undefined }));
}

// Get a single key by ID (hashed).
function getKey(id) {
  const store = _store();
  const keys = store.keys || [];
  const record = keys.find(k => k.id === id);
  if (!record) return null;
  return { ...record, keyHash: undefined };
}

// Revoke a key.
function revokeKey(id) {
  const store = _store();
  const keys = store.keys || [];
  const record = keys.find(k => k.id === id);
  if (!record) return null;
  record.revokedAt = new Date().toISOString();
  record.enabled = false;
  _save(store);
  return { ...record, keyHash: undefined };
}

// Delete a key permanently.
function deleteKey(id) {
  const store = _store();
  const keys = store.keys || [];
  const idx = keys.findIndex(k => k.id === id);
  if (idx === -1) return null;
  const [removed] = keys.splice(idx, 1);
  _save(store);
  return { ...removed, keyHash: undefined };
}

// Enable/disable a key.
function setKeyEnabled(id, enabled) {
  const store = _store();
  const keys = store.keys || [];
  const record = keys.find(k => k.id === id);
  if (!record) return null;
  record.enabled = !!enabled;
  _save(store);
  return { ...record, keyHash: undefined };
}

// Get key statistics.
function getKeyStats() {
  const store = _store();
  const keys = store.keys || [];
  return {
    total: keys.length,
    enabled: keys.filter(k => k.enabled).length,
    revoked: keys.filter(k => k.revokedAt).length,
    expired: keys.filter(k => k.expiresAt && new Date(k.expiresAt) < new Date()).length
  };
}

module.exports = {
  generateKey,
  validateKey,
  touchKey,
  listKeys,
  getKey,
  revokeKey,
  deleteKey,
  setKeyEnabled,
  getKeyStats,
  KEY_PREFIX,
  _hashKey,
  _timingSafeCompare
};
