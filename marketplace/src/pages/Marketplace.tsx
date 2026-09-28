import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PackageOpen, RefreshCw, SearchX, SlidersHorizontal, X } from "lucide-react";
import { marketApi, MarketApiError, type CategoryCount, type ProductQuery } from "@/lib/api";
import type { Product, SortKey } from "@/types/product";
import { SortSelect } from "@/components/marketplace/SortSelect";
import { FilterPanel, type FilterState } from "@/components/marketplace/FilterPanel";
import { FilterDrawer } from "@/components/marketplace/FilterDrawer";
import { ProductGrid, ProductGridSkeleton } from "@/components/marketplace/ProductGrid";
import { formatCount } from "@/lib/format";
import { useMarketUI } from "@/stores/marketUI";

/**
 * Marketplace catalog — all data comes from GET /api/v1/market/products:
 * search / category / sort are server-side (backend marketCatalog.service),
 * multi-brand selection and the price range are applied client-side ON THE
 * REAL API RESULT. No static catalog, no invented products.
 *
 * The search input lives in the global Header (shared via MarketUIProvider);
 * this page keeps the same 350ms debounce and server-side `search` param.
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
      return { sortBy: "name", sortOrder: "asc" }; // backend default
  }
}

export default function Marketplace() {
  const ui = useMarketUI();
  const [facets, setFacets] = useState<Product[] | null>(null);
  const [categories, setCategories] = useState<CategoryCount[]>([]);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [sort, setSort] = useState<SortKey>("featured");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    brands: [],
    categories: [],
    price: [0, 999999],
  });

  const query = ui.query;
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [gridLoading, setGridLoading] = useState(false);
  const gridSeq = useRef(0);

  // Debounce search input (350ms) before hitting the API — unchanged behavior.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  // Header progress bar: while debounce is pending or the grid is fetching.
  const pending = query.trim() !== debouncedQuery || gridLoading;
  useEffect(() => {
    ui.setFetching(pending);
    return () => {
      ui.setFetching(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  // Header category chip → apply as server-side category filter (once).
  // undefined = no pending request (idle) → ignore; null = explicit "الكل"
  // clear request → must clear the category filter; string = select category.
  useEffect(() => {
    if (ui.pendingCategory === undefined) return;
    setFilters((prev) => ({ ...prev, categories: ui.pendingCategory ? [ui.pendingCategory] : [] }));
    ui.requestCategory(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.pendingCategory]);

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
        if (cancelled) return;
        setCategories(c);
        ui.setCategories(c); // mirror real categories to the header (no extra fetch)
      })
      .catch(() => {
        /* categories are optional for rendering the grid */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  // Grid: server-side search / category / sort.
  const categoryId = filters.categories[0] || undefined;
  useEffect(() => {
    ui.setActiveCategory(categoryId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);
  useEffect(() => {
    const seq = ++gridSeq.current;
    setGridLoading(true);
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
        setLoadError(e instanceof MarketApiError ? e.message : "تعذر الاتصال بخدمة المنتجات");
      })
      .finally(() => {
        if (seq === gridSeq.current) setGridLoading(false);
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

  const hasActiveFilters = filters.brands.length + filters.categories.length > 0 || query.trim().length > 0;
  const clearSearch = () => ui.setQuery("");

  return (
    <>
      {/* Slim catalog banner — search lives in the header */}
      <section className="border-b border-border bg-gradient-to-bl from-primary via-primary to-[#0a2f30] text-primary-foreground">
        <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-4 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <div className="max-w-xl">
            <h1 className="text-xl font-extrabold leading-tight sm:text-2xl lg:text-3xl">
              أجهزة احترافية بأسعار واضحة
            </h1>
            <p className="mt-2 text-sm text-primary-foreground/80">
              مواصفات حقيقية من المتجر مباشرة — قارن، صنّف، واختر بثقة.
            </p>
          </div>
          <p className="tech hidden text-xs font-semibold tracking-[0.2em] text-primary-foreground/60 sm:block">
            HP · DELL · LENOVO · MICROSOFT
          </p>
        </div>
      </section>

      {/* Toolbar: results + mobile filters + sort (first <select> in DOM) */}
      <section className="border-b border-border bg-card/60">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {products ? (
              <>
                <span className="font-semibold text-foreground">{formatCount(filtered.length)}</span>{" "}
                منتج{filtered.length === products.length ? "" : ` من ${formatCount(products.length)}`}
                {query.trim() && <span className="text-muted-foreground"> — نتائج «{query.trim()}»</span>}
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
              className="btn-focus inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium text-foreground shadow-sm hover:border-primary/30 lg:hidden"
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
          <div className="card-elevated mx-auto max-w-lg p-10 text-center" role="alert">
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
            {/* Desktop filter sidebar */}
            <aside className="hidden w-64 shrink-0 lg:block">
              <div className="sticky top-32 rounded-2xl border border-border bg-card p-5">
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

            {/* Grid + states */}
            <div className="min-w-0 flex-1">
              {!products ? (
                <ProductGridSkeleton />
              ) : filtered.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-card/60 p-10 text-center">
                  {query.trim() ? (
                    <>
                      <SearchX className="mx-auto h-10 w-10 text-muted-foreground/70" aria-hidden />
                      <p className="mt-3 text-lg font-semibold text-foreground">لا توجد نتائج لـ «{query.trim()}»</p>
                      <p className="mt-1 text-sm text-muted-foreground">جرّب كلمة بحث مختلفة أو تصفّح كل المنتجات.</p>
                      <button
                        type="button"
                        onClick={clearSearch}
                        className="btn-focus mt-5 inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground hover:border-primary/40 hover:text-primary"
                      >
                        <X className="h-4 w-4" aria-hidden />
                        مسح البحث
                      </button>
                    </>
                  ) : hasActiveFilters ? (
                    <>
                      <SearchX className="mx-auto h-10 w-10 text-muted-foreground/70" aria-hidden />
                      <p className="mt-3 text-lg font-semibold text-foreground">لا توجد نتائج مطابقة للمرشحات</p>
                      <p className="mt-1 text-sm text-muted-foreground">جرّب إزالة بعض الماركات أو توسيع نطاق السعر.</p>
                      <button
                        type="button"
                        onClick={() => setFilters({ brands: [], categories: [], price: bounds })}
                        className="btn-focus mt-5 inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground hover:border-primary/40 hover:text-primary"
                      >
                        إعادة ضبط المرشحات
                      </button>
                    </>
                  ) : (
                    <>
                      <PackageOpen className="mx-auto h-10 w-10 text-muted-foreground/70" aria-hidden />
                      <p className="mt-3 text-lg font-semibold text-foreground">لا توجد منتجات حالًا</p>
                      <p className="mt-1 text-sm text-muted-foreground">سيتم عرض المنتجات هنا فور توفرها.</p>
                    </>
                  )}
                </div>
              ) : (
                <ProductGrid products={filtered} />
              )}
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
