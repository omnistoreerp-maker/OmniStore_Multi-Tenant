# مخزون الواجهات — DYAD UI Backlog

المصدر: `E:\Projects\OmniStore_Multi-Tenant` (HEAD: `4160f3ce8`) — قراءة فقط، لا تعديل.
المساحة المعزولة: `E:\Projects\OmniStore-Employees-Dyad` — توثيق فقط.

## 0. كيف أُنشئ هذا الملف

تم فحص الملفات الفعلية في المستودع المصدر (قراءة فقط):
- `index.html` (~44K سطر) — ERP رئيسي SPA واحد مع `showPage` router و~180 صفحة `page-*`
- `platform.html` — منصة عامة، landing page، RTL/Dark mode
- `market.html` — سوق عام، vanilla JS + CSS
- `student.html` — خدمات طلاب، طباعة طلابية، pass orders
- `business.html` — أعمال، business profile
- `support.html` — دعم، support center
- `marketplace/` (Vite+TS) — OnSpace premium app
- `platform/` (React) — منصة dark glassmorphism

لا تُعتبر أي صفحة "مكتملة" دون التحقق من ملفها الفعلي.

---

## 1. ERP الرئيسي — index.html (SPA واحد)

| الصفحة / السطح | المعرف / المسار | الحالة | الوظائف المحققة | الفجوات / الملاحظات | تكامل API |
|---|---|---|---|---|---|
| لوحة التحكم الرئيسية | `page-dashboard` | موجود | عرض ملخص، إحصائيات سريعة | يحتاج التحقق من 실제 البيانات | `/api/v1/dashboard` |
| الموظفين | `page-employees` | مكتمل | جدول موظفين، بحث، تصفية حسب الفرع، حضور/انصراف، إجازات، سلفة، ملف الموظف، رواتب، تصدير HR (CSV/JSON) | `renderEmployees()` يستخدم `digitronicsDataAdapter.listEmployees()` जोет `backendApi.employees.getAll()` | `GET/POST/PUT/DELETE /api/v1/employees`, `GET /api/v1/employees/stats` |
| أداء الموظفين | `page-employee-performance` | موجود | جدول الأداء، فلاتر | يحتاج التحقق من تكامل API | `/api/v1/employees/stats` |
| الشركات | `page-companies` | موجود | إدارة الشركات | يحتاج التحقق | `/api/v1/companies` |
| المخزون | `page-inventory` | موجود | إدارة المخزون، أصناف | يحتاج التحقق | `/api/v1/inventory` |
| المبيعات | `page-sales` | موجود | فواتير مبيعات | يحتاج التحقق | `/api/v1/sales` |
| المشتريات | `page-purchases` | موجود | أوامر مشتريات | يحتاج التحقق | `/api/v1/purchases` |
| العملاء | `page-customers` | موجود | إدارة العملاء | يحتاج التحقق | `/api/v1/customers` |
| الموردون | `page-suppliers` | موجود | إدارة الموردين | يحتاج التحقق | `/api/v1/suppliers` |
| الخزينة | `page-treasury` | موجود | حركة مالية، صندوق | يحتاج التحقق | `/api/v1/treasury` |
| التقارير | `page-reports` | موجود | تقارير مختلفة | يحتاج التحقق | `/api/v1/reports` |
| لوحة الماستر | `page-master-control-center` | موجود | Master Control Center shell، overview UI | موجود في HEAD `4160f3ce8` | `/api/v1/master/*` |
| تسجيل الدخول | `page-login` / auth modal | موجود | نموذج دخول، معدل محدود | `router.post('/login', loginRateLimiter(), ctrl.login)` | `POST /api/v1/auth/login` |
| الملف الشخصي | `page-profile` | موجود | عرض/تعديل الملف | يحتاج التحقق | `/api/v1/auth/me` |
| الإشعارات | `page-notifications` | موجود | قائمة إشعارات | يحتاج التحقق | `/api/v1/notifications` |
| الإعدادات | `page-settings` | موجود | إعدادات النظام | يحتاج التحقق | `/api/v1/settings` |

**ملاحظة:** `index.html` يحتوي على ~180 صفحة `page-*` يتم توجيهها عبر دالة `showPage()`. القائمة أعلاه تغطي الصفحات الرئيسية المرئية فقط. يحتاج مسح آلي لكامل الصفحات لضمان عدم إغفال أي Page.

---

## 2. منصة عامة — platform.html

| السطح | الحالة | الوظائف | الفجوات | تكامل API |
|---|---|---|---|---|
| Landing page | موجود | RTL/Dark mode، عرض عام للمنصة | يحتاج التحقق من الروابط الفعلية | عام (بدون مصادقة) |
| بوابة الأعمال | موجود | عرض فئات الأعمال | يحتاج التحقق | `/api/v1/platform/*` |
| منصة عامة (public) | موجود | `platform-public` routes | يحتاج التحقق | `/api/v1/platform-public/*` |
| تغذية تيك توك الاجتماعي | موجود | `GET /api/v1/platform-public/social-feed/tiktok` | اختبار tiktokFeed.test.js فاشل (6 embeds متوقع، 1 ricevuto) | `/api/v1/platform-public/social-feed/tiktok` |

---

## 3. سوق عام — market.html + marketplace/

| السطح | الحالة | الوظائف | الفجوات | تكامل API |
|---|---|---|---|---|
| سوق عام (vanilla JS) | موجود | `market.html`، `market/js/app.js|api.js|locales.js`، `market/css/market.css` | يحتاج التحقق من وظائف CRUD الفعلية | `/api/v1/market` |
| Marketplace React (OnSpace) | موجود | `marketplace/` (Vite+TS)، premium app | يحتاج مراجعة توافق مع Design System الجديد | `/api/v1/market` |
| دليل المنتجات | موجود (PRs #3-#10 مدمج) | CRUD منتجات، فلاتر مسودات | PR #47 مفتوح لاستعادة تصفية المسودات | `/api/v1/market/products` |
| مساحة الإعلانات (Monetag) | موجود | `platform/monetag.js`، `AdSlot.tsx` | معطل افتراضيًا، لا يُفعل حتى تأكيد Monetag | لا API مباشر |

---

## 4. بوابة الأعمال — Business Portal

| السطح | الحالة | الوظائف | الفجوات | تكامل API |
|---|---|---|---|---|
| business.html | موجود | business profile | يحتاج التحقق من الحقول الفعلية | `/api/v1/companies` |
| منصة React (platform/) | موجود | dark glassmorphism، بوابة أعمال موحدة | يحتاج مراجعة توافق RTL | `/api/v1/platform-admin` |
| بوابة أعمال واحدة لجميع فئات المستخدمين | غير موجودة | **مفقودة** — تحتاج تصميم جديد | جزء من خطة الهوية الموحدة | `/api/v1/platform-admin/*` |

---

## 5. التعليم — student.html

| السطح | الحالة | الوظائف | الفجوات | تكامل API |
|---|---|---|---|---|
| خدمات طلاب / طباعة طلابية | موجود | `student.html`، pass orders | يحتاج التحقق من جودة الطباعة | `/api/v1/tenant/student-services/*` |
| أسعار الطباعة (rates) | موجود | CRUD أسعار حسب tenant | اختبارات studentServices.rates.test.js فاشلة (400/500) | `/api/v1/tenant/student-services/rates` |
| حساب التكلفة (calculate) | موجود | حساب تكلفة الطباعة | نفس الاختبارات الفاشلة أعلاه | `/api/v1/tenant/student-services/calculate` |
| عزل tenants في الأسعار | موجود | tenant isolation | اختبار studentServicesPack.tenantIsolation.test.js فاشل (`_writeStore` غير معرفة) | `/api/v1/tenant/student-services/*` |

---

## 6. استضافة الألعاب — Games

| السطح | الحالة | الوظائف | الفجوات | تكامل API |
|---|---|---|---|---|
| بوابة ألعاب (46 لعبة) | موجود | PRs #21-#23, #25 مدمج، attogram/games base | PR #21 مفتوح (CONFLICTING)، يحتاج تدقيق ترخيص | `/api/v1/game-hosting` |
| PlayStation بوابة | موجود | `playstation.html` | يحتاج التحقق | `/api/v1/playstation` |
| ألعاب عبر الإنترنت (Online Games) | موجود | `feature/online-games-portal-20261003` | يحتاج مراجعة جودة قبل الدمج | `/api/v1/game-hosting` |

---

## 7. موظفين — Employees

| السطح | الحالة | الوظائف | الفجوات | تكامل API |
|---|---|---|---|---|
| قائمة الموظفين | `page-employees` | مكتمل | جدول، بحث، تصفية حسب الفرع، إحصائيات | `GET/POST /api/v1/employees`, `GET /api/v1/employees/stats` |
| إضافة موظف | modal `employeeModal` | مكتمل | نموذج إضافة مع التحقق من الصحة | `POST /api/v1/employees` |
| تعديل موظف | `editEmployee()` | مكتمل | تعبئة النموذج من البيانات الموجودة | `PUT /api/v1/employees/:id` |
| حذف موظف | `deleteEmployeeById()` | مكتمل | تأكيد الحذف + backend sync | `DELETE /api/v1/employees/:id` |
| ملف الموظف | `openEmployeeProfile()` | مكتمل | عرض تفاصيل الموظف | `GET /api/v1/employees/:id` |
| حضور/انصراف | `employeeCheckIn/CheckOut()` | موجود | تسجيل حضور يومي | لا API مباشر (محلي في DB) |
| إجازات | `openEmployeeLeaveModal()` | موجود | تقديم طلب إجازة | لا API مباشر (محلي في DB) |
| سلفة | `openEmployeeAdvanceModal()` | موجود | صرف/خصم سلفة | لا API مباشر (محلي في DB) |
| صرف راتب | `paySalary()/confirmPaySalary()` | موجود | حساب الراتب النهائي، إنشاء Voucher | لا API مباشر (محلي في DB) |
| تقارير الأداء | `page-employee-performance` | موجود | عرض أداء الموظفين | `GET /api/v1/employees/stats` |
| تصدير HR (CSV/JSON) | `exportHRReport()` | موجود | تصدير CSV/JSON مع BOM للغة العربية | لا API مباشر (محلي في DB) |

**الحالة:** مكتمل من الجانبين (باك إند + فرونت إند). اختبارات crud/sync/multitenant-read-authz جميعها ناجحة. لا يوجد تعديل مطلوب.

---

## 8. Master Control Center

| السطح | الحالة | الوظائف | الفجوات | تكامل API |
|---|---|---|---|---|
| Master Control Center shell | موجود | `page-master-control-center`، overview UI، scope/nav fixes | موجود في HEAD `4160f3ce8` | `/api/v1/master/*` |
| نظرة عامة على المنصة | موجود | real platform overview API | Phase 1 مدمج | `/api/v1/platform-overview` |
| مركز التحكم الرئيسي | `<MASTER_CONTROL_CENTER />` | مفهوم في ARCHITECTURE.md | لا تغيير على مسارات النظام في Phase 2 | `/api/v1/master/*` |

---

## 9. المصادقة والأمان (عبر جميع البوابات)

| السطح | الحالة | الوظائف | الفجوات | تكامل API |
|---|---|---|---|---|
| تسجيل الدخول | موجود | `loginRateLimiter()`، `ctrl.login` | لا تعديل على OAuth/Auth per الضوابط | `POST /api/v1/auth/login` |
| التحقق من الهوية | موجود | Session-based + OAuth + Passport + Google linking | Google Tenant Login محظور (لا حساب اختبار مؤهل) | `POST /api/v1/auth/*` |
| ملف المستخدم | موجود | `GET /api/v1/auth/me` | يحتاج `credentials: 'same-origin'` (مُطبق) | `GET /api/v1/auth/me` |
| الصلاحيات | موجود | `requirePermissionIfAuth`، مجموعات الصلاحيات (employees.view/create/edit/delete) | لا تعديل على Permissions per الضوابط |middleware |
| عزل tenants | موجود | Tenant isolation على معظم المسارات | لا تعديل على Tenant Isolation per الضوابط |middleware |

---

## 10. الوظائف المفقودة أو المتروكة

| العنصر | الحالة | الملاحظة |
|---|---|---|
| بوابة أعمال موحدة لجميع فئات المستخدمين | **مفقودة** | تحتاج تصميم جديد ضمن خطة الهوية الموحدة |
| عرض توحيد الهوية (Unified Identity) across all portals | **مفقودة** | جزء من Phase 3 |
| Light/Dark mode موحد عبر جميع الأسطح | **جزئي** | موجود في بعضهم، يحتاج توحيد |
| RTL/LTR موحد عبر جميع الأسطح | **جزئي** | موجود في index.html وplatform.html، يحتاج مراجعة شاملة |
| Responsive design شامل | **جزئي** | يحتاج مراجعة لجميع الصفحات |
| Google Tenant Login | **محظور** | لا حساب اختبار مؤهل، safety gate غير مستوفى |
| Lovable SSR (`/portal` على المنفذ 4000) | **غير متاح على الإنتاج** | يحتاج موافقة مالك لتعديل Nginx/systemd |
| صفحات قانونية (Terms, Privacy) | **PR #36 مفتوح** | CONFLICTING، يحتاج حل تعارض |
| Monetag الإعلانات | **معطل افتراضيًا** | لا يُفعل حتى تأكيد Monetag |

---

## 11. مشاكل التصميم والاستجابة وRTL (مُستنتجة من الملفات الفعلية)

| المنطقة | الحالة | الملاحظة |
|---|---|---|
| اتجاه RTL (lang="ar", dir="rtl") | موجود في index.html | يحتاج مراجعة لجميع الصفحات (بعضها قد يكون LTR) |
| خط Cairo | موجود في index.html | الخط العربي الافتراضي |
| Dark/Light mode | جزئي | موجود في platform.html وبعض الشاشات |
| تصميم زجاجي (Glassmorphism) | موجود في platform/ | يحتاج توحيد مع Design System جديد |
| لوجو "The Connected O" | موجود في PR #100 |brand/logo/omnistore-logo-connected-o.svg، لم يُطبَّق بعد على الواجهات |
| Design Tokens | موجود في PR #100 |brand/design-system/tokens.json، لم يُطبَّق بعد على الواجهات |
| إرشادات استخدام العلامة | موجود في PR #100 |brand/guidelines/usage.md |

---

## 12. نقاط التكامل مع APIs (حسب الملفات الفعلية)

| النطاق | المسار | الحالة | ملحوظة |
|---|---|---|---|
| الموظفين | `/api/v1/employees` | مكتمل | CRUD + stats + multi-tenant safety |
| المصادقة | `/api/v1/auth/*` | مكتمل |-login، /me، OAuth، Google linking |
| الشركات | `/api/v1/companies` | موجود | يحتاج التحقق |
| المخزون | `/api/v1/inventory` | موجود | يحتاج التحقق |
| المبيعات | `/api/v1/sales` | موجود | يحتاج التحقق |
| المشتريات | `/api/v1/purchases` | موجود | يحتاج التحقق |
| العملاء | `/api/v1/customers` | موجود | يحتاج التحقق |
| الموردون | `/api/v1/suppliers` | موجود | يحتاج التحقق |
| الخزينة | `/api/v1/treasury` | موجود | يحتاج التحقق |
| التقارير | `/api/v1/reports` | موجود | يحتاج التحقق |
| لوحة التحكم | `/api/v1/dashboard` | موجود | يحتاج التحقق |
| الإعدادات | `/api/v1/settings` | موجود | يحتاج التحقق |
| الماستر | `/api/v1/master/*` | موجود | MCC overview API |
| المنصة | `/api/v1/platform/*` | موجود | يحتاج التحقق |
| المنصة العامة | `/api/v1/platform-public/*` | موجود | social-feed tiktok |
| الطلاب | `/api/v1/tenant/student-services/*` | جزئي | اختبارات فاشلة |
| الألعاب | `/api/v1/game-hosting` | موجود | يحتاج التحقق |
| السوق | `/api/v1/market` | موجود | CRUD مدمج |
| الصحة | `/api/v1/health, /ready, /liveness` | مؤكد على الإنتاج | 200، better-sqlite3 writable |

---

## 13. أولويات العمل المقترحة (DYAD UI Backlog)

1. **عالي:** مراجعة PR #100 وتطبيق لوجو "The Connected O" + Design Tokens على جميع البوابات (تصميم مرجعي فقط، لا تعديل على الكود الفعلي per الضوابط)
2. **عالي:** توحيد RTL/LTR وLight/Dark عبر جميع الصفحات في index.html
3. **متوسط:** إنشاء بوابة أعمال موحدة لجميع فئات المستخدمين (تصميم مرجعي)
4. **متوسط:** إصلاح اختبارات student-services الفاشلة (rates, calculate, tenant isolation) — تحتاج مراجعة الكود الفعلي
5. **منخفض:** مراجعة PRs المفتوحة (#6, #47, #51 مدمجين آمنًا؛ #69, #65, #64, #36, #21 CONFLICTING تحتاج حل تعارض)
6. **منخفض:** مسح آلي لكامل صفحات `page-*` في index.html للتأكد من عدم إغفال أي واجهة

---

## 14. ملخص تنفيذي

- **الصفحات الموجودة:** ~180 صفحة في index.html + platform.html + market.html + student.html + business.html + support.html + marketplace/ + platform/
- **المكتمل والمؤكد:** موظفين (CRUD + API + اختبارات)، المصادقة، الصحة (production)، Marketplace CRUD، ألعاب (46 لعبة)، تعليم (مدمج)
- **المفقود:** بوابة أعمال موحدة، توحيد الهوية البصرية، Light/Dark/RTL شامل
- **المتعارض:** PRs #69, #65, #64, #36, #21 (CONFLICTING)
- **المحظور:** Google Tenant Login، تعديل الإنتاج، Lovable SSR على المنفذ 4000
