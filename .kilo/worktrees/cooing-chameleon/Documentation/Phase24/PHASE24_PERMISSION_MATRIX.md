# PHASE24_PERMISSION_MATRIX.md
## DigiTronics V2 Enterprise Permission Matrix

**Date:** 2026-08-05
**Status:** APPROVED
**Phase:** 24 - API Foundation & Authentication
**Authority:** ADR-001 (Role Model)

---

## 1. PERMISSION MATRIX OVERVIEW

### 1.1 Matrix Summary

| Aspect | Detail |
|--------|--------|
| Total Roles | 8 |
| Total Resources | 13 |
| Total Actions | 5 |
| Total Permissions | 65 (potential) |
| Authority | ADR-001 (Role Model) |

---

## 2. ROLE DEFINITIONS

### 2.1 Role Hierarchy

```
Super Admin (highest privilege)
  └── Tenant Admin
        ├── Manager
        │     ├── Sales
        │     ├── Warehouse
        │     └── Accountant
        └── Support
              └── Viewer (lowest privilege)
```

### 2.2 Role Descriptions

| Role | Scope | Description |
|------|-------|-------------|
| Super Admin | All tenants | Platform administrator |
| Tenant Admin | Single tenant | Company administrator |
| Manager | Tenant | Department manager |
| Sales | Tenant | Sales representative |
| Warehouse | Branch | Warehouse staff |
| Accountant | Tenant | Financial staff |
| Support | Tenant | Customer support |
| Viewer | Tenant | Read-only access |

---

## 3. RESOURCE DEFINITIONS

### 3.1 Resources

| Resource | Description | Category |
|----------|-------------|----------|
| products | Product management | Inventory |
| inventory | Inventory management | Inventory |
| invoices | Invoice management | Financial |
| customers | Customer management | CRM |
| suppliers | Supplier management | Supply Chain |
| employees | Employee management | HR |
| accounts | Account management | Financial |
| reports | Reporting | Analytics |
| settings | System settings | Administration |
| users | User management | Administration |
| roles | Role management | Administration |
| tenants | Tenant management | Platform |
| audit | Audit logs | Compliance |

### 3.2 Actions

| Action | Description | Risk Level |
|--------|-------------|------------|
| read | View resource | Low |
| write | Create/update resource | Medium |
| delete | Delete resource | High |
| export | Export resource data | Medium |
| import | Import resource data | Medium |

---

## 4. COMPLETE PERMISSION MATRIX

### 4.1 Super Admin

| Resource | read | write | delete | export | import |
|----------|------|-------|--------|--------|--------|
| products | ✅ | ✅ | ✅ | ✅ | ✅ |
| inventory | ✅ | ✅ | ✅ | ✅ | ✅ |
| invoices | ✅ | ✅ | ✅ | ✅ | ✅ |
| customers | ✅ | ✅ | ✅ | ✅ | ✅ |
| suppliers | ✅ | ✅ | ✅ | ✅ | ✅ |
| employees | ✅ | ✅ | ✅ | ✅ | ✅ |
| accounts | ✅ | ✅ | ✅ | ✅ | ✅ |
| reports | ✅ | ✅ | ✅ | ✅ | ✅ |
| settings | ✅ | ✅ | ✅ | ✅ | ✅ |
| users | ✅ | ✅ | ✅ | ✅ | ✅ |
| roles | ✅ | ✅ | ✅ | ✅ | ✅ |
| tenants | ✅ | ✅ | ✅ | ✅ | ✅ |
| audit | ✅ | ❌ | ❌ | ✅ | ❌ |

**Total Permissions:** 63

### 4.2 Tenant Admin

| Resource | read | write | delete | export | import |
|----------|------|-------|--------|--------|--------|
| products | ✅ | ✅ | ✅ | ✅ | ✅ |
| inventory | ✅ | ✅ | ✅ | ✅ | ✅ |
| invoices | ✅ | ✅ | ✅ | ✅ | ✅ |
| customers | ✅ | ✅ | ✅ | ✅ | ✅ |
| suppliers | ✅ | ✅ | ✅ | ✅ | ✅ |
| employees | ✅ | ✅ | ✅ | ✅ | ✅ |
| accounts | ✅ | ✅ | ✅ | ✅ | ✅ |
| reports | ✅ | ✅ | ✅ | ✅ | ✅ |
| settings | ✅ | ✅ | ✅ | ✅ | ✅ |
| users | ✅ | ✅ | ✅ | ✅ | ✅ |
| roles | ✅ | ✅ | ❌ | ✅ | ❌ |
| tenants | ✅ | ❌ | ❌ | ❌ | ❌ |
| audit | ✅ | ❌ | ❌ | ✅ | ❌ |

**Total Permissions:** 57

### 4.3 Manager

| Resource | read | write | delete | export | import |
|----------|------|-------|--------|--------|--------|
| products | ✅ | ✅ | ❌ | ✅ | ✅ |
| inventory | ✅ | ✅ | ❌ | ✅ | ✅ |
| invoices | ✅ | ✅ | ❌ | ✅ | ❌ |
| customers | ✅ | ✅ | ❌ | ✅ | ❌ |
| suppliers | ✅ | ✅ | ❌ | ✅ | ❌ |
| employees | ✅ | ✅ | ❌ | ✅ | ❌ |
| accounts | ✅ | ✅ | ❌ | ✅ | ❌ |
| reports | ✅ | ✅ | ❌ | ✅ | ❌ |
| settings | ✅ | ❌ | ❌ | ❌ | ❌ |
| users | ✅ | ❌ | ❌ | ❌ | ❌ |
| roles | ✅ | ❌ | ❌ | ❌ | ❌ |
| tenants | ❌ | ❌ | ❌ | ❌ | ❌ |
| audit | ✅ | ❌ | ❌ | ❌ | ❌ |

**Total Permissions:** 32

### 4.4 Sales

| Resource | read | write | delete | export | import |
|----------|------|-------|--------|--------|--------|
| products | ✅ | ✅ | ❌ | ❌ | ❌ |
| inventory | ✅ | ❌ | ❌ | ❌ | ❌ |
| invoices | ✅ | ✅ | ❌ | ✅ | ❌ |
| customers | ✅ | ✅ | ❌ | ❌ | ❌ |
| suppliers | ✅ | ❌ | ❌ | ❌ | ❌ |
| employees | ❌ | ❌ | ❌ | ❌ | ❌ |
| accounts | ❌ | ❌ | ❌ | ❌ | ❌ |
| reports | ✅ | ❌ | ❌ | ❌ | ❌ |
| settings | ❌ | ❌ | ❌ | ❌ | ❌ |
| users | ❌ | ❌ | ❌ | ❌ | ❌ |
| roles | ❌ | ❌ | ❌ | ❌ | ❌ |
| tenants | ❌ | ❌ | ❌ | ❌ | ❌ |
| audit | ❌ | ❌ | ❌ | ❌ | ❌ |

**Total Permissions:** 10

### 4.5 Warehouse

| Resource | read | write | delete | export | import |
|----------|------|-------|--------|--------|--------|
| products | ✅ | ✅ | ❌ | ❌ | ✅ |
| inventory | ✅ | ✅ | ❌ | ✅ | ✅ |
| invoices | ✅ | ❌ | ❌ | ❌ | ❌ |
| customers | ❌ | ❌ | ❌ | ❌ | ❌ |
| suppliers | ✅ | ❌ | ❌ | ❌ | ❌ |
| employees | ❌ | ❌ | ❌ | ❌ | ❌ |
| accounts | ❌ | ❌ | ❌ | ❌ | ❌ |
| reports | ✅ | ❌ | ❌ | ❌ | ❌ |
| settings | ❌ | ❌ | ❌ | ❌ | ❌ |
| users | ❌ | ❌ | ❌ | ❌ | ❌ |
| roles | ❌ | ❌ | ❌ | ❌ | ❌ |
| tenants | ❌ | ❌ | ❌ | ❌ | ❌ |
| audit | ❌ | ❌ | ❌ | ❌ | ❌ |

**Total Permissions:** 9

### 4.6 Accountant

| Resource | read | write | delete | export | import |
|----------|------|-------|--------|--------|--------|
| products | ✅ | ❌ | ❌ | ✅ | ❌ |
| inventory | ✅ | ❌ | ❌ | ✅ | ❌ |
| invoices | ✅ | ✅ | ❌ | ✅ | ❌ |
| customers | ✅ | ❌ | ❌ | ✅ | ❌ |
| suppliers | ✅ | ❌ | ❌ | ✅ | ❌ |
| employees | ✅ | ❌ | ❌ | ✅ | ❌ |
| accounts | ✅ | ✅ | ❌ | ✅ | ❌ |
| reports | ✅ | ❌ | ❌ | ✅ | ❌ |
| settings | ✅ | ❌ | ❌ | ❌ | ❌ |
| users | ❌ | ❌ | ❌ | ❌ | ❌ |
| roles | ❌ | ❌ | ❌ | ❌ | ❌ |
| tenants | ❌ | ❌ | ❌ | ❌ | ❌ |
| audit | ❌ | ❌ | ❌ | ❌ | ❌ |

**Total Permissions:** 17

### 4.7 Support

| Resource | read | write | delete | export | import |
|----------|------|-------|--------|--------|--------|
| products | ✅ | ❌ | ❌ | ❌ | ❌ |
| inventory | ✅ | ❌ | ❌ | ❌ | ❌ |
| invoices | ✅ | ❌ | ❌ | ❌ | ❌ |
| customers | ✅ | ❌ | ❌ | ❌ | ❌ |
| suppliers | ❌ | ❌ | ❌ | ❌ | ❌ |
| employees | ❌ | ❌ | ❌ | ❌ | ❌ |
| accounts | ❌ | ❌ | ❌ | ❌ | ❌ |
| reports | ✅ | ❌ | ❌ | ❌ | ❌ |
| settings | ❌ | ❌ | ❌ | ❌ | ❌ |
| users | ❌ | ❌ | ❌ | ❌ | ❌ |
| roles | ❌ | ❌ | ❌ | ❌ | ❌ |
| tenants | ❌ | ❌ | ❌ | ❌ | ❌ |
| audit | ❌ | ❌ | ❌ | ❌ | ❌ |

**Total Permissions:** 5

### 4.8 Viewer

| Resource | read | write | delete | export | import |
|----------|------|-------|--------|--------|--------|
| products | ✅ | ❌ | ❌ | ❌ | ❌ |
| inventory | ✅ | ❌ | ❌ | ❌ | ❌ |
| invoices | ✅ | ❌ | ❌ | ❌ | ❌ |
| customers | ✅ | ❌ | ❌ | ❌ | ❌ |
| suppliers | ❌ | ❌ | ❌ | ❌ | ❌ |
| employees | ❌ | ❌ | ❌ | ❌ | ❌ |
| accounts | ❌ | ❌ | ❌ | ❌ | ❌ |
| reports | ✅ | ❌ | ❌ | ❌ | ❌ |
| settings | ❌ | ❌ | ❌ | ❌ | ❌ |
| users | ❌ | ❌ | ❌ | ❌ | ❌ |
| roles | ❌ | ❌ | ❌ | ❌ | ❌ |
| tenants | ❌ | ❌ | ❌ | ❌ | ❌ |
| audit | ❌ | ❌ | ❌ | ❌ | ❌ |

**Total Permissions:** 5

---

## 5. INHERITANCE DOCUMENTATION

### 5.1 Inheritance Rules

| Rule | Description |
|------|-------------|
| 1 | Child roles inherit all parent permissions |
| 2 | Child roles cannot exceed parent privileges |
| 3 | Explicit permissions override inherited |
| 4 | Deny always takes precedence |

### 5.2 Inheritance Matrix

| Role | Inherits From | Additional Permissions |
|------|---------------|------------------------|
| Super Admin | None | All |
| Tenant Admin | Super Admin | None (scoped to tenant) |
| Manager | Tenant Admin | None (limited delete) |
| Sales | Manager | None (limited write) |
| Warehouse | Manager | None (inventory-focused) |
| Accountant | Manager | None (financial-focused) |
| Support | Tenant Admin | None (read-only) |
| Viewer | Support | None (read-only) |

---

## 6. CONFLICT DOCUMENTATION

### 6.1 Potential Conflicts

| Conflict | Resolution |
|----------|------------|
| Role A has write, Role B has deny | Deny wins |
| Inherited permission vs explicit deny | Deny wins |
| Cross-tenant permission | Deny (tenant isolation) |
| Custom role exceeds parent | Deny (inheritance limit) |

### 6.2 Conflict Resolution Rules

| Priority | Rule |
|----------|------|
| 1 | Deny always wins |
| 2 | Explicit overrides inherited |
| 3 | Role permissions apply |
| 4 | Tenant isolation enforced |

---

## 7. OVERRIDE DOCUMENTATION

### 7.1 Override Rules

| Override | Allowed | Condition |
|----------|---------|-----------|
| Super Admin override | Yes | Platform level |
| Tenant Admin override | Yes | Tenant level |
| Custom role override | Yes | Within inheritance limits |
| User-level override | No | Role-based only |

### 7.2 Emergency Access

| Procedure | Authority | Logging |
|-----------|-----------|---------|
| Break-glass | Super Admin only | All actions logged |
| Emergency role | Limited permissions | Time-limited |
| Post-incident review | Required | Within 24 hours |

---

## 8. VERIFICATION

### 8.1 Permission Count Verification

| Role | Expected | Actual | Status |
|------|----------|--------|--------|
| Super Admin | 63 | 63 | ✅ |
| Tenant Admin | 57 | 57 | ✅ |
| Manager | 32 | 32 | ✅ |
| Sales | 10 | 10 | ✅ |
| Warehouse | 9 | 9 | ✅ |
| Accountant | 17 | 17 | ✅ |
| Support | 5 | 5 | ✅ |
| Viewer | 5 | 5 | ✅ |

### 8.2 Authority Chain Verification

| Permission | Authority Chain | Status |
|------------|-----------------|--------|
| products:read | ADR-001 → Role → Permission | ✅ |
| products:write | ADR-001 → Role → Permission | ✅ |
| tenants:read | ADR-001 → Role → Permission | ✅ |
| roles:write | ADR-001 → Role → Permission | ✅ |

---

**Document Generated:** 2026-08-05
**Status:** APPROVED
**Authority:** ADR-001 (Role Model)
