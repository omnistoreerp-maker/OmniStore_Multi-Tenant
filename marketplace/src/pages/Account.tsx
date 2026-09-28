import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LogOut, PackageSearch, UserRound } from "lucide-react";
import { toast } from "sonner";
import { MarketApiError, isAuthed, marketApi, setToken, type Customer, type Order } from "@/lib/api";
import { formatEGP } from "@/lib/format";

/**
 * Customer account — port of market/js/app.js pageAccount:
 * login / register / profile / change password / logout / orders.
 * Uses the real /auth endpoints (backend/routes/market.routes.js:60-65).
 */

type Errors = Record<string, string>;

export default function Account() {
  const location = useLocation();
  const navigate = useNavigate();
  const from = (location.state as { from?: string } | null)?.from || "";

  const [authed, setAuthed] = useState(isAuthed());
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  // login form
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginErrors, setLoginErrors] = useState<Errors>({});

  // register form
  const [rName, setRName] = useState("");
  const [rEmail, setREmail] = useState("");
  const [rPhone, setRPhone] = useState("");
  const [rPassword, setRPassword] = useState("");
  const [regErrors, setRegErrors] = useState<Errors>({});

  // account view
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [ordersErr, setOrdersErr] = useState<string | null>(null);
  const [pName, setPName] = useState("");
  const [pPhone, setPPhone] = useState("");
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwOpen, setPwOpen] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [profBusy, setProfBusy] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);

  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    (async () => {
      try {
        const me = await marketApi.me();
        if (cancelled) return;
        setCustomer(me);
        setPName(String(me.name || ""));
        setPPhone(String(me.phone || ""));
      } catch (e) {
        if (cancelled) return;
        if (e instanceof MarketApiError && e.status === 401) {
          setToken(null);
          setAuthed(false);
          return;
        }
      }
      try {
        const list = await marketApi.orders();
        if (!cancelled) setOrders(list);
      } catch (e) {
        if (cancelled) return;
        // A failed order list must not masquerade as "no orders".
        setOrders([]);
        setOrdersErr(e instanceof Error ? e.message : "تعذر تحميل الطلبات");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authed]);

  const finishAuth = (tokenStr: string) => {
    setToken(tokenStr);
    if (from) {
      navigate(from, { replace: true });
      return;
    }
    setAuthed(true);
  };

  const submitLogin = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBanner(null);
    const e: Errors = {};
    if (!email.trim()) e.email = "هذا الحقل مطلوب";
    if (!password) e.password = "هذا الحقل مطلوب";
    setLoginErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const r = await marketApi.login({ email: email.trim(), password });
      toast.success("تم تسجيل الدخول");
      finishAuth(r.token);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "تعذر تسجيل الدخول");
    } finally {
      setBusy(false);
    }
  };

  const submitRegister = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBanner(null);
    const e: Errors = {};
    if (!rName.trim()) e.rname = "هذا الحقل مطلوب";
    if (!rEmail.trim()) e.remail = "هذا الحقل مطلوب";
    if (!rPassword) e.rpass = "هذا الحقل مطلوب";
    setRegErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const r = await marketApi.register({
        email: rEmail.trim(),
        name: rName.trim(),
        phone: rPhone.trim() || undefined,
        password: rPassword,
      });
      toast.success("تم إنشاء الحساب");
      finishAuth(r.token);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "تعذر إنشاء الحساب");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await marketApi.logout().catch(() => undefined);
    setToken(null);
    setAuthed(false);
    setCustomer(null);
    setOrders(null);
    setOrdersErr(null);
    toast.success("تم تسجيل الخروج");
  };

  const saveProfile = async () => {
    setProfileMsg(null);
    setProfBusy(true);
    try {
      const c = await marketApi.updateProfile({ name: pName, phone: pPhone });
      setCustomer(c);
      setProfileMsg("تم الحفظ");
    } catch (err) {
      setProfileMsg(err instanceof Error ? err.message : "تعذر الحفظ");
    } finally {
      setProfBusy(false);
    }
  };

  const changePassword = async () => {
    setPwMsg(null);
    if (!pwCurrent || !pwNew) {
      setPwMsg("أدخل كلمة المرور الحالية والجديدة");
      return;
    }
    setPwBusy(true);
    try {
      const r = await marketApi.changePassword({ currentPassword: pwCurrent, newPassword: pwNew });
      setToken(r.token);
      setPwCurrent("");
      setPwNew("");
      setPwOpen(false);
      setPwMsg("تم تغيير كلمة المرور");
    } catch (err) {
      setPwMsg(err instanceof Error ? err.message : "تعذر تغيير كلمة المرور");
    } finally {
      setPwBusy(false);
    }
  };

  if (!authed) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-extrabold text-foreground sm:text-3xl">الحساب</h1>
        {banner && (
          <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive" role="alert">
            {banner}
          </div>
        )}
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <form onSubmit={submitLogin} noValidate className="card-elevated space-y-4 p-5 sm:p-6">
            <h2 className="text-lg font-bold text-foreground">تسجيل الدخول</h2>
            <Field label="البريد الإلكتروني" name="lg-email" type="email" autoComplete="email" required value={email} onChange={setEmail} error={loginErrors.email} />
            <Field label="كلمة المرور" name="lg-pass" type="password" autoComplete="current-password" required value={password} onChange={setPassword} error={loginErrors.password} />
            <button type="submit" disabled={busy} className="btn-focus inline-flex h-11 w-full items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-70">
              دخول
            </button>
          </form>

          <form onSubmit={submitRegister} noValidate className="card-elevated space-y-4 p-5 sm:p-6">
            <h2 className="text-lg font-bold text-foreground">إنشاء حساب</h2>
            <Field label="الاسم" name="rg-name" autoComplete="name" required value={rName} onChange={setRName} error={regErrors.rname} />
            <Field label="البريد الإلكتروني" name="rg-email" type="email" autoComplete="email" required value={rEmail} onChange={setREmail} error={regErrors.remail} />
            <Field label="رقم الهاتف" name="rg-phone" type="tel" autoComplete="tel" value={rPhone} onChange={setRPhone} />
            <Field label="كلمة المرور (8 أحرف على الأقل)" name="rg-pass" type="password" autoComplete="new-password" required value={rPassword} onChange={setRPassword} error={regErrors.rpass} />
            <button type="submit" disabled={busy} className="btn-focus inline-flex h-11 w-full items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-70">
              إنشاء الحساب
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold text-foreground">
          <UserRound className="h-6 w-6 text-primary" aria-hidden />
          حسابي
        </h1>
        <button
          type="button"
          onClick={logout}
          className="btn-focus inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-destructive hover:bg-destructive/10 min-h-[44px]"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          تسجيل الخروج
        </button>
      </div>

      {customer && (
        <section className="card-elevated mt-6 space-y-4 p-5 sm:p-6">
          <h2 className="text-base font-bold text-foreground">البيانات الشخصية</h2>
          <p className="text-sm text-muted-foreground">{customer.email}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="الاسم" name="pf-name" autoComplete="name" value={pName} onChange={setPName} />
            <Field label="رقم الهاتف" name="pf-phone" type="tel" autoComplete="tel" value={pPhone} onChange={setPPhone} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={saveProfile} disabled={profBusy} className="btn-focus inline-flex h-11 items-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-70">
              {profBusy ? "جارٍ الحفظ..." : "حفظ"}
            </button>
            <button type="button" onClick={() => setPwOpen((v) => !v)} className="btn-focus inline-flex h-11 items-center rounded-xl border border-border bg-card px-5 text-sm font-semibold text-foreground hover:border-primary/30">
              تغيير كلمة المرور
            </button>
          </div>
          {profileMsg && <p className="text-sm font-medium text-primary" role="status">{profileMsg}</p>}

          {pwOpen && (
            <div className="space-y-3 border-t border-border pt-4">
              <Field label="كلمة المرور الحالية" name="pf-cur" type="password" autoComplete="current-password" value={pwCurrent} onChange={setPwCurrent} />
              <Field label="كلمة المرور الجديدة" name="pf-new" type="password" autoComplete="new-password" value={pwNew} onChange={setPwNew} />
              <div className="flex gap-3">
                <button type="button" onClick={changePassword} disabled={pwBusy} className="btn-focus inline-flex h-11 items-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-70">
                  {pwBusy ? "جارٍ التغيير..." : "حفظ"}
                </button>
              </div>
              {pwMsg && <p className="text-sm font-medium text-primary" role="status">{pwMsg}</p>}
            </div>
          )}
        </section>
      )}

      <section className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
            <PackageSearch className="h-5 w-5 text-primary" aria-hidden />
            طلباتي
          </h2>
          <Link to="/orders" className="btn-focus text-sm font-semibold text-primary hover:underline">
            عرض الكل
          </Link>
        </div>
        {ordersErr && (
          <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive" role="alert">
            {ordersErr}
          </div>
        )}
        {orders === null && !ordersErr && (
          <div className="mt-3 space-y-3">
            <div className="card-elevated h-16 animate-pulse bg-secondary/60" />
            <div className="card-elevated h-16 animate-pulse bg-secondary/60" />
          </div>
        )}
        {orders && orders.length === 0 && !ordersErr && (
          <div className="card-elevated mt-3 p-8 text-center">
            <p className="font-semibold text-foreground">لا توجد طلبات بعد</p>
            <Link to="/" className="btn-focus mt-4 inline-flex rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
              تصفح المنتجات
            </Link>
          </div>
        )}
        {orders && orders.length > 0 && (
          <ul className="mt-3 space-y-3">
            {orders.slice(0, 5).map((o) => (
              <li key={o.id || o.orderCode} className="card-elevated flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="space-y-1">
                  <p className="tech text-sm font-bold text-foreground">{o.orderCode}</p>
                  <p className="text-xs text-muted-foreground">{new Date(o.createdAt).toLocaleString("ar-EG")}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-primary">{o.status}</span>
                  <span className="text-sm font-bold text-primary">{formatEGP(o.total ?? 0)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
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
        aria-describedby={error ? `${name}-error` : undefined}
        {...rest}
        className={`btn-focus h-11 w-full rounded-lg border bg-background px-3 text-sm text-foreground shadow-sm transition-colors hover:border-primary/30 focus-visible:border-primary/50 ${
          error ? "border-destructive" : "border-border"
        }`}
      />
      {error && (
        <span id={`${name}-error`} className="mt-1 block text-xs font-medium text-destructive">
          {error}
        </span>
      )}
    </label>
  );
}
