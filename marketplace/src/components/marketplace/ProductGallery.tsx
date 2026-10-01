import { useState } from "react";
import { ProductImage } from "./ProductImage";
import { cn } from "@/lib/utils";
import { uiLang } from "@/lib/format";

interface Props {
  /** Real image URL(s) from the API — the current catalog exposes one imageUrl. */
  images: string[];
  alt: string;
  brand?: string;
  ratio?: string;
}

/**
 * Gallery structure ready for multi-image catalogs: when the API provides
 * more than one image, a thumbnail strip appears under the main view.
 * With today's single imageUrl it renders just the main image (no fake thumbs).
 */
export function ProductGallery({ images, alt, brand, ratio = "aspect-square" }: Props) {
  const list = images.filter(Boolean);
  const [active, setActive] = useState(0);
  const current = list[Math.min(active, Math.max(0, list.length - 1))];

  return (
    <div className="flex flex-col gap-3">
      <ProductImage
        key={current || "none"}
        src={current}
        alt={alt}
        brand={brand}
        ratio={ratio}
        className="rounded-2xl border border-border"
      />
      {list.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1" role="list" aria-label="صور المنتج">
          {list.map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => setActive(i)}
              aria-label={uiLang() === "en" ? `Image ${i + 1}` : `صورة ${i + 1}`}
              className={cn(
                "btn-focus w-16 shrink-0 overflow-hidden rounded-lg border-2 transition-colors sm:w-20",
                i === active ? "border-primary" : "border-border hover:border-primary/40"
              )}
            >
              <ProductImage src={src} alt={`${alt} — ${i + 1}`} brand={brand} ratio="aspect-square" className="rounded-none" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
