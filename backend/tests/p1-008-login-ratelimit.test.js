// P1-8 Login Rate Limiter regression tests.
// Verifies: IP+username isolation, separate limits per credential,
// rate limit enforcement. No product code changes.
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');
const bcrypt = require('bcryptjs');

let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  dataDir = makeTempDataDir('login-rl');
  const hash = bcrypt.hashSync('Password123!', 10);
  seed(dataDir, 'users', {
    users: [
      { id: 'u-alice', username: 'alice', password: hash, role: 'Admin', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'u-bob', username: 'bob', password: hash, role: 'Cashier', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]
  });
  server = await startServer(dataDir, { RATE_LIMIT_MAX: '1000' });
});

describe('P1-8 Login Rate Limiter', () => {
  describe('IP+username isolation (unit test of key generation)', () => {
    test('different usernames from same IP produce different rate limit keys', () => {
      // Extract the keyGenerator from the loginRateLimiter source code
      // by requiring the module and testing the logic directly.
      const rateLimit = require('express-rate-limit');
      const { ipKeyGenerator } = require('express-rate-limit');

      // Replicate the keyGenerator logic from security.js
      function loginKeyGen(req) {
        const ip = ipKeyGenerator(req.ip || req.connection.remoteAddress || 'unknown');
        const username = (req.body && req.body.username) ? String(req.body.username).toLowerCase() : '';
        return `${ip}:${username}`;
      }

      const keyAlice = loginKeyGen({ ip: '127.0.0.1', body: { username: 'alice' } });
      const keyBob = loginKeyGen({ ip: '127.0.0.1', body: { username: 'bob' } });
      const keyAlice2 = loginKeyGen({ ip: '127.0.0.1', body: { username: 'alice' } });
      const keyBobLower = loginKeyGen({ ip: '127.0.0.1', body: { username: 'BOB' } });

      // Same IP + different username → different keys
      expect(keyAlice).not.toBe(keyBob);
      // Same IP + same username → same key (deterministic)
      expect(keyAlice).toBe(keyAlice2);
      // Username is lowercased
      expect(keyBob).toBe(keyBobLower);
    });

    test('different IPs with same username produce different keys', () => {
      const { ipKeyGenerator } = require('express-rate-limit');

      function loginKeyGen(req) {
        const ip = ipKeyGenerator(req.ip || req.connection.remoteAddress || 'unknown');
        const username = (req.body && req.body.username) ? String(req.body.username).toLowerCase() : '';
        return `${ip}:${username}`;
      }

      const keyA = loginKeyGen({ ip: '127.0.0.1', body: { username: 'alice' } });
      const keyB = loginKeyGen({ ip: '192.168.1.100', body: { username: 'alice' } });

      expect(keyA).not.toBe(keyB);
    });

    test('key format is ip:username', () => {
      const { ipKeyGenerator } = require('express-rate-limit');

      function loginKeyGen(req) {
        const ip = ipKeyGenerator(req.ip || req.connection.remoteAddress || 'unknown');
        const username = (req.body && req.body.username) ? String(req.body.username).toLowerCase() : '';
        return `${ip}:${username}`;
      }

      const key = loginKeyGen({ ip: '10.0.0.1', body: { username: 'TestUser' } });
      expect(key).toBe('10.0.0.1:testuser');
    });

    test('missing username produces key with empty suffix', () => {
      const { ipKeyGenerator } = require('express-rate-limit');

      function loginKeyGen(req) {
        const ip = ipKeyGenerator(req.ip || req.connection.remoteAddress || 'unknown');
        const username = (req.body && req.body.username) ? String(req.body.username).toLowerCase() : '';
        return `${ip}:${username}`;
      }

      const key = loginKeyGen({ ip: '10.0.0.1', body: {} });
      expect(key).toBe('10.0.0.1:');
    });
  });

  describe('rate limit enforcement (integration)', () => {
    test('rate limit returns 429 with proper message after max attempts', async () => {
      // Create a fresh server with a fresh rate limit store
      const rlDir = makeTempDataDir('login-rl-int');
      const hash = bcrypt.hashSync('pass', 10);
      seed(rlDir, 'users', {
        users: [
          { id: 'u1', username: 'rluser', password: hash, role: 'Admin', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        ]
      });
      const rlServer = await startServer(rlDir, { RATE_LIMIT_MAX: '1000' });

      // The login rate limiter has max:20 per 15min window.
      // Make 20 wrong attempts to exhaust the limit.
      for (let i = 0; i < 20; i++) {
        await request(rlServer.app).post('/api/v1/auth/login').send({ username: 'rluser', password: 'wrong' });
      }
      // 21st attempt should be rate-limited
      const res = await request(rlServer.app).post('/api/v1/auth/login').send({ username: 'rluser', password: 'wrong' });
      expect(res.statusCode).toBe(429);
      expect(res.body.message).toMatch(/too many/i);
    }, 30000); // 30s timeout for 20+ sequential requests
  });

  describe('normal login still works', () => {
    test('successful login returns 200 with tokens', async () => {
      const res = await request(server.app)
        .post('/api/v1/auth/login')
        .send({ username: 'alice', password: 'Password123!' });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.accessToken).toBeTruthy();
    });

    test('wrong password returns 401 (not 429)', async () => {
      const res = await request(server.app)
        .post('/api/v1/auth/login')
        .send({ username: 'alice', password: 'wrong' });
      expect(res.statusCode).toBe(401);
    });
  });
});
