'use strict';

// P6.67 — L-1 regression: the two Google Login challenge credentials must never
// reach the audit trail.
//
// P6.66 showed `tempToken`/`mfaToken` were persisted verbatim while `idToken`
// was already redacted. These assertions run against the real audit service and
// read back the PERSISTED store document, not just the returned object.

const fs = require('fs');
const { makeTempDataDir } = require('./helpers/testData');

const TEMP_TOKEN = 'raw-temp-token-value-1';
const MFA_TOKEN = 'raw-mfa-token-value-1';
const NESTED_TOKEN = 'raw-temp-token-value-2';
const MFA_CODE = '654321';

let dataDir;
let auditService;
let repository;

beforeAll(() => {
  dataDir = makeTempDataDir('p667-audit-redaction');
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  jest.resetModules();
  auditService = require('../services/audit.service');
  repository = require('../repositories').auditLog;
});

afterAll(() => {
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('P6.67 L-1 — challenge credentials are redacted from audit entries', () => {
  test('tempToken and mfaToken are redacted at any depth and never persisted', () => {
    const entry = auditService.record({
      method: 'POST',
      path: '/api/v1/auth/google-login/mfa-verify',
      statusCode: 200,
      action: 'google_login_mfa_verify',
      resource: 'auth',
      changes: {
        tempToken: TEMP_TOKEN,
        mfaToken: MFA_TOKEN,
        mfaCode: MFA_CODE,
        nested: { tempToken: NESTED_TOKEN, safe: 'visible-value' }
      }
    });

    expect(entry.changes.tempToken).toBe('[REDACTED]');
    expect(entry.changes.mfaToken).toBe('[REDACTED]');
    expect(entry.changes.mfaCode).toBe('[REDACTED]');
    expect(entry.changes.nested.tempToken).toBe('[REDACTED]');
    // Non-sensitive context survives, so the audit trail stays useful.
    expect(entry.changes.nested.safe).toBe('visible-value');

    const persisted = JSON.stringify(repository._rawStore());
    expect(persisted).not.toContain(TEMP_TOKEN);
    expect(persisted).not.toContain(MFA_TOKEN);
    expect(persisted).not.toContain(NESTED_TOKEN);
    expect(persisted).not.toContain(MFA_CODE);
    expect(persisted).toContain('visible-value');
  });

  test('spelling variants (temp_token, mfa_token) are redacted too', () => {
    const entry = auditService.record({
      method: 'POST',
      path: '/api/v1/auth/google-login/select-tenant',
      statusCode: 200,
      action: 'google_login_select_tenant',
      resource: 'auth',
      changes: { temp_token: 'snake-temp', mfa_token: 'snake-mfa', tenantId: 'tenant-a' }
    });

    expect(entry.changes.temp_token).toBe('[REDACTED]');
    expect(entry.changes.mfa_token).toBe('[REDACTED]');
    expect(entry.changes.tenantId).toBe('tenant-a');

    const persisted = JSON.stringify(repository._rawStore());
    expect(persisted).not.toContain('snake-temp');
    expect(persisted).not.toContain('snake-mfa');
  });

  test('the caller object is not mutated by redaction', () => {
    const changes = { tempToken: TEMP_TOKEN };
    auditService.record({
      method: 'POST',
      path: '/api/v1/auth/google-login',
      statusCode: 200,
      action: 'google_login',
      resource: 'auth',
      changes
    });
    expect(changes.tempToken).toBe(TEMP_TOKEN);
  });
});
