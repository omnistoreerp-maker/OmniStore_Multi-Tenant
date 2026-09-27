export interface ProductSpec {
  cpu?: string;
  ram?: string;
  storage?: string;
  gpu?: string;
  display?: string;
  os?: string;
  generation?: string;
}

export interface Product {
  id: string;
  name: string;          // Technical model name, LTR (e.g. "HP ELITEBOOK 830 G8")
  brand: string;         // e.g. "HP", "Dell", "Lenovo"
  brandId?: string;      // OmniStore brandId (e.g. "hp") — used for API filtering
  category?: string;     // Human-readable category label
  categoryId?: string;   // OmniStore categoryId (e.g. "laptops") — used for API filtering
  price: number;         // EGP (live from /api/v1/market)
  currency?: string;     // e.g. "EGP"
  image?: string;        // Real product image URL when the catalog provides one
  specs: ProductSpec;
  description?: string;
  stock?: number;        // stockQty from the live catalog
  sku?: string | null;
  unit?: string | null;
}

export type SortKey = "featured" | "price-asc" | "price-desc" | "name-asc";
