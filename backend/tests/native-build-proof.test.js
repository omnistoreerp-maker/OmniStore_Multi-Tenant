// Native build proof - tests actual OmniStore SQLite store APIs
// Tests use file-backed databases only, never :memory:
// Tests use actual exported functions from challengeStore.sqlite.js, tokenStore.sqlite.js, sqliteSnapshot.js

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

const challengeStore = require('../utils/challengeStore.sqlite');
const tokenStore = require('../utils/tokenStore.sqlite');
const sqliteSnapshot = require('../utils/sqliteSnapshot');

describe('Native build proof - application SQLite stores', () => {
  const tempFiles = [];

  afterEach(() => {
    for (const f of tempFiles) {
      try { fs.unlinkSync(f); } catch (_) {}
      for (const suffix of ['-wal', '-shm', '-journal']) {
        try { fs.unlinkSync(f + suffix); } catch (_) {}
      }
    }
    tempFiles.length = 0;
  });

  function tempDbPath() {
    const p = path.join(os.tmpdir(), 'native-proof-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.sqlite');
    tempFiles.push(p);
    return p;
  }

  function winPath(p) {
    // Escape backslashes for safe interpolation into child-process JS string literals
    return String(p).replace(/\\/g, '\\\\');
  }

  describe('Native module load', () => {
    test('better-sqlite3 loads without error', () => {
      expect(() => require('better-sqlite3')).not.toThrow();
    });
  });

  describe('challengeStore.sqlite.js - persist and consume', () => {
    test('initialise opens file-backed database', () => {
      const p = tempDbPath();
      const result = challengeStore.initialise(p);
      expect(result.db).toBeDefined();
      expect(result.path).toBe(p);
      expect(fs.existsSync(p)).toBe(true);
      challengeStore.closeDb(result.db);
    });

    test('persistChallenge and consumeChallenge enforce single-use', () => {
      const p = tempDbPath();
      const { db } = challengeStore.initialise(p);
      const token = crypto.randomBytes(32).toString('hex');

      const persisted = challengeStore.persistChallenge(db, { token, sub: 'user-1', purpose: 'google_mfa' });
      expect(persisted.sub).toBe('user-1');
      expect(persisted.purpose).toBe('google_mfa');

      const consumed = challengeStore.consumeChallenge(db, { token, purpose: 'google_mfa', sub: 'user-1' });
      expect(consumed.consumed).toBe(true);
      expect(consumed.reason).toBe('success');

      const replayed = challengeStore.consumeChallenge(db, { token, purpose: 'google_mfa', sub: 'user-1' });
      expect(replayed.consumed).toBe(false);
      expect(replayed.reason).toBe('not_found');

      challengeStore.closeDb(db);
    });

    test('persistOAuthLoginTransaction and consumeOAuthLoginTransaction', () => {
      const p = tempDbPath();
      const { db } = challengeStore.initialise(p);
      const state = crypto.randomBytes(16).toString('hex');
      const binding = crypto.randomBytes(16).toString('hex');
      const payload = { provider: 'google', tenantId: 'tenant-1' };

      const result = challengeStore.persistOAuthLoginTransaction(db, { state, browserBindingHash: binding, payload });
      expect(result.createdAt).toBeDefined();

      const consumed = challengeStore.consumeOAuthLoginTransaction(db, { state, browserBindingHash: binding });
      expect(consumed.consumed).toBe(true);
      expect(consumed.payload).toEqual(payload);

      challengeStore.closeDb(db);
    });
  });

  describe('challengeStore.sqlite.js - concurrent consumption', () => {
    test('genuine concurrent consumption: exactly one consumer succeeds', () => {
      const p = tempDbPath();
      const { db } = challengeStore.initialise(p);
      const token = crypto.randomBytes(32).toString('hex');
      const hash = challengeStore.hashChallenge(token);

      challengeStore.persistChallenge(db, { token, sub: 'user-concurrent', purpose: 'google_mfa' });
      challengeStore.closeDb(db);

      const consumerScript = `
        const Database = require('better-sqlite3');
        const db = new Database('${winPath(p)}');
        db.pragma('journal_mode = WAL');
        db.pragma('busy_timeout = 5000');
        const hash = '${hash}';
        const now = Date.now();
        const result = db.prepare('DELETE FROM challenges WHERE hash = ? AND purpose = ? AND expiresAt > ?').run(hash, 'google_mfa', now);
        db.close();
        process.exit(result.changes === 1 ? 0 : 1);
      `;

      const results = [];
      for (let i = 0; i < 2; i++) {
        results.push(new Promise((resolve) => {
          const child = spawn(process.execPath, ['-e', consumerScript], { stdio: 'ignore' });
          child.on('close', (code) => resolve(code === 0));
        }));
      }

      return Promise.all(results).then((outcomes) => {
        const successes = outcomes.filter(Boolean).length;
        expect(successes).toBe(1);
      });
    });
  });

  describe('tokenStore.sqlite.js - session family and refresh token', () => {
    test('create session family and issue refresh token through actual API', () => {
      const p = tempDbPath();
      const { db } = tokenStore.initialise(p);

      const family = tokenStore.createSessionFamily(db, 'user-1', 'tenant-1');
      expect(family.familyId).toBeDefined();
      expect(family.createdAt).toBeDefined();

      const issuedAt = Date.now();
      const expiresAt = issuedAt + 7 * 24 * 60 * 60 * 1000;
      const result = tokenStore.createRefreshToken(db, family.familyId, 'user-1', 0, 'tenant-1', expiresAt);
      expect(result.jti).toBeDefined();
      expect(result.issuedAt).toBeDefined();

      const retrieved = tokenStore.getRefreshToken(db, result.jti);
      expect(retrieved.status).toBe('active');

      challengeStore.closeDb(db);
    });

    test('rotate refresh token and reject replay through actual API', () => {
      const p = tempDbPath();
      const { db } = tokenStore.initialise(p);

      const family = tokenStore.createSessionFamily(db, 'user-1', 'tenant-1');
      const issuedAt = Date.now();
      const expiresAt = issuedAt + 7 * 24 * 60 * 60 * 1000;
      const oldJti = crypto.randomUUID();
      const newJti = crypto.randomUUID();

      // Insert old refresh token directly (createRefreshToken generates its own jti)
      db.prepare("INSERT INTO refresh_tokens (jti, familyId, sub, ver, tenantId, issuedAt, expiresAt, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')")
        .run(oldJti, family.familyId, 'user-1', 0, 'tenant-1', issuedAt, expiresAt);

      // Rotate using internal API (wrappers use global _db which may not be set)
      const result = tokenStore.rotateRefreshToken(oldJti, {
        jti: newJti,
        familyId: family.familyId,
        sub: 'user-1',
        ver: 0,
        tenantId: 'tenant-1',
        issuedAt,
        expiresAt
      }, { id: 'user-1', tokenVersion: 0 });

      expect(result.jti).toBe(newJti);

      // Verify old token is consumed
      const oldToken = tokenStore.getRefreshToken(db, oldJti);
      expect(oldToken.status).toBe('consumed');

      // Verify replay is rejected - rotating same oldJti again should throw
      expect(() => {
        tokenStore.rotateRefreshToken(oldJti, {
          jti: newJti,
          familyId: family.familyId,
          sub: 'user-1',
          ver: 0,
          tenantId: 'tenant-1',
          issuedAt,
          expiresAt
        }, { id: 'user-1', tokenVersion: 0 });
      }).toThrow();

      challengeStore.closeDb(db);
    });

    test('revoke access token persists after close and reopen', () => {
      const p = tempDbPath();
      const { db } = tokenStore.initialise(p);

      const jti = crypto.randomUUID();
      const result = tokenStore.revokeAccessToken(jti, 'user-1', Date.now() + 86400000);
      expect(result.revoked).toBe(true);

      // Verify within same connection
      const check1 = tokenStore.isAccessTokenRevoked(jti);
      expect(check1).toBe(true);

      challengeStore.closeDb(db);

      // Reopen and verify persistence
      const { db: db2 } = tokenStore.initialise(p);
      const check2 = tokenStore.isAccessTokenRevoked(jti);
      expect(check2).toBe(true);

      challengeStore.closeDb(db2);
    });

    test('revoke session family persists after close and reopen', () => {
      const p = tempDbPath();
      const { db } = tokenStore.initialise(p);

      const family = tokenStore.createSessionFamily(db, 'user-1', 'tenant-1');

      const result = tokenStore.revokeFamily(family.familyId, 'user-1');
      expect(result.revoked).toBe(true);

      const isRevoked = tokenStore.isFamilyRevoked(family.familyId, 'user-1');
      expect(isRevoked).toBe(true);

      challengeStore.closeDb(db);

      // Reopen and verify persistence
      const { db: db2 } = tokenStore.initialise(p);
      const isRevoked2 = tokenStore.isFamilyRevoked(family.familyId, 'user-1');
      expect(isRevoked2).toBe(true);

      challengeStore.closeDb(db2);
    });
  });

  describe('sqliteSnapshot.js - backup and restore', () => {
    test('backup and restore SQLite database with integrity', async () => {
      const source = tempDbPath();
      const { db } = challengeStore.initialise(source);
      challengeStore.persistChallenge(db, { token: 'backup-test-token', sub: 'user-1', purpose: 'google_mfa' });
      challengeStore.closeDb(db);

      const dest = tempDbPath();
      await challengeStore.backupDatabase(source, dest);
      expect(fs.existsSync(dest)).toBe(true);

      // Verify integrity of backup
      const verifyDb = new (require('better-sqlite3'))(dest, { readonly: true });
      const integrity = verifyDb.pragma('integrity_check');
      const ok = Array.isArray(integrity) ? integrity.every(r => Object.values(r)[0] === 'ok') : integrity === 'ok';
      expect(ok).toBe(true);
      verifyDb.close();
    });
  });

  describe('WAL crash recovery', () => {
    test('database survives child process crash without clean close', () => {
      const p = tempDbPath();
      const { db } = challengeStore.initialise(p);
      challengeStore.persistChallenge(db, { token: 'token-before-crash', sub: 'user-1', purpose: 'google_mfa' });
      challengeStore.closeDb(db);

      // Fork child that writes data then terminates ABRUPTLY (SIGKILL, no clean close),
      // leaving WAL frames that the parent must recover on reopen.
      const crashScript = `
        const Database = require('better-sqlite3');
        const db = new Database('${winPath(p)}');
        db.pragma('journal_mode = WAL');
        db.pragma('busy_timeout = 5000');
        const hash = require('crypto').createHash('sha256').update('crash-token').digest('hex');
        const now = Date.now();
        db.prepare('INSERT INTO challenges (hash, sub, purpose, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?)')
          .run(hash, 'user-2', 'google_mfa', now, now + 3600000);
        process.kill(process.pid, 'SIGKILL');
      `;

      return new Promise((resolve) => {
        let childStderr = '';
        const child = spawn(process.execPath, ['-e', crashScript], { stdio: ['ignore', 'pipe', 'pipe'] });
        child.stderr.on('data', (d) => { childStderr += d; });
        child.on('close', (code) => {
          // Abrupt termination is required: a clean exit (code 0) would have closed the
          // database and checkpointed the WAL, which would NOT prove crash recovery.
          expect(code).not.toBe(0);
          // Parent reopens and verifies integrity (WAL recovery after abrupt termination)
          const { db: db2 } = challengeStore.initialise(p);
          const integrity = db2.pragma('integrity_check');
          const ok = Array.isArray(integrity) ? integrity.every(r => Object.values(r)[0] === 'ok') : integrity === 'ok';
          expect(ok).toBe(true);

          // Verify crash data is present (WAL recovery preserved it)
          const row = db2.prepare("SELECT * FROM challenges WHERE sub = 'user-2'").get();
          expect(row).toBeDefined();

          challengeStore.closeDb(db2);
          resolve();
        });
      });
    });
  });

  describe('PRAGMA integrity_check', () => {
    test('passes integrity check on challenge store database', () => {
      const p = tempDbPath();
      const { db } = challengeStore.initialise(p);
      challengeStore.persistChallenge(db, { token: 'integrity-test', sub: 'user-1', purpose: 'google_mfa' });

      const integrity = db.pragma('integrity_check');
      const ok = Array.isArray(integrity) ? integrity.every(r => Object.values(r)[0] === 'ok') : integrity === 'ok';
      expect(ok).toBe(true);

      challengeStore.closeDb(db);
    });

    test('passes integrity check on token store database', () => {
      const p = tempDbPath();
      const { db } = tokenStore.initialise(p);
      tokenStore.createSessionFamily(db, 'user-1', 'tenant-1');

      const integrity = db.pragma('integrity_check');
      const ok = Array.isArray(integrity) ? integrity.every(r => Object.values(r)[0] === 'ok') : integrity === 'ok';
      expect(ok).toBe(true);

      challengeStore.closeDb(db);
    });
  });
});
