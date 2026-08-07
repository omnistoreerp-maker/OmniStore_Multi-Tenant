(function (root) {
  'use strict';
  const ns = root.OmniReleaseManager = root.OmniReleaseManager || {};
  function build(input = {}) {
    return Object.freeze({
      companyName: input.companyName || '{{COMPANY_NAME}}',
      logo: input.logo || '{{COMPANY_LOGO}}',
      primaryColor: input.primaryColor || '#2563eb',
      secondaryColor: input.secondaryColor || '#0f172a',
      currency: input.currency || 'EGP',
      language: input.language || 'ar',
      businessType: input.businessType || 'computer_shop',
      versionLabel: input.versionLabel || 'UAT/Beta',
      temporary: true,
      persisted: false
    });
  }
  ns.CustomerBrandingTemplateBuilder = Object.freeze({ version: '1.0.0', build });
})(typeof globalThis !== 'undefined' ? globalThis : window);
