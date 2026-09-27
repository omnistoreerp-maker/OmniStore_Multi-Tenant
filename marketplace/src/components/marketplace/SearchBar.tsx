import { Search, X } from "lucide-react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

export function SearchBar({ value, onChange, placeholder }: Props) {
  return (
    <div className="relative w-full">
      <Search
        className="pointer-events-none absolute end-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        type="search"
        inputMode="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "ابحث عن جهاز، ماركة، أو موديل..."}
        aria-label="بحث في المتجر"
        className="btn-focus h-12 w-full rounded-xl border border-border bg-card ps-4 pe-11 text-[15px] text-foreground placeholder:text-muted-foreground shadow-sm transition-colors hover:border-primary/30 focus-visible:border-primary/50"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="مسح البحث"
          className="btn-focus absolute start-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
