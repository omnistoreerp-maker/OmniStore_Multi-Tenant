/**
 * Regression tests for the marketplace production build contract.
 *
 * Production failure being guarded (omnistoreerp.com, verified 2026-10-05):
 *   GET /marketplace/            -> 200 (tracked entry, refs ./dist/assets/<hash>.*)
 *   GET ./dist/assets/<hash>.js  -> 404  (stale gitignored dist in the runtime)
 *   GET ./dist/assets/<hash>.css -> 404
 * Result: blank page with healthy market APIs.
 *
 * Contract under test (scripts/postbuild.js):
 *   - rewrites the tracked PRODUCTION entry (marketplace/index.html) from the
 *     vite build output and prefixes local refs with ./dist/
 *   - FAILS THE BUILD when either HTML entry references a local asset that
 *     does not exist on disk (the exact state production was serving)
 *   - never emits an entry that references /src/main.tsx (vite dev input)
 *
 * dist/ stays gitignored/untracked by design (marketplace/.gitignore:11):
 * these tests build their own sandbox trees, no repo dist is needed.
 *
 * Run (repo root, no extra deps):
 *   node marketplace/tests/entry-assets.test.cjs
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const REPO = path.resolve(__dirname, "..", "..");
const POSTBUILD = path.join(REPO, "marketplace", "scripts", "postbuild.js");

let passed = 0, failed = 0;
const check = (name, fn) => {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e) { failed++; console.log("FAIL  " + name + "  (" + String(e.message || e).split("\n")[0] + ")"); }
};
const sandbox = () => fs.mkdtempSync(path.join(os.tmpdir(), "mktpost-"));
const write = (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };

(async () => {
  const m = await import(pathToFileURL(POSTBUILD).href);

  check("localAssetRefs: keeps local refs, drops external/#/scheme refs", () => {
    const refs = m.localAssetRefs(
      '<script src="./assets/a.js"></script>' +
      '<link href="./dist/i18n/x.js?v=2">' +
      '<link href="https://fonts.googleapis.com/css2?family=Cairo">' +
      '<a href="#/product/1">x</a>' +
      '<img src="data:image/png;base64,AAAA">'
    );
    assert.deepStrictEqual(refs.map((r) => r.ref), ["./assets/a.js", "./dist/i18n/x.js?v=2"]);
  });

  check("gate: passes when every referenced asset exists", () => {
    const dir = sandbox();
    write(path.join(dir, "a.js"), "x");
    write(path.join(dir, "sub", "b.css"), "x");
    m.assertReferencedAssetsExist('<script src="./a.js"></script><link href="sub/b.css">', dir, "t");
  });

  check("gate: fails listing every missing asset (prod failure mode)", () => {
    const dir = sandbox();
    write(path.join(dir, "a.js"), "x");
    assert.throws(
      () => m.assertReferencedAssetsExist(
        '<script src="./a.js"></script><script src="./assets/missing-BjCu6Mzp.js"></script><link href="./assets/missing-D8X.css">',
        dir, "marketplace/index.html"
      ),
      (err) => /missing asset/.test(err.message) && /missing-BjCu6Mzp\.js/.test(err.message) && /missing-D8X\.css/.test(err.message)
    );
  });

  check("gate: refs resolve against the entry's own directory", () => {
    const dir = sandbox();
    write(path.join(dir, "assets", "ok.js"), "x");
    m.assertReferencedAssetsExist('<script src="./assets/ok.js"></script>', dir, "t");
    assert.throws(
      () => m.assertReferencedAssetsExist('<script src="./assets/other.js"></script>', path.join(dir, "assets"), "t2"),
      /missing asset/
    );
  });

  check("runBuildPublication: happy path publishes entries (vite already copied public/)", () => {
    // vite build copies public/* into dist/ itself (publicDir default);
    // postbuild must leave that output alone and only publish the entries.
    const dir = sandbox();
    const assets = path.join(dir, "dist", "assets");
    write(path.join(assets, "dev-OK1.js"), "console.log(1)");
    write(path.join(assets, "dev-OK2.css"), "body{}");
    write(path.join(dir, "dist", "favicon.svg"), "<svg/>");
    write(path.join(dir, "dist", "i18n", "m.dict.js"), "window.X=1");
    write(
      path.join(dir, "dist", "dev.html"),
      '<!doctype html><html><head>' +
      '<link rel="icon" href="./favicon.svg">' +
      '<script type="module" crossorigin src="./assets/dev-OK1.js"></script>' +
      '<link rel="stylesheet" crossorigin href="./assets/dev-OK2.css"></head>' +
      '<body><div id="root"></div></body></html>'
    );
    m.runBuildPublication({ pkgRoot: dir });

    const built = fs.readFileSync(path.join(dir, "dist", "index.html"), "utf8");
    assert.ok(built.includes('src="./assets/dev-OK1.js"') && built.includes('href="./favicon.svg"'), "dist entry intact");
    const entry = fs.readFileSync(path.join(dir, "index.html"), "utf8");
    assert.ok(entry.includes('src="./dist/assets/dev-OK1.js"'), "root entry prefixed");
    assert.ok(entry.includes('href="./dist/favicon.svg"'), "favicon prefixed");
    assert.ok(fs.existsSync(path.join(dir, "dist", "i18n", "m.dict.js")), "vite-copied public output untouched");
    assert.ok(!fs.existsSync(path.join(dir, "dist", "dev.html")), "dev.html consumed");
    assert.ok(!entry.includes("/src/main.tsx"), "no dev input in root entry");
  });

  check("runBuildPublication: fails when built entry references a missing asset", () => {
    const dir = sandbox();
    const assets = path.join(dir, "dist", "assets");
    write(path.join(assets, "dev-OK.css"), "x");
    write(
      path.join(dir, "dist", "dev.html"),
      '<script type="module" crossorigin src="./assets/dev-MISSING.js"></script>' +
      '<link rel="stylesheet" crossorigin href="./assets/dev-OK.css">'
    );
    assert.throws(
      () => m.runBuildPublication({ pkgRoot: dir }),
      (err) => /dist\/index\.html references 1 missing/.test(err.message) && /dev-MISSING\.js/.test(err.message)
    );
    assert.ok(!fs.existsSync(path.join(dir, "index.html")), "root entry NOT rewritten on failure");
  });

  check("runBuildPublication: fails without dist/dev.html (vite input contract)", () => {
    const dir = sandbox();
    assert.throws(() => m.runBuildPublication({ pkgRoot: dir }), /dist\/dev\.html missing/);
  });

  check("importing postbuild.js must not run the publication (run-mode guard)", () => {
    // The suite already imported POSTBUILD at the top WITHOUT a repo dist/
    // present; a broken direct-run guard would have thrown
    // "dist/dev.html missing" during that import and failed the whole run.
    assert.strictEqual(typeof m.localAssetRefs, "function");
    assert.strictEqual(typeof m.assertReferencedAssetsExist, "function");
    assert.strictEqual(typeof m.runBuildPublication, "function");
    assert.ok(!fs.existsSync(path.join(REPO, "marketplace", "dist", "dev.html")), "no dist/dev.html in repo");
  });

  check("tracked PRODUCTION entry references only files present in the repo tree (live repo)", () => {
    // Deploy-build simulation against the REAL tree: the committed
    // marketplace/index.html + committed public/ + freshly built dist/ must
    // form a closed asset graph. This is exactly what the CI gate checks.
    const entryPath = path.join(REPO, "marketplace", "index.html");
    const html = fs.readFileSync(entryPath, "utf8");
    const refs = m.localAssetRefs(html).map((r) => r.ref);
    assert.ok(refs.length > 0, "entry has local refs");
    for (const ref of refs) {
      const bare = ref.split(/[?#]/)[0];
      const resolved = path.resolve(REPO, "marketplace", decodeURIComponent(bare));
      let exists = false;
      try { exists = fs.statSync(resolved).isFile(); } catch { exists = false; }
      assert.ok(exists, "referenced asset exists in repo tree: " + ref);
    }
    assert.ok(!html.includes("/src/main.tsx"), "tracked entry must never reference the vite dev input");
  });

  console.log("--------------------------------");
  console.log(failed === 0 ? "ENTRY_ASSETS_TEST=PASS" : "ENTRY_ASSETS_TEST=FAIL failures=" + failed);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
