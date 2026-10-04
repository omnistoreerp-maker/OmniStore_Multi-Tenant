import type { Category, GameMeta, GameModule } from "@sdk/index";
import roster from "../../../ROSTER.json";
import { ROSTER_IDS, SHELL_GAMES } from "./shellRoster";

export interface CatalogEntry {
  meta: GameMeta;
  load: () => Promise<{ default: GameModule }>;
}

/**
 * `2048` is the one id whose directory is not its id (`n2048`), because a
 * module name cannot start with a digit. ROSTER.json carries the mapping so
 * nothing here has to restate it — GameMeta has no `dir` field, so it is read
 * back off the roster this entry was built from.
 */
const DIR_BY_ID: ReadonlyMap<string, string> = new Map(
  roster.games.map((g) => [g.id, g.dir] as const)
);

/**
 * One lazy loader per game.
 *
 * `import.meta.glob` rather than 46 written-out arrows: each matched file
 * becomes its own Rollup chunk, which is exactly the "load only the game the
 * player opened" split, and it cannot fall behind ROSTER.json — a roster id
 * with no module fails at module init (below), while a module with no roster
 * id gets no loader and is unreachable.
 */
const LOAD_GLOB = import.meta.glob<{ default: GameModule }>("../games/*/index.ts");

/**
 * Which categories exist, in the order the catalog presents them, and the
 * i18n key each label uses. Six, and only six: the platform exposes
 * ألعاب تعليمية / ذكاء / أطفال / سرعة / مهارات / كلاسيكية, and a seventh
 * entry here would be a filter nothing renders.
 */
export const CATEGORY_ORDER: ReadonlyArray<{
  category: Category;
  titleKey: string;
  glyph: string;
}> = [
  { category: "learn", titleKey: "catLearn", glyph: "🎓" },
  { category: "think", titleKey: "catThink", glyph: "🧠" },
  { category: "kids", titleKey: "catKids", glyph: "🧸" },
  { category: "speed", titleKey: "catSpeed", glyph: "⚡" },
  { category: "create", titleKey: "catSkills", glyph: "🎵" },
  { category: "classics", titleKey: "catClassics", glyph: "♟️" },
];

const entries: CatalogEntry[] = SHELL_GAMES.map((meta) => {
  const dir = DIR_BY_ID.get(meta.id) ?? meta.id;
  const load = LOAD_GLOB[`../games/${dir}/index.ts`];
  if (!load) throw new Error(`no loader for "${meta.id}" — runtime/src/games/${dir}/index.ts is missing`);
  return { meta, load };
});

/** The games whose metadata has arrived. Always all 46 — see shellRoster.ts. */
export function catalog(): ReadonlyArray<CatalogEntry> {
  return entries;
}

/** Every game in the roster. */
export const ROSTER_SIZE = ROSTER_IDS.length;

/**
 * Kept because callers exist and the name is the contract, but there is no
 * second half to arrive: the whole catalogue is in the shell chunk. Returning
 * a resolved promise rather than deleting the symbol keeps GameHost's
 * `await ensureFullCatalog()` inside `entryFor` working unchanged.
 */
export function ensureFullCatalog(): Promise<void> {
  return Promise.resolve();
}

/** The lazy loader for `id`, if the roster holds it. */
export function loaderFor(id: string): CatalogEntry["load"] | undefined {
  return findEntry(id)?.load;
}

/**
 * Nothing re-renders on a catalogue change any more — there is no arriving
 * half to announce — so this is a no-op kept for callers that hold the shape.
 */
export function subscribeCatalog(_fn: () => void): () => void {
  return () => {};
}

/** The entry for `id`, if the roster holds it. */
export function findEntry(id: string): CatalogEntry | undefined {
  return entries.find((e) => e.meta.id === id);
}

/**
 * The entry for `id`. Undefined means "not on the roster" — an id OmniStore is
 * not licensed to ship, including all three BLOCKED games, which can never
 * resolve here because no loader for them was ever built.
 */
export async function entryFor(id: string): Promise<CatalogEntry | undefined> {
  if (!ROSTER_IDS.includes(id)) return undefined;
  return findEntry(id);
}
