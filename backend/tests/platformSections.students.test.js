'use strict';

// platformSections.students.test.js — Students activation discovery + HTTP gate.
//
// The Students Activation cycle graduates `student-services` from coming-soon
// to the single documented active exception. This suite pins the two surfaces
// a visitor and a tenant actually touch:
//
//   1. PUBLIC DISCOVERY — GET /api/v1/platform-public/sections and /catalog
//      must advertise Students as active with the real route /student.html,
//      while marketplace/business-services stay active, Media / Reels
//      advertises /media-reels.html, support advertises /support.html as
//      active, and game-hosting stays honestly Coming Soon with url:null.
//   2. HTTP GATE — the tenant Students API is only usable when the request
//      carries a real tenant identity; anonymous access is rejected.
//
// Nothing here writes to backend/data: every scenario runs against its own
// temporary data directory via the standard test helpers.
//
// NOTE: the worktree carries documented never-staged local WIP that overrides
// both platformCatalog.service.js (default doc) and backend/data/platformPublic.json
// (file fallback inside the service). What ships is the COMMITTED content, so
// this suite loads the committed module — byte-identical to the worktree copy
// on a clean tree, verified via git. Non-git contexts fall back to the real
// module, which is already identical there.

jest.mock('../services/platformCatalog.service.js', () => {
  try {
    const cp = require('child_process');
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const repoRoot = path.resolve(__dirname, '..', '..');
    const servicesDir = path.join(repoRoot, 'backend', 'services');
    const src = cp.execFileSync(
      'git',
      ['show', 'HEAD:backend/services/platformCatalog.service.js'],
      { cwd: repoRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    );
    // Rebase relative requires onto the real services directory so the
    // committed snapshot resolves the same registry entries as the app.
    const patched = src.replace(
      /require\((['"])(\.\.?\/[^'"]+)\1\)/g,
      (m, q, rel) => "require('" + path.resolve(servicesDir, rel).split(path.sep).join('/') + "')"
    );
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'committed-catalog-'));
    const file = path.join(dir, 'platformCatalog.service.js');
    fs.writeFileSync(file, patched);
    return require(file);
  } catch (err) {
    return jest.requireActual('../services/platformCatalog.service.js');
  }
});

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { login } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

const ORIGINAL_ENV = {
  AUTH: process.env.AUTH_REQUIRED,
  CARRY: process.env.ENABLE_TENANT_CARRY,
  MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
  DATA: process.env.DIGITRONICS_DATA_DIR
};

const PASSWORD = 'Pass#123';
let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

afterAll(() => {
  for (const [key, original] of Object.entries(ORIGINAL_ENV)) {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

// ----------------------------- part 1: discovery -----------------------------
// AUTH_REQUIRED=false keeps the public platform surfaces fully open, exactly
// like the production contract the Platform Home depends on.

describe('GET /api/v1/platform-public — Students activation regression', () => {
  beforeAll(async () => {
    process.env.AUTH_REQUIRED = 'false';
    process.env.ENABLE_TENANT_CARRY = 'false';
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'false';
    dataDir = makeTempDataDir('platform-sections-students');
    // No platformPublic store is seeded on purpose: the service must fall back
    // to its documented default catalog, which now carries the active Students
    // entry. A second server with a legacy (sections-less) stored doc is
    // exercised in the dedicated suite below.
    const s = await startServer(dataDir, { AUTH_REQUIRED: 'false' });
    server = s.app;
  });

  afterAll(() => {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
    server = null;
    dataDir = null;
  });

  test('sections exposes student-services as active with /student.html', async () => {
    const res = await request(server).get('/api/v1/platform-public/sections');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    const sections = res.body.data.sections;
    expect(Array.isArray(sections)).toBe(true);
    const student = sections.find((s) => s.id === 'student-services');
    expect(student).toBeTruthy();
    expect(student.status).toBe('active');
    expect(student.url).toBe('/student.html');
  });

  test('sections keeps game-hosting locked and exposes support as active', async () => {
    const res = await request(server).get('/api/v1/platform-public/sections');
    const sections = res.body.data.sections;
    const byId = Object.fromEntries(sections.map((s) => [s.id, s]));
    for (const locked of ['game-hosting']) {
      expect(byId[locked]).toBeTruthy();
      expect(byId[locked].status).toBe('coming-soon');
      expect(byId[locked].url).toBeNull();
    }
    expect(byId.support).toBeTruthy();
    expect(byId.support.status).toBe('active');
    expect(byId.support.url).toBe('/support.html');
  });

  test('sections exposes media-reels as the active reels feed', async () => {
    const res = await request(server).get('/api/v1/platform-public/sections');
    expect(res.statusCode).toBe(200);
    const byId = Object.fromEntries(res.body.data.sections.map((s) => [s.id, s]));
    const media = byId['media-reels'];
    expect(media).toBeTruthy();
    expect(media.status).toBe('active');
    expect(media.url).toBe('/media-reels.html');
  });

  test('sections keeps the previously active sections active', async () => {
    const res = await request(server).get('/api/v1/platform-public/sections');
    const byId = Object.fromEntries(res.body.data.sections.map((s) => [s.id, s]));
    expect(byId.marketplace.status).toBe('active');
    expect(byId['business-services'].status).toBe('active');
    expect(byId.marketplace.url).toBe('/market.html');
    expect(byId['business-services'].url).toBe('/business.html');
  });

  test('catalog carries the same active student entry', async () => {
    const res = await request(server).get('/api/v1/platform-public/catalog');
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty('sections');
    const student = res.body.data.sections.find((s) => s.id === 'student-services');
    expect(student).toBeTruthy();
    expect(student.status).toBe('active');
    expect(student.url).toBe('/student.html');
  });
});

// ------------------- part 1b: legacy stored doc fallback --------------------
// A stored platformPublic document without a sections array (the shape that
// existed before this cycle) must still surface the default catalog sections
// instead of an empty list.

describe('GET /platform-public/sections — legacy stored doc without sections', () => {
  let legacyServer;
  let legacyDir;

  beforeAll(async () => {
    legacyDir = makeTempDataDir('platform-sections-legacy');
    seed(legacyDir, 'platformPublic', {
      meta: { name: 'OmniStore Platform', tagline: 'Stored doc', version: '1.0.0', lastUpdated: new Date().toISOString() },
      features: [],
      stats: [],
      highlights: []
    });
    const ls = await startServer(legacyDir, { AUTH_REQUIRED: 'false' });
    legacyServer = ls.app;
  });

  afterAll(() => {
    try { fs.rmSync(legacyDir, { recursive: true, force: true }); } catch (_) {}
    legacyServer = null;
  });

  test('falls back to the default sections instead of an empty list', async () => {
    const res = await request(legacyServer).get('/api/v1/platform-public/sections');
    expect(res.statusCode).toBe(200);
    const sections = res.body.data.sections;
    expect(Array.isArray(sections)).toBe(true);
    expect(sections.length).toBeGreaterThan(0);
    const student = sections.find((s) => s.id === 'student-services');
    expect(student).toBeTruthy();
    expect(student.status).toBe('active');
    expect(student.url).toBe('/student.html');
  });

  test('never rewrites the stored document on disk', async () => {
    const stored = readStore(legacyDir, 'platformPublic');
    expect(stored).toBeTruthy();
    expect(stored.sections).toBeUndefined();
  });
});

// ------------------------------ part 2: HTTP gate ----------------------------
// AUTH_REQUIRED=true: the tenant Students API must be unreachable without a
// tenant identity. The discovery surfaces stay public.

describe('Student services API — unauthenticated gate (AUTH_REQUIRED=true)', () => {
  let gateServer;
  let gateDir;

  beforeAll(async () => {
    gateDir = makeTempDataDir('platform-sections-gate');
    seed(gateDir, 'companies', { companies: [
      { id: 'dft', code: 'DFT', name: 'Print Shop', active: true }
    ]});
    seed(gateDir, 'users', { users: [
      { id: 'u-owner', username: 'boss', password: bcrypt.hashSync(PASSWORD, 10), fullName: 'Boss', role: 'Owner', tenantId: 'dft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    ]});
    const gs = await startServer(gateDir, { AUTH_REQUIRED: 'true' });
    gateServer = gs.app;
  });

  afterAll(() => {
    try { fs.rmSync(gateDir, { recursive: true, force: true }); } catch (_) {}
    gateServer = null;
  });

  const GATED_PATHS = [
    '/api/v1/tenant/student-services/rates',
    '/api/v1/tenant/student-services/orders',
    '/api/v1/tenant/student-services/passes',
    '/api/v1/tenant/student-services/settings',
    '/api/v1/tenant/student-services/calculate'
  ];

  test('every student-services read rejects anonymous access with 401', async () => {
    for (const p of GATED_PATHS) {
      const res = await request(gateServer).get(p);
      expect(res.statusCode).toBe(401);
    }
  });

  test('every student-services write rejects anonymous access with 401', async () => {
    const writes = [
      ['post', '/api/v1/tenant/student-services/rates', { paperSize: 'A4', printType: 'bw', duplexType: 'single', pricePerPage: 1 }],
      ['post', '/api/v1/tenant/student-services/orders', { studentPhone: '01000000000', totalPages: 1, copies: 1 }],
      ['post', '/api/v1/tenant/student-services/passes', { studentPhone: '01000000000', month: '2026-09', year: 2026, amount: 50 }],
      ['put', '/api/v1/tenant/student-services/settings', { whatsappNumber: '01000000000' }]
    ];
    for (const [method, p, body] of writes) {
      const res = await request(gateServer)[method](p).send(body);
      expect(res.statusCode).toBe(401);
    }
  });

  test('owner can read rates after login (gate is identity-based, not broken)', async () => {
    const session = await login(gateServer, 'boss', PASSWORD, 'dft');
    const res = await request(gateServer)
      .get('/api/v1/tenant/student-services/rates')
      .set('Authorization', 'Bearer ' + session.accessToken);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('public discovery stays open even when AUTH_REQUIRED=true', async () => {
    const res = await request(gateServer).get('/api/v1/platform-public/sections');
    expect(res.statusCode).toBe(200);
    const student = res.body.data.sections.find((s) => s.id === 'student-services');
    expect(student).toBeTruthy();
    expect(student.status).toBe('active');
  });
});
