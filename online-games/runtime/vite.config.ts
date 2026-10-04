/**
 * The OmniStore online-games runtime build.
 *
 * ONE build for all 46 licensed games, unlike Ellaz's `vite.standalone.config.ts`
 * which emits one bundle per game. That split exists because an itch.io zip has
 * to be a single game; here the roster is fixed at 46 and the platform catalog
 * is on the other origin, so per-game Rollup chunks (from `import.meta.glob` in
 * portal/catalog.ts) give the same "only load what was opened" property without
 * 46 invocations of Rollup.
 *
 * WHAT IS DELIBERATELY ABSENT, AND WHY EACH ABSENCE IS LOAD-BEARING
 *
 *   VitePWA      a service worker on this origin would cache the player frame
 *                and its navigation fallback would hijack the platform's routes.
 *                This build never registers one.
 *   pagesPlugin  52 prose pages, none of which this origin serves: the catalog,
 *                the details page and the player chrome are on the platform
 *                origin and are plain HTML there.
 *   themeBoot    the frame sets `data-theme` statically in index.html; there is
 *                no theme picker inside a player frame to boot against.
 *   analytics    `posthog-js` is stubbed at resolution (below). A game may make
 *                no external request — that is what lets the frame ship with
 *                `connect-src 'none'` and still work.
 *
 * `src/main.tsx` is unusable as the entry for a second reason: it imports
 * `virtual:pwa-register`, which only exists while the PWA plugin is loaded.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const CLOUD_STUB = "\0omnistore-stub-cloud";
const TELEMETRY_STUB = "\0omnistore-stub-telemetry";

/**
 * Keep the cloud client and the analytics library out of a bundle that is
 * served to children with `connect-src 'none'`.
 *
 * BOTH ARRIVE WITHOUT BEING WANTED, and neither is visible from the entry:
 * `portal/GameHost` mounts through `@sdk/index`, which re-exports `./cloudSync`,
 * which dynamically imports `./cloud` — and `cloud.ts` is where
 * `firestore.googleapis.com`, `identitytoolkit.googleapis.com` and
 * `securetoken.googleapis.com` are written down. Dead bytes either way: nothing
 * in this runtime calls `startCloudSync`. They would also be sitting in an
 * artifact that claims to make no network requests, which is how a reviewer
 * finds a Firestore endpoint in a kids' game.
 *
 * Stubbed at RESOLUTION rather than pruned afterwards, because a chunk that is
 * never emitted cannot be forgotten later. The cloud stub THROWS on any
 * property access: if this build ever does reach for it, that must be loud.
 * The telemetry stub is an empty object instead, because `loadPostHog()` already
 * answers null for "no usable library" and a throw would take a different path.
 */
function noNetworkClients(): Plugin {
  const cloud = /\/src\/sdk\/cloud\.ts$/;
  return {
    name: "omnistore-online-games-no-network-clients",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer) return null;
      if (source === "posthog-js") return TELEMETRY_STUB;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved) return null;
      if (cloud.test(resolved.id.replace(/\\/g, "/"))) return CLOUD_STUB;
      return null;
    },
    load(id) {
      if (id === CLOUD_STUB) {
        return `export default new Proxy({}, { get() {
          throw new Error("omnistore online-games runtime reached the cloud client; this build ships neither it nor a network");
        }});`;
      }
      if (id === TELEMETRY_STUB) {
        return "export default {};";
      }
      return null;
    },
  };
}

/** The stamp in index.html, so a running frame says which tree built it. */
function buildStamp(): Plugin {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: fileURLToPath(new URL("../..", import.meta.url)) }).trim();
  const dirty =
    execFileSync("git", ["status", "--porcelain"], { encoding: "utf8", cwd: fileURLToPath(new URL("../..", import.meta.url)) }).trim() !== "";
  const stamp = dirty ? `${sha}-dirty` : sha;
  return {
    name: "omnistore-online-games-stamp",
    transformIndexHtml(html) {
      const filled = html.replaceAll("__OMNISTORE_BUILD__", stamp);
      if (filled.includes("__OMNISTORE_")) throw new Error("index.html placeholder left unfilled");
      return filled;
    },
  };
}

export default defineConfig({
  base: "/",
  plugins: [noNetworkClients(), react(), buildStamp()],
  resolve: {
    alias: {
      "@sdk": fileURLToPath(new URL("./src/sdk", import.meta.url)),
      "@ui": fileURLToPath(new URL("./src/ui", import.meta.url)),
      "@juice": fileURLToPath(new URL("./src/juice", import.meta.url)),
      "@i18n": fileURLToPath(new URL("./src/i18n", import.meta.url)),
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
    },
  },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: fileURLToPath(new URL("./index.html", import.meta.url)),
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/phaser")) return "vendor-phaser";
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) {
            return "vendor-react";
          }
        },
      },
    },
  },
});
