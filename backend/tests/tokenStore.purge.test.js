'use strict';

// F5 — expired-record housekeeping for the durable token store.
//
// Covers the bounded purge, the per-database throttle, failure safety, and the
// production wiring (login triggers housekeeping) without ever deleting active
// credentials, session families or replay audit records.

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { createUser, login } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  dataDir = makeTempDataDir('token-purge');
  const started = await startServer(dataDir);
  server = started.app;
  await createUser(server, { username: 'purge1', password: 'PurgePass#123', role: 'Admin' });
});

afterAll(() => {
  try { require('../utils/tokenStore.sqlite').closeDb(); } catch (_) {}
});

function seed(db, now) {
  const hour = 60 * 60 * 1000;
  db.prepare(`INSERT INTO session_families (familyId, sub, tenantId, createdAt) VALUES (?, ?, ?, ?)`)
    .run('fam-active', 'purge1', null, now - hour);
  db.prepare(`INSERT INTO session_families (familyId, sub, tenantId, createdAt) VALUES (?, ?, ?, ?)`)
    .run('fam-revoked', 'purge1', null, now - hour);
  db.prepare(`UPDATE session_families SET revokedAt = ?, revocationReason = 'logout' WHERE familyId = ?`)
    .run(now - hour, 'fam-revoked');

  const insertToken = db.prepare(`
    INSERT INTO refresh_tokens (jti, familyId, sub, ver, tenantId, issuedAt, expiresAt, status)
    VALUES (?, ?, 'purge1', 0, NULL, ?, ?, ?)
  `);
  insertToken.run('rt-active', 'fam-active', now - hour, now + hour, 'active');
  insertToken.run('rt-expired-active', 'fam-active', now - 2 * hour, now - hour, 'active');
  insertToken.run('rt-expired-consumed', 'fam-active', now - 2 * hour, now - hour, 'consumed');
  insertToken.run('rt-expired-revoked', 'fam-revoked', now - 2 * hour, now - hour, 'revoked');

  const insertDenied = db.prepare(`INSERT INTO access_token_denylist (jti, expiresAt, revokedAt) VALUES (?, ?, ?)`);
  insertDenied.run('deny-expired', now - hour, now - 2 * hour);
  insertDenied.run('deny-active', now + hour, now - hour);

  const insertLegacy = db.prepare(`INSERT INTO legacy_revocations (hash, expiresAt, migratedAt) VALUES (?, ?, ?)`);
  insertLegacy.run('a'.repeat(64), now - hour, now - 2 * hour);
  insertLegacy.run('b'.repeat(64), null, now - 2 * hour);

  db.prepare(`INSERT INTO replay_audit (familyId, sub, replayedJti, timestamp) VALUES (?, ?, ?, ?)`)
    .run('fam-revoked', 'purge1', 'rt-replayed', now - hour);
}

describe('token store purge (unit)', () => {
  test('removes only expired rows and never active credentials, families or audit records', () => {
    const tokenStore = require('../utils/tokenStore.sqlite');
    const db = tokenStore.openDbInMemory();
    const now = Date.now();
    seed(db, now);

    const removed = tokenStore.purgeExpired(db, { now, limit: 100 });
    expect(removed).toEqual({ access: 1, refresh: 3, legacy: 1 });

    const remainingTokens = db.prepare(`SELECT jti FROM refresh_tokens ORDER BY jti`).all().map(r => r.jti);
    expect(remainingTokens).toEqual(['rt-active']);
    const remainingDenied = db.prepare(`SELECT jti FROM access_token_denylist`).all().map(r => r.jti);
    expect(remainingDenied).toEqual(['deny-active']);
    const remainingLegacy = db.prepare(`SELECT hash FROM legacy_revocations`).all().map(r => r.hash);
    expect(remainingLegacy).toEqual(['b'.repeat(64)]);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM session_families`).get().n).toBe(2);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM replay_audit`).get().n).toBe(1);

    // A second pass has nothing left to delete.
    expect(tokenStore.purgeExpired(db, { now, limit: 100 })).toEqual({ access: 0, refresh: 0, legacy: 0 });
    db.close();
  });

  test('is limited to a bounded batch per table', () => {
    const tokenStore = require('../utils/tokenStore.sqlite');
    const db = tokenStore.openDbInMemory();
    const now = Date.now();
    db.prepare(`INSERT INTO session_families (familyId, sub, createdAt) VALUES ('fam', 'sub', ?)`).run(now - 1);
    const stmt = db.prepare(`
      INSERT INTO refresh_tokens (jti, familyId, sub, ver, issuedAt, expiresAt, status)
      VALUES (?, 'fam', 'sub', 0, ?, ?, 'active')
    `);
    for (let i = 0; i < 5; i++) stmt.run('exp-' + i, now - 1000 - i, now - 1 - i);

    expect(tokenStore.purgeExpired(db, { now, limit: 2 }).refresh).toBe(2);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM refresh_tokens`).get().n).toBe(3);
    expect(tokenStore.purgeExpired(db, { now, limit: 2 }).refresh).toBe(2);
    expect(tokenStore.purgeExpired(db, { now, limit: 2 }).refresh).toBe(1);
    db.close();
  });

  test('is throttled per database and runs again after the interval', () => {
    const tokenStore = require('../utils/tokenStore.sqlite');
    const db = tokenStore.openDbInMemory();
    const now = Date.now();

    const first = tokenStore.purgeExpiredIfDue(db, { now });
    expect(first.throttled).toBe(false);
    const second = tokenStore.purgeExpiredIfDue(db, { now: now + 1000 });
    expect(second).toEqual({ throttled: true, access: 0, refresh: 0, legacy: 0 });

    const later = tokenStore.purgeExpiredIfDue(db, { now: now + tokenStore.PURGE_INTERVAL_MS + 1 });
    expect(later.throttled).toBe(false);
    db.close();
  });

  test('never throws when the database is unavailable', () => {
    const tokenStore = require('../utils/tokenStore.sqlite');
    const db = tokenStore.openDbInMemory();
    db.close();

    let result;
    expect(() => { result = tokenStore.purgeExpiredIfDue(db, { now: Date.now() }); }).not.toThrow();
    expect(result).toEqual({ throttled: false, access: 0, refresh: 0, legacy: 0, error: true });
  });
});

describe('token store purge (production wiring)', () => {
  test('login housekeeping removes expired rows from the live store and keeps the new session usable', async () => {
    const tokenStore = require('../utils/tokenStore.sqlite');
    const Database = require('better-sqlite3');
    const storePath = path.join(dataDir, 'tokenStore.sqlite');

    // Open the real store and seed one expired and one active row before the
    // first login of this suite (housekeeping has not run yet).
    tokenStore.initialise(storePath);
    const db = new Database(storePath);
    const now = Date.now();
    seed(db, now);
    db.close();

    const session = await login(server, 'purge1', 'PurgePass#123');

    const check = new Database(storePath, { readonly: true });
    const expired = check.prepare(`SELECT COUNT(*) AS n FROM refresh_tokens WHERE jti LIKE 'rt-expired%'`).get().n;
    const active = check.prepare(`SELECT COUNT(*) AS n FROM refresh_tokens WHERE jti = 'rt-active'`).get().n;
    const families = check.prepare(`SELECT COUNT(*) AS n FROM session_families`).get().n;
    const audit = check.prepare(`SELECT COUNT(*) AS n FROM replay_audit`).get().n;
    check.close();

    expect(expired).toBe(0);
    expect(active).toBe(1);
    // fam-active + fam-revoked + the family created by this login.
    expect(families).toBe(3);
    expect(audit).toBe(1);

    // The freshly issued session still rotates: cleanup removed nothing live.
    const rotated = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(rotated.statusCode).toBe(200);
  });
});
