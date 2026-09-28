import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared a11y machinery for slide-in drawers (cart, filters, mobile nav):
 * - closed: `inert` — aria-hidden alone leaves focusable content tabbable
 * - open: focus moves into the dialog, Escape closes, Tab is trapped inside,
 *   background scroll is locked, and focus is restored on close.
 * `onClose` is kept in a ref so parent re-renders never re-run the effect.
 */
export function useDrawerA11y(
  open: boolean,
  onClose: () => void,
  rootRef: RefObject<HTMLDivElement | null>,
  asideRef: RefObject<HTMLElement | null>
): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    rootRef.current?.toggleAttribute("inert", !open);
  }, [open, rootRef]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const aside = asideRef.current;
      if (!aside) return;
      const nodes = Array.from(aside.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && aside.contains(active);
      if (e.shiftKey && (!inside || active === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    asideRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prevFocus?.focus();
    };
  }, [open, asideRef]);
}
