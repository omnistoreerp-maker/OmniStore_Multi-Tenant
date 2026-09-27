import { ArrowUpDown } from "lucide-react";
import type { SortKey } from "@/types/product";

interface Props {
  value: SortKey;
  onChange: (v: SortKey) => void;
}

/**
 * Sorting supported by the real API (sortBy=name|price, sortOrder=asc|desc).
 * "الافتراضي" = backend default order — no invented sort options.
 */
const OPTIONS: { value: SortKey; label: string }[] = [
  { value: "featured", label: "الترتيب الافتراضي" },
  { value: "price-asc", label: "السعر: من الأقل للأعلى" },
  { value: "price-desc", label: "السعر: من الأعلى للأقل" },
  { value: "name-asc", label: "الاسم: أ - ي" },
];

export function SortSelect({ value, onChange }: Props) {
  return (
    <label className="relative inline-flex items-center gap-2">
      <span className="sr-only">ترتيب حسب</span>
      <ArrowUpDown className="pointer-events-none absolute start-3 h-4 w-4 text-muted-foreground" aria-hidden />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortKey)}
        aria-label="ترتيب حسب"
        className="btn-focus h-11 appearance-none rounded-xl border border-border bg-card ps-9 pe-4 text-sm font-medium text-foreground shadow-sm transition-colors hover:border-primary/30"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
