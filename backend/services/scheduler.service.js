const logger = require('../utils/logger');

// In-process recurring task scheduler. Compatible with the single-instance
// PM2 deployment: timers live in the one process that also serves requests.
// On restart, task definitions are re-registered by server.js, so scheduled
// work recovers naturally (at-least-once semantics, consistent with the
// persisted job queue).
class SchedulerService {
  constructor() {
    this._tasks = new Map(); // name -> { spec, handler, timer, nextRunAt, lastRunAt, lastStatus, runs }
    this._running = false;
  }

  // Parse an interval spec into milliseconds.
  // Accepts: ms number, or '5m', '2h', '1d', '@hourly', '@daily', '@weekly'.
  _parseSpec(spec) {
    if (typeof spec === 'number') return spec;
    const str = String(spec).trim().toLowerCase();
    const units = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
    const map = {
      '@hourly': 3600000,
      '@daily': 86400000,
      '@weekly': 7 * 86400000
    };
    if (map[str]) return map[str];
    const m = str.match(/^(\d+)\s*(ms|s|m|h|d)$/);
    if (!m) throw new Error(`Invalid schedule spec: ${spec}`);
    return parseInt(m[1], 10) * units[m[2]];
  }

  register(name, spec, handler) {
    if (!name || typeof handler !== 'function') throw new Error('Scheduler requires a name and handler function');
    const interval = this._parseSpec(spec);
    this._tasks.set(name, { name, spec, interval, handler, timer: null, nextRunAt: null, lastRunAt: null, lastStatus: null, runs: 0 });
    if (this._running) this._schedule(this._tasks.get(name));
    return this;
  }

  unregister(name) {
    const task = this._tasks.get(name);
    if (!task) return false;
    if (task.timer) clearTimeout(task.timer);
    this._tasks.delete(name);
    return true;
  }

  _schedule(task) {
    if (task.timer) clearTimeout(task.timer);
    task.nextRunAt = new Date(Date.now() + task.interval).toISOString();
    task.timer = setTimeout(() => this._run(task), task.interval);
    if (task.timer.unref) task.timer.unref(); // never block process exit on a pending task
  }

  async _run(task) {
    task.runs++;
    task.lastRunAt = new Date().toISOString();
    task.lastStatus = 'running';
    try {
      await task.handler(task);
      task.lastStatus = 'completed';
    } catch (err) {
      task.lastStatus = 'failed';
      logger.error(`Scheduled task '${task.name}' failed:`, err.message);
    } finally {
      if (this._running) this._schedule(task);
    }
  }

  // Start all registered tasks. Idempotent.
  start() {
    if (this._running) return this;
    this._running = true;
    for (const task of this._tasks.values()) {
      this._schedule(task);
    }
    return this;
  }

  // Stop all timers. Called from graceful shutdown before process exit.
  stop() {
    this._running = false;
    for (const task of this._tasks.values()) {
      if (task.timer) {
        clearTimeout(task.timer);
        task.timer = null;
      }
    }
    return this;
  }

  listTasks() {
    const out = [];
    for (const task of this._tasks.values()) {
      out.push({
        name: task.name,
        spec: task.spec,
        nextRunAt: task.nextRunAt,
        lastRunAt: task.lastRunAt,
        lastStatus: task.lastStatus,
        runs: task.runs
      });
    }
    return out;
  }
}

module.exports = new SchedulerService();
module.exports.SchedulerService = SchedulerService;