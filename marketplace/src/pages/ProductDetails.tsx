import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ChevronRight,
  ShoppingCart,
  Cpu,
  MemoryStick,
  HardDrive,
  Monitor,
  Layers,
} from "lucide-react";
import { toast } from "sonner";
import { fetchProduct } from "@/lib/api";
import type { Product } from "@/types/product";
import { formatEGP } from "@/lib/format";
import { ProductImage } from "@/components/marketplace/ProductImage";
import { cartStore } from "@/stores/cart";

export default function ProductDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [product, setProduct] = useState<Product | null | undefined>(undefined);
  const [qty, setQty] = useState(1);

  useEffect(() => {
    let cancelled = false;
    if (!id) return;
    fetchProduct(id).then((p) => {
      if (!cancelled) setProduct(p ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (product === undefined) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="h-8 w-40 animate-pulse rounded bg-secondary" />
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <div className="aspect-square animate-pulse rounded-2xl bg-secondary" />
          <div className="space-y-3">
            <div className="h-4 w-24 animate-pulse rounded bg-secondary" />
            <div className="h-8 w-3/4 animate-pulse rounded bg-secondary" />
            <div className="h-6 w-40 animate-pulse rounded bg-secondary" />
          </div>
        </div>
      </div>
    );
  }

  if (product === null) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <h1 className="text-2xl font-bold">المنتج غير موجود</h1>
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

  const specRows: { icon: React.ComponentType<{ className?: string }>; label: string; value?: string }[] = [
    { icon: Cpu, label: "المعالج", value: product.specs.cpu },
    { icon: MemoryStick, label: "الذاكرة / التخزين", value: product.specs.ram ? `${product.specs.ram} / ${product.specs.storage ?? "—"}` : undefined },
    { icon: HardDrive, label: "كارت الشاشة", value: product.specs.gpu },
    { icon: Monitor, label: "الشاشة", value: product.specs.display },
    { icon: Layers, label: "الجيل", value: product.specs.generation },
  ];

  const handleAdd = () => {
    cartStore.add(product, qty);
    toast.success("تمت إضافة المنتج إلى السلة", { description: `${product.name} × ${qty}` });
  };

  const handleBuy = () => {
    cartStore.add(product, qty);
    navigate("/checkout");
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      {/* Breadcrumb */}
      <nav aria-label="مسار التصفح" className="mb-6 flex items-center gap-1 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-primary">المتجر</Link>
        <ChevronRight className="h-4 w-4 rotate-180" aria-hidden />
        <span className="tech text-foreground">{product.brand}</span>
        <ChevronRight className="h-4 w-4 rotate-180" aria-hidden />
        <span className="tech line-clamp-1 text-foreground">{product.name}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:gap-12">
        {/* Media */}
        <div className="card-elevated overflow-hidden p-4 sm:p-6">
          <ProductImage src={product.image} alt={product.name} brand={product.brand} className="aspect-square rounded-2xl" />
        </div>

        {/* Info */}
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="tech inline-flex rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
              {product.brand}
            </span>
            {product.category && (
              <span className="text-xs text-muted-foreground">{product.category}</span>
            )}
          </div>

          <h1 className="tech mt-3 text-2xl font-extrabold leading-snug text-foreground sm:text-3xl">
            {product.name}
          </h1>

          <div className="mt-5 flex items-baseline gap-3">
            <span className="text-3xl font-extrabold text-primary sm:text-4xl">
              {formatEGP(product.price)}
            </span>
            {product.stock != null && product.stock > 0 && (
              <span className="text-xs text-muted-foreground">متوفّر</span>
            )}
          </div>

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
                onClick={() => setQty((q) => q + 1)}
                aria-label="زيادة الكمية"
                className="btn-focus grid h-full w-11 place-items-center text-foreground hover:bg-secondary"
              >
                +
              </button>
            </div>

            <button
              type="button"
              onClick={handleAdd}
              className="btn-focus inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-primary/20 bg-secondary px-5 text-sm font-semibold text-primary transition-colors hover:bg-primary/5"
            >
              <ShoppingCart className="h-4 w-4" aria-hidden />
              أضف للسلة
            </button>

            <button
              type="button"
              onClick={handleBuy}
              className="btn-focus inline-flex h-12 flex-1 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
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
