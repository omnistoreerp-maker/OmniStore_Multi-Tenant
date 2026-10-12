'use strict';

// gistSync.realprovider.test.js — REAL GitHub provider path (GATE 3).
//
// Armed ONLY by runtime env injection (never by repo contents):
//   GIST_SYNC_TEST_TOKEN    (required) a NON-PRODUCTION GitHub token with
//                           gist-only scope. Must not be a customer token.
//   GIST_SYNC_TEST_GIST_ID  (optional) a dedicated NON-PRODUCTION test gist
//                           whose dataset binding is the tenant id below.
//
// Safety contract:
//   - never prints the credential (leak checks use booleans, so a failure
//     cannot echo the token into logs);
//   - never creates and NEVER deletes any gist (no bootstrap, no cleanup
//     calls against the provider);
//   - the write phase runs ONLY against a gist already tagged for this
//     test tenant ('own' binding) and restores the original bytes in a
//     finally block;
//   - when not armed, the suite reports REAL_PROVIDER_TEST=SKIPPED with an
//     explicit reason instead of pretending to pass.

const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { login } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

const TOKEN = process.env.GIST_SYNC_TEST_TOKEN || '';
const GIST_ID = process.env.GIST_SYNC_TEST_GIST_ID || '';
const ARMED = TOKEN.trim().length > 0;
const TENANT_ID = 'realtest';
const PASSWORD = 'Pass#123';
const stamp = new Date().toISOString();
const tempDirs = [];
const realFetch = global.fetch;

const SKIP_REASON = 'GIST_SYNC_TEST_TOKEN not set (no non-production GitHub credential injected)';

function hash(pw) {
  return require('bcryptjs').hashSync(pw, 10);
}

test('REAL_PROVIDER_TEST verdict line (always runs, never fakes a pass)', () => {
  if (!ARMED) {
    console.log('REAL_PROVIDER_TEST=SKIPPED reason=' + SKIP_REASON);
  } else if (!GIST_ID) {
    console.log('REAL_PROVIDER_TEST=ARMED read=required write=SKIPPED reason=no GIST_SYNC_TEST_GIST_ID');
  } else {
    console.log('REAL_PROVIDER_TEST=ARMED read=required write=gated-on-own-binding');
  }
  expect(typeof ARMED).toBe('boolean');
});

const suite = ARMED ? describe : describe.skip;

suite('REAL. provider round-trip against api.github.com (env-gated)', () => {
  jest.setTimeout(60000);

  let server;
  let dataDir;
  let masterToken;
  let tenantToken;

  beforeAll(async () => {
    global.fetch = realFetch; // real network — no mock handler may leak in
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_ROLES = 'true';
    process.env.GIST_SYNC_VAULT_KEY = 'real-provider-test-vault-key-32chars!!';
    dataDir = makeTempDataDir('gist-realprovider');
    tempDirs.push(dataDir);
    seed(dataDir, 'companies', [{ id: TENANT_ID, name: 'Real Provider Test', code: 'RPT', active: true }]);
    seed(dataDir, 'users', { users: [
      { id: 'u-master', username: 'master', password: hash(PASSWORD), role: 'Viewer', fullName: 'Platform Master', tenantIds: [], createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
      { id: 'u-real', username: 'realOwner', password: hash(PASSWORD), role: 'Owner', fullName: 'Real Owner', tenantIds: [TENANT_ID], tenantRoles: { [TENANT_ID]: 'Owner' }, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 }
    ] });
    seed(dataDir, 'platformAdmins', { admins: [{ username: 'master', platformRole: 'MASTER_OWNER', status: 'active', createdAt: stamp, updatedAt: stamp }] });
    server = await startServer(dataDir, { RATE_LIMIT_MAX: '10000', AUTH_REQUIRED: 'true' });
    masterToken = (await login(server.app, 'master', PASSWORD)).accessToken;
    tenantToken = (await login(server.app, 'realOwner', PASSWORD, TENANT_ID)).accessToken;
  });

  afterAll(() => {
    global.fetch = realFetch;
    if (process.env.GIST_SYNC_VAULT_KEY === 'real-provider-test-vault-key-32chars!!') {
      delete process.env.GIST_SYNC_VAULT_KEY;
    }
  });

  function assertNoLeak(res) {
    // Boolean-only assertion: a failure prints `false !== true`, never the token.
    const raw = JSON.stringify(res.body || {});
    const leaked = raw.includes(TOKEN.trim());
    expect(leaked).toBe(false);
  }

  test('configure injects the env credential (write-only, encrypted at rest)', async () => {
    const body = { provider: 'github-gist', enabled: true, token: TOKEN.trim() };
    if (GIST_ID) body.gistId = GIST_ID.trim();
    const res = await request(server.app)
      .put('/api/v1/platform/sync/' + TENANT_ID)
      .set('Authorization', 'Bearer ' + masterToken)
      .send(body);
    expect(res.status).toBe(200);
    assertNoLeak(res);
    const store = readStore(dataDir, 'gistSyncState');
    const entry = store.entries.find((e) => e.tenantId === TENANT_ID);
    expect(entry).toBeTruthy();
    const blobLeaked = entry.encryptedToken.includes(TOKEN.trim());
    expect(blobLeaked).toBe(false);
  });

  test('connectivity test succeeds against the REAL provider (credential path)', async () => {
    const res = await request(server.app)
      .post('/api/v1/platform/sync/' + TENANT_ID + '/test')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.test.ok).toBe(true);
    expect(res.body.data.test.credential).toBe('ok');
    expect(typeof res.body.data.test.latencyMs).toBe('number');
    assertNoLeak(res);
  });

  if (GIST_ID) {
    test('real pull returns parseable dataset with a classified binding', async () => {
      const res = await request(server.app)
        .post('/api/v1/platform/sync/' + TENANT_ID + '/pull')
        .set('Authorization', 'Bearer ' + masterToken)
        .send({});
      expect(res.status).toBe(200);
      const pull = res.body.data.pull;
      expect(pull.revision).toMatch(/^[0-9a-f]{64}$/);
      expect(['own', 'legacy', 'unbound']).toContain(pull.binding);
      expect(typeof pull.bytes).toBe('number');
      // Master pull must never ship dataset contents back to the MCC.
      expect(pull.content).toBeUndefined();
      assertNoLeak(res);
    });

    test('write round-trip (own binding only): marker in, marker out, original restored', async () => {
      const base = await request(server.app)
        .post('/api/v1/platform/sync/' + TENANT_ID + '/pull')
        .set('Authorization', 'Bearer ' + masterToken)
        .send({});
      expect(base.status).toBe(200);
      const originalContent = base.body.data.pull.content;
      const binding = base.body.data.pull.binding;
      if (binding !== 'own') {
        console.log('WRITE_PHASE=SKIPPED reason=binding not owned (' + binding + ') — no write attempted');
        expect(binding).toBeTruthy();
        return;
      }
      const originalParsed = JSON.parse(originalContent);
      const markerKey = '_gistSyncTestMarker';
      const marked = Object.assign({}, originalParsed, { [markerKey]: Date.now() });
      let restored = false;
      try {
        const push1 = await request(server.app)
          .post('/api/v1/platform/sync/' + TENANT_ID + '/push')
          .set('Authorization', 'Bearer ' + masterToken)
          .send({ content: JSON.stringify(marked), baseRevision: base.body.data.pull.revision });
        expect(push1.status).toBe(200);
        assertNoLeak(push1);

        const verify = await request(server.app)
          .post('/api/v1/platform/sync/' + TENANT_ID + '/pull')
          .set('Authorization', 'Bearer ' + masterToken)
          .send({});
        expect(verify.status).toBe(200);
        const verifyParsed = JSON.parse(verify.body.data.pull.content);
        expect(verifyParsed[markerKey]).toBeTruthy();

        // Restore: strip the marker, push with the revision we just observed.
        delete verifyParsed[markerKey];
        const push2 = await request(server.app)
          .post('/api/v1/platform/sync/' + TENANT_ID + '/push')
          .set('Authorization', 'Bearer ' + masterToken)
          .send({ content: JSON.stringify(verifyParsed), baseRevision: verify.body.data.pull.revision });
        expect(push2.status).toBe(200);
        restored = true;
      } finally {
        if (!restored) {
          // Best-effort restore so an armed run never leaves the marker behind.
          try {
            const cur = await request(server.app)
              .post('/api/v1/platform/sync/' + TENANT_ID + '/pull')
              .set('Authorization', 'Bearer ' + masterToken)
              .send({});
            if (cur.status === 200) {
              const curParsed = JSON.parse(cur.body.data.pull.content);
              delete curParsed[markerKey];
              await request(server.app)
                .post('/api/v1/platform/sync/' + TENANT_ID + '/push')
                .set('Authorization', 'Bearer ' + masterToken)
                .send({ content: JSON.stringify(curParsed), baseRevision: cur.body.data.pull.revision });
            }
          } catch (e) {
            console.log('WRITE_PHASE_RESTORE_FAILED (manual check of the test gist required)');
          }
        }
      }

      const final = await request(server.app)
        .post('/api/v1/platform/sync/' + TENANT_ID + '/pull')
        .set('Authorization', 'Bearer ' + masterToken)
        .send({});
      expect(final.status).toBe(200);
      const finalParsed = JSON.parse(final.body.data.pull.content);
      expect(finalParsed[markerKey]).toBeUndefined();
      // Semantic equality with the original dataset (formatting-independent).
      expect(finalParsed).toEqual(originalParsed);
      assertNoLeak(final);
    });
  }

  test('tenant pull on the real provider returns the same dataset shape (device path)', async () => {
    if (!GIST_ID) {
      console.log('TENANT_PULL=SKIPPED reason=no GIST_SYNC_TEST_GIST_ID');
      expect(true).toBe(true);
      return;
    }
    const res = await request(server.app)
      .post('/api/v1/sync/pull')
      .set('Authorization', 'Bearer ' + tenantToken)
      .send({});
    expect(res.status).toBe(200);
    expect(typeof res.body.data.pull.content).toBe('string');
    expect(res.body.data.pull.revision).toMatch(/^[0-9a-f]{64}$/);
    assertNoLeak(res);
  });
});

registerCleanup(() => [], () => tempDirs);
