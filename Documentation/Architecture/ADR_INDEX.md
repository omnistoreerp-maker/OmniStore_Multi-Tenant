# ADR_INDEX.md
## Architecture Decision Records Index

**Date:** 2026-08-05
**Status:** ACTIVE
**Authority:** Project Constitution

---

## 1. ADR REGISTRY

| ADR | Title | Status | Decision | Date |
|-----|-------|--------|----------|------|
| ADR-001 | Role Model | APPROVED | Hybrid Approach (Backward Compatible) | 2026-08-05 |
| ADR-002 | Tenant Model | APPROVED | Application-Level Multi-Tenancy | 2026-08-05 |

---

## 2. ADR-001: ROLE MODEL

### 2.1 Metadata

| Property | Value |
|----------|-------|
| ADR Number | ADR-001 |
| Title | Role Model |
| Status | APPROVED |
| Date | 2026-08-05 |
| Deciders | Chief Architect, Security Lead, Product Owner |

### 2.2 Decision

**Alternative C: Hybrid Approach (Backward Compatible)**

### 2.3 Role Mapping

| Current Role | Target Role | Migration |
|--------------|-------------|-----------|
| Owner | Super Admin | Automatic alias |
| Admin | Tenant Admin | Automatic alias |
| Manager | Manager | No change |
| Sales | Sales | No change |
| Viewer | Viewer | No change |
| - | Warehouse | New role |
| - | Accountant | New role |
| - | Support | New role |

### 2.4 Affected Documents

| Document | Impact |
|----------|--------|
| PHASE24_ARCHITECTURE.md | Role hierarchy, permission model |
| PHASE24_AUTHORIZATION_DESIGN.md | Role definitions, permission matrix |
| PHASE24_API_SPECIFICATION.md | Role endpoints, permission endpoints |
| PHASE24_AUTHENTICATION_DESIGN.md | JWT role claims |
| PHASE24_SECURITY_MODEL.md | Role-based access control |
| PHASE24_PERMISSION_MATRIX.md | All 8 role permissions |
| PHASE24_TEST_STRATEGY.md | Role-based test cases |
| PHASE24_RISK_REGISTER.md | Role migration risks |

### 2.5 Affected Components

| Component | Impact |
|-----------|--------|
| backend/middleware/authorize.js | Role validation |
| backend/controllers/auth.controller.js | Role assignment |
| backend/routes/users.routes.js | Role management |
| frontend/services/ | Role display |

### 2.6 Superseded Decisions

| Previous Decision | Reason |
|-------------------|--------|
| 5-role model | Not enterprise-ready |

### 2.7 Dependencies

| Dependency | Type |
|------------|------|
| ADR-002 | Tenant Model (role scoped to tenant) |

---

## 3. ADR-002: TENANT MODEL

### 3.1 Metadata

| Property | Value |
|----------|-------|
| ADR Number | ADR-002 |
| Title | Tenant Model |
| Status | APPROVED |
| Date | 2026-08-05 |
| Deciders | Chief Architect, Security Lead, Product Owner |

### 3.2 Decision

**Alternative C: Application-Level Multi-Tenancy**

### 3.3 Tenant Hierarchy

```
Tenant (Company)
    └── Branch (Location)
            └── Warehouse (Storage)
```

### 3.4 Affected Documents

| Document | Impact |
|----------|--------|
| PHASE24_ARCHITECTURE.md | Tenant hierarchy, isolation model |
| PHASE24_AUTHENTICATION_DESIGN.md | Tenant in JWT, tenant selection |
| PHASE24_AUTHORIZATION_DESIGN.md | Tenant isolation, branch isolation |
| PHASE24_API_SPECIFICATION.md | Tenant endpoints, branch endpoints |
| PHASE24_SECURITY_MODEL.md | Tenant isolation security |
| PHASE24_DEPLOYMENT_STRATEGY.md | Multi-tenant deployment |
| PHASE24_TEST_STRATEGY.md | Tenant isolation test cases |
| PHASE24_RISK_REGISTER.md | Tenant isolation risks |

### 3.5 Affected Components

| Component | Impact |
|-----------|--------|
| backend/utils/fileStore.js | Tenant-scoped persistence |
| backend/middleware/ | Tenant isolation middleware |
| backend/controllers/ | Tenant-scoped queries |
| backend/routes/ | Tenant-scoped endpoints |

### 3.6 Superseded Decisions

| Previous Decision | Reason |
|-------------------|--------|
| Single-tenant model | Not enterprise-ready |
| PostgreSQL-only multi-tenancy | JSON persistence must remain supported |

### 3.7 Dependencies

| Dependency | Type |
|------------|------|
| ADR-001 | Role Model (roles scoped to tenant) |

---

## 4. ADR COMPLIANCE

### 4.1 Phase 24 Compliance

| Document | ADR-001 | ADR-002 | Status |
|----------|---------|---------|--------|
| PHASE24_ARCHITECTURE.md | ✅ | ✅ | COMPLIANT |
| PHASE24_API_SPECIFICATION.md | ✅ | ✅ | COMPLIANT |
| PHASE24_AUTHENTICATION_DESIGN.md | ✅ | ✅ | COMPLIANT |
| PHASE24_AUTHORIZATION_DESIGN.md | ✅ | ✅ | COMPLIANT |
| PHASE24_SECURITY_MODEL.md | ✅ | ✅ | COMPLIANT |
| PHASE24_DEPLOYMENT_STRATEGY.md | ✅ | ✅ | COMPLIANT |
| PHASE24_TEST_STRATEGY.md | ✅ | ✅ | COMPLIANT |
| PHASE24_RISK_REGISTER.md | ✅ | ✅ | COMPLIANT |
| PHASE24_MASTER_REPORT.md | ✅ | ✅ | COMPLIANT |
| PHASE24_ARCHITECTURE_BASELINE.md | ✅ | ✅ | COMPLIANT |

### 4.2 Future Phase Compliance

| Phase | ADR-001 | ADR-002 | Status |
|-------|---------|---------|--------|
| Phase 25 | PENDING | PENDING | NOT YET |
| Phase 26 | PENDING | PENDING | NOT YET |
| Phase 27 | PENDING | PENDING | NOT YET |

---

## 5. ADR EVOLUTION

### 5.1 Amendment Process

| Step | Action |
|------|--------|
| 1 | Identify need for change |
| 2 | Propose amendment |
| 3 | Review by deciders |
| 4 | Approve or reject |
| 5 | Update ADR |
| 6 | Notify affected components |

### 5.2 Version History

| Version | Date | Change | Author |
|---------|------|--------|--------|
| 1.0 | 2026-08-05 | Initial ADR creation | Architecture Team |

---

## 6. ADR TEMPLATES

### 6.1 Future ADR Template

```markdown
# ADR-XXX: [Title]

## Status
PROPOSED | APPROVED | SUPERSEDED

## Context
[What is the issue?]

## Decision
[What did we decide?]

## Consequences
[What are the implications?]

## Affected Components
[What components are impacted?]
```

---

**Document Generated:** 2026-08-05
**Status:** ACTIVE
**Next Review:** When new ADRs are proposed
