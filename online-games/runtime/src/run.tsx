/**
 * The entry for the OmniStore online-games RUNTIME — the Ellaz foundation built
 * onto the games origin and mounted once per player frame.
 *
 * WHY THIS IS NOT `src/main.tsx`.
 * That entry is the whole site: it registers a service worker (this origin must
 * never have one — a navigation fallback here would steal the platform's
 * routes), boots `analytics` (a beacon from a kids' game) and starts
 * `startCloudSync()` (a Firestore write loop from inside an iframe). None of the
 * three is reachable from here because none of the three is imported.
 *
 * WHY THIS IS ALSO NOT `src/standalone.tsx`.
 * The standalone entry is right about reading the game id off the DOCUMENT
 * rather than the URL — on itch the URL is a CDN path the bundle has never
 * seen. This document's URL is ours: the platform builds it, it is the same
 * origin that serves this file, and the query string is the only channel that
 * survives the cross-origin boundary. The id is still checked against the
 * roster before anything is mounted, so "what the URL says" cannot widen what
 * ships: a BLOCKED id has no loader and fails here with `load-error`.
 *
 * WHAT IS BUILT ON THE PLATFORM ORIGIN INSTEAD OF HERE
 * The catalog, the details page and the player chrome (title, category, exit,
 * fullscreen, related games). This frame answers exactly three questions —
 * which game, is it ready, does the visitor want out — and speaks three
 * postMessage verbs to say so. It listens for nothing: a frame that accepts
 * commands has an inbound surface nobody asked for.
 */
import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "@ui/index";
import { DEFAULT_LOCALE, loadDict, type AppLocale } from "@i18n/index";
import { isAppLocale } from "@i18n/locales";
import { findEntry } from "./portal/catalog";
import { GameHost } from "./portal/GameHost";
import { unlockAudioOnFirstGesture } from "./portal/unlockAudio";

/** The three verbs the platform accepts from this origin, in full. */
type ToPlatform =
  | { type: "omnigames:ready"; gameId: string }
  | { type: "omnigames:request-exit"; gameId: string }
  | { type: "omnigames:load-error"; gameId: string; reason: string };

/**
 * The platform's origin, as it was written into this frame's URL.
 *
 * `postMessage` is given this rather than `"*"` for one reason: a frame that
 * broadcasts `"*"` will happily hand its state to whichever page opened it,
 * and this document is one link away from being opened by anybody. The value
 * has to be a BARE origin — `?parent=https://host/online-games/game.html` is
 * rejected, because a path here would be a targetOrigin nobody intended.
 *
 * Absent or malformed, this is null and nothing is ever posted. That is the
 * documented answer for a direct visit to the games origin: there is no
 * platform to tell, so exit falls back to navigating home.
 */
function parentOrigin(): string | null {
  const raw = new URLSearchParams(location.search).get("parent");
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.href !== `${url.origin}/`) return null;
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.origin === location.origin) return null;
    return url.origin;
  } catch {
    return null;
  }
}

const TARGET: string | null = parentOrigin();
const HAS_PARENT = window.parent !== window;

function post(msg: ToPlatform): void {
  if (!HAS_PARENT || !TARGET) return;
  window.parent.postMessage(msg, TARGET);
}

/** Swap the boot markup's text. Never removed on failure — it is the answer. */
function showFallback(title: string, detail: string): void {
  const t = document.getElementById("run-fallback-title");
  const d = document.getElementById("run-fallback-detail");
  if (t) t.textContent = title;
  if (d) d.textContent = detail;
}

/**
 * A game that throws in render must not take the document with it.
 *
 * Without this, one bad chunk leaves a child staring at a blank dark rectangle
 * with no way out except the platform's own exit — and the platform, which is
 * waiting for `omnigames:ready`, has nothing to react to. The boundary reports
 * `load-error` instead, which is what makes the failure visible on the other
 * side of the origin boundary.
 */
class FrameBoundary extends Component<{ gameId: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    post({
      type: "omnigames:load-error",
      gameId: this.props.gameId,
      reason: error instanceof Error ? error.message : "render error",
    });
    showFallback("تعذّر تشغيل هذه اللعبة.", "عد إلى قائمة الألعاب واختر لعبة أخرى.");
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/** Where "back" goes when there is no platform to send the request to. */
const HOME = "/";

function boot(): void {
  const mount = document.getElementById("root");
  if (!mount) return;

  const gameId = (new URLSearchParams(location.search).get("game") ?? "").trim();

  // `isAppLocale` rather than a cast: the frame's `<html lang>` is a document
  // attribute, not a type, and a typo there must reach English rather than
  // an index that misses and renders keys.
  const lang: string = document.documentElement.lang;
  const locale: AppLocale = isAppLocale(lang) ? lang : DEFAULT_LOCALE;

  if (!gameId || !findEntry(gameId)) {
    post({ type: "omnigames:load-error", gameId: gameId || "(empty)", reason: "unknown game id" });
    showFallback("هذه اللعبة غير متاحة.", "عد إلى قائمة الألعاب واختر لعبة أخرى.");
    return;
  }

  // Ellaz's emitted game documents carry `data-game` on the body. Nothing in
  // the games reads it — they take the id as a prop — but the door that opens
  // the door does, and keeping the document shape identical costs nothing.
  document.body.dataset.game = gameId;

  // The dictionary is what makes the frame's own chrome Arabic. Loaded before
  // the first render rather than after, because `makeT` falls back to English
  // the moment a locale is not in memory and there is no second paint to fix it.
  // Game-level labels stay English by construction: `GameHost` funnels them
  // through `shippedLocaleFor()`, and Arabic is not a shipped locale.
  const dictReady = loadDict(locale);

  unlockAudioOnFirstGesture();

  const entry = findEntry(gameId)!;
  const loaded = entry
    .load()
    .then(() => dictReady)
    .catch((error: unknown) => {
      post({
        type: "omnigames:load-error",
        gameId,
        reason: error instanceof Error ? error.message : "chunk load failed",
      });
      showFallback("تعذّر تحميل هذه اللعبة.", "عد إلى قائمة الألعاب واختر لعبة أخرى.");
      throw error;
    });

  loaded
    .then(() => {
      createRoot(mount).render(
        <FrameBoundary gameId={gameId}>
          <GameHost
            gameId={gameId}
            locale={locale}
            variant="embed"
            onExit={() => {
              if (HAS_PARENT && TARGET) {
                post({ type: "omnigames:request-exit", gameId });
                return;
              }
              window.location.assign(HOME);
            }}
          />
        </FrameBoundary>,
      );

      // Posted after the tree is committed, not when the promise settles: a
      // platform that un-hides the frame on `ready` must never catch it
      // still showing the boot markup.
      queueMicrotask(() => {
        post({ type: "omnigames:ready", gameId });
        document.getElementById("run-fallback")?.remove();
      });
    })
    .catch(() => {
      /* reported above; the fallback text stays on screen */
    });
}

void boot();
