/**
 * The details page (`game.html?id=`).
 *
 * Everything it shows comes from `ROSTER.json` and nothing else — the title,
 * the Arabic summary and the category label were authored in
 * `scripts/arabic-content.json` and frozen into the roster by
 * `scripts/build-roster.mjs`, so this page has no copy of its own to drift.
 *
 * The id in the URL is looked up, never trusted: an unknown id renders the
 * "not available" state rather than a half-filled page, and — the part that
 * matters for the licence gate — a BLOCKED id cannot resolve here at all,
 * because the roster never contained it.
 */

import { GAMES_ENABLED, DISABLED_NOTICE } from "./config.js";
import { loadRoster, gameById, categoryById, playHref } from "./roster.js";
import { renderCard } from "./cards.js";

const ORIENTATION = { any: "أي اتجاه", portrait: "الوضع العمودي" };
const SCORE_UNIT = { points: "النقاط", moves: "عدد الحركات", ms: "أفضل زمن" };

const $ = (id) => document.getElementById(id);

function showNotice(host, emoji, title, detail, action) {
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
  if (action) {
    const a = document.createElement("a");
    a.className = "og-btn og-btn--ghost";
    a.href = action.href;
    a.textContent = action.label;
    box.appendChild(a);
  }
  host.appendChild(box);
}

/** One `<li>` of the facts column. */
function fact(label, value) {
  const li = document.createElement("li");
  const b = document.createElement("b");
  b.textContent = label;
  li.append(b, document.createTextNode(value));
  return li;
}

async function boot() {
  const root = $("og-detail");
  const relatedHost = $("og-related");
  if (!root) return;

  const id = new URLSearchParams(location.search).get("id") || "";

  let roster;
  try {
    roster = await loadRoster();
  } catch (error) {
    showNotice(root, "⚠️", "تعذّر تحميل اللعبة", String((error && error.message) || error));
    return;
  }

  const game = gameById(roster, id);
  if (!game) {
    showNotice(
      root,
      "🎮",
      "هذه اللعبة غير متاحة",
      "قد تكون خارج قائمة الألعاب المتاحة على المنصة.",
      { href: "index.html", label: "العودة إلى قائمة الألعاب" },
    );
    return;
  }

  const category = categoryById(roster, game.category);
  const ageBand = (roster.ageBands || []).find((b) => b.id === game.ageBand);

  document.title = game.titleAr + " — ألعاب أونلاين | OmniStore";
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.content = game.summaryAr;

  root.textContent = "";

  const panel = document.createElement("div");
  panel.className = "og-panel";

  const head = document.createElement("div");
  head.className = "og-detail-head";
  const badge = document.createElement("span");
  badge.className = "og-badge";
  badge.style.setProperty("--c", game.color);
  badge.setAttribute("aria-hidden", "true");
  badge.textContent = game.emoji;
  const heading = document.createElement("div");
  const h1 = document.createElement("h1");
  h1.textContent = game.titleAr;
  const sub = document.createElement("p");
  sub.className = "og-sub";
  sub.textContent = game.titleEn || category.labelAr;
  heading.append(h1, sub);
  head.append(badge, heading);

  const lead = document.createElement("p");
  lead.className = "og-lead";
  lead.textContent = game.summaryAr;

  const facts = document.createElement("ul");
  facts.className = "og-facts";
  facts.appendChild(fact("الفئة", category.labelAr));
  if (ageBand) facts.appendChild(fact("الفئة العمرية", ageBand.labelAr));
  facts.appendChild(fact("الاتجاه", ORIENTATION[game.orientation] || game.orientation));
  if (game.scoreUnit && SCORE_UNIT[game.scoreUnit]) {
    facts.appendChild(fact("يُقاس بـ", SCORE_UNIT[game.scoreUnit]));
  }

  const actions = document.createElement("div");
  actions.className = "og-actions";

  if (GAMES_ENABLED) {
    const play = document.createElement("a");
    play.className = "og-btn";
    play.href = playHref(game.id);
    play.textContent = "ابدأ اللعب";
    const back = document.createElement("a");
    back.className = "og-btn og-btn--ghost";
    back.href = "index.html";
    back.textContent = "كل الألعاب";
    actions.append(play, back);
  } else {
    const disabled = document.createElement("button");
    disabled.className = "og-btn og-btn--ghost";
    disabled.type = "button";
    disabled.disabled = true;
    disabled.textContent = "اللعبة غير مُفعّلة";
    disabled.title = DISABLED_NOTICE.detail;
    actions.appendChild(disabled);

    const hint = document.createElement("p");
    hint.className = "og-lead";
    hint.textContent = DISABLED_NOTICE.title + " — " + DISABLED_NOTICE.detail;
    panel.append(head, lead, facts, actions, hint);
    root.appendChild(panel);
    return;
  }

  panel.append(head, lead, facts, actions);
  root.appendChild(panel);

  // --- related ------------------------------------------------------------
  if (!relatedHost) return;
  const same = roster.games.filter((g) => g.category === game.category && g.id !== game.id);
  const others = roster.games.filter((g) => g.category !== game.category && g.id !== game.id);
  const picked = same.slice(0, 6);
  if (picked.length < 4) {
    // A category with two games (or one) would otherwise show a nearly empty
    // row; fill from the rest of the roster rather than render a hole.
    for (const g of others) {
      if (picked.length >= 4) break;
      picked.push(g);
    }
  }
  const list = document.createElement("ul");
  list.className = "og-grid";
  for (const g of picked) {
    list.appendChild(renderCard(g, { categoryLabel: categoryById(roster, g.category).labelAr }));
  }
  relatedHost.textContent = "";
  relatedHost.appendChild(list);
}

boot();
