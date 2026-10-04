'use strict';

// Online Games — discoverability, catalog registration and license attribution.
//
// The roster cycle shipped the section (46 SAFE games, cross-origin frames,
// GAMES_ORIGIN, the roster gate) without registering it on the platform's own
// discovery surfaces. This suite pins that follow-up:
//
//   1. SECTION_LOCK_POLICY / DEFAULT_SECTIONS advertise the section at the one
//      final route /online-games/index.html, and the policy keeps overriding
//      any injected url (so a legacy /online-games.html can never surface).
//   2. GET /api/v1/platform-public/sections and /catalog carry the same entry,
//      which is what the dashboard services grid renders through
//      applySectionPolicy().
//   3. EN and AR navigation labels exist for all three surfaces, including the
//      short footer/bottom label and the section card title.
//   4. The license attribution page lists exactly the 46 roster games — no
//      withheld id, no blocked asset — and the catalog page links to it.
//   5. Nothing here reopens the roster cycle's security decisions: frame-src
//      stays TikTok + GAMES_ORIGIN (never 'self'), the frame sandbox stays the
//      four tokens, and the Monetag boundary stays disabled.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const SECTION_ID = 'online-games';
const ROUTE = '/online-games/index.html';
const LEGACY_ROUTE = '/online-games.html';
const BLOCKED_IDS = ['survivors', 'holdtheline', 'snakesurvivors'];
const NAV_KEYS = ['nav_online_games', 'nav_online_games_short', 'section_online_games'];

const PLATFORM_JS = read('platform/platform.js');
const PLATFORM_HTML = read('platform.html');
const CATALOG_SRC = read('backend/services/platformCatalog.service.js');
const SERVER_JS = read('backend/server.js');
const NGINX_CONF = read('nginx.conf');
const INDEX_HTML = read('online-games/index.html');
const LICENSES_HTML = read('online-games/licenses.html');
const CONFIG_JS = read('online-games/js/config.js');
const ROSTER = JSON.parse(read('online-games/ROSTER.json'));
const GATE = JSON.parse(read('online-games/ROSTER_GATE.json'));

let app;
let dataDir;

registerCleanup(() => [], () => [dataDir]);

afterAll(() => {
  delete process.env.DIGITRONICS_DATA_DIR;
});

// ---------------------------------------------------------------------------
// 1. The lockdown policy, executed from the shipped source
// ---------------------------------------------------------------------------

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
  return sandbox.out;
}

describe('platform.js registers Online Games at the final route', () => {
  test('the lockdown policy allows the section with the final route', () => {
    const { policy } = extractPolicy();
    const parsed = vm.runInNewContext('(' + policy + ')');
    expect(parsed.active[SECTION_ID]).toBe(ROUTE);
    expect(Object.keys(parsed.active)).not.toContain('*');
    for (const [id, url] of Object.entries(parsed.active)) {
      expect(id).not.toContain('*');
      expect(url).not.toContain('*');
      expect(url.startsWith('/')).toBe(true);
      expect(url).not.toBe(LEGACY_ROUTE);
    }
  });

  test('the fallback catalog carries an active entry for the section', () => {
    const { defaults } = extractPolicy();
    const list = vm.runInNewContext('(' + defaults + ')');
    const entry = list.find((s) => s.id === SECTION_ID);
    expect(entry).toBeTruthy();
    expect(entry.status).toBe('active');
    expect(entry.url).toBe(ROUTE);
    expect(entry.title).toBe('Online Games');
    expect(entry.description.length).toBeGreaterThan(0);
    expect(entry.icon.length).toBeGreaterThan(0);
  });

  test('the dashboard services grid surfaces it as an open card', () => {
    const sections = runPolicy([]);
    const card = sections.find((s) => s.id === SECTION_ID);
    expect(card).toBeTruthy();
    expect(card.status).toBe('active');
    expect(card.url).toBe(ROUTE);
  });

  test('an injected legacy or foreign url is overwritten by the policy', () => {
    for (const injected of [LEGACY_ROUTE, '/games/index.html', 'https://evil.example.com/x']) {
      const card = runPolicy([{ id: SECTION_ID, status: 'active', url: injected }]).find(
        (s) => s.id === SECTION_ID
      );
      expect(card.status).toBe('active');
      expect(card.url).toBe(ROUTE);
    }
  });

  test('Game Hosting is untouched: still locked, still without a url', () => {
    const { policy } = extractPolicy();
    const parsed = vm.runInNewContext('(' + policy + ')');
    expect(parsed.lockedIds).toContain('game-hosting');
    expect(parsed.active['game-hosting']).toBeUndefined();
    const card = runPolicy([]).find((s) => s.id === 'game-hosting');
    expect(card.status).toBe('coming-soon');
    expect(card.url).toBeNull();
  });

  test('no withheld id is registered on any policy surface', () => {
    const { policy, defaults } = extractPolicy();
    const parsed = vm.runInNewContext('(' + policy + ')');
    const list = vm.runInNewContext('(' + defaults + ')');
    const surfaces = [
      ...Object.keys(parsed.active),
      ...parsed.lockedIds,
      ...list.map((s) => s.id),
      ...list.map((s) => s.url || '')
    ].join(' ');
    for (const id of BLOCKED_IDS) {
      expect(surfaces.includes(id)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. EN / AR navigation labels
// ---------------------------------------------------------------------------

describe('EN and AR labels for the section', () => {
  test('every navigation key exists in both language maps', () => {
    for (const key of NAV_KEYS) {
      const count = (PLATFORM_JS.match(new RegExp('\\b' + key + ':', 'g')) || []).length;
      expect(count).toBeGreaterThanOrEqual(2);
    }
  });

  test('the Arabic values are real Arabic', () => {
    for (const key of NAV_KEYS.concat('licenses')) {
      const pattern = new RegExp(key + ":\\s*'[^']*[\u0600-\u06FF]'");
      expect(PLATFORM_JS).toMatch(pattern);
    }
  });

  test('the English values are the English labels', () => {
    expect(PLATFORM_JS).toMatch(/nav_online_games:\s*'Online Games'/);
    expect(PLATFORM_JS).toMatch(/nav_online_games_short:\s*'Online Games'/);
    expect(PLATFORM_JS).toMatch(/section_online_games:\s*'Online Games'/);
    expect(PLATFORM_JS).toMatch(/licenses:\s*'Licenses'/);
  });

  test('platform.html reaches the section from all three surfaces', () => {
    const links = PLATFORM_HTML.match(/href="online-games\/index\.html"/g) || [];
    expect(links.length).toBe(3);
    expect(PLATFORM_HTML).toMatch(/data-i18n="nav_online_games"/);
    const shortKeys = PLATFORM_HTML.match(/data-i18n="nav_online_games_short"/g) || [];
    expect(shortKeys.length).toBe(2);
  });

  test('the legacy route is nowhere on the platform surfaces', () => {
    for (const [name, text] of Object.entries({
      'platform.html': PLATFORM_HTML,
      'platform/platform.js': PLATFORM_JS,
      'backend/services/platformCatalog.service.js': CATALOG_SRC,
      'online-games/index.html': INDEX_HTML,
      'online-games/licenses.html': LICENSES_HTML
    })) {
      expect(text.includes(LEGACY_ROUTE)).toBe(false);
    }
    expect(exists('online-games.html')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Backend catalog registration
// ---------------------------------------------------------------------------

describe('platformCatalog advertises the section', () => {
  test('the default document carries the section entry', () => {
    expect(CATALOG_SRC).toMatch(/id:\s*'online-games'/);
    expect(CATALOG_SRC).toMatch(/url:\s*'\/online-games\/index\.html'/);
    expect(CATALOG_SRC.includes(LEGACY_ROUTE)).toBe(false);
  });

  test('the default document carries no withheld id', () => {
    for (const id of BLOCKED_IDS) {
      expect(CATALOG_SRC.includes(id)).toBe(false);
    }
  });

  test('Game Hosting stays a coming-soon entry with no url', () => {
    const gameHosting = CATALOG_SRC.match(/\{[^{}]*id:\s*'game-hosting'[^{}]*\}/);
    expect(gameHosting).toBeTruthy();
    expect(gameHosting[0]).toContain("status: 'coming-soon'");
    expect(gameHosting[0]).toContain('url: null');
  });
});

// ---------------------------------------------------------------------------
// 4. HTTP discovery — what the dashboard actually fetches
// ---------------------------------------------------------------------------

describe('GET /api/v1/platform-public — Online Games discovery', () => {
  beforeAll(() => {
    dataDir = makeTempDataDir('online-games-catalog');
    ({ app } = startServer(dataDir, { AUTH_REQUIRED: 'false' }));
  });

  test('/sections returns the section at the final route', async () => {
    const res = await request(app).get('/api/v1/platform-public/sections');
    expect(res.statusCode).toBe(200);
    const sections = res.body.data.sections;
    const entry = sections.find((s) => s.id === SECTION_ID);
    expect(entry).toBeTruthy();
    expect(entry.status).toBe('active');
    expect(entry.url).toBe(ROUTE);
    expect(entry.title).toBe('Online Games');
    const ids = sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id === SECTION_ID)).toHaveLength(1);
  });

  test('/catalog returns the same entry', async () => {
    const res = await request(app).get('/api/v1/platform-public/catalog');
    expect(res.statusCode).toBe(200);
    const entry = res.body.data.sections.find((s) => s.id === SECTION_ID);
    expect(entry).toBeTruthy();
    expect(entry.url).toBe(ROUTE);
  });

  test('no surface points at the legacy route or a withheld id', async () => {
    for (const route of ['/api/v1/platform-public/sections', '/api/v1/platform-public/catalog']) {
      const res = await request(app).get(route);
      const raw = JSON.stringify(res.body);
      expect(raw.includes(LEGACY_ROUTE)).toBe(false);
      for (const id of BLOCKED_IDS) expect(raw.includes(id)).toBe(false);
    }
  });

  test('Game Hosting is still advertised as coming-soon with no url', async () => {
    const res = await request(app).get('/api/v1/platform-public/sections');
    const gameHosting = res.body.data.sections.find((s) => s.id === 'game-hosting');
    expect(gameHosting).toBeTruthy();
    expect(gameHosting.status).toBe('coming-soon');
    expect(gameHosting.url).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. License attribution — exactly the 46 SAFE games
// ---------------------------------------------------------------------------

describe('license attribution page', () => {
  const linkedIds = (LICENSES_HTML.match(/href="game\.html\?id=([a-z0-9]+)"/g) || []).map((m) =>
    m.replace(/.*id=/, '').replace(/"/, '')
  );

  test('the page exists and is a document of this section', () => {
    expect(LICENSES_HTML).toMatch(/<html lang="ar" dir="rtl" data-omni-section="online-games">/);
    expect(LICENSES_HTML).toMatch(/<meta charset="UTF-8">/);
    expect(LICENSES_HTML).toContain('assets/online-games.css');
    expect(LICENSES_HTML).toContain('../platform/omni-i18n.js');
  });

  test('it links exactly the 46 roster games', () => {
    expect(linkedIds).toHaveLength(46);
    expect(new Set(linkedIds).size).toBe(46);
    expect(linkedIds.slice().sort()).toEqual(ROSTER.games.map((g) => g.id).sort());
    expect(linkedIds.slice().sort()).toEqual(GATE.safeIds.slice().sort());
  });

  test('it never names a withheld id', () => {
    for (const id of BLOCKED_IDS) {
      expect(LICENSES_HTML.includes(id)).toBe(false);
      expect(INDEX_HTML.includes(id)).toBe(false);
      expect(ROSTER.games.map((g) => g.id)).not.toContain(id);
      expect(GATE.safeIds).not.toContain(id);
    }
  });

  test('the roster gate still declares 46 SAFE and 3 withheld', () => {
    expect(GATE.safeGameCount).toBe(46);
    expect(GATE.blockedGameCount).toBe(3);
    expect(GATE.authoritativeRosterCount).toBe(49);
    expect(GATE.safeIds).toHaveLength(46);
    expect(ROSTER.games).toHaveLength(46);
  });

  test('it carries the foundation, font and word-list attributions', () => {
    expect(LICENSES_HTML).toContain('Sigmafier/ellaz-games');
    expect(LICENSES_HTML).toContain(GATE.foundation.commit);
    expect(LICENSES_HTML).toContain('MIT');
    expect(LICENSES_HTML).toContain('runtime/public/fonts/LICENSE-Cairo-OFL-1.1.txt');
    expect(LICENSES_HTML).toContain('runtime/public/fonts/LICENSE-Heebo-OFL-1.1.txt');
    expect(LICENSES_HTML).toContain('OFL 1.1');
    expect(LICENSES_HTML).toContain('runtime/src/games/lettercross/NOTICE.md');
    expect(LICENSES_HTML).toContain('ROSTER_GATE.json');
  });

  test('the catalog page reaches the attribution page from its footer', () => {
    expect(INDEX_HTML).toMatch(/href="licenses\.html"/);
  });
});

// ---------------------------------------------------------------------------
// 6. The roster cycle's security decisions are untouched
// ---------------------------------------------------------------------------

describe('CSP, frame sandbox and the Monetag boundary', () => {
  test('Express frame-src is TikTok plus the configured games origin only', () => {
    const frameLine = (SERVER_JS.match(/frameSrc: \[[^\]]*\]/) || [])[0];
    expect(frameLine).toBe("frameSrc: ['https://www.tiktok.com', GAMES_ORIGIN]");
    expect(frameLine.includes("'self'")).toBe(false);
    expect(SERVER_JS).toContain("frameSrc: ['https://www.tiktok.com', GAMES_ORIGIN].filter(Boolean)");
    expect(SERVER_JS).toContain('process.env.GAMES_ORIGIN');
    expect(/GAMES_ORIGIN\s*=\s*['"]https?:/.test(SERVER_JS)).toBe(false);
  });

  test('nginx frame-src mirrors it and never allows same-origin frames', () => {
    expect(NGINX_CONF).toContain('map $host $omnistore_games_origin');
    const csp = (NGINX_CONF.match(/add_header Content-Security-Policy "([^"]*frame-src[^"]*)"/) || [])[1];
    expect(csp).toBeTruthy();
    const frameSrc = (csp.match(/frame-src ([^;"]*)/) || [])[1];
    expect(frameSrc).toBe('https://www.tiktok.com $omnistore_games_origin');
    expect(frameSrc.includes("'self'")).toBe(false);
    expect(/GAMES_ORIGIN\s*=\s*['"]https?:/.test(NGINX_CONF)).toBe(false);
  });

  test('the frame sandbox stays the exact four tokens', () => {
    const sandbox = CONFIG_JS.match(/FRAME_SANDBOX\s*=\s*\n?\s*"([^"]+)"/);
    expect(sandbox).toBeTruthy();
    const tokens = sandbox[1].split(' ');
    expect(tokens).toEqual([
      'allow-scripts',
      'allow-same-origin',
      'allow-pointer-lock',
      'allow-presentation'
    ]);
    expect(tokens).not.toContain('allow-popups');
    expect(tokens).not.toContain('allow-popups-to-escape-sandbox');
    expect(tokens).not.toContain('allow-fullscreen');
    expect(tokens).not.toContain('allow-top-navigation');
  });

  test('the Monetag boundary stays disabled on the platform page', () => {
    const tag = (PLATFORM_HTML.match(/<script src="platform\/monetag\.js"[^>]*>/) || [])[0];
    expect(tag).toBeTruthy();
    expect(tag).toContain('data-omnistore-monetag-boundary="config"');
    expect(tag).toContain('data-monetag-enabled="false"');
    expect(tag).toContain('data-monetag-publisher-id=""');
    expect(tag.includes('data-monetag-enabled="true"')).toBe(false);
    expect(tag.includes('data-monetag-script-url="http')).toBe(false);
  });
});
