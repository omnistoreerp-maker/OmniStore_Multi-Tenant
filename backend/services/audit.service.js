const { v4: uuidv4 } = require('uuid');
const repository = require('../repositories').auditLog;

function _store() {
  return repository.read();
}

function _save(data) {
  return repository.write(data);
}

// FULL, unfiltered store document for WRITES. Persisting must never be
// derived from the tenant-filtered view (BaseRepository._rawStore rule):
// otherwise one tenant's record() would write back only its own entries
// and silently DROP every other tenant's audit entries from the shared
// document.
function _storeRaw() {
  const db = repository._rawStore();
  if (!db || typeof db !== 'object') return { entries: [] };
  if (!Array.isArray(db.entries)) db.entries = [];
  return db;
}

// Record an audit event. Called by the audit middleware after response finishes.
function record(entry) {
  const store = _storeRaw();
  if (!store.entries) store.entries = [];

  const record = {
    id: uuidv4(),
    requestId: entry.requestId || null,
    timestamp: new Date().toISOString(),
    method: entry.method,
    path: entry.path,
    statusCode: entry.statusCode || null,
    userId: entry.userId || null,
    apiKeyId: entry.apiKeyId || null,
    ip: entry.ip || null,
    userAgent: entry.userAgent || null,
    action: entry.action || 'unknown',
    resource: entry.resource || null,
    resourceId: entry.resourceId || null,
    duration: entry.duration || null,
    changes: entry.changes || null
  };

  // Sanitize: never store passwords, secrets, tokens, or sensitive credentials.
  // Cloned so the caller's `changes` object is never mutated.
  record.changes = _sanitizeValue(entry.changes);

  store.entries.push(record);
  _save(store);
  return record;
}

// Every key that must never reach the audit trail, matched case-insensitively.
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'currentpassword',
  'newpassword',
  'secret',
  'mfasecret',
  'mfabackupcodes',
  'backupcodes',
  'tokens',
  'token',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'apikeyhash',
  'keyhash',
  'otp',
  'otpsecret',
  'totp',
  'totpsecret',
  'verificationcode',
  'clientsecret'
]);

function _isSensitiveKey(key) {
  return SENSITIVE_KEYS.has(String(key).toLowerCase());
}

// Recursive clone-and-redact: any sensitive property value becomes
// '[REDACTED]' at any depth, arrays are recursed element-wise, and non-sensitive
// structure is preserved. The ORIGINAL input is never mutated.
function _sanitizeValue(value) {
  if (Array.isArray(value)) {
    return value.map(item => _sanitizeValue(item));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      if (_isSensitiveKey(key)) out[key] = '[REDACTED]';
      else out[key] = _sanitizeValue(v);
    }
    return out;
  }
  return value;
}

// Query audit log with filtering and pagination.
function query({ userId, apiKeyId, resource, method, startDate, endDate, page, limit } = {}) {
  const store = _store();
  let entries = store.entries || [];

  // Apply filters
  if (userId) entries = entries.filter(e => e.userId === userId);
  if (apiKeyId) entries = entries.filter(e => e.apiKeyId === apiKeyId);
  if (resource) entries = entries.filter(e => e.resource === resource);
  if (method) entries = entries.filter(e => e.method === method.toUpperCase());
  if (startDate) {
    const start = new Date(startDate);
    entries = entries.filter(e => new Date(e.timestamp) >= start);
  }
  if (endDate) {
    const end = new Date(endDate);
    entries = entries.filter(e => new Date(e.timestamp) <= end);
  }

  // Sort by timestamp descending (newest first)
  entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  // Pagination
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const total = entries.length;
  const totalPages = Math.ceil(total / limitNum);
  const startIdx = (pageNum - 1) * limitNum;
  const paged = entries.slice(startIdx, startIdx + limitNum);

  return {
    entries: paged,
    pagination: { total, page: pageNum, limit: limitNum, totalPages }
  };
}

// Get audit statistics.
function getStats() {
  const store = _store();
  const entries = store.entries || [];
  const now = new Date();
  const oneHourAgo = new Date(now - 60 * 60 * 1000);
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);

  const byMethod = {};
  const byResource = {};
  let lastHour = 0;
  let lastDay = 0;

  for (const e of entries) {
    byMethod[e.method] = (byMethod[e.method] || 0) + 1;
    if (e.resource) byResource[e.resource] = (byResource[e.resource] || 0) + 1;
    const ts = new Date(e.timestamp);
    if (ts >= oneHourAgo) lastHour++;
    if (ts >= oneDayAgo) lastDay++;
  }

  return {
    total: entries.length,
    lastHour,
    lastDay,
    byMethod,
    byResource
  };
}

// Get a single audit entry by ID.
function getById(id) {
  const store = _store();
  const entries = store.entries || [];
  return entries.find(e => e.id === id) || null;
}

module.exports = { record, query, getStats, getById };
