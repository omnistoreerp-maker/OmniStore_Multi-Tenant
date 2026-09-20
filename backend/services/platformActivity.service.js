'use strict';

const storageAdapter = require('../repositories/storageAdapter');
const usersService = require('./users.service');
const CompanyService = require('./company.service');
const logger = require('../utils/logger');

const STORE = 'platformActivity';
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
const PRUNE_MS = 24 * 60 * 60 * 1000;

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

  const visitors = _prune(_load());
  const now = new Date().toISOString();
  const idx = visitors.findIndex(v => String(v.id || '') === id);
  if (idx === -1) {
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

  return {
    visitorsNow,
    registeredUsers,
    activeBusinesses,
    ordersToday: null
  };
}

module.exports = {
  heartbeat,
  getStats
};
