(function (root) {
  'use strict';
  const ns = root.OmniDeployment = root.OmniDeployment || {};
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function validateCustomer(input) {
    input = input || {};
    const errors = [];
    const required = ['customerName','businessName','email','password','country','currency','timezone'];
    required.forEach(field => { if (!String(input[field] || '').trim()) errors.push({ code: 'REQUIRED', field }); });
    if (input.email && !EMAIL.test(String(input.email))) errors.push({ code: 'INVALID_EMAIL', field: 'email' });
    if (input.password && String(input.password).length < 8) errors.push({ code: 'WEAK_PASSWORD', field: 'password' });
    return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors), passwordRetained: false });
  }
  function validateAdmin(context) {
    const allowed = Boolean(context && context.authenticated === true && ['owner','admin'].includes(context.role));
    return Object.freeze({ valid: allowed, errors: allowed ? Object.freeze([]) : Object.freeze([{ code: 'AUTHENTICATED_ADMIN_REQUIRED' }]) });
  }
  ns.DeploymentValidator = Object.freeze({ version: '1.0.0', validateCustomer, validateAdmin });
})(typeof globalThis !== 'undefined' ? globalThis : window);
