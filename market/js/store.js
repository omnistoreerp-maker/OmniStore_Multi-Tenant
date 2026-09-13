// Cart store. The cart lives in localStorage (guest-friendly). It is the
// client's INTENT only — prices, stock, discounts and totals are always
// revalidated server-side at checkout. Stale products are cleaned against the
// live catalog before checkout.
window.MK_CART = (function () {
  const KEY = 'mk_cart_' + window.MK_TENANT;

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      const cart = raw ? JSON.parse(raw) : { tenantId: window.MK_TENANT, items: [] };
      if (!cart.items) cart.items = [];
      return cart;
    } catch (_) {
      return { tenantId: window.MK_TENANT, items: [] };
    }
  }

  function write(cart) {
    try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch (_) {}
    emit();
  }

  function emit() {
    try { window.dispatchEvent(new Event('mk-cart-changed')); } catch (_) {}
  }

  function add(productId, qty) {
    const cart = read();
    const existing = cart.items.find((i) => i.productId === productId);
    if (existing) existing.qty = Math.max(1, (existing.qty || 0) + (qty || 1));
    else cart.items.push({ productId, qty: qty || 1 });
    write(cart);
  }

  function setQty(productId, qty) {
    const cart = read();
    const item = cart.items.find((i) => i.productId === productId);
    if (!item) return;
    item.qty = Math.max(1, qty || 1);
    write(cart);
  }

  function remove(productId) {
    const cart = read();
    cart.items = cart.items.filter((i) => i.productId !== productId);
    write(cart);
  }

  function clear() {
    write({ tenantId: window.MK_TENANT, items: [] });
  }

  function count() {
    return read().items.reduce((n, i) => n + (i.qty || 0), 0);
  }

  function items() {
    return read().items;
  }

  // Drop products that no longer exist in the live catalog or are out of stock.
  async function reconcile() {
    const cart = read();
    if (cart.items.length === 0) return cart;
    const ids = cart.items.map((i) => i.productId);
    let avail = [];
    try { avail = await window.MK_API.availability(ids); } catch (_) { return cart; }
    const byId = {};
    avail.forEach((a) => { byId[a.id] = a; });
    cart.items = cart.items.filter((i) => {
      const a = byId[i.productId];
      return a && a.available && a.stockQty >= i.qty;
    });
    write(cart);
    return cart;
  }

  return { add, setQty, remove, clear, count, items, reconcile };
})();
