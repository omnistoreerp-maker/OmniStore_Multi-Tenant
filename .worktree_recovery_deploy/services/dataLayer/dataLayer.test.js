const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '..', '..');
const sandbox = vm.createContext({ console, globalThis: {} });
sandbox.window = sandbox.globalThis;
[
  'DataProvider.js','StorageAdapter.js','SupabaseAdapterPreview.js','SQLiteAdapterPreview.js',
  'IndexedDBAdapterPreview.js','MemoryAdapter.js','DataLayerValidator.js','DataRepository.js',
  'TransactionManager.js','SyncManagerPreview.js','ConnectionHealthChecker.js',
  'OfflineQueuePreview.js','ConflictResolverPreview.js'
].forEach(file => new vm.Script(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file }).runInContext(sandbox));
const data = sandbox.globalThis.OmniDataLayer;

function run() {
  assert.ok(data.DataProvider);
  assert.ok(data.StorageAdapter);
  assert.ok(data.DataRepository);
  const memory = data.MemoryAdapter.create({ products: [{ id: 'p1', name: 'Laptop', stock: 4 }] });
  assert.strictEqual(memory.previewOnly, true);
  assert.strictEqual(memory.connected, false);
  assert.strictEqual(memory.supports.read, true);
  assert.strictEqual(memory.supports.write, false);
  assert.strictEqual(memory.recordCount(), 1);
  assert.strictEqual(memory.list('products').length, 1);
  assert.strictEqual(memory.get('products', 'p1').name, 'Laptop');
  assert.strictEqual(memory.query('products', item => item.stock > 0).length, 1);
  const external = memory.list('products');
  external.push({ id: 'p2' });
  assert.strictEqual(memory.list('products').length, 1);

  const createPreview = memory.previewCreate('products', { id: 'p2' });
  assert.strictEqual(createPreview.previewOnly, true);
  assert.strictEqual(createPreview.executed, false);
  assert.strictEqual(createPreview.persisted, false);
  assert.strictEqual(memory.list('products').length, 1);
  assert.strictEqual(memory.previewUpdate('products', { id: 'p1', stock: 5 }).executed, false);
  assert.strictEqual(memory.previewDelete('products', { id: 'p1' }).executed, false);

  const previewAdapters = [
    data.SupabaseAdapterPreview.create(),
    data.SQLiteAdapterPreview.create(),
    data.IndexedDBAdapterPreview.create()
  ];
  previewAdapters.forEach(adapter => {
    assert.strictEqual(adapter.connected, false);
    assert.strictEqual(adapter.previewOnly, true);
    assert.strictEqual(adapter.supports.write, false);
    assert.strictEqual(data.DataLayerValidator.validateAdapter(adapter).valid, true);
  });

  const repository = data.DataRepository.create(memory, 'products');
  assert.strictEqual(repository.readOnly, true);
  assert.strictEqual(repository.list().length, 1);
  assert.strictEqual(repository.get('p1').id, 'p1');
  assert.strictEqual(repository.previewCreate({ id: 'p2' }).executed, false);
  assert.strictEqual(repository.validate().valid, true);

  const transaction = data.TransactionManager.preview([repository.previewCreate({ id: 'p2' })]);
  assert.strictEqual(transaction.valid, true);
  assert.strictEqual(transaction.previewOnly, true);
  assert.strictEqual(transaction.begun, false);
  assert.strictEqual(transaction.committed, false);
  assert.strictEqual(transaction.dataChanged, false);

  const sync = data.SyncManagerPreview.preview({ collections: ['products'], estimatedOperations: 1 });
  assert.strictEqual(sync.status, 'preview_only');
  assert.strictEqual(sync.synced, false);
  assert.strictEqual(sync.uploaded, false);
  assert.strictEqual(sync.downloaded, false);

  const queue = data.OfflineQueuePreview.build([]);
  const queueCandidate = data.OfflineQueuePreview.previewEnqueue(queue, { operation: 'create', collection: 'products' });
  assert.strictEqual(queue.count, 0);
  assert.strictEqual(queueCandidate.candidateQueue.count, 1);
  assert.strictEqual(queueCandidate.enqueued, false);
  assert.strictEqual(queueCandidate.persisted, false);

  const conflict = data.ConflictResolverPreview.preview({ id: 'c1', source: { value: 1 }, target: { value: 2 } }, 'manual_review');
  assert.strictEqual(conflict.previewOnly, true);
  assert.strictEqual(conflict.applied, false);
  assert.strictEqual(conflict.requiresManualReview, true);

  const providers = [
    data.DataProvider.create({ id: 'memory-preview', adapter: memory }),
    data.DataProvider.create({ id: 'supabase-preview', adapter: previewAdapters[0] }),
    data.DataProvider.create({ id: 'sqlite-preview', adapter: previewAdapters[1] }),
    data.DataProvider.create({ id: 'indexeddb-preview', adapter: previewAdapters[2] })
  ];
  const layerValidation = data.DataLayerValidator.validateLayer({ providers });
  assert.strictEqual(layerValidation.valid, true);
  assert.strictEqual(layerValidation.readinessScore, 100);
  assert.strictEqual(layerValidation.providerCount, 4);
  const health = data.ConnectionHealthChecker.check(providers);
  assert.strictEqual(health.score, 100);
  assert.strictEqual(health.actualConnections, 0);
  assert.strictEqual(health.currentProvider, 'memory-preview');

  const requiredFiles = [
    'DataProvider.js','StorageAdapter.js','SupabaseAdapterPreview.js','SQLiteAdapterPreview.js',
    'IndexedDBAdapterPreview.js','MemoryAdapter.js','DataRepository.js','TransactionManager.js',
    'SyncManagerPreview.js','ConnectionHealthChecker.js','OfflineQueuePreview.js',
    'ConflictResolverPreview.js','DataLayerValidator.js','dataLayer.test.js','README.md'
  ];
  requiredFiles.forEach(file => assert.ok(fs.existsSync(path.join(__dirname, file)), `Missing ${file}`));

  const templateDir = path.join(projectRoot, 'templates', 'dataLayer');
  ['provider.template.json','storage.template.json','sync.template.json'].forEach(file => {
    const fullPath = path.join(templateDir, file);
    assert.ok(fs.existsSync(fullPath), `Missing ${file}`);
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(fullPath, 'utf8')));
  });

  const productionFiles = fs.readdirSync(__dirname).filter(name => name.endsWith('.js') && name !== 'dataLayer.test.js');
  const source = productionFiles.map(name => fs.readFileSync(path.join(__dirname, name), 'utf8')).join('\n');
  assert.strictEqual(/localStorage\s*\.\s*(setItem|removeItem|clear)|createClient|indexedDB\s*\.\s*open|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|\.post\s*\(|\.unPost\s*\(|\.reverse\s*\(|\.receive\s*\(|\.issue\s*\(|saveDB|ghPush|fetch\s*\(|XMLHttpRequest|WebSocket/i.test(source), false);
  assert.strictEqual(/\b(copyFile|writeFileSync|mkdirSync)\s*\(/i.test(source), false);
  assert.strictEqual(/[A-Z]:\\Projects\\/i.test(source), false);

  const html = fs.readFileSync(path.join(projectRoot, 'DigiTronics_v5.html'), 'utf8');
  const pages = ['data-layer','connection-status','storage-providers','offline-queue','sync-preview','repository-status','transaction-preview'];
  pages.forEach(page => {
    assert.ok(html.includes(`data-page="${page}"`), `Missing navigation ${page}`);
    assert.ok(html.includes(`id="page-${page}"`), `Missing page ${page}`);
    assert.ok(html.includes(`renderDataLayerPage('${page}')`), `Missing render hook ${page}`);
  });
  ['Data Layer','Connection Status','Storage Providers','Offline Queue','Sync Preview','Repository Status','Transaction Preview'].forEach(label => assert.ok(html.includes(label)));

  ['PHASE22_IMPLEMENTATION_REPORT_20260630.md','PHASE22_DATALAYER_REPORT_20260630.md','PHASE22_TEST_REPORT_20260630.md','PHASE22_ROLLBACK_REPORT_20260630.md'].forEach(file => assert.ok(fs.existsSync(path.join(projectRoot, file)), `Missing ${file}`));
  const sw = fs.readFileSync(path.join(projectRoot, 'sw.js'), 'utf8');
  assert.ok(/omnistore-erp-v(28-data-layer-preview|29-auth-preview|30-tenancy-preview|31-deployment-simulation|32-real-supabase-installer|33-customer-provisioning)/.test(sw));
  assert.ok(sw.includes('./services/dataLayer/DataProvider.js'));
  assert.ok(sw.includes('./templates/dataLayer/provider.template.json'));

  return { tests: 50, dataLayerReadinessScore: layerValidation.readinessScore, providers: providers.length, actualConnections: health.actualConnections };
}

if (require.main === module) console.log(JSON.stringify(run(), null, 2));
module.exports = { run };
