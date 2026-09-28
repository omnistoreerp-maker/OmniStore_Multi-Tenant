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
 * ENGINE GATE + SINGLE CONFIGURATION POINT — build-time constants, not
 * runtime heuristics:
 *   AD_ENGINE_ENABLED is deliberately false: the engine stays out of the
 *   Marketplace page until MONETAG_CHANGE=CONFIRMED (the platform Multitag's
 *   OnClick/Popunder format can still hijack same-tab navigation as of
 *   2026-09-28) AND a safe, OnClick-free inline zone is supplied.
 *   The Marketplace ad source is configured in exactly ONE place — the
 *   MONETAG_MARKETPLACE_ZONE constant below. To activate: paste the
 *   owner-approved Monetag inline zone there and flip AD_ENGINE_ENABLED to
 *   true in the same commit that records MONETAG_CHANGE=CONFIRMED.
 */
import { useEffect, useRef } from "react";

const AD_ENGINE_ENABLED = false;

/**
 * MONETAG_MARKETPLACE_ZONE — THE single configuration point for the
 * Marketplace ad source. "OWNER_INPUT_REQUIRED" is a deliberate placeholder,
 * never a real zone id: replace it here — and only here — with the
 * owner-approved, safe (OnClick/Popunder-free) Monetag inline/multitag zone
 * once Monetag delivers it. Prohibited legacy zones and foreign service
 * workers must never be entered here.
 */
const MONETAG_MARKETPLACE_ZONE = "OWNER_INPUT_REQUIRED";
const MULTITAG_SRC = "https://quge5.com/88/tag.min.js";

function isConfiguredZone(zone: string): boolean {
  const v = zone.trim();
  if (!v) return false;
  return !/^(owner_input_required|owner_required|placeholder|your[_-]|change[_-]me|xxx+|todo)$/i.test(v);
}

function mountAdEngine(root: HTMLElement) {
  const script = document.createElement("script");
  script.src = MULTITAG_SRC;
  script.async = true;
  script.setAttribute("data-zone", MONETAG_MARKETPLACE_ZONE);
  script.setAttribute("data-cfasync", "false");
  root.appendChild(script);
}

export function AdSlot() {
  const adRootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (
      AD_ENGINE_ENABLED &&
      isConfiguredZone(MONETAG_MARKETPLACE_ZONE) &&
      adRootRef.current
    ) {
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
