import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Loader2, Menu, Search as SearchIcon, ShoppingCart, Store, User } from "lucide-react";
import { useCartCount } from "@/stores/cart";
import { useMarketUI } from "@/stores/marketUI";
import { formatCount, uiLang } from "@/lib/format";
import { categoryLabel } from "@/lib/mapper";
import { MobileNav } from "./MobileNav";

interface Props {
  onOpenCart: () => void;
}

/**
 * Marketplace header: logo, ONE prominent search input
 * (aria-label="بحث في المتجر", shared through MarketUIProvider — the catalog
 * page consumes it with its existing 350ms debounce), category quick access
 * fed by the catalog's real GET /categories result (no extra API call),
 * account entry (#/account exists) and the cart indicator.
 * The cart button stays visible at every breakpoint (QA contract).
 */
export function Header({ onOpenCart }: Props) {
  const count = useCartCount();
  const ui = useMarketUI();
  const navigate = useNavigate();
  const location = useLocation();
  const onHome = location.pathname === "/";
  const [menuOpen, setMenuOpen] = useState(false);

  const handleSearch = (v: string) => {
    ui.setQuery(v);
    if (v && !onHome) navigate("/");
  };

  const pickCategory = (id: string | null) => {
    ui.requestCategory(id);
    if (!onHome) navigate("/");
  };

  return (
    <>
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/95 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 sm:h-16 sm:gap-3 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link to="/" className="btn-focus group flex shrink-0 items-center gap-2" aria-label="OmniStore — الصفحة الرئيسية">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-transform group-hover:scale-105 sm:h-10 sm:w-10">
            <Store className="h-5 w-5" aria-hidden />
          </span>
          <span className="hidden flex-col leading-tight sm:flex">
            <span className="tech text-[15px] font-extrabold tracking-tight text-foreground">OmniStore</span>
            <span className="text-[11px] font-medium text-muted-foreground">Marketplace</span>
          </span>
        </Link>

        {/* Search — the single app search input */}
        <div className="min-w-0 flex-1 sm:max-w-xl md:max-w-2xl">
          <HeaderSearch value={ui.query} onChange={handleSearch} loading={ui.fetching} />
        </div>

        {/* Menu — mobile drawer holds shop/orders/platform (nav is md+) */}
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="القائمة"
          aria-expanded={menuOpen}
          aria-controls="mobile-nav-menu"
          className="btn-focus grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-card text-foreground shadow-sm transition-colors hover:border-primary/30 hover:text-primary md:hidden"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>

        {/* Account — icon on mobile, text link on md+ (nav) */}
        <Link
          to="/account"
          aria-label="حسابي"
          className="btn-focus grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-card text-foreground shadow-sm transition-colors hover:border-primary/30 hover:text-primary md:hidden"
        >
          <User className="h-5 w-5" aria-hidden />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="التنقل الرئيسي">
          <Link to="/" className="btn-focus rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary">
            المتجر
          </Link>
          <Link to="/orders" className="btn-focus rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">
            طلباتي
          </Link>
          <Link to="/account" className="btn-focus rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">
            حسابي
          </Link>
          <a
            href="/"
            className="btn-focus rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            OmniStore ERP
          </a>
        </nav>

        {/* Language switcher — rendered by platform/omni-i18n.js */}
        <div data-omni-lang-slot />

        {/* Cart — always visible */}
        <button
          type="button"
          onClick={onOpenCart}
          aria-label={
            uiLang() === "en"
              ? `Cart, ${formatCount(count)} items`
              : `السلة، ${formatCount(count)} عنصر`
          }
          className="btn-focus relative inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold text-foreground shadow-sm transition-colors hover:border-primary/30 hover:text-primary sm:h-11"
        >
          <ShoppingCart className="h-5 w-5" aria-hidden />
          <span className="hidden sm:inline">السلة</span>
          {count > 0 && (
            <span
              aria-hidden
              className="absolute -top-1.5 -start-1.5 grid h-5 min-w-[20px] place-items-center rounded-full bg-accent px-1 text-[11px] font-bold text-accent-foreground shadow"
            >
              {formatCount(count)}
            </span>
          )}
        </button>
      </div>

      {/* Category quick access — real GET /categories data mirrored here */}
      {ui.categories.length > 0 && (
        <div className="border-t border-border/60 bg-card/40">
          <div className="mx-auto flex max-w-7xl items-center gap-2 overflow-x-auto px-3 py-2 sm:px-6 lg:px-8" aria-label="فئات المتجر">
            <button
              type="button"
              onClick={() => pickCategory(null)}
              className={`btn-focus shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                ui.activeCategory === null
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-primary"
              }`}
            >
              الكل
            </button>
            {ui.categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => pickCategory(c.id)}
                className={`btn-focus shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  ui.activeCategory === c.id
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-primary"
                }`}
              >
                {categoryLabel(c.id)}
                <span className="ms-1.5 text-[10px] font-normal text-muted-foreground">{formatCount(c.count)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Fetch progress */}
      {ui.fetching && (
        <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-primary/10" aria-hidden>
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
        </div>
      )}
    </header>
    {/* Outside the header: its backdrop-filter would otherwise become the
        containing block for the fixed-position drawer. */}
    <div id="mobile-nav-menu">
      <MobileNav open={menuOpen} onClose={() => setMenuOpen(false)} />
    </div>
    </>
  );
}

/** Single search input (exactly one aria-label="بحث في المتجر" in the app). */
function HeaderSearch({ value, onChange, loading }: { value: string; onChange: (v: string) => void; loading: boolean }) {
  return (
    <div className="relative w-full">
      {loading ? (
        <Loader2 className="pointer-events-none absolute end-3 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-primary" aria-hidden />
      ) : (
        <SearchIcon className="pointer-events-none absolute end-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      )}
      <input
        type="search"
        inputMode="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="ابحث عن جهاز، ماركة، أو موديل..."
        aria-label="بحث في المتجر"
        className={`btn-focus h-10 w-full rounded-xl border border-border bg-card pe-10 text-[14px] text-foreground shadow-sm transition-colors placeholder:text-muted-foreground hover:border-primary/30 focus-visible:border-primary/50 sm:h-11 sm:text-[15px] ${
          value ? "ps-9" : "ps-4"
        }`}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="مسح البحث"
          className="btn-focus absolute start-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <span className="block h-4 w-4 leading-none" aria-hidden>
            ×
          </span>
        </button>
      )}
    </div>
  );
}
