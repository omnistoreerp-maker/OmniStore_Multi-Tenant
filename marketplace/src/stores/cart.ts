import { useEffect, useState, useSyncExternalStore } from "react";
import type { Product } from "@/types/product";
import { MARKET_TENANT, marketApi, type AvailabilityRow } from "@/lib/api";

/**
 * Real cart store — same philosophy as market/js/store.js:
 *
 * - Persists ONLY client intent: { productId, qty } under `mk_cart_{tenant}`.
 * - Never persists prices or product snapshots: display and totals are always
 *   resolved against the live catalog (GET /api/v1/market/products).
 * - `reconcile()` validates stock against GET /availability before checkout.
 */

export interface CartRef {
  productId: string;
  qty: number;
}

export interface ResolvedCartItem {
  product: Product;
  quantity: number;
}

const STORAGE_KEY = `mk_cart_${MARKET_TENANT}`;

function readRefs(): CartRef[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];
    return items
      .filter((i: CartRef) => i && typeof i.productId === "string")
      .map((i: CartRef) => ({ productId: i.productId, qty: Math.max(1, Number(i.qty) || 1) }));
  } catch (_) {
    return [];
  }
}

function persist(refs: CartRef[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(refs));
  } catch (_) {
    /* ignore quota */
  }
}

/* ------------------------- refs store (intent) ------------------------- */

let refs: CartRef[] = readRefs();
const refListeners = new Set<() => void>();

function emitRefs(): void {
  refListeners.forEach((l) => l());
}

function setRefs(next: CartRef[]): void {
  refs = next;
  persist(refs);
  emitRefs();
}

function subscribeRefs(cb: () => void): () => void {
  refListeners.add(cb);
  return () => refListeners.delete(cb);
}

function getRefsSnapshot(): CartRef[] {
  return refs;
}

/* --------------------- resolution (live catalog join) --------------------- */

let resolved: ResolvedCartItem[] = [];
const resolveListeners = new Set<() => void>();
let resolveSeq = 0;
// True when the last catalog join failed — lets the cart UI show an error
// instead of a false "empty cart".
let resolveError = false;

function emitResolved(): void {
  resolveListeners.forEach((l) => l());
}

/**
 * Joins persisted refs with the live catalog so names/prices always come
 * from the API (never from localStorage). Refs pointing to products that
 * disappeared from the catalog are hidden (and pruned like market.html does).
 */
async function loadResolved(): Promise<ResolvedCartItem[]> {
  const current = refs;
  if (current.length === 0) {
    if (resolved.length || resolveError) {
      resolved = [];
      resolveError = false;
      emitResolved();
    }
    return resolved;
  }
  const seq = ++resolveSeq;
  try {
    const page = await marketApi.products({ limit: 100, includeOutOfStock: true });
    if (seq !== resolveSeq) return resolved; // superseded
    const byId = new Map(page.products.map((p) => [p.id, p]));
    const next: ResolvedCartItem[] = [];
    const pruned: CartRef[] = [];
    current.forEach((r) => {
      const product = byId.get(r.productId);
      if (product) {
        next.push({ product, quantity: r.qty });
        pruned.push(r);
      }
    });
    if (pruned.length !== current.length) {
      refs = pruned;
      persist(refs);
      emitRefs();
    }
    resolved = next;
    resolveError = false;
    emitResolved();
  } catch (_) {
    // API unreachable — keep last known resolution; do not invent data.
    resolveError = true;
    emitResolved();
  }
  return resolved;
}

/** Kick an initial resolution at module load (only when cart has items). */
if (refs.length) void loadResolved();

/* -------------------------------- public -------------------------------- */

function stockCap(productId: string): number | null {
  const entry = resolved.find((x) => x.product.id === productId);
  const stock = entry?.product.stock;
  return typeof stock === "number" && stock > 0 ? stock : null;
}

export const cartStore = {
  subscribeRefs,
  subscribeResolved(cb: () => void): () => void {
    resolveListeners.add(cb);
    return () => resolveListeners.delete(cb);
  },
  add(product: Product | string, qty = 1): void {
    const productId = typeof product === "string" ? product : product.id;
    const cap = stockCap(productId);
    const existing = refs.find((r) => r.productId === productId);
    let next: CartRef[];
    if (existing) {
      next = refs.map((r) => {
        if (r.productId !== productId) return r;
        let target = Math.max(1, r.qty + (qty || 1));
        if (cap != null) target = Math.min(target, cap);
        return { ...r, qty: target };
      });
    } else {
      const target = Math.max(1, qty || 1);
      next = [...refs, { productId, qty: cap != null ? Math.min(target, cap) : target }];
    }
    setRefs(next);
    void loadResolved();
  },
  remove(productId: string): void {
    setRefs(refs.filter((r) => r.productId !== productId));
    void loadResolved();
  },
  setQuantity(productId: string, qty: number): void {
    if (qty <= 0) {
      cartStore.remove(productId);
      return;
    }
    const cap = stockCap(productId);
    const target = cap != null ? Math.min(qty, cap) : qty;
    setRefs(refs.map((r) => (r.productId === productId ? { ...r, qty: Math.max(1, target) } : r)));
    void loadResolved();
  },
  clear(): void {
    setRefs([]);
    resolved = [];
    resolveError = false;
    emitResolved();
  },
  refs: (): CartRef[] => refs.slice(),
  count: (): number => refs.reduce((n, r) => n + (r.qty || 0), 0),
  items: (): ResolvedCartItem[] => resolved,
  resolveFailed: (): boolean => resolveError,
  load: loadResolved,
  /**
   * Validates the cart against GET /availability (same rule as
   * market/js/store.js): drop rows the server marks unavailable or whose
   * stockQty cannot cover the requested qty. Returns true when anything
   * changed so callers can inform the user.
   */
  async reconcile(): Promise<boolean> {
    if (!refs.length) return false;
    let rows: AvailabilityRow[];
    try {
      rows = await marketApi.availability(refs.map((r) => r.productId));
    } catch (_) {
      // Availability must never be silently skipped before checkout.
      throw new Error("تعذر التحقق من توفر المنتجات، حاول مرة أخرى");
    }
    const byId = new Map<string, AvailabilityRow>(rows.map((a) => [a.id, a]));
    const before = JSON.stringify(refs);
    const next = refs.filter((r) => {
      const a = byId.get(r.productId);
      return !!a && a.available && a.stockQty >= r.qty;
    });
    if (JSON.stringify(next) !== before) {
      setRefs(next);
      await loadResolved();
      return true;
    }
    await loadResolved();
    return false;
  },
};

/* -------------------------------- hooks -------------------------------- */

export function useCartRefs(): CartRef[] {
  return useSyncExternalStore(subscribeRefs, getRefsSnapshot, getRefsSnapshot);
}

/** Resolved items with LIVE prices. Loads the join on mount when needed. */
export function useCart(): ResolvedCartItem[] {
  const cartRefs = useCartRefs();
  const [, force] = useState(0);
  useEffect(() => {
    const off = cartStore.subscribeResolved(() => force((n) => n + 1));
    if (cartRefs.length) void loadResolved();
    return off;
  }, [cartRefs]);
  return useSyncExternalStore(
    cartStore.subscribeResolved,
    () => resolved,
    () => resolved
  );
}

export function useCartCount(): number {
  const cartRefs = useCartRefs();
  return cartRefs.reduce((n, r) => n + (r.qty || 0), 0);
}

export function useCartTotal(): number {
  const items = useCart();
  return items.reduce((s, i) => s + i.quantity * i.product.price, 0);
}
