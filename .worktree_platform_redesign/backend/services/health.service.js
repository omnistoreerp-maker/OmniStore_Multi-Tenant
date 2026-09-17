const fs = require('fs');
const logger = require('../utils/logger');
const metrics = require('./metrics.service');
const { eventBus } = require('./eventBus');
const jobService = require('./job.service');
const repositories = require('../repositories');

// Deep health checks: component-level diagnostics used by /health/deep.
// Each check is O(1) and never throws — it returns a status object.
function checkPersistence() {
  try {
    repositories.ensureDataDir();
    const probe = repositories.resolvePath('.health-probe');
    fs.writeFileSync(probe, 'ok', 'utf-8');
    fs.unlinkSync(probe);
    return { status: 'ok' };
  } catch (err) {
    logger.warn('health:persistence check failed:', err.message);
    return { status: 'error', detail: err.message };
  }
}

function checkAudit() {
  try {
    const store = repositories.auditLog.read();
    const count = Array.isArray(store.entries) ? store.entries.length : 0;
    return { status: 'ok', entries: count };
  } catch (err) {
    return { status: 'error', detail: err.message };
  }
}

function checkMetrics() {
  try {
    const snapshot = metrics.getMetrics();
    return { status: 'ok', counters: Object.keys(snapshot.counters).length };
  } catch (err) {
    return { status: 'error', detail: err.message };
  }
}

function checkEventBus() {
  try {
    const history = eventBus.getHistory(1);
    return { status: 'ok', history: eventBus.getHistory().length, alive: true };
  } catch (err) {
    return { status: 'error', detail: err.message };
  }
}

function checkJobs() {
  try {
    const stats = jobService.getStats();
    return { status: 'ok', ...stats };
  } catch (err) {
    return { status: 'error', detail: err.message };
  }
}

function checkWebhooks() {
  try {
    const store = repositories.webhooks.read();
    const count = Array.isArray(store.entries) ? store.entries.length : 0;
    return { status: 'ok', webhooks: count };
  } catch (err) {
    return { status: 'error', detail: err.message };
  }
}

const CHECKS = {
  persistence: checkPersistence,
  audit: checkAudit,
  metrics: checkMetrics,
  eventbus: checkEventBus,
  jobs: checkJobs,
  webhooks: checkWebhooks
};

function runAll() {
  const checks = {};
  for (const [name, fn] of Object.entries(CHECKS)) {
    checks[name] = fn();
  }
  const status = Object.values(checks).some(c => c.status === 'error') ? 'degraded' : 'ok';
  return { status, checks, timestamp: new Date().toISOString() };
}

function runOne(name) {
  const fn = CHECKS[name];
  if (!fn) return null;
  return { [name]: fn(), timestamp: new Date().toISOString() };
}

module.exports = { runAll, runOne, CHECKS };