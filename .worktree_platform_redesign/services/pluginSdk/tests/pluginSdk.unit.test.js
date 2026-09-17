const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const pluginIds = ['computer_shop','auto_parts','restaurant','supermarket','pharmacy','mobile_shop','clothes','jewelry','hardware','bookstore','agriculture','generic_store'];

function createRuntime(type = 'computer_shop') {
  const store = new Map();
  let businessType = type;
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
  const run = relative => vm.runInContext(fs.readFileSync(path.join(projectRoot, relative), 'utf8'), context);
  run('services/businessEngine/registry.js');
  run('services/businessEngine/businessEngine.js');
  run('services/pluginSdk/pluginSdk.js');
  pluginIds.forEach(id => run(`plugins/business/${id}/plugin.js`));
  return { context, sdk: context.OmniPluginSDK, engine: context.OmniBusinessEngine, store, setBusinessType: value => { businessType = value; } };
}

test('all 12 plugin folders have valid manifests', () => {
  pluginIds.forEach(id => {
    const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, `plugins/business/${id}/manifest.json`), 'utf8'));
    assert.equal(manifest.id, id);
    assert.equal(manifest.entry, 'plugin.js');
    assert.ok(manifest.version);
    assert.deepEqual(manifest.languages, ['ar', 'en']);
  });
});

test('registry contains 12 valid business plugins', () => {
  const { sdk } = createRuntime();
  assert.equal(sdk.listPlugins().length, 12);
  sdk.listPlugins().forEach(plugin => assert.equal(sdk.validatePlugin(plugin).valid, true));
});

test('every plugin exposes the complete SDK contract', () => {
  const { sdk } = createRuntime();
  const keys = ['metadata','loader','routes','navigation','dashboardCards','permissions','productSchema','validation','reports','hooks','featureFlags','icons','translations','sampleSettings'];
  sdk.listPlugins().forEach(plugin => {
    keys.forEach(key => assert.ok(key in plugin, `${plugin.metadata.id}.${key}`));
    assert.ok(plugin.translations.ar);
    assert.ok(plugin.translations.en);
  });
});

test('active plugin follows current Business Type and aliases', () => {
  const runtime = createRuntime('computer_shop');
  runtime.sdk.bootActive();
  assert.equal(runtime.sdk.getActivePlugins()[0].metadata.id, 'computer_shop');
  runtime.setBusinessType('fashion');
  runtime.sdk.bootActive();
  assert.equal(runtime.sdk.getActivePlugins()[0].metadata.id, 'clothes');
  runtime.setBusinessType('book_store');
  runtime.sdk.bootActive();
  assert.equal(runtime.sdk.getActivePlugins()[0].metadata.id, 'bookstore');
});

test('enable disable install and uninstall are local and reversible', () => {
  const { sdk, store } = createRuntime();
  sdk.bootActive();
  sdk.disable('computer_shop');
  assert.equal(sdk.getPluginState('computer_shop').enabled, false);
  sdk.enable('computer_shop');
  assert.equal(sdk.getPluginState('computer_shop').enabled, true);
  sdk.uninstall('computer_shop');
  assert.equal(sdk.getPluginState('computer_shop').installed, false);
  sdk.install('computer_shop');
  assert.equal(sdk.getPluginState('computer_shop').installed, true);
  assert.ok(store.has(sdk.storageKey));
});

test('plugin settings merge and persist independently', () => {
  const { sdk } = createRuntime();
  const before = sdk.getSettings('restaurant');
  sdk.updateSettings('restaurant', { defaultPreparationMinutes: 25 });
  assert.equal(sdk.getSettings('restaurant').defaultPreparationMinutes, 25);
  assert.equal(sdk.getSettings('restaurant').kitchenDisplay, before.kitchenDisplay);
  assert.equal(sdk.getSettings('pharmacy').defaultPreparationMinutes, undefined);
});

test('Arabic and English localization are available', () => {
  const { sdk } = createRuntime();
  assert.equal(sdk.translate('restaurant', 'name', 'ar'), 'المطعم');
  assert.equal(sdk.translate('restaurant', 'name', 'en'), 'Restaurant');
});

test('plugin product validation is enforced by Dynamic Form Engine', () => {
  const { sdk, engine, setBusinessType } = createRuntime('auto_parts');
  sdk.bootActive();
  const invalid = engine.validate('product', { customFields: {} }, 'auto_parts');
  assert.equal(invalid.valid, false);
  assert.ok(Array.from(invalid.errors, error => error.key).includes('oem'));
  const valid = engine.validate('product', { customFields: { oem:'1', brand:'Bosch', compatibility:'Toyota' } }, 'auto_parts');
  assert.equal(valid.valid, true);
  setBusinessType('restaurant');
  sdk.bootActive();
  assert.equal(engine.validate('product', { customFields: { kitchen:'main' } }, 'restaurant').valid, true);
});

test('routes, permissions and reports come from the active plugin', () => {
  const { sdk } = createRuntime('pharmacy');
  sdk.bootActive();
  assert.equal(sdk.isRouteAvailable('business-plugin-settings'), true);
  assert.equal(sdk.hasPermission('batches.manage'), true);
  assert.ok(sdk.getActivePlugins()[0].reports.length > 0);
});

test('uninstall removes the active custom schema without touching fallback schemas', () => {
  const { sdk, engine } = createRuntime('jewelry');
  sdk.bootActive();
  assert.ok(engine.getFields('product', 'jewelry').some(field => field.key === 'purity'));
  sdk.uninstall('jewelry');
  assert.equal(sdk.getActivePlugins().length, 0);
  assert.equal(engine.normalizeType('unknown'), 'computer_shop');
});
