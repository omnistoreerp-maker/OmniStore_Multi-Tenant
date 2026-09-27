/**
 * Focused regression test: header category chip flow.
 *
 *   all (21) -> click "ألعاب" -> 3 products (categoryId=gaming sent)
 *            -> click "الكل"  -> 21 products restored, NO categoryId sent
 *
 * Also asserts: every rendered product id comes from the real API fixture
 * (no mock/static products) and that the app issues zero write requests.
 *
 * Run (repo root):
 *   $env:NODE_PATH = "<repo>\tests\e2e\node_modules"
 *   node marketplace/tests/category-reset.test.cjs
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const REPO = path.resolve(__dirname, "..", "..");
const PORT = 18971;
const BASE = `http://127.0.0.1:${PORT}/marketplace/dist/index.html`;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".txt": "text/plain",
  ".woff2": "font/woff2",
};

const CHIP_ALL = "\u0627\u0644\u0643\u0644"; // "الكل"
const CHIP_GAMES = "\u0623\u0644\u0639\u0627\u0628"; // "ألعاب"

const RAW = JSON.parse(fs.readFileSync(path.join(REPO, "backend/data/products.json"), "utf8"));
const LIST = (Array.isArray(RAW) ? RAW : RAW.products).map((p) => ({
  id: p.id,
  name: p.name,
  categoryId: p.categoryId ?? null,
  brandId: p.brandId ?? null,
  price: p.sellPrice,
  currency: p.currency || "EGP",
  stockQty: p.stockQty ?? 0,
  imageUrl: p.imageUrl ?? null,
  description: p.description ?? null,
}));
const ok = (d) => ({ success: true, message: "ok", data: d });

let failures = 0;
const check = (name, cond, extra = "") => {
  if (cond) console.log(`PASS  ${name}${extra ? "  (" + extra + ")" : ""}`);
  else {
    failures++;
    console.log(`FAIL  ${name}${extra ? "  (" + extra + ")" : ""}`);
  }
};

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.startsWith("/api/v1/market/")) {
    res.setHeader("Content-Type", "application/json");
    if (u.pathname.endsWith("/products")) {
      let items = LIST.slice();
      const s = (u.searchParams.get("search") || "").toLowerCase();
      if (s) items = items.filter((p) => (p.name + " " + (p.description || "")).toLowerCase().includes(s));
      const c = u.searchParams.get("categoryId");
      if (c) items = items.filter((p) => p.categoryId === c);
      const sb = u.searchParams.get("sortBy") || "name";
      const dir = (u.searchParams.get("sortOrder") || "asc") === "desc" ? -1 : 1;
      items.sort((a, b) => (sb === "price" ? a.price - b.price : String(a.name).localeCompare(String(b.name))) * dir);
      return res.end(JSON.stringify(ok({ products: items, total: items.length, page: 1, limit: 100, totalPages: 1 })));
    }
    if (u.pathname.endsWith("/categories")) {
      const counts = {};
      LIST.forEach((x) => (counts[x.categoryId] = (counts[x.categoryId] || 0) + 1));
      return res.end(JSON.stringify(ok({ categories: Object.entries(counts).map(([id, count]) => ({ id, count })) })));
    }
    if (u.pathname.endsWith("/config")) return res.end(JSON.stringify(ok({ storeName: "OmniStore", currency: "EGP", locale: "ar-EG", shippingZones: [], paymentMethods: [], enabled: true })));
    const m = u.pathname.match(/\/products\/([^/]+)$/);
    if (m) {
      const f = LIST.find((x) => x.id === decodeURIComponent(m[1]));
      if (!f) {
        res.statusCode = 404;
        return res.end(JSON.stringify({ success: false, message: "not found" }));
      }
      return res.end(JSON.stringify(ok(f)));
    }
    if (u.pathname.endsWith("/availability")) return res.end(JSON.stringify(ok({ availability: [] })));
    res.statusCode = 404;
    return res.end(JSON.stringify({ success: false, message: "nf" }));
  }
  let p = path.normalize(path.join(REPO, decodeURIComponent(u.pathname)));
  if (!p.startsWith(path.normalize(REPO))) {
    res.statusCode = 403;
    return res.end();
  }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
  if (!fs.existsSync(p)) {
    res.statusCode = 404;
    return res.end("nf");
  }
  res.setHeader("Content-Type", MIME[path.extname(p).toLowerCase()] || "application/octet-stream");
  res.end(fs.readFileSync(p));
});

server.listen(PORT, "127.0.0.1", async () => {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const apiCalls = [];
    const writes = [];
    page.on("request", (r) => {
      const u = r.url();
      if (!u.includes("/api/v1/market/")) return;
      const m = r.method();
      if (m !== "GET" && m !== "HEAD") writes.push(m + " " + u);
      const parsed = new URL(u);
      apiCalls.push({ marker: apiCalls.length, method: m, search: parsed.search });
    });

    const cardIds = () => page.$$eval("a[href^=\"#/product/\"]", (a) => a.map((x) => x.getAttribute("href").replace("#/product/", "")));
    const cardCount = () => page.$$eval("a[href^=\"#/product/\"]", (a) => a.length);
    const waitCards = async (n) => {
      await page.waitForFunction((expected) => document.querySelectorAll("a[href^=\"#/product/\"]").length === expected, n, { timeout: 15000 });
      await page.waitForTimeout(250);
    };

    await page.goto(BASE + "#/", { waitUntil: "load", timeout: 60000 });
    await waitCards(21);

    // 1. baseline: full catalog
    const initial = await cardIds();
    check("T1 initial full product list", initial.length === 21, "count=" + initial.length);
    const fixtureIds = new Set(LIST.map((x) => x.id));
    check("T2 no mock products (ids come from real API data)", initial.every((id) => fixtureIds.has(id)));

    // 2. select category "ألعاب" via header chip
    const markSelect = apiCalls.length;
    await page.click(`button:has-text('${CHIP_GAMES}')`);
    await waitCards(3);
    const gamingIds = await cardIds();
    check("T3 category select -> 3 products", gamingIds.length === 3, "count=" + gamingIds.length);
    const selectCalls = apiCalls.slice(markSelect);
    check("T4 categoryId=gaming sent on select", selectCalls.some((c) => c.search.includes("categoryId=gaming")), JSON.stringify(selectCalls.map((c) => c.search)));

    // 3. clear via header chip "الكل"
    const markClear = apiCalls.length;
    await page.click(`button:has-text('${CHIP_ALL}')`);
    await waitCards(21);
    const restored = await cardIds();
    check("T5 ALL_RESET chip restores full list", restored.length === 21, "count=" + restored.length);
    check("T6 full product set restored", [...fixtureIds].every((id) => restored.includes(id)) && restored.length === fixtureIds.size);
    const clearCalls = apiCalls.slice(markClear);
    const badClear = clearCalls.filter((c) => c.search.includes("categoryId"));
    check("T7 no categoryId sent after selecting ALL", badClear.length === 0, "calls=" + JSON.stringify(clearCalls.map((c) => c.search)));

    // 4. safety nets
    check("T8 no write requests (GET-only marketplace API)", writes.length === 0, JSON.stringify(writes));

    await ctx.close();
  } catch (e) {
    failures++;
    console.log("FAIL  exception: " + String(e).slice(0, 300));
  } finally {
    await browser.close();
    server.close();
  }
  console.log("--------------------------------");
  console.log(failures === 0 ? "CATEGORY_RESET_TEST=PASS" : `CATEGORY_RESET_TEST=FAIL failures=${failures}`);
  process.exit(failures === 0 ? 0 : 1);
});
