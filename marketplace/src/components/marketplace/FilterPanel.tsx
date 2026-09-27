import { useMemo } from "react";
import { RotateCcw } from "lucide-react";
import type { Product } from "@/types/product";
import type { CategoryCount } from "@/lib/api";
import { categoryLabel } from "@/lib/mapper";
import { formatEGP } from "@/lib/format";

export interface FilterState {
  brands: string[];
  categories: string[]; // categoryId selection (single; "الكل" = [])
  price: [number, number];
}

interface Props {
  products: Product[];
  categories?: CategoryCount[];
  state: FilterState;
  onChange: (s: FilterState) => void;
  bounds: [number, number];
}

export function FilterPanel({ products, categories = [], state, onChange, bounds }: Props) {
  const brandCounts = useMemo(() => {
    const map = new Map<string, number>();
    products.forEach((p) => map.set(p.brand, (map.get(p.brand) ?? 0) + 1));
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [products]);

  const toggleBrand = (brand: string) => {
    const has = state.brands.includes(brand);
    onChange({
      ...state,
      brands: has ? state.brands.filter((b) => b !== brand) : [...state.brands, brand],
    });
  };

  const toggleCategory = (categoryId: string) => {
    const has = state.categories.includes(categoryId);
    onChange({ ...state, categories: has ? [] : [categoryId] });
  };

  const resetAll = () => onChange({ brands: [], categories: [], price: bounds });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-foreground">خيارات التصفية</h2>
        <button
          type="button"
          onClick={resetAll}
          className="btn-focus inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground hover:text-primary"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          إعادة ضبط
        </button>
      </div>

      {/* Category (server-backed: GET /categories → categoryId filter) */}
      {categories.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-semibold text-foreground">الفئة</legend>
          <div className="space-y-1.5">
            <label
              className={`flex cursor-pointer items-center justify-between rounded-lg px-2 py-2 text-sm transition-colors hover:bg-secondary ${
                state.categories.length === 0 ? "bg-secondary/60" : ""
              }`}
            >
              <span className="flex items-center gap-2.5">
                <input
                  type="radio"
                  name="mk-category"
                  checked={state.categories.length === 0}
                  onChange={() => onChange({ ...state, categories: [] })}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-ring"
                />
                <span className="font-medium text-foreground">الكل</span>
              </span>
            </label>
            {categories.map((c) => {
              const checked = state.categories.includes(c.id);
              return (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-2 text-sm transition-colors hover:bg-secondary"
                >
                  <span className="flex items-center gap-2.5">
                    <input
                      type="radio"
                      name="mk-category"
                      checked={checked}
                      onChange={() => toggleCategory(c.id)}
                      className="h-4 w-4 rounded border-border text-primary focus:ring-ring"
                    />
                    <span className="font-medium text-foreground">{categoryLabel(c.id)}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{c.count}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {/* Brand */}
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold text-foreground">الماركة</legend>
        <div className="space-y-1.5">
          {brandCounts.map(([brand, count]) => {
            const checked = state.brands.includes(brand);
            return (
              <label
                key={brand}
                className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-2 text-sm transition-colors hover:bg-secondary"
              >
                <span className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleBrand(brand)}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-ring"
                  />
                  <span className="tech font-medium text-foreground">{brand}</span>
                </span>
                <span className="text-xs text-muted-foreground">{count}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Price */}
      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold text-foreground">نطاق السعر</legend>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{formatEGP(state.price[0])}</span>
          <span>{formatEGP(state.price[1])}</span>
        </div>
        <div className="space-y-2 pt-1">
          <input
            aria-label="حد أدنى لنطاق السعر"
            type="range"
            min={bounds[0]}
            max={bounds[1]}
            step={100}
            value={state.price[0]}
            onChange={(e) =>
              onChange({
                ...state,
                price: [Math.min(Number(e.target.value), state.price[1]), state.price[1]],
              })
            }
            className="w-full accent-primary"
          />
          <input
            aria-label="حد أقصى لنطاق السعر"
            type="range"
            min={bounds[0]}
            max={bounds[1]}
            step={100}
            value={state.price[1]}
            onChange={(e) =>
              onChange({
                ...state,
                price: [state.price[0], Math.max(Number(e.target.value), state.price[0])],
              })
            }
            className="w-full accent-primary"
          />
        </div>
      </fieldset>
    </div>
  );
}
