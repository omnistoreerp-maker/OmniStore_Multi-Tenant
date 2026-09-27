import { Navigate, Link } from "react-router-dom";
import { CheckCircle2, Truck } from "lucide-react";
import { formatEGP } from "@/lib/format";
import { getLastOrder } from "@/lib/lastOrder";

/**
 * Order confirmation — port of market/js/app.js pageConfirmation.
 * Shows the server-confirmed order (orderCode, trackingToken, total, status)
 * handed over from the real checkout response. Redirects home when empty.
 */
export default function Confirmation() {
  const order = getLastOrder();

  if (!order) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-primary/10 text-primary">
        <CheckCircle2 className="h-9 w-9" aria-hidden />
      </div>
      <h1 className="mt-4 text-2xl font-extrabold text-foreground">تم استلام طلبك</h1>
      <p className="mt-1 text-sm text-muted-foreground">احتفظ برمز التتبع لمتابعة حالة الطلب.</p>

      <div className="card-elevated mt-6 space-y-3 p-5 text-right sm:p-6">
        <Row label="رقم الطلب" value={order.orderCode} mono />
        {order.trackingToken && <Row label="رمز التتبع" value={order.trackingToken} mono />}
        <Row label="الإجمالي" value={formatEGP(order.total ?? 0)} />
        <Row label="الحالة" value={order.status} />
        <Row label="حالة الدفع" value={order.paymentStatus} />
        {order.shippingAddress && <Row label="عنوان الشحن" value={order.shippingAddress} />}
      </div>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {order.trackingToken && (
          <Link
            to={`/track/${order.trackingToken}`}
            className="btn-focus inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            <Truck className="h-4 w-4" aria-hidden />
            تتبع الطلب
          </Link>
        )}
        <Link
          to="/orders"
          className="btn-focus inline-flex h-12 items-center rounded-xl border border-border bg-card px-6 text-sm font-semibold text-foreground hover:border-primary/30"
        >
          طلباتي
        </Link>
        <Link
          to="/"
          className="btn-focus inline-flex h-12 items-center rounded-xl border border-border bg-card px-6 text-sm font-semibold text-foreground hover:border-primary/30"
        >
          متابعة التسوق
        </Link>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-bold text-foreground ${mono ? "tech" : ""}`}>{value}</span>
    </div>
  );
}
