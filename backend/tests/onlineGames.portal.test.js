'use strict';

// Online Games portal — asset, registry, license and security audits.
//
// This suite pins the data-driven game registry to the games actually on
// disk: every published game must have its entry page, its LICENSE file and
// its thumbnail; every catalog surface must advertise the same portal route;
// no ad network / tracking / Yandex content may ship inside the games tree;
// and the live Express server must serve the portal, the registry and every
// game entry page (the CSP 'self' frame allowance is asserted for parity).

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let app;
let dataDir;

registerCleanup(() => [], () => {
  if (dataDir && fs.existsSync(dataDir)) {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
  }
});

beforeAll(async () => {
  dataDir = makeTempDataDir('online-games');
  ({ app } = await startServer(dataDir));
});

afterAll(() => {
  delete process.env.DIGITRONICS_DATA_DIR;
});

// ---------------------------------------------------------------------------
// 1. Registry integrity — the Game Registry is the single source of truth
// ---------------------------------------------------------------------------
describe('games/registry.json integrity', () => {
  const registry = JSON.parse(read('games/registry.json'));

  test('is valid JSON with version, categories and games arrays', () => {
    expect(registry.version).toBe(1);
    expect(Array.isArray(registry.categories)).toBe(true);
    expect(registry.categories.length).toBeGreaterThanOrEqual(4);
    expect(Array.isArray(registry.games)).toBe(true);
    expect(registry.games.length).toBeGreaterThanOrEqual(6);
  });

  test('every registry entry carries the full metadata contract', () => {
    const required = ['id', 'title', 'slug', 'description', 'thumbnail', 'category',
      'tags', 'orientation', 'controls', 'entry', 'source', 'license',
      'attribution', 'featured', 'published', 'ageGroup'];
    for (const g of registry.games) {
      for (const key of required) {
        expect(g).toHaveProperty(key);
      }
      expect(['portrait', 'landscape']).toContain(g.orientation);
      expect(['public', 'private', 'draft']).toBe; // visibility lives on reels; games use published
      expect(g.published).toBe(true);
      expect(['everyone', 'teen', 'adult']).toContain(g.ageGroup);
    }
  });

  test('slugs and ids are unique', () => {
    const ids = new Set(registry.games.map((g) => g.id));
    const slugs = new Set(registry.games.map((g) => g.slug));
    expect(ids.size).toBe(registry.games.length);
    expect(slugs.size).toBe(registry.games.length);
  });

  test('every category referenced by a game exists in categories', () => {
    const catIds = new Set(registry.categories.map((c) => c.id));
    for (const g of registry.games) {
      expect(catIds.has(g.category)).toBe(true);
    }
  });

  test('ad slots are placeholders only — nothing enabled, no ad network wired', () => {
    expect(registry.adConfig.enabled).toBe(false);
    expect(registry.adConfig.slots.topOfPlayerPage.active).toBe(false);
    expect(registry.adConfig.slots.postGameContent.active).toBe(false);
  });

  test('every game passes its license gate fields', () => {
    for (const g of registry.games) {
      expect(g.licenseConfirmed).toBe('PASS');
      expect(g.commercialUseAllowed).toBe(true);
      expect(g.redistributionAllowed).toBe(true);
      expect(g.attributionRequired).toBe(true);
      expect(g.assetLicenseConfirmed).toBe(true);
      expect(g.attribution.length).toBeGreaterThan(5);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Games on disk — license files, entry pages, thumbnails
// ---------------------------------------------------------------------------
describe('games tree on disk', () => {
  const registry = JSON.parse(read('games/registry.json'));

  test('every published game has its entry page on disk', () => {
    for (const g of registry.games.filter((x) => x.published)) {
      const rel = g.entry.replace(/^\//, '');
      expect(fs.existsSync(path.join(ROOT, rel))).toBe(true);
    }
  });

  test('every published game ships its own LICENSE file (redistribution evidence)', () => {
    for (const g of registry.games.filter((x) => x.published)) {
      const dir = path.join(ROOT, 'games', g.slug);
      const has = fs.readdirSync(dir).some((f) => /^LICENSE/i.test(f));
      expect(has).toBe(true);
    }
  });

  test('every published game has its OmniStore-made SVG thumbnail', () => {
    for (const g of registry.games.filter((x) => x.published)) {
      const thumb = path.join(ROOT, g.thumbnail.replace(/^\//, ''));
      expect(fs.existsSync(thumb)).toBe(true);
      const content = fs.readFileSync(thumb, 'utf8');
      expect(content.startsWith('<svg')).toBe(true);
    }
  });

  test('the sandbox storage shim exists and is loaded first by every game page', () => {
    const shim = path.join(ROOT, 'games', '_shim', 'storage-shim.js');
    expect(fs.existsSync(shim)).toBe(true);
    for (const g of registry.games.filter((x) => x.published)) {
      const html = read(g.entry.replace(/^\//, ''));
      const headIdx = html.indexOf('<head>');
      const shimIdx = html.indexOf('/games/_shim/storage-shim.js');
      expect(shimIdx).toBeGreaterThan(-1);
      expect(shimIdx).toBeGreaterThan(headIdx);
    }
  });

  test('the sandbox input bridge exists and is loaded by every game page after the storage shim', () => {
    // Verified defect this bridge closes: a sandboxed (opaque-origin) player
    // frame can hold focus (document.hasFocus() === true inside it) yet key
    // events are delivered to the TOP-LEVEL document instead — Chromium routed
    // ArrowLeft to the portal while the game frame received nothing. The portal
    // forwards its keys and this bridge re-dispatches them inside the frame.
    const bridgePath = path.join(ROOT, 'games', '_shim', 'input-bridge.js');
    expect(fs.existsSync(bridgePath)).toBe(true);
    const src = fs.readFileSync(bridgePath, 'utf8');
    // Only our own embedder may drive the game, and only with the magic token.
    expect(src).toContain('event.source !== window.parent');
    expect(src).toContain('__omnistoreGamesInput');
    expect(src).toContain('new KeyboardEvent(');
    // keyCode/which must be carried: the vendored games read event.which.
    expect(src).toContain('which: keyCode');
    // No dynamic code execution of any kind.
    expect(src).not.toContain('eval(');
    expect(src).not.toContain('document.write');
    for (const g of registry.games.filter((x) => x.published)) {
      const html = read(g.entry.replace(/^\//, ''));
      const shimIdx = html.indexOf('/games/_shim/storage-shim.js');
      const bridgeIdx = html.indexOf('/games/_shim/input-bridge.js');
      expect(shimIdx).toBeGreaterThan(-1);
      expect(bridgeIdx).toBeGreaterThan(shimIdx);
    }
  });

  test('the portal forwards gameplay keys into the sandboxed player frame', () => {
    const html = read('online-games.html');
    expect(html).toContain('__omnistoreGamesInput');
    expect(html).toContain('frame.contentWindow.postMessage');
    expect(html).toContain('FORWARD_KEYS');
    // Arrows must be forwarded so keyboard-only games stay playable.
    expect(html).toContain('37: 1, 38: 1, 39: 1, 40: 1');
    // The forwarder stands down while a portal control holds focus so button
    // activation keeps working.
    expect(html).toContain("ae.tagName === 'BUTTON'");
    // Keys that the frame receives natively never reach the parent document,
    // so forwarding can never double a move.
    expect(html).toContain("document.addEventListener('keydown', function(ev){ forwardKey('keydown', ev); }, true)");
  });

  test('no game page references an external ad network or tracking script', () => {
    const banned = ['googletagmanager', 'google-analytics', 'monetag', 'popunder',
      'onclick=', 'quge5.com', 'propellerads', 'adsterra'];
    for (const g of registry.games.filter((x) => x.published)) {
      const html = read(g.entry.replace(/^\//, ''));
      for (const marker of banned) {
        expect(html.toLowerCase()).not.toContain(marker);
      }
    }
  });

  test('no Yandex branding, content or inventory anywhere in the games tree', () => {
    const banned = ['yandex', 'yastatic', 'ya.ru'];
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        const stat = fs.statSync(p);
        if (stat.isDirectory()) { walk(p); continue; }
        if (!/\.(html|js|json|css|svg)$/i.test(f)) continue;
        const content = fs.readFileSync(p, 'utf8').toLowerCase();
        for (const marker of banned) {
          expect(content.includes(marker)).toBe(false);
        }
      }
    };
    walk(path.join(ROOT, 'games'));
  });

  test('no Flash/ROM emulators or questionable redistributions in the catalog', () => {
    const bannedDirs = ['swf', 'roms', 'webretro', 'emulator'];
    const rootGames = fs.readdirSync(path.join(ROOT, 'games')).filter((f) => !f.startsWith('.') && !f.startsWith('_'));
    for (const dir of bannedDirs) {
      expect(rootGames).not.toContain(dir);
    }
  });

  test('asteroids ships without the unverified upstream sound assets', () => {
    const dir = path.join(ROOT, 'games', 'asteroids');
    expect(fs.existsSync(path.join(dir, '39459__THE_bizniss__laser.wav'))).toBe(false);
    expect(fs.existsSync(path.join(dir, '51467__smcameron__missile_explosion.wav'))).toBe(false);
    const gameJs = read('games/asteroids/game.js');
    expect(gameJs).not.toContain('new Audio(');
  });

  test('tower-blocks ships without the upstream Google Tag Manager script', () => {
    const html = read('games/tower-blocks/index.html');
    expect(html).not.toContain('googletagmanager');
    expect(html).not.toContain('G-YCWZ8ZDCH2');
  });
});

// ---------------------------------------------------------------------------
// 3. Catalog surfaces — platform advertises the portal consistently
// ---------------------------------------------------------------------------
describe('Online Games platform integration', () => {
  test('platform.js policy allowlists online-games as active with the real route', () => {
    const js = read('platform/platform.js');
    expect(js).toContain("'online-games': '/online-games.html'");
  });

  test('platform.js fallback catalog carries the online-games entry as active', () => {
    const js = read('platform/platform.js');
    const m = js.match(/id:\s*'online-games'[^}]+\}/);
    expect(m).toBeTruthy();
    expect(m[0]).toContain("status: 'active'");
    expect(m[0]).toContain("url: '/online-games.html'");
  });

  test('platform.js i18n covers online-games labels in en and ar', () => {
    const js = read('platform/platform.js');
    for (const key of ['nav_online_games', 'nav_online_games_short', 'section_online_games']) {
      expect(js.split(key).length - 1).toBeGreaterThanOrEqual(2);
    }
    expect(/nav_online_games:\s*'[^']*[\u0600-\u06FF]/.test(js)).toBe(true);
  });

  test('platform.html advertises the portal in all three nav spots', () => {
    const html = read('platform.html');
    expect(html.split('href="/online-games.html"').length - 1).toBe(3);
  });

  test('game-hosting stays locked everywhere (unchanged behavior)', () => {
    const js = read('platform/platform.js');
    const m = js.match(/lockedIds:\s*\[([^\]]*)\]/);
    expect(m[1]).toContain("'game-hosting'");
    const entry = js.match(/id:\s*'game-hosting'[^}]+\}/);
    expect(entry[0]).toContain("status: 'coming-soon'");
    expect(entry[0]).toContain('url: null');
  });

  test('backend catalog default advertises the same portal route', () => {
    const svc = read('backend/services/platformCatalog.service.js');
    const m = svc.match(/id:\s*'online-games'[^}]+\}/);
    expect(m).toBeTruthy();
    expect(m[0]).toContain("status: 'active'");
    expect(m[0]).toContain("url: '/online-games.html'");
  });

  test('CSP allows same-origin frames in Express and nginx identically (game player requirement)', () => {
    const serverJs = read('backend/server.js');
    const frameLine = (serverJs.match(/frameSrc:\s*\[[^\]]*\]/) || [])[0];
    expect(frameLine).toContain("'self'");
    expect(frameLine).toContain("'https://www.tiktok.com'");

    const nginx = read('nginx.conf');
    const header = (nginx.match(/add_header Content-Security-Policy "([^"]+)"/) || [])[1];
    const frameDir = header.split(';').map((d) => d.trim())
      .find((d) => d.startsWith('frame-src'));
    expect(frameDir).toContain("'self'");
    expect(frameDir).toContain('https://www.tiktok.com');
    // Parity: both layers allow exactly the same frame origins.
    const expressOrigins = frameLine.match(/https:\/\/[^'"]+/g).sort();
    const nginxOrigins = frameDir.match(/https:\/\/[^'"]+/g).sort();
    expect(expressOrigins).toEqual(nginxOrigins);
  });

  test('portal iframe sandboxes games without same-origin access', () => {
    const html = read('online-games.html');
    const m = html.match(/<iframe[^>]*sandbox="([^"]*)"/);
    expect(m).toBeTruthy();
    const flags = m[1].split(/\s+/);
    expect(flags).toContain('allow-scripts');
    expect(flags).not.toContain('allow-same-origin');
    expect(flags).not.toContain('allow-top-navigation');
  });

  test('portal page is Arabic-first RTL with an English-ready i18n dictionary', () => {
    const html = read('online-games.html');
    expect(/<html[^>]+lang="ar"/.test(html)).toBe(true);
    expect(/<html[^>]+dir="rtl"/.test(html)).toBe(true);
    expect(html).toContain("en: {");
    expect(html).toContain('omnistore_games_lang');
  });

  test('licenses.html renders per-game attribution from the registry', () => {
    const html = read('games/licenses.html');
    expect(html).toContain('/games/registry.json');
    expect(html).toContain('attribution');
  });

  test('GAMES_LICENSES.md documents the gate for every shipped game', () => {
    const md = read('games/GAMES_LICENSES.md');
    const registry = JSON.parse(read('games/registry.json'));
    for (const g of registry.games) {
      expect(md).toContain(g.source);
    }
    expect(md).toContain('DO NOT INCLUDE');
    expect(md).toContain('GPL-3.0'); // documented rejections are part of the audit
  });
});

// ---------------------------------------------------------------------------
// 4. Live HTTP — the real Express server serves portal, registry and games
// ---------------------------------------------------------------------------
describe('Online Games HTTP surface', () => {
  test('GET /online-games.html serves the portal', async () => {
    const res = await request(app).get('/online-games.html');
    expect(res.status).toBe(200);
    expect(res.text).toContain('ألعاب أونلاين');
    expect(res.text).toContain('/games/registry.json');
  });

  test('GET /games/registry.json serves the registry with per-game license gates', async () => {
    const res = await request(app).get('/games/registry.json');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
    expect(res.body.adConfig.enabled).toBe(false);
    expect(res.body.games.length).toBeGreaterThanOrEqual(6);
    for (const g of res.body.games) {
      expect(g.licenseConfirmed).toBe('PASS');
      expect(g.license).toBe('MIT');
    }
  });

  test('every game entry page is served over HTTP', async () => {
    const registry = JSON.parse(read('games/registry.json'));
    for (const g of registry.games.filter((x) => x.published)) {
      const res = await request(app).get(g.entry);
      expect(res.status).toBe(200);
    }
  });

  test('every thumbnail is served over HTTP', async () => {
    const registry = JSON.parse(read('games/registry.json'));
    for (const g of registry.games.filter((x) => x.published)) {
      const res = await request(app).get(g.thumbnail);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/svg');
    }
  });

  test('the storage shim is served over HTTP', async () => {
    const res = await request(app).get('/games/_shim/storage-shim.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('localStorage');
  });

  test('the input bridge is served over HTTP', async () => {
    const res = await request(app).get('/games/_shim/input-bridge.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('__omnistoreGamesInput');
  });

  test('game documents carry no origin-relative headers (sandboxed opaque-origin requirement)', async () => {
    // The portal player embeds games in a sandbox WITHOUT allow-same-origin,
    // so the game document's origin is opaque. A CSP with 'self' (and helmet's
    // COEP require-corp / CORP same-origin defaults) is evaluated against the
    // document origin — inside the sandbox it matches nothing and would blank
    // every vendored game. server.js strips exactly those headers on /games/*;
    // the portal page itself keeps its full CSP. nginx.conf mirrors this with
    // a dedicated /games/ location that re-declares the keep-set of headers
    // (add_header in a location suppresses server-level inheritance) without
    // the CSP, and swaps X-Frame-Options to SAMEORIGIN so the SAME-ORIGIN
    // portal player can embed game pages while cross-origin embedders stay
    // blocked.
    const res = await request(app).get('/games/2048/index.html');
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toBeUndefined();
    expect(res.headers['cross-origin-embedder-policy']).toBeUndefined();
    expect(res.headers['cross-origin-resource-policy']).toBeUndefined();
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    const portal = await request(app).get('/online-games.html');
    expect(portal.status).toBe(200);
    expect(portal.headers['content-security-policy']).toBeTruthy();
    // Static parity between the two serving layers (Express + nginx).
    const serverJs = read('backend/server.js');
    expect(serverJs).toContain("req.path.startsWith('/games/')");
    expect(serverJs).toContain("res.removeHeader('Content-Security-Policy')");
    expect(serverJs).toContain("res.removeHeader('Cross-Origin-Embedder-Policy')");
    expect(serverJs).toContain("res.removeHeader('Cross-Origin-Resource-Policy')");
    const nginx = read('nginx.conf');
    const loc = nginx.match(/location \^~ \/games\/ \{[\s\S]*?\n    \}/);
    expect(loc).toBeTruthy();
    expect(loc[0]).toContain('try_files $uri =404;');
    expect(loc[0]).not.toContain('Content-Security-Policy');
    expect(loc[0]).toContain('X-Frame-Options "SAMEORIGIN"');
    expect(loc[0]).toContain('X-Content-Type-Options "nosniff"');
    // Never revalidate game builds: a bodyless 304 leaves an opaque-origin
    // (sandboxed) player frame without a usable body for its own css/js, so
    // the game boots unstyled and dead. Both layers must serve full 200s.
    expect(serverJs).toContain("delete req.headers['if-none-match']");
    expect(serverJs).toContain("delete req.headers['if-modified-since']");
    expect(loc[0]).toContain('etag off;');
    expect(loc[0]).toContain('if_modified_since off;');
    const asset = await request(app).get('/games/2048/style/main.css');
    expect(asset.status).toBe(200);
    expect(asset.headers['cache-control']).toContain('max-age=3600');
    const revalidated = await request(app)
      .get('/games/2048/style/main.css')
      .set('If-None-Match', asset.headers.etag || '"probe"');
    expect(revalidated.status).toBe(200);
    const ims = await request(app)
      .get('/games/2048/style/main.css')
      .set('If-Modified-Since', 'Wed, 01 Jan 2031 00:00:00 GMT');
    expect(ims.status).toBe(200);
    const docRevalidation = await request(app)
      .get('/games/2048/index.html')
      .set('If-None-Match', '"probe"');
    expect(docRevalidation.status).toBe(200);
  });

  test('licenses.html is served over HTTP', async () => {
    const res = await request(app).get('/games/licenses.html');
    expect(res.status).toBe(200);
  });

  test('no auth is required for the public portal surface (guest experience)', async () => {
    const res = await request(app).get('/online-games.html');
    expect(res.status).toBe(200);
  });
});
