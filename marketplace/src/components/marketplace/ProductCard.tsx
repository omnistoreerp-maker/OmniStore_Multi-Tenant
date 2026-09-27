import { Link } from "react-router-dom";
import { ShoppingCart, Cpu, HardDrive, MemoryStick } from "lucide-react";
import type { Product } from "@/types/product";
import { formatEGP } from "@/lib/format";
import { cartStore } from "@/stores/cart";
import { ProductImage } from "./ProductImage";
import { toast } from "sonner";

export function ProductCard({ product }: { product: Product }) {
  const handleAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    cartStore.add(product, 1);
    toast.success("تم إضافة المنتج إلى السلة", {
      description: product.name,
    });
  };

  return (
    <Link
      to={`/product/${product.id}`}
      className="group card-elevated flex flex-col overflow-hidden btn-focus"
      aria-label={`عرض تفاصيل ${product.name}`}
    >
      {/* Image */}
      <div className="p-3 pb-0">
        <ProductImage src={product.image} alt={product.name} brand={product.brand} />
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-3 p-4 pt-3">
        {/* Brand / category chip */}
        <div className="flex items-center justify-between gap-2">
          <span className="tech inline-flex items-center rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
            {product.brand}
          </span>
          {product.category && (
            <span className="truncate text-[11px] text-muted-foreground">
              {product.category}
            </span>
          )}
        </div>

        {/* Name — LTR, max 2 lines */}
        <h3
          className="tech text-[15px] font-semibold leading-snug text-foreground line-clamp-2 min-h-[2.6em]"
          title={product.name}
        >
          {product.name}
        </h3>

        {/* Compact specs */}
        <ul className="grid grid-cols-1 gap-1.5 text-[12.5px] text-muted-foreground">
          {product.specs.cpu && (
            <li className="flex items-center gap-1.5">
              <Cpu className="h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden />
              <span className="tech">{product.specs.cpu}</span>
            </li>
          )}
          {(product.specs.ram || product.specs.storage) && (
            <li className="flex items-center gap-1.5">
              <MemoryStick className="h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden />
              <span className="tech">
                {product.specs.ram ?? "—"}
                {product.specs.storage ? ` / ${product.specs.storage}` : ""}
              </span>
            </li>
          )}
          {product.specs.gpu && (
            <li className="flex items-center gap-1.5">
              <HardDrive className="h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden />
              <span className="tech">{product.specs.gpu}</span>
            </li>
          )}
        </ul>

        {/* Price */}
        <div className="mt-1 flex items-baseline gap-1">
          <span className="text-lg font-bold text-primary">{formatEGP(product.price)}</span>
        </div>

        {/* CTA row */}
        <div className="mt-auto flex items-center gap-2 pt-2">
          <button
            type="button"
            onClick={handleAdd}
            className="btn-focus inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 active:bg-primary/80 min-h-[44px]"
            aria-label={`أضف ${product.name} إلى السلة`}
          >
            <ShoppingCart className="h-4 w-4" aria-hidden />
            <span>أضف للسلة</span>
          </button>
          <span
            className="btn-focus inline-flex min-h-[44px] items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors group-hover:border-primary/40 group-hover:text-primary"
            aria-hidden
          >
            التفاصيل
          </span>
        </div>
      </div>
    </Link>
  );
}
