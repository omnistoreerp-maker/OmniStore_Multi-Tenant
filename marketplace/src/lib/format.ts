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
