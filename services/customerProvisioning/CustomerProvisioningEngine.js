(function (root) {
  'use strict';
  const ns = root.OmniCustomerProvisioning = root.OmniCustomerProvisioning || {};
  function create(options) {
    options = options || {};
    const client = ns.CustomerProvisioningClient.create(options.installerEngine);
    let customers = Object.freeze([]);
    let lastProvision = null;
    let lastDetails = null;
    let lastHealth = null;
    let lastHistory = Object.freeze([]);
    let lastAudit = Object.freeze([]);
    async function provision(input) {
      const validation = ns.ProvisioningValidator.validate(input);
      if (!validation.valid) return Object.freeze({ valid: false, errors: validation.errors, passwordRetained: false });
      const requestId = input.requestId || (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : `00000000-0000-4000-8000-${Date.now().toString().padStart(12, '0').slice(-12)}`);
      const payload = { ...input, requestId };
      const result = await client.provision(payload);
      const summary = ns.ProvisioningValidator.safeSummary(input);
      lastProvision = Object.freeze({ valid: true, result, report: ns.ProvisioningReportBuilder.build(result, summary) });
      return lastProvision;
    }
    async function refreshCustomers() {
      customers = ns.WorkspaceManager.normalizeList(await client.list());
      return customers;
    }
    async function loadDetails(tenantId) { const response = await client.details(tenantId); lastDetails = response.customer; return lastDetails; }
    async function checkHealth(tenantId) {
      const response = await client.health(tenantId);
      lastHealth = Object.freeze({ raw: response.health, isolation: ns.WorkspaceIsolationVerifier.verify(response.health) });
      return lastHealth;
    }
    async function loadHistory(tenantId) { const response = await client.history(tenantId); lastHistory = Object.freeze(response.history || []); return lastHistory; }
    async function loadAudit(tenantId) { const response = await client.audit(tenantId); lastAudit = Object.freeze(response.audit || []); return lastAudit; }
    async function rollbackPreview(tenantId) { const response = await client.rollbackPreview(tenantId); return response.rollback; }
    async function deleteCustomer(tenantId, confirmation) {
      const validation = ns.ProvisionRollbackManager.validateDeletion(tenantId, confirmation);
      if (!validation.valid) throw new Error('CUSTOMER_DELETE_CONFIRMATION_MISMATCH');
      const response = await client.deleteCustomer(tenantId, confirmation);
      customers = Object.freeze(customers.filter(customer => customer.tenantId !== tenantId));
      return response.deletion;
    }
    function state() { return Object.freeze({ customers, lastProvision, lastDetails, lastHealth, lastHistory, lastAudit, persistedInBrowser: false }); }
    return Object.freeze({ provision, refreshCustomers, loadDetails, checkHealth, loadHistory, loadAudit, rollbackPreview, deleteCustomer, state });
  }
  ns.CustomerProvisioningEngine = Object.freeze({ version: '1.0.0', create });
})(typeof globalThis !== 'undefined' ? globalThis : window);
