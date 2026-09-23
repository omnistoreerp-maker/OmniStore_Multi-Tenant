'use strict';

const storageAdapter = require('../repositories/storageAdapter');
const usersService = require('./users.service');
const CompanyService = require('./company.service');
const ordersAggregator = require('./platformOrdersAggregator.service');
const logger = require('../utils/logger');

const STORE = 'platformActivity';
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
const PRUNE_MS = 24 * 60 * 60 * 1000;

// Abuse brakes for the PUBLIC heartbeat endpoint (no auth, rate-limited only):
//   - visitorId must be an anonymous client-generated token of 8–64 chars
//     (alphanumeric, underscore, hyphen). Anything else (PII, emails, headers,
//     gigantic payloads) is rejected — the store never persists it.
//   - The visitor table is hard-capped: once full, NEW visitor ids are
//     rejected until old ones age out of the 24h TTL. An attacker with many
//     IPs cannot grow the store unboundedly.
const VISITOR_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_VISITORS = 10000;

function _load() {
  const data = storageAdapter.read(STORE);
  if (data && Array.isArray(data.visitors)) return data.visitors;
  return [];
}

function _save(visitors) {
  storageAdapter.write(STORE, { visitors });
}

function _prune(visitors) {
  const cutoff = Date.now() - PRUNE_MS;
  return visitors.filter(v => v && new Date(v.lastSeenAt).getTime() >= cutoff);
}

function heartbeat(visitorId) {
  const id = String(visitorId || '').trim();
  if (!id) return { error: 'visitorId is required' };
  if (!VISITOR_ID_PATTERN.test(id)) {
    return { error: 'visitorId must be 8-64 alphanumeric characters (A-Z, a-z, 0-9, _, -)' };
  }

  const visitors = _prune(_load());
  const now = new Date().toISOString();
  const idx = visitors.findIndex(v => String(v.id || '') === id);
  if (idx === -1) {
    if (visitors.length >= MAX_VISITORS) {
      return { error: 'visitor limit reached, try again later' };
    }
    visitors.push({ id, lastSeenAt: now });
  } else {
    visitors[idx].lastSeenAt = now;
  }
  _save(visitors);
  return { ok: true };
}

function getStats() {
  const visitors = _prune(_load());
  const now = Date.now();
  const activeCutoff = now - ACTIVE_WINDOW_MS;
  const visitorsNow = visitors.filter(v => new Date(v.lastSeenAt).getTime() >= activeCutoff).length;

  let registeredUsers = 0;
  try {
    const users = usersService.list().users || [];
    registeredUsers = users.length;
  } catch (err) {
    logger.warn('platformActivity.service: failed to count users', err.message);
  }

  let activeBusinesses = 0;
  try {
    activeBusinesses = CompanyService.getActiveCompanies().length;
  } catch (err) {
    logger.warn('platformActivity.service: failed to count companies', err.message);
  }

  let ordersToday = null;
  try {
    ordersToday = ordersAggregator.getOrdersToday();
  } catch (err) {
    logger.warn('platformActivity.service: failed to count orders today', err.message);
  }

  return {
    visitorsNow,
    registeredUsers,
    activeBusinesses,
    ordersToday
  };
}

module.exports = {
  heartbeat,
  getStats,
  MAX_VISITORS
};
