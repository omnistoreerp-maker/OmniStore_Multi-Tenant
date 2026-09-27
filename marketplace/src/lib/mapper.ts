import type { Product, ProductSpec } from "@/types/product";

/**
 * Maps a raw OmniStore product projection (`GET /api/v1/market/products`)
 * to the OnSpace UI Product model. Field names on the wire come from
 * backend/services/marketCatalog.service.js `_project()`:
 *
 *   id, name, sku, barcode, categoryId, brandId, price, currency,
 *   stockQty, imageUrl, description, unit, cpu, ramRom, gpu
 */
export interface RawProduct {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  categoryId?: string | null;
  brandId?: string | null;
  price: number;
  currency?: string;
  stockQty?: number;
  imageUrl?: string | null;
  description?: string | null;
  unit?: string | null;
  cpu?: string | null;
  ramRom?: string | null;
  gpu?: string | null;
}

const BRAND_LABELS: Record<string, string> = {
  hp: "HP",
  dell: "Dell",
  lenovo: "Lenovo",
  sony: "Sony",
};

const CATEGORY_LABELS: Record<string, string> = {
  laptops: "لابتوب",
  gaming: "ألعاب",
};

export function brandLabel(brandId?: string | null): string {
  if (!brandId) return "";
  const key = String(brandId).toLowerCase();
  return BRAND_LABELS[key] || String(brandId).toUpperCase();
}

export function categoryLabel(categoryId?: string | null): string {
  if (!categoryId) return "";
  const key = String(categoryId).toLowerCase();
  return CATEGORY_LABELS[key] || String(categoryId);
}

/**
 * OmniStore stores RAM/storage as a combined "ramRom" string (e.g. "16/256").
 * Split it for the UI spec rows; never invent missing parts.
 */
function splitRamRom(ramRom?: string | null): { ram?: string; storage?: string } {
  if (!ramRom) return {};
  const raw = String(ramRom);
  const idx = raw.indexOf("/");
  if (idx === -1) return { ram: raw.trim() };
  return { ram: raw.slice(0, idx).trim() || undefined, storage: raw.slice(idx + 1).trim() || undefined };
}

export function mapProduct(raw: RawProduct): Product {
  const { ram, storage } = splitRamRom(raw.ramRom);
  const specs: ProductSpec = {
    cpu: raw.cpu ? String(raw.cpu) : undefined,
    ram,
    storage,
    gpu: raw.gpu ? String(raw.gpu) : undefined,
  };
  return {
    id: String(raw.id),
    name: raw.name,
    brand: brandLabel(raw.brandId),
    brandId: raw.brandId != null ? String(raw.brandId) : undefined,
    category: raw.categoryId != null ? categoryLabel(raw.categoryId) : undefined,
    categoryId: raw.categoryId != null ? String(raw.categoryId) : undefined,
    price: Number(raw.price) || 0,
    currency: raw.currency || "EGP",
    // imageUrl may be null — ProductImage renders an honest placeholder then.
    image: raw.imageUrl || undefined,
    specs,
    description: raw.description || undefined,
    stock: Number(raw.stockQty) || 0,
    sku: raw.sku ?? null,
    unit: raw.unit ?? null,
  };
}
