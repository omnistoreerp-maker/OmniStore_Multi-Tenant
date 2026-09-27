import { Link } from "react-router-dom";
import { ShoppingCart, Info } from "lucide-react";
import type { Product } from "@/types/product";
import { formatPrice } from "@/lib/format";
import { cartStore } from "@/stores/cart";
import { ProductImage } from "./ProductImage";
import { toast } from "sonner";

/** Compact spec caption line — only parts that exist in the real API payload. */
function specCaption(p: Product): string {
  const parts: string[] = [];
  if (p.specs.cpu) parts.push(p.specs.cpu);
  if (p.specs.ram || p.specs.storage) parts.push([p.specs.ram, p.specs.storage].filter(Boolean).join("/"));
  if (p.specs.gpu) parts.push(p.specs.gpu);
  return parts.join("  •  ");
}

/**
 * Product card — image-first, honest data only:
 * name, real specs caption, prominent API-priced currency-aware amount,
 * real stock availability, brand/category, clear "details" affordance.
 * NO fake ratings, reviews, discounts, original prices or delivery claims.
 * The whole card is a link whose accessible name is exactly
 * "عرض تفاصيل <name>" (QA contract), image container keeps a fixed ratio.
 */
export function ProductCard({ product }: { product: Product }) {
  const inStock = product.stock > 0;
  const caption = specCaption(product);

  const handleAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!inStock) return;
    cartStore.add(product, 1);
    toast.success("تم إضافة المنتج إلى السلة", { description: product.name });
  };

  return (
    <Link
      to={`/product/${product.id}`}
      className="group card-elevated flex h-full flex-col overflow-hidden btn-focus"
      aria-label={`عرض تفاصيل ${product.name}`}
    >
      {/* Image — fixed-ratio container, full-bleed */}
      <div className="relative">
        <ProductImage src={product.image} alt={product.name} brand={product.brand} ratio="aspect-[4/3]" />
        {!inStock && (
          <span className="absolute top-2 end-2 rounded-lg bg-background/95 px-2 py-1 text-[11px] font-bold text-destructive shadow-sm">
            غير متوفّر
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-2 p-3 sm:p-4">
        {/* Brand / category */}
        <div className="flex items-center justify-between gap-2">
          <span className="tech inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
            {product.brand}
          </span>
          {product.category && (
            <span className="truncate text-[11px] text-muted-foreground">{product.category}</span>
          )}
        </div>

        {/* Name */}
        <h3
          className="tech line-clamp-2 min-h-[2.6em] text-[14px] font-semibold leading-snug text-foreground transition-colors group-hover:text-primary sm:text-[15px]"
          title={product.name}
        >
          {product.name}
        </h3>

        {/* Specs caption — only real fields */}
        {caption && (
          <p className="tech line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground" title={caption}>
            {caption}
          </p>
        )}

        {/* Price + availability */}
        <div className="mt-auto flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 pt-1">
          <span className="whitespace-nowrap text-[15px] font-extrabold tabular-nums text-foreground sm:text-lg">
            {formatPrice(product.price, product.currency)}
          </span>
          <span className={`text-[11px] font-semibold ${inStock ? "text-emerald-600" : "text-destructive"}`}>
            {inStock ? "متوفّر" : "نفدت الكمية"}
          </span>
        </div>

        {/* CTA row — stacked on narrow cards, side-by-side when roomy */}
        <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap sm:items-center">
          <button
            type="button"
            onClick={handleAdd}
            disabled={!inStock}
            aria-label={`أضف ${product.name} إلى السلة`}
            className="btn-focus inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 active:bg-primary/80 disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto sm:flex-1"
          >
            <ShoppingCart className="h-4 w-4" aria-hidden />
            أضف للسلة
          </button>
          <span
            aria-hidden
            className="btn-focus inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 text-[13px] font-medium text-foreground transition-colors group-hover:border-primary/40 group-hover:text-primary sm:w-auto"
          >
            <Info className="h-3.5 w-3.5" aria-hidden />
            التفاصيل
          </span>
        </div>
      </div>
    </Link>
  );
}
