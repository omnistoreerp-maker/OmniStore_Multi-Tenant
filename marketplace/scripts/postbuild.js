import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
 */
const pkgRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
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
fs.writeFileSync(path.join(pkgRoot, "index.html"), rootEntry);

console.log("postbuild: dist/index.html + marketplace/index.html ready");