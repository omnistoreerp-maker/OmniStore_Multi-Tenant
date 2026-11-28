'use strict';

// Curated display metadata for the Unified Services Catalog.
// This manifest is SEPARATE from authorization decisions: it only provides
// human-readable display information (name, description, category, status,
// destination) for services whose visibility is decided by the server using
// existing source permissions (OmniModuleRegistry + authorization.service for
// tenant scope; platformAdmin.service + platformRegistry for platform scope).
//
// `permission` (tenant services) is an exact canonical permission string from
// backend/permissions/registry.js (REAL_PERMISSIONS). Legacy module permission
// names (e.g. viewProducts, createInvoices) are NOT used directly — they are
// mapped to their canonical equivalent only when one exists and is
// semantically appropriate for discovery. When no canonical enforceable
// discovery permission exists, `permission` is null and the service is
// withheld from non-privileged tenant roles.
//
// `platformPermission` (master services) is an exact canonical platform
// permission string from backend/permissions/platformRegistry.js
// (ALL_PLATFORM_PERMISSIONS). Master services without a verified platform
// permission mapping have `platformPermission: null` and are withheld from
// the API response until properly mapped.
//
// Internal services are never exposed to any role.
//
// Status values:
//   READY         - Verified working frontend destination, may be launched.
//                   READY requires a non-empty verified destination.
//   PARTIAL       - Preview/disabled-engine mode; show status, allow navigation
//                   only if an existing usable destination is verified.
//   BACKEND_ONLY  - Backend capability with no operational frontend service.
//                   No launch button; shown as informational only.
//   NOT_VERIFIED  - Not presented as a working service; undiscoverable to
//                   tenant users.
//
// Scope values:
//   tenant  - Company-scoped business service.
//   master  - Platform-scoped administrative service (Master only).
//   internal - Developer/diagnostics capability; never exposed to ordinary users.

const STATE_READY = 'READY';
const STATE_PARTIAL = 'PARTIAL';
const STATE_BACKEND_ONLY = 'BACKEND_ONLY';
const STATE_NOT_VERIFIED = 'NOT_VERIFIED';

const SCOPE_TENANT = 'tenant';
const SCOPE_MASTER = 'master';
const SCOPE_INTERNAL = 'internal';

// Canonical tenant services, mapped from OmniModuleRegistry module ids.
// Each entry's `permission` is the enforceable permission checked by the
// server before returning the service to the caller. Permission values are
// exact canonical strings from backend/permissions/registry.js.
// A null `permission` means no canonical enforceable discovery permission
// exists for that service; it is withheld from non-privileged roles.
const TENANT_SERVICES = [
  {
    id: 'dashboard',
    name: { ar: 'لوحة القيادة', en: 'Dashboard' },
    description: {
      ar: 'نظرة عامة على مؤشرات الأداء الرئيسية والتقارير اليومية للعمل.',
      en: 'Business overview with KPI cards and daily reports.'
    },
    category: 'overview',
    scope: SCOPE_TENANT,
    permission: 'dashboard.view',
    destination: 'index.html#dashboard',
    state: STATE_READY,
    source: 'services/modulePlatform/moduleRegistry.js:20-31'
  },
  {
    id: 'products',
    name: { ar: 'المنتجات', en: 'Products' },
    description: {
      ar: 'أصناف المخزون، التصنيفات والماركات، والبحث بالسيريال.',
      en: 'Inventory items, categories and brands, and serial search.'
    },
    category: 'inventory',
    scope: SCOPE_TENANT,
    permission: 'products.view',
    destination: 'index.html#products',
    state: STATE_READY,
    source: 'services/modulePlatform/moduleRegistry.js:32-41'
  },
  {
    id: 'customers',
    name: { ar: 'العملاء', en: 'Customers' },
    description: {
      ar: 'بيانات العملاء، حسابات العملاء، كشف الحساب، CRM، والرسائل الجماعية.',
      en: 'Customer data, accounts, statements, CRM, and broadcast messages.'
    },
    category: 'sales',
    scope: SCOPE_TENANT,
    permission: 'customers.view',
    destination: 'index.html#customers',
    state: STATE_READY,
    source: 'services/modulePlatform/moduleRegistry.js:43-54'
  },
  {
    id: 'suppliers',
    name: { ar: 'الموردون', en: 'Suppliers' },
    description: {
      ar: 'بيانات الموردين وحسابات الموردين.',
      en: 'Supplier data and supplier accounts.'
    },
    category: 'inventory',
    scope: SCOPE_TENANT,
    permission: 'suppliers.view',
    destination: 'index.html#suppliers',
    state: STATE_PARTIAL,
    source: 'services/modulePlatform/moduleRegistry.js:56-63'
  },
  {
    id: 'inventory',
    name: { ar: 'المخزون', en: 'Inventory' },
    description: {
      ar: 'المخازن، الجرد الكامل، تحويل المخزن، وحركة المخزون.',
      en: 'Warehouses, full stock count, stock transfers, and inventory movements.'
    },
    category: 'inventory',
    scope: SCOPE_TENANT,
    permission: 'inventory.view',
    destination: 'index.html#inventory',
    state: STATE_READY,
    source: 'services/modulePlatform/moduleRegistry.js:65-76'
  },
  {
    id: 'purchases',
    name: { ar: 'المشتريات', en: 'Purchases' },
    description: {
      ar: 'فواتير المشتريات.',
      en: 'Purchase invoices.'
    },
    category: 'inventory',
    scope: SCOPE_TENANT,
    permission: 'purchases.view',
    destination: 'index.html#purchases',
    state: STATE_PARTIAL,
    source: 'services/modulePlatform/moduleRegistry.js:77-81'
  },
  {
    id: 'sales',
    name: { ar: 'نقطة البيع (POS)', en: 'Sales (POS)' },
    description: {
      ar: 'نقطة البيع، أرشيف الفواتير، المرتجعات، وعروض الأسعار.',
      en: 'Point of sale, invoice archive, returns, and quotations.'
    },
    category: 'sales',
    scope: SCOPE_TENANT,
    permission: 'sales.view',
    destination: 'index.html#pos',
    state: STATE_READY,
    source: 'services/modulePlatform/moduleRegistry.js:83-96'
  },
  {
    id: 'repairs',
    name: { ar: 'إدارة الصيانة', en: 'Repairs' },
    description: {
      ar: 'إدارة أوامر الصيانة، الضمانات، والأجهزة والسيريالات.',
      en: 'Repair orders, warranties, and devices with serial numbers.'
    },
    category: 'maintenance',
    scope: SCOPE_TENANT,
    permission: null,
    destination: 'index.html#maintenance',
    state: STATE_NOT_VERIFIED,
    source: 'services/modulePlatform/moduleRegistry.js:98-108 — permission-mapping incomplete (no canonical maintenance permission)'
  },
  {
    id: 'treasury',
    name: { ar: 'الخزنة', en: 'Treasury' },
    description: {
      ar: 'رصيد الخزنة، سندات القبض والصرف، المصروفات، وتحويلات الخزينة.',
      en: 'Treasury balance, receipt/payment vouchers, expenses, and transfers.'
    },
    category: 'finance',
    scope: SCOPE_TENANT,
    permission: 'treasury.view',
    destination: 'index.html#treasury',
    state: STATE_READY,
    source: 'services/modulePlatform/moduleRegistry.js:110-120'
  },
  {
    id: 'reports',
    name: { ar: 'التقارير', en: 'Reports' },
    description: {
      ar: 'تقرير المبيعات، تحليلات المبيعات، أفضل المنتجات، وتحليل المخزون.',
      en: 'Sales reports, sales analytics, top products, and inventory analysis.'
    },
    category: 'reports',
    scope: SCOPE_TENANT,
    permission: 'reports.view',
    destination: 'index.html#reports',
    state: STATE_PARTIAL,
    source: 'services/modulePlatform/moduleRegistry.js:122-137'
  },
  {
    id: 'accounting_core',
    name: { ar: 'مركز المراجعة المحاسبية', en: 'Accounting Core Safety Layer' },
    description: {
      ar: 'مراجعة محاسبية في وضع المحاكاة (قراءة فقط).',
      en: 'Accounting audit center in simulation (read-only) mode.'
    },
    category: 'finance',
    scope: SCOPE_TENANT,
    permission: null,
    destination: 'index.html#accounting-audit',
    state: STATE_PARTIAL,
    source: 'services/modulePlatform/moduleRegistry.js:139-144 — permission-mapping incomplete (no canonical accounting discovery permission)'
  },
  {
    id: 'accounting_rules',
    name: { ar: 'إعدادات وقواعد المحاسبة', en: 'Accounting Rules Engine' },
    description: {
      ar: 'محاكي القواعد المحاسبية (معاينة فقط).',
      en: 'Accounting rules simulator (preview only).'
    },
    category: 'finance',
    scope: SCOPE_TENANT,
    permission: null,
    destination: 'index.html#accounting-configuration',
    state: STATE_PARTIAL,
    source: 'services/modulePlatform/moduleRegistry.js:146-151 — permission-mapping incomplete (no canonical accounting discovery permission)'
  },
  {
    id: 'notifications',
    name: { ar: 'مركز التنبيهات', en: 'Notifications' },
    description: {
      ar: 'تنبيهات المخزون المنخفض والفواتير المتأخرة.',
      en: 'Low stock and overdue invoice alerts.'
    },
    category: 'admin',
    scope: SCOPE_TENANT,
    permission: null,
    destination: 'index.html#alerts-center',
    state: STATE_BACKEND_ONLY,
    source: 'services/modulePlatform/moduleRegistry.js:153-157 — permission-mapping incomplete (no canonical alerts permission)'
  },
  {
    id: 'tools',
    name: { ar: 'أدوات مفيدة', en: 'Utilities' },
    description: {
      ar: 'أداة Catch Number.',
      en: 'Catch Number utility.'
    },
    category: 'admin',
    scope: SCOPE_TENANT,
    permission: null,
    destination: 'index.html#cathnumber',
    state: STATE_BACKEND_ONLY,
    source: 'services/modulePlatform/moduleRegistry.js:159-163 — permission-mapping incomplete (no canonical serials permission)'
  },
  {
    id: 'hr',
    name: { ar: 'إدارة HR', en: 'Human Resources' },
    description: {
      ar: 'إدارة الموارد البشرية، قائمة الموظفين، تقرير الأداء، والشركاء.',
      en: 'HR management, employee list, performance reports, and partners.'
    },
    category: 'hr',
    scope: SCOPE_TENANT,
    permission: 'employees.view',
    destination: 'index.html#hr',
    state: STATE_PARTIAL,
    source: 'services/modulePlatform/moduleRegistry.js:165-174'
  },
  {
    id: 'identity',
    name: { ar: 'المستخدمون والصلاحيات', en: 'Users & Permissions' },
    description: {
      ar: 'إدارة المستخدمين والصلاحيات.',
      en: 'User and permission management.'
    },
    category: 'admin',
    scope: SCOPE_TENANT,
    permission: 'users.view',
    destination: 'index.html#users',
    state: STATE_READY,
    source: 'services/modulePlatform/moduleRegistry.js:176-180'
  },
  {
    id: 'governance',
    name: { ar: 'التدقيق وسير العمل', en: 'Audit & Workflow' },
    description: {
      ar: 'سجل العمليات، مسار التدقيق، ومركز سير العمل.',
      en: 'Activity log, audit trail, and workflow center.'
    },
    category: 'admin',
    scope: SCOPE_TENANT,
    permission: 'audit.view',
    destination: 'index.html#audit',
    state: STATE_READY,
    source: 'services/modulePlatform/moduleRegistry.js:182-190'
  },
  {
    id: 'automation',
    name: { ar: 'مركز الأتمتة', en: 'Automation' },
    description: {
      ar: 'مركز الأتمتة.',
      en: 'Automation center.'
    },
    category: 'integrations',
    scope: SCOPE_TENANT,
    permission: null,
    destination: 'index.html#automation',
    state: STATE_BACKEND_ONLY,
    source: 'services/modulePlatform/moduleRegistry.js:192-196 — permission-mapping incomplete (no canonical automation permission)'
  },
  {
    id: 'branches',
    name: { ar: 'الفروع', en: 'Branches' },
    description: {
      ar: 'إدارة الفروع.',
      en: 'Branch management.'
    },
    category: 'admin',
    scope: SCOPE_TENANT,
    permission: null,
    destination: 'index.html#branches',
    state: STATE_BACKEND_ONLY,
    source: 'services/modulePlatform/moduleRegistry.js:198-202 — permission-mapping incomplete (no canonical branches permission)'
  },
  {
    id: 'integrations',
    name: { ar: 'مركز التكاملات', en: 'Integrations' },
    description: {
      ar: 'مركز التكاملات.',
      en: 'Integrations center.'
    },
    category: 'integrations',
    scope: SCOPE_TENANT,
    permission: null,
    destination: 'index.html#integrations',
    state: STATE_BACKEND_ONLY,
    source: 'services/modulePlatform/moduleRegistry.js:204-208 — permission-mapping incomplete (no canonical integrations permission)'
  },
  {
    id: 'documents',
    name: { ar: 'مركز المستندات', en: 'Documents & Recovery' },
    description: {
      ar: 'مركز المستندات ومركز الاستعادة.',
      en: 'Documents center and recovery center.'
    },
    category: 'admin',
    scope: SCOPE_TENANT,
    permission: 'audit.view',
    destination: 'index.html#documents',
    state: STATE_BACKEND_ONLY,
    source: 'services/modulePlatform/moduleRegistry.js:210-217 — module permission viewAudit maps to canonical audit.view'
  },
  {
    id: 'backup_sync',
    name: { ar: 'النسخ الاحتياطي والمزامنة', en: 'Backup & Sync' },
    description: {
      ar: 'النسخ الاحتياطي، المزامنة، والمزامنة الحية.',
      en: 'Backup, sync, and live sync.'
    },
    category: 'admin',
    scope: SCOPE_TENANT,
    permission: 'settings.view',
    destination: 'index.html#backup',
    state: STATE_BACKEND_ONLY,
    source: 'services/modulePlatform/moduleRegistry.js:219-227 — module permission manageSettings maps to canonical settings.view for discovery'
  },
  {
    id: 'platform_tools',
    name: { ar: 'أدوات المنصة', en: 'Platform Tools' },
    description: {
      ar: 'مراقب الصحة، تشخيص Supabase، محرك الأداء، ومركز الجودة.',
      en: 'Health monitor, Supabase diagnostic, performance engine, and QA center.'
    },
    category: 'integrations',
    scope: SCOPE_TENANT,
    permission: null,
    destination: 'index.html#health',
    state: STATE_NOT_VERIFIED,
    source: 'services/modulePlatform/moduleRegistry.js:229-243 — permission-mapping incomplete (no canonical health permission)'
  },
  {
    id: 'business_marketplace',
    name: { ar: 'سوق الأعمال', en: 'Business Marketplace' },
    description: {
      ar: 'الإضافات والتكاملات التجارية.',
      en: 'Business add-ons and integrations.'
    },
    category: 'integrations',
    scope: SCOPE_TENANT,
    permission: 'settings.view',
    destination: 'index.html#business-marketplace',
    state: STATE_PARTIAL,
    source: 'services/modulePlatform/moduleRegistry.js:245-249 — module permission manageSettings maps to canonical settings.view for discovery'
  },
  {
    id: 'playstation',
    name: { ar: 'بلايستيشن', en: 'PlayStation Center' },
    description: {
      ar: 'الأجهزة، الجلسات، التسعير، والكاشير (المحرك معطل افتراضيًا).',
      en: 'Devices, sessions, pricing, and cashier (engine disabled by default).'
    },
    category: 'entertainment',
    scope: SCOPE_TENANT,
    permission: null,
    destination: 'index.html#playstation',
    state: STATE_PARTIAL,
    source: 'services/modulePlatform/moduleRegistry.js:251-255 — permission-mapping incomplete (entertainment service, no canonical discovery permission)'
  },
  {
    id: 'car_rental',
    name: { ar: 'تأجير السيارات', en: 'Car Rental' },
    description: {
      ar: 'تأجير السيارات (المحرك معطل افتراضيًا).',
      en: 'Car rental (engine disabled by default).'
    },
    category: 'entertainment',
    scope: SCOPE_TENANT,
    permission: null,
    destination: 'index.html#car-rental',
    state: STATE_PARTIAL,
    source: 'services/modulePlatform/moduleRegistry.js:257-261 — permission-mapping incomplete (entertainment service, no canonical discovery permission)'
  },
  {
    id: 'education',
    name: { ar: 'حزمة التعليم', en: 'Education' },
    description: {
      ar: 'المراكز التعليمية، المعلمون، الطلاب، والتسجيلات.',
      en: 'Education centers, teachers, students, and enrollments.'
    },
    category: 'education',
    scope: SCOPE_TENANT,
    permission: 'education.centers.view',
    destination: 'index.html#education',
    state: STATE_PARTIAL,
    source: 'services/modulePlatform/moduleRegistry.js:263-276'
  },
  {
    id: 'student_services',
    name: { ar: 'حزمة خدمات الطلاب', en: 'Student Services Pack' },
    description: {
      ar: 'الأسعار، الطلبات، الكارتات، والإعدادات.',
      en: 'Rates, orders, passes, and settings.'
    },
    category: 'education',
    scope: SCOPE_TENANT,
    permission: 'settings.view',
    destination: 'student.html',
    state: STATE_PARTIAL,
    source: 'services/modulePlatform/moduleRegistry.js:278-283 — module declares settings.view and settings.edit; settings.view used for discovery'
  },
  {
    id: 'settings',
    name: { ar: 'الإعدادات', en: 'Settings' },
    description: {
      ar: 'إعدادات OmniStore وتطبيق OmniStore ERP (PWA).',
      en: 'OmniStore settings and OmniStore ERP PWA application.'
    },
    category: 'admin',
    scope: SCOPE_TENANT,
    permission: 'settings.view',
    destination: 'index.html#settings',
    state: STATE_READY,
    source: 'services/modulePlatform/moduleRegistry.js:284-292'
  }
];

// Master/platform services from navigationBuilder.js MASTER_NAV groups.
// platform_master, platform_dashboard, and platform_overview are aliases for
// the same platform dashboard surface (platform.html, platform.dashboard.view).
// They are consolidated into a single canonical catalog service
// (platform_dashboard). Navigation aliases are NOT counted as separate services.
const MASTER_SERVICES = [
  {
    id: 'platform_dashboard',
    name: { ar: 'لوحة تحكم المنصة', en: 'Platform Dashboard' },
    description: {
      ar: 'نظرة عامة على المنصة وصحتها.',
      en: 'Platform overview and health.'
    },
    category: 'platform',
    scope: SCOPE_MASTER,
    platformPermission: 'platform.dashboard.view',
    destination: 'platform.html',
    state: STATE_PARTIAL,
    source: 'services/modulePlatform/navigationBuilder.js (MASTER_NAV dashboard group)'
  },
  {
    id: 'platform_companies',
    name: { ar: 'إدارة الشركات', en: 'Company Management' },
    description: {
      ar: 'إدارة جميع عملاء المنصة.',
      en: 'Manage all platform customer companies.'
    },
    category: 'platform',
    scope: SCOPE_MASTER,
    platformPermission: 'platform.companies.view',
    destination: null,
    state: STATE_NOT_VERIFIED,
    source: 'services/modulePlatform/navigationBuilder.js:49-61 (MASTER_NAV)'
  },
  {
    id: 'platform_users',
    name: { ar: 'المستخدمون والجلسات', en: 'Users & Sessions' },
    description: {
      ar: 'إدارة المستخدمين والجلسات على مستوى المنصة.',
      en: 'Platform-level user and session management.'
    },
    category: 'platform',
    scope: SCOPE_MASTER,
    platformPermission: 'platform.users.view',
    destination: null,
    state: STATE_NOT_VERIFIED,
    source: 'services/modulePlatform/navigationBuilder.js:62'
  },
  {
    id: 'platform_licenses',
    name: { ar: 'التراخيص والاشتراكات', en: 'Licenses & Subscriptions' },
    description: {
      ar: 'خطط الاشتراك، تراخيص المنصة، وإحصائيات العملاء.',
      en: 'Subscription plans, platform licenses, and customer statistics.'
    },
    category: 'platform',
    scope: SCOPE_MASTER,
    platformPermission: 'platform.licenses.view',
    destination: null,
    state: STATE_NOT_VERIFIED,
    source: 'services/modulePlatform/navigationBuilder.js:63-70 (MASTER_NAV)'
  },
  {
    id: 'platform_integrations',
    name: { ar: 'تكاملات المنصة', en: 'Platform Integrations' },
    description: {
      ar: 'تشخيص Supabase، صحة Supabase، وإعداد المخطط.',
      en: 'Supabase diagnostic, health, and schema setup.'
    },
    category: 'platform',
    scope: SCOPE_MASTER,
    platformPermission: 'platform.integrations.view',
    destination: null,
    state: STATE_NOT_VERIFIED,
    source: 'services/modulePlatform/navigationBuilder.js:71-77 (MASTER_NAV)'
  },
  {
    id: 'platform_database',
    name: { ar: 'قاعدة البيانات', en: 'Platform Database' },
    description: {
      ar: 'مثبّت قاعدة البيانات، تقدم الترحيل، وتقارير التحقق.',
      en: 'Database installer, migration progress, and verification reports.'
    },
    category: 'platform',
    scope: SCOPE_MASTER,
    platformPermission: null,
    destination: null,
    state: STATE_NOT_VERIFIED,
    source: 'services/modulePlatform/navigationBuilder.js:78-81 (MASTER_NAV) — permission-mapping incomplete'
  },
  {
    id: 'platform_backups',
    name: { ar: 'النسخ الاحتياطي والاستعادة', en: 'Platform Backups' },
    description: {
      ar: 'مركز النسخ الاحتياطي، الاستعادة، ومستعرض اللقطات.',
      en: 'Backup center, recovery platform, and snapshot browser.'
    },
    category: 'platform',
    scope: SCOPE_MASTER,
    platformPermission: null,
    destination: null,
    state: STATE_NOT_VERIFIED,
    source: 'services/modulePlatform/navigationBuilder.js:82-92 (MASTER_NAV) — permission-mapping incomplete'
  },
  {
    id: 'platform_audit',
    name: { ar: 'الأمان والتدقيق', en: 'Platform Audit' },
    description: {
      ar: 'لوحة التدقيق، لوحة الأمان، وفحص الأمان.',
      en: 'Audit dashboard, security dashboard, and security scan.'
    },
    category: 'platform',
    scope: SCOPE_MASTER,
    platformPermission: 'platform.audit.view',
    destination: null,
    state: STATE_NOT_VERIFIED,
    source: 'services/modulePlatform/navigationBuilder.js:93-98 (MASTER_NAV) — NOT_VERIFIED: no verified frontend destination'
  }
];

// Internal-only capabilities from navigationBuilder.js INTERNAL_NAV.
// These have roles: [] in the source and are NOT exposed to any role,
// including Master, unless a specific existing internal authorization
// mechanism explicitly permits access.
const INTERNAL_SERVICES = [
  {
    id: 'internal_go_live',
    name: { ar: 'مركز الإطلاق المباشر', en: 'Go Live Center' },
    description: {
      ar: 'مركز الإطلاق، وضع الإنتاج، وتحقق الإنتاج.',
      en: 'Go-live center, production mode, and production verification.'
    },
    category: 'internal',
    scope: SCOPE_INTERNAL,
    permission: null,
    destination: null,
    state: STATE_NOT_VERIFIED,
    source: 'services/modulePlatform/navigationBuilder.js:132-139 (INTERNAL_NAV)'
  },
  {
    id: 'internal_uat',
    name: { ar: 'تجربة وقبول العميل', en: 'UAT Center' },
    description: {
      ar: 'تجربة وقبول العميل، وقائمة مراجعة القبول.',
      en: 'Customer acceptance testing and acceptance checklist.'
    },
    category: 'internal',
    scope: SCOPE_INTERNAL,
    permission: null,
    destination: null,
    state: STATE_NOT_VERIFIED,
    source: 'services/modulePlatform/navigationBuilder.js:144-145 (INTERNAL_NAV)'
  },
  {
    id: 'internal_auth_center',
    name: { ar: 'مركز المصادقة', en: 'Authentication Center' },
    description: {
      ar: 'الأدوار، الصلاحيات، وم Preview تسجيل الدخول.',
      en: 'Roles, permissions, and login preview.'
    },
    category: 'internal',
    scope: SCOPE_INTERNAL,
    permission: null,
    destination: null,
    state: STATE_NOT_VERIFIED,
    source: 'services/modulePlatform/navigationBuilder.js:171-177 (INTERNAL_NAV)'
  },
  {
    id: 'internal_tenant_center',
    name: { ar: 'مركز المستأجر', en: 'Tenant Center' },
    description: {
      ar: 'مساحة العمل الحالية، صحة متعددة المستأجرين.',
      en: 'Current workspace and multi-tenant health.'
    },
    category: 'internal',
    scope: SCOPE_INTERNAL,
    permission: null,
    destination: null,
    state: STATE_NOT_VERIFIED,
    source: 'services/modulePlatform/navigationBuilder.js:178-181 (INTERNAL_NAV)'
  },
  {
    id: 'internal_performance_center',
    name: { ar: 'لوحة الأداء', en: 'Performance Center' },
    description: {
      ar: 'لوحة الأداء، استخدام الذاكرة، ومحلل التخزين.',
      en: 'Performance dashboard, memory usage, and storage analyzer.'
    },
    category: 'internal',
    scope: SCOPE_INTERNAL,
    permission: null,
    destination: null,
    state: STATE_NOT_VERIFIED,
    source: 'services/modulePlatform/navigationBuilder.js:189-192 (INTERNAL_NAV)'
  },
  {
    id: 'internal_qa_center',
    name: { ar: 'مركز الجودة', en: 'QA Center' },
    description: {
      ar: 'مركز الجودة، مركز التدريب، وقائمة الإنتاج.',
      en: 'QA center, training center, and production checklist.'
    },
    category: 'internal',
    scope: SCOPE_INTERNAL,
    permission: null,
    destination: null,
    state: STATE_NOT_VERIFIED,
    source: 'services/modulePlatform/navigationBuilder.js:200-201 (INTERNAL_NAV)'
  },
  {
    id: 'internal_command_center',
    name: { ar: 'مركز القيادة', en: 'Command Center' },
    description: {
      ar: 'مركز القيادة، مركز التحكم، وقائمة الإنتاج.',
      en: 'Command center, ops hub, and production checklist.'
    },
    category: 'internal',
    scope: SCOPE_INTERNAL,
    permission: null,
    destination: null,
    state: STATE_NOT_VERIFIED,
    source: 'services/modulePlatform/navigationBuilder.js:202-204 (INTERNAL_NAV)'
  }
];

// All services consolidated
const ALL_SERVICES = [...TENANT_SERVICES, ...MASTER_SERVICES, ...INTERNAL_SERVICES];

// Build lookup by id
const BY_ID = {};
ALL_SERVICES.forEach(s => { BY_ID[s.id] = s; });

function getServiceMetadata(id) {
  return BY_ID[id] || null;
}

function getAllServices() {
  return ALL_SERVICES.slice();
}

function getTenantServices() {
  return TENANT_SERVICES.slice();
}

function getMasterServices() {
  return MASTER_SERVICES.slice();
}

function getInternalServices() {
  return INTERNAL_SERVICES.slice();
}

function counts() {
  return {
    tenant: TENANT_SERVICES.length,
    master: MASTER_SERVICES.length,
    internal: INTERNAL_SERVICES.length,
    total: ALL_SERVICES.length
  };
}

function statusCounts() {
  const counts = {};
  ALL_SERVICES.forEach(s => { counts[s.state] = (counts[s.state] || 0) + 1; });
  return counts;
}

module.exports = {
  STATE_READY,
  STATE_PARTIAL,
  STATE_BACKEND_ONLY,
  STATE_NOT_VERIFIED,
  SCOPE_TENANT,
  SCOPE_MASTER,
  SCOPE_INTERNAL,
  TENANT_SERVICES: Object.freeze(TENANT_SERVICES.map(s => Object.freeze(s))),
  MASTER_SERVICES: Object.freeze(MASTER_SERVICES.map(s => Object.freeze(s))),
  INTERNAL_SERVICES: Object.freeze(INTERNAL_SERVICES.map(s => Object.freeze(s))),
  ALL_SERVICES: Object.freeze(ALL_SERVICES.map(s => Object.freeze(s))),
  BY_ID: Object.freeze(BY_ID),
  getServiceMetadata,
  getAllServices,
  getTenantServices,
  getMasterServices,
  getInternalServices,
  counts,
  statusCounts
};
