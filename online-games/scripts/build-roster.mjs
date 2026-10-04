#!/usr/bin/env node
/**
 * Builds online-games/ROSTER.json — the production roster the platform catalog,
 * the details page, the player page and portal/shellRoster.ts all read.
 *
 * THREE INPUTS, AND NONE OF THEM CAN ADD A GAME:
 *   1. ROSTER_GATE.json      safeIds + idToDirectoryExceptions + foundation pin
 *   2. meta.ts per SAFE game the title/category/ageBand/orientation/renderer
 *                            the foundation actually documents
 *   3. arabic-content.json   the Arabic strings Ellaz does not ship
 *
 * A fourth input would be a second source of truth, so there isn't one.
 *
 * Usage:
 *   node online-games/scripts/build-roster.mjs          # write ROSTER.json
 *   node online-games/scripts/build-roster.mjs --check  # fail if it would drift
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ONLINER = resolve(HERE, ".."); // online-games/
const ROOT = resolve(ONLINER, ".."); // repo root
const RUNTIME_SRC = join(ONLINER, "runtime", "src");

const gate = JSON.parse(readFileSync(join(ONLINER, "ROSTER_GATE.json"), "utf8"));
const arabic = JSON.parse(readFileSync(join(HERE, "arabic-content.json"), "utf8"));

const fail = (msg) => {
  console.error("build-roster: " + msg);
  process.exit(1);
};

/** Remove block and line comments so prose in meta.ts cannot satisfy a field regex. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

function field(src, name, file) {
  const m = src.match(new RegExp("(?:^|[\\s{,])" + name + ':\\s*"([^"]*)"'));
  if (!m) fail(`meta.ts for ${file} has no ${name}`);
  return m[1];
}

function optionalField(src, name) {
  const m = src.match(new RegExp("(?:^|[\\s{,])" + name + ':\\s*"([^"]*)"'));
  return m ? m[1] : null;
}

function dirFor(id) {
  const ex = gate.idToDirectoryExceptions ?? {};
  return Object.prototype.hasOwnProperty.call(ex, id) ? ex[id] : id;
}

// --- 1. Roster order comes from the gate, never from the filesystem. ---------
const safeSet = new Set(gate.safeIds);
const ids = gate.rosterIds.filter((id) => safeSet.has(id));
if (ids.length !== gate.safeGameCount) {
  fail(`roster produced ${ids.length} games, gate declares ${gate.safeGameCount}`);
}
if (new Set(ids).size !== ids.length) fail("duplicate id in roster");

const games = [];
for (const id of ids) {
  const dir = dirFor(id);
  const rel = `runtime/src/games/${dir}/meta.ts`;
  let raw;
  try {
    raw = readFileSync(join(RUNTIME_SRC, "games", dir, "meta.ts"), "utf8");
  } catch {
    fail(`missing ${rel}`);
  }
  const src = stripComments(raw);
  const metaId = field(src, "id", rel);
  if (metaId !== id) fail(`${rel} declares id "${metaId}", gate says "${id}"`);

  const titleBlock = src.match(/title:\s*\{([^}]*)\}/);
  if (!titleBlock) fail(`${rel} has no title record`);
  const en = titleBlock[1].match(/(?:^|\s|,)en:\s*"([^"]*)"/);
  if (!en) fail(`${rel} has no English title`);

  const ar = arabic.games[id];
  if (!ar) fail(`arabic-content.json has no entry for "${id}"`);
  if (!ar.titleAr || !ar.titleAr.trim()) fail(`arabic-content.json has an empty titleAr for "${id}"`);
  if (!ar.summaryAr || ar.summaryAr.trim().length < 10) {
    fail(`arabic-content.json has no usable summaryAr for "${id}"`);
  }

  const category = field(src, "category", rel);
  const ageBand = field(src, "ageBand", rel);
  if (!arabic.categories[category]) fail(`${rel} uses a category not in arabic-content.json: ${category}`);
  if (!arabic.ageBands[ageBand]) fail(`${rel} uses an ageBand not in arabic-content.json: ${ageBand}`);

  games.push({
    id,
    dir,
    titleAr: ar.titleAr.trim(),
    titleEn: en[1],
    summaryAr: ar.summaryAr.trim(),
    aliases: (ar.aliases ?? []).map((a) => String(a).trim()).filter(Boolean),
    emoji: field(src, "emoji", rel),
    color: field(src, "color", rel),
    category,
    ageBand,
    orientation: field(src, "orientation", rel),
    renderer: field(src, "renderer", rel),
    scoreUnit: optionalField(src, "scoreUnit"),
  });
}

// --- 2. Nothing in arabic-content.json may name a game the gate does not. ----
const blocked = new Set(gate.blocked.map((b) => b.id));
for (const key of Object.keys(arabic.games)) {
  if (blocked.has(key)) fail(`arabic-content.json describes BLOCKED game "${key}"`);
  if (!safeSet.has(key)) fail(`arabic-content.json describes unknown game "${key}"`);
}
for (const key of Object.keys(arabic.categories)) {
  if (!["kids", "learn", "think", "speed", "create", "classics"].includes(key)) {
    fail(`unexpected category key "${key}" — OmniStore exposes exactly six`);
  }
}

const out = {
  roster: "omnistore-online-games",
  version: 1,
  language: "ar",
  direction: "rtl",
  foundation: gate.foundation,
  sourceContract: {
    gate: "online-games/ROSTER_GATE.json",
    arabicContent: "online-games/scripts/arabic-content.json",
    rule: "safeIds ∩ foundation meta.ts ∪ arabic-content.json. No other input may add or rename a game.",
  },
  // The licence gate (`roster-gate.test.cjs`) reads this list straight out of
  // the file it is checking, so the shipped roster and the gate's SAFE set are
  // compared as data rather than through somebody remembering to re-run both.
  rosterIds: ids,
  categories: ["learn", "think", "kids", "speed", "create", "classics"].map((id) => ({
    id,
    labelAr: arabic.categories[id].labelAr,
    count: games.filter((g) => g.category === id).length,
  })),
  ageBands: Object.entries(arabic.ageBands).map(([id, v]) => ({ id, labelAr: v.labelAr })),
  totals: {
    games: games.length,
    blocked: gate.blocked.length,
    authoritative: gate.authoritativeRosterCount,
  },
  games,
};

const json = JSON.stringify(out, null, 2) + "\n";
const target = join(ONLINER, "ROSTER.json");

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {
    fail("ROSTER.json does not exist — run without --check to create it");
  }
  if (current !== json) {
    fail("ROSTER.json is stale — run: node online-games/scripts/build-roster.mjs");
  }
  console.log(`ROSTER.json is current (${games.length} games).`);
  process.exit(0);
}

writeFileSync(target, json);
console.log(`ROSTER.json written: ${games.length} games, ${out.categories.length} categories.`);
