# PHASE24_ROLE_MAPPING.md
## DigiTronics V2 Enterprise Role Mapping

**Date:** 2026-08-05
**Status:** APPROVED
**Phase:** 24 - API Foundation & Authentication
**Authority:** ADR-001 (Role Model)

---

## 1. ROLE MAPPING OVERVIEW

### 1.1 Migration Summary

| Aspect | Detail |
|--------|--------|
| Current Roles | 5 (Owner, Admin, Manager, Sales, Viewer) |
| Target Roles | 8 (Super Admin, Tenant Admin, Manager, Sales, Viewer, Warehouse, Accountant, Support) |
| Migration Type | Backward Compatible (Alias Mapping) |
| Breaking Changes | None |
| Risk Level | LOW |

---

## 2. DETAILED ROLE MAPPING

### 2.1 Owner → Super Admin

| Property | Current (Owner) | Target (Super Admin) |
|----------|-----------------|----------------------|
| Scope | All tenants | All tenants |
| Permissions | Full access | Full access |
| Migration | Automatic alias | No change required |
| Backward Compatible | Yes | Yes |

**Migration Rule:**
```javascript
// When user.role === 'Owner', treat as 'Super Admin'
const effectiveRole = user.role === 'Owner' ? 'Super Admin' : user.role;
```

**Validation:**
- Owner users continue to work without changes
- New Super Admin users can be created
- Both role names accepted in API

### 2.2 Admin → Tenant Admin

| Property | Current (Admin) | Target (Tenant Admin) |
|----------|-----------------|----------------------|
| Scope | Single tenant | Single tenant |
| Permissions | Full access within tenant | Full access within tenant |
| Migration | Automatic alias | No change required |
| Backward Compatible | Yes | Yes |

**Migration Rule:**
```javascript
// When user.role === 'Admin', treat as 'Tenant Admin'
const effectiveRole = user.role === 'Admin' ? 'Tenant Admin' : user.role;
```

**Validation:**
- Admin users continue to work without changes
- New Tenant Admin users can be created
- Both role names accepted in API

### 2.3 Manager → Manager

| Property | Current (Manager) | Target (Manager) |
|----------|-------------------|------------------|
| Scope | Tenant | Tenant |
| Permissions | Write access | Write access |
| Migration | No change | No change |
| Backward Compatible | Yes | Yes |

**Migration Rule:** No change required.

### 2.4 Sales → Sales

| Property | Current (Sales) | Target (Sales) |
|----------|-----------------|----------------|
| Scope | Tenant | Tenant |
| Permissions | Write access | Write access |
| Migration | No change | No change |
| Backward Compatible | Yes | Yes |

**Migration Rule:** No change required.

### 2.5 Viewer → Viewer

| Property | Current (Viewer) | Target (Viewer) |
|----------|------------------|-----------------|
| Scope | Tenant | Tenant |
| Permissions | Read-only | Read-only |
| Migration | No change | No change |
| Backward Compatible | Yes | Yes |

**Migration Rule:** No change required.

### 2.6 Warehouse (New)

| Property | Value |
|----------|-------|
| Scope | Branch |
| Permissions | Inventory, products, suppliers |
| Migration | New role creation |
| Backward Compatible | N/A (new) |

**Creation Rule:**
```javascript
// Create new Warehouse role
const warehouseRole = {
  name: 'Warehouse',
  display_name: 'Warehouse Staff',
  permissions: [
    'products:read', 'products:write',
    'inventory:read', 'inventory:write',
    'suppliers:read'
  ],
  description: 'Warehouse staff with inventory access'
};
```

### 2.7 Accountant (New)

| Property | Value |
|----------|-------|
| Scope | Tenant |
| Permissions | Financial data, reports |
| Migration | New role creation |
| Backward Compatible | N/A (new) |

**Creation Rule:**
```javascript
// Create new Accountant role
const accountantRole = {
  name: 'Accountant',
  display_name: 'Accountant',
  permissions: [
    'products:read',
    'inventory:read',
    'invoices:read', 'invoices:write',
    'customers:read',
    'suppliers:read',
    'employees:read',
    'accounts:read', 'accounts:write',
    'reports:read', 'reports:export'
  ],
  description: 'Financial staff with accounting access'
};
```

### 2.8 Support (New)

| Property | Value |
|----------|-------|
| Scope | Tenant |
| Permissions | Read-only, customer support |
| Migration | New role creation |
| Backward Compatible | N/A (new) |

**Creation Rule:**
```javascript
// Create new Support role
const supportRole = {
  name: 'Support',
  display_name: 'Support Staff',
  permissions: [
    'products:read',
    'inventory:read',
    'invoices:read',
    'customers:read',
    'reports:read'
  ],
  description: 'Customer support with read-only access'
};
```

---

## 3. PERMISSION INHERITANCE

### 3.1 Inheritance Rules

| Rule | Description |
|------|-------------|
| 1 | Child roles inherit all parent permissions |
| 2 | Child roles cannot exceed parent privileges |
| 3 | Custom permissions can be added within inheritance limits |
| 4 | Inheritance is transitive (grandchild inherits grandparent) |

### 3.2 Inheritance Chain

```
Super Admin (all permissions)
  └── Tenant Admin (all except tenant management)
        ├── Manager (write access, no delete)
        │     ├── Sales (limited write, no employee/account)
        │     ├── Warehouse (inventory-focused)
        │     └── Accountant (financial-focused)
        └── Support (read-only)
              └── Viewer (read-only, limited resources)
```

### 3.3 Permission Conflict Resolution

| Scenario | Resolution |
|----------|------------|
| Conflicting permissions | Deny takes precedence |
| Inherited vs explicit | Explicit wins |
| Role vs user | Role permissions apply |
| Cross-tenant | Deny (tenant isolation) |

---

## 4. COMPATIBILITY

### 4.1 Backward Compatibility Matrix

| Feature | Old System | New System | Compatible |
|---------|------------|------------|------------|
| Owner login | Works | Works (alias) | Yes |
| Admin login | Works | Works (alias) | Yes |
| Manager login | Works | Works | Yes |
| Sales login | Works | Works | Yes |
| Viewer login | Works | Works | Yes |
| Role in JWT | Works | Works | Yes |
| Role in API | Works | Works | Yes |

### 4.2 API Compatibility

| Endpoint | Old Behavior | New Behavior | Compatible |
|----------|--------------|--------------|------------|
| POST /auth/login | Accepts role | Accepts role + alias | Yes |
| GET /users | Returns role | Returns effective role | Yes |
| PUT /users/:id | Updates role | Updates role + validates | Yes |
| GET /roles | Returns roles | Returns all 8 roles | Yes |

### 4.3 Frontend Compatibility

| Component | Old Behavior | New Behavior | Compatible |
|-----------|--------------|--------------|------------|
| Role display | Shows old name | Shows effective name | Yes |
| Permission check | Uses old role | Uses effective role | Yes |
| Role selector | Shows old roles | Shows all 8 roles | Yes |

---

## 5. VALIDATION

### 5.1 Migration Validation Checklist

| # | Validation | Status |
|---|------------|--------|
| 1 | Owner users can login | PENDING |
| 2 | Admin users can login | PENDING |
| 3 | Manager users can login | PENDING |
| 4 | Sales users can login | PENDING |
| 5 | Viewer users can login | PENDING |
| 6 | New roles can be created | PENDING |
| 7 | Permissions inherit correctly | PENDING |
| 8 | No breaking changes | PENDING |

### 5.2 Rollback Validation

| # | Validation | Status |
|---|------------|--------|
| 1 | Can revert to 5 roles | PENDING |
| 2 | No data loss | PENDING |
| 3 | All users remain functional | PENDING |

---

## 6. EDGE CASES

### 6.1 Edge Cases

| Edge Case | Handling |
|-----------|----------|
| User with multiple roles | Single role per user (enforced) |
| Custom role exceeding parent | Deny (inheritance limit) |
| Role not in mapping | Pass-through (no change) |
| Invalid role name | Reject with error |
| Role with no permissions | Allow (read-only equivalent) |

### 6.2 Migration Examples

**Example 1: Owner User Login**
```javascript
// Input: { email: 'owner@acme.com', password: '***' }
// Database: { role: 'Owner' }
// JWT: { role: 'Super Admin' } // Alias applied
// Response: { user: { role: 'Super Admin' } }
```

**Example 2: Admin User Login**
```javascript
// Input: { email: 'admin@acme.com', password: '***' }
// Database: { role: 'Admin' }
// JWT: { role: 'Tenant Admin' } // Alias applied
// Response: { user: { role: 'Tenant Admin' } }
```

**Example 3: New Warehouse User**
```javascript
// Input: { email: 'warehouse@acme.com', role: 'Warehouse' }
// Database: { role: 'Warehouse' }
// JWT: { role: 'Warehouse' }
// Response: { user: { role: 'Warehouse' } }
```

---

## 7. ROLLBACK

### 7.1 Rollback Strategy

| Trigger | Action |
|---------|--------|
| Migration issues | Revert role mappings |
| Permission conflicts | Restore original permissions |
| User complaints | Keep both systems temporarily |

### 7.2 Rollback Steps

| Step | Action |
|------|--------|
| 1 | Disable new role creation |
| 2 | Revert alias mappings |
| 3 | Restore original 5 roles |
| 4 | Test all user logins |
| 5 | Verify no data loss |

---

## 8. EXAMPLES

### 8.1 Example: Full Migration Scenario

**Scenario:** Acme Corp has 10 users with old roles.

| User | Old Role | New Role | Migration |
|------|----------|----------|-----------|
| John | Owner | Super Admin | Alias |
| Jane | Admin | Tenant Admin | Alias |
| Bob | Manager | Manager | None |
| Alice | Sales | Sales | None |
| Charlie | Viewer | Viewer | None |
| Diana | - | Warehouse | New |
| Eve | - | Accountant | New |
| Frank | - | Support | New |

**Result:** All 10 users continue to work. 3 new users added.

---

**Document Generated:** 2026-08-05
**Status:** APPROVED
**Authority:** ADR-001 (Role Model)
