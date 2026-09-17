const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '..', '..');
const sandbox = vm.createContext({ console, Date, globalThis: {} });
sandbox.window = sandbox.globalThis;
[
  'BusinessProfileSettings.js','POSSettings.js','InventorySettings.js','AccountingSettings.js',
  'UserSettings.js','SecuritySettings.js','BackupSettings.js','PrintSettings.js','ThemeSettings.js',
  'ConfigurationValidator.js','ConfigurationExporter.js','ConfigurationImporter.js','ConfigurationEngine.js'
].forEach(file => new vm.Script(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file }).runInContext(sandbox));
const configuration = sandbox.globalThis.OmniConfiguration;

function run() {
  assert.strictEqual(Object.keys(configuration.sections).length, 9);
  const fieldCount = Object.values(configuration.sections).reduce((sum, section) => sum + section.fields.length, 0);
  assert.strictEqual(fieldCount, 68);

  const engine = configuration.ConfigurationEngine.createEngine();
  assert.strictEqual(engine.mode, 'preview-memory-only');
  assert.strictEqual(engine.persisted, false);
  const defaults = engine.getDefaults();
  assert.strictEqual(defaults.businessProfile.businessType, 'computer_shop');
  assert.strictEqual(defaults.businessProfile.language, 'ar');
  assert.strictEqual(defaults.businessProfile.currency, 'EGP');
  assert.strictEqual(defaults.accounting.postingEnabled, false);
  assert.strictEqual(defaults.backup.automaticBackupEnabled, false);
  assert.strictEqual(defaults.inventory.costMethod, 'average');
  assert.strictEqual(defaults.print.receiptSize, 'A4');
  assert.strictEqual(defaults.theme.mode, 'light');

  const validation = engine.validate();
  assert.strictEqual(validation.valid, true);
  assert.strictEqual(validation.healthScore, 100);
  assert.strictEqual(validation.fieldCount, 68);
  assert.strictEqual(validation.errors.length, 0);
  assert.strictEqual(validation.missingValues.length, 0);

  const edit = engine.setValue('theme', 'mode', 'dark');
  assert.strictEqual(edit.appliedToMemory, true);
  assert.strictEqual(edit.persisted, false);
  assert.strictEqual(engine.getConfiguration().theme.mode, 'dark');
  assert.strictEqual(engine.getDefaults().theme.mode, 'light');
  assert.throws(() => engine.setValue('accounting', 'postingEnabled', true), /locked/i);
  assert.throws(() => engine.setValue('missing', 'x', true), /Unknown setting/);

  const exported = engine.exportPreview({ generatedAt: '2026-06-30T00:00:00.000Z' });
  const exportedObject = JSON.parse(exported);
  assert.strictEqual(exportedObject._meta.previewOnly, true);
  assert.strictEqual(exportedObject._meta.permanentSave, false);
  assert.strictEqual(exportedObject.theme.mode, 'dark');

  const importDefaults = configuration.ConfigurationExporter.stringify(defaults, { generatedAt: '2026-06-30T00:00:00.000Z' });
  const preview = engine.importPreview(importDefaults);
  assert.strictEqual(preview.validJson, true);
  assert.strictEqual(preview.validConfiguration, true);
  assert.strictEqual(preview.applied, false);
  assert.ok(preview.differences.some(item => item.section === 'theme' && item.key === 'mode'));
  assert.strictEqual(engine.getConfiguration().theme.mode, 'dark');
  const invalidJson = engine.importPreview('{broken');
  assert.strictEqual(invalidJson.validJson, false);
  assert.strictEqual(invalidJson.applied, false);
  const missing = engine.importPreview('{"businessProfile":{}}');
  assert.strictEqual(missing.validJson, true);
  assert.strictEqual(missing.validConfiguration, false);
  assert.ok(missing.missingValues.length > 0);

  const reset = engine.resetInMemory();
  assert.strictEqual(reset.resetInMemory, true);
  assert.strictEqual(reset.persisted, false);
  assert.strictEqual(engine.getConfiguration().theme.mode, 'light');

  const requiredFiles = [
    'ConfigurationEngine.js','BusinessProfileSettings.js','POSSettings.js','InventorySettings.js',
    'AccountingSettings.js','UserSettings.js','SecuritySettings.js','BackupSettings.js',
    'PrintSettings.js','ThemeSettings.js','ConfigurationValidator.js','ConfigurationExporter.js',
    'ConfigurationImporter.js','configuration.test.js','README.md'
  ];
  requiredFiles.forEach(file => assert.ok(fs.existsSync(path.join(__dirname, file)), `Missing ${file}`));

  const templateDir = path.join(projectRoot, 'templates', 'config');
  const templateFiles = ['default-config.json','default-business-profile.json','default-pos.json','default-print.json','default-theme.json'];
  templateFiles.forEach(file => {
    const fullPath = path.join(templateDir, file);
    assert.ok(fs.existsSync(fullPath), `Missing ${file}`);
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(fullPath, 'utf8')));
  });

  const productionFiles = fs.readdirSync(__dirname).filter(name => name.endsWith('.js') && name !== 'configuration.test.js');
  const source = productionFiles.map(name => fs.readFileSync(path.join(__dirname, name), 'utf8')).join('\n');
  assert.strictEqual(/localStorage\s*\.\s*(setItem|removeItem|clear)|createClient|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|\.post\s*\(|\.unPost\s*\(|\.reverse\s*\(|\.receive\s*\(|\.issue\s*\(|saveDB|ghPush|fetch\s*\(/i.test(source), false);
  assert.strictEqual(/\b(copyFile|cpSync|mkdirSync|writeFileSync)\s*\(/i.test(source), false);
  assert.strictEqual(/[A-Z]:\\Projects\\/i.test(source), false);

  const html = fs.readFileSync(path.join(projectRoot, 'DigiTronics_v5.html'), 'utf8');
  const pages = ['configuration-center','config-business-profile','config-pos','config-inventory','config-accounting','config-print','config-theme','config-security','config-backup','config-export','config-import'];
  pages.forEach(page => {
    assert.ok(html.includes(`data-page="${page}"`), `Missing navigation ${page}`);
    assert.ok(html.includes(`id="page-${page}"`), `Missing page ${page}`);
    assert.ok(html.includes(`renderConfigurationPage('${page}')`), `Missing render hook ${page}`);
  });
  ['Configuration Center','Business Profile','POS Configuration','Inventory Configuration','Accounting Configuration Preview','Print Configuration','Theme Configuration','Security Configuration','Backup Configuration','Export Configuration','Import Configuration'].forEach(label => assert.ok(html.includes(label)));
  assert.ok(source.includes('تصدير Configuration JSON Preview'));
  assert.ok(source.includes('معاينة ملف JSON'));
  assert.ok(source.includes('Nothing was applied'));

  ['PHASE21_IMPLEMENTATION_REPORT_20260630.md','PHASE21_CONFIGURATION_REPORT_20260630.md','PHASE21_TEST_REPORT_20260630.md','PHASE21_ROLLBACK_REPORT_20260630.md'].forEach(file => assert.ok(fs.existsSync(path.join(projectRoot, file)), `Missing ${file}`));

  const sw = fs.readFileSync(path.join(projectRoot, 'sw.js'), 'utf8');
  assert.ok(/omnistore-erp-v(27-configuration-preview|28-data-layer-preview|29-auth-preview|30-tenancy-preview|31-deployment-simulation|32-real-supabase-installer|33-customer-provisioning)/.test(sw));
  assert.ok(sw.includes('./services/configuration/ConfigurationEngine.js'));
  assert.ok(sw.includes('./templates/config/default-config.json'));

  return { tests: 50, configurationReadinessScore: validation.healthScore, sections: Object.keys(configuration.sections).length, fields: fieldCount };
}

if (require.main === module) console.log(JSON.stringify(run(), null, 2));
module.exports = { run };
