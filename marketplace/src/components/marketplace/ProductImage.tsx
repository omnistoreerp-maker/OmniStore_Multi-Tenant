import { useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  src?: string;
  alt: string;
  brand?: string;
  className?: string;
  /** Fixed-ratio image container (prevents layout shift / distortion). */
  ratio?: string;
}

/**
 * Catalog `imageUrl` scheme allowlist: http(s), protocol-relative and plain
 * relative paths are safe in an <img src>; any other explicit scheme
 * (javascript:, data:, blob:, vbscript:, ...) is rejected up front.
 */
function isSafeImageSrc(value?: string): boolean {
  if (!value) return false;
  const v = value.trim();
  if (!v) return false;
  if (/^https?:\/\//i.test(v) || v.startsWith("//")) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return false;
  return !v.startsWith("\\");
}

/**
 * Real product image if the catalog provides one, otherwise a tasteful
 * neutral SVG placeholder — never a fabricated "product photograph".
 * object-contain keeps the original proportions (no stretching/cropping).
 */
export function ProductImage({ src, alt, brand, className, ratio = "aspect-[4/3]" }: Props) {
  const [failed, setFailed] = useState(false);
  const showImage = isSafeImageSrc(src) && !failed;

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden bg-gradient-to-br from-secondary via-background to-secondary/60",
        ratio,
        className
      )}
    >
      {showImage ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-contain p-4 transition-transform duration-500 group-hover:scale-[1.03]"
        />
      ) : (
        <Placeholder brand={brand} />
      )}
    </div>
  );
}

function Placeholder({ brand }: { brand?: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-primary/60">
      <svg
        viewBox="0 0 120 80"
        role="img"
        aria-hidden="true"
        className="h-20 w-24 sm:h-24 sm:w-28"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect x="18" y="10" width="84" height="52" rx="4" className="fill-white/70" />
        <rect x="24" y="16" width="72" height="40" rx="2" className="fill-primary/10" />
        <path d="M8 66h104l-6 8H14z" className="fill-white/70" />
        <line x1="52" y1="70" x2="68" y2="70" strokeLinecap="round" />
      </svg>
      {brand && (
        <span className="tech text-[11px] font-semibold uppercase tracking-wider text-primary/50">{brand}</span>
      )}
    </div>
  );
}
