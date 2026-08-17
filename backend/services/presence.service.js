'use strict';

// Presence store — Phase 33 (Master Control Center).
//
// Server-authoritative online/offline tracking. A client sends a heartbeat
// (POST /api/v1/platform/presence/heartbeat) while active; online is defined
// ONLY by recency of the last server-observed heartbeat — never by
// localStorage or any client-declared state.
//
// Store shape (backend/data/presence.json):
//   { entries: [{ userId, username, tenantId, sessionId, branchId, loginAt, lastSeenAt }] }

const storageAdapter = require('../repositories/storageAdapter');

const STORE = 'presence';
const PRUNE_MS = 24 * 60 * 60 * 1000; // drop heartbeats older than 24h

function _load() {
  const data = storageAdapter.read(STORE);
  return (data && Array.isArray(data.entries)) ? data.entries : [];
}

function _save(entries) {
  storageAdapter.write(STORE, { entries });
}

function _key(entry) {
  return String(entry.userId || '') + ':' + String(entry.tenantId || '');
}

function heartbeat({ userId, username, tenantId, sessionId, branchId }) {
  if (!userId) return { error: 'userId is required' };
  const entries = _load();
  const now = new Date().toISOString();
  const key = _key({ userId, tenantId });
  const idx = entries.findIndex(e => _key(e) === key);
  if (idx === -1) {
    entries.push({
      userId: String(userId),
      username: username || null,
      tenantId: tenantId != null ? String(tenantId) : null,
      sessionId: sessionId || null,
      branchId: branchId || null,
      loginAt: now,
      lastSeenAt: now
    });
  } else {
    entries[idx].lastSeenAt = now;
    if (username) entries[idx].username = username;
    if (sessionId) entries[idx].sessionId = sessionId;
    if (branchId) entries[idx].branchId = branchId;
    if (!entries[idx].loginAt) entries[idx].loginAt = now;
  }
  const cutoff = Date.now() - PRUNE_MS;
  const pruned = entries.filter(e => new Date(e.lastSeenAt).getTime() >= cutoff);
  _save(pruned);
  return { ok: true, online: true };
}

function listPresence(onlineTimeoutMs) {
  const entries = _load();
  const timeout = Number(onlineTimeoutMs) > 0 ? Number(onlineTimeoutMs) : 90000;
  const now = Date.now();
  return entries.map(e => {
    const lastSeen = new Date(e.lastSeenAt).getTime();
    return {
      userId: e.userId,
      username: e.username,
      tenantId: e.tenantId,
      sessionId: e.sessionId,
      branchId: e.branchId,
      loginAt: e.loginAt,
      lastSeenAt: e.lastSeenAt,
      online: now - lastSeen <= timeout
    };
  });
}

function countOnline(onlineTimeoutMs) {
  return listPresence(onlineTimeoutMs).filter(e => e.online).length;
}

module.exports = { heartbeat, listPresence, countOnline };
