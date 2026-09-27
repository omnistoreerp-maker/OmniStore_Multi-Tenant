// Arabic Egyptian pound formatting: "١٩٬٢٥٠٫٠٠ ج.م."
// Uses Intl with the ar-EG locale + EGP currency, then swaps the currency
// suffix to the local abbreviation "ج.م." for consistency with the catalog.
export function formatEGP(value: number): string {
  const nf = new Intl.NumberFormat("ar-EG", {
    style: "decimal",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  });
  return `${nf.format(value)} ج.م.`;
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat("ar-EG").format(n);
}

/**
 * Currency-aware price formatting. The currency ALWAYS comes from the API
 * (`product.currency` from GET /api/v1/market/products — never hardcoded):
 * EGP renders as the local catalog suffix "ج.م.", any other ISO code from the
 * API is shown verbatim next to the amount.
 */
export function formatPrice(value: number, currency?: string): string {
  const cur = (currency || "EGP").toUpperCase();
  if (cur === "EGP") return formatEGP(value);
  const nf = new Intl.NumberFormat("ar-EG", {
    style: "decimal",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  });
  return `${nf.format(value)} ${cur}`;
}
