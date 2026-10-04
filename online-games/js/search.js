/**
 * Arabic-first search over the roster.
 *
 * WHY NORMALISATION, NOT `includes`. A player types "ذاكره" or "ذاكرت" or
 * "ذَاكِرَة" and all three mean الذاكرة; a plain substring test misses two of
 * them, and the section then looks broken to exactly the audience it is for.
 * The normaliser below folds the differences that Arabic writers omit or
 * interchange on a phone keyboard, and nothing else — it does not stem, does
 * not reorder and does not transliterate, because every one of those can turn
 * one game into a hit for another.
 *
 * Latin input is folded the same way (`MEMORY` == `memory`), which is why the
 * English title and the English aliases are searched in the same pass: half
 * the roster's aliases are English words a kid will type in Latin letters.
 */

/** Combining marks Arabic text carries and nobody types when searching. */
const DIACRITICS = /[ً-ْٰـ]/g;

/** Alef with hamza/madda, bare alef, and the dotless ya — one letter when typed. */
const ALEF = /[آأإٲٳ]/g;
const YA = /ى/g;
const HA = /ة/g;
const HAMZA = /[ؤئ]/g;

/**
 * Everything two spellings of the same word disagree about.
 *
 * `ة` → `ه` and `ؤ`/`ئ` → `و`/`ي` are the two that matter in practice: keyboard
 * layouts put ة and ه on the same key region and hamza on ي is often dropped,
 * so "بئر" and "بير" are one search. Both are lossy, which is fine for MATCHING
 * and is why nothing is ever written back.
 */
export function normalize(value) {
  return String(value == null ? "" : value)
    .toLowerCase()
    .replace(DIACRITICS, "")
    .replace(ALEF, "ا")
    .replace(YA, "ي")
    .replace(HA, "ه")
    .replace(HAMZA, (m) => (m === "ؤ" ? "و" : "ي"))
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every string a game is findable by, pre-normalised once. */
function haystack(game) {
  if (game.__search) return game.__search;
  const parts = [game.titleAr, game.titleEn, game.id, ...(game.aliases || [])];
  const norm = parts.map(normalize).filter(Boolean);
  const out = { title: normalize(game.titleAr), titleEn: normalize(game.titleEn), all: norm };
  Object.defineProperty(game, "__search", { value: out, enumerable: false });
  return out;
}

/** Levenshtein distance, capped — used only as a tie-breaker for long queries. */
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = prev[j];
      prev[j] = next;
    }
    if (Math.min(...prev) > 2) return 3;
  }
  return prev[b.length];
}

/**
 * 0 for "no match", higher for a better one.
 *
 * The ladder is ordered so an exact title always beats a typo in an alias, and
 * a prefix always beats a substring: typing "سم" should surface سنيك before it
 * surfaces a game that merely contains those letters in the middle.
 */
export function score(game, query) {
  const q = normalize(query);
  if (!q) return 1;
  const h = haystack(game);

  if (h.title === q || h.titleEn === q) return 100;

  let best = 0;
  for (const part of h.all) {
    if (part === q) best = Math.max(best, 95);
    else if (part.startsWith(q)) best = Math.max(best, 85);
    else if (part.includes(q)) best = Math.max(best, 65);
    else if (q.length >= 4 && distance(part, q) <= 1) best = Math.max(best, 55);
  }
  if (best) return best;

  // Word-level: the query matches the start of some word in a longer phrase
  // ("لعبة الذاكرة" -> "ذاكره"), which a plain includes() test also finds but
  // only after the word boundary, so the score stays below a direct hit.
  const words = h.all.join(" ").split(" ").filter(Boolean);
  if (words.some((w) => w.startsWith(q))) return 50;
  return 0;
}

/**
 * Games matching `query`, best first. An empty query returns the roster in its
 * own order — the catalog's default view must not depend on a search box.
 */
export function searchGames(games, query) {
  const q = normalize(query);
  if (!q) return games.slice();
  const hits = [];
  for (const game of games) {
    const s = score(game, q);
    if (s > 0) hits.push({ game: game, s: s });
  }
  hits.sort((a, b) => b.s - a.s || a.game.titleAr.localeCompare(b.game.titleAr, "ar"));
  return hits.map((h) => h.game);
}
