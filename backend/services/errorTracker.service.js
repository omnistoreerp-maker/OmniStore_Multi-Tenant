const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const repository = require('../repositories').errors;

// Error issue lifecycle: open → acknowledged → resolved
const STATUSES = ['open', 'acknowledged', 'resolved'];
const LEVELS = ['error', 'warning', 'critical'];

// Fingerprint an error so the same root cause deduplicates into one issue.
// Stack is NORMALIZED: line/column numbers are stripped so the same error
// raised from different locations fingerprints identically.
function fingerprint(err, context = {}) {
  const stack = (err && err.stack) || '';
  const message = (err && err.message) || String(err);
  const normalizedStack = stack
    .split('\n')
    .map(line => line.replace(/:\d+:\d+/g, ':'))
    .slice(0, 3)
    .join('\n');
  const input = `${message}|${normalizedStack}|${context.code || ''}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}

// Capture an error. Deduplicates by fingerprint: an open issue with the
// same fingerprint has its occurrence count incremented instead of
// creating a new record.
function capture(err, context = {}) {
  if (!err) return null;
  const store = repository.read();
  if (!store.issues) store.issues = [];

  const fp = fingerprint(err, context);
  const existing = store.issues.find(i => i.fingerprint === fp && i.status !== 'resolved');
  const now = new Date().toISOString();

  if (existing) {
    existing.occurrences += 1;
    existing.lastSeen = now;
    existing.lastError = (err && err.message) || String(err);
    repository.write(store);
    return existing;
  }

  const issue = {
    id: uuidv4(),
    fingerprint: fp,
    message: (err && err.message) || String(err),
    stack: (err && err.stack) || null,
    level: context.level || 'error',
    code: context.code || null,
    route: context.route || null,
    method: context.method || null,
    userId: context.userId || null,
    occurrences: 1,
    status: 'open',
    firstSeen: now,
    lastSeen: now,
    lastError: (err && err.message) || String(err)
  };
  store.issues.push(issue);
  repository.write(store);
  logger.warn(`Error captured: ${issue.message} (${issue.id})`);
  return issue;
}

function list({ status, level, limit = 50 } = {}) {
  const store = repository.read();
  let issues = (store.issues || []).slice();
  if (status) issues = issues.filter(i => i.status === status);
  if (level) issues = issues.filter(i => i.level === level);
  return issues.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen)).slice(0, limit);
}

function getById(id) {
  const store = repository.read();
  return (store.issues || []).find(i => i.id === id) || null;
}

// Transition issue status (open → acknowledged → resolved).
// Resolution requires a resolved status; acknowledgements and reopen are
// supported for operational workflow.
function setStatus(id, status) {
  if (!STATUSES.includes(status)) return { error: `Invalid status: ${status}` };
  const store = repository.read();
  const issue = (store.issues || []).find(i => i.id === id);
  if (!issue) return null;
  issue.status = status;
  issue.updatedAt = new Date().toISOString();
  repository.write(store);
  return issue;
}

function getStats() {
  const store = repository.read();
  const issues = store.issues || [];
  const byStatus = {};
  for (const i of issues) byStatus[i.status] = (byStatus[i.status] || 0) + 1;
  return {
    total: issues.length,
    open: issues.filter(i => i.status === 'open').length,
    acknowledged: issues.filter(i => i.status === 'acknowledged').length,
    resolved: issues.filter(i => i.status === 'resolved').length,
    byStatus
  };
}

module.exports = {
  capture,
  list,
  getById,
  setStatus,
  getStats,
  fingerprint,
  STATUSES,
  LEVELS
};