/**
 * The player page (`play.html?id=`).
 *
 * This is the only place on the platform origin that talks to the games
 * origin, and it does so across two boundaries at once:
 *
 *   1. the FRAME is cross-origin, so the platform polices it with a CSP
 *      `frame-src` listing exactly this origin and an `sandbox` attribute
 *      with no top-navigation — the frame cannot move this page even if its
 *      own code is hostile;
 *   2. MESSAGES are origin-checked before they are read, and the message TYPE
 *      is matched against a three-entry allowlist before it is acted on. An
 *      unknown shape, an unexpected origin or a foreign gameId is ignored
 *      entirely, not "handled safely": ignoring costs nothing and a switch
 *      statement with a default branch can be read as a decision.
 *
 * The page never asks the frame for anything. Exit is a postMessage the frame
 * sends when its own control is used; there is no command channel back, so a
 * compromised frame has no way to make this page navigate, fullscreen or
 * fetch — it can only report that it is ready, broken, or wants out.
 */

import { GAMES_ENABLED, GAMES_ORIGIN, frameUrl, FRAME_SANDBOX, ALLOWED_FROM_GAMES, DISABLED_NOTICE } from "./config.js";
import { loadRoster, gameById, categoryById } from "./roster.js";
import { renderCard } from "./cards.js";

/** How long the platform waits before it stops saying "جارٍ التحميل". */
const LOAD_HINT_MS = 20000;

const $ = (id) => document.getElementById(id);

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
  const a = document.createElement("a");
  a.className = "og-btn og-btn--ghost";
  a.href = "index.html";
  a.textContent = "العودة إلى قائمة الألعاب";
  box.append(e, h, p, a);
  host.appendChild(box);
}

/**
 * Where the exit control goes.
 *
 * Only a referrer on THIS origin means the visitor actually came from
 * somewhere in the section; `history.length` is no answer at all, because a
 * tab opened straight onto `play.html` can still report 2 from a restored
 * session and then back() lands on the previous site's page.
 */
function exitGame() {
  const fromSection =
    document.referrer && new URL(document.referrer).origin === location.origin;
  if (fromSection) {
    window.history.back();
    return;
  }
  window.location.replace("index.html");
}

async function boot() {
  const stage = $("og-stage");
  const stageHost = $("og-frame-host");
  const titleHost = $("og-stage-title");
  const relatedHost = $("og-related");
  if (!stage || !stageHost || !titleHost) return;

  const id = new URLSearchParams(location.search).get("id") || "";

  let roster;
  try {
    roster = await loadRoster();
  } catch (error) {
    showNotice(stageHost, "⚠️", "تعذّر تحميل اللعبة", String((error && error.message) || error));
    return;
  }

  const game = gameById(roster, id);
  if (!game) {
    showNotice(stageHost, "🎮", "هذه اللعبة غير متاحة", "قد تكون خارج قائمة الألعاب المتاحة.");
    return;
  }

  document.title = game.titleAr + " — ألعاب أونلاين | OmniStore";

  titleHost.textContent = "";
  const emoji = document.createElement("span");
  emoji.className = "og-emoji";
  emoji.setAttribute("aria-hidden", "true");
  emoji.textContent = game.emoji;
  titleHost.append(emoji, document.createTextNode(game.titleAr));

  if (!GAMES_ENABLED) {
    showNotice(stageHost, "🔌", DISABLED_NOTICE.title, DISABLED_NOTICE.detail);
    return;
  }

  // --- the frame ----------------------------------------------------------
  const frame = document.createElement("iframe");
  frame.className = "og-frame" + (game.orientation === "portrait" ? " og-frame--portrait" : "");
  frame.title = "لعبة " + game.titleAr;
  frame.src = frameUrl(game.id);
  frame.setAttribute("sandbox", FRAME_SANDBOX);
  // `allow` is the Feature-Policy half of the same decision: the frame may
  // take the fullscreen the player's button asks for and nothing else.
  frame.setAttribute("allow", "fullscreen");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("aria-busy", "true");

  const loading = document.createElement("div");
  loading.className = "og-loading";
  loading.id = "og-loading";
  loading.setAttribute("role", "status");
  loading.textContent = "جارٍ تحميل اللعبة…";

  stageHost.textContent = "";
  stageHost.append(frame, loading);

  let hintTimer = 0;
  const clearLoad = () => {
    window.clearTimeout(hintTimer);
    const el = $("og-loading");
    if (el) el.remove();
    frame.setAttribute("aria-busy", "false");
  };

  hintTimer = window.setTimeout(() => {
    const el = $("og-loading");
    if (el) el.textContent = "ما زالت اللعبة تُحمَّل… إذا استغرق الأمر طويلاً اعد المحاولة أو اختر لعبة أخرى.";
  }, LOAD_HINT_MS);

  // --- the three messages -------------------------------------------------
  function onMessage(event) {
    if (event.origin !== GAMES_ORIGIN) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (typeof data.type !== "string" || !ALLOWED_FROM_GAMES.includes(data.type)) return;
    if (data.gameId !== game.id) return;

    if (data.type === "omnigames:ready") {
      clearLoad();
      return;
    }
    if (data.type === "omnigames:request-exit") {
      clearLoad();
      exitGame();
      return;
    }
    if (data.type === "omnigames:load-error") {
      clearLoad();
      const reason = typeof data.reason === "string" ? data.reason : "";
      showNotice(
        stageHost,
        "⚠️",
        "تعذّر تشغيل هذه اللعبة",
        reason ? "السبب: " + reason : "أعد المحاولة أو اختر لعبة أخرى من القائمة.",
      );
    }
  }

  window.addEventListener("message", onMessage);

  // If the frame never says anything at all — a misconfigured origin, a blocked
  // script, a device that refuses the renderer — the visitor must not be left
  // staring at a spinner inside an iframe that may be blank.
  frame.addEventListener("error", () => {
    clearLoad();
    showNotice(stageHost, "⚠️", "تعذّر فتح نافذة اللعبة", "أعد المحاولة أو اختر لعبة أخرى.");
  });

  // --- controls -----------------------------------------------------------
  // The exit control is an <a href="index.html"> in the markup, so it works
  // with JavaScript off; with it on, the handler takes over and suppresses the
  // plain navigation, because going BACK to the details page is a better
  // answer than dumping the visitor on the catalog.
  const exitBtn = $("og-exit");
  if (exitBtn) {
    exitBtn.addEventListener("click", (event) => {
      event.preventDefault();
      exitGame();
    });
  }

  const fsBtn = $("og-fullscreen");
  if (fsBtn) {
    const sync = () => {
      const on = Boolean(document.fullscreenElement);
      fsBtn.setAttribute("aria-pressed", String(on));
      fsBtn.setAttribute("aria-label", on ? "إنهاء ملء الشاشة" : "ملء الشاشة");
      fsBtn.title = on ? "إنهاء ملء الشاشة" : "ملء الشاشة";
    };
    fsBtn.addEventListener("click", () => {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
        return;
      }
      if (stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
    });
    document.addEventListener("fullscreenchange", sync);
    sync();
  }

  // --- related ------------------------------------------------------------
  if (!relatedHost) return;
  const same = roster.games.filter((g) => g.category === game.category && g.id !== game.id);
  const others = roster.games.filter((g) => g.category !== game.category && g.id !== game.id);
  const picked = same.slice(0, 6);
  if (picked.length < 4) {
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
