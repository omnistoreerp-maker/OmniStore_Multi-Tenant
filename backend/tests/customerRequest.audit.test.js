'use strict';

// customerRequest.audit.test.js — audit-trail integrity + company scoping.
//
// transitionStatus() used to accept an actor from the request body
// (`body.actor || req.user.username`), letting any authenticated caller
// forge audit history by posting { actor: 'someone-else' }. The actor is
// now always the authenticated user. These tests pin that fix and the
// company-scoped visibility of requests.

const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');
const { login } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

const now = new Date().toISOString();
const PASSWORD = 'Pass#123';

let server;
let dataDir;
let token;

beforeAll(async () => {
  process.env.AUTH_REQUIRED = 'true';
  process.env.ENABLE_TENANT_CARRY = 'true';
  dataDir = makeTempDataDir('customer-request-audit');

  seed(dataDir, 'companies', { companies: [
    { id: 'digi', code: 'DIGI', name: 'DigiTronics', active: true },
    { id: 'rival', code: 'RIVAL', name: 'Rival Co', active: true }
  ]});
  seed(dataDir, 'users', { users: [
    { id: 'u-1', username: 'requser', password: bcrypt.hashSync(PASSWORD, 10), role: 'Owner', fullName: 'Req User', tenantId: 'digi', createdAt: now, updatedAt: now },
    { id: 'u-2', username: 'rivaluser', password: bcrypt.hashSync(PASSWORD, 10), role: 'Owner', fullName: 'Rival User', tenantId: 'rival', createdAt: now, updatedAt: now }
  ]});
  seed(dataDir, 'customerRequests', { requests: [
    { id: 'cr_digi_1', customerRequestNumber: 'CR-1', companyId: 'digi', branchId: null, product: 'ERP', type: 'BUG', priority: 'P1', title: 'Login broken', description: 'Cannot login', status: 'NEW', resolution: '', createdAt: now, updatedAt: now, createdBy: 'requser', assignedTo: null, releaseId: null }
  ]});

  server = startServer(dataDir, { AUTH_REQUIRED: 'true' }).app;
  token = (await login(server, 'requser', PASSWORD, 'digi')).accessToken;
});

registerCleanup(() => [server], () => [dataDir]);

describe('customer request audit integrity', () => {
  test('transition actor is the authenticated user even when body.actor forges another identity', async () => {
    const res = await request(server)
      .post('/api/v1/customer/requests/cr_digi_1/transition')
      .set('Authorization', 'Bearer ' + token)
      .send({ toStatus: 'TRIAGED', actor: 'FORGED-OPERATOR', note: 'looks legit' });
    expect(res.statusCode).toBe(200);

    const detail = await request(server)
      .get('/api/v1/customer/requests/cr_digi_1')
      .set('Authorization', 'Bearer ' + token);
    expect(detail.statusCode).toBe(200);
    const audit = detail.body.data.audit || [];
    const entry = audit.find((a) => a.toStatus === 'TRIAGED');
    expect(entry).toBeTruthy();
    expect(entry.actor).toBe('requser');
    expect(entry.actor).not.toBe('FORGED-OPERATOR');
  });

  test('valid state machine transitions still work on a fresh request', async () => {
    const created = await request(server)
      .post('/api/v1/customer/requests')
      .set('Authorization', 'Bearer ' + token)
      .send({ title: 'Fresh case', description: 'Self-contained', type: 'CHANGE', priority: 'P2', product: 'ERP' });
    expect(created.statusCode).toBe(201);
    const id = created.body.data.request.id;

    const res = await request(server)
      .post('/api/v1/customer/requests/' + id + '/transition')
      .set('Authorization', 'Bearer ' + token)
      .send({ toStatus: 'TRIAGED' });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.request.status).toBe('TRIAGED');
  });

  test('invalid transition is rejected by the state machine', async () => {
    const created = await request(server)
      .post('/api/v1/customer/requests')
      .set('Authorization', 'Bearer ' + token)
      .send({ title: 'Jump case', description: 'Illegal jump attempt', type: 'FEATURE', priority: 'P3', product: 'ERP' });
    const id = created.body.data.request.id;

    const res = await request(server)
      .post('/api/v1/customer/requests/' + id + '/transition')
      .set('Authorization', 'Bearer ' + token)
      .send({ toStatus: 'RELEASED' }); // NEW cannot jump to RELEASED
    expect(res.statusCode).toBe(400);
  });

  test('requests are company-scoped: foreign company gets 404', async () => {
    // rivaluser is authenticated against 'rival'; the request belongs to digi.
    seed(dataDir, 'users', { users: [
      { id: 'u-1', username: 'requser', password: bcrypt.hashSync(PASSWORD, 10), role: 'Owner', fullName: 'Req User', tenantId: 'digi', createdAt: now, updatedAt: now },
      { id: 'u-2', username: 'rivaluser', password: bcrypt.hashSync(PASSWORD, 10), role: 'Owner', fullName: 'Rival User', tenantId: 'rival', createdAt: now, updatedAt: now }
    ]});
    const rivalToken = (await login(server, 'rivaluser', PASSWORD, 'rival')).accessToken;
    const res = await request(server)
      .get('/api/v1/customer/requests/cr_digi_1')
      .set('Authorization', 'Bearer ' + rivalToken);
    // The controller scopes by the caller's company; a foreign request must
    // not be readable (404 hides existence).
    expect([404]).toContain(res.statusCode);
  });
});
