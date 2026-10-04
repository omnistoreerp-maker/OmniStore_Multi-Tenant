/**
 * The game card, in the one shape the catalog grid and the details page's
 * "related" row both use.
 *
 * Built with DOM APIs and `textContent`, never `innerHTML`. The roster is our
 * own generated JSON today, but "this string came from a file we wrote" is the
 * exact reasoning that fails the first time a game's title is allowed to carry
 * an angle bracket — and a card is a link, so a title could otherwise become an
 * attribute. Every roster value below is inserted as text.
 */

import { gameHref } from "./roster.js";

/**
 * One `<li>` containing a link to the game's details page.
 *
 * @param {object} game    a roster entry
 * @param {object} opts
 * @param {string} [opts.categoryLabel] shown in the card's meta row
 * @param {string} [opts.trailing]      extra text after the category label
 */
export function renderCard(game, opts = {}) {
  const li = document.createElement("li");

  const a = document.createElement("a");
  a.className = "og-card";
  a.href = gameHref(game.id);

  const top = document.createElement("div");
  top.className = "og-card-top";
  const badge = document.createElement("span");
  badge.className = "og-badge";
  badge.style.setProperty("--c", game.color);
  badge.setAttribute("aria-hidden", "true");
  badge.textContent = game.emoji;
  top.appendChild(badge);
  a.appendChild(top);

  const h3 = document.createElement("h3");
  h3.textContent = game.titleAr;
  a.appendChild(h3);

  const p = document.createElement("p");
  p.textContent = game.summaryAr;
  a.appendChild(p);

  const meta = document.createElement("div");
  meta.className = "og-card-meta";
  if (opts.categoryLabel) {
    const tag = document.createElement("span");
    tag.className = "og-tag";
    tag.textContent = opts.categoryLabel;
    meta.appendChild(tag);
  }
  if (opts.trailing) {
    const span = document.createElement("span");
    span.textContent = opts.trailing;
    meta.appendChild(span);
  }
  if (meta.childNodes.length) a.appendChild(meta);

  li.appendChild(a);
  return li;
}

/** Render a list of games into `container`, emptying whatever was there. */
export function renderGrid(container, games, labelFor) {
  container.textContent = "";
  for (const game of games) {
    container.appendChild(renderCard(game, { categoryLabel: labelFor(game) }));
  }
}
