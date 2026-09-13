'use strict';

// gamesCatalog.service — Phase 1 unit tests.
//
// Coverage targets (per the Phase 1 task brief):
//   - happy-path CRUD
//   - input validation for every required field
//   - path traversal: literal `..`, encoded `%2e%2e`, absolute paths,
//     Windows drive letters, mixed separators, nested traversal
//   - URL safety: invalid scheme, private/loopback host, malformed URL
//   - tenant isolation: tenant A cannot see / mutate tenant B records
//   - fail-closed behavior when PS4_GAMES_ALLOWED_ROOT is unset
//   - file-system non-interaction: the service NEVER reads local_file_path
//     from disk, it only validates the path string

const fs = require('fs');
const path = require('path');
const { makeTempDataDir, readStore } = require('./helpers/testData');

// All tests in this suite share one temp data dir, set BEFORE the service is
// required so storageAdapter picks it up at first read.
let dataDir;
let service;
const ORIGINAL_ALLOWED_ROOT = process.env.PS4_GAMES_ALLOWED_ROOT;
const ORIGINAL_ALLOW_PRIVATE = process.env.PS4_DOWNLOAD_ALLOW_PRIVATE;

beforeAll(() => {
  dataDir = makeTempDataDir('games-catalog');
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  // Configure a real (existing) allowed root so the happy-path tests can
  // pass a valid relative local_file_path. Using the dataDir itself is
  // fine: the service only validates the path STRING — it never touches
  // the file.
  process.env.PS4_GAMES_ALLOWED_ROOT = dataDir;
  jest.resetModules();
  service = require('../services/gamesCatalog.service');
});

afterAll(() => {
  // Restore original env so other suites are unaffected.
  if (ORIGINAL_ALLOWED_ROOT === undefined) delete process.env.PS4_GAMES_ALLOWED_ROOT;
  else process.env.PS4_GAMES_ALLOWED_ROOT = ORIGINAL_ALLOWED_ROOT;
  if (ORIGINAL_ALLOW_PRIVATE === undefined) delete process.env.PS4_DOWNLOAD_ALLOW_PRIVATE;
  else process.env.PS4_DOWNLOAD_ALLOW_PRIVATE = ORIGINAL_ALLOW_PRIVATE;
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
});

const tenantA = { tenantId: 'tenantA' };
const tenantB = { tenantId: 'tenantB' };

// Auto-incrementing counter so every validPayload() returns a unique
// (tenant_id, title_id) pair — duplicates would trigger the per-tenant
// uniqueness guard in the service. Callers can still override title_id
// explicitly via the overrides argument.
let _titleCounter = 0;
function validPayload(overrides) {
  _titleCounter += 1;
  const seq = String(_titleCounter).padStart(6, '0');
  return Object.assign({
    title: 'God of War',
    title_id: 'CUSA' + seq,
    firmware_required: '7.51',
    size_in_bytes: 45500000000,
    local_file_path: 'gog/cusa' + seq + '.pkg',
    local_download_url: 'https://ps4.example.com/games/cusa' + seq + '.pkg',
    is_available: true
  }, overrides || {});
}

describe('gamesCatalog.service — happy path', () => {
  test('create persists a new record with id, timestamps, and tenant_id', () => {
    const result = service.create({ data: validPayload(), tenantContext: tenantA });
    expect(result.error).toBeUndefined();
    expect(result.game).toBeDefined();
    expect(result.game.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.game.tenant_id).toBe('tenantA');
    expect(result.game.createdAt).toBeTruthy();
    expect(result.game.updatedAt).toBeTruthy();
  });

  test('list returns only the current tenant records', () => {
    service.create({ data: validPayload({ title: 'Spider-Man', title_id: 'CUSA12345' }), tenantContext: tenantA });
    service.create({ data: validPayload({ title: 'Horizon', title_id: 'CUSA10212' }), tenantContext: tenantB });
    const listA = service.list({ tenantContext: tenantA });
    const listB = service.list({ tenantContext: tenantB });
    expect(listA.games.every(g => g.tenant_id === 'tenantA')).toBe(true);
    expect(listB.games.every(g => g.tenant_id === 'tenantB')).toBe(true);
  });

  test('getById returns the matching record for the owning tenant', () => {
    const created = service.create({ data: validPayload({ title_id: 'CUSA77777' }), tenantContext: tenantA }).game;
    const found = service.getById({ id: created.id, tenantContext: tenantA });
    expect(found).toBeDefined();
    expect(found.id).toBe(created.id);
  });

  test('update changes specified fields and bumps updatedAt', async () => {
    const created = service.create({ data: validPayload({ title_id: 'CUSA88888' }), tenantContext: tenantA }).game;
    // Wait long enough for the ISO-millisecond timestamp to advance.
    await new Promise(r => setTimeout(r, 20));
    const res = service.update({ id: created.id, data: { is_available: false }, tenantContext: tenantA });
    expect(res.error).toBeUndefined();
    expect(res.game.is_available).toBe(false);
    expect(res.game.updatedAt).not.toBe(created.updatedAt);
  });

  test('remove deletes the record', () => {
    const created = service.create({ data: validPayload({ title_id: 'CUSA99999' }), tenantContext: tenantA }).game;
    const res = service.remove({ id: created.id, tenantContext: tenantA });
    expect(res.error).toBeUndefined();
    expect(res.success).toBe(true);
    expect(service.getById({ id: created.id, tenantContext: tenantA })).toBeNull();
  });

  test('list supports title substring search, title_id filter, is_available filter, pagination', () => {
    service.create({ data: validPayload({ title: 'FIFA 24', title_id: 'CUSA10001', is_available: true }), tenantContext: tenantA });
    service.create({ data: validPayload({ title: 'FIFA 25', title_id: 'CUSA10002', is_available: false }), tenantContext: tenantA });
    const search = service.list({ query: { q: 'fifa' }, tenantContext: tenantA });
    expect(search.games.every(g => /fifa/i.test(g.title))).toBe(true);
    const byId = service.list({ query: { title_id: 'CUSA10001' }, tenantContext: tenantA });
    expect(byId.games).toHaveLength(1);
    expect(byId.games[0].title_id).toBe('CUSA10001');
    const available = service.list({ query: { is_available: 'false' }, tenantContext: tenantA });
    expect(available.games.every(g => g.is_available === false)).toBe(true);
  });
});

describe('gamesCatalog.service — input validation', () => {
  test('rejects a missing title', () => {
    const res = service.create({ data: validPayload({ title: undefined }), tenantContext: tenantA });
    expect(res.error).toMatch(/title is required/);
  });
  test('rejects a blank title_id', () => {
    const res = service.create({ data: validPayload({ title_id: '   ' }), tenantContext: tenantA });
    expect(res.error).toMatch(/title_id is required/);
  });
  test('rejects a missing firmware_required', () => {
    const res = service.create({ data: validPayload({ firmware_required: '' }), tenantContext: tenantA });
    expect(res.error).toMatch(/firmware_required is required/);
  });
  test('rejects a non-numeric size_in_bytes', () => {
    const res = service.create({ data: validPayload({ size_in_bytes: 'big' }), tenantContext: tenantA });
    expect(res.error).toMatch(/size_in_bytes must be a number/);
  });
  test('rejects a zero size_in_bytes', () => {
    const res = service.create({ data: validPayload({ size_in_bytes: 0 }), tenantContext: tenantA });
    expect(res.error).toMatch(/size_in_bytes must be greater than zero/);
  });
  test('rejects a negative size_in_bytes', () => {
    const res = service.create({ data: validPayload({ size_in_bytes: -1 }), tenantContext: tenantA });
    expect(res.error).toMatch(/size_in_bytes must be greater than zero/);
  });
  test('rejects a non-boolean is_available', () => {
    const res = service.create({ data: validPayload({ is_available: 'yes' }), tenantContext: tenantA });
    expect(res.error).toMatch(/is_available must be a boolean/);
  });
  test('rejects a non-object body', () => {
    const res = service.create({ data: 'oops', tenantContext: tenantA });
    expect(res.error).toMatch(/request body must be a JSON object/);
  });
  test('rejects a duplicate (tenant_id, title_id) pair', () => {
    service.create({ data: validPayload({ title_id: 'CUSA_DUP' }), tenantContext: tenantA });
    const res = service.create({ data: validPayload({ title_id: 'CUSA_DUP' }), tenantContext: tenantA });
    expect(res.error).toMatch(/Duplicate title_id for this tenant/);
  });
});

describe('gamesCatalog.service — path traversal protection', () => {
  test('rejects a literal `..` segment', () => {
    const res = service.create({ data: validPayload({ local_file_path: '../etc/passwd' }), tenantContext: tenantA });
    expect(res.error).toMatch(/path traversal/);
  });
  test('rejects a deeply nested `..` segment', () => {
    const res = service.create({ data: validPayload({ local_file_path: 'a/b/../../../c' }), tenantContext: tenantA });
    expect(res.error).toMatch(/path traversal/);
  });
  test('rejects a percent-encoded traversal', () => {
    const res = service.create({ data: validPayload({ local_file_path: '%2e%2e%2fetc%2fpasswd' }), tenantContext: tenantA });
    expect(res.error).toMatch(/path traversal|outside the allowed root/);
  });
  test('rejects an absolute POSIX path', () => {
    const res = service.create({ data: validPayload({ local_file_path: '/etc/passwd' }), tenantContext: tenantA });
    expect(res.error).toMatch(/relative path|outside the allowed root/);
  });
  test('rejects an absolute Windows path', () => {
    const res = service.create({ data: validPayload({ local_file_path: 'C:\\Windows\\System32' }), tenantContext: tenantA });
    expect(res.error).toMatch(/relative path/);
  });
  test('rejects a Windows drive letter', () => {
    const res = service.create({ data: validPayload({ local_file_path: 'D:/games/pkg' }), tenantContext: tenantA });
    expect(res.error).toMatch(/relative path/);
  });
  test('rejects a NUL byte', () => {
    const res = service.create({ data: validPayload({ local_file_path: 'safe\0../etc' }), tenantContext: tenantA });
    expect(res.error).toMatch(/illegal character/);
  });
  test('rejects a mixed-separator traversal', () => {
    const res = service.create({ data: validPayload({ local_file_path: 'a\\..\\b' }), tenantContext: tenantA });
    expect(res.error).toMatch(/path traversal/);
  });
  test('rejects an overlong path', () => {
    const res = service.create({ data: validPayload({ local_file_path: 'a/'.repeat(600) + 'pkg' }), tenantContext: tenantA });
    expect(res.error).toMatch(/too long/);
  });
  test('accepts a safe relative path under the allowed root', () => {
    const res = service.create({ data: validPayload({ local_file_path: 'ps4/games/cusa11111.pkg' }), tenantContext: tenantA });
    expect(res.error).toBeUndefined();
  });
});

describe('gamesCatalog.service — fail-closed when no allowed root is configured', () => {
  let bareService;
  let bareDir;
  beforeAll(() => {
    bareDir = makeTempDataDir('games-catalog-bare');
    process.env.DIGITRONICS_DATA_DIR = bareDir;
    delete process.env.PS4_GAMES_ALLOWED_ROOT;
    jest.resetModules();
    bareService = require('../services/gamesCatalog.service');
  });
  afterAll(() => {
    process.env.PS4_GAMES_ALLOWED_ROOT = ORIGINAL_ALLOWED_ROOT || dataDir;
    if (bareDir && fs.existsSync(bareDir)) fs.rmSync(bareDir, { recursive: true, force: true });
  });
  test('every local_file_path is rejected when PS4_GAMES_ALLOWED_ROOT is unset', () => {
    const res = bareService.create({ data: validPayload({ local_file_path: 'safe/relative.pkg' }), tenantContext: tenantA });
    expect(res.error).toMatch(/PS4_GAMES_ALLOWED_ROOT is not configured/);
  });
});

describe('gamesCatalog.service — local_download_url validation', () => {
  test('rejects an empty url', () => {
    const res = service.create({ data: validPayload({ local_download_url: '' }), tenantContext: tenantA });
    expect(res.error).toMatch(/local_download_url is required/);
  });
  test('rejects a non-URL string', () => {
    const res = service.create({ data: validPayload({ local_download_url: 'not a url' }), tenantContext: tenantA });
    expect(res.error).toMatch(/valid URL/);
  });
  test('rejects a non-http(s) scheme', () => {
    const res = service.create({ data: validPayload({ local_download_url: 'ftp://example.com/pkg' }), tenantContext: tenantA });
    expect(res.error).toMatch(/http or https/);
  });
  test('rejects a file:// scheme', () => {
    const res = service.create({ data: validPayload({ local_download_url: 'file:///etc/passwd' }), tenantContext: tenantA });
    expect(res.error).toMatch(/http or https/);
  });
  test('rejects a loopback host by default', () => {
    const res = service.create({ data: validPayload({ local_download_url: 'http://127.0.0.1/pkg' }), tenantContext: tenantA });
    expect(res.error).toMatch(/private or loopback host/);
  });
  test('rejects a localhost host by default', () => {
    const res = service.create({ data: validPayload({ local_download_url: 'http://localhost:18080/pkg' }), tenantContext: tenantA });
    expect(res.error).toMatch(/private or loopback host/);
  });
  test('rejects an RFC1918 private host by default', () => {
    const res = service.create({ data: validPayload({ local_download_url: 'http://10.0.0.5/pkg' }), tenantContext: tenantA });
    expect(res.error).toMatch(/private or loopback host/);
  });
  test('accepts a public https URL', () => {
    const res = service.create({ data: validPayload({ local_download_url: 'https://ps4.example.com/cusa12345.pkg' }), tenantContext: tenantA });
    expect(res.error).toBeUndefined();
  });
  test('allows a private host ONLY when PS4_DOWNLOAD_ALLOW_PRIVATE=true', () => {
    const saved = process.env.PS4_DOWNLOAD_ALLOW_PRIVATE;
    process.env.PS4_DOWNLOAD_ALLOW_PRIVATE = 'true';
    try {
      const res = service.create({ data: validPayload({ local_download_url: 'http://10.0.0.7/pkg-allow.pkg' }), tenantContext: tenantA });
      expect(res.error).toBeUndefined();
    } finally {
      if (saved === undefined) delete process.env.PS4_DOWNLOAD_ALLOW_PRIVATE;
      else process.env.PS4_DOWNLOAD_ALLOW_PRIVATE = saved;
    }
  });
});

describe('gamesCatalog.service — tenant isolation', () => {
  test('tenant A cannot read tenant B records by id', () => {
    const created = service.create({ data: validPayload({ title_id: 'CUSA_ISO_A' }), tenantContext: tenantA }).game;
    const found = service.getById({ id: created.id, tenantContext: tenantB });
    expect(found).toBeNull();
  });
  test('tenant A cannot update tenant B records (returns "not found", not 403, to avoid leak)', () => {
    const created = service.create({ data: validPayload({ title_id: 'CUSA_ISO_B' }), tenantContext: tenantA }).game;
    const res = service.update({ id: created.id, data: { is_available: false }, tenantContext: tenantB });
    expect(res.error).toBe('Game not found');
    // Confirm the record is unchanged for the owning tenant.
    const after = service.getById({ id: created.id, tenantContext: tenantA });
    expect(after.is_available).toBe(true);
  });
  test('tenant A cannot delete tenant B records (returns "not found")', () => {
    const created = service.create({ data: validPayload({ title_id: 'CUSA_ISO_C' }), tenantContext: tenantA }).game;
    const res = service.remove({ id: created.id, tenantContext: tenantB });
    expect(res.error).toBe('Game not found');
    expect(service.getById({ id: created.id, tenantContext: tenantA })).toBeDefined();
  });
  test('a foreign tenant_id claim in create is rejected', () => {
    const res = service.create({ data: validPayload({ title_id: 'CUSA_FOREIGN', tenant_id: 'tenantB' }), tenantContext: tenantA });
    expect(res.error).toMatch(/tenant_id claim does not match/);
  });
  test('list with no tenantContext (legacy mode) returns records without filtering', () => {
    service.create({ data: validPayload({ title_id: 'CUSA_LEGACY' }), tenantContext: tenantA });
    const list = service.list({});
    expect(list.total).toBeGreaterThan(0);
  });
  test('list with tenantContext returns ONLY the current tenant', () => {
    service.create({ data: validPayload({ title_id: 'CUSA_A1' }), tenantContext: tenantA });
    service.create({ data: validPayload({ title_id: 'CUSA_B1' }), tenantContext: tenantB });
    const listA = service.list({ tenantContext: tenantA });
    const listB = service.list({ tenantContext: tenantB });
    expect(listA.games.every(g => g.tenant_id === 'tenantA')).toBe(true);
    expect(listB.games.every(g => g.tenant_id === 'tenantB')).toBe(true);
  });
});

describe('gamesCatalog.service — persistence', () => {
  test('create materializes the games_catalog.json store file', () => {
    const existsBefore = fs.existsSync(path.join(dataDir, 'games_catalog.json'));
    expect(existsBefore).toBe(true);
    const raw = readStore(dataDir, 'games_catalog');
    expect(Array.isArray(raw.games)).toBe(true);
  });
  test('the persisted JSON is valid and contains the expected record', () => {
    const created = service.create({ data: validPayload({ title_id: 'CUSA_PERSIST' }), tenantContext: tenantA }).game;
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'games_catalog.json'), 'utf-8'));
    const found = raw.games.find(g => g.id === created.id);
    expect(found).toBeDefined();
    expect(found.title_id).toBe('CUSA_PERSIST');
  });
  test('read of a missing store returns an empty list (does not crash)', () => {
    // A fresh temp dir, no games_catalog.json present.
    const fs2 = require('fs');
    const fresh = makeTempDataDir('games-catalog-fresh');
    process.env.DIGITRONICS_DATA_DIR = fresh;
    jest.resetModules();
    const freshService = require('../services/gamesCatalog.service');
    const res = freshService.list({ tenantContext: tenantA });
    expect(res.games).toEqual([]);
    expect(res.total).toBe(0);
    expect(fs2.existsSync(path.join(fresh, 'games_catalog.json'))).toBe(false);
    fs2.rmSync(fresh, { recursive: true, force: true });
    // Restore data dir so subsequent tests still use the shared temp dir.
    process.env.DIGITRONICS_DATA_DIR = dataDir;
    jest.resetModules();
    service = require('../services/gamesCatalog.service');
  });
});
