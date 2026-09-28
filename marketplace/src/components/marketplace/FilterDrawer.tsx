import { useRef } from "react";
import { X, SlidersHorizontal } from "lucide-react";
import { FilterPanel, type FilterState } from "./FilterPanel";
import { useDrawerA11y } from "@/lib/useDrawerA11y";
import type { Product } from "@/types/product";
import type { CategoryCount } from "@/lib/api";

interface Props {
  open: boolean;
  onClose: () => void;
  products: Product[];
  categories?: CategoryCount[];
  state: FilterState;
  onChange: (s: FilterState) => void;
  bounds: [number, number];
  resultCount: number;
}

/** Mobile filter drawer (button → slide-in panel from the end side, RTL-safe). */
export function FilterDrawer({ open, onClose, products, categories, state, onChange, bounds, resultCount }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  useDrawerA11y(open, onClose, rootRef, asideRef);

  return (
    <div
      ref={rootRef}
      className={`fixed inset-0 z-50 lg:hidden ${open ? "" : "pointer-events-none"}`}
      aria-hidden={!open}
    >
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-primary/40 transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0"}`}
      />
      <aside
        ref={asideRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="تصفية النتائج"
        className={`absolute inset-y-0 end-0 flex w-[88vw] max-w-sm flex-col bg-background shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full rtl:-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-4">
          <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
            <SlidersHorizontal className="h-4 w-4 text-primary" aria-hidden />
            التصفية
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="btn-focus rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <FilterPanel products={products} categories={categories} state={state} onChange={onChange} bounds={bounds} />
        </div>
        <div className="border-t border-border bg-card p-4">
          <button
            type="button"
            onClick={onClose}
            className="btn-focus h-12 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            عرض النتائج ({resultCount})
          </button>
        </div>
      </aside>
    </div>
  );
}
