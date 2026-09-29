import { Shield, Truck, Headphones, CreditCard } from "lucide-react";
import { AdSlot } from "@/components/marketplace/AdSlot";
import { OmniAdSlot } from "@/components/marketplace/OmniAdSlot";

const TRUST = [
  { icon: Truck, title: "توصيل سريع", desc: "شحن لجميع المحافظات" },
  { icon: Shield, title: "أجهزة أصلية", desc: "من مصادر موثوقة" },
  { icon: CreditCard, title: "دفع آمن", desc: "طرق دفع متعددة" },
  { icon: Headphones, title: "دعم فني", desc: "على مدار الأسبوع" },
];

export function Footer() {
  return (
    <footer className="mt-16 border-t border-border bg-card/60">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        {/* Inline ad slots — our outer containers only; see contracts.
            OmniAdSlot is the platform-wide slot; AdSlot is marketplace-only.
            Both gated OFF: zero ad requests until the owner supplies a safe
            zone + flips the gate. They sit AFTER all product content and
            BEFORE the trust grid, inside the max-width container. */}
        <OmniAdSlot />
        <AdSlot />

        <ul className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          {TRUST.map(({ icon: Icon, title, desc }) => (
            <li
              key={title}
              className="flex items-start gap-3 rounded-xl border border-border bg-background p-4"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">{title}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex flex-col items-center justify-between gap-3 border-t border-border pt-6 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} OmniStore Marketplace. جميع الحقوق محفوظة.
          </p>
          <div className="flex items-center gap-4">
            <a
              href="/"
              className="btn-focus rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              العودة إلى OmniStore ERP
            </a>
            <p className="tech text-[11px] text-muted-foreground">v1.0 · Premium UI</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
