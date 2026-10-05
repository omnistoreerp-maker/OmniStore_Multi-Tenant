import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Root-cause fixup for "GET /marketplace/ serves the Vite source HTML".
 *
 * backend/server.js mounts express.static(repo root, { index: "index.html" }),
 * so /marketplace/ resolves to <repo>/marketplace/index.html. That file is
 * therefore the PRODUCTION entry, while vite builds from dev.html.
 *
 * Steps:
 *  1. dist/dev.html -> dist/index.html  (keeps the /marketplace/dist/ entry)
 *  2. marketplace/index.html = built html with local refs prefixed "./dist/"
 *  3. GATE: every local JS/CSS/img ref in BOTH entries must resolve to a file
 *     on disk, or the build fails. Production once served a tracked entry
 *     whose ./dist/assets/*.js|css hashes no longer existed (200 HTML + 404
 *     assets = blank page); this gate makes that state impossible to ship
 *     silently from a build that actually ran.
 *
 * dist/ is gitignored (generated at deploy time); this script keeps the
 * tracked entry in lockstep with the build that produced it.
 */

const MODULE_URL = import.meta.url;

/**
 * Extract local (same-origin, non-external) asset refs from an HTML string.
 * Returns [{ ref, path }]: ref keeps any ?query#hash suffix for reporting;
 * path is the bare file path used for the existence probe.
 */
export function localAssetRefs(html) {
  const refs = [];
  const attrRe = /(?:src|href)\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = attrRe.exec(html)) !== null) {
    let ref = m[1].trim();
    if (!ref || ref.startsWith("#")) continue;
    let suffix = "";
    const cut = ref.search(/[?#]/);
    if (cut !== -1) {
      suffix = ref.slice(cut);
      ref = ref.slice(0, cut);
    }
    if (/^(https?:)?\/\//i.test(ref)) continue; // external (fonts, CDNs)
    if (/^[a-z]+:/i.test(ref)) continue; // mailto:, data:, etc.
    refs.push({ ref: ref + suffix, path: ref });
  }
  return refs;
}

/** Throw unless every local ref in `html` resolves to an existing file. */
export function assertReferencedAssetsExist(html, baseDir, label) {
  const missing = [];
  for (const { ref, path: refPath } of localAssetRefs(html)) {
    const resolved = path.resolve(baseDir, decodeURIComponent(refPath));
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      missing.push(ref + "  ->  " + path.relative(baseDir, resolved));
    }
  }
  if (missing.length > 0) {
    throw new Error(
      "postbuild: " + label + " references " + missing.length + " missing asset(s):\n  " +
      missing.join("\n  ")
    );
  }
}

export function runBuildPublication({ pkgRoot } = {}) {
  pkgRoot = pkgRoot || path.dirname(path.dirname(fileURLToPath(MODULE_URL)));
  const dist = path.join(pkgRoot, "dist");
  const devHtml = path.join(dist, "dev.html");
  const distIndex = path.join(dist, "index.html");

  if (!fs.existsSync(devHtml)) {
    throw new Error("postbuild: dist/dev.html missing - vite build input must be dev.html");
  }
  fs.renameSync(devHtml, distIndex);

  const built = fs.readFileSync(distIndex, "utf8");
  if (built.includes("/src/main.tsx")) throw new Error("postbuild: built entry still references /src/main.tsx");
  if (!built.includes("./assets/")) throw new Error("postbuild: built entry has no ./assets references");

  const rootEntry = built.replaceAll('="./', '="./dist/');
  if (rootEntry.includes("/src/main.tsx")) throw new Error("postbuild: root entry references /src/main.tsx");
  if (!rootEntry.includes("./dist/assets/")) throw new Error("postbuild: root entry does not point at ./dist/assets/");

  // GATE 1: the built dist entry must only reference files vite emitted.
  assertReferencedAssetsExist(built, dist, "dist/index.html");
  // GATE 2: the published root entry (served at GET /marketplace/) must only
  // reference files that exist inside the repo tree, dist included.
  assertReferencedAssetsExist(rootEntry, pkgRoot, "marketplace/index.html");

  fs.writeFileSync(path.join(pkgRoot, "index.html"), rootEntry);

  console.log("postbuild: dist/index.html + marketplace/index.html ready (all referenced assets exist)");
}

// Run only when executed directly (node scripts/postbuild.js), so tests can
// import the exported gate functions against sandbox trees.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === MODULE_URL) {
  runBuildPublication();
}
