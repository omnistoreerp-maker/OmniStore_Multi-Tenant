import type { Product } from "@/types/product";
import { ProductCard } from "./ProductCard";

/**
 * Responsive catalog grid:
 *   mobile → 2 readable columns, tablet → 3, desktop (xl+) → 4.
 * Card content is clamped so nothing escapes the card at 320px.
 */
export function ProductGrid({ products }: { products: Product[] }) {
  if (products.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/60 p-10 text-center">
        <p className="text-lg font-semibold text-foreground">لا توجد نتائج مطابقة</p>
        <p className="mt-1 text-sm text-muted-foreground">جرّب تعديل كلمة البحث أو إزالة بعض المرشحات.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  );
}

export function ProductGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4" aria-hidden>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="card-elevated animate-pulse overflow-hidden">
          <div className="aspect-[4/3] w-full bg-secondary" />
          <div className="space-y-3 p-3 sm:p-4">
            <div className="h-4 w-16 rounded bg-secondary" />
            <div className="h-4 w-full rounded bg-secondary" />
            <div className="h-3 w-3/4 rounded bg-secondary" />
            <div className="h-5 w-28 rounded bg-secondary" />
            <div className="h-10 w-full rounded-lg bg-secondary" />
          </div>
        </div>
      ))}
    </div>
  );
}
