import type { Product } from "@/types/product";
import { ProductCard } from "./ProductCard";

export function ProductGrid({ products }: { products: Product[] }) {
  if (products.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/60 p-10 text-center">
        <p className="text-lg font-semibold text-foreground">لا توجد نتائج مطابقة</p>
        <p className="mt-1 text-sm text-muted-foreground">
          جرّب تعديل كلمة البحث أو إزالة بعض المرشحات.
        </p>
      </div>
    );
  }

  return (
    <div
      className="grid gap-4 sm:gap-5"
      style={{
        gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 240px), 1fr))",
      }}
    >
      {products.map((p) => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  );
}

export function ProductGridSkeleton() {
  return (
    <div
      className="grid gap-4 sm:gap-5"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 240px), 1fr))" }}
    >
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="card-elevated animate-pulse p-3">
          <div className="aspect-[4/3] w-full rounded-xl bg-secondary" />
          <div className="mt-4 h-3 w-16 rounded bg-secondary" />
          <div className="mt-3 h-4 w-40 rounded bg-secondary" />
          <div className="mt-2 h-3 w-32 rounded bg-secondary" />
          <div className="mt-4 h-5 w-24 rounded bg-secondary" />
          <div className="mt-4 h-10 w-full rounded-lg bg-secondary" />
        </div>
      ))}
    </div>
  );
}
