import { useEffect } from "react";
import { X, Minus, Plus, Trash2, ShoppingBag } from "lucide-react";
import { Link } from "react-router-dom";
import { cartStore, useCart, useCartTotal } from "@/stores/cart";
import { formatEGP } from "@/lib/format";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CartDrawer({ open, onClose }: Props) {
  const items = useCart();
  const total = useCartTotal();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  return (
    <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-primary/40 transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="سلة المشتريات"
        className={`absolute inset-y-0 start-0 flex w-[92vw] max-w-md flex-col bg-background shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "-translate-x-full rtl:translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
            <ShoppingBag className="h-5 w-5 text-primary" aria-hidden />
            سلة المشتريات
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق السلة"
            className="btn-focus rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-full bg-secondary text-primary">
              <ShoppingBag className="h-7 w-7" aria-hidden />
            </div>
            <p className="text-base font-semibold text-foreground">السلة فارغة</p>
            <p className="text-sm text-muted-foreground">
              أضف منتجات من المتجر لتبدأ عملية الشراء.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="btn-focus mt-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              متابعة التسوق
            </button>
          </div>
        ) : (
          <>
            <ul className="flex-1 divide-y divide-border overflow-y-auto">
              {items.map((item) => (
                <li key={item.product.id} className="flex gap-3 p-4">
                  <div className="grid h-20 w-20 shrink-0 place-items-center rounded-lg bg-secondary text-primary/50">
                    <span className="tech text-[10px] font-bold uppercase">{item.product.brand}</span>
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    <p className="tech text-sm font-semibold text-foreground line-clamp-2">
                      {item.product.name}
                    </p>
                    <p className="tech text-xs text-muted-foreground">
                      {item.product.specs.cpu ?? ""}
                      {item.product.specs.ram ? ` · ${item.product.specs.ram}/${item.product.specs.storage ?? ""}` : ""}
                    </p>
                    <div className="mt-auto flex items-center justify-between">
                      <div className="inline-flex items-center rounded-lg border border-border">
                        <button
                          type="button"
                          aria-label="تقليل الكمية"
                          onClick={() => cartStore.setQuantity(item.product.id, item.quantity - 1)}
                          className="btn-focus grid h-9 w-9 place-items-center text-foreground hover:bg-secondary"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="min-w-[2rem] text-center text-sm font-semibold">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          aria-label="زيادة الكمية"
                          onClick={() => cartStore.setQuantity(item.product.id, item.quantity + 1)}
                          className="btn-focus grid h-9 w-9 place-items-center text-foreground hover:bg-secondary"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                      <p className="text-sm font-bold text-primary">
                        {formatEGP(item.product.price * item.quantity)}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => cartStore.remove(item.product.id)}
                    aria-label={`إزالة ${item.product.name}`}
                    className="btn-focus h-9 w-9 shrink-0 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="mx-auto h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>

            <footer className="space-y-4 border-t border-border bg-card p-5">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>الإجمالي</span>
                <span className="text-lg font-bold text-foreground">{formatEGP(total)}</span>
              </div>
              <Link
                to="/checkout"
                onClick={onClose}
                className="btn-focus flex h-12 w-full items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              >
                إتمام الشراء
              </Link>
              <button
                type="button"
                onClick={onClose}
                className="btn-focus block w-full rounded-lg py-2 text-center text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                متابعة التسوق
              </button>
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}
