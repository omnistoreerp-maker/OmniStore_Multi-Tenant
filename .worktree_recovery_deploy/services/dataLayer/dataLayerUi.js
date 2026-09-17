(function (root) {
  'use strict';
  const ns = root.OmniDataLayer;
  const memoryAdapter = ns.MemoryAdapter.create({
    products: [{ id: 'preview-product-1', name: 'Sample Product', stock: 10 }],
    customers: [{ id: 'preview-customer-1', name: 'Sample Customer' }]
  });
  const providers = Object.freeze([
    ns.DataProvider.create({ id: 'memory-preview', name: 'Memory Snapshot', type: 'memory-preview', adapter: memoryAdapter, configured: true }),
    ns.DataProvider.create({ id: 'supabase-preview', name: 'Supabase Preview', type: 'cloud-preview', adapter: ns.SupabaseAdapterPreview.create() }),
    ns.DataProvider.create({ id: 'sqlite-preview', name: 'SQLite Preview', type: 'desktop-preview', adapter: ns.SQLiteAdapterPreview.create() }),
    ns.DataProvider.create({ id: 'indexeddb-preview', name: 'IndexedDB Preview', type: 'offline-preview', adapter: ns.IndexedDBAdapterPreview.create() })
  ]);
  const repository = ns.DataRepository.create(memoryAdapter, 'products');
  const layerValidation = ns.DataLayerValidator.validateLayer({ providers });
  const connectionHealth = ns.ConnectionHealthChecker.check(providers);
  const queue = ns.OfflineQueuePreview.build([]);
  const syncPreview = ns.SyncManagerPreview.preview({ sourceProvider: 'memory-preview', targetProvider: 'disabled-provider', collections: ['products'], estimatedOperations: 0 });
  const transactionPreview = ns.TransactionManager.preview([
    repository.previewCreate({ id: 'candidate-product', name: 'Preview Candidate' }),
    repository.previewUpdate({ id: 'preview-product-1', stock: 11 })
  ], { id: 'TX-DEMO-PREVIEW' });
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const row = (icon, label, value) => `<div class="data-layer-row"><span>${icon} ${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  function overview() {
    return `<div class="stats-grid" style="margin-bottom:14px">
      <div class="stat-card green"><div class="stat-value">${layerValidation.readinessScore}%</div><div class="stat-label">Data Layer Readiness</div></div>
      <div class="stat-card blue"><div class="stat-value">${providers.length}</div><div class="stat-label">Available Providers</div></div>
      <div class="stat-card blue"><div class="stat-value">${esc(connectionHealth.currentProvider)}</div><div class="stat-label">Current Provider</div></div>
      <div class="stat-card green"><div class="stat-value">0</div><div class="stat-label">Actual Connections</div></div>
    </div><div class="data-layer-grid">
      <section class="report-card"><div class="table-title">طبقة البيانات الحالية</div>${row('🧠','Provider','Memory Snapshot')}${row('📖','Mode','Read-only snapshot')}${row('🔒','Writes','Disabled')}${row('🔌','Connections','Disabled')}</section>
      <section class="report-card"><div class="table-title">قواعد Preview</div>${row('✅','Database writes','0')}${row('✅','Sync operations','0')}${row('✅','Uploads','0')}${row('✅','Posting','0')}</section>
    </div>`;
  }
  function connections() {
    return `<div class="data-layer-grid">${connectionHealth.providers.map(provider => `<div class="report-card"><div class="table-title">${esc(provider.name)}</div>${row('🩺','Status',provider.status)}${row('🔌','Connected',String(provider.connected))}<div class="config-default">${esc(provider.message)}</div></div>`).join('')}</div>`;
  }
  function storageProviders() {
    return `<div class="data-layer-grid">${providers.map(provider => `<div class="report-card"><div class="table-title">${esc(provider.name)}</div>${row('🆔','ID',provider.id)}${row('🧩','Type',provider.type)}${row('📖','Read interface',String(provider.capabilities.read))}${row('✍️','Write enabled',String(provider.capabilities.write))}${row('🔄','Sync enabled',String(provider.capabilities.sync))}</div>`).join('')}</div>`;
  }
  function offlineQueue() {
    const candidate = ns.OfflineQueuePreview.previewEnqueue(queue, { operation: 'create', collection: 'products' });
    return `<div class="stats-grid"><div class="stat-card green"><div class="stat-value">${queue.count}</div><div class="stat-label">Queued Items</div></div><div class="stat-card blue"><div class="stat-value">${candidate.candidateQueue.count}</div><div class="stat-label">Preview After Candidate</div></div></div><div class="alert alert-warning" style="margin-top:12px">Queue Preview only: enqueued=${candidate.enqueued}, persisted=${candidate.persisted}, processing=${queue.processing}.</div>`;
  }
  function sync() {
    return `<div class="report-card">${row('📤','Source',syncPreview.sourceProvider)}${row('📥','Target',syncPreview.targetProvider)}${row('🔄','Status',syncPreview.status)}${row('📚','Collections',syncPreview.collections.join(', '))}${row('🚫','Synced',String(syncPreview.synced))}${row('🚫','Uploaded',String(syncPreview.uploaded))}${row('🚫','Downloaded',String(syncPreview.downloaded))}</div>`;
  }
  function repositoryStatus() {
    const validation = repository.validate();
    return `<div class="stats-grid"><div class="stat-card ${validation.valid ? 'green' : 'red'}"><div class="stat-value">${validation.valid ? 'Valid' : 'Review'}</div><div class="stat-label">Repository Validation</div></div><div class="stat-card blue"><div class="stat-value">${repository.list().length}</div><div class="stat-label">Snapshot Records</div></div></div><div class="report-card" style="margin-top:12px">${row('📚','Collection',repository.collection)}${row('🧩','Adapter',repository.adapterId)}${row('📖','Read only',String(repository.readOnly))}${row('✍️','Preview create executed',String(repository.previewCreate({ id: 'x' }).executed))}</div>`;
  }
  function transaction() {
    return `<div class="report-card">${row('🆔','Transaction',transactionPreview.id)}${row('📋','Operations',String(transactionPreview.operations.length))}${row('✅','Valid',String(transactionPreview.valid))}${row('🚫','Begun',String(transactionPreview.begun))}${row('🚫','Committed',String(transactionPreview.committed))}${row('🚫','Data changed',String(transactionPreview.dataChanged))}<div style="margin-top:10px">${transactionPreview.operations.map(operation => `<div class="alert alert-info">${esc(operation.operation)} · ${esc(operation.collection)} · executed=${operation.executed}</div>`).join('')}</div></div>`;
  }
  function content(view) {
    if (view === 'connection-status') return connections();
    if (view === 'storage-providers') return storageProviders();
    if (view === 'offline-queue') return offlineQueue();
    if (view === 'sync-preview') return sync();
    if (view === 'repository-status') return repositoryStatus();
    if (view === 'transaction-preview') return transaction();
    return overview();
  }
  function renderDataLayerPage(view) {
    const target = document.getElementById(`data-layer-${view}`);
    if (!target) return;
    target.innerHTML = `<div class="alert alert-info"><strong>Preview Only:</strong> لا اتصال، لا SQL، لا Supabase client، لا كتابة، لا مزامنة، لا رفع، ولا ترحيل.</div>${content(view)}`;
  }
  root.renderDataLayerPage = renderDataLayerPage;
  root.OmniDataLayerUi = Object.freeze({ version: '1.0.0', providers, repository, layerValidation, connectionHealth, renderDataLayerPage });
})(typeof globalThis !== 'undefined' ? globalThis : window);
