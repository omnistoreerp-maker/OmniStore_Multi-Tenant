/**
 * The catalog page (`/online-games/`).
 *
 * Reads `ROSTER.json`, draws the six category filters and the grid, and
 * answers a search box — with no build step and no framework, because this
 * surface has to be servable as static files by the platform's nginx
 * `location /` and its own `connect-src 'self'` forbids anything but a
 * same-origin fetch.
 *
 * Nothing here reads or writes a token, a cookie or a tenant id. The roster is
 * public, identical for every visitor, and the page is served without
 * credentials of any consequence — which is what makes it safe to expose at
 * `/online-games/` rather than behind the ERP's session.
 */

import { GAMES_ENABLED, DISABLED_NOTICE } from "./config.js";
import { loadRoster } from "./roster.js";
import { renderGrid } from "./cards.js";
import { searchGames } from "./search.js";

const ALL = "__all__";

const $ = (id) => document.getElementById(id);

/** The category the URL asks for, or "all". Never trusted — validated below. */
function currentCategory() {
  const raw = new URLSearchParams(location.search).get("cat");
  return raw ? raw.trim() : ALL;
}

function setCategory(next) {
  const url = new URL(location.href);
  if (next === ALL) url.searchParams.delete("cat");
  else url.searchParams.set("cat", next);
  history.replaceState(null, "", url.toString());
}

/**
 * Put a message where the grid is.
 *
 * A `<div>` SIBLING of the `<ul>`, never a child: an `og-state` box inside a
 * list is invalid markup and a screen reader announces it as a broken list
 * item. Callers clear the grid and show this, or the reverse.
 */
function showNotice(host, emoji, title, detail) {
  host.textContent = "";
  const box = document.createElement("div");
  box.className = "og-state";
  const e = document.createElement("span");
  e.className = "og-state-emoji";
  e.setAttribute("aria-hidden", "true");
  e.textContent = emoji;
  const h = document.createElement("h2");
  h.textContent = title;
  const p = document.createElement("p");
  p.textContent = detail;
  box.append(e, h, p);
  host.appendChild(box);
}

async function boot() {
  const grid = $("og-grid");
  const notice = $("og-notice");
  const chips = $("og-chips");
  const input = $("og-search");
  const count = $("og-count");
  const total = $("og-total");
  if (!grid || !notice || !chips || !input || !count) return;

  let roster;
  try {
    roster = await loadRoster();
  } catch (error) {
    grid.textContent = "";
    showNotice(notice, "⚠️", "تعذّر تحميل قائمة الألعاب", String((error && error.message) || error));
    return;
  }

  if (total) total.textContent = String(roster.totals.games);

  const label = new Map(roster.categories.map((c) => [c.id, c.labelAr]));
  const categoryOf = (game) => label.get(game.category) || game.category;

  let active = currentCategory();
  if (active !== ALL && !label.has(active)) active = ALL;
  let query = "";

  // --- filters -----------------------------------------------------------
  const buttons = [{ id: ALL, labelAr: "كل الألعاب", count: roster.games.length }].concat(
    roster.categories,
  );

  function paintChips() {
    chips.textContent = "";
    for (const cat of buttons) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "og-chip";
      b.setAttribute("aria-pressed", String(cat.id === active));
      const name = document.createElement("span");
      name.textContent = cat.labelAr;
      const n = document.createElement("span");
      n.className = "og-chip-n";
      n.textContent = String(cat.count);
      b.append(name, n);
      b.addEventListener("click", () => {
        active = cat.id;
        setCategory(active);
        paintChips();
        paintGrid();
      });
      chips.appendChild(b);
    }
  }

  // --- results -----------------------------------------------------------
  function paintGrid() {
    const pool =
      active === ALL ? roster.games : roster.games.filter((g) => g.category === active);
    const found = searchGames(pool, query);

    count.textContent = query
      ? found.length + " نتيجة لـ «" + query + "»"
      : found.length + " لعبة";

    if (!found.length) {
      grid.textContent = "";
      showNotice(
        notice,
        "🔎",
        "لا توجد نتائج",
        "جرّب اسم اللعبة أو كلمة أقصر — البحث يفهم العربي والإنجليزي معاً.",
      );
      return;
    }
    notice.textContent = "";
    renderGrid(grid, found, categoryOf);
  }

  paintChips();
  paintGrid();

  input.addEventListener("input", () => {
    query = input.value;
    paintGrid();
  });

  // Escape clears the box rather than doing nothing; it must not also be
  // treated as "leave the page", because a player reaching for it is editing.
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && input.value) {
      input.value = "";
      query = "";
      paintGrid();
    }
  });

  // The disabled state belongs on the details and player pages, where a
  // missing origin actually stops something. The catalog still works: browsing
  // and searching cost nothing and are what a visitor arrives for.
  if (!GAMES_ENABLED) {
    const note = document.createElement("p");
    note.className = "og-count";
    note.textContent = DISABLED_NOTICE.title;
    note.title = DISABLED_NOTICE.detail;
    count.after(note);
  }
}

boot();
