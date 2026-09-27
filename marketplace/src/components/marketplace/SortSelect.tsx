import { ArrowUpDown } from "lucide-react";
import type { SortKey } from "@/types/product";

interface Props {
  value: SortKey;
  onChange: (v: SortKey) => void;
}

const OPTIONS: { value: SortKey; label: string }[] = [
  { value: "featured", label: "الأكثر شهرة" },
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
