'use strict';

// P6.67 — H-2 regression: challenge throttling must be keyed on the COMPLETE
// temporary token, never on a shared prefix.
//
// P6.66 proved the defect empirically: every HS256 challenge JWT starts with
// the same base64url header, so a key built from the first 16 characters put
// every user in one bucket — ten attempts anywhere locked out everyone.
//
// These tests drive the REAL middleware chain through the real endpoints:
//   * ten attempts on challenge A leave challenge B untouched;
//   * the next attempt on A is 429 (same bucket, same quota);
//   * the independent per-IP quota still caps token rotation;
//   * a missing token lands in a safe fallback bucket (never a 500);
//   * no raw challenge token is written to the logs.

const request = require('supertest');
const jwt = require('jsonwebtoken');

const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');
const { challengeTokenBucketKey } = require('../middleware/security');

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const RATE_LIMIT_MESSAGE = 'Too many attempts, please try again later';

let server;
let dataDir;

// Every console sink is captured for the duration of the suite so the log
// assertion below observes real log output, not a stub.
const logLines = [];
const originalConsole = {};

registerCleanup(() => [server], () => [dataDir]);

function mfaAttempt(tempToken) {
  const body = { mfaToken: '123456' };
  if (tempToken !== undefined) body.tempToken = tempToken;
  return request(server.app).post('/api/v1/auth/google-login/mfa-verify').send(body);
}

function challenge(seedText) {
  // A structurally valid HS256 JWT: signed and expired-free enough to reach the
  // controller, and sharing the exact header prefix the old key hashed.
  return jwt.sign({ sub: seedText, purpose: 'mfa' }, 'p667-rate-limit-secret', { expiresIn: 300 });
}

function uniqueToken(index) {
  return challenge('user-' + index);
}

beforeAll(() => {
  dataDir = makeTempDataDir('p667-rate-limit');
  process.env.JWT_SECRET = 'test-jwt-secret-p667-rate-limit';
  process.env.NODE_ENV = 'test';
  process.env.OAUTH_ENABLED = 'false';

  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    originalConsole[level] = console[level];
    console[level] = (...args) => {
      logLines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
  }
});

afterAll(() => {
  for (const level of Object.keys(originalConsole)) console[level] = originalConsole[level];
});

beforeEach(() => {
  // A fresh app instance per test gives each case its own limiter state.
  server = startServer(dataDir);
  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
});

describe('P6.67 H-2 — challenge bucket key', () => {
  test('distinct challenge tokens never collide, even with an identical JWT header', () => {
    const tokenA = challenge('a');
    const tokenB = challenge('b');

    // Documents the exact property that broke the old 16-character key.
    expect(tokenA.slice(0, 16)).toBe(tokenB.slice(0, 16));

    expect(challengeTokenBucketKey(tokenA)).not.toBe(challengeTokenBucketKey(tokenB));
    expect(challengeTokenBucketKey(tokenA)).toMatch(/^[0-9a-f]{64}$/);
  });

  test('the same challenge always maps to the same bucket', () => {
    const token = challenge('stable');
    expect(challengeTokenBucketKey(token)).toBe(challengeTokenBucketKey(token));
  });

  test('missing or malformed tokens still produce a usable bucket key', () => {
    expect(challengeTokenBucketKey('')).toMatch(/^[0-9a-f]{64}$/);
    expect(challengeTokenBucketKey(undefined)).toMatch(/^[0-9a-f]{64}$/);
    expect(challengeTokenBucketKey(null)).toMatch(/^[0-9a-f]{64}$/);
  });

  test('the bucket key carries no raw token material', () => {
    const token = challenge('no-leak');
    const key = challengeTokenBucketKey(token);
    expect(key).not.toContain(token);
    expect(key).not.toContain(token.slice(0, 16));
    expect(key.length).toBe(64);
  });
});

describe('P6.67 H-2 — per-challenge quota isolation', () => {
  test('ten attempts on challenge A do not consume challenge B quota, and A is then limited', async () => {
    const tokenA = challenge('tenant-a-user');
    const tokenB = challenge('tenant-b-user');

    for (let i = 0; i < 10; i += 1) {
      const res = await mfaAttempt(tokenA);
      expect(res.statusCode).not.toBe(429);
      expect(res.statusCode).not.toBe(500);
    }

    // A different user's challenge is still served: no shared bucket.
    const otherUser = await mfaAttempt(tokenB);
    expect(otherUser.statusCode).not.toBe(429);
    expect(otherUser.statusCode).not.toBe(500);

    // The same challenge's quota is exhausted.
    const limited = await mfaAttempt(tokenA);
    expect(limited.statusCode).toBe(429);
  });

  test('the 429 preserves the existing response shape', async () => {
    const token = challenge('shape');
    for (let i = 0; i < 10; i += 1) await mfaAttempt(token);

    const limited = await mfaAttempt(token);
    expect(limited.statusCode).toBe(429);
    expect(limited.body).toEqual({
      success: false,
      message: RATE_LIMIT_MESSAGE,
      data: null
    });
  });
});

describe('P6.67 H-2 — independent per-IP quota', () => {
  test('rotating through fresh challenges from one IP is still capped', async () => {
    const statuses = [];
    for (let i = 0; i < 30; i += 1) {
      const res = await mfaAttempt(uniqueToken(i));
      statuses.push(res.statusCode);
    }
    // Every challenge is its own bucket, so the per-IP quota (30/15min) is what
    // must stop the 31st attempt.
    expect(statuses.filter((s) => s === 429)).toEqual([]);

    const throttled = await mfaAttempt(uniqueToken(999));
    expect(throttled.statusCode).toBe(429);
  });
});

describe('P6.67 H-2 — missing token handling', () => {
  test('requests without a tempToken are throttled, never 500', async () => {
    const statuses = [];
    for (let i = 0; i < 10; i += 1) {
      const res = await mfaAttempt(undefined);
      statuses.push(res.statusCode);
    }
    expect(statuses.every((s) => s !== 500)).toBe(true);
    expect(statuses.every((s) => s !== 429)).toBe(true);

    const limited = await mfaAttempt(undefined);
    expect(limited.statusCode).toBe(429);
    expect(limited.body.message).toBe(RATE_LIMIT_MESSAGE);
  });

  test('a non-string tempToken cannot dodge throttling', async () => {
    const statuses = [];
    for (let i = 0; i < 10; i += 1) {
      const res = await request(server.app)
        .post('/api/v1/auth/google-login/mfa-verify')
        .send({ tempToken: { nested: 'object' }, mfaToken: '123456' });
      statuses.push(res.statusCode);
    }
    expect(statuses.every((s) => s !== 500)).toBe(true);

    const limited = await request(server.app)
      .post('/api/v1/auth/google-login/mfa-verify')
      .send({ tempToken: { nested: 'object' }, mfaToken: '123456' });
    expect(limited.statusCode).toBe(429);
  });
});

describe('P6.67 H-2 — no raw challenge token in logs', () => {
  test('attempts do not log the temporary token, only derive a digest', async () => {
    const secretToken = challenge('log-probe');
    for (let i = 0; i < 3; i += 1) await mfaAttempt(secretToken);

    const combined = logLines.join('\n');
    expect(combined).not.toContain(secretToken);
    expect(combined).not.toContain(secretToken.slice(0, 16));
  });
});
