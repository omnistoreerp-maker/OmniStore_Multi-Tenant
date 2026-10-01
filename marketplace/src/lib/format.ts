// Arabic Egyptian pound formatting: "١٩٬٢٥٠٫٠٠ ج.م."
// Uses Intl with the ar-EG locale + EGP currency, then swaps the currency
// suffix to the local abbreviation "ج.م." for consistency with the catalog.

/** Current UI language from platform/omni-i18n.js ("ar" | "en", default "en"). */
export function uiLang(): string {
  try {
    const w = window as unknown as { OmniLang?: { get?: () => string } };
    const l = w.OmniLang?.get?.();
    if (l === "ar" || l === "en") return l;
  } catch {
    /* core not loaded */
  }
  return "en";
}

export function formatEGP(value: number): string {
  if (uiLang() === "en") {
    const nf = new Intl.NumberFormat("en-US", {
      style: "decimal",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      useGrouping: true,
    });
    return `${nf.format(value)} EGP`;
  }
  const nf = new Intl.NumberFormat("ar-EG", {
    style: "decimal",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  });
  return `${nf.format(value)} ج.م.`;
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat(uiLang() === "en" ? "en-US" : "ar-EG").format(n);
}

/**
 * Currency-aware price formatting. The currency ALWAYS comes from the API
 * (`product.currency` from GET /api/v1/market/products — never hardcoded):
 * EGP renders as the local catalog suffix "ج.م." (EN: "EGP"), any other ISO
 * code from the API is shown verbatim next to the amount.
 */
export function formatPrice(value: number, currency?: string): string {
  const cur = (currency || "EGP").toUpperCase();
  if (cur === "EGP") return formatEGP(value);
  const nf = new Intl.NumberFormat(uiLang() === "en" ? "en-US" : "ar-EG", {
    style: "decimal",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  });
  return `${nf.format(value)} ${cur}`;
}

/**
 * Labels for the REAL V1 order/payment states from
 * backend marketOrderStateMachine: order = received|cancelled,
 * payment = pending|cancelled. Unknown values pass through verbatim —
 * never invent a state.
 */
const ORDER_STATUS_AR: Record<string, string> = {
  received: "تم الاستلام",
  cancelled: "ملغي",
};

const ORDER_STATUS_EN: Record<string, string> = {
  received: "Order received",
  cancelled: "Cancelled",
};

const PAYMENT_STATUS_AR: Record<string, string> = {
  pending: "بانتظار الدفع",
  cancelled: "ملغي",
};

const PAYMENT_STATUS_EN: Record<string, string> = {
  pending: "Payment pending",
  cancelled: "Cancelled",
};

export function formatOrderStatus(status: string): string {
  return (uiLang() === "en" ? ORDER_STATUS_EN : ORDER_STATUS_AR)[status] ?? status;
}

export function formatPaymentStatus(paymentStatus: string): string {
  return (uiLang() === "en" ? PAYMENT_STATUS_EN : PAYMENT_STATUS_AR)[paymentStatus] ?? paymentStatus;
}
