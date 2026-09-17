'use strict';

// Phase D — recursive audit secret redaction: sensitive values are replaced at
// any depth (objects, arrays, case-insensitive keys), non-sensitive structure
// survives, and the caller's object is never mutated.

const fs = require('fs');
const { makeTempDataDir, readStore } = require('./helpers/testData');

let dataDir;
let auditService;

beforeAll(() => {
  dataDir = makeTempDataDir('audit-secrets');
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  jest.resetModules();
  auditService = require('../services/audit.service');
});

afterAll(() => {
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('Phase D — recursive redaction', () => {
  test('redacts secrets nested arbitrarily deep, case-insensitively', () => {
    const entry = auditService.record({
      method: 'POST',
      path: '/api/v1/test',
      statusCode: 201,
      action: 'create',
      resource: 'test',
      changes: {
        before: null,
        after: {
          profile: { apiKey: 'key-1', apiKeyHash: 'hash-1', settings: { refreshToken: 'rt-1', email: 'x@y.z' } },
          creds: [
            { username: 'u', password: 'p-1' },
            { passwordHash: 'ph-2', mfaBackupCodes: ['c1', 'c2'] }
          ],
          safe: { name: 'n', deep: { label: 'ok', nestedArr: [{ ok: 1, newPassword: 'np' }] } },
          Password: 'case-insensitive',
          fullName: 'Visible Name'
        }
      }
    });

    const store = readStore(dataDir, 'auditLog');
    const stored = store.entries.find((e) => e.id === entry.id);
    expect(stored.changes.after.profile.apiKey).toBe('[REDACTED]');
    expect(stored.changes.after.profile.apiKeyHash).toBe('[REDACTED]');
    expect(stored.changes.after.profile.settings.refreshToken).toBe('[REDACTED]');
    expect(stored.changes.after.profile.settings.email).toBe('x@y.z');
    expect(stored.changes.after.creds[0].password).toBe('[REDACTED]');
    expect(stored.changes.after.creds[1].passwordHash).toBe('[REDACTED]');
    expect(stored.changes.after.creds[1].mfaBackupCodes).toBe('[REDACTED]');
    expect(stored.changes.after.safe.name).toBe('n');
    expect(stored.changes.after.safe.deep.label).toBe('ok');
    expect(stored.changes.after.safe.deep.nestedArr[0].newPassword).toBe('[REDACTED]');
    expect(stored.changes.after.safe.deep.nestedArr[0].ok).toBe(1);
    expect(stored.changes.after.Password).toBe('[REDACTED]');
    expect(stored.changes.after.fullName).toBe('Visible Name');

    // No plaintext secret survives anywhere in the persisted record.
    const raw = JSON.stringify(stored);
    for (const secret of ['key-1', 'hash-1', 'rt-1', 'p-1', 'ph-2', 'c1', 'c2', 'np', 'case-insensitive']) {
      expect(raw).not.toContain(JSON.stringify(secret));
    }
  });

  test('never mutates the caller-provided changes object', () => {
    const changes = {
      before: null,
      after: { password: 'secret', meta: { token: 't' }, arr: [{ password: 'x' }] }
    };
    auditService.record({
      method: 'POST',
      path: '/api/v1/other',
      statusCode: 201,
      action: 'create',
      resource: 'other',
      changes
    });
    expect(changes.after.password).toBe('secret');
    expect(changes.after.meta.token).toBe('t');
    expect(changes.after.arr[0].password).toBe('x');
  });

  test('scalars, null, empty, and top-level arrays pass through untouched', () => {
    const scalar = auditService.record({ method: 'PUT', path: '/p', statusCode: 200, action: 'update', resource: 'r', changes: 'just-a-string' });
    expect(scalar.changes).toBe('just-a-string');

    const none = auditService.record({ method: 'PUT', path: '/p2', statusCode: 200, action: 'update', resource: 'r', changes: null });
    expect(none.changes).toBeNull();

    const arr = auditService.record({ method: 'PUT', path: '/p3', statusCode: 200, action: 'update', resource: 'r', changes: [{ a: 1, currentPassword: 'x' }] });
    expect(arr.changes[0].a).toBe(1);
    expect(arr.changes[0].currentPassword).toBe('[REDACTED]');

    const mixed = auditService.record({
      method: 'PUT', path: '/p4', statusCode: 200, action: 'update', resource: 'r',
      changes: { before: { id: 'k1', keyHash: 'kh' }, after: { id: 'k1', apiKeyHash: 'ah', enabled: true } }
    });
    expect(mixed.changes.before.keyHash).toBe('[REDACTED]');
    expect(mixed.changes.after.apiKeyHash).toBe('[REDACTED]');
    expect(mixed.changes.after.enabled).toBe(true);
  });
});