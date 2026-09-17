(function (root) {
  'use strict';
  const ns = root.OmniAuthPreview = root.OmniAuthPreview || {};
  const MOCK_USERS = Object.freeze([
    { id: 'mock-owner', displayName: 'مالك تجريبي', role: 'owner', enabled: true },
    { id: 'mock-admin', displayName: 'مدير نظام تجريبي', role: 'admin', enabled: true },
    { id: 'mock-manager', displayName: 'مدير فرع تجريبي', role: 'manager', enabled: true },
    { id: 'mock-accountant', displayName: 'محاسب تجريبي', role: 'accountant', enabled: true },
    { id: 'mock-auditor', displayName: 'مراجع تجريبي', role: 'auditor', enabled: true },
    { id: 'mock-cashier', displayName: 'كاشير تجريبي', role: 'cashier', enabled: true }
  ].map(user => Object.freeze(user)));
  const find = id => MOCK_USERS.find(user => user.id === id) || null;
  ns.UserManager = Object.freeze({ version: '1.0.0', MOCK_USERS, find, list: () => MOCK_USERS.slice(), storage: 'none' });
})(typeof globalThis !== 'undefined' ? globalThis : window);
