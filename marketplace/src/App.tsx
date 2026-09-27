import { useState } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
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
export default function App() {
  const [cartOpen, setCartOpen] = useState(false);

  return (
    <HashRouter>
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
        <Toaster
          position="top-center"
          dir="rtl"
          toastOptions={{
            style: {
              fontFamily: "Cairo, Inter, system-ui, sans-serif",
              borderRadius: "0.85rem",
            },
          }}
        />
      </div>
    </HashRouter>
  );
}
