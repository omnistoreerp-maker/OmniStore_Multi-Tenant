import { Link } from "react-router-dom";
import { ShoppingCart, Store } from "lucide-react";
import { useCartCount } from "@/stores/cart";
import { formatCount } from "@/lib/format";

interface Props {
  onOpenCart: () => void;
}

export function Header({ onOpenCart }: Props) {
  const count = useCartCount();

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:h-[72px] sm:px-6 lg:px-8">
        <Link to="/" className="btn-focus group flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-transform group-hover:scale-105">
            <Store className="h-5 w-5" aria-hidden />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="tech text-[15px] font-extrabold tracking-tight text-foreground">
              OmniStore
            </span>
            <span className="text-[11px] font-medium text-muted-foreground">Marketplace · المتجر</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="التنقل الرئيسي">
          <Link
            to="/"
            className="btn-focus rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary"
          >
            المتجر
          </Link>
          <Link
            to="/orders"
            className="btn-focus rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            طلباتي
          </Link>
          <Link
            to="/account"
            className="btn-focus rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            حسابي
          </Link>
          <a
            href="https://omnistoreerp.com"
            className="btn-focus rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            OmniStore ERP
          </a>
        </nav>

        <button
          type="button"
          onClick={onOpenCart}
          aria-label={`السلة، ${formatCount(count)} عنصر`}
          className="btn-focus relative inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-semibold text-foreground shadow-sm transition-colors hover:border-primary/30 hover:text-primary min-h-[44px]"
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
    </header>
  );
}
