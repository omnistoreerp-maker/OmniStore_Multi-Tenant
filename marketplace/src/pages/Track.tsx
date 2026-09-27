import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PackageSearch, Search } from "lucide-react";
import { marketApi, MarketApiError, type TrackedOrder } from "@/lib/api";

/**
 * Order tracking — port of market/js/app.js pageTrack against the real
 * GET /api/v1/market/track/:token (public, rate-limited endpoint).
 */

export default function Track() {
  const { token: routeToken } = useParams<{ token?: string }>();
  const [tokenInput, setTokenInput] = useState(routeToken || "");
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const lookup = async (t: string) => {
    const token = t.trim();
    if (!token) {
      setError("أدخل رمز التتبع");
      setOrder(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const o = await marketApi.track(token);
      setOrder(o);
    } catch (e) {
      setOrder(null);
      if (e instanceof MarketApiError && e.status === 404) setError("لم يتم العثور على طلب بهذا الرمز");
      else setError(e instanceof Error ? e.message : "تعذر البحث عن الطلب");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (routeToken) {
      setTokenInput(routeToken);
      void lookup(routeToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeToken]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="flex items-center gap-2 text-2xl font-extrabold text-foreground">
        <PackageSearch className="h-6 w-6 text-primary" aria-hidden />
        تتبع الطلب
      </h1>

      <form
        className="card-elevated mt-6 flex flex-col gap-3 p-5 sm:flex-row sm:items-end sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          void lookup(tokenInput);
        }}
      >
        <label className="block flex-1">
          <span className="mb-1.5 block text-sm font-medium text-foreground">رمز التتبع</span>
          <input
            name="track-token"
            id="track-token"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="أدخل رمز التتبع من تأكيد الطلب"
            className="btn-focus h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground shadow-sm transition-colors hover:border-primary/30 focus-visible:border-primary/50"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="btn-focus inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-70"
        >
          <Search className="h-4 w-4" aria-hidden />
          {loading ? "جارٍ البحث..." : "تتبع"}
        </button>
      </form>

      {error && (
        <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive" role="alert">
          {error}
        </div>
      )}

      {order && (
        <section className="card-elevated mt-6 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="tech text-lg font-extrabold text-foreground">{order.orderCode}</p>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-primary">{order.status}</span>
              <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-muted-foreground">{order.paymentStatus}</span>
            </div>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{new Date(order.createdAt).toLocaleString("ar-EG")}</p>
          <ul className="mt-4 divide-y divide-border">
            {order.items.map((i, idx) => (
              <li key={idx} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="tech min-w-0 truncate text-foreground">{i.name}</span>
                <span className="shrink-0 text-muted-foreground">× {i.qty}</span>
              </li>
            ))}
          </ul>
          <div className="mt-5">
            <Link to="/" className="btn-focus inline-flex rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-semibold text-foreground hover:border-primary/30">
              متابعة التسوق
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
