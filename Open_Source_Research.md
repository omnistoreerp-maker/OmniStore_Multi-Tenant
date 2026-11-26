# مقارنة قوالب Open Source — OmniStore Portals

المصدر: بحث ويب فعلي (github.com) — نوفمبر 2026. قراءة فقط، لا دمج أي قالب قبل مراجعة التوافق مع البنية الحالية.

---

## أ. قوالب Marketplace

| # | المشروع | GitHub URL | الترخيص | النشاط | التقنية | RTL | Responsive | جودة التصميم | سهولة الدمج | الاعتماديات | الوقت المتوقع |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | ShopSage (الجزائر) | https://github.com/Yacineooak/ShopSage-AI-Powered-E-commerce-Platform-for-Algeria | MIT | نشط (2025-2026) | React 18 + TS + Tailwind + Vite + Zustand | ✅ عربي كامل (RTL) | ✅ نعم | جيد (AI recommendations، wilayas) | متوسط (يحتاج API خاص بالجزائر) | React, Tailwind, Vite, Zustand, i18next | متوسط |
| 2 | Baxela | https://github.com/baxela-hq/baxela | Apache 2.0 | نشط (2026-08) | Laravel 13 + Next.js 16 + React 19 + TS + Tailwind v4 | ✅ عربي+فارسي (RTL) | ✅ نعم | ممتاز (headless commerce completo) | عالي (Monorepo، Backend+Admin+Storefront) | PHP, Laravel, Node, Next, Tailwind, MySQL, Redis | طويل (نظام كامل) |
| 3 | Multi-Vendor E-Commerce | https://github.com/alijamshidy/multi-vendor-ecommerce | Private (ليس OSS) | نشط (2025-12) | Next.js 16 + React + TS + Tailwind + Radix + shadcn | ✅ en/fa (RTL) | ✅ نعم | جيد | منخفض (Frontend-only، يحتاج Django API) | Next.js, Tailwind, Radix, shadcn, next-intl, Socket.IO | قصير (واجهة فقط) |
| 4 | CargoPlus (فارسى) | https://github.com/ar-saeedi/cargoplus | Proprietary (ليس OSS) | نشط (2025-11) | React 18 + Tailwind + Supabase + MedusaJS v2 | ✅ فارسي (RTL) | ✅ نعم | جيد | منخفض (نظام Proprietary) | React, Tailwind, Supabase, MedusaJS | متوسط |
| 5 | SoukHub | https://github.com/alinaqi/soukhub | MIT | نشط (2025-12) | Next.js 16 + TS + Supabase + Drizzle | ✅ إنجليزي+عربي (RTL) | ✅ כן | جيد (AI-first) | متوسط (Supabase multi-tenant) | Next.js, Supabase, Drizzle, next-intl, Tailwind v4 | متوسط |
| 6 | marketplace-web | https://github.com/bookquotesgirl/marketplace-web | غير محدد | نشط (2026-08) | React + Vite + JS | ✅ EN/am/ar (RTL) | ✅ نعم | متوسط (static design reference) | متوسط (i18next + Zustand) | React, Vite, i18next, Zustand, axios | قصير |
| 7 | Engezna (مصر) | https://github.com/Mosabragab/Engezna | Proprietary (ليس OSS) | نشط (2025-11) | Next.js 16 + React 19 + TS + Tailwind + Supabase | ✅ عربي (RTL) | ✅ نعم | جيد | منخفض (نظام Proprietary) | Next.js, Supabase, Tailwind | متوسط |
| 8 | ecommaps-genAI-Starter | https://github.com/labobankcom/ecommaps-genAI-Starter | غير محدد | نشط (2026-03) | Next.js 16 + React 19 + Tailwind v4 | ✅ عربي+فرنسي (RTL) | ✅ نعم | جيد (glassmorphism) | منخفض (يحتاج Ecommaps store + API key) | Next.js, React, Tailwind v4, Framer Motion | طويل (يحتاج منصة خارجية) |

### التوصية لـ Marketplace
**الأفضل:** ShopSage (MIT، React+TS+Tailwind+Vite، RTL عربي كامل، خفيف، مناسب للدمج التدريجي)
**الثاني:** SoukHub (MIT، Next.js+Supabase، RTL إنجليزي+عربي، Multi-tenant مدمج)
**الثالث:** Baxela (Apache 2.0، نظام كامل headless commerce، لكنه ثقيل ويحتاج Laravel backend)

---

## ب. قوالب Games

| # | المشروع | GitHub URL | الترخيص | النشاط | التقنية | RTL | Responsive | جودة التصميم | سهولة الدمج | الاعتماديات | الوقت المتوقع |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Okay Arcade | https://github.com/andreas-agouridis/okay-arcade | MIT | نشط (2026-03) | HTML5 + CSS3 + JS (ملف واحد) | ❌ غير مذكور | ✅ نعم | جيد (glassmorphism، dark/light) | عالي (Single HTML، لا dependencias) | Font Awesome CDN، Service Worker | قصير جدًا |
| 2 | GameZone PRO | https://github.com/StrataMind/Game-Zone | MIT | نشط (2025-06) | HTML5 + CSS3 + JS | ❌ غير مذكور | ✅ نعم | جيد (20+ لعبة، dark/light) | عالي (بنية Multi-page scalable) | لا أطر (vanilla JS) | قصير |
| 3 | nativelite | https://github.com/parcoillegacy/nativelite | MIT | أقل نشاطًا (2024-02) | HTML5 + CSS3 + JS | ❌ غير مذكور | ✅ نعم | أساسي | عالي (قالب بسيط للألعاب المحظورة) | لا أطر | قصير جدًا |
| 4 | GameHub | https://github.com/Dravingupta/GameHub | MIT | نشط (2026-01) | HTML5 + CSS3 + JS + Tailwind + DaisyUI | ❌ غير مذكور | ✅ نعم | جيد (glassmorphism، 5 ألعاب كلاسيكية) | عالي (vanilla JS، zero frameworks) | Tailwind, DaisyUI, Font Awesome | قصير |
| 5 | MiniGamesHub | https://github.com/komazhao/minigameshub | MIT | غير نشط (2025-09) | HTML5 + CSS3 + JS + PWA | ❌ غير مذكور | ✅ نعم | جيد (26K+ لعبة، PWA) | متوسط (تحتاج مصدر ألعاب خارجي) | Service Worker، PWA | طويل (تجميع الألعاب) |
| 6 | File-GameHub | https://github.com/GameXp404/File-GameHub | MIT | نشط | HTML5 + CSS3 + JS + PWA | ❌ غير مذكور | ✅ نعم | جيد (UI ala CrazyGames، 22+ لعبة، Admin panel) | عالي (PWA، सेवा Worker، Admin CRUD) | Service Worker، WebAudio API | قصير |
| 7 | Arcade-Game-Center | https://github.com/ZoliQua/Arcade-Game-Center | MIT | نشط (2026-04) | CSS + HTML + JS + PHP + TS | ✅ متعدد اللغات (EN/DE/HU) | ✅ نعم | جيد (15 لعبة، leaderboard، autosave) | متوسط (PHP backend لكل لعبة) | PHP، Node، React، Vite، TS | متوسط |
| 8 | Arcadia | https://github.com/divyalgoli/Arcadia | غير محدد | نشط (2026-08) | HTML + JS | ❌ غير مذكور | ✅ نعم | جيد (dark-first، Game folders مستقلة) | متوسط (كل لعبة في مجلد مستقل) | لا أطر | قصير |

### التوصية لـ Games
**الأفضل:** Okay Arcade (MIT، Single HTML file، glassmorphism، dark/light، لا dependencias، سهل الدمج fastest)
**الثاني:** GameZone PRO (MIT، 20+ لعبة، بنية Multi-page scalable، vanilla JS)
**الثالث:** File-GameHub (MIT، 22+ لعبة، Admin panel مدمج، PWA)

---

## ج. قوالب Business Portal / Admin Dashboard

| # | المشروع | GitHub URL | الترخيص | النشاط | التقنية | RTL | Responsive | جودة التصميم | سهولة الدمج | الاعتماديات | الوقت المتوقع |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Admin One | https://github.com/justboil/admin-one-react-tailwind/ | MIT | نشط (2022-2025) | React + Next + Tailwind 4 + TS | ❌ غير مذكور | ✅ نعم | جيد (587 stars) | متوسط | React, Next.js, Tailwind 4, TypeScript, Redux | قصير |
| 2 | TailAdmin | https://github.com/TailAdmin/free-react-tailwind-admin-dashboard | MIT | نشط (2023-03) | React 19 + TS + Tailwind v4 | ❌ غير مذكور | ✅ نعم | جيد (1308 stars) | متوسط | React, TypeScript, Tailwind v4 | قصير |
| 3 | OrbynAdmin | https://github.com/masondevx/orbynadmin | MIT | نشط (2026-07) | Next.js 16 + Tailwind v4 + shadcn/ui + Radix | ❌ غير مذكور | ✅ نعم | ممتاز (70+ صفحة، theme customizer) | عالي (Next.js App Router، shadcn/ui) | Next.js, Tailwind v4, shadcn/ui, Radix UI, Recharts, TanStack Table | متوسط |
| 4 | Shadcn Dashboard (store) | https://github.com/shadcnstore/shadcn-dashboard-landing-template | MIT | نشط (2025-09) | React + TS + Vite + Next.js + shadcn/ui + Tailwind v4 | ❌ غير مذكور | ✅ نعم | ممتاز (1264 stars، tweakcn) | عالي (Vite + Next.js، Base UI) | React, TypeScript, Tailwind v4, shadcn/ui, Base UI, Zod, Zustand, TanStack Table | متوسط |
| 5 | shadcn Dashboard | https://github.com/shadcndashboard/shadcndashboard | MIT | نشط (2026-05) | React + Vite + shadcn/ui + Base UI + Tailwind v4 | ❌ غير مذكور | ✅ نعم | جيد (536 stars) | عالي | React, Vite, shadcn/ui, Base UI, Tailwind v4, Recharts, TipTap | قصير |
| 6 | next-shadcn-dashboard-starter | https://github.com/Kiranism/next-shadcn-dashboard-starter | MIT | نشط (2023-11) | Next.js 16 + shadcn/ui + Base UI + Tailwind v4 | ❌ غير مذكور | ✅ نعم | ممتاز (7309 stars، Clerk auth، everything works) | عالي (Next.js App Router، TanStack Query، Zod) | Next.js, shadcn/ui, Base UI, Tailwind v4, Clerk, TanStack Query, Zod, Zustand, Nuqs | طويل (نظام SaaS كامل) |
| 7 | NextAdmin | https://github.com/NextAdminHQ/nextjs-admin-dashboard/ | غير محدد | نشط | Next.js 16 + Tailwind | ❌ غير مذكور | ✅ نعم | جيد (200+ component) | متوسط | Next.js, Tailwind, TailGrids, Recharts, Leaflet, TanStack Table, Zod, FullCalendar | متوسط |

### التوصية لـ Business Portal
**الأفضل:** OrbynAdmin (MIT، Next.js 16+Tailwind v4+shadcn/ui+Radix، 70+ صفحة، theme customizer، كل شيء MIT بدون Pro tier)
**الثاني:** Shadcn Dashboard (store) (MIT، React+TS+Vite+Next.js+shadcn/ui+Tailwind v4، tweakcn theme customizer، Dashboard + Landing page)
**الثالث:** next-shadcn-dashboard-starter (MIT، 7309 stars، كل شيء يعمل فعليًا، لكنه ثقيل مع Clerk auth وSentry)

---

## د. Design System

| # | المشروع | GitHub URL | الترخيص | التقنية | RTLSupport | سهولة الاستخدام | التوصية |
|---|---|---|---|---|---|---|---|
| 1 | Design Tokens (PR #100) | `E:\Projects\OmniStore-Employees-Dyad\brand\design-system\tokens.json` | داخلي (MIT مقترح) | JSON Tokens (ألوان، طباعة، مسافات، نقاط توقف) | محايد (يعمل في RTL/LTR) | عالي (مصمم لـ OmniStore specifically) | **الأفضل — مخصص للمنصة** |
| 2 | shadcn/ui | https://github.com/shadcn/ui | MIT | React + TS + Tailwind + Radix/Base UI | ✅ (عبر Tailwind logical props) | عالي | ثانوي للاستخدام مع أي قالب React |
| 3 | Tailwind CSS v4 | https://tailwindcss.com | MIT | Utility-first CSS | ✅ (logical properties: ms-, me-, ps-, pe-) | عالي | أساسي لكل القالب React |
| 4 | tweakcn | https://tweakcn.com | مجاني | Theme customizer for shadcn/ui | ✅ | متوسط | مفيد لتخصيص الألوان والتفاعل |

### التوصية لـ Design System
**الأفضل:** Design Tokens الموجود في PR #100 (مخصص لـ OmniStore، يدعم RTL/LTR، ألوان العلامة `#2563eb/#0f172a`)
**الثاني:** shadcn/ui + Tailwind CSS v4 (للتنفيذ الفعلي في أي قالب React)

---

## ه. ملخص التوصيات النهائية

| البوابة | القالب الموصى به | الترخيص | السبب |
|---|---|---|---|
| Marketplace | ShopSage | MIT | React+TS+Tailwind+Vite، RTL عربي كامل، خفيف، مناسب للدمج التدريجي |
| Games | Okay Arcade | MIT | Single HTML file، لا dependencias، glassmorphism، dark/light، أسرع دمج |
| Business Portal | OrbynAdmin | MIT | Next.js 16+Tailwind v4+shadcn/ui+Radix، 70+ صفحة، theme customizer |
| Design System | PR #100 Tokens | داخلي | مخصص لـ OmniStore، RTL/LTR محايد، ألوان العلامة |

### تحذير هام
لا يُدمج أي قالب كبير قبل مراجعة توافقه مع البنية الحالية (`index.html` SPA، Express backend، JSON fileStore، `/api/v1` routes). القالب React (Next.js) يحتاج محور API منفصل أو تكامل مع Express الحالي عبر Proxy.
