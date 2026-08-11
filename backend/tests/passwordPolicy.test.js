'use strict';

// Phase D — centralized password policy unit tests. Covers the default minimum
// length, the opt-in complexity rules, and config overrides. Every flag is
// toggled ONLY inside a test and restored immediately, so no suite in the same
// worker can observe a leaked flag.

const FLAGS = [
  'PASSWORD_POLICY_MIN_LENGTH',
  'PASSWORD_POLICY_UPPERCASE',
  'PASSWORD_POLICY_LOWERCASE',
  'PASSWORD_POLICY_NUMBER',
  'PASSWORD_POLICY_SPECIAL'
];

const ORIGINAL_ENV = {};
for (const key of FLAGS) ORIGINAL_ENV[key] = process.env[key];

afterAll(() => {
  for (const key of FLAGS) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL_ENV[key];
  }
});

// Load the policy module under a fresh env: clears ALL policy flags first, then
// applies the given overrides, then (re)requires the module so config re-reads
// process.env. Returns the policy plus a restore() that resets the flags.
function policyFor(overrides) {
  jest.resetModules();
  const saved = {};
  for (const key of FLAGS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(overrides || {})) {
    process.env[key] = String(value);
  }
  return {
    policy: require('../utils/passwordPolicy'),
    restore() {
      for (const key of FLAGS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  };
}

describe('Phase D — passwordPolicy.validatePassword', () => {
  test('rejects missing / non-string inputs', () => {
    const { policy, restore } = policyFor({});
    expect(policy.validatePassword(undefined).valid).toBe(false);
    expect(policy.validatePassword(null).valid).toBe(false);
    expect(policy.validatePassword(12345).valid).toBe(false);
    restore();
  });

  test('enforces the default minimum length of 8', () => {
    const { policy, restore } = policyFor({});
    expect(policy.validatePassword('short').valid).toBe(false);
    expect(policy.validatePassword('abcdefgh').valid).toBe(true);
    restore();
  });

  test('honors PASSWORD_POLICY_MIN_LENGTH override', () => {
    const { policy, restore } = policyFor({ PASSWORD_POLICY_MIN_LENGTH: '12' });
    expect(policy.validatePassword('abcdefghij').valid).toBe(false);
    expect(policy.validatePassword('abcdefghijkl').valid).toBe(true);
    restore();
  });

  test('uppercase rule is opt-in and off by default', () => {
    const { policy, restore } = policyFor({});
    expect(policy.validatePassword('alllower123').valid).toBe(true);
    restore();

    const strict = policyFor({ PASSWORD_POLICY_UPPERCASE: 'true' });
    expect(strict.policy.validatePassword('alllower123').valid).toBe(false);
    expect(strict.policy.validatePassword('Alllower123').valid).toBe(true);
    strict.restore();
  });

  test('lowercase rule is opt-in and off by default', () => {
    const strict = policyFor({ PASSWORD_POLICY_LOWERCASE: 'true' });
    expect(strict.policy.validatePassword('ALLUPPER123').valid).toBe(false);
    expect(strict.policy.validatePassword('ALLupper123').valid).toBe(true);
    strict.restore();
  });

  test('number rule is opt-in and off by default', () => {
    const strict = policyFor({ PASSWORD_POLICY_NUMBER: 'true' });
    expect(strict.policy.validatePassword('lettersonly').valid).toBe(false);
    expect(strict.policy.validatePassword('letters1').valid).toBe(true);
    strict.restore();
  });

  test('special-character rule is opt-in and off by default', () => {
    const strict = policyFor({ PASSWORD_POLICY_SPECIAL: 'true' });
    expect(strict.policy.validatePassword('plaintext1').valid).toBe(false);
    expect(strict.policy.validatePassword('plain!ext1').valid).toBe(true);
    strict.restore();
  });

  test('every rule satisfied validates when all flags are on', () => {
    const strict = policyFor({
      PASSWORD_POLICY_UPPERCASE: 'true',
      PASSWORD_POLICY_LOWERCASE: 'true',
      PASSWORD_POLICY_NUMBER: 'true',
      PASSWORD_POLICY_SPECIAL: 'true'
    });
    expect(strict.policy.validatePassword('Abcdef1!').valid).toBe(true);
    // Each individual failure is reported in errors[]
    expect(strict.policy.validatePassword('abcdef1!').errors).toEqual(
      expect.arrayContaining(['password must contain an uppercase letter'])
    );
    strict.restore();
  });

  test('the function never returns the password itself', () => {
    const { policy, restore } = policyFor({ PASSWORD_POLICY_SPECIAL: 'true' });
    const result = policy.validatePassword('Top#Secret99');
    expect(JSON.stringify(result)).not.toContain('Top#Secret99');
    expect(result.valid).toBe(true);
    restore();
  });
});