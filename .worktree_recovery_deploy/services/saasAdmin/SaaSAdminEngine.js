(function (root) {
  'use strict';
  const ns = root.OmniSaaSAdmin = root.OmniSaaSAdmin || {};
  function create(options) {
    const client = ns.SaaSAdminClient.create(options);
    let state = {
      dashboard: null, plans: Object.freeze([]), customers: Object.freeze([]), selectedCustomer: null,
      billing: ns.BillingPreviewEngine.normalize(), notifications: ns.NotificationPreviewEngine.normalize(),
      licenseAudit: Object.freeze([]), subscriptionHistory: Object.freeze([]), lastAction: null
    };
    const set = patch => { state = { ...state, ...patch }; return snapshot(); };
    const snapshot = () => Object.freeze({ ...state, connection: client.status(), persisted: false });
    async function connect(config) { const result = await client.connect(config); if (result.valid) await initialize(); return result; }
    async function initialize() { const result = await client.invoke('initialize'); return set({ lastAction: Object.freeze({ type: 'initialize', result }) }); }
    async function refreshDashboard() { const result = await client.invoke('dashboard'); return set({ dashboard: ns.SaaSAdminReportBuilder.dashboard(result.dashboard) }).dashboard; }
    async function loadPlans() { const result = await client.invoke('plans'); return set({ plans: ns.SubscriptionPlanManager.normalize(result.plans) }).plans; }
    async function loadCustomers() { const result = await client.invoke('customers'); return set({ customers: ns.CustomerAdministration.normalizeList(result.customers) }).customers; }
    async function loadCustomer(tenantId) { const result = await client.invoke('customer-details', { tenantId }); return set({ selectedCustomer: ns.CustomerAdministration.normalize(result.customer) }).selectedCustomer; }
    async function action(action, payload) { const result = await client.invoke(action, payload); set({ lastAction: Object.freeze({ type: action, result }) }); return result; }
    async function generateLicense(tenantId, planCode, customExpiresAt) { return action('generate-license', { tenantId, planCode, customExpiresAt }); }
    async function validateLicense(licenseKey) {
      const format = ns.LicenseManager.validateFormat(licenseKey);
      if (!format.valid) return Object.freeze({ validation: { valid: false, status: 'invalid_format' } });
      return action('validate-license', { licenseKey: format.normalized });
    }
    async function loadBilling(tenantId) { const result = await client.invoke('billing-preview', tenantId ? { tenantId } : {}); return set({ billing: ns.BillingPreviewEngine.normalize(result.billing) }).billing; }
    async function loadNotifications() { const result = await client.invoke('notifications-preview'); return set({ notifications: ns.NotificationPreviewEngine.normalize(result.notifications) }).notifications; }
    async function loadLicenseAudit() { const result = await client.invoke('license-audit'); return set({ licenseAudit: Object.freeze(result.audit || []) }).licenseAudit; }
    async function loadSubscriptionHistory() { const result = await client.invoke('subscription-history'); return set({ subscriptionHistory: Object.freeze(result.history || []) }).subscriptionHistory; }
    async function updatePlan(planCode, input) {
      const validation = ns.PlanLimitValidator.validate(input && input.limits);
      if (!validation.valid) return Object.freeze({ valid: false, errors: validation.errors });
      const result = await action('update-plan', { planCode, price: Number(input.price || 0), currency: input.currency || 'USD', limits: validation.limits });
      await loadPlans();
      return Object.freeze({ valid: true, plan: result.plan });
    }
    return Object.freeze({
      connect, initialize, refreshDashboard, loadPlans, loadCustomers, loadCustomer, action,
      generateLicense, validateLicense, loadBilling, loadNotifications, loadLicenseAudit,
      loadSubscriptionHistory, updatePlan, snapshot, clear: () => client.clear()
    });
  }
  ns.SaaSAdminEngine = Object.freeze({ version: '1.0.0', create });
})(typeof globalThis !== 'undefined' ? globalThis : window);
