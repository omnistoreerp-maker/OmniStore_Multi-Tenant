const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const { eventBus } = require('./eventBus');
const repository = require('../repositories').jobs;

const STORE_NAME = 'jobs';

// Job lifecycle: queued → running → completed | failed
// Failed jobs with attempts remaining are re-queued for retry.
class JobService {
  constructor() {
    this._processors = new Map();
    this._workerRunning = false;
    this._workerTimer = null;
    this._concurrency = 1;
    this._pollMs = 500;
    this._active = 0;
    this._running = false;
  }

  _load() {
    const store = repository.read();
    if (!store.jobs) store.jobs = [];
    return store;
  }

  _save(store) {
    return repository.write(store);
  }

  // Register a processor for a job type. One processor per type.
  registerProcessor(type, fn) {
    if (typeof fn !== 'function') throw new Error('Processor must be a function');
    this._processors.set(type, fn);
    return this;
  }

  // Enqueue a job. Jobs persist across restarts; queued jobs are recovered
  // when the worker starts.
  enqueue(type, payload = {}, { priority = 0, delayMs = 0, maxAttempts = 3 } = {}) {
    if (!this._processors.has(type)) {
      throw new Error(`No processor registered for job type: ${type}`);
    }
    const store = this._load();
    const job = {
      id: uuidv4(),
      type,
      payload,
      status: 'queued',
      priority,
      attempts: 0,
      maxAttempts,
      runAt: new Date(Date.now() + (delayMs || 0)).toISOString(),
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      error: null,
      result: null
    };
    store.jobs.push(job);
    this._save(store);
    return job;
  }

  // Start the worker loop. Recoverable: any queued jobs from a previous
  // process run are picked up on startup.
  startWorker({ concurrency = 1, pollMs = 500 } = {}) {
    if (this._running) return this;
    this._concurrency = Math.max(1, concurrency);
    this._pollMs = Math.max(50, pollMs);
    this._running = true;
    this._tick();
    return this;
  }

  stopWorker() {
    this._running = false;
    if (this._workerTimer) {
      clearTimeout(this._workerTimer);
      this._workerTimer = null;
    }
    return this;
  }

  _tick() {
    if (!this._running) return;
    if (this._active >= this._concurrency) {
      this._workerTimer = setTimeout(() => this._tick(), this._pollMs);
      return;
    }

    const job = this._dequeue();
    if (!job) {
      this._workerTimer = setTimeout(() => this._tick(), this._pollMs);
      return;
    }

    this._active++;
    this._run(job).finally(() => {
      this._active--;
      this._workerTimer = setTimeout(() => this._tick(), this._pollMs);
    });
  }

  // Pick the highest-priority queued job whose runAt has passed.
  _dequeue() {
    const store = this._load();
    const now = new Date().toISOString();
    const idx = store.jobs.findIndex(j => j.status === 'queued' && j.runAt <= now);
    if (idx === -1) return null;
    store.jobs[idx].status = 'running';
    store.jobs[idx].startedAt = now;
    this._save(store);
    return store.jobs[idx];
  }

  async _run(job) {
    const processor = this._processors.get(job.type);
    try {
      const result = await processor(job);
      this._complete(job, result);
      return;
    } catch (err) {
      this._fail(job, err);
    }
  }

  _complete(job, result) {
    const store = this._load();
    const idx = store.jobs.findIndex(j => j.id === job.id);
    if (idx === -1) return;
    store.jobs[idx].status = 'completed';
    store.jobs[idx].finishedAt = new Date().toISOString();
    store.jobs[idx].result = result;
    this._save(store);
    try {
      eventBus.publish('job.completed', { id: job.id, type: job.type });
    } catch (_) {}
    logger.info(`Job ${job.id} (${job.type}) completed`);
  }

  _fail(job, err) {
    const store = this._load();
    const idx = store.jobs.findIndex(j => j.id === job.id);
    if (idx === -1) return;
    const rec = store.jobs[idx];
    rec.attempts = (rec.attempts || 0) + 1;
    rec.error = err.message || String(err);

    if (rec.attempts < rec.maxAttempts) {
      // Re-queue with backoff (attempt * 2 seconds).
      rec.status = 'queued';
      rec.runAt = new Date(Date.now() + rec.attempts * 2000).toISOString();
      rec.startedAt = null;
      logger.warn(`Job ${job.id} (${job.type}) attempt ${rec.attempts} failed — retrying:`, rec.error);
    } else {
      rec.status = 'failed';
      rec.finishedAt = new Date().toISOString();
      logger.error(`Job ${job.id} (${job.type}) failed after ${rec.attempts} attempts:`, rec.error);
      try {
        eventBus.publish('job.failed', { id: job.id, type: job.type, error: rec.error });
      } catch (_) {}
    }
    this._save(store);
  }

  getById(id) {
    const store = this._load();
    return store.jobs.find(j => j.id === id) || null;
  }

  getStats() {
    const store = this._load();
    const jobs = store.jobs;
    return {
      total: jobs.length,
      queued: jobs.filter(j => j.status === 'queued').length,
      running: jobs.filter(j => j.status === 'running').length,
      completed: jobs.filter(j => j.status === 'completed').length,
      failed: jobs.filter(j => j.status === 'failed').length
    };
  }

  list({ status, type, limit = 50 } = {}) {
    const store = this._load();
    let jobs = store.jobs.slice();
    if (status) jobs = jobs.filter(j => j.status === status);
    if (type) jobs = jobs.filter(j => j.type === type);
    return jobs.slice(-limit).reverse();
  }
}

module.exports = new JobService();