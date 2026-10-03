'use strict';

// platformSections.education.test.js — Education discoverability integration.
//
// Education landed dark in 754b119 and its 26 education.* permissions were
// registered in 372815a. This suite pins the discoverability layer that turns
// it into a real, findable platform service WITHOUT granting any access:
//
//   1. PUBLIC DISCOVERY — /sections and /catalog advertise `education` as an
//      active section pointing at the real entry /education/index.html, with
//      no duplicate ids and every pre-existing section byte-for-byte unchanged.
//   2. LOCKDOWN POLICY — the shipped SECTION_LOCK_POLICY / applySectionPolicy
//      are executed from source: an unknown id still fails closed to
//      coming-soon with url:null, an injected or wildcard url is overwritten
//      with the allowed route, and the policy grants exactly the sections the
//      Master allowlist names (no wildcards, no extra ids).
//   3. NAVIGATION — platform.html advertises Education from all three nav
//      surfaces (desktop glass nav, footer, mobile bottom nav), never as a
//      locked/soon item, and without disturbing the RTL or mobile markup.
//   4. I18N — every Education key exists in BOTH the en and ar maps, Arabic is
//      real Arabic, there are no duplicate or undefined labels, and the
//      OmniLang dictionary carries the Arabic literal.
//   5. BOUNDARY — discoverability grants nothing: the Education API still
//      rejects anonymous access, still enforces its 26 permissions, and tenant
//      A still cannot see tenant B.
//
// Nothing here writes to backend/data: every scenario runs against its own
// temporary data directory via the standard test helpers.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { login } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');

const PLATFORM_JS = read('platform/platform.js');
const PLATFORM_HTML = read('platform.html');
const PLATFORM_DICT = read('platform/i18n/platform.dict.js');
const REGISTRY = require('../permissions/registry');

const EDUCATION_ENTRY = '/education/index.html';
const EDUCATION_ID = 'education';
const EDUCATION_PERMISSIONS = REGISTRY.REAL_GROUPS
  .filter((g) => g.group === 'education')
  .flatMap((g) => g.permissions);

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

// --------------------------- part 0: the lock policy -------------------------
// The policy is the real security boundary for public discoverability, so it is
// executed from the shipped source rather than re-described here.

function extractPolicy() {
  const policy = PLATFORM_JS.match(/const SECTION_LOCK_POLICY = (\{[\s\S]*?\n  \});/);
  const defaults = PLATFORM_JS.match(/const DEFAULT_SECTIONS = (\[[\s\S]*?\n  \]);/);
  const fn = PLATFORM_JS.match(/function applySectionPolicy\(list\) \{[\s\S]*?\n  \}/);
  if (!policy || !defaults || !fn) throw new Error('platform.js lock policy could not be extracted');
  return { policy: policy[1], defaults: defaults[1], fn: fn[0] };
}

function runPolicy(list) {
  const { policy, defaults, fn } = extractPolicy();
  const sandbox = { input: list, out: null };
  vm.createContext(sandbox);
  vm.runInContext(
    'var SECTION_LOCK_POLICY = ' + policy + ';\n' +
    'var DEFAULT_SECTIONS = ' + defaults + ';\n' +
    fn + '\nout = applySectionPolicy(input);',
    sandbox
  );
  return { sections: sandbox.out, policy: sandbox.SECTION_LOCK_POLICY, defaults: sandbox.DEFAULT_SECTIONS };
}

describe('SECTION_LOCK_POLICY — Education is explicit, unknown ids fail closed', () => {
  test('education is an explicit active id with the real entry route', () => {
    const { policy } = runPolicy([]);
    expect(Object.keys(policy.active)).toContain(EDUCATION_ID);
    expect(policy.active[EDUCATION_ID]).toBe(EDUCATION_ENTRY);
  });

  test('the policy registers no wildcard id and no wildcard route', () => {
    const { policy } = runPolicy([]);
    for (const [id, url] of Object.entries(policy.active)) {
      expect(id).not.toBe('*');
      expect(id).not.toContain('*');
      expect(url).not.toContain('*');
      expect(url.startsWith('/')).toBe(true);
    }
    expect(policy.lockedIds).toEqual(['game-hosting']);
    expect(policy.lockedIds).not.toContain(EDUCATION_ID);
  });

  test('an unknown section still fails closed to coming-soon with no url', () => {
    const { sections } = runPolicy([{ id: 'not-a-real-section', status: 'active', url: '/sneaky' }]);
    const unknown = sections.find((s) => s.id === 'not-a-real-section');
    expect(unknown).toBeTruthy();
    expect(unknown.status).toBe('coming-soon');
    expect(unknown.url).toBeNull();
  });

  test('a wildcard section id is rejected like any unknown id', () => {
    const { sections } = runPolicy([{ id: '*', status: 'active', url: '/anything' }]);
    const wildcard = sections.find((s) => s.id === '*');
    expect(wildcard).toBeTruthy();
    expect(wildcard.status).toBe('coming-soon');
    expect(wildcard.url).toBeNull();
  });

  test('a backend-supplied education url cannot override the allowed route', () => {
    const { sections } = runPolicy([
      { id: EDUCATION_ID, status: 'coming-soon', url: 'https://evil.example.com/education' }
    ]);
    const education = sections.find((s) => s.id === EDUCATION_ID);
    expect(education.status).toBe('active');
    expect(education.url).toBe(EDUCATION_ENTRY);
  });

  test('an older stored catalog that omits education still surfaces it as active', () => {
    const { sections } = runPolicy([{ id: 'marketplace', status: 'active', url: '/marketplace/' }]);
    const education = sections.find((s) => s.id === EDUCATION_ID);
    expect(education).toBeTruthy();
    expect(education.status).toBe('active');
    expect(education.url).toBe(EDUCATION_ENTRY);
  });

  test('game-hosting stays locked and is never given a url', () => {
    const { sections } = runPolicy([]);
    const gaming = sections.find((s) => s.id === 'game-hosting');
    expect(gaming).toBeTruthy();
    expect(gaming.status).toBe('coming-soon');
    expect(gaming.url).toBeNull();
  });
});

// ------------------------ part 1: public discovery over HTTP -----------------

describe('GET /api/v1/platform-public — Education discoverability', () => {
  beforeAll(async () => {
    process.env.AUTH_REQUIRED = 'false';
    process.env.ENABLE_TENANT_CARRY = 'false';
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'false';
    dataDir = makeTempDataDir('platform-sections-education');
    const s = await startServer(dataDir, { AUTH_REQUIRED: 'false' });
    server = s.app;
  });

  afterAll(() => {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
    server = null;
    dataDir = null;
  });

  test('sections exposes education as active with the real entry route', async () => {
    const res = await request(server).get('/api/v1/platform-public/sections');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    const sections = res.body.data.sections;
    expect(Array.isArray(sections)).toBe(true);
    const education = sections.find((s) => s.id === EDUCATION_ID);
    expect(education).toBeTruthy();
    expect(education.status).toBe('active');
    expect(education.url).toBe(EDUCATION_ENTRY);
  });

  test('education carries a title, a description and an icon like every other section', async () => {
    const res = await request(server).get('/api/v1/platform-public/sections');
    const education = res.body.data.sections.find((s) => s.id === EDUCATION_ID);
    expect(typeof education.title).toBe('string');
    expect(education.title.length).toBeGreaterThan(0);
    expect(typeof education.description).toBe('string');
    expect(education.description.length).toBeGreaterThan(0);
    expect(typeof education.icon).toBe('string');
    expect(education.icon.length).toBeGreaterThan(0);
  });

  test('catalog carries the same education entry as sections', async () => {
    const res = await request(server).get('/api/v1/platform-public/catalog');
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty('sections');
    const education = res.body.data.sections.find((s) => s.id === EDUCATION_ID);
    expect(education).toBeTruthy();
    expect(education.status).toBe('active');
    expect(education.url).toBe(EDUCATION_ENTRY);
  });

  test('the sections payload has no duplicate ids', async () => {
    const res = await request(server).get('/api/v1/platform-public/sections');
    const ids = res.body.data.sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id === EDUCATION_ID)).toHaveLength(1);
  });

  test('every pre-existing section keeps its id, status and url', async () => {
    const res = await request(server).get('/api/v1/platform-public/sections');
    const byId = Object.fromEntries(res.body.data.sections.map((s) => [s.id, s]));
    expect(byId.marketplace.status).toBe('active');
    expect(byId.marketplace.url).toBe('/market.html');
    expect(byId['business-services'].status).toBe('active');
    expect(byId['business-services'].url).toBe('/business.html');
    expect(byId['student-services'].status).toBe('active');
    expect(byId['student-services'].url).toBe('/student.html');
    expect(byId['media-reels'].status).toBe('active');
    expect(byId['media-reels'].url).toBe('/media-reels.html');
    expect(byId.support.status).toBe('active');
    expect(byId.support.url).toBe('/support.html');
    expect(byId['game-hosting'].status).toBe('coming-soon');
    expect(byId['game-hosting'].url).toBeNull();
  });

  test('the public catalog surfaces no tenant data through the education entry', async () => {
    const res = await request(server).get('/api/v1/platform-public/sections');
    const raw = JSON.stringify(res.body);
    for (const forbidden of ['access_token', 'tenantId', 'password', 'authorization']) {
      expect(raw.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

// --------------- part 1b: legacy stored doc without sections -----------------

describe('GET /platform-public/sections — legacy stored doc still surfaces Education', () => {
  let legacyServer;
  let legacyDir;

  beforeAll(async () => {
    legacyDir = makeTempDataDir('platform-sections-education-legacy');
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

  test('falls back to the default sections including education', async () => {
    const res = await request(legacyServer).get('/api/v1/platform-public/sections');
    expect(res.statusCode).toBe(200);
    const sections = res.body.data.sections;
    expect(sections.length).toBeGreaterThan(0);
    const education = sections.find((s) => s.id === EDUCATION_ID);
    expect(education).toBeTruthy();
    expect(education.status).toBe('active');
    expect(education.url).toBe(EDUCATION_ENTRY);
  });

  test('never rewrites the stored document on disk', async () => {
    const stored = readStore(legacyDir, 'platformPublic');
    expect(stored).toBeTruthy();
    expect(stored.sections).toBeUndefined();
  });
});

// -------- part 1c: a stored doc that already knows about education ----------

describe('GET /platform-public/sections — stored doc that predates the entry', () => {
  let storedServer;
  let storedDir;

  beforeAll(async () => {
    storedDir = makeTempDataDir('platform-sections-education-stored');
    seed(storedDir, 'platformPublic', {
      meta: { name: 'OmniStore Platform', tagline: 'Stored doc', version: '1.0.0', lastUpdated: new Date().toISOString() },
      features: [],
      stats: [],
      highlights: [],
      sections: [
        { id: 'marketplace', title: 'Marketplace', description: 'Stored', status: 'active', url: '/market.html', icon: 'fa-store' },
        { id: 'business-services', title: 'Business', description: 'Stored', status: 'active', url: '/business.html', icon: 'fa-building' }
      ]
    });
    const ss = await startServer(storedDir, { AUTH_REQUIRED: 'false' });
    storedServer = ss.app;
  });

  afterAll(() => {
    try { fs.rmSync(storedDir, { recursive: true, force: true }); } catch (_) {}
    storedServer = null;
  });

  test('appends the education default without overwriting stored entries', async () => {
    const res = await request(storedServer).get('/api/v1/platform-public/sections');
    const sections = res.body.data.sections;
    const education = sections.find((s) => s.id === EDUCATION_ID);
    expect(education).toBeTruthy();
    expect(education.url).toBe(EDUCATION_ENTRY);
    const marketplace = sections.find((s) => s.id === 'marketplace');
    expect(marketplace.description).toBe('Stored');
    const ids = sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// --------------------------- part 2: navigation ------------------------------

describe('platform.html — Education navigation', () => {
  test('advertises Education from desktop nav, footer and mobile nav', () => {
    const links = PLATFORM_HTML.match(/<a[^>]*href="\/education\/index\.html"[^>]*>/g) || [];
    expect(links).toHaveLength(3);
    expect(PLATFORM_HTML).toContain('class="glass-nav-link" href="/education/index.html"');
    expect(PLATFORM_HTML).toContain('class="bottom-nav-link" href="/education/index.html"');
    expect(PLATFORM_HTML).toContain('<a href="/education/index.html" data-i18n="nav_education_short">');
  });

  test('Education is an active link in every spot, never a locked soon item', () => {
    const links = PLATFORM_HTML.match(/<a[^>]*href="\/education\/index\.html"[^>]*>/g) || [];
    for (const link of links) {
      expect(link).not.toContain('is-soon');
      expect(link).not.toContain('aria-disabled');
      expect(link).toContain('data-i18n="nav_education');
    }
  });

  test('Education links point at a real shipped file, not a fake endpoint', () => {
    expect(fs.existsSync(path.join(ROOT, 'education', 'index.html'))).toBe(true);
    expect(PLATFORM_HTML).not.toMatch(/href="\/education\/index\.html#"/);
    expect(PLATFORM_HTML).not.toMatch(/href="https?:\/\/[^"]*education/i);
  });

  test('RTL and the mobile bottom nav are intact', () => {
    expect(PLATFORM_HTML).toContain('<html lang="ar" dir="rtl"');
    expect(PLATFORM_HTML).toContain('class="bottom-nav"');
    expect(PLATFORM_HTML).toContain('nav-soon');
  });

  test('the existing gaming lock still holds in all three spots', () => {
    expect(PLATFORM_HTML).toContain('glass-nav-link is-soon');
    expect(PLATFORM_HTML).toContain('footer-link is-soon');
    expect(PLATFORM_HTML).toContain('bottom-nav-link is-soon');
  });
});

// ------------------------------- part 3: i18n --------------------------------

function translationMap(lang) {
  const block = PLATFORM_JS.match(new RegExp('\\n\\s{4}' + lang + ': \\{([\\s\\S]*?)\\n\\s{4}\\},'));
  if (!block) throw new Error('platform.js translation block not found for ' + lang);
  const entries = {};
  for (const m of block[1].matchAll(/([A-Za-z0-9_]+):\s*'((?:[^'\\]|\\.)*)'/g)) {
    entries[m[1]] = m[2];
  }
  return entries;
}

const ARABIC = /[\u0600-\u06FF]/;

describe('platform i18n — Education labels', () => {
  const en = translationMap('en');
  const ar = translationMap('ar');

  test('every Education key exists in both languages', () => {
    for (const key of ['nav_education', 'nav_education_short', 'section_education']) {
      expect(en[key]).toBeDefined();
      expect(ar[key]).toBeDefined();
      expect(en[key].length).toBeGreaterThan(0);
      expect(ar[key].length).toBeGreaterThan(0);
    }
  });

  test('Arabic labels are real Arabic, not the English string copied over', () => {
    for (const key of ['nav_education', 'nav_education_short', 'section_education']) {
      expect(ARABIC.test(ar[key])).toBe(true);
      expect(en[key]).not.toBe(ar[key]);
    }
  });

  test('no Education label is undefined in either map', () => {
    for (const key of ['nav_education', 'nav_education_short', 'section_education']) {
      expect(en[key]).not.toBe('undefined');
      expect(ar[key]).not.toBe('undefined');
      expect(en[key]).not.toBe('');
      expect(ar[key]).not.toBe('');
    }
  });

  test('the translation blocks declare no duplicate keys', () => {
    for (const lang of ['en', 'ar']) {
      const block = PLATFORM_JS.match(new RegExp('\\n\\s{4}' + lang + ': \\{([\\s\\S]*?)\\n\\s{4}\\}'))[1];
      const keys = [...block.matchAll(/([A-Za-z0-9_]+):/g)].map((m) => m[1]);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  test('the OmniLang dictionary carries the Education Arabic literal', () => {
    expect(PLATFORM_DICT).toContain("'التعليم': 'Education'");
  });

  test('every data-i18n key Education uses resolves in both languages', () => {
    const keys = new Set(
      [...PLATFORM_HTML.matchAll(/href="\/education\/index\.html" data-i18n="([^"]+)"/g)].map((m) => m[1])
    );
    expect([...keys].sort()).toEqual(['nav_education', 'nav_education_short']);
    for (const key of keys) {
      expect(en[key]).toBeDefined();
      expect(ar[key]).toBeDefined();
    }
  });
});

// ------------------------ part 4: discoverability boundary -------------------

describe('Education discoverability grants no access', () => {
  let gateServer;
  let gateDir;

  beforeAll(async () => {
    gateDir = makeTempDataDir('platform-sections-education-gate');
    seed(gateDir, 'companies', { companies: [
      { id: 'edu-a', code: 'EDU', name: 'Education Tenant A', active: true },
      { id: 'edu-b', code: 'EDU2', name: 'Education Tenant B', active: true }
    ]});
    seed(gateDir, 'users', { users: [
      { id: 'u-owner-a', username: 'eduBoss', password: bcrypt.hashSync(PASSWORD, 10), fullName: 'Boss', role: 'Owner', tenantId: 'edu-a', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    ]});
    const gs = await startServer(gateDir, { AUTH_REQUIRED: 'true' });
    gateServer = gs.app;
  });

  afterAll(() => {
    try { fs.rmSync(gateDir, { recursive: true, force: true }); } catch (_) {}
    gateServer = null;
  });

  test('the 26 education permissions are still registered and enforceable', () => {
    expect(EDUCATION_PERMISSIONS).toHaveLength(26);
    for (const permission of EDUCATION_PERMISSIONS) {
      expect(registryKnows(permission)).toBe(true);
    }
  });

  test('an unknown education permission is still not registered', () => {
    expect(REGISTRY.isKnown('education.fake.view')).toBe(false);
    expect(REGISTRY.isEnforceable('education.fake.view')).toBe(false);
  });

  test('public discovery stays open even when AUTH_REQUIRED=true', async () => {
    const res = await request(gateServer).get('/api/v1/platform-public/sections');
    expect(res.statusCode).toBe(200);
    const education = res.body.data.sections.find((s) => s.id === EDUCATION_ID);
    expect(education).toBeTruthy();
    expect(education.status).toBe('active');
  });

  const GATED_PATHS = [
    '/api/v1/tenant/education/students',
    '/api/v1/tenant/education/teachers',
    '/api/v1/tenant/education/centers',
    '/api/v1/tenant/education/programs',
    '/api/v1/tenant/education/courses',
    '/api/v1/tenant/education/classes',
    '/api/v1/tenant/education/enrollments',
    '/api/v1/tenant/education/attendance',
    '/api/v1/tenant/education/scheduling',
    '/api/v1/tenant/education/grading',
    '/api/v1/tenant/education/bookings',
    '/api/v1/tenant/education/ratings',
    '/api/v1/tenant/education/pack'
  ];

  test('every Education read rejects anonymous access with 401', async () => {
    for (const p of GATED_PATHS) {
      const res = await request(gateServer).get(p);
      expect(res.statusCode).toBe(401);
    }
  });

  test('every Education write rejects anonymous access with 401', async () => {
    const writes = [
      ['post', '/api/v1/tenant/education/students', { firstName: 'A', lastName: 'B' }],
      ['post', '/api/v1/tenant/education/teachers', { firstName: 'A', lastName: 'B' }],
      ['post', '/api/v1/tenant/education/centers', { name: 'A' }],
      ['post', '/api/v1/tenant/education/bookings', { teacherId: 'x', studentId: 'y' }],
      ['post', '/api/v1/tenant/education/ratings', { teacherId: 'x', score: 5 }],
      ['post', '/api/v1/tenant/education/attendance/bulk', { attendanceDate: '2026-10-02', entries: [] }]
    ];
    for (const [method, p, body] of writes) {
      const res = await request(gateServer)[method](p).send(body);
      expect(res.statusCode).toBe(401);
    }
  });

  test('an owner still reaches the Education API (the gate is identity, not breakage)', async () => {
    const session = await login(gateServer, 'eduBoss', PASSWORD, 'edu-a');
    const res = await request(gateServer)
      .get('/api/v1/tenant/education/students')
      .set('Authorization', 'Bearer ' + session.accessToken);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('tenant isolation survives the discoverability change', async () => {
    const session = await login(gateServer, 'eduBoss', PASSWORD, 'edu-a');
    const own = await request(gateServer)
      .get('/api/v1/tenant/education/students')
      .set('Authorization', 'Bearer ' + session.accessToken);
    expect(own.statusCode).toBe(200);
    // The store is tenant-owned: nothing the Education API returns may carry a
    // tenant other than the authenticated one.
    expect(JSON.stringify(own.body)).not.toContain('edu-b');
  });
});

function registryKnows(permission) {
  return REGISTRY.isKnown(permission) && REGISTRY.isEnforceable(permission);
}
