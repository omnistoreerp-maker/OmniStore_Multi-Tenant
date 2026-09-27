import type { Product } from "@/types/product";
import type { RawProduct } from "./mapper";
import { mapProduct } from "./mapper";

/**
 * OmniStore Market API adapter — the ONLY network layer of this app.
 *
 * Talks to the real backend mounted at `/api/v1/market`
 * (backend/routes/market.routes.js) with the real response envelope:
 *
 *   { success: boolean, message: string, data: T }
 *
 * Tenant is identified with the `X-Tenant-Id` header (trusted server-side,
 * see backend/middleware/marketAuth.js). Customer sessions reuse the same
 * `mk_token` localStorage key as the existing market.html storefront.
 *
 * There is NO static catalog fallback: products, prices and ids always come
 * from the live API.
 */

export const MARKET_BASE = "/api/v1/market";
export const MARKET_TENANT = "default";
const TOKEN_KEY = "mk_token"; // shared with market.html session

export class MarketApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "MarketApiError";
    this.status = status;
  }
}

export function token(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) || null;
  } catch (_) {
    return null;
  }
}

export function setToken(t: string | null): void {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (_) {
    /* ignore quota / private mode */
  }
}

export function isAuthed(): boolean {
  return !!token();
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    "X-Tenant-Id": MARKET_TENANT,
    Accept: "application/json",
  };
  const t = token();
  if (t) headers["Authorization"] = "Bearer " + t;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);

  const res = await fetch(MARKET_BASE + path, init);
  let json: { success?: boolean; message?: string; data?: unknown } | null = null;
  try {
    json = (await res.json()) as typeof json;
  } catch (_) {
    json = null;
  }
  if (!res.ok || !json || json.success !== true) {
    const msg = (json && json.message) || "تعذر الاتصال بالخادم";
    throw new MarketApiError(msg, res.status);
  }
  return (json.data as T) ?? (null as unknown as T);
}

/* ---------- shapes (mirrored from backend controllers/services) ---------- */

export interface ProductQuery {
  search?: string;
  categoryId?: string;
  brandId?: string;
  sortBy?: "name" | "price";
  sortOrder?: "asc" | "desc";
  includeOutOfStock?: boolean;
  limit?: number;
  page?: number;
}

export interface ProductsPage {
  products: Product[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CategoryCount {
  id: string;
  count: number;
}

export interface AvailabilityRow {
  id: string;
  stockQty: number;
  available: boolean;
}

export interface ShippingZone {
  id: string;
  name: string;
  fee: number;
  freeAbove?: number;
}

export interface PaymentMethod {
  id: string;
  name: string;
  active?: boolean;
}

export interface MarketConfig {
  storeName: string;
  currency: string;
  locale: string;
  shippingZones: ShippingZone[];
  paymentMethods: PaymentMethod[];
  enabled: boolean;
}

export interface OrderLine {
  productId?: string;
  name: string;
  qty: number;
  unitPrice?: number;
  lineTotal?: number;
}

export interface Order {
  id?: string;
  orderCode: string;
  trackingToken?: string;
  customerId?: string | null;
  status: string;
  paymentStatus: string;
  items: OrderLine[];
  subtotal?: number;
  discount?: number;
  shippingFee?: number;
  total?: number;
  couponCode?: string | null;
  paymentMethod?: string;
  shippingAddress?: string | null;
  createdAt: string;
  updatedAt?: string;
  cancelledAt?: string | null;
}

/** Shape returned by GET /track/:token (marketOrder.service._publicTrack) */
export interface TrackedOrder {
  orderCode: string;
  status: string;
  paymentStatus: string;
  items: { name: string; qty: number }[];
  createdAt: string;
}

export interface CheckoutPayload {
  items: { productId: string; qty: number }[];
  shippingZoneId?: string;
  paymentMethodId?: string;
  couponCode?: string;
  customerInfo: { name: string; email: string; phone?: string };
  shippingAddress: string;
  idempotencyKey?: string;
}

export interface CheckoutResult {
  order: Order;
  idempotent: boolean;
}

export interface Customer {
  id?: string;
  email?: string;
  name?: string;
  phone?: string;
  addresses?: unknown[];
}

export interface AuthResult {
  customer: Customer;
  token: string;
}

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    sp.set(k, String(v));
  });
  const s = sp.toString();
  return s ? "?" + s : "";
}

/* ------------------------------ endpoints ------------------------------ */

async function getProductsPage(query: ProductQuery = {}): Promise<ProductsPage> {
  const raw = await request<{
    products: RawProduct[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }>("GET", "/products" + qs({ ...query, includeOutOfStock: query.includeOutOfStock ? "true" : undefined }));
  return {
    products: (raw.products || []).map(mapProduct),
    total: raw.total ?? (raw.products || []).length,
    page: raw.page ?? 1,
    limit: raw.limit ?? query.limit ?? 24,
    totalPages: raw.totalPages ?? 1,
  };
}

export const marketApi = {
  config: () => request<MarketConfig>("GET", "/config"),

  products: (query?: ProductQuery) => getProductsPage(query),

  /** Single product. Throws MarketApiError(404) when the id is unknown. */
  async product(id: string): Promise<Product> {
    const raw = await request<RawProduct>("GET", "/products/" + encodeURIComponent(id));
    return mapProduct(raw);
  },

  categories: async () => {
    const r = await request<{ categories: CategoryCount[] }>("GET", "/categories");
    return r.categories || [];
  },

  search: async (q: string) => {
    const raw = await request<{ products: RawProduct[]; total?: number }>("GET", "/search" + qs({ q }));
    const list = (raw.products || []).map(mapProduct);
    return { products: list, total: raw.total ?? list.length };
  },

  /** GET /availability?ids=a,b,c → { availability: [{id,stockQty,available}] } */
  availability: async (ids: string[]) => {
    if (!ids.length) return [] as AvailabilityRow[];
    const r = await request<{ availability: AvailabilityRow[] }>("GET", "/availability" + qs({ ids: ids.join(",") }));
    return r.availability || [];
  },

  checkout: (payload: CheckoutPayload) => request<CheckoutResult>("POST", "/checkout", payload),

  track: (tokenStr: string) => request<TrackedOrder>("GET", "/track/" + encodeURIComponent(tokenStr)),

  orders: async () => {
    const r = await request<{ orders: Order[] }>("GET", "/orders");
    return r.orders || [];
  },

  order: (id: string) => request<Order>("GET", "/orders/" + encodeURIComponent(id)),

  cancelOrder: (id: string, reason?: string) =>
    request<Order>("POST", "/orders/" + encodeURIComponent(id) + "/cancel", reason ? { reason } : {}),

  register: (p: { email: string; name?: string; phone?: string; password: string }) =>
    request<AuthResult>("POST", "/auth/register", p),

  login: (p: { email: string; password: string }) => request<AuthResult>("POST", "/auth/login", p),

  logout: () => request<null>("POST", "/auth/logout"),

  me: async () => {
    const r = await request<{ customer: Customer }>("GET", "/auth/me");
    return r.customer;
  },

  updateProfile: async (p: { name?: string; phone?: string }) => {
    const r = await request<{ customer: Customer }>("PUT", "/customers/me", p);
    return r.customer;
  },

  changePassword: (p: { currentPassword: string; newPassword: string }) =>
    request<AuthResult>("POST", "/customers/me/password", p),
};

/* ---------- convenience helpers used by pages (always API-backed) ---------- */

export async function fetchProducts(query?: ProductQuery): Promise<Product[]> {
  const page = await getProductsPage(query);
  return page.products;
}

export async function fetchProduct(id: string): Promise<Product | null> {
  try {
    return await marketApi.product(id);
  } catch (e) {
    if (e instanceof MarketApiError && e.status === 404) return null;
    throw e;
  }
}
