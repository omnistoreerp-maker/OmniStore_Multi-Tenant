# PHASE24_TENANT_MIGRATION.md
## DigiTronics V2 Enterprise Tenant Migration

**Date:** 2026-08-05
**Status:** APPROVED
**Phase:** 24 - API Foundation & Authentication
**Authority:** ADR-002 (Tenant Model)

---

## 1. TENANT MIGRATION OVERVIEW

### 1.1 Migration Summary

| Aspect | Detail |
|--------|--------|
| Current Model | Single-tenant (no isolation) |
| Target Model | Multi-tenant (application-level) |
| Hierarchy | Tenant → Branch → Warehouse |
| Persistence | JSON files with tenant_id |
| Breaking Changes | None (backward compatible) |
| Risk Level | MEDIUM |

---

## 2. CURRENT MODEL

### 2.1 Single-Tenant Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     CURRENT MODEL                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Users ──────────────────────────────────────────────────┐  │
│  Products ─────────────────────────────────────────────┐  │  │
│  Sales ──────────────────────────────────────────────┐  │  │  │
│  Purchases ───────────────────────────────────────┐  │  │  │  │
│  Customers ────────────────────────────────────┐  │  │  │  │  │
│  Suppliers ─────────────────────────────────┐  │  │  │  │  │  │
│                                              │  │  │  │  │  │  │
│  ┌─────────────────────────────────────────┐│  │  │  │  │  │  │
│  │         JSON FILE PERSISTENCE           ││  │  │  │  │  │  │
│  │         (No tenant isolation)           ││  │  │  │  │  │  │
│  └─────────────────────────────────────────┘│  │  │  │  │  │  │
│                                              │  │  │  │  │  │  │
└──────────────────────────────────────────────┘  │  │  │  │  │  │
                                                  │  │  │  │  │  │
                                                  └──┘  │  │  │  │
                                                        └──┘  │  │
                                                              └──┘
```

### 2.2 Current Limitations

| Limitation | Impact |
|------------|--------|
| No tenant isolation | Cannot support multiple companies |
| No branch support | Cannot support multiple locations |
| No warehouse support | Cannot track inventory by location |
| Single data store | No data separation |

---

## 3. TARGET MODEL

### 3.1 Multi-Tenant Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     TARGET MODEL (ADR-002)                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   TENANT (Company)                   │   │
│  │  id: uuid                                           │   │
│  │  name: "Acme Corp"                                  │   │
│  │  slug: "acme-corp"                                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   BRANCH (Location)                  │   │
│  │  id: uuid                                           │   │
│  │  tenant_id: uuid (FK)                               │   │
│  │  name: "Main Office"                                │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                WAREHOUSE (Storage)                   │   │
│  │  id: uuid                                           │   │
│  │  branch_id: uuid (FK)                               │   │
│  │  tenant_id: uuid (FK)                               │   │
│  │  name: "Main Warehouse"                             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Tenant Hierarchy

| Level | Entity | Ownership |
|-------|--------|-----------|
| 1 | Tenant | Company |
| 2 | Branch | Tenant |
| 3 | Warehouse | Branch |

---

## 4. ISOLATION STRATEGY

### 4.1 Isolation Levels

| Level | Isolation | Implementation |
|-------|-----------|----------------|
| Tenant | Full | tenant_id filter on all queries |
| Branch | Within tenant | branch_id filter |
| Warehouse | Within branch | warehouse_id filter |

### 4.2 Application-Level Isolation

```javascript
// Tenant Isolation Middleware
const tenantIsolation = (req, res, next) => {
  const { tenant_id } = req.user;
  
  // Add tenant_id to all queries
  req.tenantFilter = { tenant_id };
  
  next();
};

// Branch Isolation Middleware
const branchIsolation = (req, res, next) => {
  const { branch_id } = req.user;
  
  // Add branch_id to queries
  req.branchFilter = { branch_id };
  
  next();
};
```

### 4.3 Data Isolation Rules

| Resource | Isolation | Filter |
|----------|-----------|--------|
| Users | Tenant | tenant_id |
| Products | Tenant | tenant_id |
| Sales | Tenant | tenant_id |
| Purchases | Tenant | tenant_id |
| Customers | Tenant | tenant_id |
| Suppliers | Tenant | tenant_id |
| Inventory | Branch | branch_id, tenant_id |
| Stock Movements | Warehouse | warehouse_id, tenant_id |

---

## 5. BRANCH OWNERSHIP

### 5.1 Branch Model

```json
{
  "id": "uuid",
  "tenant_id": "uuid",
  "name": "Main Branch",
  "address": "123 Main St",
  "phone": "+1234567890",
  "status": "active",
  "created_at": "2026-08-05T12:00:00Z",
  "updated_at": "2026-08-05T12:00:00Z"
}
```

### 5.2 Branch Rules

| Rule | Description |
|------|-------------|
| 1 | Each branch belongs to exactly one tenant |
| 2 | Branch names are unique within a tenant |
| 3 | A tenant must have at least one branch |
| 4 | Branches cannot be deleted if they have inventory |

---

## 6. WAREHOUSE OWNERSHIP

### 6.1 Warehouse Model

```json
{
  "id": "uuid",
  "branch_id": "uuid",
  "tenant_id": "uuid",
  "name": "Main Warehouse",
  "location": "Building A",
  "status": "active",
  "created_at": "2026-08-05T12:00:00Z",
  "updated_at": "2026-08-05T12:00:00Z"
}
```

### 6.2 Warehouse Rules

| Rule | Description |
|------|-------------|
| 1 | Each warehouse belongs to exactly one branch |
| 2 | Warehouse names are unique within a branch |
| 3 | A branch must have at least one warehouse |
| 4 | Warehouses cannot be deleted if they have stock |

---

## 7. JSON PERSISTENCE STRATEGY

### 7.1 File Structure

```
backend/data/
├── tenants/
│   ├── {tenant-id-1}.json
│   └── {tenant-id-2}.json
├── branches/
│   ├── {branch-id-1}.json
│   └── {branch-id-2}.json
├── warehouses/
│   ├── {warehouse-id-1}.json
│   └── {warehouse-id-2}.json
├── users/
│   ├── {tenant-id-1}.json
│   └── {tenant-id-2}.json
├── products/
│   ├── {tenant-id-1}.json
│   └── {tenant-id-2}.json
└── ...
```

### 7.2 File Store Implementation

```javascript
// Tenant-scoped file store
class TenantFileStore {
  constructor(tenantId) {
    this.tenantId = tenantId;
    this.basePath = `backend/data`;
  }
  
  async read(filename) {
    const path = `${this.basePath}/${filename}/${this.tenantId}.json`;
    return await fileStore.read(path);
  }
  
  async write(filename, data) {
    const path = `${this.basePath}/${filename}/${this.tenantId}.json`;
    return await fileStore.write(path, data);
  }
}
```

---

## 8. FUTURE DATABASE MIGRATION

### 8.1 Migration Path

| Phase | Change | Impact |
|-------|--------|--------|
| Phase 24 | Add tenant_id to JSON files | Low |
| Phase 25 | Formalize multi-tenant | Medium |
| Phase 30 | PostgreSQL migration | High |

### 8.2 PostgreSQL Schema (Future)

```sql
-- Tenants table
CREATE TABLE tenants (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  settings JSONB,
  plan VARCHAR(50),
  status VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Branches table
CREATE TABLE branches (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  name VARCHAR(255) NOT NULL,
  address TEXT,
  phone VARCHAR(50),
  status VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Warehouses table
CREATE TABLE warehouses (
  id UUID PRIMARY KEY,
  branch_id UUID REFERENCES branches(id),
  tenant_id UUID REFERENCES tenants(id),
  name VARCHAR(255) NOT NULL,
  location VARCHAR(255),
  status VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Row-Level Security
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON products
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

---

## 9. VALIDATION

### 9.1 Migration Validation Checklist

| # | Validation | Status |
|---|------------|--------|
| 1 | Default tenant created | PENDING |
| 2 | Existing data assigned to default tenant | PENDING |
| 3 | Tenant middleware working | PENDING |
| 4 | Branch isolation working | PENDING |
| 5 | Warehouse isolation working | PENDING |
| 6 | No data leakage | PENDING |
| 7 | Performance acceptable | PENDING |

### 9.2 Isolation Validation

| Test | Expected | Status |
|------|----------|--------|
| User A cannot see User B's data | Deny | PENDING |
| Branch A cannot see Branch B's data | Deny | PENDING |
| Warehouse A cannot see Warehouse B's data | Deny | PENDING |
| Cross-tenant access blocked | Deny | PENDING |

---

## 10. EXAMPLES

### 10.1 Example: Acme Corp Migration

**Scenario:** Acme Corp has existing data without tenant_id.

**Step 1: Create Default Tenant**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Acme Corp",
  "slug": "acme-corp",
  "plan": "enterprise",
  "status": "active"
}
```

**Step 2: Create Default Branch**
```json
{
  "id": "660e8400-e29b-41d4-a716-446655440001",
  "tenant_id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Main Office",
  "address": "123 Main St",
  "status": "active"
}
```

**Step 3: Create Default Warehouse**
```json
{
  "id": "770e8400-e29b-41d4-a716-446655440002",
  "branch_id": "660e8400-e29b-41d4-a716-446655440001",
  "tenant_id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Main Warehouse",
  "location": "Building A",
  "status": "active"
}
```

**Step 4: Assign Existing Data**
```javascript
// Add tenant_id to all existing records
const defaultTenantId = '550e8400-e29b-41d4-a716-446655440000';
const defaultBranchId = '660e8400-e29b-41d4-a716-446655440001';
const defaultWarehouseId = '770e8400-e29b-41d4-a716-446655440002';

// Update users
users.forEach(user => {
  user.tenant_id = defaultTenantId;
  user.branch_id = defaultBranchId;
});

// Update products
products.forEach(product => {
  product.tenant_id = defaultTenantId;
  product.warehouse_id = defaultWarehouseId;
});
```

---

## 11. ROLLBACK

### 11.1 Rollback Strategy

| Trigger | Action |
|---------|--------|
| Isolation issues | Remove tenant_id filters |
| Performance issues | Optimize queries |
| Data corruption | Restore from backup |

### 11.2 Rollback Steps

| Step | Action |
|------|--------|
| 1 | Disable tenant middleware |
| 2 | Remove tenant_id from queries |
| 3 | Restore original file structure |
| 4 | Test all endpoints |
| 5 | Verify no data loss |

---

**Document Generated:** 2026-08-05
**Status:** APPROVED
**Authority:** ADR-002 (Tenant Model)
