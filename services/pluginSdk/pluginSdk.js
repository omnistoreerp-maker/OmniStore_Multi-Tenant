(function (root) {
  'use strict';

  const STORAGE_KEY = 'omnistore_business_plugins_v1';
  const PLATFORM_VERSION = '5.0.0';
  const plugins = new Map();
  let activeIds = new Set();

  const commonEntities = {
    customer: [
      { key: 'customer_type', label: 'Customer Type', type: 'select', options: ['individual', 'company'] },
      { key: 'tax_number', label: 'Tax Number', type: 'text' }
    ],
    supplier: [
      { key: 'supplier_code', label: 'Supplier Code', type: 'text' },
      { key: 'payment_terms', label: 'Payment Terms', type: 'textarea' }
    ],
    invoice: [
      { key: 'reference', label: 'Reference', type: 'text' },
      { key: 'due_date', label: 'Due Date', type: 'date' }
    ],
    purchase: [
      { key: 'supplier_reference', label: 'Supplier Reference', type: 'text' },
      { key: 'expected_date', label: 'Expected Date', type: 'date' }
    ],
    sale: [
      { key: 'sales_channel', label: 'Sales Channel', type: 'select', options: ['store', 'online', 'phone', 'other'] }
    ]
  };

  function readState() {
    try {
      const parsed = JSON.parse(root.localStorage?.getItem(STORAGE_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) { return {}; }
  }

  function writeState(state) {
    root.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
    return state;
  }

  function compareVersions(a, b) {
    const left = String(a || '0').split('.').map(Number);
    const right = String(b || '0').split('.').map(Number);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      const diff = (left[i] || 0) - (right[i] || 0);
      if (diff) return diff;
    }
    return 0;
  }

  function validatePlugin(plugin) {
    const errors = [];
    if (!plugin || typeof plugin !== 'object') errors.push('plugin must be an object');
    const metadata = plugin?.metadata || {};
    ['id', 'name', 'version', 'businessType'].forEach(key => {
      if (!metadata[key]) errors.push(`metadata.${key} is required`);
    });
    ['permissions', 'productSchema', 'validation', 'dashboardCards', 'reports', 'navigation', 'translations'].forEach(key => {
      if (plugin?.[key] == null) errors.push(`${key} is required`);
    });
    if (!Array.isArray(plugin?.permissions)) errors.push('permissions must be an array');
    if (!Array.isArray(plugin?.productSchema)) errors.push('productSchema must be an array');
    if (!Array.isArray(plugin?.reports)) errors.push('reports must be an array');
    if (!Array.isArray(plugin?.navigation)) errors.push('navigation must be an array');
    if (!plugin?.translations?.ar || !plugin?.translations?.en) errors.push('Arabic and English translations are required');
    return { valid: errors.length === 0, errors };
  }

  function defineBusinessPlugin(config) {
    const id = config.id;
    const icon = config.icon || '🧩';
    const name = config.name || id;
    const productSchema = config.productFields || [];
    return {
      metadata: {
        id,
        name,
        version: config.version || '1.0.0',
        description: config.description || '',
        businessType: config.businessType || id,
        aliases: [...(config.aliases || [])],
        author: config.author || 'OmniStore',
        license: config.license || 'Commercial',
        bundled: config.bundled !== false,
        minPlatformVersion: config.minPlatformVersion || '5.0.0',
        dependencies: [...(config.dependencies || [])]
      },
      loader: {
        register: config.loader?.register || (() => {}),
        boot: config.loader?.boot || (() => {}),
        shutdown: config.loader?.shutdown || (() => {})
      },
      routes: config.routes || [
        { id: `${id}.products`, route: 'products', permission: 'products.read' },
        { id: `${id}.reports`, route: 'reports', permission: 'reports.view' },
        { id: `${id}.settings`, route: 'business-plugin-settings', permission: 'plugin.settings' }
      ],
      navigation: config.sidebar || [
        { route: 'business-plugin-settings', labelKey: 'settings', icon: '⚙️', group: 'admin' }
      ],
      dashboardCards: config.dashboardCards || [
        { id: `${id}.products`, labelKey: 'products', icon, route: 'products', metric: 'product_count' }
      ],
      permissions: config.permissions || ['products.read', 'products.write', 'orders.create', 'inventory.adjust', 'reports.view', 'plugin.settings'],
      productSchema,
      entities: {
        product: productSchema,
        customer: [...commonEntities.customer, ...(config.customerFields || [])],
        supplier: [...commonEntities.supplier, ...(config.supplierFields || [])],
        invoice: [...commonEntities.invoice, ...(config.invoiceFields || [])],
        purchase: [...commonEntities.purchase, ...(config.purchaseFields || [])],
        sale: [...commonEntities.sale, ...(config.saleFields || [])]
      },
      validation: config.validation || { product: [] },
      reports: config.reports || [
        { id: `${id}.inventory`, labelKey: 'inventory_report', metric: 'product_count', route: 'reports' },
        { id: `${id}.sales`, labelKey: 'sales_report', metric: 'sales_total', route: 'reports' }
      ],
      hooks: {
        onInstall: config.hooks?.onInstall || (() => {}),
        onUninstall: config.hooks?.onUninstall || (() => {}),
        onEnable: config.hooks?.onEnable || (() => {}),
        onDisable: config.hooks?.onDisable || (() => {}),
        onBusinessActivated: config.hooks?.onBusinessActivated || (() => {})
      },
      featureFlags: {
        enabled: true,
        dynamicProducts: true,
        dynamicReports: true,
        dynamicNavigation: true,
        ...config.featureFlags
      },
      icons: { primary: icon, ...(config.icons || {}) },
      translations: {
        ar: { name, products: 'المنتجات', reports: 'التقارير', settings: 'إعدادات النشاط', inventory_report: 'تقرير المخزون', sales_report: 'تقرير المبيعات', ...(config.translations?.ar || {}) },
        en: { name, products: 'Products', reports: 'Reports', settings: 'Business Settings', inventory_report: 'Inventory Report', sales_report: 'Sales Report', ...(config.translations?.en || {}) }
      },
      sampleSettings: { enabled: true, defaultTaxRate: 0, ...(config.sampleSettings || {}) },
      masterData: {
        categories: [...(config.masterData?.categories || [])],
        brands: [...(config.masterData?.brands || [])],
        units: [...(config.masterData?.units || [])],
        tags: [...(config.masterData?.tags || [])]
      }
    };
  }

  function register(plugin) {
    const result = validatePlugin(plugin);
    if (!result.valid) throw new Error(`Invalid plugin: ${result.errors.join(', ')}`);
    const id = plugin.metadata.id;
    if (plugins.has(id)) throw new Error(`Plugin already registered: ${id}`);
    plugins.set(id, plugin);
    const state = readState();
    if (!state[id]) {
      state[id] = {
        installed: plugin.metadata.bundled !== false,
        enabled: plugin.featureFlags.enabled !== false,
        settings: { ...plugin.sampleSettings },
        installedAt: new Date().toISOString()
      };
      writeState(state);
    }
    plugin.loader.register({ sdk: api, plugin });
    return plugin;
  }

  function getPlugin(id) { return plugins.get(id) || null; }
  function listPlugins() { return [...plugins.values()]; }
  function getPluginState(id) {
    const plugin = getPlugin(id);
    if (!plugin) return null;
    const saved = readState()[id] || {};
    return {
      installed: saved.installed ?? plugin.metadata.bundled !== false,
      enabled: saved.enabled ?? plugin.featureFlags.enabled !== false,
      settings: { ...plugin.sampleSettings, ...(saved.settings || {}) },
      installedAt: saved.installedAt || null
    };
  }

  function matchesBusinessType(plugin, type) {
    return plugin.metadata.businessType === type || plugin.metadata.aliases.includes(type);
  }

  function isCompatible(plugin) {
    return compareVersions(PLATFORM_VERSION, plugin.metadata.minPlatformVersion) >= 0 &&
      plugin.metadata.dependencies.every(dep => getPluginState(dep)?.installed);
  }

  function setState(id, patch) {
    const plugin = getPlugin(id);
    if (!plugin) throw new Error(`Unknown plugin: ${id}`);
    const state = readState();
    state[id] = { ...(state[id] || {}), ...patch };
    writeState(state);
    return getPluginState(id);
  }

  function install(id) {
    const plugin = getPlugin(id);
    if (!plugin) throw new Error(`Unknown plugin: ${id}`);
    if (!isCompatible(plugin)) throw new Error('Plugin dependencies or platform version are not compatible');
    const state = setState(id, { installed: true, enabled: true, installedAt: new Date().toISOString() });
    plugin.hooks.onInstall({ sdk: api, plugin, state });
    bootActive();
    emitChange(id, 'install');
    return state;
  }

  function uninstall(id) {
    const plugin = getPlugin(id);
    if (!plugin) throw new Error(`Unknown plugin: ${id}`);
    const dependants = listPlugins().filter(item => item.metadata.dependencies.includes(id) && getPluginState(item.metadata.id)?.installed);
    if (dependants.length) throw new Error(`Required by: ${dependants.map(item => item.metadata.id).join(', ')}`);
    if (activeIds.has(id)) plugin.loader.shutdown({ sdk: api, plugin });
    root.OmniBusinessEngine?.unregisterSchema?.(plugin.metadata.businessType);
    plugin.metadata.aliases.forEach(alias => root.OmniBusinessEngine?.unregisterSchema?.(alias));
    setState(id, { installed: false, enabled: false });
    plugin.hooks.onUninstall({ sdk: api, plugin });
    activeIds.delete(id);
    emitChange(id, 'uninstall');
    return getPluginState(id);
  }

  function enable(id) {
    const plugin = getPlugin(id);
    const current = getPluginState(id);
    if (!current?.installed) return install(id);
    const state = setState(id, { enabled: true });
    plugin.hooks.onEnable({ sdk: api, plugin, state });
    bootActive();
    emitChange(id, 'enable');
    return state;
  }

  function disable(id) {
    const plugin = getPlugin(id);
    if (activeIds.has(id)) plugin.loader.shutdown({ sdk: api, plugin });
    root.OmniBusinessEngine?.unregisterSchema?.(plugin.metadata.businessType);
    plugin.metadata.aliases.forEach(alias => root.OmniBusinessEngine?.unregisterSchema?.(alias));
    const state = setState(id, { enabled: false });
    plugin.hooks.onDisable({ sdk: api, plugin, state });
    activeIds.delete(id);
    emitChange(id, 'disable');
    return state;
  }

  function getCurrentBusinessType() {
    return typeof root.getCurrentBusinessType === 'function' ? root.getCurrentBusinessType() : 'computer_shop';
  }

  function getActivePlugins() {
    const type = getCurrentBusinessType();
    return listPlugins().filter(plugin => {
      const state = getPluginState(plugin.metadata.id);
      return state?.installed && state.enabled && isCompatible(plugin) && matchesBusinessType(plugin, type);
    });
  }

  function registerSchema(plugin) {
    if (!root.OmniBusinessEngine?.registerSchema) return;
    root.OmniBusinessEngine.registerSchema(plugin.metadata.businessType, {
      id: plugin.metadata.businessType,
      version: plugin.metadata.version,
      entities: plugin.entities,
      masterData: plugin.masterData
    });
    plugin.metadata.aliases.forEach(alias => root.OmniBusinessEngine.registerSchema(alias, {
      id: alias,
      version: plugin.metadata.version,
      entities: plugin.entities,
      masterData: plugin.masterData
    }));
  }

  function bootActive() {
    const next = new Set(getActivePlugins().map(plugin => plugin.metadata.id));
    activeIds.forEach(id => {
      if (!next.has(id)) {
        const plugin = getPlugin(id);
        plugin?.loader.shutdown({ sdk: api, plugin });
        if (plugin) {
          root.OmniBusinessEngine?.unregisterSchema?.(plugin.metadata.businessType);
          plugin.metadata.aliases.forEach(alias => root.OmniBusinessEngine?.unregisterSchema?.(alias));
        }
      }
    });
    next.forEach(id => {
      const plugin = getPlugin(id);
      registerSchema(plugin);
      if (!activeIds.has(id)) {
        plugin.loader.boot({ sdk: api, plugin, settings: getSettings(id) });
        plugin.hooks.onBusinessActivated({ sdk: api, plugin });
      }
    });
    activeIds = next;
    return getActivePlugins();
  }

  function getSettings(id) { return getPluginState(id)?.settings || {}; }
  function updateSettings(id, patch) {
    const current = getPluginState(id);
    if (!current) throw new Error(`Unknown plugin: ${id}`);
    const state = setState(id, { settings: { ...current.settings, ...(patch || {}) } });
    emitChange(id, 'settings');
    return state.settings;
  }

  function translate(id, key, language) {
    const plugin = getPlugin(id);
    const locale = language || root.getOmniStoreSettings?.().business?.language || 'ar';
    return plugin?.translations?.[locale]?.[key] ?? plugin?.translations?.en?.[key] ?? key;
  }

  function getPermissions() {
    return [...new Set(getActivePlugins().flatMap(plugin => plugin.permissions))];
  }

  function hasPermission(permission) {
    return getPermissions().includes(permission);
  }

  function getRoutes() {
    return getActivePlugins().flatMap(plugin => plugin.routes.map(route => ({ ...route, pluginId: plugin.metadata.id })));
  }

  function isRouteAvailable(route) {
    return getRoutes().some(item => item.route === route);
  }

  function emitChange(id, action) {
    root.dispatchEvent?.(new CustomEvent('omnipluginchange', { detail: { id, action, state: getPluginState(id) } }));
  }

  function reset() {
    root.localStorage?.removeItem(STORAGE_KEY);
    listPlugins().forEach(plugin => {
      const state = readState();
      state[plugin.metadata.id] = {
        installed: plugin.metadata.bundled !== false,
        enabled: plugin.featureFlags.enabled !== false,
        settings: { ...plugin.sampleSettings },
        installedAt: new Date().toISOString()
      };
      writeState(state);
    });
    return bootActive();
  }

  const api = Object.freeze({
    storageKey: STORAGE_KEY,
    platformVersion: PLATFORM_VERSION,
    defineBusinessPlugin,
    validatePlugin,
    register,
    getPlugin,
    listPlugins,
    getPluginState,
    getActivePlugins,
    getCurrentBusinessType,
    matchesBusinessType,
    isCompatible,
    install,
    uninstall,
    enable,
    disable,
    bootActive,
    getSettings,
    updateSettings,
    translate,
    getPermissions,
    hasPermission,
    getRoutes,
    isRouteAvailable,
    reset
  });

  root.OmniPluginSDK = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
