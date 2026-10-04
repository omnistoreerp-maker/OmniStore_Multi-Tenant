/**
 * The section as a visitor's browser sees it: the three platform pages, the
 * CSS they load, and the module scripts behind them.
 *
 * Everything here is asserted against the files on disk rather than against a
 * description of them, because the whole point of this section is that its
 * security decisions (sandbox, CSP, message allowlist) live in the shipped
 * bytes and not in a document nobody re-reads.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const OG = path.join(ROOT, "online-games");

const PAGES = ["index.html", "game.html", "play.html"].map((f) => path.join(OG, f));
const JS_DIR = path.join(OG, "js");
const CSS = fs.readFileSync(path.join(OG, "assets", "online-games.css"), "utf8");

const read = (p) => fs.readFileSync(p, "utf8");
const jsFiles = fs
  .readdirSync(JS_DIR)
  .filter((f) => f.endsWith(".js"))
  .map((f) => ({ name: f, text: read(path.join(JS_DIR, f)) }));

// `config.js` reads `location` and `document` at module scope. Give it the
// page it thinks it is on — a local QA host with an empty meta tag, which is
// exactly what ships — before the import promise is created.
globalThis.location = new URL("http://localhost:8081/online-games/play.html?id=memory");
globalThis.document = { querySelector: () => null };
const config = import("../js/config.js");

// ---------------------------------------------------------------------------
// the three pages
// ---------------------------------------------------------------------------

test("all three pages are Arabic, RTL and flagged as this section", () => {
  for (const page of PAGES) {
    const html = read(page);
    assert.match(html, /<html lang="ar" dir="rtl" data-omni-section="online-games">/, page);
    assert.match(html, /<meta charset="UTF-8">/, page);
    assert.match(html, /name="viewport"[^>]*viewport-fit=cover/, page);
    assert.match(html, /assets\/online-games\.css/, page);
    assert.match(html, /<script src="\.\.\/platform\/omni-i18n\.js"><\/script>/, page);
    assert.match(html, /<script src="\.\.\/platform\/i18n\/platform\.dict\.js"><\/script>/, page);
    // Header, footer and the bottom bar all reach the section.
    assert.ok((html.match(/href="index\.html"/g) || []).length >= 3, page + " must link the catalog from three places");
  }
});

test("the games origin ships empty on every page and is never invented", () => {
  for (const page of PAGES) {
    const html = read(page);
    const metas = html.match(/<meta name="games-origin"[^>]*>/g) || [];
    assert.strictEqual(metas.length, 1, page + " must declare games-origin exactly once");
    assert.match(metas[0], /content=""/, page + " games-origin must ship empty (OWNER_REQUIRED)");
    assert.ok(html.includes("OWNER_REQUIRED"), page + " must document the empty origin");
  }
});

test("the pages load nothing from a third party and carry no inline handlers", () => {
  for (const page of PAGES) {
    const html = read(page);
    assert.ok(!/<script[^>]+src="(https?:)?\/\//.test(html), page + " loads an external script");
    assert.ok(!/<(link|img)[^>]+(href|src)="https?:\/\//.test(html), page + " links a remote asset");
    assert.ok(!/monetag|quge5|doubleclick|googlesyndication/i.test(html), page + " mentions an ad network");
    assert.ok(!/\son[a-z]+\s*=/i.test(html), page + " carries an inline event handler");
    assert.ok(!/platform\.js/.test(html), page + " must not boot the ERP's platform.js");
    assert.ok(!/<script(?![^>]*type="module")[^>]*src="js\//.test(html), page + " must load its section script as a module");
  }
});

test("each page boots the module that owns it", () => {
  const expect = {
    "index.html": "js/catalog.js",
    "game.html": "js/details.js",
    "play.html": "js/player.js",
  };
  for (const [page, script] of Object.entries(expect)) {
    const html = read(path.join(OG, page));
    assert.match(html, new RegExp(`<script type="module" src="${script.replace(/\./g, "\\.")}"></script>`), page);
  }
});

// ---------------------------------------------------------------------------
// the sandbox and the frame policy
// ---------------------------------------------------------------------------

test("FRAME_SANDBOX is the exact four tokens and nothing else", async () => {
  const c = await config;
  assert.strictEqual(
    c.FRAME_SANDBOX,
    "allow-scripts allow-same-origin allow-pointer-lock allow-presentation",
  );
  const tokens = c.FRAME_SANDBOX.split(" ");
  assert.strictEqual(tokens.length, 4);
  assert.strictEqual(new Set(tokens).size, 4, "duplicate sandbox token");
  // There is no allow-fullscreen sandbox flag; Chromium logs an error for one
  // and ignores it. Fullscreen is granted by the frame's allow attribute.
  assert.ok(!tokens.includes("allow-fullscreen"), "allow-fullscreen is not a sandbox flag");
  // The flags that must never appear in a third-party frame.
  for (const forbidden of [
    "allow-top-navigation",
    "allow-top-navigation-by-user-activation",
    "allow-modals",
    "allow-forms",
    "allow-popups",
    "allow-popups-to-escape-sandbox",
  ]) {
    assert.ok(!tokens.includes(forbidden), "sandbox must not grant " + forbidden);
  }
  // The player still grants fullscreen the legal way.
  const player = read(path.join(JS_DIR, "player.js"));
  assert.match(player, /frame\.setAttribute\("allow", "fullscreen"\)/);
});

test("the player applies the sandbox, a one-permission allow list and no referrer", async () => {
  const c = await config;
  const player = read(path.join(JS_DIR, "player.js"));
  assert.match(player, /frame\.setAttribute\("sandbox", FRAME_SANDBOX\)/);
  assert.match(player, /frame\.setAttribute\("allow", "fullscreen"\)/);
  assert.match(player, /frame\.setAttribute\("referrerpolicy", "no-referrer"\)/);
  assert.match(player, /frame\.setAttribute\("title"|frame\.title = /);
  assert.match(player, /frame\.title = "لعبة " \+ game\.titleAr/);
  // The frame only ever gets a bare-origin URL built from the configured origin.
  assert.match(player, /frame\.src = frameUrl\(game\.id\)/);
  assert.strictEqual(c.ALLOWED_FROM_GAMES.length, 3);
  assert.deepStrictEqual([...c.ALLOWED_FROM_GAMES], [
    "omnigames:ready",
    "omnigames:request-exit",
    "omnigames:load-error",
  ]);
});

test("incoming messages are checked by origin, type and game id — in that order", () => {
  const player = read(path.join(JS_DIR, "player.js"));
  assert.match(player, /if \(event\.origin !== GAMES_ORIGIN\) return;/);
  assert.match(player, /if \(typeof data\.type !== "string" \|\| !ALLOWED_FROM_GAMES\.includes\(data\.type\)\) return;/);
  assert.match(player, /if \(data\.gameId !== game\.id\) return;/);
  // The platform never sends the frame a command; exit is the frame's message.
  assert.ok(!/contentWindow\.postMessage|iframe\.contentWindow/.test(player), "player must not post to the frame");
});

test("the origin the frame talks back to is a bare origin, never this page's", async () => {
  const c = await config;
  assert.strictEqual(c.normalizeOrigin("https://games.example.com"), "https://games.example.com");
  assert.strictEqual(c.normalizeOrigin("https://games.example.com/"), "https://games.example.com");
  // Path, query, hash and credentials all make it a URL, not an origin.
  assert.strictEqual(c.normalizeOrigin("https://games.example.com/play"), "");
  assert.strictEqual(c.normalizeOrigin("https://games.example.com?a=1"), "");
  assert.strictEqual(c.normalizeOrigin("https://games.example.com#x"), "");
  assert.strictEqual(c.normalizeOrigin("https://user:pass@games.example.com"), "");
  // Non-http schemes, relative input and our own origin are all rejected.
  assert.strictEqual(c.normalizeOrigin("javascript:alert(1)"), "");
  assert.strictEqual(c.normalizeOrigin("data:text/html,<b>x</b>"), "");
  assert.strictEqual(c.normalizeOrigin("//evil.com"), "");
  assert.strictEqual(c.normalizeOrigin("not a url"), "");
  assert.strictEqual(c.normalizeOrigin(""), "");
  assert.strictEqual(c.normalizeOrigin("http://localhost:8081"), "", "frame-src 'self' is forbidden");

  assert.strictEqual(c.isLocalHost("localhost"), true);
  assert.strictEqual(c.isLocalHost("127.0.0.1"), true);
  assert.strictEqual(c.isLocalHost("app.localhost"), true);
  assert.strictEqual(c.isLocalHost("localhost.evil.com"), false);
  assert.strictEqual(c.isLocalHost("evil.com"), false);
});

test("the frame URL names the game and the caller's origin", () => {
  const configSource = read(path.join(JS_DIR, "config.js"));
  assert.match(configSource, /const url = new URL\("\/", GAMES_ORIGIN\)/);
  assert.match(configSource, /url\.searchParams\.set\("game", gameId\)/);
  assert.match(configSource, /url\.searchParams\.set\("parent", location\.origin\)/);
  // A missing origin must surface as a message, never as a half-built frame.
  const player = read(path.join(JS_DIR, "player.js"));
  assert.match(player, /if \(!GAMES_ENABLED\)/);
  assert.match(player, /DISABLED_NOTICE/);
});

// ---------------------------------------------------------------------------
// the platform side of the link
// ---------------------------------------------------------------------------

test("platform.html reaches the section from nav, footer and bottom bar", () => {
  const html = read(path.join(ROOT, "platform.html"));
  assert.strictEqual((html.match(/href="online-games\/index\.html"/g) || []).length, 3);
  assert.match(html, /data-i18n="nav_online_games"/);
  // Game Hosting stays locked and released-later; this change must not touch it.
  assert.match(html, /is-soon[^>]*><span data-i18n="nav_game"/);
});

test("the i18n dictionary carries the section's Arabic labels", () => {
  const dict = read(path.join(ROOT, "platform", "i18n", "platform.dict.js"));
  for (const key of ["ألعاب أونلاين", "ألعاب مشابهة", "ألعاب أخرى", "ابدأ اللعب", "كل الألعاب", "خروج"]) {
    assert.ok(dict.includes(`'${key}':`), "missing dict entry: " + key);
  }
  // by-source-text: the English surfaces keep working when Arabic is the source.
  assert.match(dict, /OmniLang\.registerDict\('ar', \{/);
});

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

test("every interactive control of this section has a 48px touch target", () => {
  for (const selector of [".og-search input", ".og-chip", ".og-btn", ".og-back", ".og-iconbtn"]) {
    const rule = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{[^}]*\\}", "m").exec(CSS);
    assert.ok(rule, "no rule for " + selector);
    assert.match(rule[0], /min-height:\s*48px/, selector + " must be at least 48px tall");
  }
  // The card is the biggest target on the page and must show a keyboard focus.
  assert.match(CSS, /\.og-card:focus-visible\s*\{[^}]*outline: 2px solid/);
});

test("the stylesheet is written in logical properties so RTL needs no second copy", () => {
  assert.match(CSS, /padding-inline:/);
  assert.match(CSS, /inset-inline-(start|end):/);
  assert.match(CSS, /margin-inline:/);
  assert.match(CSS, /inline-end/);
  assert.ok(!/float:\s*left/.test(CSS), "physical float breaks in RTL");
});

// ---------------------------------------------------------------------------
// module hygiene
// ---------------------------------------------------------------------------

test("section scripts build DOM with textContent only", () => {
  for (const { name, text } of jsFiles) {
    for (const [re, why] of [
      [/\.innerHTML\s*=/, "innerHTML"],
      [/insertAdjacentHTML/, "insertAdjacentHTML"],
      [/document\.write/, "document.write"],
      [/\beval\s*\(/, "eval"],
      [/new Function\s*\(/, "new Function"],
    ]) {
      assert.ok(!re.test(text), name + " must not use " + why);
    }
  }
});

test("section scripts read no cookie, storage, token or tenant id", () => {
  for (const { name, text } of jsFiles) {
    for (const token of [
      "document.cookie",
      "localStorage",
      "sessionStorage",
      "Authorization",
      "X-Tenant",
      "credentials: \"include\"",
    ]) {
      assert.ok(!text.includes(token), name + " must not touch " + token);
    }
    // The roster is the only fetch, and it is same-origin by construction.
    const fetches = text.match(/fetch\(/g) || [];
    if (name !== "roster.js") {
      assert.strictEqual(fetches.length, 0, name + " must not fetch");
    }
  }
  const roster = jsFiles.find((f) => f.name === "roster.js");
  assert.match(roster.text, /fetch\("ROSTER\.json", \{ credentials: "same-origin" \}\)/);
  // A JSON file can be tampered with but cannot execute: no script element is
  // ever created from the roster.
  assert.ok(!/createElement\(["']script["']\)/.test(roster.text), "the roster must be data, not code");
});
