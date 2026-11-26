# معمارية الواجهات المستهدفة — OmniStore Unified Platform

المصدر: `ARCHITECTURE.md` + `DYAD_UI_BACKLOG.md` — قراءة فقط، لا تعديل على الكود الفعلي.

---

## 1. الهيكل المفاهيمي (مُحاكى من ARCHITECTURE.md)

```
<OMNISTORE>
  <PUBLIC_PLATFORM>
    <MARKETPLACE />       — market.html + marketplace/ (Vite+TS)
    <GAMES />             — playstation.html + game-hosting routes
    <BUSINESS />          — business.html + platform/ (React dark glassmorphism)
  </PUBLIC_PLATFORM>
  <BUSINESS_ECOSYSTEM>
    <COMPANIES />         — companies routes
    <CENTERS />           — tenant routes
    <EDUCATION />         — student.html + studentServicesPack routes
    <EMPLOYEES />         — page-employees + employees routes (مكتمل)
    <ERP />               — index.html ERP SPA (~180 page-*)
  </BUSINESS_ECOSYSTEM>
  <MASTER_CONTROL_CENTER />  — master-control-center routes
</OMNISTORE>
```

**هذه أسماء مفاهيمية لتنظيم التجربة، ليست تعليمات لتغيير مسارات النظام أو APIs.**

---

## 2. خريطة الأسطح الحالية → المستهدفة

| السطح الحالي | الملف | البنية المستهدفة | 상태 التكامل | الإجراء المطلوب |
|---|---|---|---|---|
| ERP الرئيسي (SPA واحد) | `index.html` (~44K سطر، ~180 page-*) | `<BUSINESS_ECOSYSTEM> <ERP />` | نشط، جميع الوظائف موجودة | preservation فقط، لا تعديل |
| منصة عامة | `platform.html` | `<PUBLIC_PLATFORM> <BUSINESS />` | نشط، RTL/Dark | مراجعة توافق RTL |
| سوق عام | `market.html` + `marketplace/` | `<PUBLIC_PLATFORM> <MARKETPLACE />` | نشط، vanilla JS + React | CRUD موجود (PRs #3-#10 مدمج) |
| خدمات طلاب | `student.html` | `<BUSINESS_ECOSYSTEM> <EDUCATION />` | نشط، اختبارات فاشلة (student-services) | إصلاح الاختبارات (مراجعة كود فقط) |
| أعمال | `business.html` | `<BUSINESS_ECOSYSTEM> <BUSINESS />` | نشط، business profile | مراجعة الحقول |
| دعم | `support.html` | `<PUBLIC_PLATFORM>` | نشط | مراجعة |
| ألعاب | game-hosting routes + `playstation.html` | `<PUBLIC_PLATFORM> <GAMES />` | نشط (46 لعبة) | PR #21 CONFLICTING — يحتاج حل تعارض |
| موظفين | `page-employees` + employees routes | `<BUSINESS_ECOSYSTEM> <EMPLOYEES />` | مكتمل (CRUD + API + اختبارات ناجحة) | لا تعديل |
| شركات | companies routes | `<BUSINESS_ECOSYSTEM> <COMPANIES />` | نشط | مراجعة |
| سنتر/مستأجرين | tenant routes | `<BUSINESS_ECOSYSTEM> <CENTERS />` | نشط | مراجعة |
| مركز التحكم الرئيسي | master-control-center routes | `<MASTER_CONTROL_CENTER />` | نشط (overview API) | مراجعة |

---

## 3. هوية بصرية موحدة (من PR #100)

### المكونات المُعتمدة (جاهزة للمراجعة)
- **اللوجو:** `brand/logo/omnistore-logo-connected-o.svg` (The Connected O)
- **Design Tokens:** `brand/design-system/tokens.json` (ألوان، طباعة، مسافات، نقاط توقف، فهرس طبقات)
- **إرشادات الاستخدام:** `brand/guidelines/usage.md` (قواعد الاستخدام، الممنوعات، RTL/LTR)

### الألوان المعتمدة
| الاستخدام | القيمة | الملاحظة |
|---|---|---|
| Primary | `#2563eb` | لون العلامة الأساسي (من اللوجو الحالي) |
| Primary Hover | `#1d4ed8` | تفاعل الأزرار والعناصر |
| Primary Light | `#eef2ff` | خلفيات 초فيفة |
| Secondary | `#0f172a` | نص ثانوي، خلفيات داكنة |
| Surface | `#ffffff` | خلفيات بطاقات |
| Text Primary | `#0f172a` | نص أساسي |
| Text Secondary | `#475569` | نص ثانوي |
| Success | `#16a34a` | نجاح، تأكيد |
| Warning | `#d97706` | تحذير |
| Danger | `#dc2626` | خطأ، حذف |
| Info | `#2563eb` | معلومات |

### typography
- الخط: `system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif`
- الأوزان: 400، 500، 600، 700، 800
- ارتفاع السطر: 1.25 (مضغوط)، 1.5 (طبيعي)، 1.75 (مريح)

### الاتجاه واللغة
- RTL افتراضي للعربية (`lang="ar"`, `dir="rtl"`)
- LTR للإنجليزية
- اللوجو وتصميم النظام محايدان اتجاهيًا

---

## 4. خطة التطبيق على البوابات (تصميم مرجعي — لا تعديل على الكود الفعلي)

### Marketplace (مستقلة)
- القالب المقترح: ShopSage (MIT، React+TS+Tailwind+Vite، RTL عربي)
- تطبيق Design Tokens من PR #100 على الألوان والطباعة
- الحفاظ على `/api/v1/market` routes الموجودة
- لا استبدال للقالب الحالي قبل مقارنة الجودة والوظائف

### Games (مستقلة)
- القالب المقترح: Okay Arcade (MIT، Single HTML، لا dependencias)
- تطبيق Design Tokens على الألوان
-保留 46 لعبة موجودة من attogram/games base
- PR #21 يحتاج حل تعارض قبل أي دمج

### Business Portal (بوابة واحدة لجميع فئات المستخدمين)
- القالب المقترح: OrbynAdmin (MIT، Next.js 16+Tailwind v4+shadcn/ui+Radix)
- بوابة واحدة تخدم جميع فئات المستخدمين (أصحاب أعمال، موظفين، عملاء)
- تطبيق Design Tokens على كافة المكونات
- RTL/LTR + Light/Dark مدمج

### هوية بصرية موحدة (جميع البوابات)
- لوجو "The Connected O" في header جميع الصفحات
- ألوان Design Tokens في جميع المكونات
- طباعة موحدة (system-ui stack)
- مسافات وحدود элементов موحدة

### Light/Dark + RTL/LTR
- تبديل سلس بين الفتحتين
- منطقيات CSS (`ms-`, `me-`, `ps-`, `pe-`) ل RTL تلقائي
- `lang` و `dir` تتغير حسب اللغة المختارة

### Responsive
- Breakpoints من Design Tokens: sm 640px، md 768px، lg 1024px، xl 1280px
- جميع الصفحات تعمل على موبايل، تابلت، ديسك توب

---

## 5. خطة تنفيذ مقسمة إلى PRs صغيرة (مرتبة بالأولوية)

| الأولوية | PR | النطاق | الملفات المتأثرة | التقدير | اعتماديات |
|---|---|---|---|---|---|
| P0 | #1 | مراجعة PR #100 (Branding) | `brand/*`, `ARCHITECTURE.md`, `WORK_INVENTORY.md` | مراجعة فقط | لا شيء (مفتوح بالفعل) |
| P0 | #2 | توحيد RTL/LTR في index.html | `index.html` (بعض الصفحات) | متوسط | PR #1 (للتواليف الألوان) |
| P0 | #3 | تطبيق Light/Dark موحد | `index.html`, `platform.html` | متوسط | PR #1 |
| P1 | #4 | إصلاح اختبارات student-services الفاشلة | `backend/services/studentServicesPack.service.js`, `backend/tests/studentServices.rates.test.js`, `backend/tests/studentServicesPack.tenantIsolation.test.js` | متوسط | لا شيء (مراجعة كود موجودة) |
| P1 | #5 | مسح آلي لصفحات page-* في index.html | `index.html` | قصير | لا شيء |
| P1 | #6 | مراجعة PRs المدمجة آمنًا (#6, #47, #51) | GitHub PRs | مراجعة فقط | PRs مفتوحة على GitHub |
| P2 | #7 | حل تعارض PRs #69, #65, #64, #36, #21 | فروع PRs المقابلة | طويل | PRs مفتوحة، يحتاج مالك لحل التعارض |
| P2 | #8 | تصميم بوابة أعمال موحدة (مرجعي) | مستندات تصميم فقط | طويل | PR #1 (Design Tokens) |
| P3 | #9 | تطبيق لوجو "The Connected O" على الواجهات | جميع ملفات HTML | طويل | PR #1، موافقة على التصميم |
| P3 | #10 | توحيد Design Tokens عبر جميع المكونات | جميع ملفات CSS/HTML | طويل | PR #1 |

**قاعدة:** لا يُدمج أي PR دون مراجعة. لا يُدمج PR #100 per تعليمات المستخدم. لا تعديل على `.env`، `backend/data/`، OAuth، Auth، Permissions، Tenant Isolation.

---

## 6. المخاطر والقرارات المطلوبة

| المخاطر | التأثير | الاحتمال | التوصية |
|---|---|---|---|
| PRs #69, #65, #64, #36, #21 ذات Mergeable = CONFLICTING | لا يمكن دمجها حتى حل التعارض | عالي | حل التعارضات يدويًا أو إغلاق PRs غير ضرورية |
| PR #63 مصنف NO MERGE | لا يجب دمجه (مراجعة أمنية فقط) | منخفض | الاحتفاظ كمرجع أمني |
| Lovable SSR على المنفذ 4000 غير شغّال على الإنتاج | `/portal` غير متاح عبر Nginx | متوسط | يحتاج موافقة مالك لتعديل Nginx/systemd (محظور per الضوابط) |
| sudo محدود على الإنتاج (نطاق omnistore.service فقط) | لا يمكن تعديل Nginx/systemd مباشرة | عالي | لا إجراء إنتاجي جديد |
| اختبارات student-services فاشلة (400/500 responses) | وظائف الطلاب غير مضمونة | متوسط | مراجعة `studentServicesPack.service.js` (`_writeStore` غير معرفة) |
| Google Tenant Login محظور | لا حساب اختبار مؤهل | منخفض | لا محاولة لتفعيله |
| PR #100 CI فحص واحد pending (Backend jest/coverage) | منخفض (الـ PR يضيف فقط ملفات علامة تجارية) | منخفض | الانتظار لانتهاء الفحص |
| استبدال Framework كبير (مثل نقل index.html SPA إلى React) | خطر عالي على الاستقرار | منخفض |禁止 per الضوابط ("لا تبدأ استبدال Framework أو إعادة كتابة التطبيق") |

### القرارات المطلوبة من المستخدم
1. هل يوافق على دمج PR #100 بعد مراجعة CI؟ (مؤجل حاليًا per تعليمات "لا تدمج PRs")
2. أي PRs ذات CONFLICTING يجب حلها مقابل أي منها يجب إغلاقه؟
3. هل يُفضل استخدام ShopSage للمarketplace، Okay Arcade للألعاب، OrbynAdmin لـ business portal كمرجع لتصميم فقط (لا دمج)؟
4. هل يُسمح بمراجعة وإصلاح `_writeStore` في `studentServicesPack.service.js` (تعديل كود back-end)؟
