(function (root) {
  'use strict';
  const ns = root.OmniDeployment = root.OmniDeployment || {};
  const SEEDS = Object.freeze({
    roles: Object.freeze(['owner','admin','manager','accountant','cashier']),
    permissions: Object.freeze(['products.read','products.write','sales.create','purchases.create','inventory.adjust','reports.view','accounting.preview']),
    accounts: Object.freeze(['Cash','Bank','Inventory Asset','Accounts Receivable','Accounts Payable','Sales Revenue','Cost Of Goods Sold','Expenses']),
    settings: Object.freeze(['pos','inventory','accounting','printing','system','theme']),
    defaults: Object.freeze(['main-branch','main-warehouse','main-cashbox','general-category'])
  });
  function plan() {
    return Object.freeze({ groups: SEEDS, recordsCreated: 0, seeded: false, executionBoundary: 'edge-function-only' });
  }
  ns.DefaultDataSeeder = Object.freeze({ version: '1.0.0', SEEDS, plan });
})(typeof globalThis !== 'undefined' ? globalThis : window);
