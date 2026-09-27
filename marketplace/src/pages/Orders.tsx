import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { PackageSearch } from "lucide-react";
import { isAuthed, marketApi, MarketApiError, setToken, type Order } from "@/lib/api";
import { formatEGP } from "@/lib/format";

/**
 * Customer orders — GET /api/v1/market/orders (requireCustomer).
 * Mirrors the order list block of market/js/app.js pageAccount.
 */
export default function Orders() {
  const authed = isAuthed();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    marketApi
      .orders()
      .then((list) => {
        if (!cancelled) setOrders(list);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof MarketApiError && e.status === 401) {
          setToken(null);
          return;
        }
        setError(e instanceof Error ? e.message : "تعذر تحميل الطلبات");
      });
    return () => {
      cancelled = true;
    };
  }, [authed]);

  if (!authed) {
    return <Navigate to="/account" replace state={{ from: "/orders" }} />;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="flex items-center gap-2 text-2xl font-extrabold text-foreground">
        <PackageSearch className="h-6 w-6 text-primary" aria-hidden />
        طلباتي
      </h1>

      {error && (
        <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive" role="alert">
          {error}
        </div>
      )}

      {orders === null && !error && (
        <div className="mt-6 space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="card-elevated h-20 animate-pulse bg-secondary/60" />
          ))}
        </div>
      )}

      {orders && orders.length === 0 && (
        <div className="card-elevated mt-6 p-10 text-center">
          <p className="font-semibold text-foreground">لا توجد طلبات بعد</p>
          <Link to="/" className="btn-focus mt-4 inline-flex rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            تصفح المنتجات
          </Link>
        </div>
      )}

      {orders && orders.length > 0 && (
        <ul className="mt-6 space-y-4">
          {orders.map((o) => (
            <li key={o.id || o.orderCode} className="card-elevated p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="tech text-base font-extrabold text-foreground">{o.orderCode}</p>
                  <p className="text-xs text-muted-foreground">{new Date(o.createdAt).toLocaleString("ar-EG")}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-primary">{o.status}</span>
                  <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-muted-foreground">{o.paymentStatus}</span>
                </div>
              </div>

              <ul className="mt-3 divide-y divide-border border-t border-border">
                {o.items.map((it, idx) => (
                  <li key={idx} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="tech min-w-0 truncate text-foreground">{it.name}</span>
                    <span className="shrink-0 text-muted-foreground">
                      × {it.qty}
                      {it.lineTotal != null ? ` — ${formatEGP(it.lineTotal)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">
                  الإجمالي: <span className="text-base font-extrabold text-primary">{formatEGP(o.total ?? 0)}</span>
                  {o.shippingAddress ? <span className="mr-3">— {o.shippingAddress}</span> : null}
                </div>
                {o.trackingToken && (
                  <Link
                    to={`/track/${o.trackingToken}`}
                    className="btn-focus inline-flex rounded-xl border border-border bg-card px-4 py-2 text-xs font-semibold text-foreground hover:border-primary/30"
                  >
                    تتبع الطلب
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
