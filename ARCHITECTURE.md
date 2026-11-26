# معمارية OmniStore المنصة الموحدة

## Phase 2 — وضع معمارية OmniStore الجديدة

المستودع الأصلي: `E:\Projects\OmniStore_Multi-Tenant` (HEAD: `4160f3ce8`)
المساحة المعزولة: `E:\Projects\OmniStore-Employees-Dyad`

---

## 1. البنية المستهدفة (مفاهيمية)

```
<OMNISTORE>
  <PUBLIC_PLATFORM>
    <MARKETPLACE />
    <GAMES />
    <BUSINESS />
  </PUBLIC_PLATFORM>
  <BUSINESS_ECOSYSTEM>
    <COMPANIES />
    <CENTERS />
    <EDUCATION />
    <EMPLOYEES />
    <ERP />
  </BUSINESS_ECOSYSTEM>
  <MASTER_CONTROL_CENTER />
</OMNISTORE>
```

**هذه أسماء مفاهيمية لتنظيم التجربة، وليست تعليمات لتغيير مسارات النظام أو APIs دون دراسة.**

---

## 2. مراجعة البنية الحالية (من الاستكشاف الفعلي)

### Frontend surfaces الموجودة حالياً
| السطح | الملف | الحالة | ملاحظة |
|---|---|---|---|
| ERP الرئيسي (SPA واحد) | `index.html` (~44K سطر) | نشط | contiene ~180 page-* div، showPage router |
| منصة عامة | `platform.html` | نشط | landing page، RTL/Dark |
| سوق عام | `market.html` | نشط | vanilla JS + CSS |
| خدمات طلاب | `student.html` | نشط | طباعة طلابية، pass orders |
| أعمال | `business.html` | نشط | business profile |
| دعم | `support.html` | نشط | support center |
| Marketplace React | `marketplace/` (Vite+TS) | نشط | OnSpace premium app |
| منصة React | `platform/` | نشط | dark glassmorphism |

### Backend architecture الحالية
- **Runtime:** Node.js + Express
- **Persistence:** JSON file-based (fileStore)، لا Postgres فعلي في runtime (Supabase schema Draft فقط)
- **API base:** `/api/v1` مع ~40 مسار
- **Auth:** Session-based + OAuth + Passport + Google linking
- **Tenancy:** Tenant isolation مطبقة على معظم المسارات
- **Services:** 30+ وحدة (tenancy, auth, accounting, employees, inventory, market, game-hosting, student-services, etc.)
- **Deploy:** systemd service, nginx, docker-compose, vercel, render, firebase

### API domains القائمة حالياً (من `backend/routes/`)
`auth`, `users`, `employees`, `companies`, `inventory`, `sales`, `purchases`, `customers`, `suppliers`, `treasury`, `reports`, `dashboard`, `vouchers`, `loyalty`, `partners`, `market`, `game-hosting`, `playstation`, `platform`, `platform-public`, `platform-admin`, `tenant`, `tenantExtensions`, `tenantPayments`, `tenantOnboarding`, `internalChangeCenter`, `platformIntegration`, `companyProfile`, `customerRequest`, `audit-log`, `apiKeys`, `webhooks`, `metrics`, `health`, `oauth`, `mfa`, `shiftManagement`, `studentServicesPack`, `onlineStore`

---

## 3. خريطة الأسطح الحالية → البنية المستهدفة

| السطح الحالي | البنية المستهدفة | ملاحظة |
|---|---|---|
| `index.html` ERP | `<BUSINESS_ECOSYSTEM> <ERP />` | الحفاظ على كل الوظائف الحالية |
| `market.html` + `market/` | `<PUBLIC_PLATFORM> <MARKETPLACE />` | سوق عام للزائر |
| `platform.html` + `platform/` | `<PUBLIC_PLATFORM> <BUSINESS />` | بوابة الأعمال الموحدة |
| `student.html` | `<BUSINESS_ECOSYSTEM> <EDUCATION />` | خدمات تعليمية/طباعة طلابية |
| game-hosting routes | `<PUBLIC_PLATFORM> <GAMES />` | بوابة ألعاب |
| Master Control Center | `<MASTER_CONTROL_CENTER />` | مركز التحكم الرئيسي |
| `employees` routes/screens | `<BUSINESS_ECOSYSTEM> <EMPLOYEES />` | إدارة الموظفين |
| companies routes | `<BUSINESS_ECOSYSTEM> <COMPANIES />` | إدارة الشركات |
| tenant routes | `<BUSINESS_ECOSYSTEM> <CENTERS />` | إدارة السنتر/المستأجرين |

---

## 4. ما يُحتفظ به / يُحسَّن / يُستبدل

### يُحتفظ به (بدون تغيير)
- جميع المسارات/backend الحالية (`/api/v1/*`)
- نظام الصلاحيات والـ tenant isolation
- نظام المصادقة الحالي (session + OAuth + Google linking)
- شاشة الموظفين (`page-employees` + `renderEmployees` + `backendApi.employees`)
- جميع شاشات ERP الحالية في `index.html`

### يُحسَّن (واجهة وتجربة استخدام فقط)
- تطبيق نظام تصميم موحد (Design System) على جميع الأسطح
- توحيد Header/Footer والتنقل بين البوابات
- تطبيق Light/Dark mode و RTL/LTR
- اللوجو الجديد والهوية البصرية لـ OmniStore

### يُستبدل/Open Source (فقط إذا ثبت الجودة والترخيص)
- قوالب Marketplace/Game Portal/Business Portal من مصادر Open Source ناضجة
- **شرط:** لا يُستبدل التنفيذ الحالي بحل جديد قبل مقارنة الجودة والوظائف
- **شرط:** لا تُضاف dependencies جديدة دون ضرورة وتبرير

---

## 5. ضوابط لا يمكن تجاوزها (من المهمة)

ممنوع دون موافقة صريحة منفصلة:
- تعديل `.env` أو `.env.*` أو الأسرار
- تعديل `backend/data/` أو ملفات runtime JSON/SQLite/uploads
- إنشاء مستخدمين أو تغيير كلمات مرور/عضويات/أدوار/tenant assignments
- تعديل OAuth أو Google authentication أو Master authentication أو session security
- تعديل permissions أو tenant isolation أو database schema/migrations
- الاتصال بالإنتاج للتعديل أو النشر
- Deploy/restart/Nginx reload/systemd operations
- عمليات كتابة على بيانات حقيقية

---

## 6. أولوية التنفيذ (من المهمة)

1. أعمال الأمان والاستقرار التي لا غنى عنها
2. الأعمال المكتملة القابلة للدمج
3. الأعمال المفتوحة التي تدعم التحول الجديد
4. الوظائف الحالية التي يجب الحفاظ عليها
5. التحسينات الجديدة

---

## 7. قرار Phase 2

البنية المستهدفة موضحة أعلاه كهيكل مفاهيمي. لا توجد تغييرات على مسارات النظام أو APIs في هذه المرحلة. جاهز للانتقال إلى Phase 3 (الهوية الموحدة وتسجيل الدخول مرة واحدة).
