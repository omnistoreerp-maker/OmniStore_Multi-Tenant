(function (root) {
  'use strict';
  const ns = root.OmniCustomerProvisioning = root.OmniCustomerProvisioning || {};
  function validate(input) {
    input = input || {};
    const errors = [];
    ['businessName','ownerName','email','password','country','timezone','currency','businessType','subscriptionPlan','language'].forEach(field => {
      if (!String(input[field] || '').trim()) errors.push({ field, code: 'REQUIRED' });
    });
    if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input.email))) errors.push({ field: 'email', code: 'INVALID_EMAIL' });
    if (input.password && String(input.password).length < 10) errors.push({ field: 'password', code: 'PASSWORD_MINIMUM_10' });
    if (input.businessType && !ns.ProvisioningFormModel.BUSINESS_TYPES.includes(input.businessType)) errors.push({ field: 'businessType', code: 'INVALID_BUSINESS_TYPE' });
    if (input.subscriptionPlan && !ns.ProvisioningFormModel.SUBSCRIPTION_PLANS.includes(input.subscriptionPlan)) errors.push({ field: 'subscriptionPlan', code: 'INVALID_PLAN' });
    if (input.language && !ns.ProvisioningFormModel.LANGUAGES.includes(input.language)) errors.push({ field: 'language', code: 'INVALID_LANGUAGE' });
    if (input.companyLogo && (!/^image\/(png|jpeg|webp|svg\+xml)$/i.test(input.companyLogo.mimeType || '') || String(input.companyLogo.base64 || '').length > 2800000)) errors.push({ field: 'companyLogo', code: 'INVALID_LOGO' });
    return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors), passwordRetained: false });
  }
  function safeSummary(input) {
    return Object.freeze({
      businessName: String(input.businessName || '').trim(),
      ownerName: String(input.ownerName || '').trim(),
      email: String(input.email || '').trim().toLowerCase(),
      phone: String(input.phone || '').trim(),
      country: String(input.country || '').trim(),
      timezone: String(input.timezone || '').trim(),
      currency: String(input.currency || '').trim().toUpperCase(),
      businessType: input.businessType,
      subscriptionPlan: input.subscriptionPlan,
      language: input.language,
      logoProvided: Boolean(input.companyLogo),
      passwordProvided: Boolean(input.password)
    });
  }
  ns.ProvisioningValidator = Object.freeze({ version: '1.0.0', validate, safeSummary });
})(typeof globalThis !== 'undefined' ? globalThis : window);
