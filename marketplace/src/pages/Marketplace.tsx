import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, SlidersHorizontal, Sparkles } from "lucide-react";
import { marketApi, MarketApiError, type CategoryCount, type ProductQuery } from "@/lib/api";
import type { Product, SortKey } from "@/types/product";
import { categoryLabel } from "@/lib/mapper";
import { SearchBar } from "@/components/marketplace/SearchBar";
import { SortSelect } from "@/components/marketplace/SortSelect";
import { FilterPanel, type FilterState } from "@/components/marketplace/FilterPanel";
import { FilterDrawer } from "@/components/marketplace/FilterDrawer";
import { ProductGrid, ProductGridSkeleton } from "@/components/marketplace/ProductGrid";
import { formatCount } from "@/lib/format";

/**
 * Marketplace catalog — all data comes from GET /api/v1/market/products:
 * search / category / sort are server-side (backend marketCatalog.service),
 * multi-brand selection and the price range are applied client-side ON THE
 * REAL API RESULT. No static catalog, no invented products.
 */

function sortToQuery(sort: SortKey): Pick<ProductQuery, "sortBy" | "sortOrder"> {
  switch (sort) {
    case "price-asc":
      return { sortBy: "price", sortOrder: "asc" };
    case "price-desc":
      return { sortBy: "price", sortOrder: "desc" };
    case "name-asc":
      return { sortBy: "name", sortOrder: "asc" };
    default:
      return { sortBy: "name", sortOrder: "asc" }; // backend default (featured)
  }
}

export default function Marketplace() {
  const [facets, setFacets] = useState<Product[] | null>(null);
  const [categories, setCategories] = useState<CategoryCount[]>([]);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("featured");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    brands: [],
    categories: [],
    price: [0, 999999],
  });

  const gridSeq = useRef(0);

  // Debounce search input (350ms) before hitting the API.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  // Facet source: one real full-catalog page powering brand counts + price bounds.
  useEffect(() => {
    let cancelled = false;
    marketApi
      .products({ limit: 100 })
      .then((page) => {
        if (cancelled) return;
        setFacets(page.products);
        setLoadError(null);
        if (page.products.length) {
          const prices = page.products.map((p) => p.price);
          const lo = Math.floor(Math.min(...prices) / 100) * 100;
          const hi = Math.ceil(Math.max(...prices) / 100) * 100;
          setFilters((prev) => ({ ...prev, price: [lo, hi] }));
        }
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "تعذر تحميل المنتجات");
      });
    marketApi
      .categories()
      .then((c) => {
        if (!cancelled) setCategories(c);
      })
      .catch(() => {
        /* categories are optional for rendering the grid */
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Grid: server-side search / category / sort.
  const categoryId = filters.categories[0] || undefined;
  useEffect(() => {
    const seq = ++gridSeq.current;
    marketApi
      .products({
        search: debouncedQuery || undefined,
        categoryId,
        ...sortToQuery(sort),
        limit: 100,
      })
      .then((page) => {
        if (seq !== gridSeq.current) return;
        setProducts(page.products);
        setLoadError(null);
      })
      .catch((e) => {
        if (seq !== gridSeq.current) return;
        setProducts(null);
        setLoadError(
          e instanceof MarketApiError ? e.message : "تعذر الاتصال بخدمة المنتجات"
        );
      });
  }, [debouncedQuery, categoryId, sort, reloadKey]);

  const bounds = useMemo<[number, number]>(() => {
    if (!facets || facets.length === 0) return [0, 999999];
    const prices = facets.map((p) => p.price);
    return [Math.floor(Math.min(...prices) / 100) * 100, Math.ceil(Math.max(...prices) / 100) * 100];
  }, [facets]);

  const filtered = useMemo(() => {
    if (!products) return [];
    return products.filter((p) => {
      const brandOk = filters.brands.length === 0 || filters.brands.includes(p.brand);
      const priceOk = p.price >= filters.price[0] && p.price <= filters.price[1];
      return brandOk && priceOk;
    });
  }, [products, filters]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <>
      {/* Hero / header zone */}
      <section className="relative overflow-hidden border-b border-border bg-gradient-to-bl from-primary via-primary to-[#0a2f30] text-primary-foreground">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 15% 20%, hsl(35 92% 65%) 0, transparent 45%), radial-gradient(circle at 85% 80%, hsl(172 60% 55%) 0, transparent 40%)",
          }}
        />
        <div className="relative mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-primary-foreground/90 ring-1 ring-white/15">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              أجهزة أصلية بأسعار واضحة
            </span>
            <h1 className="mt-4 text-2xl font-extrabold leading-tight sm:text-4xl lg:text-[42px]">
              اكتشف تشكيلة أومني ستور من الأجهزة الاحترافية
            </h1>
            <p className="mt-3 max-w-xl text-sm text-primary-foreground/80 sm:text-base">
              لابتوبات أعمال من افضل العلامات العالمية{" "}
              <span className="tech font-semibold">HP · DELL · LENOVO · MICROSOFT</span>{" "}
              مع أسعار واضحة ومواصفات حقيقية.
            </p>

            <div className="mt-6 max-w-xl">
              <SearchBar value={query} onChange={setQuery} />
            </div>
          </div>
        </div>
      </section>

      {/* Toolbar */}
      <section className="border-b border-border bg-card/60">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <p className="text-sm text-muted-foreground">
            {products ? (
              <>
                <span className="font-semibold text-foreground">{formatCount(filtered.length)}</span>{" "}
                منتج{filtered.length === products.length ? "" : ` من ${formatCount(products.length)}`}
              </>
            ) : loadError ? (
              "تعذر تحميل المنتجات"
            ) : (
              "جارٍ تحميل المنتجات..."
            )}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="btn-focus inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium text-foreground shadow-sm hover:border-primary/30 lg:hidden min-h-[44px]"
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden />
              التصفية
              {filters.brands.length + filters.categories.length > 0 && (
                <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground">
                  {filters.brands.length + filters.categories.length}
                </span>
              )}
            </button>
            <SortSelect value={sort} onChange={setSort} />
          </div>
        </div>
      </section>

      {/* Main */}
      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {loadError && !products && (
          <div className="card-elevated mx-auto max-w-lg p-10 text-center">
            <p className="font-semibold text-foreground">تعذر تحميل المنتجات</p>
            <p className="mt-1 text-sm text-muted-foreground">{loadError}</p>
            <button
              type="button"
              onClick={retry}
              className="btn-focus mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              إعادة المحاولة
            </button>
          </div>
        )}

        {!loadError && (
          <div className="flex gap-6 lg:gap-8">
            {/* Sidebar */}
            <aside className="hidden w-64 shrink-0 lg:block">
              <div className="sticky top-24 rounded-2xl border border-border bg-card p-5">
                {facets && (
                  <FilterPanel
                    products={facets}
                    categories={categories}
                    state={filters}
                    onChange={setFilters}
                    bounds={bounds}
                  />
                )}
              </div>
            </aside>

            {/* Grid */}
            <div className="min-w-0 flex-1">
              {!products ? <ProductGridSkeleton /> : <ProductGrid products={filtered} />}
            </div>
          </div>
        )}
      </section>

      {facets && (
        <FilterDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          products={facets}
          categories={categories}
          state={filters}
          onChange={setFilters}
          bounds={bounds}
          resultCount={filtered.length}
        />
      )}
    </>
  );
}
