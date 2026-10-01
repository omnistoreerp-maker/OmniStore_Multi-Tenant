'use strict';

// tiktokOAuth.security.test.js — OAuth state security regression suite.
//
// The OAuth state value is the ONLY client-controlled value in the TikTok
// connection flow, and it is a CSRF nonce, not a credential. It must:
//   - be high-entropy (randomBytes(24));
//   - be short-lived (10-minute TTL);
//   - be single-use (deleted before validation, so a replay fails);
//   - be bound to the admin who started the flow;
//   - be rejected when missing, unknown, expired, replayed, wrong-owner,
//     or presented by an unauthorized actor.
//
// No test touches the network or any real credential.

const crypto = require('crypto');

describe('TikTok OAuth state security', () => {
  let connection;

  beforeEach(() => {
    jest.resetModules();
    process.env.DIGITRONICS_DATA_DIR = require('os').tmpdir();
    process.env.NODE_ENV = 'test';
    process.env.TIKTOK_REDIRECT_URI = 'https://app.omnistoreerp.com/tiktok/callback';
    connection = require('../services/tiktokConnection.service');
  });

  test('state values are 48 hex characters (randomBytes(24))', () => {
    const a = connection.createState();
    const b = connection.createState();
    expect(typeof a).toBe('string');
    expect(a).toMatch(/^[0-9a-f]{48}$/);
    expect(b).toMatch(/^[0-9a-f]{48}$/);
    expect(a).not.toBe(b);
  });

  test('a state created with an owner is bound to that owner', () => {
    const state = connection.createState('admin-one');
    expect(connection.consumeState(state, 'admin-one')).toBe(true);
    // The same state presented by a different owner must be rejected.
    expect(connection.consumeState(state, 'admin-two')).toBe(false);
  });

  test('a state created without an owner is not owner-bound', () => {
    const state = connection.createState();
    expect(connection.consumeState(state, 'anyone')).toBe(true);
  });

  test('a missing state is rejected', () => {
    expect(connection.consumeState('', 'admin')).toBe(false);
    expect(connection.consumeState(null, 'admin')).toBe(false);
    expect(connection.consumeState(undefined, 'admin')).toBe(false);
  });

  test('an unknown state is rejected', () => {
    expect(connection.consumeState('deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', 'admin')).toBe(false);
  });

  test('a state is single-use: the first consume succeeds, the second fails', () => {
    const state = connection.createState('admin');
    expect(connection.consumeState(state, 'admin')).toBe(true);
    expect(connection.consumeState(state, 'admin')).toBe(false);
  });

  test('a state is single-use even when the owner is wrong on the second attempt', () => {
    const state = connection.createState('admin');
    expect(connection.consumeState(state, 'wrong-owner')).toBe(false);
    // Consumed (deleted) on the first attempt regardless of owner match.
    expect(connection.consumeState(state, 'admin')).toBe(false);
  });

  test('an expired state is rejected', () => {
    // Mock the internal clock by setting a state and advancing time past TTL.
    const state = connection.createState('admin');
    // STATE_TTL_MS is 10 minutes. Jump the clock forward by an hour.
    const realNow = Date.now;
    let fakeNow = realNow() + 61 * 60 * 1000;
    Date.now = () => fakeNow;
    try {
      expect(connection.consumeState(state, 'admin')).toBe(false);
    } finally {
      Date.now = realNow;
    }
  });

  test('buildAuthorizeUrl embeds the state in the redirect_uri query', () => {
    const state = connection.createState('admin');
    const url = connection.buildAuthorizeUrl(state);
    expect(url.startsWith('https://www.tiktok.com/v2/auth/authorize/')).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get('state')).toBe(state);
    // TikTok's OAuth contract uses client_key, not client_id.
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('scope')).toContain('video.list');
    expect(parsed.searchParams.get('redirect_uri')).toBeTruthy();
  });

  test('buildAuthorizeUrl includes the configured client_key when set', () => {
    process.env.TIKTOK_CLIENT_KEY = 'cfg-client-key';
    jest.resetModules();
    connection = require('../services/tiktokConnection.service');
    const state = connection.createState('admin');
    const url = connection.buildAuthorizeUrl(state);
    const parsed = new URL(url);
    expect(parsed.searchParams.get('client_key')).toBe('cfg-client-key');
  });

  test('no state value is ever exposed in the connection status response', () => {
    const state = connection.createState('admin');
    const status = connection.getStatus();
    expect(JSON.stringify(status)).not.toContain(state);
  });
});