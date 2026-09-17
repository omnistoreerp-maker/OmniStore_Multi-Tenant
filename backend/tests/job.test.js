// Job service unit tests: enqueue, lifecycle, retry, persistence.
const { makeTempDataDir, readStore } = require('./helpers/testData');
const { JobService } = require('../services/job.service');

let dataDir;

beforeAll(() => {
  dataDir = makeTempDataDir('job-unit');
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  jest.resetModules();
});

afterAll(() => {
  const fs = require('fs');
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  const fileStore = require('../utils/fileStore');
  fileStore.write('jobs', { jobs: [] });
});

function freshService() {
  jest.resetModules();
  return require('../services/job.service');
}

describe('job.service', () => {
  test('enqueue requires a registered processor', () => {
    const svc = freshService();
    expect(() => svc.enqueue('unknown', {})).toThrow(/No processor registered/);
  });

  test('enqueue creates a queued, persisted job', () => {
    const svc = freshService();
    svc.registerProcessor('email.send', async () => 'ok');
    const job = svc.enqueue('email.send', { to: 'a@b.com' });
    expect(job.id).toBeTruthy();
    expect(job.status).toBe('queued');
    expect(job.type).toBe('email.send');
    expect(job.payload).toEqual({ to: 'a@b.com' });
    const store = readStore(dataDir, 'jobs');
    expect(store.jobs.length).toBe(1);
  });

  test('registerProcessor rejects non-functions', () => {
    const svc = freshService();
    expect(() => svc.registerProcessor('x', 'not-fn')).toThrow(/must be a function/);
  });

  test('worker completes a job', async () => {
    const svc = freshService();
    const ran = [];
    svc.registerProcessor('report.generate', async (job) => { ran.push(job.id); return 'report'; });
    const job = svc.enqueue('report.generate', { id: 1 });
    svc.startWorker({ pollMs: 50 });
    await new Promise(r => setTimeout(r, 150));
    svc.stopWorker();

    const done = svc.getById(job.id);
    expect(done.status).toBe('completed');
    expect(done.result).toBe('report');
    expect(ran).toHaveLength(1);
  });

  test('worker retries failed jobs then marks failed', async () => {
    const svc = freshService();
    let calls = 0;
    svc.registerProcessor('sync.push', async () => { calls++; throw new Error('boom'); });
    const job = svc.enqueue('sync.push', {}, { maxAttempts: 2 });
    svc.startWorker({ pollMs: 50 });
    // First attempt immediate; retry backoff 2s — wait 3s.
    await new Promise(r => setTimeout(r, 3200));
    svc.stopWorker();

    const done = svc.getById(job.id);
    expect(done.status).toBe('failed');
    expect(done.attempts).toBe(2);
    expect(calls).toBe(2);
    expect(done.error).toBe('boom');
  });

  test('getStats reports queue state', () => {
    const svc = freshService();
    svc.registerProcessor('a', async () => {});
    svc.registerProcessor('b', async () => {});
    svc.enqueue('a', {});
    svc.enqueue('b', {});
    const stats = svc.getStats();
    expect(stats.queued).toBe(2);
    expect(stats.total).toBe(2);
    expect(stats.completed).toBe(0);
  });

  test('list filters by status', () => {
    const svc = freshService();
    svc.registerProcessor('c', async () => {});
    svc.enqueue('c', {});
    const queued = svc.list({ status: 'queued' });
    expect(queued.length).toBe(1);
    expect(queued[0].status).toBe('queued');
  });

  test('getById returns null for missing', () => {
    const svc = freshService();
    expect(svc.getById('nope')).toBeNull();
  });

  test('delayed jobs are not picked up until runAt passes', async () => {
    const svc = freshService();
    const ran = [];
    svc.registerProcessor('delay.test', async (job) => { ran.push(job.id); return true; });
    const job = svc.enqueue('delay.test', {}, { delayMs: 5000 });
    svc.startWorker({ pollMs: 50 });
    await new Promise(r => setTimeout(r, 200));
    const early = svc.getById(job.id);
    expect(early.status).toBe('queued');
    expect(ran).toHaveLength(0);
    svc.stopWorker();
  });
});