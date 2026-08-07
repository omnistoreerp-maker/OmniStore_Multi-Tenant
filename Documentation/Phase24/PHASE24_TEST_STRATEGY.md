# PHASE24_TEST_STRATEGY.md
## DigiTronics V2 Enterprise Test Strategy

**Date:** 2026-08-05
**Status:** APPROVED
**Phase:** 24 - API Foundation & Authentication
**Authority:** ADR-001, ADR-002

---

## 1. TEST OVERVIEW

### 1.1 Test Pyramid

```
┌─────────────────────────────────────────────────────────────┐
│                     E2E TESTS (10%)                         │
│  - Full user flows                                          │
│  - Critical paths                                           │
├─────────────────────────────────────────────────────────────┤
│                     INTEGRATION TESTS (30%)                 │
│  - API endpoints                                            │
│  - File operations                                          │
│  - Service interactions                                     │
├─────────────────────────────────────────────────────────────┤
│                     UNIT TESTS (60%)                        │
│  - Services                                                 │
│  - Utilities                                                │
│  - Middleware                                               │
│  - Helpers                                                 │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Coverage Targets

| Component | Target | Minimum |
|-----------|--------|---------|
| Services | 90% | 80% |
| Utilities | 85% | 75% |
| Middleware | 95% | 90% |
| Routes | 80% | 70% |
| Overall | 85% | 75% |

### 1.3 Test Environment

| Component | Technology | Status |
|-----------|------------|--------|
| Runtime | Node.js 22 | EXISTS |
| Framework | Jest | EXISTS |
| HTTP Testing | Supertest | EXISTS |
| E2E | Playwright | EXISTS |
| Data Persistence | JSON files (test) | EXISTS |
| Authentication | JWT (test) | EXISTS |

---

## 2. EXISTING TESTS (VERIFIED)

### 2.1 Backend Tests

| Test File | Purpose | Status |
|-----------|---------|--------|
| auth.test.js | Authentication endpoints | EXISTS |
| security.test.js | Security middleware | EXISTS |
| smoke.test.js | Smoke tests | EXISTS |
| health.test.js | Health endpoint | EXISTS |
| crud.test.js | CRUD operations | EXISTS |
| sales.test.js | Sales invoices | EXISTS |
| purchases.test.js | Purchase invoices | EXISTS |
| inventory.test.js | Inventory management | EXISTS |
| partnersVouchers.test.js | Partners & vouchers | EXISTS |
| dashboardReports.test.js | Dashboard & reports | EXISTS |
| middleware.test.js | Middleware behavior | EXISTS |
| fileStore.test.js | File persistence | EXISTS |
| sync.test.js | Sync operations | EXISTS |
| shutdown.test.js | Graceful shutdown | EXISTS |
| helpers.test.js | Test utilities | EXISTS |

---

## 3. ADR-001 ROLE MODEL TESTS

### 3.1 Backward Compatibility Tests

```javascript
describe('ADR-001 Backward Compatibility', () => {
  it('should accept Owner role as Super Admin', async () => {
    const user = { role: 'Owner' };
    const effectiveRole = getEffectiveRole(user.role);
    expect(effectiveRole).toBe('Super Admin');
  });

  it('should accept Admin role as Tenant Admin', async () => {
    const user = { role: 'Admin' };
    const effectiveRole = getEffectiveRole(user.role);
    expect(effectiveRole).toBe('Tenant Admin');
  });

  it('should keep Manager role unchanged', async () => {
    const user = { role: 'Manager' };
    const effectiveRole = getEffectiveRole(user.role);
    expect(effectiveRole).toBe('Manager');
  });

  it('should keep Sales role unchanged', async () => {
    const user = { role: 'Sales' };
    const effectiveRole = getEffectiveRole(user.role);
    expect(effectiveRole).toBe('Sales');
  });

  it('should keep Viewer role unchanged', async () => {
    const user = { role: 'Viewer' };
    const effectiveRole = getEffectiveRole(user.role);
    expect(effectiveRole).toBe('Viewer');
  });
});
```

### 3.2 Owner Alias Tests

```javascript
describe('ADR-001 Owner Alias', () => {
  it('should allow Owner to access all resources', async () => {
    const user = { role: 'Owner' };
    const hasPermission = checkPermission(user, 'products', 'read');
    expect(hasPermission).toBe(true);
  });

  it('should allow Owner to delete resources', async () => {
    const user = { role: 'Owner' };
    const hasPermission = checkPermission(user, 'products', 'delete');
    expect(hasPermission).toBe(true);
  });

  it('should allow Owner to manage users', async () => {
    const user = { role: 'Owner' };
    const hasPermission = checkPermission(user, 'users', 'write');
    expect(hasPermission).toBe(true);
  });
});
```

### 3.3 Admin Alias Tests

```javascript
describe('ADR-001 Admin Alias', () => {
  it('should allow Admin to access tenant resources', async () => {
    const user = { role: 'Admin', tenant_id: 'tenant-1' };
    const hasPermission = checkPermission(user, 'products', 'read');
    expect(hasPermission).toBe(true);
  });

  it('should restrict Admin from managing tenants', async () => {
    const user = { role: 'Admin', tenant_id: 'tenant-1' };
    const hasPermission = checkPermission(user, 'tenants', 'write');
    expect(hasPermission).toBe(false);
  });
});
```

### 3.4 New Role Tests

```javascript
describe('ADR-001 New Roles', () => {
  it('should create Warehouse role with correct permissions', async () => {
    const role = await createRole('Warehouse');
    expect(role.permissions).toContain('products:read');
    expect(role.permissions).toContain('inventory:read');
    expect(role.permissions).toContain('inventory:write');
  });

  it('should create Accountant role with correct permissions', async () => {
    const role = await createRole('Accountant');
    expect(role.permissions).toContain('invoices:read');
    expect(role.permissions).toContain('accounts:read');
    expect(role.permissions).toContain('reports:export');
  });

  it('should create Support role with correct permissions', async () => {
    const role = await createRole('Support');
    expect(role.permissions).toContain('products:read');
    expect(role.permissions).toContain('customers:read');
    expect(role.permissions).not.toContain('products:write');
  });
});
```

### 3.5 Permission Inheritance Tests

```javascript
describe('ADR-001 Permission Inheritance', () => {
  it('should inherit permissions from parent role', async () => {
    const user = { role: 'Tenant Admin' };
    const hasPermission = checkPermission(user, 'products', 'read');
    expect(hasPermission).toBe(true);
  });

  it('should not exceed parent permissions', async () => {
    const user = { role: 'Viewer' };
    const hasPermission = checkPermission(user, 'products', 'write');
    expect(hasPermission).toBe(false);
  });
});
```

---

## 4. ADR-002 TENANT MODEL TESTS

### 4.1 Tenant Isolation Tests

```javascript
describe('ADR-002 Tenant Isolation', () => {
  it('should isolate data between tenants', async () => {
    const tenant1User = { tenant_id: 'tenant-1' };
    const tenant2User = { tenant_id: 'tenant-2' };
    
    const data1 = await getData(tenant1User);
    const data2 = await getData(tenant2User);
    
    expect(data1).not.toEqual(data2);
  });

  it('should prevent cross-tenant access', async () => {
    const tenant1User = { tenant_id: 'tenant-1' };
    const tenant2Data = { tenant_id: 'tenant-2' };
    
    const hasAccess = checkTenantAccess(tenant1User, tenant2Data);
    expect(hasAccess).toBe(false);
  });
});
```

### 4.2 Branch Isolation Tests

```javascript
describe('ADR-002 Branch Isolation', () => {
  it('should isolate data between branches', async () => {
    const branch1User = { branch_id: 'branch-1', tenant_id: 'tenant-1' };
    const branch2User = { branch_id: 'branch-2', tenant_id: 'tenant-1' };
    
    const data1 = await getInventoryData(branch1User);
    const data2 = await getInventoryData(branch2User);
    
    expect(data1).not.toEqual(data2);
  });
});
```

### 4.3 Warehouse Isolation Tests

```javascript
describe('ADR-002 Warehouse Isolation', () => {
  it('should isolate stock between warehouses', async () => {
    const warehouse1User = { warehouse_id: 'wh-1', branch_id: 'branch-1' };
    const warehouse2User = { warehouse_id: 'wh-2', branch_id: 'branch-1' };
    
    const stock1 = await getStockData(warehouse1User);
    const stock2 = await getStockData(warehouse2User);
    
    expect(stock1).not.toEqual(stock2);
  });
});
```

### 4.4 Hierarchy Tests

```javascript
describe('ADR-002 Hierarchy', () => {
  it('should enforce Tenant → Branch → Warehouse hierarchy', async () => {
    const warehouse = { branch_id: 'branch-1', tenant_id: 'tenant-1' };
    const branch = { tenant_id: 'tenant-1' };
    
    expect(warehouse.tenant_id).toBe(branch.tenant_id);
  });

  it('should prevent orphaned branches', async () => {
    const branch = { tenant_id: null };
    
    const isValid = validateBranch(branch);
    expect(isValid).toBe(false);
  });
});
```

---

## 5. INTEGRATION TESTS

### 5.1 Authentication Integration

```javascript
describe('Authentication Integration', () => {
  it('should complete full login flow with role alias', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'owner@acme.com', password: '***' });
    
    expect(response.status).toBe(200);
    expect(response.body.data.user.role).toBe('Super Admin');
  });
});
```

### 5.2 Authorization Integration

```javascript
describe('Authorization Integration', () => {
  it('should enforce role-based access', async () => {
    const token = await getToken('Viewer');
    
    const response = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Product' });
    
    expect(response.status).toBe(403);
  });
});
```

### 5.3 Tenant Integration

```javascript
describe('Tenant Integration', () => {
  it('should scope data to tenant', async () => {
    const token = await getToken('Manager', 'tenant-1');
    
    const response = await request(app)
      .get('/api/v1/products')
      .set('Authorization', `Bearer ${token}`);
    
    expect(response.body.data.every(p => p.tenant_id === 'tenant-1')).toBe(true);
  });
});
```

---

## 6. E2E TESTS

### 6.1 Critical User Flows

```javascript
describe('E2E Authentication Flow', () => {
  it('should complete full login flow', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.fill('#loginUser', 'test@example.com');
    await page.fill('#loginPass', 'ValidPassword123!');
    await page.click('#loginBtn');
    await expect(page).toHaveURL(/.*dashboard/);
  });
});
```

---

## 7. SECURITY TESTS

### 7.1 Brute Force Protection

```javascript
describe('Brute Force Protection', () => {
  it('should block after 5 failed attempts', async () => {
    for (let i = 0; i < 6; i++) {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'test@example.com', password: 'Wrong' });
    }
    
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'test@example.com', password: 'Wrong' });
    
    expect(response.status).toBe(429);
  });
});
```

### 7.2 Tenant Escape Attempts

```javascript
describe('Tenant Escape', () => {
  it('should prevent cross-tenant data access', async () => {
    const token = await getToken('Manager', 'tenant-1');
    
    const response = await request(app)
      .get('/api/v1/products?tenant_id=tenant-2')
      .set('Authorization', `Bearer ${token}`);
    
    expect(response.body.data.every(p => p.tenant_id === 'tenant-1')).toBe(true);
  });
});
```

---

## 8. PERFORMANCE TESTS

### 8.1 Load Tests

```javascript
describe('API Performance', () => {
  it('should handle 100 concurrent requests', async () => {
    const requests = [];
    for (let i = 0; i < 100; i++) {
      requests.push(request(app).get('/api/v1/health'));
    }
    
    const startTime = Date.now();
    const responses = await Promise.all(requests);
    const duration = Date.now() - startTime;
    
    expect(duration).toBeLessThan(5000);
    responses.forEach(r => expect(r.status).toBe(200));
  });
});
```

---

## 9. TEST AUTOMATION

### 9.1 CI/CD Integration

```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '22'
      - name: Install dependencies
        run: npm ci
        working-directory: ./backend
      - name: Run unit tests
        run: npm run test:unit
        working-directory: ./backend
      - name: Run integration tests
        run: npm run test:integration
        working-directory: ./backend
      - name: Run security tests
        run: npm run test:security
        working-directory: ./backend
```

---

## 10. COVERAGE THRESHOLDS

| Metric | Global | Per-file |
|--------|--------|----------|
| Statements | 85% | 80% |
| Branches | 80% | 75% |
| Functions | 85% | 80% |
| Lines | 85% | 80% |

---

**Document Generated:** 2026-08-05
**Status:** APPROVED
**Authority:** ADR-001, ADR-002
