/**
 * AdSlot — the Marketplace's only sanctioned advertising container.
 *
 * Contract (docs/monetag-onclick-disable-and-filtering-request.md):
 *  - a small, inline, rounded rectangle INSIDE the page flow — never fixed,
 *    never absolute, never an overlay, never fullscreen, never a popunder;
 *  - it lives inside the footer's content container, so it can never push the
 *    product grid or cover header / search / categories / product cards;
 *  - the styled box below is OUR outer container ONLY. It does not target,
 *    resize, restyle or clip any Monetag iframe / creative inside it: the ad
 *    renders exactly as Monetag serves it, constrained only by the slot's
 *    normal inline-flow geometry;
 *  - no click automation, no fake campaigns, no hardcoded creatives, no
 *    simulated revenue, no CSS tricks against the ad content.
 *
 * ENGINE GATE — a deliberate build-time constant, not a runtime heuristic:
 *   The Multitag engine (zone 288239) may not enter the Marketplace page while
 *   its OnClick/Popunder format can hijack same-tab navigation. As of
 *   2026-09-28 that change is UNCONFIRMED (the iclick registration is still
 *   observed on fresh loads), so the engine stays out and the slot renders its
 *   reserved box only. Flip AD_ENGINE_ENABLED to true in the same commit that
 *   records MONETAG_CHANGE=CONFIRMED — nothing else changes.
 */
import { useEffect, useRef } from "react";

const AD_ENGINE_ENABLED = false;
const MULTITAG_SRC = "https://quge5.com/88/tag.min.js";
const MULTITAG_ZONE = "288239";

function mountAdEngine(root: HTMLElement) {
  const script = document.createElement("script");
  script.src = MULTITAG_SRC;
  script.async = true;
  script.setAttribute("data-zone", MULTITAG_ZONE);
  script.setAttribute("data-cfasync", "false");
  root.appendChild(script);
}

export function AdSlot() {
  const adRootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (AD_ENGINE_ENABLED && adRootRef.current) {
      mountAdEngine(adRootRef.current);
    }
  }, []);

  return (
    <aside
      aria-label="Advertisement"
      data-testid="ad-slot"
      className="ad-slot mx-auto mt-8 max-w-3xl overflow-hidden rounded-2xl border border-border bg-card/60"
    >
      {/* Reserved height is the slot's own geometry (inline flow), never a
          style imposed on ad content inside it. */}
      <div className="flex min-h-[90px] items-center justify-center px-4 py-3">
        {AD_ENGINE_ENABLED ? (
          <div ref={adRootRef} className="w-full" data-ad-root />
        ) : null}
      </div>
      <p className="border-t border-border/60 px-4 py-2 text-center text-[11px] font-medium tracking-wide text-muted-foreground">
        Advertisement
      </p>
    </aside>
  );
}
