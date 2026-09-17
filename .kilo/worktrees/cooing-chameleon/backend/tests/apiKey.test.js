// API Key unit tests: generation, validation, hashing, lifecycle, revocation.
const { randomBytes, createHash } = require('crypto');
const { v4: uuidv4 } = require('uuid');
const apiKeyService = require('../services/apiKey.service');

describe('apiKey.service', () => {
  test('generateKey produces a key with dgv2_live_ prefix', () => {
    const result = apiKeyService.generateKey({ name: 'Test Key' });
    expect(result.key).toMatch(/^dgv2_live_/);
    expect(result.id).toBeTruthy();
    expect(result.name).toBe('Test Key');
    expect(result.enabled).toBe(true);
    expect(result.keyHash).toBeUndefined(); // raw hash never exposed
  });

  test('generateKey stores SHA-256 hash, not raw key', () => {
    const result = apiKeyService.generateKey({ name: 'Hash Test' });
    const store = require('../utils/fileStore').read('apiKeys');
    const record = store.keys.find(k => k.id === result.id);
    expect(record.keyHash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
    expect(record.keyHash).not.toBe(result.key);
  });

  test('validateKey returns record for valid raw key', () => {
    const result = apiKeyService.generateKey({ name: 'Validate Test' });
    const record = apiKeyService.validateKey(result.key);
    expect(record).toBeTruthy();
    expect(record.id).toBe(result.id);
    expect(record.name).toBe('Validate Test');
  });

  test('validateKey returns null for invalid key', () => {
    const result = apiKeyService.validateKey('dgv2_live_' + '0'.repeat(64));
    expect(result).toBeNull();
  });

  test('validateKey returns null for non-prefixed key', () => {
    const result = apiKeyService.validateKey('not-a-valid-key');
    expect(result).toBeNull();
  });

  test('validateKey returns null for revoked key', () => {
    const result = apiKeyService.generateKey({ name: 'Revoke Test' });
    apiKeyService.revokeKey(result.id);
    const record = apiKeyService.validateKey(result.key);
    expect(record).toBeNull();
  });

  test('validateKey returns null for disabled key', () => {
    const result = apiKeyService.generateKey({ name: 'Disable Test' });
    apiKeyService.setKeyEnabled(result.id, false);
    const record = apiKeyService.validateKey(result.key);
    expect(record).toBeNull();
  });

  test('validateKey returns null for expired key', () => {
    const result = apiKeyService.generateKey({
      name: 'Expiry Test',
      expiresAt: new Date(Date.now() - 1000).toISOString() // already expired
    });
    const record = apiKeyService.validateKey(result.key);
    expect(record).toBeNull();
  });

  test('listKeys returns all keys without keyHash', () => {
    apiKeyService.generateKey({ name: 'List Test 1' });
    apiKeyService.generateKey({ name: 'List Test 2' });
    const keys = apiKeyService.listKeys();
    expect(keys.length).toBeGreaterThanOrEqual(2);
    keys.forEach(k => {
      expect(k.keyHash).toBeUndefined();
      expect(k.id).toBeTruthy();
    });
  });

  test('getKey returns a single key by ID', () => {
    const result = apiKeyService.generateKey({ name: 'Get Test' });
    const key = apiKeyService.getKey(result.id);
    expect(key).toBeTruthy();
    expect(key.name).toBe('Get Test');
    expect(key.keyHash).toBeUndefined();
  });

  test('getKey returns null for nonexistent ID', () => {
    const key = apiKeyService.getKey(uuidv4());
    expect(key).toBeNull();
  });

  test('revokeKey sets revokedAt and disables key', () => {
    const result = apiKeyService.generateKey({ name: 'Revoke Lifecycle' });
    const revoked = apiKeyService.revokeKey(result.id);
    expect(revoked.revokedAt).toBeTruthy();
    expect(revoked.enabled).toBe(false);
  });

  test('deleteKey removes key permanently', () => {
    const result = apiKeyService.generateKey({ name: 'Delete Test' });
    const deleted = apiKeyService.deleteKey(result.id);
    expect(deleted).toBeTruthy();
    const key = apiKeyService.getKey(result.id);
    expect(key).toBeNull();
  });

  test('setKeyEnabled toggles enabled state', () => {
    const result = apiKeyService.generateKey({ name: 'Toggle Test' });
    const disabled = apiKeyService.setKeyEnabled(result.id, false);
    expect(disabled.enabled).toBe(false);
    const enabled = apiKeyService.setKeyEnabled(result.id, true);
    expect(enabled.enabled).toBe(true);
  });

  test('getKeyStats returns correct counts', () => {
    const stats = apiKeyService.getKeyStats();
    expect(stats).toHaveProperty('total');
    expect(stats).toHaveProperty('enabled');
    expect(stats).toHaveProperty('revoked');
    expect(stats).toHaveProperty('expired');
    expect(typeof stats.total).toBe('number');
  });

  test('_hashKey produces consistent SHA-256', () => {
    const input = 'test-key-value';
    const hash1 = apiKeyService._hashKey(input);
    const hash2 = apiKeyService._hashKey(input);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  test('_timingSafeCompare returns true for equal strings', () => {
    expect(apiKeyService._timingSafeCompare('abc', 'abc')).toBe(true);
  });

  test('_timingSafeCompare returns false for different strings', () => {
    expect(apiKeyService._timingSafeCompare('abc', 'def')).toBe(false);
  });

  test('_timingSafeCompare returns false for different lengths', () => {
    expect(apiKeyService._timingSafeCompare('abc', 'abcd')).toBe(false);
  });

  test('_timingSafeCompare returns false for non-strings', () => {
    expect(apiKeyService._timingSafeCompare(null, 'abc')).toBe(false);
    expect(apiKeyService._timingSafeCompare('abc', null)).toBe(false);
  });

  test('scopes are stored and returned', () => {
    const result = apiKeyService.generateKey({ name: 'Scope Test', scopes: ['read', 'write'] });
    const key = apiKeyService.getKey(result.id);
    expect(key.scopes).toEqual(['read', 'write']);
  });

  test('rateLimitMax defaults to config value', () => {
    const result = apiKeyService.generateKey({ name: 'Rate Limit Default' });
    const key = apiKeyService.getKey(result.id);
    expect(key.rateLimitMax).toBe(500); // config default
  });

  test('rateLimitMax can be customized', () => {
    const result = apiKeyService.generateKey({ name: 'Rate Limit Custom', rateLimitMax: 100 });
    const key = apiKeyService.getKey(result.id);
    expect(key.rateLimitMax).toBe(100);
  });
});
