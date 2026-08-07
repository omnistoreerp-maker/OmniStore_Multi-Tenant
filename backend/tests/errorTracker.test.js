// Error tracker unit tests: fingerprinting, dedup, status workflow.
const { makeTempDataDir, readStore } = require('./helpers/testData');

let dataDir;

beforeAll(() => {
  dataDir = makeTempDataDir('errortracker-unit');
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  jest.resetModules();
});

afterAll(() => {
  const fs = require('fs');
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  const fileStore = require('../utils/fileStore');
  fileStore.write('errors', { issues: [] });
});

function freshTracker() {
  jest.resetModules();
  return require('../services/errorTracker.service');
}

describe('errorTracker.service', () => {
  test('fingerprint is deterministic for same error', () => {
    const tracker = freshTracker();
    const err1 = new Error('db connection failed');
    const err2 = new Error('db connection failed');
    expect(tracker.fingerprint(err1)).toBe(tracker.fingerprint(err2));
  });

  test('capture creates an issue', () => {
    const tracker = freshTracker();
    const issue = tracker.capture(new Error('boom'));
    expect(issue.id).toBeTruthy();
    expect(issue.status).toBe('open');
    expect(issue.occurrences).toBe(1);
    expect(issue.message).toBe('boom');
    const store = readStore(dataDir, 'errors');
    expect(store.issues.length).toBe(1);
  });

  test('capture deduplicates identical errors', () => {
    const tracker = freshTracker();
    tracker.capture(new Error('same error'));
    const second = tracker.capture(new Error('same error'));
    const store = readStore(dataDir, 'errors');
    expect(store.issues.length).toBe(1);
    expect(second.occurrences).toBe(2);
  });

  test('different errors create different issues', () => {
    const tracker = freshTracker();
    tracker.capture(new Error('error one'));
    tracker.capture(new Error('error two'));
    const store = readStore(dataDir, 'errors');
    expect(store.issues.length).toBe(2);
  });

  test('capture handles null error', () => {
    const tracker = freshTracker();
    expect(tracker.capture(null)).toBeNull();
  });

  test('setStatus transitions workflow', () => {
    const tracker = freshTracker();
    const issue = tracker.capture(new Error('workflow'));
    const acked = tracker.setStatus(issue.id, 'acknowledged');
    expect(acked.status).toBe('acknowledged');
    const resolved = tracker.setStatus(issue.id, 'resolved');
    expect(resolved.status).toBe('resolved');
  });

  test('setStatus rejects invalid status', () => {
    const tracker = freshTracker();
    const issue = tracker.capture(new Error('x'));
    const result = tracker.setStatus(issue.id, 'bogus');
    expect(result.error).toBeTruthy();
  });

  test('setStatus returns null for missing', () => {
    const tracker = freshTracker();
    expect(tracker.setStatus('missing', 'resolved')).toBeNull();
  });

  test('getById returns a specific issue', () => {
    const tracker = freshTracker();
    const issue = tracker.capture(new Error('find me'));
    expect(tracker.getById(issue.id).message).toBe('find me');
  });

  test('getStats reports counts', () => {
    const tracker = freshTracker();
    tracker.capture(new Error('stat1'));
    const stats = tracker.getStats();
    expect(stats.total).toBe(1);
    expect(stats.open).toBe(1);
    expect(stats.resolved).toBe(0);
  });

  test('list filters by status', () => {
    const tracker = freshTracker();
    const issue = tracker.capture(new Error('listme'));
    tracker.setStatus(issue.id, 'resolved');
    const open = tracker.list({ status: 'open' });
    const resolved = tracker.list({ status: 'resolved' });
    expect(open.length).toBe(0);
    expect(resolved.length).toBe(1);
  });
});