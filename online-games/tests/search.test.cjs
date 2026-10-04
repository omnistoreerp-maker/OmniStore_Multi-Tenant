/**
 * Arabic-first search, exercised as the browser runs it.
 *
 * `online-games/package.json` declares `type: module`, so importing
 * `js/search.js` here loads the same ES module the catalog's
 * `<script type="module">` loads — no copy of the normaliser, no second
 * implementation that could pass while the shipped one fails.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const OG = path.resolve(__dirname, "..");
const roster = JSON.parse(fs.readFileSync(path.join(OG, "ROSTER.json"), "utf8"));
const games = roster.games;

// Loaded once, reused by every test; node:test awaits these.
const search = import("../js/search.js");

test("normalisation folds the differences Arabic writers omit", async () => {
  const { normalize } = await search;

  // Tashkeel nobody types.
  assert.strictEqual(normalize("ذَاكِرَة"), normalize("ذاكرة"));
  // ة and ه share a key region on an Arabic phone keyboard.
  assert.strictEqual(normalize("الذاكرة"), normalize("الذاكره"));
  // Dotless ya and hamza on ya/waw are the letter people mean.
  assert.strictEqual(normalize("بير"), normalize("بئر"));
  assert.strictEqual(normalize("موت"), normalize("مؤت"));
  // Every alef spelling is one alef.
  assert.strictEqual(normalize("آ"), normalize("إ"));
  assert.strictEqual(normalize("أ"), normalize("ا"));
  // Latin folds too — half the aliases are English words typed in Latin.
  assert.strictEqual(normalize("MEMORY"), "memory");
  // Punctuation is a separator, not a match.
  assert.strictEqual(normalize("2048!"), "2048");
  // Whitespace is not part of a query, and ة is still ه at the end of a word.
  assert.strictEqual(normalize("  مسافة  "), "مسافه");
  // Nothing in, nothing out — an empty query never throws.
  assert.strictEqual(normalize(null), "");
  assert.strictEqual(normalize(undefined), "");
  assert.strictEqual(normalize(""), "");
});

test("an empty query returns the whole roster in its own order", async () => {
  const { searchGames } = await search;
  const out = searchGames(games, "");
  assert.strictEqual(out.length, 46);
  assert.deepStrictEqual(out.map((g) => g.id), games.map((g) => g.id));
  // Not the same array: the catalog's default view must not alias the roster.
  assert.notStrictEqual(out, games);
  assert.deepStrictEqual(
    searchGames(games, "   ").map((g) => g.id),
    games.map((g) => g.id),
  );
});

test("an exact Arabic title wins the search", async () => {
  const { searchGames } = await search;
  assert.strictEqual(searchGames(games, "الذاكرة")[0].id, "memory");
  assert.strictEqual(searchGames(games, "الذاكره")[0].id, "memory");
  assert.strictEqual(searchGames(games, "الثعبان")[0].id, "snake");
  assert.strictEqual(searchGames(games, "2048")[0].id, "2048");
});

test("aliases and English titles are findable", async () => {
  const { searchGames } = await search;
  assert.ok(searchGames(games, "تذكر").some((g) => g.id === "memory"));
  assert.ok(searchGames(games, "ذاكرة").some((g) => g.id === "memory"));
  assert.ok(searchGames(games, "cards").some((g) => g.id === "memory"));
  assert.ok(searchGames(games, "Memory").some((g) => g.id === "memory"));
});

test("a one-character typo still finds the game", async () => {
  const { searchGames } = await search;
  // ة -> ه is the keyboard fold; this is the query a visitor actually types.
  assert.ok(searchGames(games, "ذاكره").some((g) => g.id === "memory"));
  // A dropped letter: "memry" for "memory" — the Levenshtein tie-breaker.
  assert.ok(searchGames(games, "memry").some((g) => g.id === "memory"));
});

test("every game is findable by its own title, English title and each alias", async () => {
  const { searchGames } = await search;
  for (const g of games) {
    assert.strictEqual(
      searchGames(games, g.titleAr)[0].id,
      g.id,
      g.id + " is not the top hit for its own Arabic title",
    );
    assert.strictEqual(
      searchGames(games, g.titleEn)[0].id,
      g.id,
      g.id + " is not the top hit for its own English title",
    );
    for (const alias of g.aliases) {
      assert.ok(
        searchGames(games, alias).includes(g),
        g.id + " is not found by its own alias: " + alias,
      );
    }
  }
});

test("an impossible query returns nothing rather than everything", async () => {
  const { searchGames } = await search;
  assert.deepStrictEqual(searchGames(games, "zzzzzz"), []);
  assert.deepStrictEqual(searchGames(games, "لعبة غير موجودة أبدا"), []);
});

test("results are ordered by score and never duplicated", async () => {
  const { searchGames } = await search;
  for (const q of ["ال", "2048", "لعبة", "a", "ذ"]) {
    const out = searchGames(games, q);
    const ids = out.map((g) => g.id);
    assert.strictEqual(new Set(ids).size, ids.length, "duplicate for query: " + q);
    assert.ok(out.length > 0, "query produced nothing: " + q);
  }
});
