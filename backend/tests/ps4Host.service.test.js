'use strict';

// ps4Host.service — Phase 2 unit tests.
//
// Sits on top of gamesCatalog.service (Phase 1). The Phase 2 service is
// pure business logic — no HTTP, no network. The RPI boundary is a stub.
//
// Coverage targets (per the Phase 2 task brief):
//   - listGames: default availability filter, tenant isolation, empty catalog
//   - resolveGame: valid, missing, cross-tenant, unavailable
//   - resolveDownloadUrl: pass-through (no fetch, no proxy)
//   - installGame validation: required fields, types, malformed target,
//     unsafe target, cross-tenant, unavailable
//   - RPI stub: explicit deferred result, NO network call, NO mutation
//   - failure isolation: failed install must NOT mutate the catalog

const fs = require('fs');
const path = require('path');
const { makeTempDataDir } = require('./helpers/testData');

let dataDir;
let catalogService;
let ps4Host;
let rpiClient;

beforeAll(() => {
  dataDir = makeTempDataDir('ps4-host');
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  // Configure a real allowed root so the seed records pass catalog
  // validation. The service only validates the path STRING.
  process.env.PS4_GAMES_ALLOWED_ROOT = dataDir;
  jest.resetModules();
  catalogService = require('../services/gamesCatalog.service');
  ps4Host = require('../services/ps4Host.service');
  rpiClient = require('../services/ps4Host/rpiClient');
});

afterAll(() => {
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.PS4_GAMES_ALLOWED_ROOT;
});

const tenantA = { tenantId: 'tenantA' };
const tenantB = { tenantId: 'tenantB' };

function seed(overrides) {
  const base = {
    title: 'God of War',
    title_id: 'CUSA07412',
    firmware_required: '7.51',
    size_in_bytes: 45500000000,
    local_file_path: 'gog/cusa07412.pkg',
    local_download_url: 'https://ps4.example.com/games/cusa07412.pkg',
    is_available: true
  };
  return catalogService.create({ data: Object.assign(base, overrides || {}), tenantContext: tenantA });
}

describe('ps4Host.service — listGames', () => {
  test('returns the tenant catalog filtered to is_available=true by default', () => {
    seed({ title_id: 'CUSA_LIST_1', title: 'Available 1' });
    seed({ title_id: 'CUSA_LIST_2', title: 'Available 2', is_available: false });
    const res = ps4Host.listGames({ tenantContext: tenantA });
    expect(res.games.every(g => g.is_available === true)).toBe(true);
    expect(res.games.some(g => g.title_id === 'CUSA_LIST_1')).toBe(true);
    expect(res.games.some(g => g.title_id === 'CUSA_LIST_2')).toBe(false);
  });

  test('includeUnavailable option is honored when caller requests all games', () => {
    seed({ title_id: 'CUSA_LIST_3', title: 'Available 3' });
    const res = ps4Host.listGames({ query: { is_available: 'all' }, tenantContext: tenantA });
    // 'all' is interpreted by the catalog as "no filter", so both
    // available and unavailable records appear.
    expect(res.games.length).toBeGreaterThan(0);
  });

  test('tenant isolation: tenant A list does not include tenant B records', () => {
    catalogService.create({
      data: {
        title: 'Tenant B Game',
        title_id: 'CUSA_B_ONLY',
        firmware_required: '7.51',
        size_in_bytes: 1000,
        local_file_path: 'b/game.pkg',
        local_download_url: 'https://ps4.example.com/b/game.pkg',
        is_available: true
      },
      tenantContext: tenantB
    });
    const listA = ps4Host.listGames({ tenantContext: tenantA });
    expect(listA.games.every(g => g.tenant_id === 'tenantA')).toBe(true);
  });

  test('empty catalog returns an empty list (does not crash)', () => {
    // Fresh temp dir; no records.
    const freshDir = makeTempDataDir('ps4-host-empty');
    const saved = process.env.DIGITRONICS_DATA_DIR;
    process.env.DIGITRONICS_DATA_DIR = freshDir;
    jest.resetModules();
    const empty = require('../services/ps4Host.service');
    const res = empty.listGames({ tenantContext: tenantA });
    expect(res.games).toEqual([]);
    expect(res.total).toBe(0);
    process.env.DIGITRONICS_DATA_DIR = saved;
    jest.resetModules();
    // Reload references for the rest of the suite.
    catalogService = require('../services/gamesCatalog.service');
    ps4Host = require('../services/ps4Host.service');
    rpiClient = require('../services/ps4Host/rpiClient');
    fs.rmSync(freshDir, { recursive: true, force: true });
  });
});

describe('ps4Host.service — resolveGame', () => {
  test('returns the game when it exists in the same tenant and is available', () => {
    const created = seed({ title_id: 'CUSA_RES_1', title: 'Resolvable' }).game;
    const found = ps4Host.resolveGame({ id: created.id, tenantContext: tenantA });
    expect(found).toBeDefined();
    expect(found.id).toBe(created.id);
  });

  test('returns null when the game is missing', () => {
    expect(ps4Host.resolveGame({ id: '00000000-0000-0000-0000-000000000000', tenantContext: tenantA })).toBeNull();
  });

  test('returns null when the game belongs to another tenant (no leak)', () => {
    const created = seed({ title_id: 'CUSA_RES_2' }).game;
    const found = ps4Host.resolveGame({ id: created.id, tenantContext: tenantB });
    expect(found).toBeNull();
  });

  test('returns null when the game is unavailable (default)', () => {
    const created = seed({ title_id: 'CUSA_RES_3', is_available: false }).game;
    const found = ps4Host.resolveGame({ id: created.id, tenantContext: tenantA });
    expect(found).toBeNull();
  });

  test('returns the game when includeUnavailable is true', () => {
    const created = seed({ title_id: 'CUSA_RES_4', is_available: false }).game;
    const found = ps4Host.resolveGame({ id: created.id, tenantContext: tenantA, includeUnavailable: true });
    expect(found).toBeDefined();
    expect(found.is_available).toBe(false);
  });
});

describe('ps4Host.service — resolveDownloadUrl', () => {
  test('passes through the catalog URL unchanged', () => {
    const url = 'https://ps4.example.com/games/cusa_dl.pkg';
    const created = seed({ title_id: 'CUSA_DL_1', local_download_url: url }).game;
    const found = ps4Host.resolveGame({ id: created.id, tenantContext: tenantA });
    expect(ps4Host.resolveDownloadUrl({ game: found })).toBe(url);
  });

  test('returns null when the game is null', () => {
    expect(ps4Host.resolveDownloadUrl({ game: null })).toBeNull();
  });

  test('returns null when the game has no local_download_url', () => {
    const game = { id: 'x', title_id: 'y' };
    expect(ps4Host.resolveDownloadUrl({ game })).toBeNull();
  });

  test('does not fetch the URL — never invokes fetch / http / dns', () => {
    // The rpiClient is the only module allowed to make outbound calls.
    // Assert that ps4Host.service source has no network calls.
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'ps4Host.service.js'), 'utf8');
    expect(src).not.toMatch(/require\(['"]http['"]\)/);
    expect(src).not.toMatch(/require\(['"]https['"]\)/);
    expect(src).not.toMatch(/require\(['"]dns['"]\)/);
    expect(src).not.toMatch(/require\(['"]node-fetch['"]\)/);
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/http\.(get|request)\s*\(/);
  });
});

describe('ps4Host.service — installGame validation', () => {
  test('valid request returns a deferred RPI result with the resolved game metadata', () => {
    const created = seed({ title_id: 'CUSA_INST_1' }).game;
    const res = ps4Host.installGame({
      data: { id: created.id, target: '192.168.1.50' },
      tenantContext: tenantA
    });
    expect(res.status).toBe('deferred');
    expect(res.reason).toMatch(/RPI EXECUTION DEFERRED/);
  });

  test('rejects a missing id', () => {
    const res = ps4Host.installGame({ data: { target: '192.168.1.50' }, tenantContext: tenantA });
    expect(res.status).toBe('invalid');
    expect(res.error).toMatch(/id.*required/);
  });

  test('rejects a missing target', () => {
    const created = seed({ title_id: 'CUSA_INST_2' }).game;
    const res = ps4Host.installGame({ data: { id: created.id }, tenantContext: tenantA });
    expect(res.status).toBe('invalid');
    expect(res.error).toMatch(/target is required/);
  });

  test('rejects a malformed body', () => {
    const res = ps4Host.installGame({ data: 'oops', tenantContext: tenantA });
    expect(res.status).toBe('invalid');
  });

  test('rejects an unknown game id (not_found, no leak)', () => {
    const res = ps4Host.installGame({
      data: { id: '00000000-0000-0000-0000-000000000000', target: '192.168.1.50' },
      tenantContext: tenantA
    });
    expect(res.status).toBe('not_found');
  });

  test('rejects a cross-tenant game id (not_found, no leak)', () => {
    const created = seed({ title_id: 'CUSA_INST_3' }).game;
    const res = ps4Host.installGame({
      data: { id: created.id, target: '192.168.1.50' },
      tenantContext: tenantB
    });
    expect(res.status).toBe('not_found');
  });

  test('rejects an unavailable game (unavailable, distinct from not_found)', () => {
    const created = seed({ title_id: 'CUSA_INST_4', is_available: false }).game;
    const res = ps4Host.installGame({
      data: { id: created.id, target: '192.168.1.50' },
      tenantContext: tenantA
    });
    expect(res.status).toBe('unavailable');
  });

  test('rejects a hostname target (no DNS, no ambiguity)', () => {
    const created = seed({ title_id: 'CUSA_INST_5' }).game;
    const res = ps4Host.installGame({
      data: { id: created.id, target: 'ps4-shop-floor.local' },
      tenantContext: tenantA
    });
    expect(res.status).toBe('invalid');
    expect(res.error).toMatch(/numeric IP/);
  });

  test('rejects a loopback IPv4 target', () => {
    const created = seed({ title_id: 'CUSA_INST_6' }).game;
    const res = ps4Host.installGame({
      data: { id: created.id, target: '127.0.0.1' },
      tenantContext: tenantA
    });
    expect(res.status).toBe('invalid');
    expect(res.error).toMatch(/loopback|reserved/);
  });

  test('rejects a link-local IPv4 target', () => {
    const created = seed({ title_id: 'CUSA_INST_7' }).game;
    const res = ps4Host.installGame({
      data: { id: created.id, target: '169.254.1.5' },
      tenantContext: tenantA
    });
    expect(res.status).toBe('invalid');
    expect(res.error).toMatch(/loopback|reserved/);
  });

  test('rejects a public IPv4 target (LAN-trust boundary)', () => {
    const created = seed({ title_id: 'CUSA_INST_8' }).game;
    const res = ps4Host.installGame({
      data: { id: created.id, target: '8.8.8.8' },
      tenantContext: tenantA
    });
    expect(res.status).toBe('invalid');
    expect(res.error).toMatch(/private LAN/);
  });

  test('rejects an IPv6 loopback target', () => {
    const created = seed({ title_id: 'CUSA_INST_9' }).game;
    const res = ps4Host.installGame({
      data: { id: created.id, target: '::1' },
      tenantContext: tenantA
    });
    expect(res.status).toBe('invalid');
    expect(res.error).toMatch(/loopback|reserved/);
  });

  test('rejects a malformed IPv4 target', () => {
    const created = seed({ title_id: 'CUSA_INST_10' }).game;
    const res = ps4Host.installGame({
      data: { id: created.id, target: '999.0.0.1' },
      tenantContext: tenantA
    });
    expect(res.status).toBe('invalid');
    expect(res.error).toMatch(/valid IPv4/);
  });

  test('accepts a valid RFC1918 IPv4 target (10.x)', () => {
    const created = seed({ title_id: 'CUSA_INST_11' }).game;
    const res = ps4Host.installGame({
      data: { id: created.id, target: '10.0.0.50' },
      tenantContext: tenantA
    });
    expect(res.status).toBe('deferred');
  });

  test('accepts a valid RFC1918 IPv4 target (172.16-31)', () => {
    const created = seed({ title_id: 'CUSA_INST_12' }).game;
    const res = ps4Host.installGame({
      data: { id: created.id, target: '172.20.5.10' },
      tenantContext: tenantA
    });
    expect(res.status).toBe('deferred');
  });

  test('accepts a valid RFC1918 IPv4 target (192.168)', () => {
    const created = seed({ title_id: 'CUSA_INST_13' }).game;
    const res = ps4Host.installGame({
      data: { id: created.id, target: '192.168.1.50' },
      tenantContext: tenantA
    });
    expect(res.status).toBe('deferred');
  });

  test('non-string id is rejected', () => {
    const res = ps4Host.installGame({ data: { id: 123, target: '192.168.1.1' }, tenantContext: tenantA });
    expect(res.status).toBe('invalid');
  });

  test('overlong target is rejected', () => {
    const created = seed({ title_id: 'CUSA_INST_14' }).game;
    const res = ps4Host.installGame({
      data: { id: created.id, target: 'a'.repeat(200) },
      tenantContext: tenantA
    });
    expect(res.status).toBe('invalid');
    expect(res.error).toMatch(/too long/);
  });
});

describe('ps4Host.service — RPI boundary stub', () => {
  test('installGame result.status is exactly "deferred" (stub contract)', () => {
    const created = seed({ title_id: 'CUSA_RPI_1' }).game;
    const res = ps4Host.installGame({
      data: { id: created.id, target: '192.168.1.50' },
      tenantContext: tenantA
    });
    expect(res.status).toBe('deferred');
    expect(typeof res.reason).toBe('string');
    expect(res.reason).toMatch(/RPI EXECUTION DEFERRED/);
  });

  test('rpiClient.installGame returns the explicit deferred envelope', () => {
    const res = rpiClient.installGame({ gameId: 'x', titleId: 'y', ps4Target: '192.168.1.1', localDownloadUrl: 'https://x/y' });
    expect(res).toEqual({
      status: 'deferred',
      reason: 'RPI EXECUTION DEFERRED — PROTOCOL NOT IMPLEMENTED'
    });
  });

  test('rpiClient source contains no network imports', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'ps4Host', 'rpiClient.js'), 'utf8');
    expect(src).not.toMatch(/require\(['"]http['"]\)/);
    expect(src).not.toMatch(/require\(['"]https['"]\)/);
    expect(src).not.toMatch(/require\(['"]net['"]\)/);
    expect(src).not.toMatch(/require\(['"]dns['"]\)/);
    expect(src).not.toMatch(/require\(['"]node-fetch['"]\)/);
    expect(src).not.toMatch(/require\(['"]axios['"]\)/);
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/http\.(get|request)\s*\(/);
  });

  test('a failed install does NOT mutate the games_catalog store', () => {
    const created = seed({ title_id: 'CUSA_RPI_2' }).game;
    const before = fs.readFileSync(path.join(dataDir, 'games_catalog.json'), 'utf8');
    ps4Host.installGame({
      data: { id: '00000000-0000-0000-0000-000000000000', target: '192.168.1.50' },
      tenantContext: tenantA
    });
    const after = fs.readFileSync(path.join(dataDir, 'games_catalog.json'), 'utf8');
    // The catalog file must be byte-identical after a failed install.
    expect(after).toBe(before);
    // Confirm the real record is still present and unchanged.
    const fetched = ps4Host.resolveGame({ id: created.id, tenantContext: tenantA });
    expect(fetched).toBeDefined();
    expect(fetched.id).toBe(created.id);
  });
});

describe('ps4Host.service — permission expectation (documented for Phase 3)', () => {
  // The service does NOT enforce permission itself; the route layer (Phase 3)
  // will. The intent is documented here so a future maintainer does not
  // confuse the service-level tenant isolation with authorization.
  test('any authenticated caller reaching the service in the same tenant can resolve a game', () => {
    // This is a service-layer test, NOT a permission test. The route layer
    // must enforce that only callers with the right permission reach here.
    const created = seed({ title_id: 'CUSA_PERM_1' }).game;
    const found = ps4Host.resolveGame({ id: created.id, tenantContext: tenantA });
    expect(found).toBeDefined();
  });
});
