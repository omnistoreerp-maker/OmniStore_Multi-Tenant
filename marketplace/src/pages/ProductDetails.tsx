import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ChevronRight,
  ShoppingCart,
  Cpu,
  MemoryStick,
  HardDrive,
  Monitor,
  Layers,
  RefreshCw,
  PackageX,
} from "lucide-react";
import { toast } from "sonner";
import { fetchProduct, MarketApiError } from "@/lib/api";
import type { Product } from "@/types/product";
import { formatPrice } from "@/lib/format";
import { ProductGallery } from "@/components/marketplace/ProductGallery";
import { cartStore } from "@/stores/cart";

/**
 * Product details — every block comes from the real
 * GET /api/v1/market/products/:id payload: gallery, name, brand/category,
 * API-priced currency-aware amount, real stock availability, specs and
 * description. No fabricated ratings, reviews, discounts or policies.
 */
export default function ProductDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [product, setProduct] = useState<Product | null | undefined>(undefined);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [qty, setQty] = useState(1);

  useEffect(() => {
    let cancelled = false;
    if (!id) return;
    setProduct(undefined);
    setFetchError(null);
    fetchProduct(id)
      .then((p) => {
        if (!cancelled) setProduct(p ?? null);
      })
      .catch((e) => {
        if (cancelled) return;
        setProduct(null);
        setFetchError(e instanceof MarketApiError ? e.message : "تعذر الاتصال بخدمة المنتجات");
      });
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  if (fetchError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center" role="alert">
        <h1 className="text-2xl font-bold">تعذر تحميل المنتج</h1>
        <p className="mt-2 text-muted-foreground">{fetchError}</p>
        <button
          type="button"
          onClick={retry}
          className="btn-focus mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          إعادة المحاولة
        </button>
      </div>
    );
  }

  if (product === undefined) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8" aria-hidden>
        <div className="h-8 w-40 animate-pulse rounded bg-secondary" />
        <div className="mt-8 grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:gap-12">
          <div className="aspect-square animate-pulse rounded-2xl bg-secondary" />
          <div className="space-y-4">
            <div className="h-4 w-24 animate-pulse rounded bg-secondary" />
            <div className="h-9 w-3/4 animate-pulse rounded bg-secondary" />
            <div className="h-7 w-40 animate-pulse rounded bg-secondary" />
            <div className="h-24 w-full animate-pulse rounded-2xl bg-secondary" />
            <div className="h-12 w-full animate-pulse rounded-xl bg-secondary" />
          </div>
        </div>
      </div>
    );
  }

  if (product === null) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <PackageX className="mx-auto h-12 w-12 text-muted-foreground/70" aria-hidden />
        <h1 className="mt-4 text-2xl font-bold">المنتج غير موجود</h1>
        <p className="mt-2 text-muted-foreground">قد يكون المنتج قد أزيل أو أن الرابط غير صحيح.</p>
        <Link
          to="/"
          className="btn-focus mt-6 inline-flex rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          العودة للمتجر
        </Link>
      </div>
    );
  }

  const inStock = product.stock > 0;

  const specRows: { icon: React.ComponentType<{ className?: string }>; label: string; value?: string }[] = [
    { icon: Cpu, label: "المعالج", value: product.specs.cpu },
    {
      icon: MemoryStick,
      label: "الذاكرة / التخزين",
      value: product.specs.ram ? `${product.specs.ram} / ${product.specs.storage ?? "—"}` : undefined,
    },
    { icon: HardDrive, label: "كارت الشاشة", value: product.specs.gpu },
    { icon: Monitor, label: "الشاشة", value: product.specs.display },
    { icon: Layers, label: "الجيل", value: product.specs.generation },
  ];

  const handleAdd = () => {
    if (!inStock) return;
    cartStore.add(product, qty);
    toast.success("تمت إضافة المنتج إلى السلة", { description: `${product.name} × ${qty}` });
  };

  const handleBuy = () => {
    if (!inStock) return;
    cartStore.add(product, qty);
    navigate("/checkout");
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      {/* Breadcrumb */}
      <nav aria-label="مسار التصفح" className="mb-6 flex items-center gap-1 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-primary">
          المتجر
        </Link>
        <ChevronRight className="h-4 w-4 rotate-180" aria-hidden />
        <span className="tech text-foreground">{product.brand}</span>
        <ChevronRight className="h-4 w-4 rotate-180" aria-hidden />
        <span className="tech line-clamp-1 text-foreground">{product.name}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:gap-12">
        {/* Media — gallery structure (thumbnails appear only if API sends >1 image) */}
        <div className="card-elevated p-4 sm:p-6">
          <ProductGallery images={product.image ? [product.image] : []} alt={product.name} brand={product.brand} />
        </div>

        {/* Info */}
        <div className="flex flex-col">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tech inline-flex rounded-md bg-secondary px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-primary">
              {product.brand}
            </span>
            {product.category && <span className="text-xs text-muted-foreground">{product.category}</span>}
          </div>

          <h1 className="tech mt-3 text-2xl font-extrabold leading-snug text-foreground sm:text-3xl">
            {product.name}
          </h1>

          {/* Price + real availability */}
          <div className="mt-5 flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <span className="whitespace-nowrap text-3xl font-extrabold tabular-nums text-foreground sm:text-4xl">
              {formatPrice(product.price, product.currency)}
            </span>
            <span
              className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${
                inStock ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-red-50 text-red-700 ring-1 ring-red-200"
              }`}
            >
              {inStock ? "متوفّر" : "غير متوفّر حاليًا"}
            </span>
          </div>

          {!inStock && (
            <p className="mt-2 text-sm font-medium text-destructive">
              هذا المنتج غير متوفّر في المخزون حاليًا — لا يمكن إضافته للسلة.
            </p>
          )}

          {/* Description (real API field, shown only when present) */}
          {product.description && (
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{product.description}</p>
          )}

          {/* Key specs card */}
          <dl className="mt-6 grid grid-cols-1 gap-2 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2">
            {specRows
              .filter((r) => !!r.value)
              .map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex items-center gap-3 rounded-lg p-2">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <dt className="text-[11px] text-muted-foreground">{label}</dt>
                    <dd className="tech truncate text-sm font-semibold text-foreground">{value}</dd>
                  </div>
                </div>
              ))}
          </dl>

          {/* Quantity + CTA */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="inline-flex h-12 items-center rounded-xl border border-border bg-card">
              <button
                type="button"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                aria-label="تقليل الكمية"
                className="btn-focus grid h-full w-11 place-items-center text-foreground hover:bg-secondary"
              >
                −
              </button>
              <span className="min-w-[2.5rem] text-center text-sm font-bold">{qty}</span>
              <button
                type="button"
                onClick={() => setQty((q) => Math.min(product.stock ?? Number.MAX_SAFE_INTEGER, q + 1))}
                disabled={product.stock != null && qty >= product.stock}
                aria-label="زيادة الكمية"
                className="btn-focus grid h-full w-11 place-items-center text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:text-muted-foreground/50 disabled:hover:bg-transparent"
              >
                +
              </button>
            </div>

            <button
              type="button"
              onClick={handleAdd}
              disabled={!inStock}
              className="btn-focus inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-primary/20 bg-secondary px-5 text-sm font-semibold text-primary transition-colors hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <ShoppingCart className="h-4 w-4" aria-hidden />
              أضف للسلة
            </button>

            <button
              type="button"
              onClick={handleBuy}
              disabled={!inStock}
              className="btn-focus inline-flex h-12 flex-1 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
            >
              اشتري الآن
            </button>
          </div>
        </div>
      </div>

      {/* Full specifications */}
      <section className="mt-12" aria-labelledby="full-specs">
        <h2 id="full-specs" className="text-lg font-bold text-foreground sm:text-xl">
          المواصفات الكاملة
        </h2>
        <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
          <dl className="divide-y divide-border">
            <SpecRow label="اسم الموديل" value={product.name} tech />
            <SpecRow label="الماركة" value={product.brand} tech />
            {product.category && <SpecRow label="الفئة" value={product.category} />}
            {product.specs.cpu && <SpecRow label="المعالج" value={product.specs.cpu} tech />}
            {product.specs.ram && <SpecRow label="الذاكرة (RAM)" value={`${product.specs.ram} GB`} tech />}
            {product.specs.storage && <SpecRow label="التخزين" value={product.specs.storage} tech />}
            {product.specs.gpu && <SpecRow label="كارت الشاشة" value={product.specs.gpu} tech />}
            {product.specs.display && <SpecRow label="الشاشة" value={product.specs.display} tech />}
            {product.specs.generation && <SpecRow label="الجيل" value={product.specs.generation} tech />}
            {product.sku && <SpecRow label="رمز المنتج (SKU)" value={product.sku} tech />}
            <SpecRow label="التوفر" value={inStock ? "متوفّر" : "غير متوفّر"} />
          </dl>
        </div>
      </section>
    </div>
  );
}

function SpecRow({ label, value, tech }: { label: string; value: string; tech?: boolean }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-4 px-4 py-3 sm:grid-cols-[200px_1fr] sm:px-6">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={`text-sm font-semibold text-foreground ${tech ? "tech" : ""}`}>{value}</dd>
    </div>
  );
}
