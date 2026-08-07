(function (root) {
  'use strict';

  const money = value => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) / 100 : 0;
  };
  const list = value => Array.isArray(value) ? value : [];
  const text = value => String(value == null ? '' : value).trim();
  const safeHtml = value => text(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  const OPERATIONS = Object.freeze([
    ['sales_invoice', 'Sales Invoice Preview'],
    ['purchase_invoice', 'Purchase Invoice Preview'],
    ['pos_sale', 'POS Sale Preview'],
    ['sales_return', 'Sales Return Preview'],
    ['purchase_return', 'Purchase Return Preview'],
    ['customer_payment', 'Customer Payment Preview'],
    ['supplier_payment', 'Supplier Payment Preview'],
    ['inventory_adjustment', 'Inventory Adjustment Preview'],
    ['inventory_transfer', 'Inventory Transfer Preview']
  ]);

  function appDb() {
    try { if (typeof DB !== 'undefined') return DB || {}; } catch (e) {}
    return root.DB || {};
  }

  function firstExistingArray(...candidates) {
    for (const candidate of candidates) {
      if (Array.isArray(candidate) && candidate.length) return candidate;
    }
    return [];
  }

  function products() {
    const db = appDb();
    try { return firstExistingArray(db.products, root.products, typeof productsList !== 'undefined' ? productsList : []); } catch (e) { return firstExistingArray(db.products, root.products); }
  }

  function salesInvoices() {
    const db = appDb();
    try { return firstExistingArray(db.saleInvoices, db.invoices, root.saleInvoices, root.invoices, typeof saleInvoices !== 'undefined' ? saleInvoices : []); } catch (e) { return firstExistingArray(db.saleInvoices, db.invoices, root.saleInvoices, root.invoices); }
  }

  function purchaseInvoices() {
    const db = appDb();
    try { return firstExistingArray(db.purchaseInvoices, db.purchases, root.purchaseInvoices, root.purchases, typeof purchaseInvoices !== 'undefined' ? purchaseInvoices : []); } catch (e) { return firstExistingArray(db.purchaseInvoices, db.purchases, root.purchaseInvoices, root.purchases); }
  }

  function latest(array) {
    return list(array)[list(array).length - 1] || null;
  }

  function productSeed() {
    const product = latest(products()) || {};
    return {
      itemId: text(product.id || product.productId || product.code || 'sample-product'),
      name: text(product.name || product.productName || 'Sample Product'),
      warehouseId: text(product.warehouseId || product.warehouse || 'main'),
      quantity: 1,
      price: money(product.sellPrice || product.salePrice || product.price || 100),
      unitCost: money(product.buyPrice || product.purchasePrice || product.cost || 60)
    };
  }

  function invoiceItems(invoice, fallbackItem) {
    const items = list(invoice && invoice.items);
    if (!items.length) return [fallbackItem];
    return items.map(item => ({
      itemId: text(item.itemId || item.productId || item.product_id || item.id || fallbackItem.itemId),
      name: text(item.name || item.productName || fallbackItem.name),
      warehouseId: text(item.warehouseId || item.warehouse || fallbackItem.warehouseId || 'main'),
      quantity: money(item.quantity || item.qty || 1),
      price: money(item.price || item.salePrice || item.unitPrice || fallbackItem.price),
      unitCost: money(item.unitCost || item.cost || item.buyPrice || fallbackItem.unitCost)
    }));
  }

  function readOnlyInventorySnapshot() {
    const productRows = products();
    const byId = new Map();
    productRows.forEach(product => {
      const id = text(product.id || product.productId || product.code);
      if (!id) return;
      byId.set(id, product);
    });
    return Object.freeze({
      onHandQty(itemId) {
        const product = byId.get(itemId) || {};
        return money(product.stock ?? product.qty ?? product.quantity ?? product.currentStock ?? 10);
      },
      averageCost(itemId) {
        const product = byId.get(itemId) || {};
        return Object.freeze({
          quantity: money(product.stock ?? product.qty ?? product.quantity ?? 10),
          value: 0,
          averageCost: money(product.cost || product.buyPrice || product.purchasePrice || 60)
        });
      }
    });
  }

  function createPreviewEngine() {
    if (!root.OmniERPIntegration || !root.OmniERPIntegration.ERPIntegrationEngine) throw new Error('ERP Integration Engine is not loaded.');
    if (!root.OmniAutoPosting || !root.OmniAutoPosting.AutoPostingEngine) throw new Error('Auto Posting Preview Engine is not loaded.');
    const accountingEngine = root.OmniEnterpriseAccounting && root.OmniEnterpriseAccounting.AccountingEngine
      ? root.OmniEnterpriseAccounting.AccountingEngine.createEngine()
      : null;
    const inventoryEngine = readOnlyInventorySnapshot();
    const autoPostingEngine = root.OmniAutoPosting.AutoPostingEngine.createEngine({ accountingEngine, inventoryEngine });
    return root.OmniERPIntegration.ERPIntegrationEngine.createEngine({ accountingEngine, inventoryEngine, autoPostingEngine });
  }

  function buildPreviewDocument(operation) {
    const seed = productSeed();
    const sale = latest(salesInvoices()) || {};
    const purchase = latest(purchaseInvoices()) || {};
    if (operation === 'sales_invoice') return { docType: 'sales_invoice', id: sale.id || 'sample-sale', customerId: sale.customerId || 'sample-customer', paymentType: sale.paymentType || sale.payment || 'credit', items: invoiceItems(sale, seed) };
    if (operation === 'purchase_invoice') return { docType: 'purchase_invoice', id: purchase.id || 'sample-purchase', supplierId: purchase.supplierId || 'sample-supplier', paymentType: purchase.paymentType || purchase.payment || 'credit', items: invoiceItems(purchase, seed) };
    if (operation === 'pos_sale') return { docType: 'pos_sale', id: 'sample-pos-sale', pos: true, paymentType: 'cash', items: [seed] };
    if (operation === 'sales_return') return { docType: 'sales_return', id: 'sample-sales-return', paymentType: 'cash', items: [seed] };
    if (operation === 'purchase_return') return { docType: 'purchase_return', id: 'sample-purchase-return', paymentType: 'credit', items: [seed] };
    if (operation === 'customer_payment') return { docType: 'customer_payment', id: 'sample-customer-payment', customerId: sale.customerId || 'sample-customer', amount: money(sale.total || sale.netTotal || 100) };
    if (operation === 'supplier_payment') return { docType: 'supplier_payment', id: 'sample-supplier-payment', supplierId: purchase.supplierId || 'sample-supplier', amount: money(purchase.total || purchase.netTotal || 100) };
    if (operation === 'inventory_adjustment') return { docType: 'inventory_adjustment', id: 'sample-adjustment', ...seed, currentQty: 10, targetQty: 12, quantity: 2 };
    if (operation === 'inventory_transfer') return { docType: 'inventory_transfer', id: 'sample-transfer', ...seed, fromWarehouseId: seed.warehouseId || 'main', toWarehouseId: 'branch' };
    return { docType: operation, items: [seed] };
  }

  function renderAmount(label, value) {
    return `<div class="stat-card blue" style="padding:12px"><div class="stat-value" style="font-size:1.1rem">${money(value).toLocaleString()}</div><div class="stat-label">${safeHtml(label)}</div></div>`;
  }

  function renderRows(rows, empty, columns) {
    if (!list(rows).length) return `<tr><td colspan="${columns}" style="text-align:center;color:var(--text2)">${safeHtml(empty)}</td></tr>`;
    return rows.join('');
  }

  function renderPreviewResult(preview) {
    const target = document.getElementById('erpPreviewResult');
    if (!target) return;
    const journal = preview.accountingEffect && preview.accountingEffect.journalPreview || [];
    const inventory = preview.inventoryEffect || [];
    const related = preview.relatedDocuments || [];
    const warnings = preview.warnings || [];
    const errors = preview.validationErrors || [];
    target.innerHTML = `
      <div class="alert alert-info" style="font-size:.82rem;margin-bottom:12px">Simulation only — Preview Only — No Posting. لم يتم حفظ أو ترحيل أو تعديل أي بيانات.</div>
      <div class="stats-grid" style="margin-bottom:14px">
        ${renderAmount('Cost Effect', preview.costEffect)}
        ${renderAmount('Profit Effect', preview.profitEffect || 0)}
        ${renderAmount('Cash Effect', preview.cashEffect)}
        ${renderAmount('Customer/Supplier Effect', preview.customerSupplierEffect)}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px">
        <div class="table-container">
          <div class="table-header"><div class="table-title">📒 Accounting Journal Preview</div></div>
          <div class="overflow-x"><table class="data-table"><thead><tr><th>Account</th><th>Debit</th><th>Credit</th><th>Notes</th></tr></thead><tbody>
            ${renderRows(journal.map(line => `<tr><td>${safeHtml(line.account)}</td><td>${money(line.debit).toLocaleString()}</td><td>${money(line.credit).toLocaleString()}</td><td>${safeHtml(line.notes)}</td></tr>`), 'No journal lines for this preview.', 4)}
          </tbody></table></div>
        </div>
        <div class="table-container">
          <div class="table-header"><div class="table-title">📦 Inventory Impact Preview</div></div>
          <div class="overflow-x"><table class="data-table"><thead><tr><th>Item</th><th>Warehouse</th><th>Direction</th><th>Qty</th><th>Cost</th><th>On Hand After</th></tr></thead><tbody>
            ${renderRows(inventory.map(row => `<tr><td>${safeHtml(row.name || row.itemId)}</td><td>${safeHtml(row.warehouseId)}</td><td>${safeHtml(row.direction)}</td><td>${money(row.quantity).toLocaleString()}</td><td>${money(row.costEffect || row.costImpact).toLocaleString()}</td><td>${row.onHandAfter == null ? '-' : money(row.onHandAfter).toLocaleString()}</td></tr>`), 'No inventory impact for this preview.', 6)}
          </tbody></table></div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin-top:14px">
        <div class="report-card"><div class="table-title">⚠️ Warnings</div>${warnings.length ? warnings.map(w => `<div class="alert alert-warning" style="font-size:.8rem">${safeHtml(w.code || 'WARNING')}: ${safeHtml(w.message || w)}</div>`).join('') : '<div style="color:var(--text2)">No warnings.</div>'}</div>
        <div class="report-card"><div class="table-title">⛔ Validation Errors</div>${errors.length ? errors.map(e => `<div class="alert alert-danger" style="font-size:.8rem">${safeHtml(e.code || 'ERROR')}: ${safeHtml(e.message || e)}</div>`).join('') : '<div style="color:var(--text2)">No validation errors.</div>'}</div>
        <div class="report-card"><div class="table-title">🔗 Related Documents</div>${related.length ? related.map(doc => `<div class="badge" style="margin:3px">${safeHtml(doc.type)}: ${safeHtml(doc.id)}</div>`).join('') : '<div style="color:var(--text2)">No related documents.</div>'}</div>
      </div>`;
  }

  function runERPPreview(operation) {
    const op = operation || (document.getElementById('erpPreviewOperation') && document.getElementById('erpPreviewOperation').value) || 'sales_invoice';
    try {
      const engine = createPreviewEngine();
      const preview = engine.preview(buildPreviewDocument(op));
      renderPreviewResult(preview);
      const status = document.getElementById('erpPreviewStatus');
      if (status) status.innerHTML = `<span class="badge">Preview Only — No Posting</span> ${safeHtml(op)}`;
    } catch (error) {
      const target = document.getElementById('erpPreviewResult');
      if (target) target.innerHTML = `<div class="alert alert-danger">Preview engine unavailable: ${safeHtml(error.message)}</div>`;
    }
  }

  function renderERPPreviewCenter() {
    const select = document.getElementById('erpPreviewOperation');
    const buttons = document.getElementById('erpPreviewOperationButtons');
    if (select) {
      select.innerHTML = OPERATIONS.map(([id, label]) => `<option value="${id}">${safeHtml(label)}</option>`).join('');
    }
    if (buttons) {
      buttons.innerHTML = OPERATIONS.map(([id, label]) => `<button type="button" class="btn btn-outline btn-sm" onclick="runERPPreview('${id}')">Preview Only — No Posting: ${safeHtml(label)}</button>`).join('');
    }
    runERPPreview(select && select.value || 'sales_invoice');
  }

  root.renderERPPreviewCenter = renderERPPreviewCenter;
  root.runERPPreview = runERPPreview;
  root.OmniERPPreviewUi = Object.freeze({ version: '1.0.0', OPERATIONS, buildPreviewDocument, renderERPPreviewCenter, runERPPreview });
})(typeof globalThis !== 'undefined' ? globalThis : window);
