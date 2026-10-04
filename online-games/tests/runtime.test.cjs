/**
 * The frame that the games origin serves.
 *
 * `runtime/dist/` is a build output (gitignored), so every check that needs it
 * skips with a reason when it has not been built; the source half runs
 * everywhere, including CI's install-free gate. Both halves answer the same
 * question from opposite ends: nothing in this frame reaches the network, and
 * nothing in it can be talked into reaching the network later.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RT = path.resolve(__dirname, "..", "runtime");
const SRC = path.join(RT, "src");
const DIST = path.join(RT, "dist");

const hasDist = fs.existsSync(path.join(DIST, "index.html"));
const distSkip = hasDist
  ? false
  : "runtime/dist is gitignored and has not been built — run `npm run build` in online-games/runtime";

const FRAME_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self'; media-src 'self' data: blob:; connect-src 'none'";

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );

const srcFiles = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f));
const read = (f) => fs.readFileSync(f, "utf8");
const rel = (f) => path.relative(SRC, f).split(path.sep).join("/");

// ---------------------------------------------------------------------------
// source — runs with or without a build
// ---------------------------------------------------------------------------

test("the bundler strips the cloud client and the telemetry client from the build", () => {
  const config = read(path.join(RT, "vite.config.ts"));
  assert.match(config, /function noNetworkClients\(\)/);
  assert.match(config, /source === "posthog-js"\) return TELEMETRY_STUB/);
  assert.ok(
    config.includes("const cloud = /\\/src\\/sdk\\/cloud\\.ts$/;"),
    "the cloud client must be identified by its path",
  );
  assert.match(config, /enforce: "pre"/);
  assert.match(config, /reached the cloud client; this build ships neither it nor a network/);
  // A placeholder left unfilled would ship a document with no build identity.
  assert.match(config, /__OMNISTORE_BUILD__/);
  assert.match(config, /placeholder left unfilled/);
});

test("no source file outside the stubbed cloud client reaches for the network", () => {
  const offenders = srcFiles
    .filter((f) => rel(f) !== "sdk/cloud.ts")
    .filter((f) => {
      const text = read(f);
      return ["fetch(", "XMLHttpRequest", "EventSource", "sendBeacon", "WebSocket"].some((t) =>
        text.includes(t),
      );
    })
    .map(rel);
  assert.deepStrictEqual(offenders, [], "source files must not open a socket: " + offenders.join(", "));
  assert.deepStrictEqual(
    srcFiles.filter((f) => read(f).includes("document.cookie")).map(rel),
    [],
    "no game, portal or SDK file may read a cookie",
  );
  // The one file that does may only be cloud.ts, and it is stubbed out above.
  const fetchers = srcFiles.filter((f) => read(f).includes("fetch(")).map(rel);
  assert.deepStrictEqual(fetchers, ["sdk/cloud.ts"]);
});

test("no shipped game loads an asset at runtime", () => {
  const gamesRoot = path.join(SRC, "games");
  const offenders = [];
  for (const dir of fs.readdirSync(gamesRoot, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const f of walk(path.join(gamesRoot, dir.name)).filter((f) => /\.(ts|tsx)$/.test(f))) {
      const text = read(f);
      if (/\bthis\.load\.|load\.(atlas|audio|image|spritesheet|json|tilemap|video|font)\b/.test(text)) {
        offenders.push(path.relative(gamesRoot, f).split(path.sep).join("/"));
      }
    }
  }
  assert.deepStrictEqual(offenders, [], "asset loaders are what the blocked games needed: " + offenders.join(", "));
});

test("the frame only ever posts to a bare origin it was handed", () => {
  const run = read(path.join(SRC, "run.tsx"));
  // Rejects a path, a query, a hash and this page's own origin.
  assert.match(run, /if \(url\.href !== `\$\{url\.origin\}\/`\) return null;/);
  assert.match(run, /if \(url\.origin === location\.origin\) return null;/);
  // No parent, no target: nothing is sent into the void or to the top frame.
  assert.match(run, /if \(!HAS_PARENT \|\| !TARGET\) return;/);
  assert.match(run, /window\.parent\.postMessage\(msg, TARGET\);/);
  // The union of what this origin may ever say — and nothing else. Anything
  // added to it later has to be added here too, which is the point.
  const union = [...run.matchAll(/type: "(omnigames:[a-z:-]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(
    [...new Set(union)].sort(),
    ["omnigames:load-error", "omnigames:ready", "omnigames:request-exit"],
  );
  assert.match(run, /variant="embed"/);
  assert.match(run, /onExit=/);
});

test("the frame's own links address games as ?game= on this origin", () => {
  const paths = read(path.join(SRC, "portal", "paths.ts"));
  const body = paths.slice(paths.indexOf("export function gameHref"));
  assert.match(body, /\$\{BASE\}\?game=\$\{encodeURIComponent\(id\)\}/);
  // The catalog and the player on the platform origin share that address form.
  const roster = read(path.join(__dirname, "..", "js", "roster.js"));
  assert.ok(roster.includes('"game.html?id=" + encodeURIComponent(id)'));
  assert.ok(roster.includes('"play.html?id=" + encodeURIComponent(id)'));
});

// ---------------------------------------------------------------------------
// dist — skipped when the build has not been run
// ---------------------------------------------------------------------------

test("the emitted document carries the verbatim CSP and the RTL shell", { skip: distSkip }, () => {
  const html = read(path.join(DIST, "index.html"));
  assert.ok(html.includes(FRAME_CSP), "frame CSP changed");
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.match(html, /<meta name="referrer" content="no-referrer" \/>/);
  assert.match(html, /<meta name="robots" content="noindex" \/>/);
  assert.match(html, /<body class="app-shell" data-theme="night">/);
  assert.match(html, /<div id="root"><\/div>/);
  // Sibling of #root, so the no-JavaScript and bad-id answer survives React.
  assert.match(html, /<div id="run-fallback">/);
  assert.match(html, /<script type="module"[^>]+src="\/assets\/index-[^"]+\.js"><\/script>/);
  assert.match(html, /<meta name="omnistore:build" content="[^"]+"\s*\/>/);
  assert.ok(!html.includes("__OMNISTORE_BUILD__"), "build placeholder left unfilled");
  assert.ok(!/\son[a-z]+\s*=/i.test(html), "inline event handler in the emitted document");
  assert.match(html, /"Cairo", "Heebo"/);
});

test("every asset the emitted document and stylesheet name exists on disk", { skip: distSkip }, () => {
  const missing = [];
  const html = read(path.join(DIST, "index.html"));
  for (const [, ref] of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) {
    if (!fs.existsSync(path.join(DIST, ref))) missing.push("index.html -> " + ref);
  }
  const cssFiles = walk(DIST).filter((f) => f.endsWith(".css"));
  assert.ok(cssFiles.length >= 1, "no stylesheet emitted");
  for (const css of cssFiles) {
    for (const [, ref] of css.matchAll(/url\(([^)]+)\)/g)) {
      const target = ref.trim().replace(/^['"]|['"]$/g, "");
      if (target.startsWith("data:")) continue;
      const file = target.startsWith("/") ? path.join(DIST, target) : path.resolve(path.dirname(css), target);
      if (!fs.existsSync(file)) missing.push(path.basename(css) + " -> " + target);
    }
  }
  assert.deepStrictEqual(missing, [], "referenced asset missing: " + missing.join(", "));
});

test("every shipped font binary keeps its licence file beside it", { skip: distSkip }, () => {
  const fonts = walk(DIST).filter((f) => /\.woff2?$/.test(f));
  assert.strictEqual(fonts.length, 4, "expected the four Ellaz UI fonts");
  for (const f of fonts) {
    assert.match(path.basename(f), /^(Cairo|Heebo)-(400|700|800)\.woff$/);
    const licences = fs
      .readdirSync(path.dirname(f))
      .filter((n) => /^(LICENSE|LICENCE|NOTICE|COPYING|OFL)/i.test(n));
    assert.ok(licences.length > 0, f + " has no licence file beside it");
  }
});

test("the emitted bundle names no third party, ad network or telemetry host", { skip: distSkip }, () => {
  const files = walk(DIST).filter((f) => /\.(js|css|html)$/.test(f));
  for (const token of [
    "monetag",
    "quge5",
    "posthog",
    "firestore",
    "identitytoolkit",
    "googleapis",
    "gstatic",
    "doubleclick",
    "document.cookie",
    "localStorage.setItem(\"token",
    "http://localhost",
    "127.0.0.1",
  ]) {
    const hit = files.filter((f) => read(f).includes(token));
    assert.deepStrictEqual(hit.map((f) => path.basename(f)), [], "dist must not contain " + token);
  }
});

test("the emitted bundle opens no network channel", { skip: distSkip }, () => {
  const files = walk(DIST).filter((f) => /\.(js|css|html)$/.test(f)).map((f) => ({ f, text: read(f) }));

  // The only `fetch(` Vite itself emits: its modulepreload polyfill, which
  // downloads a same-origin <link rel="modulepreload"> and only in a browser
  // that lacks native support. It is never reached in a modern browser, and
  // `connect-src 'none'` refuses it if it somehow is.
  const fetchers = files.filter((x) => x.text.includes("fetch("));
  assert.ok(fetchers.length <= 1, "unexpected fetch() in " + fetchers.map((x) => path.basename(x.f)).join(", "));
  for (const x of fetchers) assert.ok(x.text.includes('link[rel="modulepreload"]'), "fetch is not Vite's polyfill");

  // Phaser ships a loader that can use XHR and a worker factory that can use
  // importScripts; both live in the vendor chunk and neither is reachable from
  // the 46 SAFE games (checked above against their sources).
  for (const x of files) {
    for (const token of ["XMLHttpRequest", "importScripts"]) {
      if (x.text.includes(token)) {
        assert.match(path.basename(x.f), /^vendor-phaser-/, token + " escaped the vendor chunk");
      }
    }
    for (const token of ["WebSocket", "EventSource", "sendBeacon", "indexedDB", "new Worker("]) {
      assert.ok(!x.text.includes(token), path.basename(x.f) + " must not use " + token);
    }
  }

  // Enough chunks that the portal's per-game splits really did happen.
  const chunks = walk(path.join(DIST, "assets")).filter((f) => f.endsWith(".js"));
  assert.ok(chunks.length >= 46, "expected at least one chunk per game, got " + chunks.length);
});
