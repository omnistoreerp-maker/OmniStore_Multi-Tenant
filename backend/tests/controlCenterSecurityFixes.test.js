'use strict';
// Proof tests for the two REQUIRED security fixes rebuilt on d831ed0:
//   A. audit secret sanitization covers the full canonical key set (behaviour,
//      not mere array membership).
//   B. isPlatformAdmin() is fail-closed for off-registry / missing roles.

const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccfix-'));
process.env.DIGITRONICS_DATA_DIR = tmpDir;
process.env.JWT_SECRET = 'ccfix-suite-secret';
process.env.NODE_ENV = 'test';
process.env.LOG_FILE = '';

const write = (n, p) => fs.writeFileSync(path.join(tmpDir, n + '.json'), JSON.stringify(p, null, 2));
const auditLogPath = path.join(tmpDir, 'auditLog.json');

write('companies', { companies: [{ id: 'digi', code: 'D', name: 'Digi', active: true, status: 'ACTIVE' }] });
write('platformAdmins', { admins: [
  { username: 'owner', platformRole: 'MASTER_OWNER', status: 'active' },
  { username: 'padmin', platformRole: 'PLATFORM_ADMIN', status: 'active' },
  { username: 'developer', platformRole: 'DEVELOPER', status: 'active' },
  { username: 'dataentry', platformRole: 'DATA_ENTRY', status: 'active' },
  { username: 'offreg', platformRole: 'NOT_A_REAL_ROLE', status: 'active' },
  { username: 'norole', status: 'active' },
  { username: 'emptyname', platformRole: '', status: 'active' },
  { username: 'nullrole', platformRole: null, status: 'active' },
  { username: 'offcase', platformRole: 'master_admin', status: 'active' },
  { username: 'disabled', platformRole: 'MASTER_OWNER', status: 'disabled' }
]});

const platformAdmin = require('../services/platformAdmin.service');
const platformRegistry = require('../permissions/platformRegistry');
const auditService = require('../services/audit.service');

describe('B. UNKNOWN_ROLE_FAIL_CLOSED — isPlatformAdmin', () => {
  test.each(['offreg', 'norole', 'emptyname', 'nullrole', 'offcase', 'disabled', 'not_a_member'])(
    '%s is NOT a platform admin', (u) => {
      expect(platformAdmin.isPlatformAdmin(u)).toBe(false);
    });

  test.each(['owner', 'padmin', 'developer', 'dataentry'])('%s IS a platform admin', (u) => {
    expect(platformAdmin.isPlatformAdmin(u)).toBe(true);
  });

  test('the official role contract is unchanged', () => {
    expect(platformRegistry.PLATFORM_ROLES).toEqual(['MASTER_OWNER', 'PLATFORM_ADMIN', 'DEVELOPER', 'DATA_ENTRY']);
  });

  test('an off-registry role yields no role and no permissions', () => {
    expect(platformAdmin.platformRoleFor('offreg')).toBeNull();
    expect(platformAdmin.resolvePermissionsFor('offreg')).toEqual([]);
  });
});

describe('A. AUDIT_SANITIZATION — behavioural coverage', () => {
  const REQUIRED = {
    auth: 'VAL_auth_zz',
    session: 'VAL_session_zz',
    sessionsecret: 'VAL_sessionsecret_zz',
    signingkey: 'VAL_signingkey_zz',
    access_token: 'VAL_access_token_zz',
    refresh_token: 'VAL_refresh_token_zz',
    authorization: 'VAL_authorization_zz',
    cookie: 'VAL_cookie_zz',
    jwt: 'VAL_jwt_zz',
    credential: 'VAL_credential_zz'
  };

  test('no required secret survives into auditLog.json raw', () => {
    auditService.record({
      userId: 'u1', action: 'SEC_FIX_SELFTEST', entity: 'tests', entityId: 'san',
      changes: { after: Object.assign({ keepMe: 'visible' }, REQUIRED) }
    });
    const raw = fs.readFileSync(auditLogPath, 'utf8');
    for (const v of Object.values(REQUIRED)) {
      expect(raw).not.toContain(v);
    }
    expect(raw).not.toMatch(/VAL_\w+_zz/);
    // non-sensitive structure is preserved
    expect(raw).toContain('visible');
  });

  test('every required key is actually redacted (behaviour, not array membership)', () => {
    auditService.record({
      userId: 'u1', action: 'SEC_FIX_SELFTEST_2', entity: 'tests', entityId: 'san2',
      changes: { after: REQUIRED }
    });
    const log = JSON.parse(fs.readFileSync(auditLogPath, 'utf8'));
    const entry = (log.entries || []).find(e => e && e.action === 'SEC_FIX_SELFTEST_2');
    expect(entry).toBeDefined();
    const after = entry.changes.after;
    for (const k of Object.keys(REQUIRED)) {
      expect(after[k]).toBe('[REDACTED]');
    }
    expect(after.keepMe).toBeUndefined();
  });

  test('nested and aliased forms are redacted too', () => {
    // Header-style spellings (X-API-Key, X-Auth-Token) and separator variants
    // are now covered by the normalized-key matcher in audit.service.js, along
    // with the pre-existing nested/array recursion and underscore aliases.
    auditService.record({
      userId: 'u1', action: 'SEC_FIX_SELFTEST_3', entity: 'tests', entityId: 'san3',
      changes: { after: {
        nested: { deep: { cookie: 'VAL_deep_cookie' } },
        list: [{ jwt: 'VAL_list_jwt' }, { access_token: 'VAL_nested_at' }],
        'X-API-Key': 'VAL_xapikey',
        'X-Auth-Token': 'VAL_xauthtoken',
        'API-Key': 'VAL_sep_apikey'
      } }
    });
    const raw = fs.readFileSync(auditLogPath, 'utf8');
    expect(raw).not.toContain('VAL_deep_cookie');
    expect(raw).not.toContain('VAL_list_jwt');
    expect(raw).not.toContain('VAL_nested_at');
    expect(raw).not.toContain('VAL_xapikey');
    expect(raw).not.toContain('VAL_xauthtoken');
    expect(raw).not.toContain('VAL_sep_apikey');
    const log = JSON.parse(raw);
    const entry = (log.entries || []).find(e => e && e.action === 'SEC_FIX_SELFTEST_3');
    expect(entry).toBeDefined();
    const after = entry.changes.after;
    expect(after.nested.deep.cookie).toBe('[REDACTED]');
    expect(after.list[0].jwt).toBe('[REDACTED]');
    expect(after['X-API-Key']).toBe('[REDACTED]');
    expect(after['X-Auth-Token']).toBe('[REDACTED]');
    expect(after['API-Key']).toBe('[REDACTED]');
  });

  test('actor attribution survives sanitization', () => {
    const log = JSON.parse(fs.readFileSync(auditLogPath, 'utf8'));
    const e = (log.entries || []).find(x => x && x.action === 'SEC_FIX_SELFTEST');
    expect(e.userId).toBe('u1');
    expect(e.id).toBeTruthy();
    expect(e.timestamp).toBeTruthy();
  });
});
describe('C. CONTROL_CENTER_MEMBER_VIEW_FAIL_CLOSED', () => {
  const cc = require('../services/platformControlCenter.service');

  test('unknown / missing stored roles are reported UNKNOWN with empty permissions', () => {
    const team = cc.listTeam();
    const byName = (n) => team.find(m => m.username === n);
    for (const n of ['offreg', 'norole', 'emptyname', 'nullrole', 'offcase']) {
      const m = byName(n);
      expect(m).toBeDefined();
      expect(m.platformRole).toBe('UNKNOWN');
      expect(m.effectivePermissions).toEqual([]);
    }
  });

  test('official roles keep their normal permission resolution', () => {
    const team = cc.listTeam();
    const owner = team.find(m => m.username === 'owner');
    const padmin = team.find(m => m.username === 'padmin');
    expect(owner.platformRole).toBe('MASTER_OWNER');
    expect(owner.effectivePermissions).toContain('*');
    expect(padmin.platformRole).toBe('PLATFORM_ADMIN');
    expect(padmin.effectivePermissions).not.toContain('*');
    expect(padmin.effectivePermissions).toContain('platform.companies.view');
    // never inherit a privileged wildcard or team control
    expect(padmin.effectivePermissions).not.toContain('platform.team.manage');
  });
});