(function (root) {
  'use strict';
  const ns = root.OmniERPIntegration = root.OmniERPIntegration || {};
  const v = () => ns.IntegrationValidator;

  function consumption(document = {}, context = {}) {
    const lines = v().list(document.components || document.items);
    const inventoryEffect = ns.InventoryIntegrationAdapter.effect(lines, 'out', context.inventoryEngine);
    const cost = v().money(inventoryEffect.reduce((sum, row) => sum + row.costEffect, 0));
    const accountingEffect = ns.AccountingIntegrationAdapter.manual([
      { account: 'work_in_process', debit: cost, credit: 0, notes: 'Manufacturing consumption' },
      { account: 'inventory_asset', debit: 0, credit: cost, notes: 'Component issue' }
    ], [], ['work_in_process is a draft integration account.']);
    return { operation: 'manufacturing_consumption', inventoryImpact: inventoryEffect, accountingEffect, costImpact: cost, profitImpact: null, cashImpact: 0, validationErrors: [], warnings: accountingEffect.warnings };
  }

  function production(document = {}, context = {}) {
    const lines = v().list(document.outputs || document.items);
    const inventoryEffect = ns.InventoryIntegrationAdapter.effect(lines, 'in', context.inventoryEngine);
    const cost = v().money(inventoryEffect.reduce((sum, row) => sum + row.costEffect, 0));
    const accountingEffect = ns.AccountingIntegrationAdapter.manual([
      { account: 'inventory_asset', debit: cost, credit: 0, notes: 'Finished goods production' },
      { account: 'work_in_process', debit: 0, credit: cost, notes: 'Release WIP' }
    ], [], ['work_in_process is a draft integration account.']);
    return { operation: 'manufacturing_production', inventoryImpact: inventoryEffect, accountingEffect, costImpact: cost, profitImpact: null, cashImpact: 0, validationErrors: [], warnings: accountingEffect.warnings };
  }

  ns.ManufacturingIntegrationAdapter = Object.freeze({ version: '1.0.0', consumption, production });
})(typeof globalThis !== 'undefined' ? globalThis : window);
