/**
 * OmniAdSlot — the platform-wide inline ad slot, mounted on the Marketplace
 * alongside the existing Marketplace-only <AdSlot />.
 *
 * Hard contract (mirrors platform/omniAdSlot.js):
 *   - INLINE ONLY: page-flow rectangle inside the footer's content container.
 *     Never fixed/absolute, never an overlay, never fullscreen, never a
 *     popunder, and it never hijacks navigation (no OnClick/Popunder).
 *   - GATED: inactive until the owner flips `enabled` AND supplies a real,
 *     owner-approved inline zone + official https script URL. While gated it
 *     renders a quiet placeholder and makes ZERO ad requests.
 *   - PROHIBITED ZONES hard-blocked: 288239 (Multitag hub whose OnClick
 *     runtime sub-zone hijacked Platform→Marketplace navigation, reproduced
 *     6× on production 2026-09-28), 11912374, 11912377, 11857331.
 *   - Marketplace business logic untouched: this is presentational only and
 *     lives after all product content, before the trust grid.
 */
import { useEffect, useRef } from "react";

const AD_ENGINE_ENABLED = false;

/**
 * MONETAG_INLINE_ZONE — single configuration point. "OWNER_INPUT_REQUIRED"
 * is a deliberate placeholder, never a real zone id. Prohibited legacy zones
 * and service-worker artifacts must never be entered here.
 */
const MONETAG_INLINE_ZONE = "OWNER_INPUT_REQUIRED";
const MULTITAG_SRC = "https://quge5.com/88/tag.min.js";

const PROHIBITED_ZONES = ["288239", "11912374", "11912377", "11857331"];

function isConfiguredZone(zone: string): boolean {
  const v = zone.trim();
  if (!v) return false;
  if (PROHIBITED_ZONES.includes(v)) return false;
  return !/^(owner_input_required|owner_required|placeholder|your[_-]|change[_-]me|xxx+|todo)$/i.test(v);
}

function mountAdEngine(root: HTMLElement) {
  const script = document.createElement("script");
  script.src = MULTITAG_SRC;
  script.async = true;
  script.setAttribute("data-zone", MONETAG_INLINE_ZONE);
  script.setAttribute("data-cfasync", "false");
  root.appendChild(script);
}

export function OmniAdSlot() {
  const adRootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (
      AD_ENGINE_ENABLED &&
      isConfiguredZone(MONETAG_INLINE_ZONE) &&
      adRootRef.current
    ) {
      mountAdEngine(adRootRef.current);
    }
  }, []);

  return (
    <aside
      aria-label="Advertisement"
      data-testid="omni-ad-slot"
      className="omni-ad-slot mx-auto mt-8 max-w-3xl overflow-hidden rounded-2xl border border-border bg-card/60"
    >
      {/* Reserved height is the slot's own geometry (inline flow), never a
          style imposed on ad content inside it. */}
      <div className="flex min-h-[90px] items-center justify-center px-4 py-3">
        {AD_ENGINE_ENABLED ? (
          <div ref={adRootRef} className="w-full" data-omni-ad-root />
        ) : (
          <span className="text-[11px] font-medium tracking-wide text-muted-foreground">
            مساحة إعلانية — Placeholder (disabled)
          </span>
        )}
      </div>
      <p className="border-t border-border/60 px-4 py-2 text-center text-[11px] font-medium tracking-wide text-muted-foreground">
        Advertisement
      </p>
    </aside>
  );
}
