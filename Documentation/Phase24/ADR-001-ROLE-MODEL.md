# ADR-001-ROLE-MODEL.md
## Architecture Decision Record: Role Model

**Date:** 2026-08-05
**Status:** PROPOSED
**Phase:** 24 - API Foundation & Authentication
**Deciders:** Chief Architect, Security Lead, Product Owner

---

## 1. PROBLEM STATEMENT

### 1.1 Current Issue

The current production system has **5 roles** (Owner, Admin, Manager, Sales, Viewer) while the future enterprise architecture defines **8 roles** (Super Admin, Tenant Admin, Manager, Sales, Warehouse, Accountant, Support, Viewer).

### 1.2 Blocking Questions

1. Should we migrate from 5 to 8 roles?
2. How do existing roles map to new roles?
3. What is the migration strategy?
4. How do we maintain backward compatibility?

---

## 2. CURRENT STATE

### 2.1 Verified Production Roles

| Role | Access Level | Evidence |
|------|--------------|----------|
| Owner | Full access | backend/middleware/authorize.js |
| Admin | Full access | backend/middleware/authorize.js |
| Manager | Write access | backend/middleware/authorize.js |
| Sales | Write access | backend/middleware/authorize.js |
| Viewer | Read-only | backend/middleware/authorize.js |

**Source:** `E:\Projects\ESO\backend\middleware\authorize.js` (verified)

### 2.2 Current Role Implementation

```javascript
// backend/middleware/authorize.js
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
};
```

### 2.3 Current Roles in Codebase

| Role | Usage |
|------|-------|
| Owner | Hardcoded in authorize.js |
| Admin | Hardcoded in authorize.js |
| Manager | Hardcoded in authorize.js |
| Sales | Hardcoded in authorize.js |
| Viewer | Hardcoded in authorize.js |

---

## 3. VERIFIED EVIDENCE

### 3.1 Role Definitions (Verified)

**File:** `E:\Projects\ESO\backend\middleware\authorize.js`
- Lines 4-12: `requireRole()` function
- Owner, Admin, Manager, Sales, Viewer roles used

**File:** `E:\Projects\ESO\backend\controllers\auth.controller.js`
- Lines 92-93: Role returned in login response
- Existing roles: Owner, Admin, Manager, Sales, Viewer

### 3.2 Permission Implementation (Verified)

**File:** `E:\Projects\ESO\backend\middleware\authorize.js`
- Lines 16-24: `requirePermission()` function
- Owner/Admin bypass permissions
- Permission array checked against user permissions

---

## 4. AVAILABLE ALTERNATIVES

### 4.1 Alternative A: Keep 5 Roles (Minimal Change)

| Aspect | Detail |
|--------|--------|
| Description | Keep existing 5 roles, add new permissions only |
| Roles | Owner, Admin, Manager, Sales, Viewer |
| Changes | Add more granular permissions to existing roles |
| Migration | None required |

**Advantages:**
- Zero migration risk
- No breaking changes
- Simple implementation

**Disadvantages:**
- Limited granularity
- No separation of concerns (e.g., Accountant vs Manager)
- Not enterprise-ready

---

### 4.2 Alternative B: Expand to 8 Roles (Full Enterprise)

| Aspect | Detail |
|--------|--------|
| Description | Migrate to 8 enterprise roles |
| Roles | Super Admin, Tenant Admin, Manager, Sales, Warehouse, Accountant, Support, Viewer |
| Changes | New role hierarchy, new permissions |
| Migration | Required |

**Advantages:**
- Enterprise-ready
- Clear separation of concerns
- Better security (least privilege)

**Disadvantages:**
- Migration required
- Potential breaking changes
- More complex implementation

---

### 4.3 Alternative C: Hybrid Approach (Backward Compatible)

| Aspect | Detail |
|--------|--------|
| Description | Add new roles while preserving existing role names |
| Roles | Owner→Super Admin, Admin→Tenant Admin, + new roles |
| Changes | Alias mapping, gradual migration |
| Migration | Backward compatible |

**Advantages:**
- Backward compatible
- Gradual migration
- No breaking changes

**Disadvantages:**
- Dual role system temporarily
- Complexity during transition

---

## 5. TRADE-OFFS

| Factor | Alternative A | Alternative B | Alternative C |
|--------|---------------|---------------|---------------|
| Migration Risk | NONE | HIGH | LOW |
| Enterprise Readiness | LOW | HIGH | HIGH |
| Implementation Complexity | LOW | MEDIUM | MEDIUM |
| Backward Compatibility | FULL | NONE | FULL |
| Future Extensibility | LOW | HIGH | HIGH |

---

## 6. CHOSEN DECISION

### 6.1 Decision

**ALTERNATIVE C: HYBRID APPROACH (Backward Compatible)**

### 6.2 Rationale

1. **Backward Compatibility:** Existing users and integrations continue to work
2. **Gradual Migration:** No sudden breaking changes
3. **Enterprise Ready:** New roles provide enterprise functionality
4. **Low Risk:** Minimal disruption to production

---

## 7. MIGRATION STRATEGY

### 7.1 Role Mapping

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

### 7.2 Implementation Steps

| Step | Action | Risk |
|------|--------|------|
| 1 | Add new roles to database | LOW |
| 2 | Create role alias mapping | LOW |
| 3 | Update auth middleware to support aliases | LOW |
| 4 | Migrate existing users to new roles | MEDIUM |
| 5 | Update frontend to display new roles | LOW |
| 6 | Deprecate old role names | LOW |

### 7.3 Rollback Strategy

| Trigger | Action |
|---------|--------|
| Issues detected | Revert to original 5 roles |
| Data corruption | Restore from backup |
| User complaints | Keep both systems temporarily |

---

## 8. FUTURE IMPACT

### 8.1 Positive Impact

| Impact | Description |
|--------|-------------|
| Better Security | More granular permissions |
| Enterprise Ready | Supports complex organizations |
| SaaS Ready | Multi-tenant role isolation |

### 8.2 Negative Impact

| Impact | Description |
|--------|-------------|
| Complexity | More roles to manage |
| Migration | Required for existing users |
| Documentation | More comprehensive docs needed |

---

## 9. IMPLEMENTATION NOTES

### 9.1 Technical Requirements

| Requirement | Description |
|-------------|-------------|
| Database | Add new role entries |
| Middleware | Update role validation |
| API | Update role endpoints |
| Frontend | Update role display |

### 9.2 Dependencies

| Dependency | Status |
|------------|--------|
| Phase 24 API | Required |
| Phase 25 Multi-Branch | Optional |

---

## 10. RISKS

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Migration failure | Low | High | Backup + rollback plan |
| User confusion | Medium | Medium | Clear communication |
| Integration breakage | Low | High | Backward compatibility |

---

## 11. APPROVAL CRITERIA

| Criterion | Status |
|-----------|--------|
| Backward compatible | ✅ |
| Migration plan defined | ✅ |
| Rollback plan defined | ✅ |
| Risks mitigated | ✅ |
| Stakeholder approval | PENDING |

---

## 12. DECISION STATUS

```
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   ADR-001: ROLE MODEL                                         ║
║                                                               ║
║   STATUS: PROPOSED                                            ║
║                                                               ║
║   Decision: ALTERNATIVE C (Hybrid Approach)                   ║
║                                                               ║
║   Rationale:                                                  ║
║   - Backward compatible                                       ║
║   - Low migration risk                                        ║
║   - Enterprise ready                                          ║
║   - Future extensible                                         ║
║                                                               ║
║   NEXT ACTION: Submit for approval                            ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
```

---

**Document Generated:** 2026-08-05
**Status:** PROPOSED
**Next Action:** Submit for stakeholder approval
