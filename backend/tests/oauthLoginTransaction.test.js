'use strict';

// Durable OAuth login transaction store: browser binding, atomic one-time
// consumption, expiry, cross-connection replay, and bounded cleanup.
const path = require('path');
const {
  initialise,
  closeDb,
  hashChallenge,
  persistOAuthLoginTransaction,
  consumeOAuthLoginTransaction,
  persistChallenge,
  consumeChallengeWithBinding
} = require('../utils/challengeStore.sqlite');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const dirs = [];
registerCleanup(() => [], () => dirs);

function fresh() {
  const dir = makeTempDataDir('oauth-tx');
  dirs.push(dir);
  return initialise(path.join(dir, 'challenges.sqlite'));
}

const PAYLOAD = { mode: 'login', nonce: 'n-1', verifier: 'v-1', returnTo: '/' };

describe('OAuth login transaction store', () => {
  test('success with correct browser binding returns payload once', () => {
    const { db } = fresh();
    persistOAuthLoginTransaction(db, {
      state: 'state-1', browserBindingHash: 'bind-hash-1', payload: PAYLOAD, ttlMs: 60000
    });
    const first = consumeOAuthLoginTransaction(db, { state: 'state-1', browserBindingHash: 'bind-hash-1' });
    expect(first.consumed).toBe(true);
    expect(first.payload).toEqual(PAYLOAD);
    const second = consumeOAuthLoginTransaction(db, { state: 'state-1', browserBindingHash: 'bind-hash-1' });
    expect(second.consumed).toBe(false);
    expect(second.reason).toBe('not_found');
    closeDb(db);
  });

  test('wrong browser binding is rejected and does not consume', () => {
    const { db } = fresh();
    persistOAuthLoginTransaction(db, {
      state: 'state-2', browserBindingHash: 'bind-hash-2', payload: PAYLOAD, ttlMs: 60000
    });
    const denied = consumeOAuthLoginTransaction(db, { state: 'state-2', browserBindingHash: 'attacker-bind' });
    expect(denied.consumed).toBe(false);
    expect(denied.reason).toBe('browser_binding_mismatch');
    const ok = consumeOAuthLoginTransaction(db, { state: 'state-2', browserBindingHash: 'bind-hash-2' });
    expect(ok.consumed).toBe(true);
    closeDb(db);
  });

  test('expired transaction is rejected and purged', () => {
    const { db } = fresh();
    persistOAuthLoginTransaction(db, {
      state: 'state-3', browserBindingHash: 'bind', payload: PAYLOAD, ttlMs: 1
    });
    db.prepare('UPDATE oauth_login_transactions SET expiresAt = 1 WHERE stateHash = ?')
      .run(hashChallenge('state-3'));
    const result = consumeOAuthLoginTransaction(db, { state: 'state-3', browserBindingHash: 'bind' });
    expect(result.consumed).toBe(false);
    expect(result.reason).toBe('expired');
    closeDb(db);
  });

  test('state is stored only as a hash', () => {
    const { db } = fresh();
    const state = 'super-secret-state-value';
    persistOAuthLoginTransaction(db, {
      state, browserBindingHash: 'bind', payload: PAYLOAD, ttlMs: 60000
    });
    const row = db.prepare('SELECT stateHash FROM oauth_login_transactions').get();
    expect(row.stateHash).toBe(hashChallenge(state));
    expect(row.stateHash).not.toBe(state);
    closeDb(db);
  });

  test('consumption is durable across connections', () => {
    const first = fresh();
    persistOAuthLoginTransaction(first.db, {
      state: 'durable-state', browserBindingHash: 'b', payload: PAYLOAD, ttlMs: 60000
    });
    closeDb(first.db);
    const second = initialise(path.join(dirs[dirs.length - 1], 'challenges.sqlite'));
    expect(consumeOAuthLoginTransaction(second.db, { state: 'durable-state', browserBindingHash: 'b' }).consumed).toBe(true);
    closeDb(second.db);
  });
});

describe('consumeChallengeWithBinding — atomic validation and consumption', () => {
  function seedChallenge(db, { token = 'challenge-token', purpose = 'google_mfa', sub = 'user-1', binding = 'bind-correct' } = {}) {
    persistChallenge(db, {
      token, sub, purpose,
      extra: { browserBindingHash: binding, provider: 'google' }
    });
    return { token, purpose, sub, binding };
  }

  test('wrong browser cannot consume; correct browser can afterwards', () => {
    const { db } = fresh();
    const c = seedChallenge(db);
    const wrong = consumeChallengeWithBinding(db, { ...c, browserBindingHash: 'bind-wrong' });
    expect(wrong.consumed).toBe(false);
    expect(wrong.reason).toBe('browser_binding_mismatch');
    const ok = consumeChallengeWithBinding(db, { ...c, browserBindingHash: c.binding });
    expect(ok.consumed).toBe(true);
    expect(ok.extra.provider).toBe('google');
    closeDb(db);
  });

  test('replayed challenge is rejected', () => {
    const { db } = fresh();
    const c = seedChallenge(db);
    expect(consumeChallengeWithBinding(db, { ...c, browserBindingHash: c.binding }).consumed).toBe(true);
    const replay = consumeChallengeWithBinding(db, { ...c, browserBindingHash: c.binding });
    expect(replay.consumed).toBe(false);
    expect(replay.reason).toBe('not_found');
    closeDb(db);
  });

  test('wrong purpose and wrong subject do not consume', () => {
    const { db } = fresh();
    const c = seedChallenge(db);
    expect(consumeChallengeWithBinding(db, { ...c, purpose: 'google_tenant_selection', browserBindingHash: c.binding }).reason).toBe('purpose_mismatch');
    expect(consumeChallengeWithBinding(db, { ...c, sub: 'someone-else', browserBindingHash: c.binding }).reason).toBe('subject_mismatch');
    const ok = consumeChallengeWithBinding(db, { ...c, browserBindingHash: c.binding });
    expect(ok.consumed).toBe(true);
    closeDb(db);
  });

  test('missing binding cannot consume a browser-bound challenge', () => {
    const { db } = fresh();
    const c = seedChallenge(db);
    const result = consumeChallengeWithBinding(db, { token: c.token, purpose: c.purpose, sub: c.sub });
    expect(result.consumed).toBe(false);
    expect(result.reason).toBe('browser_binding_mismatch');
    closeDb(db);
  });

  test('concurrent attempts across connections allow exactly one success', () => {
    const first = fresh();
    const c = seedChallenge(first.db);
    const filePath = path.join(dirs[dirs.length - 1], 'challenges.sqlite');
    const second = initialise(filePath);
    const a = consumeChallengeWithBinding(first.db, { ...c, browserBindingHash: c.binding });
    const b = consumeChallengeWithBinding(second.db, { ...c, browserBindingHash: c.binding });
    const results = [a, b];
    expect(results.filter(r => r.consumed).length).toBe(1);
    expect(results.filter(r => !r.consumed).length).toBe(1);
    closeDb(first.db);
    closeDb(second.db);
  });

  test('existing consumeChallenge callers remain compatible', () => {
    const { db } = fresh();
    persistChallenge(db, { token: 'legacy-token', sub: 'user-1', purpose: 'google_mfa' });
    const legacy = require('../utils/challengeStore.sqlite').consumeChallenge(db, {
      token: 'legacy-token', purpose: 'google_mfa', sub: 'user-1'
    });
    expect(legacy.consumed).toBe(true);
    closeDb(db);
  });
});
