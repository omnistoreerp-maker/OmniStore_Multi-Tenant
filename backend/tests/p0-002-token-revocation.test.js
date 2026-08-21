// P0-2 Persistent Token Revocation regression tests.
// Verifies: hash-only persistence, survive restart, expiry pruning,
// atomic writes, API compatibility.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let dataDir;
let tokenStore;

function makeToken(overrides = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'user-1',
    username: 'testuser',
    role: 'Admin',
    jti: crypto.randomUUID(),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    ...overrides
  })).toString('base64url');
  return `${header}.${payload}.fake-sig`;
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tokenstore-'));
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  jest.resetModules();
  tokenStore = require('../utils/tokenStore');
  tokenStore._reset();
});

afterEach(() => {
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('P0-2 Persistent Token Revocation', () => {
  describe('basic revoke and check', () => {
    test('token is revoked after revokeToken()', () => {
      const token = makeToken();
      tokenStore.revokeToken(token);
      expect(tokenStore.isRevoked(token)).toBe(true);
    });

    test('different token is not revoked', () => {
      const token = makeToken();
      tokenStore.revokeToken(token);
      const other = makeToken();
      expect(tokenStore.isRevoked(other)).toBe(false);
    });

    test('null/undefined token returns false (safe default)', () => {
      expect(tokenStore.isRevoked(null)).toBe(false);
      expect(tokenStore.isRevoked(undefined)).toBe(false);
      expect(tokenStore.isRevoked('')).toBe(false);
    });

    test('revokeToken with null/undefined is a no-op', () => {
      expect(() => tokenStore.revokeToken(null)).not.toThrow();
      expect(() => tokenStore.revokeToken(undefined)).not.toThrow();
    });
  });

  describe('persistence across reload (simulated restart)', () => {
    test('revoked token survives module reload', () => {
      const token = makeToken();
      tokenStore.revokeToken(token);
      expect(tokenStore.isRevoked(token)).toBe(true);

      // Simulate restart: reset in-memory state, force fresh module load
      tokenStore._reset();
      jest.resetModules();
      process.env.DIGITRONICS_DATA_DIR = dataDir;
      const reloaded = require('../utils/tokenStore');
      expect(reloaded.isRevoked(token)).toBe(true);
    });

    test('multiple revoked tokens survive reload', () => {
      const tokens = [makeToken(), makeToken(), makeToken()];
      tokens.forEach(t => tokenStore.revokeToken(t));

      tokenStore._reset();
      jest.resetModules();
      process.env.DIGITRONICS_DATA_DIR = dataDir;
      const reloaded = require('../utils/tokenStore');
      tokens.forEach(t => {
        expect(reloaded.isRevoked(t)).toBe(true);
      });
    });
  });

  describe('raw JWT is never persisted', () => {
    test('revoked-tokens.json contains only hashes, no raw tokens', () => {
      const token = makeToken();
      tokenStore.revokeToken(token);

      const file = path.join(dataDir, 'revoked-tokens.json');
      expect(fs.existsSync(file)).toBe(true);
      const raw = fs.readFileSync(file, 'utf8');
      expect(raw).not.toContain(token);
      expect(raw).not.toContain('user-1');
      expect(raw).not.toContain('testuser');

      const entries = JSON.parse(raw);
      expect(Array.isArray(entries)).toBe(true);
      expect(entries.length).toBe(1);
      expect(entries[0].hash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
      expect(entries[0].hash).toBe(crypto.createHash('sha256').update(token).digest('hex'));
    });
  });

  describe('expiry pruning', () => {
    test('expired entries are pruned on load', () => {
      // Manually write an expired entry to disk
      const expiredToken = makeToken({ exp: Math.floor(Date.now() / 1000) - 3600 }); // 1 hour ago
      const expiredHash = crypto.createHash('sha256').update(expiredToken).digest('hex');
      const file = path.join(dataDir, 'revoked-tokens.json');
      fs.writeFileSync(file, JSON.stringify([{ hash: expiredHash, exp: Math.floor(Date.now() / 1000) - 3600 }]));

      // Reload — expired entry should be pruned
      tokenStore._reset();
      jest.resetModules();
      process.env.DIGITRONICS_DATA_DIR = dataDir;
      const reloaded = require('../utils/tokenStore');
      expect(reloaded.isRevoked(expiredToken)).toBe(false);
    });

    test('non-expired entries are kept after load', () => {
      const validToken = makeToken({ exp: Math.floor(Date.now() / 1000) + 3600 }); // 1 hour from now
      const validHash = crypto.createHash('sha256').update(validToken).digest('hex');
      const file = path.join(dataDir, 'revoked-tokens.json');
      fs.writeFileSync(file, JSON.stringify([{ hash: validHash, exp: Math.floor(Date.now() / 1000) + 3600 }]));

      tokenStore._reset();
      jest.resetModules();
      process.env.DIGITRONICS_DATA_DIR = dataDir;
      const reloaded = require('../utils/tokenStore');
      expect(reloaded.isRevoked(validToken)).toBe(true);
    });

    test('entries without exp are kept (backward compatible)', () => {
      const token = makeToken();
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      const file = path.join(dataDir, 'revoked-tokens.json');
      fs.writeFileSync(file, JSON.stringify([{ hash }])); // no exp field

      tokenStore._reset();
      jest.resetModules();
      process.env.DIGITRONICS_DATA_DIR = dataDir;
      const reloaded = require('../utils/tokenStore');
      expect(reloaded.isRevoked(token)).toBe(true);
    });
  });

  describe('atomic writes', () => {
    test('no tmp files left after write', () => {
      const token = makeToken();
      tokenStore.revokeToken(token);

      const files = fs.readdirSync(dataDir);
      const tmpFiles = files.filter(f => f.includes('.tmp'));
      expect(tmpFiles).toHaveLength(0);
    });

    test('valid JSON written even on rapid successive revocations', () => {
      const tokens = Array.from({ length: 10 }, () => makeToken());
      tokens.forEach(t => tokenStore.revokeToken(t));

      const file = path.join(dataDir, 'revoked-tokens.json');
      const entries = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(entries.length).toBe(10);
    });
  });

  describe('API compatibility', () => {
    test('revokeToken and isRevoked have same signatures as before', () => {
      expect(typeof tokenStore.revokeToken).toBe('function');
      expect(typeof tokenStore.isRevoked).toBe('function');
      // Old code: revokeToken(token) / isRevoked(token) — unchanged
    });

    test('isRevoked returns boolean', () => {
      const token = makeToken();
      expect(typeof tokenStore.isRevoked(token)).toBe('boolean');
      expect(tokenStore.isRevoked(token)).toBe(false);
      tokenStore.revokeToken(token);
      expect(tokenStore.isRevoked(token)).toBe(true);
    });
  });
});
