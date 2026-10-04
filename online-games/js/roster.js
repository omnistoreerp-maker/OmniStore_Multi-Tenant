/**
 * The roster: the ONE list of games this section is allowed to show.
 *
 * `ROSTER.json` is generated (`scripts/build-roster.mjs`) from the license gate
 * plus the foundation's own metadata plus `scripts/arabic-content.json`, and
 * `scripts/build-roster.mjs --check` proves the file on disk matches those
 * inputs. Nothing here may add, rename or drop a game: the page reads the file
 * and renders what it says.
 *
 * The fetch is same-origin, which is the only kind the platform's CSP allows
 * (`connect-src 'self'`) — and the reason this is a fetch rather than a
 * `<script>` is that JSON cannot execute: a tampered roster that described a
 * game would be data, not code.
 */

let cache = null;

/** Fields every game must carry. A roster missing one of these is rejected. */
const REQUIRED = ["id", "dir", "titleAr", "summaryAr", "category", "emoji", "color"];

const CATEGORIES = new Set(["learn", "think", "kids", "speed", "create", "classics"]);

/** Fetch and validate `ROSTER.json`. The result is cached for the page's life. */
export async function loadRoster() {
  if (cache) return cache;

  const res = await fetch("ROSTER.json", { credentials: "same-origin" });
  if (!res.ok) throw new Error("ROSTER.json unavailable (HTTP " + res.status + ")");

  const data = await res.json();

  if (!data || !Array.isArray(data.games)) throw new Error("roster.games missing");
  if (!Array.isArray(data.categories) || data.categories.length !== 6) {
    throw new Error("roster.categories must be exactly 6");
  }
  if (data.totals && data.totals.games !== data.games.length) {
    throw new Error("roster.totals.games disagrees with roster.games");
  }

  const seen = new Set();
  for (const game of data.games) {
    for (const field of REQUIRED) {
      if (typeof game[field] !== "string" || !game[field]) {
        throw new Error("roster game missing " + field + ": " + (game && game.id));
      }
    }
    if (!CATEGORIES.has(game.category)) {
      throw new Error("roster game has an unknown category: " + game.id);
    }
    if (seen.has(game.id)) throw new Error("duplicate roster id: " + game.id);
    seen.add(game.id);
  }

  cache = Object.freeze({
    games: Object.freeze(data.games.slice()),
    categories: Object.freeze(data.categories.slice()),
    ageBands: Object.freeze((data.ageBands || []).slice()),
    totals: data.totals || { games: data.games.length },
  });
  return cache;
}

/** The game with this id, or undefined. */
export function gameById(roster, id) {
  if (!id) return undefined;
  return roster.games.find((g) => g.id === id);
}

/** The category record for an id, or a neutral fallback. */
export function categoryById(roster, id) {
  return roster.categories.find((c) => c.id === id) || { id: id, labelAr: id, count: 0 };
}

/** Build a link to this section's pages from anywhere on the platform. */
export function gameHref(id) {
  return "game.html?id=" + encodeURIComponent(id);
}

export function playHref(id) {
  return "play.html?id=" + encodeURIComponent(id);
}
