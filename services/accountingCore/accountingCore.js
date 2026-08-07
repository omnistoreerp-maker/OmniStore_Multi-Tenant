(function (root) {
  'use strict';

  const EPSILON = 0.01;
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const list = value => Array.isArray(value) ? value : [];
  const number = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const money = value => Math.round((number(value) + Number.EPSILON) * 100) / 100;
  const text = value => String(value == null ? '' : value).trim();
  const lower = value => text(value).toLowerCase();
  const coa = () => root.OmniChartOfAccounts;

  function account(key) {
    const found = coa() && coa().get(key);
    if (!found) throw new Error(`Unknown accounting account: ${key}`);
    return found;
  }

  function line(accountKey, debit, credit, memo) {
    const current = account(accountKey);
    return Object.freeze({
      accountKey,
      accountCode: current.code,
      accountName: current.name,
      accountNameAr: current.nameAr,
      debit: money(debit),
      credit: money(credit),
      memo: text(memo)
    });
  }

  function journal(type, source, lines, warnings) {
    const totals = lines.reduce((sum, item) => ({
      debit: money(sum.debit + item.debit),
      credit: money(sum.credit + item.credit)
    }), { debit: 0, credit: 0 });
    return Object.freeze({
      id: `preview:${type}:${text(source && source.id) || 'unknown'}`,
      preview: true,
      readOnly: true,
      type,
      sourceId: text(source && source.id),
      date: source && (source.date || source.createdAt || source.purchaseDate) || '',
      lines: Object.freeze(lines),
      totals: Object.freeze(totals),
      difference: money(totals.debit - totals.credit),
      balanced: Math.abs(totals.debit - totals.credit) <= EPSILON,
      warnings: Object.freeze(warnings || [])
    });
  }

  function itemProductId(item) {
    return text(item && (item.productId ?? item.product_id ?? item.legacy_product_id));
  }

  function productId(product) {
    return text(product && (product.id ?? product.productId ?? product.legacy_product_id));
  }

  function invoiceItems(invoice) {
    if (Array.isArray(invoice && invoice.items)) return invoice.items;
    if (invoice && (invoice.productId || invoice.product_id)) {
      return [{
        productId: invoice.productId || invoice.product_id,
        name: invoice.productName || invoice.name,
        qty: invoice.qty || invoice.quantity || 1,
        price: invoice.price,
        total: invoice.total
      }];
    }
    return [];
  }

  function indexProducts(snapshot) {
    const byId = {};
    const byName = {};
    list(snapshot && snapshot.products).forEach(product => {
      const id = productId(product);
      if (id) byId[id] = product;
      const name = lower(product.name || product.productName);
      if (name && !byName[name]) byName[name] = product;
    });
    return { byId, byName };
  }

  function resolveProduct(item, productIndex) {
    const id = itemProductId(item);
    if (id && productIndex.byId[id]) return productIndex.byId[id];
    return productIndex.byName[lower(item && (item.name || item.productName))] || null;
  }

  function quantity(item) {
    return Math.max(0, number(item && (item.qty ?? item.quantity), 0));
  }

  function saleUnitPrice(item) {
    const qty = quantity(item);
    const direct = number(item && (item.price ?? item.salePrice), NaN);
    if (Number.isFinite(direct)) return Math.max(0, direct);
    return qty ? Math.max(0, number(item && item.total) / qty) : 0;
  }

  function purchaseUnitCost(item, product) {
    const candidates = [
      item && item.buyPrice,
      item && item.purchasePrice,
      item && item.cost,
      item && item.unitCost,
      product && product.buyPrice,
      product && product.purchasePrice,
      product && product.cost
    ];
    for (const candidate of candidates) {
      const parsed = number(candidate, NaN);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return 0;
  }

  function invoiceTotal(invoice, items) {
    const candidates = [invoice && invoice.accountingNetTotal, invoice && invoice.netTotal, invoice && invoice.grandTotal, invoice && invoice.total];
    for (const candidate of candidates) {
      const parsed = number(candidate, NaN);
      if (Number.isFinite(parsed)) return Math.max(0, money(parsed));
    }
    return money(list(items).reduce((sum, item) => sum + (quantity(item) * saleUnitPrice(item)), 0));
  }

  function isCreditInvoice(invoice) {
    const mode = lower(invoice && (invoice.invoiceType || invoice.payment || invoice.paymentMethod));
    return ['ajel', 'credit', 'installment', 'deferred', 'آجل'].includes(mode);
  }

  function calculateSaleCost(invoice, snapshot) {
    const productIndex = indexProducts(snapshot || {});
    const details = invoiceItems(invoice).map(item => {
      const product = resolveProduct(item, productIndex);
      const qty = quantity(item);
      const unitCost = purchaseUnitCost(item, product);
      return {
        item: clone(item),
        product: product ? clone(product) : null,
        linked: !!product,
        quantity: qty,
        unitCost: money(unitCost),
        cost: money(qty * unitCost),
        missingCost: qty > 0 && !(unitCost > 0)
      };
    });
    return {
      details,
      totalCost: money(details.reduce((sum, detail) => sum + detail.cost, 0)),
      missingCostItems: details.filter(detail => detail.missingCost),
      unlinkedItems: details.filter(detail => !detail.linked)
    };
  }

  function previewSale(invoice, snapshot) {
    const safeInvoice = clone(invoice || {});
    const items = invoiceItems(safeInvoice);
    const revenue = invoiceTotal(safeInvoice, items);
    const costing = calculateSaleCost(safeInvoice, snapshot || {});
    const netCostCandidate = number(safeInvoice.accountingNetCost, NaN);
    const resolvedCost = Number.isFinite(netCostCandidate) && netCostCandidate >= 0 && !costing.missingCostItems.length
      ? money(netCostCandidate)
      : costing.totalCost;
    const warnings = [];
    if (!items.length) warnings.push({ code: 'SALE_WITHOUT_ITEMS', severity: 'error', message: 'فاتورة البيع لا تحتوي على أصناف.' });
    costing.missingCostItems.forEach(detail => warnings.push({
      code: 'SALE_ITEM_WITHOUT_COST',
      severity: 'error',
      productId: itemProductId(detail.item),
      message: `لا يمكن اعتماد الربح لصنف بلا تكلفة: ${text(detail.item.name || detail.item.productName) || 'غير معروف'}`
    }));
    costing.unlinkedItems.forEach(detail => warnings.push({
      code: 'SALE_ITEM_UNLINKED',
      severity: 'error',
      productId: itemProductId(detail.item),
      message: `صنف البيع غير مرتبط بمنتج حالي: ${text(detail.item.name || detail.item.productName) || 'غير معروف'}`
    }));
    costing.details.filter(detail => detail.product && productStock(detail.product) < 0).forEach(detail => warnings.push({
      code: 'SALE_EXCEEDS_AVAILABLE_STOCK',
      severity: 'error',
      productId: productId(detail.product),
      availableStock: productStock(detail.product),
      soldQuantity: detail.quantity,
      message: `بيع بكمية غير متاحة أدى إلى مخزون سالب: ${text(detail.product.name) || productId(detail.product)}`
    }));
    const lines = [
      line(isCreditInvoice(safeInvoice) ? 'accounts_receivable' : 'cash', revenue, 0, `Sale ${safeInvoice.id || ''}`),
      line('sales_revenue', 0, revenue, `Sale ${safeInvoice.id || ''}`),
      line('cost_of_goods_sold', resolvedCost, 0, `COGS ${safeInvoice.id || ''}`),
      line('inventory_asset', 0, resolvedCost, `Inventory issue ${safeInvoice.id || ''}`)
    ];
    const preview = journal('sale', safeInvoice, lines, warnings);
    return Object.freeze({
      ...preview,
      revenue,
      cost: resolvedCost,
      profit: costing.missingCostItems.length ? null : money(revenue - resolvedCost),
      costing: Object.freeze(costing)
    });
  }

  function previewPurchase(invoice, snapshot) {
    const safeInvoice = clone(invoice || {});
    const items = invoiceItems(safeInvoice);
    const amount = invoiceTotal(safeInvoice, items);
    const productIndex = indexProducts(snapshot || {});
    const warnings = [];
    if (!items.length) warnings.push({ code: 'PURCHASE_WITHOUT_ITEMS', severity: 'error', message: 'فاتورة الشراء لا تحتوي على أصناف.' });
    items.forEach(item => {
      if (!resolveProduct(item, productIndex)) warnings.push({
        code: 'PURCHASE_ITEM_UNLINKED',
        severity: 'error',
        productId: itemProductId(item),
        message: `صنف الشراء غير مرتبط بمنتج حالي: ${text(item.name || item.productName) || 'غير معروف'}`
      });
      if (!(purchaseUnitCost(item, resolveProduct(item, productIndex)) > 0)) warnings.push({
        code: 'PURCHASE_ITEM_WITHOUT_COST',
        severity: 'error',
        productId: itemProductId(item),
        message: `صنف الشراء بلا تكلفة موجبة: ${text(item.name || item.productName) || 'غير معروف'}`
      });
    });
    return journal('purchase', safeInvoice, [
      line('inventory_asset', amount, 0, `Purchase ${safeInvoice.id || ''}`),
      line(isCreditInvoice(safeInvoice) ? 'accounts_payable' : 'cash', 0, amount, `Purchase ${safeInvoice.id || ''}`)
    ], warnings);
  }

  function validateJournal(entry) {
    const lines = list(entry && entry.lines);
    const debit = money(lines.reduce((sum, item) => sum + number(item.debit), 0));
    const credit = money(lines.reduce((sum, item) => sum + number(item.credit), 0));
    const issues = [];
    if (!lines.length) issues.push({ code: 'EMPTY_JOURNAL', severity: 'error', message: 'القيد لا يحتوي على سطور.' });
    lines.forEach((item, index) => {
      if (number(item.debit) < 0 || number(item.credit) < 0) issues.push({ code: 'NEGATIVE_JOURNAL_AMOUNT', severity: 'error', line: index + 1, message: 'قيمة سالبة داخل القيد.' });
      if (number(item.debit) > 0 && number(item.credit) > 0) issues.push({ code: 'DOUBLE_SIDED_LINE', severity: 'error', line: index + 1, message: 'سطر القيد لا يجوز أن يكون مدينًا ودائنًا معًا.' });
    });
    if (Math.abs(debit - credit) > EPSILON) issues.push({ code: 'UNBALANCED_JOURNAL', severity: 'error', difference: money(debit - credit), message: 'القيد غير متوازن.' });
    return Object.freeze({ valid: issues.length === 0, balanced: Math.abs(debit - credit) <= EPSILON, debit, credit, difference: money(debit - credit), issues });
  }

  function normalizeTreasury(row) {
    const raw = lower(row && (row.type ?? row.direction ?? row.cashType ?? row.transactionType ?? row.kind));
    const incoming = ['in', 'income', 'credit', 'deposit', 'receive', 'received', 'وارد', 'ايراد', 'إيراد', 'تحصيل'];
    const outgoing = ['out', 'expense', 'debit', 'withdraw', 'withdrawal', 'pay', 'paid', 'صادر', 'مصروف', 'دفع', 'سحب'];
    let direction = incoming.includes(raw) ? 'in' : outgoing.includes(raw) ? 'out' : '';
    if (!direction && number(row && (row.inAmount ?? row.in ?? row.creditAmount ?? row.credit)) > 0) direction = 'in';
    if (!direction && number(row && (row.outAmount ?? row.out ?? row.debitAmount ?? row.debit)) > 0) direction = 'out';
    const direct = number(row && (row.amount ?? row.value ?? row.total), NaN);
    const amount = Number.isFinite(direct) && direct !== 0
      ? Math.abs(direct)
      : direction === 'in'
        ? number(row && (row.inAmount ?? row.in ?? row.creditAmount ?? row.credit))
        : number(row && (row.outAmount ?? row.out ?? row.debitAmount ?? row.debit));
    return { direction, amount: money(Math.abs(amount)), balance: number(row && (row.balance ?? row.runningBalance ?? row.balanceAfter), NaN) };
  }

  function productStock(product) {
    const candidates = [product && product.accountingStock, product && product.currentStock, product && product.stock, product && product.stockQty, product && product.quantity];
    for (const candidate of candidates) {
      const parsed = number(candidate, NaN);
      if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
  }

  function validateSnapshot(snapshot) {
    const safe = clone(snapshot || {});
    const errors = [];
    const warnings = [];
    const entries = [];
    const push = issue => (issue.severity === 'error' ? errors : warnings).push(issue);

    list(safe.sales).forEach(invoice => {
      const preview = previewSale(invoice, safe);
      entries.push(preview);
      preview.warnings.forEach(issue => push({ ...issue, sourceType: 'sale', sourceId: text(invoice.id) }));
      const checked = validateJournal(preview);
      checked.issues.forEach(issue => push({ ...issue, sourceType: 'sale', sourceId: text(invoice.id) }));
    });
    list(safe.purchases).forEach(invoice => {
      const preview = previewPurchase(invoice, safe);
      entries.push(preview);
      preview.warnings.forEach(issue => push({ ...issue, sourceType: 'purchase', sourceId: text(invoice.id) }));
      const checked = validateJournal(preview);
      checked.issues.forEach(issue => push({ ...issue, sourceType: 'purchase', sourceId: text(invoice.id) }));
    });
    list(safe.treasury).forEach(row => {
      const normalized = normalizeTreasury(row);
      if (!normalized.direction) push({ code: 'TREASURY_DIRECTION_UNKNOWN', severity: 'error', sourceType: 'treasury', sourceId: text(row.id), message: 'اتجاه حركة الخزنة غير معروف.' });
      if (!(normalized.amount > 0)) push({ code: 'TREASURY_AMOUNT_INVALID', severity: 'error', sourceType: 'treasury', sourceId: text(row.id), message: 'حركة الخزنة بلا مبلغ موجب.' });
    });
    list(safe.stockMovements).forEach(row => {
      const direction = lower(row.type || row.direction);
      if (!['in', 'out', 'adjustment', 'transfer'].includes(direction)) push({ code: 'STOCK_DIRECTION_UNKNOWN', severity: 'warning', sourceType: 'inventory', sourceId: text(row.id), message: 'اتجاه حركة المخزون غير معروف.' });
      const product = indexProducts(safe).byId[text(row.productId)];
      if (direction === 'out' && !(purchaseUnitCost(row, product) > 0)) push({ code: 'STOCK_MOVEMENT_WITHOUT_COST', severity: 'warning', sourceType: 'inventory', sourceId: text(row.id), productId: text(row.productId), message: 'حركة خروج مخزون بلا تكلفة قابلة للتحقق.' });
    });
    list(safe.products).forEach(product => {
      const stock = productStock(product);
      const cost = purchaseUnitCost({}, product);
      if (stock < 0) push({ code: 'NEGATIVE_STOCK', severity: 'warning', sourceType: 'inventory', sourceId: productId(product), productId: productId(product), message: `مخزون سالب: ${text(product.name) || productId(product)}`, stock });
      if (stock > 0 && !(cost > 0)) push({ code: 'PRODUCT_WITHOUT_COST', severity: 'warning', sourceType: 'inventory', sourceId: productId(product), productId: productId(product), message: `منتج له مخزون بدون تكلفة: ${text(product.name) || productId(product)}`, stock });
    });

    return Object.freeze({
      generatedAt: new Date().toISOString(),
      readOnly: true,
      entries: Object.freeze(entries),
      errors: Object.freeze(errors),
      warnings: Object.freeze(warnings),
      unbalanced: Object.freeze(entries.filter(entry => !entry.balanced)),
      summary: Object.freeze({
        sales: list(safe.sales).length,
        purchases: list(safe.purchases).length,
        products: list(safe.products).length,
        errors: errors.length,
        warnings: warnings.length,
        unbalanced: entries.filter(entry => !entry.balanced).length
      })
    });
  }

  root.OmniAccountingCore = Object.freeze({
    version: '1.0.0-preview',
    mode: 'simulation-read-only',
    clone,
    money,
    invoiceItems,
    itemProductId,
    productId,
    indexProducts,
    resolveProduct,
    productStock,
    purchaseUnitCost,
    calculateSaleCost,
    previewSale,
    previewPurchase,
    validateJournal,
    normalizeTreasury,
    validateSnapshot
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
