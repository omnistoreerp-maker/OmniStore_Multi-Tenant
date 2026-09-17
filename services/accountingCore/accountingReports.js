(function (root) {
  'use strict';

  const core = () => root.OmniAccountingCore;
  const list = value => Array.isArray(value) ? value : [];
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const money = value => core().money(value);
  const text = value => String(value == null ? '' : value);

  function allEntries(snapshot) {
    return [
      ...list(snapshot && snapshot.sales).map(invoice => core().previewSale(invoice, snapshot)),
      ...list(snapshot && snapshot.purchases).map(invoice => core().previewPurchase(invoice, snapshot))
    ];
  }

  function trialBalance(snapshot) {
    const rows = {};
    allEntries(snapshot).forEach(entry => entry.lines.forEach(line => {
      const row = rows[line.accountKey] || (rows[line.accountKey] = {
        accountKey: line.accountKey,
        code: line.accountCode,
        name: line.accountName,
        nameAr: line.accountNameAr,
        debit: 0,
        credit: 0
      });
      row.debit = money(row.debit + line.debit);
      row.credit = money(row.credit + line.credit);
    }));
    const accounts = Object.values(rows).map(row => ({ ...row, balance: money(row.debit - row.credit) })).sort((a, b) => a.code.localeCompare(b.code));
    const debit = money(accounts.reduce((sum, row) => sum + row.debit, 0));
    const credit = money(accounts.reduce((sum, row) => sum + row.credit, 0));
    return { name: 'Trial Balance Preview', preview: true, accounts, debit, credit, difference: money(debit - credit), balanced: Math.abs(debit - credit) <= 0.01 };
  }

  function profitAndLoss(snapshot) {
    const saleRows = list(snapshot && snapshot.sales).map(invoice => core().previewSale(invoice, snapshot));
    const salesRevenue = money(saleRows.reduce((sum, row) => sum + row.revenue, 0));
    const costOfGoodsSold = money(saleRows.reduce((sum, row) => sum + row.cost, 0));
    const operatingExpenses = money(list(snapshot && snapshot.expenses).reduce((sum, row) => sum + number(row.amount ?? row.total ?? row.value), 0));
    const grossProfit = money(salesRevenue - costOfGoodsSold);
    const netProfit = money(grossProfit - operatingExpenses);
    const missingCostInvoices = saleRows.filter(row => row.profit === null).map(row => row.sourceId);
    return {
      name: 'Profit and Loss Preview',
      preview: true,
      salesRevenue,
      costOfGoodsSold,
      grossProfit,
      operatingExpenses,
      netProfit,
      reliable: missingCostInvoices.length === 0,
      missingCostInvoices
    };
  }

  function inventoryValuation(snapshot) {
    const rows = list(snapshot && snapshot.products).map(product => {
      const stock = core().productStock(product);
      const unitCost = core().purchaseUnitCost({}, product);
      return {
        productId: core().productId(product),
        name: text(product.name || product.productName),
        stock,
        unitCost: money(unitCost),
        value: money(stock * unitCost),
        missingCost: stock > 0 && !(unitCost > 0),
        negativeStock: stock < 0
      };
    });
    return {
      name: 'Inventory Valuation Preview',
      preview: true,
      rows,
      totalValue: money(rows.reduce((sum, row) => sum + row.value, 0)),
      missingCost: rows.filter(row => row.missingCost),
      negativeStock: rows.filter(row => row.negativeStock)
    };
  }

  function cashReconciliation(snapshot) {
    let incoming = 0;
    let outgoing = 0;
    const invalid = [];
    const runningDifferences = [];
    let calculated = 0;
    list(snapshot && snapshot.treasury).slice().reverse().forEach(row => {
      const normalized = core().normalizeTreasury(row);
      if (!normalized.direction || !(normalized.amount > 0)) invalid.push({ id: text(row.id), reason: 'invalid_direction_or_amount' });
      if (normalized.direction === 'in') {
        incoming += normalized.amount;
        calculated += normalized.amount;
      } else if (normalized.direction === 'out') {
        outgoing += normalized.amount;
        calculated -= normalized.amount;
      }
      if (Number.isFinite(normalized.balance) && Math.abs(money(calculated) - money(normalized.balance)) > 0.01) {
        runningDifferences.push({ id: text(row.id), expected: money(calculated), recorded: money(normalized.balance), difference: money(normalized.balance - calculated) });
      }
    });
    const declaredCashBoxes = money(list(snapshot && snapshot.cashBoxes).reduce((sum, row) => sum + number(row.balance ?? row.amount ?? row.total), 0));
    const calculatedBalance = money(incoming - outgoing);
    return {
      name: 'Cash Movement Reconciliation',
      preview: true,
      incoming: money(incoming),
      outgoing: money(outgoing),
      calculatedBalance,
      declaredCashBoxes,
      cashBoxDifference: list(snapshot && snapshot.cashBoxes).length ? money(declaredCashBoxes - calculatedBalance) : null,
      invalid,
      runningDifferences,
      reconciled: invalid.length === 0 && runningDifferences.length === 0 && (!list(snapshot && snapshot.cashBoxes).length || Math.abs(declaredCashBoxes - calculatedBalance) <= 0.01)
    };
  }

  function salesProfitAudit(snapshot) {
    const rows = list(snapshot && snapshot.sales).map(invoice => {
      const preview = core().previewSale(invoice, snapshot);
      return {
        id: text(invoice.id),
        date: invoice.date || invoice.createdAt || '',
        revenue: preview.revenue,
        cost: preview.cost,
        profit: preview.profit,
        balanced: preview.balanced,
        missingCost: preview.costing.missingCostItems.length,
        unlinkedItems: preview.costing.unlinkedItems.length,
        warnings: preview.warnings
      };
    });
    return { name: 'Sales Profit Audit', preview: true, rows, flagged: rows.filter(row => !row.balanced || row.missingCost || row.unlinkedItems) };
  }

  function purchaseCostAudit(snapshot) {
    const index = core().indexProducts(snapshot || {});
    const rows = list(snapshot && snapshot.purchases).map(invoice => {
      const preview = core().previewPurchase(invoice, snapshot);
      const items = core().invoiceItems(invoice);
      const missingCost = items.filter(item => !(core().purchaseUnitCost(item, core().resolveProduct(item, index)) > 0)).length;
      const unlinkedItems = items.filter(item => !core().resolveProduct(item, index)).length;
      return {
        id: text(invoice.id),
        date: invoice.date || invoice.createdAt || invoice.purchaseDate || '',
        total: preview.totals.debit,
        balanced: preview.balanced,
        missingCost,
        unlinkedItems,
        warnings: preview.warnings
      };
    });
    return { name: 'Purchase Cost Audit', preview: true, rows, flagged: rows.filter(row => !row.balanced || row.missingCost || row.unlinkedItems) };
  }

  function generate(snapshot) {
    return Object.freeze({
      generatedAt: new Date().toISOString(),
      readOnly: true,
      trialBalance: trialBalance(snapshot),
      profitAndLoss: profitAndLoss(snapshot),
      inventoryValuation: inventoryValuation(snapshot),
      cashReconciliation: cashReconciliation(snapshot),
      salesProfitAudit: salesProfitAudit(snapshot),
      purchaseCostAudit: purchaseCostAudit(snapshot)
    });
  }

  root.OmniAccountingReports = Object.freeze({
    allEntries,
    trialBalance,
    profitAndLoss,
    inventoryValuation,
    cashReconciliation,
    salesProfitAudit,
    purchaseCostAudit,
    generate
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
