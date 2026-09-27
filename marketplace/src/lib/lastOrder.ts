import type { Order } from "./api";

/**
 * Hand-off of the freshly placed order to the confirmation screen
 * (same pattern as market/js/app.js `lastOrder`). Kept in memory with a
 * sessionStorage mirror so a refresh on #/confirmation still works; never
 * used as a source of truth for prices or status.
 */
const KEY = "mk_last_order";

let last: Order | null = null;

export function setLastOrder(order: Order): void {
  last = order;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(order));
  } catch (_) {
    /* ignore */
  }
}

export function getLastOrder(): Order | null {
  if (last) return last;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) last = JSON.parse(raw) as Order;
  } catch (_) {
    last = null;
  }
  return last;
}

export function clearLastOrder(): void {
  last = null;
  try {
    sessionStorage.removeItem(KEY);
  } catch (_) {
    /* ignore */
  }
}
