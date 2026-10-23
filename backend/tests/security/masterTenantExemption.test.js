'use strict';

// ============================================================================
// SECURITY REVIEW — Master / empty-membership tenant exemption
//
// SCOPE: review only. This suite changes NO product behaviour and touches no
// production data. It boots the REAL app against an isolated temp data dir.
//
// FINDING UNDER REVIEW
//   `tenantMembership.isTenantDenied()` (backend/services/tenantMembership.service.js:65-70)
//   exempts ANY account whose membership list is empty:
//
//       const membership = idsFor(user);
//       if (membership.length === 0) return false;   // legacy / empty membership
//       return membership.includes(String(tenantId)) === false;
//
//   The login path then mints a tenant claim for that account
//   (backend/controllers/auth.controller.js:88-105, carryTenantId from
//   req.tenantContext), and `tenantRole.resolveEffectiveRole()`
//   (backend/services/tenantRole.service.js:81-86) falls back to the user's
//   GLOBAL role when no per-tenant role exists:
//
//       if (tenantRole !== undefined) return tenantRole;
//       if (user.role) return user.role;
//
//   `requirePermission` (backend/middleware/authorize.js:88-91) then gives
//   Owner/Admin an outright bypass. Net effect: an account with no membership
//   can authenticate into ANY active company and act with its global role.
//
// PART A (characterization) pins the CURRENT behaviour so any future change is
// deliberate and reviewed. PART B states the DESIRED behaviour; those
// assertions are wrapped in `test.failing`, so they pass only while the gap
// still exists and turn RED the moment the behaviour is fixed — forcing this
// review to be revisited rather than silently drifting.
// ============================================================================

const fs = require('fs');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer, TEST_JWT_SECRET } = require('../helpers/testServer');
const { makeTempDataDir, seed } = require('../helpers/testData');

const PASSWORD = 'Pass#123';
const STAMP = new Date().toISOString();

const ORIGINAL_ENV = {
  MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
  MEM: process.env.ENABLE_TENANT_USER_MEMBERSHIP,
  ROLES: process.env.ENABLE_TENANT_ROLES,
  CARRY: process.env.ENABLE_TENANT_CARRY,
  AUTH: process.env.AUTH_REQUIRED,
  DATA: process.env.DIGITRONICS_DATA_DIR
};

const companies = [
  { id: 'digitronics', code: 'DIGI', name: 'DigiTronics', active: true },
  { id: 'nile', code: 'NILE', name: 'Nile Electronics', active: true },
  { id: 'astra', code: 'ASTRA', name: 'Astra Components', active: true, status: 'SUSPENDED' }
];

function userRecords(password) {
  const base = (over) => ({ password, createdAt: STAMP, updatedAt: STAMP, ...over });
  return [
    // The review subject: production-shaped master — global Owner, zero membership.
    base({ id: 'u-master', username: 'omnistore', fullName: 'Master', role: 'Owner' }),
    // Non-Owner with zero membership: proves the exemption is not Owner-specific.
    base({ id: 'u-float-viewer', username: 'floatViewer', fullName: 'Float Viewer', role: 'Viewer' }),
    // A freshly provisioned operator that never received a membership row.
    base({ id: 'u-fresh-cashier', username: 'freshCashier', fullName: 'Fresh Cashier', role: 'Cashier' }),
    // Legitimate single-tenant member (the control case).
    base({
      id: 'u-a', username: 'companyA', fullName: 'Company A', role: 'Manager',
      tenantIds: ['digitronics'], tenantRoles: { digitronics: 'Admin' }
    })
  ];
}

describe('SECURITY REVIEW — empty-membership tenant exemption', () => {
  let app;
  let dir;
  let jwt;
  let login;

  beforeAll(async () => {
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    process.env.ENABLE_TENANT_ROLES = 'true';
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.AUTH_REQUIRED = 'true';

    dir = makeTempDataDir('master-exemption');
    seed(dir, 'companies', companies);
    seed(dir, 'users', { users: userRecords(bcrypt.hashSync(PASSWORD, 10)) });
    seed(dir, 'platformAdmins', {
      admins: [{ username: 'omnistore', platformRole: 'MASTER_OWNER', createdAt: STAMP }]
    });

    const s = await startServer(dir, { AUTH_REQUIRED: 'true' });
    app = s.app;

    jest.resetModules();
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    jwt = require('../../utils/jwt');

    login = async (username, company) => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send(company ? { username, password: PASSWORD, company } : { username, password: PASSWORD });
      const d = (res.body && res.body.data) || {};
      let claims;
      try { claims = d.accessToken ? jwt.verifyAccessToken(d.accessToken) : undefined; } catch (_) {}
      return {
        status: res.statusCode,
        body: res.body,
        accessToken: d.accessToken,
        effectiveRole: d.effectiveRole,
        tenantId: claims ? claims.tenantId : undefined,
        tokenRole: claims ? claims.role : undefined
      };
    };
  });

  afterAll(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    const mapping = {
      ENABLE_MULTI_COMPANY_LOGIN: 'MC',
      ENABLE_TENANT_USER_MEMBERSHIP: 'MEM',
      ENABLE_TENANT_ROLES: 'ROLES',
      ENABLE_TENANT_CARRY: 'CARRY',
      AUTH_REQUIRED: 'AUTH',
      DIGITRONICS_DATA_DIR: 'DATA'
    };
    for (const [envKey, origKey] of Object.entries(mapping)) {
      const orig = ORIGINAL_ENV[origKey];
      if (orig === undefined) delete process.env[envKey];
      else process.env[envKey] = orig;
    }
  });

  // --------------------------------------------------------------------------
  // PART A — CURRENT BEHAVIOUR (characterization, asserted as-is)
  // --------------------------------------------------------------------------
  describe('PART A — current behaviour', () => {
    test('root cause: isTenantDenied() returns false for an account with no membership', () => {
      const membership = require('../../services/tenantMembership.service');
      expect(membership.isTenantDenied({ username: 'x', role: 'Owner' }, 'nile')).toBe(false);
      expect(membership.isTenantDenied({ username: 'x', role: 'Owner', tenantIds: [] }, 'nile')).toBe(false);
      // ...while a real member IS confined:
      expect(membership.isTenantDenied({ tenantIds: ['digitronics'] }, 'nile')).toBe(true);
      expect(membership.isTenantDenied({ tenantIds: ['digitronics'] }, 'digitronics')).toBe(false);
    });

    test('Q1/Q2/Q3 — master (role Owner, zero memberships) enters an active company and is minted an Owner tenant claim', async () => {
      const r = await login('omnistore', 'nile');
      expect(r.status).toBe(200);
      expect(r.accessToken).toBeTruthy();
      // Q2: a trusted tenant claim IS issued, taken from the selected company.
      expect(r.tenantId).toBe('nile');
      // Q3: effective role is the GLOBAL role, i.e. Owner inside the tenant.
      expect(r.effectiveRole).toBe('Owner');
      expect(r.tokenRole).toBe('Owner');
    });

    test('Q3 consequence — that Owner claim passes the Education API for the entered tenant', async () => {
      const r = await login('omnistore', 'nile');
      const read = await request(app)
        .get('/api/v1/tenant/education/pack')
        .set('Authorization', 'Bearer ' + r.accessToken);
      expect(read.status).toBe(200);
      expect(read.body.success).toBe(true);
    });

    test('the exemption is NOT Owner-specific — a global Viewer with zero memberships also enters', async () => {
      const r = await login('floatViewer', 'nile');
      expect(r.status).toBe(200);
      expect(r.tenantId).toBe('nile');
      expect(r.effectiveRole).toBe('Viewer');
    });

    test('latent trap — an account created without a membership row enters any tenant', async () => {
      const r = await login('freshCashier', 'digitronics');
      expect(r.status).toBe(200);
      expect(r.tenantId).toBe('digitronics');
    });

    test('control — a measured member is still confined to their own company (403, no token)', async () => {
      const r = await login('companyA', 'nile');
      expect(r.status).toBe(403);
      expect(r.accessToken).toBeFalsy();
    });

    test('control — a suspended company is rejected regardless of membership', async () => {
      const r = await login('omnistore', 'astra');
      expect(r.status).toBe(403);
      expect(r.accessToken).toBeFalsy();
    });

    test('platform role is a SEPARATE field — it is not what grants tenant access', async () => {
      // `me` answers 404 (not 403) for a non-admin on purpose, so platform
      // existence is not disclosed. floatViewer holds NO platform role yet
      // still enters a tenant above — so tenant power comes from the
      // user-record role fallback, never from MASTER_OWNER in platformAdmins.
      const viewer = await login('floatViewer', 'nile');
      expect(viewer.effectiveRole).toBe('Viewer');
      const viewerMe = await request(app)
        .get('/api/v1/platform/me')
        .set('Authorization', 'Bearer ' + viewer.accessToken);
      expect(viewerMe.status).toBe(404);

      // Control: the master does hold the platform role, proving the two
      // surfaces are distinct fields with distinct meaning.
      const master = await login('omnistore', 'nile');
      const masterMe = await request(app)
        .get('/api/v1/platform/me')
        .set('Authorization', 'Bearer ' + master.accessToken);
      expect(masterMe.status).toBe(200);
      expect(masterMe.body.data.platformRole).toBe('MASTER_OWNER');
    });
  });

  // --------------------------------------------------------------------------
  // PART B — DESIRED BEHAVIOUR (must be implemented only after sign-off)
  //
  // `test.failing` means: the SUITE stays green while the gap exists, and turns
  // red the moment the desired behaviour is implemented — a reminder to close
  // this review instead of leaving stale expectations behind.
  // --------------------------------------------------------------------------
  describe('PART B — desired behaviour (requires security sign-off)', () => {
    test.failing('an account with no tenant membership is denied entry to every tenant', async () => {
      const r = await login('omnistore', 'nile');
      expect(r.status).toBe(403);
      expect(r.accessToken).toBeFalsy();
    });

    test.failing('a non-Owner without membership is denied entry too', async () => {
      const r = await login('floatViewer', 'nile');
      expect(r.status).toBe(403);
    });

    test.failing('no tenant claim is minted for an unaffiliated account', async () => {
      const r = await login('freshCashier', 'digitronics');
      expect(r.tenantId).toBeUndefined();
    });
  });
});
