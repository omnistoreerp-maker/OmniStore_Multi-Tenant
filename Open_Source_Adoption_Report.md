# تقرير اعتماد قوالب Open Source — Phase 5

المصدر: `Open_Source_Research.md` — بحث ويب فعلي (github.com) — نوفمبر 2026.
الهدف: دمج مكونات وقوالب Open Source لتوفير وقت التطوير (ليست مجرد أفكار تصميمية).
القيود: لا استبدال Framework أو بنية Backend الحالية.

---

## أ. القوالب المعتمدة فعلياً

### 1. Marketplace — ShopSage (الجزائر)

| الخاصية | القيمة |
|---|---|
| GitHub URL | https://github.com/Yacineooak/ShopSage-AI-Powered-E-commerce-Platform-for-Algeria |
| الترخيص | MIT License |
| النشاط | نشط (أنشئ 2025-08-16، تحديثات 2025-2026) |
| التقنية | React 18 + TypeScript + Tailwind CSS + Vite + Zustand + i18next |
| RTL | ✅ عربي كامل (RTL) |
| Responsive | ✅ نعم |
| جودة التصميم | جيد (AI recommendations، Wilayas، الدفع عند الاستلام) |
| سهولة الدمج | متوسط (يحتاج واجهة API خاصة بالمنصة) |
| الاعتماديات | React, Tailwind, Vite, Zustand, i18next |
| الوقت 예상 | متوسط |

**سبب الاختيار:**
- ترخيص MIT يسمح بالاستخدام والتعديل والتوزيع التجاري
- دعم RTL عربي كامل (مطابق لاحتياجات منصة أومنيستور)
- تقنية خفيفة (React + Vite + Tailwind) يمكن دمجها تدريجياً دون استبدال Backend Express الحالي
- دعم الدفع عند الاستلام (Cash on Delivery) — مناسب للسوق المستهدف

**كيفية الدمج:**
- استخدام مكونات المتجر (ProductCard، ProductGrid، Cart) من ShopSage كمرجع للتنفيذ
- ربط الواجهة بـ `/api/v1/market` routes الموجودة في Backend أومنيستور
- لا استبدال للBackend أو Framework الحالي

---

### 2. Games — Okay Arcade

| الخاصية | القيمة |
|---|---|
| GitHub URL | https://github.com/andreas-agouridis/okay-arcade |
| الترخيص | MIT License |
| النشاط | نشط (أنشئ 2026-03-24، 20 نجمة، 20 مراقب) |
| التقنية | HTML5 + CSS3 + JavaScript (ملف واحد، لا أطر) |
| RTL | ❌ غير مذكور (يحتاج إضافة) |
| Responsive | ✅ نعم |
| جودة التصميم | جيد (glassmorphism، dark/light mode، خدمة worker) |
| سهولة الدمج | عالي (Single HTML file، لا dependencias) |
| الاعتماديات | Font Awesome CDN، Service Worker |
| الوقت 예상 | قصير جداً |

**سبب الاختيار:**
- ترخيص MIT يسمح بالاستخدام والتعديل
- لا dependencias ضخمة — سهل الدمج في أي صفحة HTML موجودة
- تصميم زجاجي (glassmorphism) يتوافق مع هوية أومنيستور
- دعم الأوffline عبر Service Worker
- 4 إصدارات (Main, Simple UI, Terminal, No Games) — مرونة في الاختيار

**كيفية الدمج:**
- استخدام القالب كبوابة ألعاب مستقلة (`/games`)
- إضافة دعم RTL للعربية
- دمج الألعاب الموجودة في أومنيستور (46 لعبة من attogram/games base)
- لا استبدال للBackend أو هيكل الألعاب الحالي

---

### 3. Business Portal — OrbynAdmin

| الخاصية | القيمة |
|---|---|
| GitHub URL | https://github.com/masondevx/orbynadmin |
| الترخيص | MIT License |
| النشاط | نشط (أنشئ 2026-07-16، 20 نجمة) |
| التقنية | Next.js 16 (App Router, Turbopack) + TypeScript + Tailwind CSS v4 + shadcn/ui + Radix UI |
| RTL | ❌ غير مذكور (يحتاج إضافة) |
| Responsive | ✅ نعم |
| جودة التصميم | ممتاز (70+ صفحة، Theme Customizer، لا Pro tier) |
| سهولة الدمج | عالي (Next.js App Router، shadcn/ui) |
| الاعتماديات | Next.js, Tailwind v4, shadcn/ui, Radix UI, Recharts, TanStack Table |
| الوقت 예상 | متوسط |

**سبب الاختيار:**
- ترخيص MIT — كل شيء مفتوح بدون Pro tier أو مكونات مقفلة
- 70+ صفحة جاهزة (dashboards، e-commerce، CRM، إلخ)
- Theme Customizer لتعديل الألوان والنص والخطوط بسهولة
- shadcn/ui + Radix UI — مكونات UI احترافية وقابلة للتخصيص
- responsive down to mobile

**كيفية الدمج:**
- استخدام OrbynAdmin كمرجع لتصميم بوابة أعمال موحدة (`/business`)
- تطبيق ألوان Design Tokens من أومنيستور على المكونات
- لا استبدال للBackend Express الحالي — الربط عبر API Proxy
- إضافة دعم RTL للعربية

---

### 4. Design System — أومنيستور Tokens + shadcn/ui + Tailwind CSS v4

| الخاصية | القيمة |
|---|---|
| Design Tokens | `brand/design-system/tokens.json` (داخلي، MIT مقترح) |
| مكتبة أيقونات | Lucide Icons |
| تنسيق CSS | Tailwind CSS v4 |
| مكتبة مكونات UI | shadcn/ui (مرجع) |
| RTL Support | ✅ محايد (يعمل في RTL/LTR) |

**الألوان المعتمدة:**
| اللون | القيمة | الاستخدام |
|---|---|---|
| Navy | `#0B1F44` |-primary، خلفيات ثانوية، نصوص رئيسية |
| Teal | `#00C2B3` | نجاح، إجراءات إيجابية، تمييز |
| Blue | `#4F7CFF` | إجراءات أساسية، روابط، أزرار رئيسية |
| Violet | `#A78BFA` | تمييز ثانوي، حالات خاصة |

**الخطوط:**
- العربية: IBM Plex Sans Arabic
- اللاتينية: Inter
- أحادية: system monospace

---

## ب. таблица ملخص الاعتمادات

| البوابة | القالب المعتمد | الترخيص | الغرض من الاستخدام | التعديلات المطلوبة |
|---|---|---|---|---|
| Marketplace | ShopSage | MIT | مكونات المتجر، سلة التسوق، صفحات المنتجات | ربط بـ `/api/v1/market`، إضافة RTL |
| Games | Okay Arcade | MIT | بوابة ألعاب مستقلة، واجهة تشغيل | إضافة RTL، دمج الألعاب الموجودة |
| Business Portal | OrbynAdmin | MIT | بوابة أعمال موحدة، لوحات تحكم | إضافة RTL، تطبيق ألوان أومنيستور |
| Design System | أومنيستور Tokens + shadcn/ui | داخلي + MIT | هوية بصرية موحدة، مكونات مشتركة | لا تعديل (مصمم للمنصة) |

---

## ج. مكونات UI المشتركة المنشأة (PR #1)

| المكون | المسار | الغرض |
|---|---|---|
| CSS Variables (Design Tokens) | `brand/components/index.css` | متغيرات CSS من Design Tokens |
| Header / Navigation | `brand/components/header.html` | رأس مشترك مع لوجو، تنقل، إجراءات |
| Footer | `brand/components/footer.html` | تذييل مشترك مع روابط وحقوق نشر |
| Buttons | `brand/components/buttons.html` | أزرار بمختلف الأنماط والأحجام |
| Forms | `brand/components/forms.html` | نماذج إدخال وتحديد وإرسال |
| Cards | `brand/components/cards.html` | بطاقات شبكة وأ básic وheader/footer |
| Layouts | `brand/components/layouts.html` | تخطيط كامل (header + main + footer) |

---

## د. قرارات التصميم

1. **لا استبدال Framework:** back-end يبقى Express + JSON fileStore + `/api/v1` routes
2. **لا استبدال Backend:** القوالب React (Next.js) تُستخدم كمرجع واجهة أمامية فقط، الربط عبر API Proxy
3. **RTL أولوية:** جميع المكونات تدعم `dir="rtl"` للعربية و `dir="ltr"` للإنجليزية
4. **Light/Dark:** دعم الوضع الليلي والنهاري عبر `data-theme="dark"`
5. **Responsive:** breakpoints من Design Tokens (640px/768px/1024px/1280px)
6. **لا بيانات وهمية:** جميع العروض تستخدم البيانات الفعلية من API
7. **لا حسابات مكررة:** مدخل دخول واحد آمن، لا إنشاء حسابات جديدة

---

## ه. الخطوة التالية

PR #2: Marketplace transformation — استخدام مكونات ShopSage لبناء واجهة السوق العامة مع ربط بـ `/api/v1/market` routes الموجودة.
