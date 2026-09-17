const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const pluginIds = ['computer_shop','auto_parts','restaurant','supermarket','pharmacy','mobile_shop','clothes','jewelry','hardware','bookstore','agriculture','generic_store'];

function integrationRuntime(initialType = 'computer_shop') {
  let businessType = initialType;
  const store = new Map();
  const context = {
    console,
    CustomEvent: function (name, options) { this.type = name; this.detail = options?.detail; },
    dispatchEvent() {},
    addEventListener() {},
    getCurrentBusinessType: () => businessType,
    getOmniPluginRuntimeSnapshot: () => ({ productCount: 4, salesTotal: 2500, stockValue: 9000 }),
    formatMoney: value => `${value} EGP`,
    localStorage: {
      getItem: key => store.get(key) || null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key)
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  const run = relative => vm.runInContext(fs.readFileSync(path.join(projectRoot, relative), 'utf8'), context);
  [
    'services/businessEngine/registry.js',
    'services/businessEngine/businessEngine.js',
    'services/modulePlatform/moduleRegistry.js',
    'services/modulePlatform/moduleLoader.js',
    'services/pluginSdk/pluginSdk.js'
  ].forEach(run);
  pluginIds.forEach(id => run(`plugins/business/${id}/plugin.js`));
  return { context, run, setType: value => { businessType = value; } };
}

test('registry → loader → form → validation integration', () => {
  const runtime = integrationRuntime('computer_shop');
  runtime.context.OmniPluginSDK.bootActive();
  const html = runtime.context.OmniBusinessEngine.renderFields('product', 'computer_shop');
  assert.match(html, /data-schema-key="cpu"/);
  assert.match(html, /data-schema-key="ram"/);
  runtime.setType('auto_parts');
  runtime.context.OmniPluginSDK.bootActive();
  const autoHtml = runtime.context.OmniBusinessEngine.renderFields('product', 'auto_parts');
  assert.match(autoHtml, /data-schema-key="oem"/);
  assert.equal(runtime.context.OmniBusinessEngine.validate('product', { customFields:{} }, 'auto_parts').valid, false);
});

test('active plugin contributes Sidebar navigation', () => {
  const runtime = integrationRuntime('restaurant');
  runtime.context.OmniPluginSDK.bootActive();
  runtime.context.OmniModuleLoader.boot();
  const dropdowns = {};
  ['main','sales','inventory','reports','customers','admin','maintenance','analytics','employees'].forEach(id => {
    dropdowns[`dropdown-${id}`] = { innerHTML:'', style:{} };
  });
  runtime.context.canAccessPage = () => true;
  runtime.context.document = {
    getElementById: id => dropdowns[id] || null,
    querySelector: () => ({ style:{} }),
    querySelectorAll: () => []
  };
  runtime.run('services/modulePlatform/navigationBuilder.js');
  runtime.context.OmniNavigationBuilder.build();
  assert.match(dropdowns['dropdown-admin'].innerHTML, /business-plugin-settings/);
});

test('active plugin contributes Dashboard cards', () => {
  const runtime = integrationRuntime('pharmacy');
  runtime.context.OmniPluginSDK.bootActive();
  runtime.context.OmniModuleLoader.boot();
  const host = { innerHTML:'' };
  runtime.context.document = {
    getElementById: id => id === 'omniDynamicDashboardWidgets' ? host : null,
    querySelectorAll: () => []
  };
  runtime.run('services/modulePlatform/dashboardBuilder.js');
  const widgets = runtime.context.OmniDashboardBuilder.build();
  assert.ok(Array.from(widgets).some(widget => widget.moduleId === 'plugin:pharmacy'));
  assert.match(host.innerHTML, /plugin:pharmacy/);
});

test('marketplace state changes update active schema', () => {
  const runtime = integrationRuntime('jewelry');
  runtime.context.OmniPluginSDK.bootActive();
  assert.ok(runtime.context.OmniBusinessEngine.getFields('product', 'jewelry').some(field => field.key === 'metal'));
  runtime.context.OmniPluginSDK.disable('jewelry');
  assert.equal(runtime.context.OmniPluginSDK.getActivePlugins().length, 0);
  runtime.context.OmniPluginSDK.enable('jewelry');
  assert.equal(runtime.context.OmniPluginSDK.getActivePlugins()[0].metadata.id, 'jewelry');
});

test('reports and settings stay isolated per plugin', () => {
  const runtime = integrationRuntime('agriculture');
  runtime.context.OmniPluginSDK.bootActive();
  const active = runtime.context.OmniPluginSDK.getActivePlugins()[0];
  assert.ok(active.reports.some(report => report.id === 'agriculture.harvest'));
  runtime.context.OmniPluginSDK.updateSettings('agriculture', { gradeTracking:false });
  assert.equal(runtime.context.OmniPluginSDK.getSettings('agriculture').gradeTracking, false);
  assert.equal(runtime.context.OmniPluginSDK.getSettings('computer_shop').gradeTracking, undefined);
});

test('Marketplace and module Settings render from registry', () => {
  const runtime = integrationRuntime('computer_shop');
  runtime.context.OmniPluginSDK.bootActive();
  const grid = { innerHTML:'' };
  const summary = { textContent:'' };
  const settings = { innerHTML:'', querySelectorAll:() => [] };
  runtime.context.document = {
    getElementById: id => id === 'businessPluginMarketplaceGrid' ? grid
      : id === 'businessPluginMarketplaceSummary' ? summary
      : id === 'businessPluginSettingsContent' ? settings
      : null
  };
  runtime.context.showPage = () => {};
  runtime.context.showToast = () => {};
  runtime.run('services/pluginSdk/pluginUi.js');
  runtime.context.renderBusinessPluginMarketplace();
  runtime.context.openBusinessPluginSettings('computer_shop');
  assert.match(grid.innerHTML, /computer_shop/);
  assert.match(summary.textContent, /12 Modules/);
  assert.match(settings.innerHTML, /Computer Shop|متجر الكمبيوتر/);
});
