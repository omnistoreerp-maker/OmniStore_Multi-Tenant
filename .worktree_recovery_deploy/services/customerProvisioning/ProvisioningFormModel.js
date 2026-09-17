(function (root) {
  'use strict';
  const ns = root.OmniCustomerProvisioning = root.OmniCustomerProvisioning || {};
  const BUSINESS_TYPES = Object.freeze(['computer_shop','auto_parts','restaurant','supermarket','pharmacy','mobile_shop','clothes','jewelry','hardware','bookstore','agriculture','generic_store']);
  const SUBSCRIPTION_PLANS = Object.freeze(['free','basic','pro','enterprise']);
  const LANGUAGES = Object.freeze(['ar','en']);
  ns.ProvisioningFormModel = Object.freeze({
    version: '1.0.0',
    BUSINESS_TYPES,
    SUBSCRIPTION_PLANS,
    LANGUAGES,
    defaults: () => Object.freeze({ country: 'Egypt', timezone: 'Africa/Cairo', currency: 'EGP', businessType: 'computer_shop', subscriptionPlan: 'basic', language: 'ar' })
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
