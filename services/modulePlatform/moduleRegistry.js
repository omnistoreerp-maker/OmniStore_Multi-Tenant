(function (root) {
  'use strict';

  const allBusinesses = '*';
  const nav = (route, name, icon, group) => ({ route, name, icon, group });
  const module = config => Object.freeze({
    permissions: [],
    businessTypes: allBusinesses,
    dependencies: [],
    enabled: true,
    defaultSettings: {},
    navigation: [],
    widgets: [],
    ...config
  });

  const registry = {
    dashboard: module({
      id: 'dashboard', name: 'Dashboard', icon: '📊', route: 'dashboard',
      permissions: ['viewDashboard'],
      navigation: [
        nav('dashboard', 'لوحة التحكم', '🏠', 'main'),
        nav('daily', 'التقرير اليومي', '📅', 'main'),
        nav('smart-business', 'Smart Business', '🧠', 'main'),
        nav('ai-owner', 'مساعد صاحب النشاط', '🤖', 'main')
      ],
      widgets: [{ id: 'dashboard-home', label: 'لوحة التحكم', icon: '📊', route: 'dashboard' }],
      defaultSettings: { showQuickActions: true, compactWidgets: false }
    }),
    products: module({
      id: 'products', name: 'Products', icon: '📦', route: 'products',
      permissions: ['viewProducts'],
      navigation: [
        nav('products', 'الأصناف', '📋', 'inventory'),
        nav('master-data', 'التصنيفات والماركات', '🗂️', 'inventory'),
        nav('serialsearch', 'بحث بالسيريال', '🔍', 'main')
      ],
      widgets: [{ id: 'products-total', label: 'المنتجات', icon: '📦', route: 'products', sourceElement: 'ds-products' }],
      defaultSettings: { tablePageSize: 100, showLowStock: true }
    }),
    customers: module({
      id: 'customers', name: 'Customers', icon: '👤', route: 'customers',
      permissions: ['viewCustomers'],
      navigation: [
        nav('customers', 'العملاء', '👤', 'customers'),
        nav('customer-accounts', 'حسابات العملاء', '💳', 'customers'),
        nav('accountstatement', 'كشف الحساب', '📋', 'customers'),
        nav('crm', 'CRM والمتابعة', '🧩', 'customers'),
        nav('broadcast', 'رسائل جماعية', '📢', 'customers')
      ],
      defaultSettings: { loyaltyEnabled: true, requirePhone: false }
    }),
    suppliers: module({
      id: 'suppliers', name: 'Suppliers', icon: '🤝', route: 'suppliers',
      permissions: ['viewSuppliers'],
      navigation: [
        nav('suppliers', 'الموردون', '🤝', 'customers'),
        nav('supplier-accounts', 'حسابات الموردين', '🏦', 'customers')
      ],
      defaultSettings: { requirePhone: false }
    }),
    inventory: module({
      id: 'inventory', name: 'Inventory', icon: '🏭', route: 'warehouses',
      permissions: ['viewInventory'], dependencies: ['products'],
      navigation: [
        nav('warehouses', 'المخازن', '🏭', 'inventory'),
        nav('stockcount', 'الجرد الكامل', '📊', 'inventory'),
        nav('stocktransfer', 'تحويل مخزن', '🔀', 'inventory'),
        nav('stockmovement', 'حركة المخزون', '🔄', 'inventory')
      ],
      widgets: [{ id: 'inventory-low', label: 'مخزون منخفض', icon: '⚠️', route: 'products', sourceElement: 'ds-lowstock' }],
      defaultSettings: { multiWarehouse: true, negativeStock: false }
    }),
    purchases: module({
      id: 'purchases', name: 'Purchases', icon: '🛍️', route: 'purchases',
      permissions: ['viewPurchases'], dependencies: ['products', 'suppliers', 'inventory'],
      navigation: [nav('purchases', 'فواتير المشتريات', '🛍️', 'inventory')],
      defaultSettings: { defaultPayment: 'cash', requireSupplier: false }
    }),
    sales: module({
      id: 'sales', name: 'Sales', icon: '🛒', route: 'pos',
      permissions: ['createInvoices'], dependencies: ['products', 'customers'],
      navigation: [
        nav('pos', 'نقطة البيع (POS)', '💳', 'sales'),
        nav('invoices', 'أرشيف الفواتير', '🧾', 'sales'),
        nav('amanat', 'الأمانات المفتوحة', '🟠', 'sales'),
        nav('installments', 'التقسيط', '📆', 'sales'),
        nav('returns', 'المرتجعات', '↩️', 'sales'),
        nav('quotations', 'عروض الأسعار', '🏷️', 'sales'),
        nav('rep-mobile', 'موبايل المندوب', '📱', 'sales')
      ],
      widgets: [{ id: 'sales-today', label: 'مبيعات اليوم', icon: '💰', route: 'invoices', sourceElement: 'ds-sales' }],
      defaultSettings: { allowDiscount: true, defaultPayment: 'cash' }
    }),
    repairs: module({
      id: 'repairs', name: 'Repairs', icon: '🔧', route: 'maintenance',
      permissions: ['viewMaintenance'], dependencies: ['products', 'customers'],
      businessTypes: ['computer_shop', 'mobile_shop', 'electronics'],
      navigation: [
        nav('maintenance', 'إدارة الصيانة', '🔧', 'maintenance'),
        nav('warranty', 'الضمانات', '🛡️', 'maintenance'),
        nav('devices', 'الأجهزة والسيريالات', '💻', 'maintenance')
      ],
      widgets: [{ id: 'repairs-open', label: 'صيانة قيد التنفيذ', icon: '🔧', route: 'maintenance', sourceElement: 'ds-maint' }],
      defaultSettings: { warrantyEnabled: true, deviceTracking: true }
    }),
    treasury: module({
      id: 'treasury', name: 'Treasury', icon: '🏦', route: 'treasury',
      permissions: ['viewFinancial'], dependencies: ['sales'],
      navigation: [
        nav('treasury', 'الخزنة', '🏦', 'reports'),
        nav('vouchers', 'سندات القبض والصرف', '📄', 'reports'),
        nav('expenses', 'المصروفات', '💸', 'reports')
      ],
      widgets: [{ id: 'treasury-balance', label: 'رصيد الخزنة', icon: '🏦', route: 'treasury', sourceElement: 'ds-treasury' }],
      defaultSettings: { showBalances: true }
    }),
    reports: module({
      id: 'reports', name: 'Reports', icon: '📈', route: 'reports',
      permissions: ['viewReports'], dependencies: ['sales'],
      navigation: [
        nav('reports', 'تقرير المبيعات', '📊', 'reports'),
        nav('analytics', 'تحليلات المبيعات', '📊', 'analytics'),
        nav('top-products', 'أفضل المنتجات', '⭐', 'analytics'),
        nav('inventory-analysis', 'تحليل المخزون', '🎯', 'analytics'),
        nav('forecast', 'Forecast & Reorder', '🔮', 'analytics'),
        nav('financial', 'الأرباح والخسائر', '💰', 'reports'),
        nav('financial-center', 'المركز المالي', '🏛️', 'reports'),
        nav('fixed-assets', 'الأصول الثابتة', '🏢', 'reports'),
        nav('capital-partners', 'شركاء رأس المال', '🤝', 'reports')
      ],
      widgets: [{ id: 'reports-profit', label: 'أرباح اليوم', icon: '📈', route: 'reports', sourceElement: 'ds-profit' }],
      defaultSettings: { defaultPeriod: 'month', exportEnabled: true }
    }),
    accounting_core: module({
      id: 'accounting_core', name: 'Accounting Core Safety Layer', icon: '🧮', route: 'accounting-audit',
      permissions: ['viewFinancial'],
      navigation: [nav('accounting-audit', 'مركز المراجعة المحاسبية', '🧮', 'reports')],
      widgets: [{ id: 'accounting-audit', label: 'مراجعة محاسبية', icon: '🧮', route: 'accounting-audit' }],
      defaultSettings: { mode: 'simulation-read-only', tolerance: 0.01, persistJournals: false }
    }),
    accounting_rules: module({
      id: 'accounting_rules', name: 'Accounting Rules Engine', icon: '⚙️', route: 'accounting-configuration',
      permissions: ['viewFinancial'], dependencies: ['accounting_core'],
      navigation: [nav('accounting-configuration', 'إعدادات وقواعد المحاسبة', '⚙️', 'reports')],
      widgets: [{ id: 'accounting-rules', label: 'محاكي القواعد المحاسبية', icon: '⚙️', route: 'accounting-configuration' }],
      defaultSettings: { previewOnly: true, persistJournals: false, validationEnabled: true }
    }),
    notifications: module({
      id: 'notifications', name: 'Notifications', icon: '🔔', route: 'alerts-center',
      permissions: ['viewAlerts'],
      navigation: [nav('alerts-center', 'مركز التنبيهات', '🚨', 'admin')],
      defaultSettings: { lowStock: true, overdueInvoices: true }
    }),
    tools: module({
      id: 'tools', name: 'Utilities', icon: '🧰', route: 'cathnumber',
      permissions: ['viewSerials'],
      navigation: [nav('cathnumber', 'Catch Number', '🔢', 'main')],
      defaultSettings: { catchNumberEnabled: true }
    }),
    hr: module({
      id: 'hr', name: 'Human Resources', icon: '👨‍💼', route: 'hr',
      permissions: ['manageEmployees'],
      navigation: [
        nav('hr', 'إدارة HR', '🧑‍💼', 'employees'),
        nav('employees', 'قائمة الموظفين', '👤', 'employees'),
        nav('employee-performance', 'تقرير الأداء', '📈', 'employees'),
        nav('partners', 'الشركاء', '🤝', 'employees')
      ],
      defaultSettings: { attendanceEnabled: true, payrollEnabled: true }
    }),
    identity: module({
      id: 'identity', name: 'Users & Permissions', icon: '🔐', route: 'users',
      permissions: ['manageUsers'],
      navigation: [nav('users', 'المستخدمون والصلاحيات', '🔐', 'admin')],
      defaultSettings: { allowCustomRoles: true }
    }),
    governance: module({
      id: 'governance', name: 'Audit & Workflow', icon: '🧾', route: 'audit',
      permissions: ['viewAudit'],
      navigation: [
        nav('activitylog', 'سجل العمليات', '📋', 'admin'),
        nav('audit', 'Audit Trail', '🧾', 'admin'),
        nav('approvals', 'Workflow Center', '📋', 'admin')
      ],
      defaultSettings: { auditRetentionDays: 365, approvalsEnabled: true }
    }),
    automation: module({
      id: 'automation', name: 'Automation', icon: '⚡', route: 'automation',
      permissions: ['viewAutomationCenter'],
      navigation: [nav('automation', 'مركز الأتمتة', '⚡', 'admin')],
      defaultSettings: { engineEnabled: true }
    }),
    branches: module({
      id: 'branches', name: 'Branches', icon: '🏬', route: 'branches',
      permissions: ['viewBranches'],
      navigation: [nav('branches', 'الفروع', '🏬', 'admin')],
      defaultSettings: { transfersEnabled: true }
    }),
    integrations: module({
      id: 'integrations', name: 'Integrations', icon: '🔌', route: 'integrations',
      permissions: ['manageIntegrations'],
      navigation: [nav('integrations', 'مركز التكاملات', '🔌', 'admin')],
      defaultSettings: { connectorsEnabled: true }
    }),
    documents: module({
      id: 'documents', name: 'Documents & Recovery', icon: '📂', route: 'documents',
      permissions: ['viewAudit'],
      navigation: [
        nav('documents', 'مركز المستندات', '📂', 'admin'),
        nav('recovery', 'مركز الاستعادة', '⏪', 'admin')
      ],
      defaultSettings: { archiveEnabled: true, recoveryEnabled: true }
    }),
    backup_sync: module({
      id: 'backup_sync', name: 'Backup & Sync', icon: '💾', route: 'backup',
      permissions: ['manageSettings'],
      navigation: [
        nav('backup', 'النسخ الاحتياطي', '💾', 'admin'),
        nav('sync', 'المزامنة', '🔄', 'admin'),
        nav('live-sync', 'المزامنة الحية', '🌐', 'admin')
      ],
      defaultSettings: { localBackupEnabled: true }
    }),
    platform_tools: module({
      id: 'platform_tools', name: 'Platform Tools', icon: '🧩', route: 'health',
      permissions: ['viewHealth'],
      navigation: [
        nav('health', 'Health Monitor', '🩺', 'admin'),
        nav('supabase-diagnostic', 'Supabase Diagnostic', '☁️', 'admin'),
        nav('performance-engine', 'محرك الأداء', '⚡', 'admin'),
        nav('qa-center', 'مركز الجودة', '✅', 'admin'),
        nav('training-center', 'مركز التدريب', '🎓', 'admin'),
        nav('production', 'Production Checklist', '✅', 'admin'),
        nav('plugins', 'مركز الإضافات', '🧩', 'admin'),
        nav('command-center', 'مركز القيادة', '🛰️', 'admin'),
        nav('opshub', 'مركز التحكم', '🧠', 'admin')
      ],
      defaultSettings: { diagnosticsEnabled: true }
    }),
    business_marketplace: module({
      id: 'business_marketplace', name: 'Business Marketplace', icon: '🏪', route: 'business-marketplace',
      permissions: ['manageSettings'], dependencies: ['settings'],
      navigation: [nav('business-marketplace', 'Business Marketplace', '🏪', 'admin')],
      defaultSettings: { showBundled: true, allowUninstall: true }
    }),
    settings: module({
      id: 'settings', name: 'Settings', icon: '⚙️', route: 'settings',
      permissions: ['manageSettings'],
      navigation: [
        nav('settings', 'OmniStore Settings', '⚙️', 'admin'),
        nav('pwa', 'تطبيق OmniStore ERP', '📲', 'admin')
      ],
      defaultSettings: { advancedMode: false }
    })
  };

  root.OmniModuleRegistry = Object.freeze(registry);
})(typeof globalThis !== 'undefined' ? globalThis : window);
