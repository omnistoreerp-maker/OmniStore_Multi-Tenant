import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { CategoryCount } from "@/lib/api";

/**
 * Shared UI state between the global header and the catalog page:
 * - query: single search input lives in the Header (one aria-label="بحث في المتجر"
 *   instance for the whole app); Marketplace consumes it with its 350ms debounce.
 * - categories: mirrored from Marketplace's real GET /categories fetch so the
 *   header can offer category access WITHOUT any extra API call.
 * - pendingCategory: header chip → Marketplace applies it as server-side filter.
 * - fetching: Marketplace progress state → header progress bar.
 */
interface MarketUIState {
  query: string;
  setQuery: (v: string) => void;
  categories: CategoryCount[];
  setCategories: (c: CategoryCount[]) => void;
  pendingCategory: string | null;
  requestCategory: (id: string | null) => void;
  activeCategory: string | null;
  setActiveCategory: (id: string | null) => void;
  fetching: boolean;
  setFetching: (b: boolean) => void;
}

const MarketUICtx = createContext<MarketUIState | null>(null);

export function MarketUIProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  const [categories, setCategories] = useState<CategoryCount[]>([]);
  const [pendingCategory, setPendingCategory] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);

  const value = useMemo<MarketUIState>(
    () => ({
      query,
      setQuery,
      categories,
      setCategories,
      pendingCategory,
      requestCategory: setPendingCategory,
      activeCategory,
      setActiveCategory,
      fetching,
      setFetching,
    }),
    [query, categories, pendingCategory, activeCategory, fetching]
  );

  return <MarketUICtx.Provider value={value}>{children}</MarketUICtx.Provider>;
}

export function useMarketUI(): MarketUIState {
  const v = useContext(MarketUICtx);
  if (!v) throw new Error("useMarketUI must be used inside <MarketUIProvider>");
  return v;
}
