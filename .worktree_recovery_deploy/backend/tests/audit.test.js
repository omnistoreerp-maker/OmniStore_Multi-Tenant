// Audit service unit tests: record, query, stats, sanitization.
const { makeTempDataDir } = require('./helpers/testData');
const { seed, readStore } = require('./helpers/testData');

let dataDir;
let auditService;

beforeAll(() => {
  dataDir = makeTempDataDir('audit-unit');
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  jest.resetModules();
  auditService = require('../services/audit.service');
});

afterAll(() => {
  const fs = require('fs');
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('audit.service', () => {
  test('record creates an audit entry with required fields', () => {
    const entry = auditService.record({
      method: 'POST',
      path: '/api/v1/sales',
      statusCode: 201,
      userId: 'user-123',
      action: 'create',
      resource: 'sales'
    });

    expect(entry).toHaveProperty('id');
    expect(entry).toHaveProperty('requestId');
    expect(entry).toHaveProperty('timestamp');
    expect(entry.method).toBe('POST');
    expect(entry.path).toBe('/api/v1/sales');
    expect(entry.statusCode).toBe(201);
    expect(entry.userId).toBe('user-123');
    expect(entry.action).toBe('create');
    expect(entry.resource).toBe('sales');
  });

  test('record stores entry in fileStore', () => {
    const entry = auditService.record({
      method: 'PUT',
      path: '/api/v1/sales/abc',
      statusCode: 200,
      action: 'update',
      resource: 'sales'
    });

    const store = readStore(dataDir, 'auditLog');
    expect(store).toBeTruthy();
    expect(store.entries).toBeDefined();
    expect(store.entries.length).toBeGreaterThanOrEqual(1);
  });

  test('record sanitizes passwords from changes.after', () => {
    const entry = auditService.record({
      method: 'POST',
      path: '/api/v1/users',
      statusCode: 201,
      action: 'create',
      resource: 'users',
      changes: {
        before: null,
        after: { username: 'test', password: 'secret123', fullName: 'Test User' }
      }
    });

    const store = readStore(dataDir, 'auditLog');
    const stored = store.entries.find(e => e.id === entry.id);
    expect(stored.changes.after.password).toBe('[REDACTED]');
    expect(stored.changes.after.fullName).toBe('Test User');
  });

  test('record sanitizes tokens from changes.before', () => {
    const entry = auditService.record({
      method: 'DELETE',
      path: '/api/v1/api-keys/key1',
      statusCode: 200,
      action: 'delete',
      resource: 'api-keys',
      changes: {
        before: { id: 'key1', accessToken: 'token-abc', keyHash: 'hash123' },
        after: null
      }
    });

    const store = readStore(dataDir, 'auditLog');
    const stored = store.entries.find(e => e.id === entry.id);
    expect(stored.changes.before.accessToken).toBe('[REDACTED]');
    expect(stored.changes.before.keyHash).toBe('[REDACTED]');
  });

  test('query returns paginated results', () => {
    // Add some entries
    for (let i = 0; i < 5; i++) {
      auditService.record({
        method: 'POST',
        path: '/api/v1/test',
        statusCode: 201,
        action: 'create',
        resource: 'test'
      });
    }

    const result = auditService.query({ page: 1, limit: 3 });
    expect(result.entries).toBeDefined();
    expect(result.entries.length).toBeLessThanOrEqual(3);
    expect(result.pagination).toHaveProperty('total');
    expect(result.pagination).toHaveProperty('page');
    expect(result.pagination).toHaveProperty('limit');
    expect(result.pagination).toHaveProperty('totalPages');
  });

  test('query filters by resource', () => {
    auditService.record({
      method: 'POST',
      path: '/api/v1/inventory',
      statusCode: 201,
      action: 'create',
      resource: 'inventory'
    });

    const result = auditService.query({ resource: 'inventory' });
    expect(result.entries.every(e => e.resource === 'inventory')).toBe(true);
  });

  test('query filters by method', () => {
    auditService.record({
      method: 'DELETE',
      path: '/api/v1/temp',
      statusCode: 200,
      action: 'delete',
      resource: 'temp'
    });

    const result = auditService.query({ method: 'DELETE' });
    expect(result.entries.every(e => e.method === 'DELETE')).toBe(true);
  });

  test('query filters by userId', () => {
    auditService.record({
      method: 'POST',
      path: '/api/v1/sales',
      statusCode: 201,
      userId: 'user-999',
      action: 'create',
      resource: 'sales'
    });

    const result = auditService.query({ userId: 'user-999' });
    expect(result.entries.every(e => e.userId === 'user-999')).toBe(true);
  });

  test('query filters by date range', () => {
    const result = auditService.query({
      startDate: new Date(Date.now() - 60000).toISOString(),
      endDate: new Date().toISOString()
    });
    expect(result.entries).toBeDefined();
    expect(Array.isArray(result.entries)).toBe(true);
  });

  test('getStats returns correct structure', () => {
    const stats = auditService.getStats();
    expect(stats).toHaveProperty('total');
    expect(stats).toHaveProperty('lastHour');
    expect(stats).toHaveProperty('lastDay');
    expect(stats).toHaveProperty('byMethod');
    expect(stats).toHaveProperty('byResource');
    expect(typeof stats.total).toBe('number');
    expect(typeof stats.lastHour).toBe('number');
    expect(typeof stats.lastDay).toBe('number');
  });

  test('getById returns a specific entry', () => {
    const entry = auditService.record({
      method: 'POST',
      path: '/api/v1/specific',
      statusCode: 201,
      action: 'create',
      resource: 'specific'
    });

    const found = auditService.getById(entry.id);
    expect(found).toBeTruthy();
    expect(found.id).toBe(entry.id);
  });

  test('getById returns null for nonexistent ID', () => {
    const found = auditService.getById('nonexistent-id');
    expect(found).toBeNull();
  });
});
