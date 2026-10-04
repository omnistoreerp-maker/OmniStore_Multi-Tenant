/**
 * Which origin serves the games, and nothing else.
 *
 * THE ORIGIN IS OWNER CONFIGURATION, NOT A CONSTANT. It ships EMPTY: the
 * platform's own `platform/monetag.js` boundary sets the precedent for this —
 * an owner-supplied value is never invented, because a guessed hostname is a
 * hostname that will silently frame whatever is actually parked there. The
 * operator writes the real value into the `<meta name="games-origin">` tag in
 * `index.html`, `game.html` and `play.html` at deploy time.
 *
 * `?gamesOrigin=` exists for ONE case: local QA, where the platform is served
 * from one port and `online-games/runtime/dist` from another and no DNS name
 * exists for either. It is honoured only when this page itself is on a local
 * host, so a visitor cannot point the platform's player at a third-party
 * origin by handing somebody a crafted link — the meta stays authoritative in
 * production.
 *
 * Every candidate must be a BARE origin (no path, query, hash or credentials)
 * and must not be this page's own origin: `frame-src 'self'` is forbidden by
 * section-lockdown, so a same-origin answer would be a configuration error
 * that the CSP then reports as a broken frame rather than as a bad setting.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

/** Whether the page we are running on is a local QA host. */
export function isLocalHost(hostname) {
  const raw = String(hostname || "").toLowerCase();
  const bare = raw.replace(/^\[|\]$/g, "");
  if (LOCAL_HOSTS.has(bare) || LOCAL_HOSTS.has(raw)) return true;
  return bare.endsWith(".localhost");
}

/** "" unless `raw` is a bare, well-formed http(s) origin. */
export function normalizeOrigin(raw) {
  const value = String(raw == null ? "" : raw).trim();
  if (!value) return "";
  let url;
  try {
    url = new URL(value);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  if (url.username || url.password) return "";
  if (url.search || url.hash) return "";
  if (url.pathname !== "/") return "";
  if (url.origin === location.origin) return "";
  return url.origin;
}

function metaOrigin() {
  const el = document.querySelector('meta[name="games-origin"]');
  return el ? el.content : "";
}

function queryOrigin() {
  if (!isLocalHost(location.hostname)) return "";
  return new URLSearchParams(location.search).get("gamesOrigin") || "";
}

/** Resolved once. "" means the section cannot launch a game yet. */
export const GAMES_ORIGIN = normalizeOrigin(queryOrigin()) || normalizeOrigin(metaOrigin());

/** Whether a game can actually be launched from this page. */
export const GAMES_ENABLED = GAMES_ORIGIN !== "";

/**
 * The sandbox token list, verbatim. Written here rather than in the HTML so a
 * test can assert one string and the three pages cannot drift apart.
 *
 * - `allow-scripts`  the game is JavaScript
 * - `allow-same-origin` the frame must read its OWN cookies-free origin (its
 *   document, its fonts) — it does not gain this page's origin, because it
 *   was already cross-origin before the tokens were applied
 * - `allow-pointer-lock` mouse capture for the games that use it
 * - `allow-presentation` the presentation API some devices expose
 *
 * Fullscreen is deliberately NOT a sandbox token: there is no `allow-fullscreen`
 * flag in the HTML spec, and Chromium logs "invalid sandbox flag" for one. It
 * is granted the way the platform grants it to itself — through the frame's
 * `allow="fullscreen"` attribute (see player.js).
 *
 * Deliberately ABSENT: `allow-top-navigation`, `allow-modals`,
 * `allow-forms`, `allow-popups`. The frame must not move this page, must not
 * cover it with a dialog, and has no form to submit or window to open.
 * Exit is a postMessage, not a navigation.
 */
export const FRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-pointer-lock allow-presentation";

/**
 * The URL the player iframe loads: the frame's own document, told which game
 * to run and which page to talk to.
 *
 * `parent` is this page's ORIGIN, not its URL — the frame rejects anything
 * that is not a bare origin, which is exactly what a targetOrigin has to be.
 */
export function frameUrl(gameId) {
  const url = new URL("/", GAMES_ORIGIN);
  url.searchParams.set("game", gameId);
  url.searchParams.set("parent", location.origin);
  return url.toString();
}

/** The three message types the platform accepts from the games origin. */
export const ALLOWED_FROM_GAMES = Object.freeze([
  "omnigames:ready",
  "omnigames:request-exit",
  "omnigames:load-error",
]);

/** The text shown wherever a game cannot be launched, so all three pages agree. */
export const DISABLED_NOTICE = {
  title: "قسم الألعاب غير مُفعّل بعد",
  detail:
    "لم يُحدَّد أصل الألعاب (games origin) في إعدادات النشر. تُفعَّل الألعاب تلقائياً فور كتابة عنوان الخادم في وسم games-origin.",
};
