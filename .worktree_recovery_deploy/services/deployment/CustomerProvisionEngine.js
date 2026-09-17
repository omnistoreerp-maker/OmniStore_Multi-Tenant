(function (root) {
  'use strict';
  const ns = root.OmniDeployment = root.OmniDeployment || {};
  function plan(input) {
    const validation = ns.DeploymentValidator.validateCustomer(input);
    const safeCustomer = Object.freeze({
      customerName: String(input && input.customerName || '').trim(),
      businessName: String(input && input.businessName || '').trim(),
      email: String(input && input.email || '').trim().toLowerCase(),
      country: String(input && input.country || '').trim(),
      currency: String(input && input.currency || '').trim().toUpperCase(),
      timezone: String(input && input.timezone || '').trim(),
      passwordProvided: Boolean(input && input.password)
    });
    return Object.freeze({
      valid: validation.valid,
      errors: validation.errors,
      customer: safeCustomer,
      tenantCodePreview: safeCustomer.businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'new-customer',
      passwordRetained: false,
      userCreated: false,
      tenantCreated: false
    });
  }
  ns.CustomerProvisionEngine = Object.freeze({ version: '1.0.0', plan });
})(typeof globalThis !== 'undefined' ? globalThis : window);
