const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function createPlatform(businessType = 'computer_shop') {
  const store = new Map();
  const context = {
    console,
    CustomEvent: function (name, options) { this.type = name; this.detail = options?.detail; },
    dispatchEvent() {},
    getCurrentBusinessType: () => businessType,
    localStorage: {
      getItem: key => store.get(key) || null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key)
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'moduleRegistry.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'moduleLoader.js'), 'utf8'), context);
  return { context, loader: context.OmniModuleLoader, registry: context.OmniModuleRegistry, store };
}

test('every module implements the required contract', () => {
  const { registry } = createPlatform();
  const keys = ['id', 'name', 'icon', 'route', 'permissions', 'businessTypes', 'dependencies', 'enabled', 'defaultSettings'];
  Object.values(registry).forEach(module => keys.forEach(key => assert.ok(key in module, `${module.id}.${key}`)));
});

test('only active modules boot and inactive modules shut down', () => {
  const { loader, registry } = createPlatform();
  const events = [];
  Object.values(registry).forEach(module => loader.register(module.id, {
    register: () => events.push(`register:${module.id}`),
    boot: () => events.push(`boot:${module.id}`),
    shutdown: () => events.push(`shutdown:${module.id}`)
  }));
  loader.boot();
  assert.ok(events.includes('boot:products'));
  loader.setEnabled('products', false);
  assert.ok(events.includes('shutdown:products'));
});

test('dependency resolver disables dependent modules', () => {
  const { loader } = createPlatform();
  loader.boot();
  loader.setEnabled('products', false);
  assert.equal(loader.getModuleState('products').active, false);
  assert.equal(loader.getModuleState('sales').active, false);
  assert.equal(loader.getModuleState('inventory').active, false);
  assert.equal(loader.getModuleState('purchases').active, false);
  assert.equal(loader.getModuleState('sales').reason, 'dependency');
});

test('business profile automatically disables incompatible repairs', () => {
  const { loader } = createPlatform('restaurant');
  loader.boot();
  assert.equal(loader.getModuleState('repairs').active, false);
  assert.equal(loader.getModuleState('repairs').reason, 'business_type');
  assert.equal(loader.getModuleState('sales').active, true);
});

test('feature flags persist locally and can reset', () => {
  const { loader, store } = createPlatform();
  loader.boot();
  loader.setEnabled('reports', false);
  assert.ok(store.has(loader.storageKey));
  assert.equal(loader.getModuleState('reports').requested, false);
  loader.reset();
  assert.equal(loader.getModuleState('reports').requested, true);
});

test('module settings merge defaults and remain isolated', () => {
  const { loader } = createPlatform();
  const original = loader.getSettings('products');
  loader.updateSettings('products', { tablePageSize: 25 });
  const changed = loader.getSettings('products');
  assert.equal(changed.tablePageSize, 25);
  assert.equal(changed.showLowStock, original.showLowStock);
  assert.notEqual(loader.getSettings('sales').tablePageSize, 25);
});

test('route guard follows module state', () => {
  const { loader } = createPlatform();
  loader.boot();
  assert.equal(loader.isRouteEnabled('pos'), true);
  loader.setEnabled('sales', false);
  assert.equal(loader.isRouteEnabled('pos'), false);
  assert.equal(loader.isRouteEnabled('unknown-legacy-page'), true);
});

test('administrative features are independently modular', () => {
  const { loader } = createPlatform();
  loader.boot();
  loader.setEnabled('automation', false);
  assert.equal(loader.isRouteEnabled('automation'), false);
  assert.equal(loader.isRouteEnabled('branches'), true);
  assert.equal(loader.isRouteEnabled('settings'), true);
});

test('navigation builder renders enabled module routes', () => {
  const { context, loader } = createPlatform();
  loader.boot();
  const dropdowns = {};
  ['main','sales','inventory','reports','customers','admin','maintenance','analytics','employees'].forEach(id => {
    dropdowns[`dropdown-${id}`] = { innerHTML: '', style: {} };
  });
  context.canAccessPage = () => true;
  context.document = {
    getElementById: id => dropdowns[id] || null,
    querySelector: () => ({ style: {} }),
    querySelectorAll: () => []
  };
  vm.runInContext(fs.readFileSync(path.join(root, 'navigationBuilder.js'), 'utf8'), context);
  const result = context.OmniNavigationBuilder.build();
  assert.ok(result.inventory.includes('products'));
  assert.match(dropdowns['dropdown-sales'].innerHTML, /data-page="pos"/);
});

test('dashboard builder uses widgets from enabled modules', () => {
  const { context, loader } = createPlatform();
  loader.boot();
  const host = { innerHTML: '' };
  context.document = {
    getElementById: id => id === 'omniDynamicDashboardWidgets' ? host : null,
    querySelectorAll: () => []
  };
  vm.runInContext(fs.readFileSync(path.join(root, 'dashboardBuilder.js'), 'utf8'), context);
  const widgets = context.OmniDashboardBuilder.build();
  assert.ok(widgets.some(widget => widget.moduleId === 'sales'));
  assert.match(host.innerHTML, /data-module-widget="products"/);
});
