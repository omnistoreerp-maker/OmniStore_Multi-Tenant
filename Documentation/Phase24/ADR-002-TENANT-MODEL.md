# ADR-002-TENANT-MODEL.md
## Architecture Decision Record: Tenant Model

**Date:** 2026-08-05
**Status:** PROPOSED
**Phase:** 24 - API Foundation & Authentication
**Deciders:** Chief Architect, Security Lead, Product Owner

---

## 1. PROBLEM STATEMENT

### 1.1 Current Issue

The current production system is **single-tenant** (no tenant isolation) while the future enterprise architecture requires **multi-tenant** support with tenant, branch, and warehouse isolation.

### 1.2 Blocking Questions

1. What is the tenant model?
2. How do we implement multi-tenancy?
3. What is the migration strategy?
4. How do we maintain backward compatibility?

---

## 2. CURRENT STATE

### 2.1 Verified Single-Tenant Architecture

| Component | Status | Evidence |
|-----------|--------|----------|
| Backend | Single-tenant | backend/server.js |
| Data Persistence | JSON files | backend/utils/fileStore.js |
| Authentication | Single-user | backend/utils/jwt.js |
| Authorization | Role-based only | backend/middleware/authorize.js |

**Source:** `E:\Projects\ESO\backend\` (verified)

### 2.2 Current Data Model

```json
{
  "users": [...],
  "products": [...],
  "sales": [...],
  "purchases": [...],
  "customers": [...],
  "suppliers": [...]
}
```

### 2.3 Current Limitations

| Limitation | Impact |
|------------|--------|
| No tenant isolation | Cannot support multiple companies |
| No branch support | Cannot support multiple locations |
| No warehouse support | Cannot track inventory by location |
| Single data store | No data separation |

---

## 3. VERIFIED EVIDENCE

### 3.1 Current Backend (Verified)

**File:** `E:\Projects\ESO\backend\server.js`
- Single Express.js application
- No tenant middleware
- No tenant isolation

**File:** `E:\Projects\ESO\backend\utils\fileStore.js`
- JSON file persistence
- No tenant scoping
- Single data directory

### 3.2 Supabase Schemas (Draft)

**File:** `E:\Projects\ESO\database\supabasePreview\`
- Multi-tenant schemas exist (DRAFT ONLY)
- 13 migration files
- Tenant, branch, warehouse tables defined

---

## 4. AVAILABLE ALTERNATIVES

### 4.1 Alternative A: Keep Single-Tenant (No Change)

| Aspect | Detail |
|--------|--------|
| Description | Keep current single-tenant architecture |
| Tenant Model | None |
| Isolation | None |
| Migration | None |

**Advantages:**
- Zero migration risk
- No breaking changes
- Simple implementation

**Disadvantages:**
- Cannot support multiple companies
- Not enterprise-ready
- Not SaaS-ready

---

### 4.2 Alternative B: Full Multi-Tenant (Database-Level)

| Aspect | Detail |
|--------|--------|
| Description | Implement full multi-tenancy with database isolation |
| Tenant Model | Tenant → Branch → Warehouse |
| Isolation | Database-level (RLS) |
| Migration | Required |

**Advantages:**
- Enterprise-ready
- Strong isolation
- SaaS-ready

**Disadvantages:**
- High migration complexity
- Requires PostgreSQL
- Performance overhead

---

### 4.3 Alternative C: Application-Level Multi-Tenancy (Hybrid)

| Aspect | Detail |
|--------|--------|
| Description | Implement multi-tenancy at application level |
| Tenant Model | Tenant → Branch → Warehouse |
| Isolation | Application-level (middleware) |
| Migration | Required |

**Advantages:**
- Works with JSON persistence
- Lower migration complexity
- Flexible

**Disadvantages:**
- Weaker isolation than database-level
- More application code
- Manual enforcement

---

## 5. TRADE-OFFS

| Factor | Alternative A | Alternative B | Alternative C |
|--------|---------------|---------------|---------------|
| Migration Risk | NONE | HIGH | MEDIUM |
| Enterprise Readiness | LOW | HIGH | HIGH |
| Isolation Strength | NONE | STRONG | MEDIUM |
| Implementation Complexity | LOW | HIGH | MEDIUM |
| Future SaaS Readiness | LOW | HIGH | HIGH |

---

## 6. CHOSEN DECISION

### 6.1 Decision

**ALTERNATIVE C: APPLICATION-LEVEL MULTI-TENANCY (Hybrid)**

### 6.2 Rationale

1. **Works with Current Stack:** Compatible with JSON persistence
2. **Lower Risk:** Less complex than database-level
3. **Enterprise Ready:** Provides necessary isolation
4. **Gradual Migration:** Can be implemented incrementally

---

## 7. TENANT MODEL DEFINITION

### 7.1 Entity Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│                     TENANT (Company)                         │
├─────────────────────────────────────────────────────────────┤
│  id: UUID                                                   │
│  name: String                                               │
│  slug: String (unique)                                      │
│  settings: JSON                                             │
│  plan: String (free/pro/enterprise)                         │
│  status: String (active/inactive)                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     BRANCH (Location)                        │
├─────────────────────────────────────────────────────────────┤
│  id: UUID                                                   │
│  tenant_id: UUID (FK)                                       │
│  name: String                                               │
│  address: String                                            │
│  phone: String                                              │
│  status: String (active/inactive)                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     WAREHOUSE (Storage)                      │
├─────────────────────────────────────────────────────────────┤
│  id: UUID                                                   │
│  branch_id: UUID (FK)                                       │
│  tenant_id: UUID (FK)                                       │
│  name: String                                               │
│  location: String                                           │
│  status: String (active/inactive)                           │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 User-Tenant Relationship

```
┌─────────────────────────────────────────────────────────────┐
│                     USER                                     │
├─────────────────────────────────────────────────────────────┤
│  id: UUID                                                   │
│  email: String (unique)                                     │
│  name: String                                               │
│  tenant_id: UUID (FK)                                       │
│  role: String                                               │
│  status: String (active/inactive)                           │
└─────────────────────────────────────────────────────────────┘
```

### 7.3 Data Isolation Strategy

| Level | Isolation | Implementation |
|-------|-----------|----------------|
| Tenant | Application-level | tenant_id filter |
| Branch | Application-level | branch_id filter |
| Warehouse | Application-level | warehouse_id filter |

---

## 8. MIGRATION STRATEGY

### 8.1 Migration Steps

| Step | Action | Risk |
|------|--------|------|
| 1 | Add tenant_id to all tables | LOW |
| 2 | Create default tenant | LOW |
| 3 | Assign existing data to default tenant | LOW |
| 4 | Add tenant middleware | LOW |
| 5 | Update all queries with tenant filter | MEDIUM |
| 6 | Update authentication to include tenant | LOW |
| 7 | Test tenant isolation | MEDIUM |

### 8.2 Rollback Strategy

| Trigger | Action |
|---------|--------|
| Issues detected | Remove tenant_id columns |
| Data corruption | Restore from backup |
| Performance issues | Optimize queries |

---

## 9. FUTURE IMPACT

### 9.1 Positive Impact

| Impact | Description |
|--------|-------------|
| Multi-Company | Can support multiple companies |
| Enterprise Ready | Supports complex organizations |
| SaaS Ready | Foundation for SaaS deployment |

### 9.2 Negative Impact

| Impact | Description |
|--------|-------------|
| Complexity | More complex data model |
| Migration | Required for existing data |
| Performance | Query overhead for filtering |

---

## 10. IMPLEMENTATION NOTES

### 10.1 Technical Requirements

| Requirement | Description |
|-------------|-------------|
| Database | Add tenant_id columns |
| Middleware | Tenant isolation middleware |
| API | Update all endpoints |
| Authentication | Include tenant in JWT |

### 10.2 Dependencies

| Dependency | Status |
|------------|--------|
| Phase 24 API | Required |
| Phase 25 Multi-Branch | Required |

---

## 11. RISKS

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Migration failure | Medium | High | Backup + rollback plan |
| Data isolation breach | Low | Critical | Thorough testing |
| Performance degradation | Medium | Medium | Query optimization |

---

## 12. APPROVAL CRITERIA

| Criterion | Status |
|-----------|--------|
| Backward compatible | ✅ |
| Migration plan defined | ✅ |
| Rollback plan defined | ✅ |
| Risks mitigated | ✅ |
| Stakeholder approval | PENDING |

---

## 13. DECISION STATUS

```
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   ADR-002: TENANT MODEL                                       ║
║                                                               ║
║   STATUS: PROPOSED                                            ║
║                                                               ║
║   Decision: ALTERNATIVE C (Application-Level Multi-Tenancy)   ║
║                                                               ║
║   Rationale:                                                  ║
║   - Works with current JSON persistence                       ║
║   - Lower migration complexity                                ║
║   - Enterprise ready                                          ║
║   - Gradual implementation possible                           ║
║                                                               ║
║   NEXT ACTION: Submit for approval                            ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
```

---

**Document Generated:** 2026-08-05
**Status:** PROPOSED
**Next Action:** Submit for stakeholder approval
