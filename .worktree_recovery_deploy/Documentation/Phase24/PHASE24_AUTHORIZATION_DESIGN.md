# PHASE24_AUTHORIZATION_DESIGN.md
## DigiTronics V2 Enterprise Authorization Design

**Date:** 2026-08-05
**Status:** PLANNING ONLY
**Phase:** 24 - API Foundation & Authentication

---

## 1. AUTHORIZATION OVERVIEW

### 1.1 Current State

| Aspect | Current | Target |
|--------|---------|--------|
| Model | Role-based | RBAC + ABAC |
| Permissions | Hardcoded | Database-driven |
| Enforcement | Client-side | Server-side |
| Audit | Basic | Comprehensive |

### 1.2 Authorization Models

| Model | Use Case | Priority |
|-------|----------|----------|
| RBAC | Role-based access | HIGH |
| ABAC | Attribute-based policies | MEDIUM |
| ACL | Resource-level control | LOW |

**Decision:** RBAC as primary model
- **Reason:** Simpler to implement, sufficient for MVP
- **Alternative:** ABAC for complex scenarios
- **Trade-off:** RBAC is less flexible but easier to manage
- **Long-term:** Add ABAC for advanced use cases

---

## 2. ROLE HIERARCHY

### 2.1 Role Structure

```
┌─────────────────────────────────────────────────────────────┐
│                     ROLE HIERARCHY                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Super Admin                                                │
│    │                                                        │
│    └── Tenant Admin                                         │
│          │                                                  │
│          ├── Manager                                        │
│          │     │                                            │
│          │     ├── Sales                                    │
│          │     │                                            │
│          │     ├── Warehouse                                │
│          │     │                                            │
│          │     └── Accountant                               │
│          │                                                  │
│          └── Support                                        │
│                │                                            │
│                └── Viewer                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Role Definitions

| Role | Description | Scope |
|------|-------------|-------|
| Super Admin | Platform administrator | All tenants |
| Tenant Admin | Company administrator | Single tenant |
| Manager | Department manager | Tenant |
| Sales | Sales representative | Tenant |
| Warehouse | Warehouse staff | Branch |
| Accountant | Financial staff | Tenant |
| Support | Customer support | Tenant |
| Viewer | Read-only access | Tenant |

---

## 3. PERMISSION MODEL

### 3.1 Permission Structure

```json
{
  "resource:action": "description"
}
```

### 3.2 Resources

| Resource | Description |
|----------|-------------|
| products | Product management |
| inventory | Inventory management |
| invoices | Invoice management |
| customers | Customer management |
| suppliers | Supplier management |
| employees | Employee management |
| accounts | Account management |
| reports | Reporting |
| settings | System settings |
| users | User management |
| roles | Role management |
| tenants | Tenant management |
| audit | Audit logs |

### 3.3 Actions

| Action | Description |
|--------|-------------|
| read | View resource |
| write | Create/update resource |
| delete | Delete resource |
| export | Export resource data |
| import | Import resource data |

---

## 4. PERMISSION MATRIX

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

---

## 5. PERMISSION CHECKS

### 5.1 Middleware Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     PERMISSION CHECK                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Request → API Gateway                                   │
│                                                             │
│  2. Auth Middleware → Validate JWT                          │
│     a. Check signature                                      │
│     b. Check expiration                                     │
│     c. Extract user_id, tenant_id, role                     │
│                                                             │
│  3. Permission Middleware → Check permission                 │
│     a. Load user permissions from JWT                       │
│     b. Check if permission exists                           │
│     c. Check tenant_id matches                              │
│                                                             │
│  4. If authorized → Continue to route                       │
│     If denied → Return 403 Forbidden                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Permission Check Code

```javascript
const checkPermission = (resource, action) => {
  return (req, res, next) => {
    const { permissions, tenant_id } = req.user;
    const requiredPermission = `${resource}:${action}`;
    
    if (!permissions.includes(requiredPermission)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient permissions'
        }
      });
    }
    
    next();
  };
};

// Usage
router.get('/products', 
  authenticate, 
  checkPermission('products', 'read'), 
  getProducts
);
```

---

## 6. TENANT ISOLATION

### 6.1 Tenant Scope

| Level | Isolation | Implementation |
|-------|-----------|----------------|
| Tenant | Full | RLS policies |
| Branch | Within tenant | Branch_id filter |
| Warehouse | Within branch | Warehouse_id filter |

### 6.2 Tenant Middleware

```javascript
const tenantIsolation = (req, res, next) => {
  const { tenant_id } = req.user;
  
  // Add tenant_id to all queries
  req.tenantFilter = { tenant_id };
  
  next();
};
```

### 6.3 RLS Policies

```sql
-- Products table
CREATE POLICY tenant_isolation ON products
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Invoices table
CREATE POLICY tenant_isolation ON invoices
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

---

## 7. BRANCH ISOLATION

### 7.1 Branch Model

```json
{
  "id": "uuid",
  "tenant_id": "uuid",
  "name": "Main Branch",
  "address": "123 Main St",
  "phone": "+1234567890",
  "status": "active"
}
```

### 7.2 Branch Scoping

| Resource | Branch Scope | Implementation |
|----------|--------------|----------------|
| products | All branches | No filter |
| inventory | Branch-specific | branch_id filter |
| invoices | Branch-specific | branch_id filter |
| users | Branch-specific | branch_id filter |

---

## 8. WAREHOUSE ISOLATION

### 8.1 Warehouse Model

```json
{
  "id": "uuid",
  "branch_id": "uuid",
  "tenant_id": "uuid",
  "name": "Main Warehouse",
  "location": "Building A",
  "status": "active"
}
```

### 8.2 Warehouse Scoping

| Resource | Warehouse Scope | Implementation |
|----------|-----------------|----------------|
| products | All warehouses | No filter |
| inventory | Warehouse-specific | warehouse_id filter |
| stock_movements | Warehouse-specific | warehouse_id filter |

---

## 9. AUDIT PERMISSIONS

### 9.1 Audit Access

| Role | View Audit | Export Audit |
|------|------------|--------------|
| Super Admin | ✅ | ✅ |
| Tenant Admin | ✅ | ✅ |
| Manager | ✅ | ❌ |
| Accountant | ❌ | ❌ |
| Sales | ❌ | ❌ |
| Warehouse | ❌ | ❌ |
| Support | ❌ | ❌ |
| Viewer | ❌ | ❌ |

### 9.2 Audit Log Scope

| Scope | Access | Implementation |
|-------|--------|----------------|
| Tenant | Tenant admin | tenant_id filter |
| Branch | Branch manager | branch_id filter |
| User | Own actions | user_id filter |

---

## 10. CUSTOM ROLES

### 10.1 Custom Role Support

| Feature | Support |
|---------|---------|
| Create custom roles | ✅ |
| Assign custom permissions | ✅ |
| Role hierarchy | ✅ |
| Role inheritance | ✅ |

### 10.2 Custom Role Limitations

| Limitation | Value |
|------------|-------|
| Max roles per tenant | 20 |
| Max permissions per role | 50 |
| Cannot exceed admin permissions | ✅ |

---

## 11. PERMISSION CACHING

### 11.1 Cache Strategy

| Cache | TTL | Invalidation |
|-------|-----|--------------|
| User permissions | 5 minutes | Role change |
| Role permissions | 10 minutes | Role update |
| Tenant settings | 15 minutes | Tenant update |

### 11.2 Cache Invalidation

| Event | Action |
|-------|--------|
| Role update | Clear role cache |
| User role change | Clear user cache |
| Permission update | Clear all caches |

---

## 12. EMERGENCY ACCESS

### 12.1 Break-Glass Procedure

| Step | Action |
|------|--------|
| 1 | Contact Super Admin |
| 2 | Super Admin creates emergency role |
| 3 | Emergency role has limited permissions |
| 4 | All actions logged |
| 5 | Emergency role deleted after use |

### 12.2 Emergency Role

```json
{
  "name": "emergency",
  "permissions": [
    "products:read",
    "invoices:read",
    "customers:read"
  ],
  "expires_at": "2026-08-05T18:00:00Z"
}
```

---

## 13. TESTING STRATEGY

### 13.1 Unit Tests

- Permission check middleware
- Role hierarchy validation
- Tenant isolation

### 13.2 Integration Tests

- Full authorization flow
- Cross-tenant access attempts
- Role escalation attempts

### 13.3 Security Tests

- Permission bypass attempts
- Tenant escape attempts
- Role manipulation

---

## 14. MONITORING

### 14.1 Metrics

| Metric | Type | Description |
|--------|------|-------------|
| authz_permission_checks | Counter | Total permission checks |
| authz_permission_denied | Counter | Denied permissions |
| authz_role_changes | Counter | Role modifications |
| authz_tenant_violations | Counter | Tenant isolation violations |

### 14.2 Alerts

| Alert | Condition | Severity |
|-------|-----------|----------|
| High denial rate | > 10% denied | Medium |
| Tenant violations | > 0 | Critical |
| Role escalation | > 0 | Critical |
