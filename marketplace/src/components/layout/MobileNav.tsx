import { useRef } from "react";
import { Link } from "react-router-dom";
import { Store, PackageSearch, UserRound, X, Building2 } from "lucide-react";
import { useDrawerA11y } from "@/lib/useDrawerA11y";

interface Props {
  open: boolean;
  onClose: () => void;
}

const LINKS: { to: string; label: string; icon: typeof Store }[] = [
  { to: "/", label: "المتجر", icon: Store },
  { to: "/orders", label: "طلباتي", icon: PackageSearch },
  { to: "/account", label: "حسابي", icon: UserRound },
];

/**
 * Mobile navigation drawer (md:hidden) — the desktop nav collapses below md,
 * so this is the single menu that keeps every destination reachable:
 * shop, orders, account and the platform hub link (same-origin "/").
 */
export function MobileNav({ open, onClose }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  useDrawerA11y(open, onClose, rootRef, asideRef);

  return (
    <div ref={rootRef} className={`fixed inset-0 z-50 md:hidden ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-primary/40 transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0"}`}
      />
      <aside
        ref={asideRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="القائمة"
        className={`absolute inset-y-0 end-0 flex w-[82vw] max-w-xs flex-col bg-background shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full rtl:-translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-4">
          <h2 className="text-base font-bold text-foreground">القائمة</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق القائمة"
            className="btn-focus rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        <nav className="flex-1 overflow-y-auto p-3" aria-label="التنقل على الجوال">
          <ul className="space-y-1">
            {LINKS.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <Link
                  to={to}
                  onClick={onClose}
                  className="btn-focus flex min-h-[48px] items-center gap-3 rounded-xl px-3 text-sm font-semibold text-foreground hover:bg-secondary"
                >
                  <Icon className="h-5 w-5 text-primary" aria-hidden />
                  {label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="mt-3 border-t border-border pt-3">
            <a
              href="/"
              className="btn-focus flex min-h-[48px] items-center gap-3 rounded-xl px-3 text-sm font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <Building2 className="h-5 w-5 text-primary" aria-hidden />
              العودة إلى OmniStore ERP
            </a>
          </div>
        </nav>
      </aside>
    </div>
  );
}
