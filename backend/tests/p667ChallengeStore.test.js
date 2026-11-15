'use strict';

// P6.67 — M-1/M-2 (startup validation), M-3 (bounded purge), L-3 (TTL
// agreement) and L-4 (synchronous durability) for the durable challenge store.
//
// Everything here runs against the real store module; the only fakes are the
// temporary directories created by the test itself.

const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

const config = require('../config');
const store = require('../utils/challengeStore.sqlite');
const { signChallengeToken } = require('../utils/jwt');

const {
  ChallengeStoreError,
  DEFAULT_TTL_MS,
  PURGE_BATCH_LIMIT,
  PURGE_INTERVAL_MS,
  closeDb,
  consumeChallenge,
  initialise,
  openDbInMemory,
  persistChallenge,
  purgeExpired,
  purgeExpiredIfDue,
  resolveDefaultPath,
  validateDbPath,
  validateStartupConfiguration
} = store;

const IS_POSIX = process.platform !== 'win32';
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'p667-store-'));

const savedEnv = {
  NODE_ENV: process.env.NODE_ENV,
  CHALLENGE_DB_PATH: process.env.CHALLENGE_DB_PATH,
  LOGIN_CHALLENGE_TTL: process.env.LOGIN_CHALLENGE_TTL
};

function restore(key) {
  if (savedEnv[key] === undefined) delete process.env[key];
  else process.env[key] = savedEnv[key];
}

function insertRow(db, hash, expiresAt, now) {
  db.prepare(
    'INSERT INTO challenges (hash, sub, purpose, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?)'
  ).run(hash, 'user', 'mfa', now || Date.now(), expiresAt);
}

afterAll(() => {
  ['NODE_ENV', 'CHALLENGE_DB_PATH', 'LOGIN_CHALLENGE_TTL'].forEach(restore);
  try {
    fs.rmSync(scratch, { recursive: true, force: true });
  } catch (_) {}
});

// ---------------------------------------------------------------------------
// M-1 / M-2 — explicit configuration, no silent creation
// ---------------------------------------------------------------------------

describe('P6.67 M-1/M-2 — challenge database startup validation', () => {
  test('an empty path is rejected', () => {
    expect(() => validateDbPath('')).toThrow(ChallengeStoreError);
    expect(() => validateDbPath(null)).toThrow(/required/i);
    expect(() => validateDbPath(undefined)).toThrow(/required/i);
  });

  test('a missing directory is rejected and NEVER created', () => {
    const missingDir = path.join(scratch, 'not-provisioned');
    const dbPath = path.join(missingDir, 'challenges.sqlite');

    expect(() => validateDbPath(dbPath)).toThrow(/does not exist/i);
    expect(fs.existsSync(missingDir)).toBe(false);
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  test('a path whose parent is a regular file is rejected', () => {
    const blocker = path.join(scratch, 'blocker-file');
    fs.writeFileSync(blocker, 'not a directory');
    const dbPath = path.join(blocker, 'challenges.sqlite');

    expect(() => validateDbPath(dbPath)).toThrow(/not a directory/i);
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  test('an unwritable directory is rejected before any database is opened', () => {
    if (!IS_POSIX) {
      // Windows ignores mode bits for directories, so the equivalent guarantee
      // is covered by the "parent is a file" case above. Documented, not faked.
      expect(IS_POSIX).toBe(false);
      return;
    }
    const lockedDir = path.join(scratch, 'read-only');
    fs.mkdirSync(lockedDir, { recursive: true });
    fs.chmodSync(lockedDir, 0o500);
    try {
      expect(() => validateDbPath(path.join(lockedDir, 'challenges.sqlite'))).toThrow(
        /not writable/i
      );
      expect(fs.existsSync(path.join(lockedDir, 'challenges.sqlite'))).toBe(false);
    } finally {
      fs.chmodSync(lockedDir, 0o700);
    }
  });

  test('production requires an explicit CHALLENGE_DB_PATH', () => {
    delete process.env.CHALLENGE_DB_PATH;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => resolveDefaultPath()).toThrow(/CHALLENGE_DB_PATH must be configured/i);
      expect(() => validateStartupConfiguration()).toThrow(/CHALLENGE_DB_PATH must be configured/i);
    } finally {
      restore('NODE_ENV');
    }
  });

  test('staging requires an explicit CHALLENGE_DB_PATH', () => {
    delete process.env.CHALLENGE_DB_PATH;
    process.env.NODE_ENV = 'staging';
    try {
      expect(() => resolveDefaultPath()).toThrow(/CHALLENGE_DB_PATH must be configured/i);
    } finally {
      restore('NODE_ENV');
    }
  });

  test('non-production keeps a clearly warned temporary fallback', () => {
    delete process.env.CHALLENGE_DB_PATH;
    process.env.NODE_ENV = 'test';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const fallback = resolveDefaultPath();
      expect(fallback.endsWith('omnistore-login-challenges.sqlite')).toBe(true);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      restore('NODE_ENV');
    }
  });

  test('startup validation opens and closes a correctly provisioned database', () => {
    const dbPath = path.join(scratch, 'validate-ok.sqlite');
    process.env.CHALLENGE_DB_PATH = dbPath;
    try {
      expect(validateStartupConfiguration()).toBe(path.resolve(dbPath));
      expect(fs.existsSync(dbPath)).toBe(true);
    } finally {
      restore('CHALLENGE_DB_PATH');
    }
  });

  test('startup validation fails clearly when the directory is missing', () => {
    const dbPath = path.join(scratch, 'absent-dir', 'challenges.sqlite');
    process.env.CHALLENGE_DB_PATH = dbPath;
    try {
      expect(() => validateStartupConfiguration()).toThrow(ChallengeStoreError);
      expect(fs.existsSync(path.dirname(dbPath))).toBe(false);
    } finally {
      restore('CHALLENGE_DB_PATH');
    }
  });
});

// ---------------------------------------------------------------------------
// M-3 — bounded retention housekeeping
// ---------------------------------------------------------------------------

describe('P6.67 M-3 — bounded purge', () => {
  let db;
  beforeEach(() => {
    db = openDbInMemory();
  });
  afterEach(() => closeDb(db));

  test('the expiry boundary is honoured: expiresAt === now is expired', () => {
    const now = Date.now();
    insertRow(db, 'boundary-expired', now, now - 1000);
    insertRow(db, 'boundary-active', now + 1, now - 1000);

    expect(purgeExpired(db, { now })).toBe(1);
    const left = db.prepare('SELECT hash FROM challenges ORDER BY hash').all().map((r) => r.hash);
    expect(left).toEqual(['boundary-active']);
  });

  test('unexpired challenges are never deleted', () => {
    const now = Date.now();
    for (let i = 0; i < 5; i += 1) insertRow(db, 'active-' + i, now + 60000, now);
    expect(purgeExpired(db, { now })).toBe(0);
    expect(db.prepare('SELECT COUNT(*) c FROM challenges').get().c).toBe(5);
  });

  test('a purge is bounded by the requested limit and finishes over several calls', () => {
    const now = Date.now();
    for (let i = 0; i < 5; i += 1) insertRow(db, 'expired-' + i, now - 1000 - i, now - 5000);

    expect(purgeExpired(db, { now, limit: 2 })).toBe(2);
    expect(purgeExpired(db, { now, limit: 2 })).toBe(2);
    expect(db.prepare('SELECT COUNT(*) c FROM challenges').get().c).toBe(1);
    expect(purgeExpired(db, { now, limit: 2 })).toBe(1);
  });

  test('the throttle caps housekeeping to one bounded batch per interval', () => {
    const now = Date.now();
    for (let i = 0; i < 3; i += 1) insertRow(db, 'expired-throttle-' + i, now - 1000, now);

    expect(purgeExpiredIfDue(db, { now })).toBe(3);
    insertRow(db, 'expired-throttle-late', now - 10, now);

    expect(purgeExpiredIfDue(db, { now: now + 1000 })).toBe(0);
    expect(db.prepare('SELECT COUNT(*) c FROM challenges').get().c).toBe(1);

    expect(purgeExpiredIfDue(db, { now: now + PURGE_INTERVAL_MS + 1 })).toBe(1);
  });

  test('the default batch size is a finite bound', () => {
    expect(Number.isFinite(PURGE_BATCH_LIMIT)).toBe(true);
    expect(PURGE_BATCH_LIMIT).toBeGreaterThan(0);
    expect(PURGE_BATCH_LIMIT).toBeLessThanOrEqual(1000);
  });
});

// ---------------------------------------------------------------------------
// L-3 — one authoritative TTL for the JWT and the durable row
// ---------------------------------------------------------------------------

describe('P6.67 L-3 — JWT and database expiry agree', () => {
  test('the default row TTL is the configured challenge TTL', () => {
    expect(DEFAULT_TTL_MS).toBe(config.loginChallengeTtlMs);
    expect(DEFAULT_TTL_MS).toBeGreaterThan(0);
  });

  test('a signed challenge and its row expire at the same moment', () => {
    const db = openDbInMemory();
    try {
      const token = signChallengeToken({ id: 'user-ttl' }, 'mfa');
      const decoded = jwt.decode(token);
      const jwtTtlMs = (decoded.exp - decoded.iat) * 1000;

      const row = persistChallenge(db, { token, sub: 'user-ttl', purpose: 'mfa' });
      const rowTtlMs = row.expiresAt - row.createdAt;

      expect(jwtTtlMs).toBe(config.loginChallengeTtlMs);
      expect(rowTtlMs).toBe(config.loginChallengeTtlMs);
      expect(jwtTtlMs).toBe(rowTtlMs);
    } finally {
      closeDb(db);
    }
  });

  test('a configured LOGIN_CHALLENGE_TTL drives both expirations', () => {
    process.env.LOGIN_CHALLENGE_TTL = '10m';
    jest.resetModules();
    try {
      const cfg = require('../config');
      expect(cfg.loginChallengeTtl).toBe('10m');
      expect(cfg.loginChallengeTtlMs).toBe(600000);

      const freshStore = require('../utils/challengeStore.sqlite');
      const freshJwt = require('../utils/jwt');
      expect(freshStore.DEFAULT_TTL_MS).toBe(600000);

      const token = freshJwt.signChallengeToken({ id: 'user-ttl-2' }, 'mfa');
      const decoded = jwt.decode(token);
      expect((decoded.exp - decoded.iat) * 1000).toBe(600000);

      const db = freshStore.openDbInMemory();
      try {
        const row = freshStore.persistChallenge(db, { token, sub: 'user-ttl-2', purpose: 'mfa' });
        expect(row.expiresAt - row.createdAt).toBe(600000);
      } finally {
        freshStore.closeDb(db);
      }
    } finally {
      restore('LOGIN_CHALLENGE_TTL');
      jest.resetModules();
    }
  });

  test('an invalid LOGIN_CHALLENGE_TTL fails fast instead of defaulting silently', () => {
    process.env.LOGIN_CHALLENGE_TTL = 'eventually';
    jest.resetModules();
    try {
      expect(() => require('../config')).toThrow(/LOGIN_CHALLENGE_TTL/);
    } finally {
      restore('LOGIN_CHALLENGE_TTL');
      jest.resetModules();
    }
  });
});

// ---------------------------------------------------------------------------
// L-4 — durability configuration
// ---------------------------------------------------------------------------

describe('P6.67 L-4 — synchronous=FULL durability setting', () => {
  test('the challenge database is opened with synchronous=FULL and WAL', () => {
    const dbPath = path.join(scratch, 'durability.sqlite');
    process.env.CHALLENGE_DB_PATH = dbPath;
    try {
      const opened = initialise(dbPath);
      try {
        // 2 === FULL: every commit is fsynced, so a consumed challenge cannot
        // reappear after a power loss within its TTL.
        expect(opened.db.pragma('synchronous', { simple: true })).toBe(2);
        expect(String(opened.db.pragma('journal_mode', { simple: true })).toLowerCase()).toBe('wal');
      } finally {
        closeDb(opened.db);
      }
    } finally {
      restore('CHALLENGE_DB_PATH');
    }
  });

  test('a consumed challenge stays consumed after a close/reopen cycle', () => {
    const dbPath = path.join(scratch, 'reopen.sqlite');
    process.env.CHALLENGE_DB_PATH = dbPath;
    try {
      const first = initialise(dbPath);
      const token = signChallengeToken({ id: 'user-reopen' }, 'mfa');
      persistChallenge(first.db, { token, sub: 'user-reopen', purpose: 'mfa' });
      expect(consumeChallenge(first.db, { token, purpose: 'mfa', sub: 'user-reopen' }).consumed).toBe(true);
      closeDb(first.db);

      const second = initialise(dbPath);
      try {
        const replay = consumeChallenge(second.db, { token, purpose: 'mfa', sub: 'user-reopen' });
        expect(replay.consumed).toBe(false);
        expect(replay.reason).toBe('not_found');
      } finally {
        closeDb(second.db);
      }
    } finally {
      restore('CHALLENGE_DB_PATH');
    }
  });
});
