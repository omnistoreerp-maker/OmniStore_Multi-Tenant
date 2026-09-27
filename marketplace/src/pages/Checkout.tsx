import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Loader2, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { cartStore, useCart, useCartRefs, useCartTotal } from "@/stores/cart";
import { isAuthed, marketApi, MarketApiError, type MarketConfig } from "@/lib/api";
import { formatEGP } from "@/lib/format";
import { setLastOrder } from "@/lib/lastOrder";

/**
 * Real checkout — POST /api/v1/market/checkout (market.routes.js:67).
 * Auth gate mirrors market/js/app.js pageCheckout (login required first).
 * Prices/totals shown here are indicative; the backend revalidates prices,
 * stock, coupon, zone and payment method server-side and is the source of truth.
 */

type Errors = Record<string, string>;

export default function Checkout() {
  const navigate = useNavigate();
  const authed = isAuthed();
  const items = useCart();
  const cartRefs = useCartRefs();
  const subtotal = useCartTotal();

  const [cfg, setCfg] = useState<MarketConfig | null>(null);
  const [cfgError, setCfgError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [payId, setPayId] = useState("");
  const [coupon, setCoupon] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    marketApi
      .config()
      .then((c) => {
        if (!cancelled) {
          setCfg(c);
          if (c.shippingZones.length) setZoneId(c.shippingZones[0].id);
          if (c.paymentMethods.length) setPayId(c.paymentMethods[0].id);
        }
      })
      .catch((e) => {
        if (!cancelled) setCfgError(e instanceof Error ? e.message : "تعذر تحميل إعدادات المتجر");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const zone = cfg?.shippingZones.find((z) => z.id === zoneId) || null;
  const zoneFee = zone ? (zone.freeAbove && subtotal >= zone.freeAbove ? 0 : zone.fee) : 0;
  const total = subtotal + zoneFee;

  const summaryRows = useMemo(
    () =>
      items.map((item) => (
        <li key={item.product.id} className="flex justify-between gap-3 py-3">
          <div className="min-w-0">
            <p className="tech truncate text-sm font-semibold text-foreground">{item.product.name}</p>
            <p className="text-xs text-muted-foreground">الكمية: {item.quantity}</p>
          </div>
          <p className="shrink-0 text-sm font-bold text-primary">
            {formatEGP(item.product.price * item.quantity)}
          </p>
        </li>
      )),
    [items]
  );

  // Auth gate: same behavior as market.html (redirects to #/account).
  if (!authed) {
    return <Navigate to="/account" replace state={{ from: "/checkout" }} />;
  }

  const validate = (): boolean => {
    const e: Errors = {};
    if (!name.trim()) e.name = "هذا الحقل مطلوب";
    if (!email.trim()) e.email = "هذا الحقل مطلوب";
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) e.email = "بريد إلكتروني غير صالح";
    if (phone.trim() && !/^[0-9\s\-+()]{7,20}$/.test(phone.trim())) e.phone = "رقم هاتف غير صالح";
    if (!address.trim()) e.address = "هذا الحقل مطلوب";
    if (cfg && cfg.shippingZones.length && !zoneId) e.zone = "اختر منطقة الشحن";
    if (cfg && cfg.paymentMethods.length && !payId) e.pay = "اختر طريقة الدفع";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBanner(null);
    if (!cartRefs.length) {
      setMissing(true);
      return;
    }
    if (!validate()) return;
    setSubmitting(true);
    try {
      // Server-validated stock before creating the order.
      const changed = await cartStore.reconcile();
      if (changed && cartStore.refs().length === 0) {
        setSubmitting(false);
        setMissing(true);
        return;
      }
      const res = await marketApi.checkout({
        items: cartStore.refs().map((r) => ({ productId: r.productId, qty: r.qty })),
        shippingZoneId: zoneId || undefined,
        paymentMethodId: payId || undefined,
        couponCode: coupon.trim() || undefined,
        customerInfo: { name: name.trim(), email: email.trim(), phone: phone.trim() || undefined },
        shippingAddress: address.trim(),
        idempotencyKey: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : undefined,
      });
      cartStore.clear();
      setLastOrder(res.order);
      toast.success("تم استلام طلبك");
      navigate("/confirmation", { replace: true });
    } catch (err) {
      const msg =
        err instanceof MarketApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "تعذر إتمام الطلب";
      setBanner(msg);
      setSubmitting(false);
    }
  };

  if (missing || cartRefs.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-secondary text-primary">
          <ShoppingBag className="h-7 w-7" aria-hidden />
        </div>
        <h1 className="mt-4 text-2xl font-bold">السلة فارغة</h1>
        <p className="mt-1 text-muted-foreground">أضف بعض المنتجات قبل إتمام الشراء.</p>
        <Link
          to="/"
          className="btn-focus mt-6 inline-flex rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          تصفح المنتجات
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-extrabold text-foreground sm:text-3xl">إتمام الشراء</h1>

      {cfgError && (
        <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive" role="alert">
          {cfgError}
        </div>
      )}
      {banner && (
        <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive" role="alert">
          {banner}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.3fr_1fr] lg:gap-8">
        <form onSubmit={handleSubmit} noValidate className="card-elevated space-y-6 p-5 sm:p-6">
          <fieldset className="space-y-4">
            <legend className="text-base font-bold text-foreground">بيانات العميل</legend>
            <Field label="الاسم الكامل" name="name" autoComplete="name" required value={name} onChange={setName} error={errors.name} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="رقم الهاتف" name="phone" type="tel" autoComplete="tel" value={phone} onChange={setPhone} error={errors.phone} />
              <Field label="البريد الإلكتروني" name="email" type="email" autoComplete="email" required value={email} onChange={setEmail} error={errors.email} />
            </div>
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="text-base font-bold text-foreground">عنوان الشحن</legend>
            <Field label="العنوان" name="address" autoComplete="street-address" required value={address} onChange={setAddress} error={errors.address} />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="منطقة الشحن"
                name="zone"
                value={zoneId}
                onChange={setZoneId}
                error={errors.zone}
                disabled={!cfg}
                options={(cfg?.shippingZones || []).map((z) => ({
                  value: z.id,
                  label: `${z.name} — ${formatEGP(z.fee)}`,
                }))}
                required={(cfg?.shippingZones.length ?? 0) > 0}
              />
              <SelectField
                label="طريقة الدفع"
                name="pay"
                value={payId}
                onChange={setPayId}
                error={errors.pay}
                disabled={!cfg}
                options={(cfg?.paymentMethods || []).map((m) => ({ value: m.id, label: m.name }))}
                required={(cfg?.paymentMethods.length ?? 0) > 0}
              />
            </div>
            <Field label="كود الخصم (اختياري)" name="coupon" value={coupon} onChange={setCoupon} />
          </fieldset>

          <button
            type="submit"
            disabled={submitting}
            className="btn-focus inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-70"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {submitting ? "جارٍ تأكيد الطلب..." : `تأكيد الطلب — ${formatEGP(total)}`}
          </button>
        </form>

        <aside className="card-elevated h-fit p-5 sm:p-6">
          <h2 className="text-base font-bold text-foreground">ملخص الطلب</h2>
          <ul className="mt-4 divide-y divide-border">{summaryRows}</ul>
          <div className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
            <div className="flex items-center justify-between text-muted-foreground">
              <span>المجموع الفرعي</span>
              <span className="font-semibold text-foreground">{formatEGP(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between text-muted-foreground">
              <span>مصاريف الشحن</span>
              <span className="font-semibold text-foreground">{formatEGP(zoneFee)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-3">
              <span className="text-sm text-muted-foreground">الإجمالي</span>
              <span className="text-xl font-extrabold text-foreground">{formatEGP(total)}</span>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            تُعاد مراجعة الأسعار والمخزون على الخادم عند تأكيد الطلب.
          </p>
        </aside>
      </div>
    </div>
  );
}

function Field(props: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  const { label, name, error, onChange, ...rest } = props;
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
        {rest.required ? <span className="text-destructive"> *</span> : null}
      </span>
      <input
        name={name}
        id={name}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        {...rest}
        className={`btn-focus h-11 w-full rounded-lg border bg-background px-3 text-sm text-foreground shadow-sm transition-colors hover:border-primary/30 focus-visible:border-primary/50 ${
          error ? "border-destructive" : "border-border"
        }`}
      />
      {error && <span className="mt-1 block text-xs font-medium text-destructive">{error}</span>}
    </label>
  );
}

function SelectField(props: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  error?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const { label, name, error, options, ...rest } = props;
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
        {rest.required ? <span className="text-destructive"> *</span> : null}
      </span>
      <select
        name={name}
        id={name}
        onChange={(e) => props.onChange(e.target.value)}
        value={props.value}
        disabled={props.disabled}
        aria-invalid={!!error}
        className={`btn-focus h-11 w-full rounded-lg border bg-background px-3 text-sm text-foreground shadow-sm transition-colors hover:border-primary/30 focus-visible:border-primary/50 ${
          error ? "border-destructive" : "border-border"
        }`}
      >
        {options.length === 0 && <option value="">{props.disabled ? "جارٍ التحميل..." : "—"}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <span className="mt-1 block text-xs font-medium text-destructive">{error}</span>}
    </label>
  );
}
