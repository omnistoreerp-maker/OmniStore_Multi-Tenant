(function (root) {
  'use strict';
  const ns = root.OmniAuthPreview = root.OmniAuthPreview || {};
  const POLICY = Object.freeze({ minimumLength: 8, uppercase: true, lowercase: true, number: true, specialCharacter: true });
  function validateCandidate(candidate) {
    const value = String(candidate || '');
    const checks = Object.freeze({
      minimumLength: value.length >= POLICY.minimumLength,
      uppercase: /[A-Z]/.test(value),
      lowercase: /[a-z]/.test(value),
      number: /\d/.test(value),
      specialCharacter: /[^A-Za-z0-9]/.test(value)
    });
    const passed = Object.values(checks).filter(Boolean).length;
    return Object.freeze({ valid: passed === Object.keys(checks).length, score: Math.round((passed / Object.keys(checks).length) * 100), checks, retained: false, echoed: false });
  }
  ns.PasswordPolicy = Object.freeze({ version: '1.0.0', POLICY, validateCandidate });
})(typeof globalThis !== 'undefined' ? globalThis : window);
