import { useEffect, useState } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { MarketUIProvider } from "@/stores/marketUI";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { CartDrawer } from "@/components/cart/CartDrawer";
import Marketplace from "@/pages/Marketplace";
import ProductDetails from "@/pages/ProductDetails";
import Checkout from "@/pages/Checkout";
import Account from "@/pages/Account";
import Track from "@/pages/Track";
import Orders from "@/pages/Orders";
import Confirmation from "@/pages/Confirmation";
import NotFound from "@/pages/NotFound";

/**
 * HashRouter so deep links (#/product/:id, #/checkout, #/track/:token…)
 * work from plain static hosting with zero server rewrite rules.
 */

/** Toaster direction follows the global language (platform/omni-i18n.js). */
function DynamicToaster() {
  const readDir = () => (document.documentElement.getAttribute("dir") === "ltr" ? "ltr" : "rtl");
  const [dir, setDir] = useState<"rtl" | "ltr">(readDir);
  useEffect(() => {
    const onLang = () => setDir(readDir());
    document.addEventListener("omnilangchange", onLang);
    return () => document.removeEventListener("omnilangchange", onLang);
  }, []);
  return (
    <Toaster
      position="top-center"
      dir={dir}
      toastOptions={{
        style: {
          fontFamily: "Cairo, Inter, system-ui, sans-serif",
          borderRadius: "0.85rem",
        },
      }}
    />
  );
}

export default function App() {
  const [cartOpen, setCartOpen] = useState(false);
  // Re-render the whole tree when the global language switches so lang-aware
  // formatters (lib/format.ts) and aria ternaries re-evaluate. State/scroll
  // are preserved — this is a plain setState, not a key remount.
  const [, setLangTick] = useState(0);
  useEffect(() => {
    const onLang = () => setLangTick((t) => t + 1);
    document.addEventListener("omnilangchange", onLang);
    return () => document.removeEventListener("omnilangchange", onLang);
  }, []);

  return (
    <HashRouter>
      <MarketUIProvider>
        <div className="flex min-h-screen flex-col bg-background">
          <Header onOpenCart={() => setCartOpen(true)} />
          <main className="flex-1">
            <Routes>
              <Route path="/" element={<Marketplace />} />
              <Route path="/product/:id" element={<ProductDetails />} />
              <Route path="/checkout" element={<Checkout />} />
              <Route path="/account" element={<Account />} />
              <Route path="/track" element={<Track />} />
              <Route path="/track/:token" element={<Track />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/confirmation" element={<Confirmation />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </main>
          <Footer />
          <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
          <DynamicToaster />
        </div>
      </MarketUIProvider>
    </HashRouter>
  );
}
