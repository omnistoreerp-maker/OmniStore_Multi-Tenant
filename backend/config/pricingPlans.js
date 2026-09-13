'use strict';

const DEFAULT_PLANS = [
  {
    key: 'starter',
    name: 'Starter',
    tagline: 'Basic POS & ERP features',
    monthlyPrice: 49,
    annualPrice: 490,
    currency: 'EGP',
    features: [
      { included: true, text: 'Basic POS & invoicing' },
      { included: true, text: '1 branch' },
      { included: true, text: 'Base transaction logs' },
      { included: true, text: 'Email support' },
      { included: false, text: 'Custom domain' },
      { included: false, text: 'Advanced reports' },
      { included: false, text: 'WhatsApp integration' },
      { included: false, text: 'Priority support' }
    ],
    addonKeys: [],
    customDomainsAllowed: 0,
    platformSurchargePercent: 0,
    supportTier: 'standard',
    isPopular: false
  },
  {
    key: 'pro',
    name: 'Pro',
    tagline: 'Advanced operations',
    monthlyPrice: 99,
    annualPrice: 990,
    currency: 'EGP',
    features: [
      { included: true, text: 'Full POS & invoicing' },
      { included: true, text: 'Up to 3 branches' },
      { included: true, text: 'Advanced transaction logs' },
      { included: true, text: 'Advanced reports & analytics' },
      { included: true, text: '1 custom domain' },
      { included: true, text: 'WhatsApp integration ready' },
      { included: false, text: 'Unlimited custom domains' },
      { included: false, text: 'Priority support' }
    ],
    addonKeys: ['advanced_analytics', 'whatsapp'],
    customDomainsAllowed: 1,
    platformSurchargePercent: 0,
    supportTier: 'priority',
    isPopular: true
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    tagline: 'Full platform access',
    monthlyPrice: 199,
    annualPrice: 1990,
    currency: 'EGP',
    features: [
      { included: true, text: 'Full ERP suite' },
      { included: true, text: 'Unlimited branches' },
      { included: true, text: 'Full audit & reporting' },
      { included: true, text: 'Unlimited custom domains' },
      { included: true, text: 'All add-ons included' },
      { included: true, text: '0% platform surcharge option' },
      { included: true, text: 'Priority support' },
      { included: true, text: 'Dedicated onboarding' }
    ],
    addonKeys: ['advanced_analytics', 'whatsapp', 'multi_branch', 'market', 'loyalty'],
    customDomainsAllowed: -1,
    platformSurchargePercent: 0,
    supportTier: 'dedicated',
    isPopular: false
  }
];

function getAll() {
  return DEFAULT_PLANS.map((plan) => ({
    key: plan.key,
    name: plan.name,
    tagline: plan.tagline,
    monthlyPrice: plan.monthlyPrice,
    annualPrice: plan.annualPrice,
    currency: plan.currency,
    features: plan.features,
    addonKeys: plan.addonKeys,
    customDomainsAllowed: plan.customDomainsAllowed,
    platformSurchargePercent: plan.platformSurchargePercent,
    supportTier: plan.supportTier,
    isPopular: plan.isPopular
  }));
}

function getByKey(planKey) {
  if (!planKey) return null;
  return DEFAULT_PLANS.find((p) => String(p.key).toLowerCase() === String(planKey).toLowerCase()) || null;
}

function getPopular() {
  return DEFAULT_PLANS.find((p) => p.isPopular) || DEFAULT_PLANS[1] || null;
}

module.exports = {
  getAll,
  getByKey,
  getPopular
};
