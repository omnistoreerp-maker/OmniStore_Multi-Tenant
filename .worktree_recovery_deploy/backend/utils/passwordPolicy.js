const config = require('../config');

const DEFAULT_MIN_LENGTH = 8;

// Centralized password policy (Phase D). Pure validation: the function never
// echoes or stores the password itself. Complexity rules are opt-in flags read
// from config (all default to false), so enabling one rule never breaks legacy
// credentials or the existing test corpus.
function validatePassword(password) {
  const errors = [];

  if (password === undefined || password === null) {
    errors.push('password is required');
    return { valid: false, errors };
  }
  if (typeof password !== 'string') {
    errors.push('password must be a string');
    return { valid: false, errors };
  }

  const policy = config.passwordPolicy || {};
  const minLength = Number(policy.minLength) > 0 ? Number(policy.minLength) : DEFAULT_MIN_LENGTH;
  if (password.length < minLength) {
    errors.push(`password must be at least ${minLength} characters`);
  }
  if (policy.uppercase && !/[A-Z]/.test(password)) {
    errors.push('password must contain an uppercase letter');
  }
  if (policy.lowercase && !/[a-z]/.test(password)) {
    errors.push('password must contain a lowercase letter');
  }
  if (policy.number && !/[0-9]/.test(password)) {
    errors.push('password must contain a number');
  }
  if (policy.special && !/[^A-Za-z0-9]/.test(password)) {
    errors.push('password must contain a special character');
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validatePassword, DEFAULT_MIN_LENGTH };