# OmniStore Online Games — Integration Blueprint (v2, LICENSE-gated)

Status: **FROZEN — implementation not approved**
Supersedes: the pre-gate blueprint that shipped `SAFE_GAME_COUNT=47`.

This document is updated **only** to record the outcome of the license/dependency
gate of 2026-10-04. Nothing under `games/`, no Portal, no Player, no CSP change
and no route has been written. The gate lives beside it and is executable.

---

## 1. Foundation

| | |
|---|---|
| Foundation | `Sigmafier/ellaz-games` |
| Foundation commit | `7ee515a10aaba90860f79c83ee52fa81cf9f01e5` |
| Foundation licence | MIT (repository root) |
| Branch | `feature/omnistore-online-games-ellaz-20261004` |
| Base | `origin/main` = `428c3f1117360a74d530425c5e40aeb3a16024dc` |
| Portal | reuses the Ellaz architecture; it is **not** rebuilt from scratch |

The MIT licence covers the foundation **source**. It is not treated as licence
evidence for per-game sprite/atlas/manifest assets. A root `LICENSE` never
overrides an asset whose provenance ends at a missing workspace.

---

## 2. Roster gate (authoritative)

```
AUTHORITATIVE_ROSTER_COUNT=49
SAFE_GAME_COUNT=46
BLOCKED_GAME_COUNT=3
BLOCKED_GAME_IDS=survivors,holdtheline,snakesurvivors
SNAKESURVIVORS_DEPENDENCY_GATE=BLOCKED
TRANSITIVE_BLOCKED_ASSET_SCAN=PASS
LETTERCROSS_NOTICE_REQUIRED=YES
UI_FONT_LICENSE_GATE=PASS
FINAL_LICENSE_GATE=PASS
```

Machine-readable source: [`ROSTER_GATE.json`](./ROSTER_GATE.json).
Enforcement: `node online-games/roster-gate.test.cjs`.

### 2.1 Blocked

| id | reasonCode | why |
|---|---|---|
| `survivors` | `UNKNOWN_ASSET_PROVENANCE` | sprite/atlas/manifest provenance chain ends at a `studio` workspace (commit `ef7901ae`) that is absent from this machine and from the foundation clone; no `LICENSE`/`NOTICE` exists for those files |
| `holdtheline` | `UNKNOWN_ASSET_PROVENANCE` | same chain; `bat.png` and `golem.png` are byte-identical to the `survivors` copies (sha256 `547f5b6e…`, `65f56d11…`), so both games share one unlicensed art source |
| `snakesurvivors` | `TRANSITIVE_DEPENDENCY_ON_BLOCKED_ASSETS` | see §2.2 |

### 2.2 Why `snakesurvivors` is blocked

Its own files are MIT-clean, but it cannot be run or shipped without shipping
`survivors`' blocked sheets:

```
src/games/snakesurvivors/cast.ts:6
  import { CAST, scaleFor, type CastKey } from "../survivors/sprites";

src/games/snakesurvivors/SnakeSurvivorsScene.ts:172
  this.load.atlas(key, CAST[key].png, CAST[key].atlas)
```

Sixteen relative import edges leave `snakesurvivors/` for `../survivors/…`
(`world`, `sprites`, `stick`, `careerArt`, `careerScreens`, `entrance/*`,
`phoneArena`). **A game's independent licence status does not make it safe when
it depends on a blocked source.** Re-classifying it requires a documented
licence for the sprite set, or an independently documented art source — never a
guessed provenance.

### 2.3 The 46 SAFE games

```
memory, evolve, coloring, finddiff, hidden, math, 2048, tictactoe,
minesweeper, sudoku, snake, blocks, wordguess, sequence, vanish, shadows,
echo, balloons, bubbles, bees, frog, reaction, sort, merge, pet, fit, music,
maze, letters, spell, bubbleshooter, match3, jigsaw, lettercross, flow,
arrowtap, fruit, parking, nonogram, onestroke, wordsearch, untangle, chess,
backgammon, puzzlesnake, snakearena
```

Notes:

- roster id `2048` → directory `src/games/n2048/`, content `src/content/games/n2048.ts`.
- the only cross-game edge inside the SAFE set is `evolve → n2048` (both SAFE).
- `lettercross` stays SAFE **only** with `src/games/lettercross/NOTICE.md`
  distributed alongside it (ENABLE1 word list, public domain).
- no game directory other than `survivors` and `holdtheline` contains a raster
  or binary asset at all — verified across all 49 directories.

### 2.4 Foundation modules that must never be vendored

These 16 modules contain a path reference to `games/<blocked>/` and would drag
blocked bytes or blocked roster entries into any build that includes them. The
list is pinned in `ROSTER_GATE.json` as `contaminatedFoundationModules`, and the
gate fails if (a) one of them ever appears in this repository's shipped tree,
or (b) the live foundation scan stops reproducing exactly this set.

The scan matches both the directory form (`games/<blocked>/`) and the bare
module form (`games/<blocked>` followed by a closing quote) — `src/content/
index.ts` is exactly the case the directory-only match used to miss, since it
imports the three blocked content modules by name.

```
src/build/toyboxArt.ts                                   imports survivors sprite PNG + atlas
src/content/games/holdtheline.ts                         blocked metadata
src/content/games/snakesurvivors.ts                      blocked metadata
src/content/games/survivors.ts                           blocked metadata
src/content/games/fr/holdtheline.ts
src/content/games/fr/snakesurvivors.ts
src/content/games/fr/survivors.ts
src/content/games/sv/holdtheline.ts
src/content/games/sv/snakesurvivors.ts
src/content/index.ts                                     imports the three blocked content modules
src/portal/career/Career.tsx                             blocked career ids
src/portal/career/careerCards.ts                         blocked career ids
src/portal/gamesRest.ts                                  lazy loaders for the three blocked games
src/ui/arcade-entrance-covers-the-arena.test.ts          foundation-only test
src/ui/arcade-title.test.ts                              foundation-only test
src/ui/the-page-holds-still-while-a-run-is-live.test.ts  foundation-only test
```

`src/content/index.ts` cannot be vendored in any form: a copy with the three
lines deleted is still a file that had to be edited by hand against its own
foundation, and the gate treats "touched" and "deleted" identically. OmniStore
describes games from its own `ROSTER.json`, which carries the same metadata
fields taken from the surviving per-game `meta.ts` files.

`src/portal/shellRoster.ts` and `src/portal/games.ts` carry the blocked ids as
plain strings, not as paths, so they are not caught by the path scan — they are
equally unusable as a roster source.

Implementation must build its roster from `ROSTER_GATE.json.safeIds`, never by
copying Ellaz's roster files. `src/games/reactHost.tsx` is shared and
uncontaminated; it is safe to vendor.

---

## 3. Still unchanged from the pre-gate blueprint

These are design decisions, not code. They carry over untouched:

1. **Route tree** — Games → `ألعاب أونلاين` (Catalog / Search / Categories /
   Game Details / Game Player) and `استضافة ألعاب` (existing, unchanged).
2. **Catalog** roster-driven and lazy; must scale 46 → 100 → 200 without a
   Portal rebuild; no mock games.
3. **Search** over the roster: Arabic + English + aliases + categories + skill
   tags + game ids + normalized Arabic + typo tolerance.
4. **Categories** (Arabic UI): ألعاب تعليمية، ألعاب ذكاء، ألعاب أطفال، ألعاب
   سرعة، ألعاب كلاسيكية، ألعاب مهارات — primary category preserved, skill
   facets added.
5. **Player** — Ellaz `GameHost` architecture adapted to OmniStore: Platform
   Chrome → `games.<omnistore-domain>` → sandboxed game. Never the platform's
   own JS realm.
6. **Security** — separate origin, iframe `sandbox` without top-navigation /
   popups / forms, strict CSP, `connect-src 'none'` default, no platform
   cookies, no tenant/Finance/Marketplace/Admin data, `postMessage` origin
   check `event.origin === GAMES_ORIGIN` with an allowlisted message set.
7. **Ads** — `GameContext.ads: AdsPort` abstraction only, provider NO-OP:
   `MONETAG=DISABLED`, `ZONE_ID=NONE`, `POPUNDER=DISABLED`, `ONCLICK=DISABLED`.
   `platform/monetag.js`, `AD_ENGINE_ENABLED` and `MONETAG_MARKETPLACE_ZONE`
   stay byte-identical.
8. **Fonts** — Ellaz UI fonts are excluded outright: `Fredoka`, `Baloo 2`,
   `Gochi Hand`, `Press Start 2P`, and the Ellaz `Heebo` UI subsets. Any font
   that ships inside OmniStore must carry its own licence text committed
   beside it. (OmniStore currently ships **zero** font binaries; it loads
   Cairo/Inter from the Google Fonts CDN.)
9. **Branding** — no Ellaz logo / favicon / tagline / colours / copy, and no
   branding or copy from Poki, GamesBarq or 3asafeer (UX references only).
10. **UX** — Arabic RTL-first, 48 px touch targets, accessibility and contrast,
    exactly one `H1`, no `user-scalable=no`, logical RTL CSS.

---

## 4. Gates that must pass before implementation is approved

```
ROSTER=PASS            (this gate)
LICENSE_GATE=PASS      (this gate)
```

Everything else — SEARCH, CATEGORIES, PLAYER, SANDBOX, CSP, TENANT_ISOLATION,
RTL, MOBILE, BROWSER_QA — is still **BLOCKED** because none of it exists yet.

## 5. Running the gate

```bash
node online-games/roster-gate.test.cjs

# with a live foundation scan:
ELLAZ_FOUNDATION_PATH=<path-to-ellaz-games> node online-games/roster-gate.test.cjs
```

It is wired into CI as the `online-games-gate` job and is enforced as a repo
gate by `platform/tests/section-lockdown.test.cjs`, which refuses any
working-tree file outside its allowlist.
