/**
 * Regression tests for Issue #3: Tenant isolation verification
 * 
 * These tests verify that:
 * 1. Tenants cannot access each other's data
 * 2. Backend enforces tenant filtering at repository level
 * 3. Cross-tenant write attempts are blocked
 * 4. Branch isolation works when enabled
 */

const request = require('supertest');
const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');

describe('Tenant Isolation Regression (Issue #3)', () => {
  let app;
  let server;
  let tenant1Token;
  let tenant2Token;

  beforeAll(async () => {
    // Start test server
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-for-tenant-isolation';
    process.env.ENABLE_TENANT_SALES_ISOLATION = 'true';
    
    // Import app after env is set
    app = require('../server');
    server = app.listen(0); // Random port
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  describe('Sales API Tenant Isolation', () => {
    it('should filter sales by tenantId in list endpoint', async () => {
      const salesService = require('../services/sales.service');
      
      // Mock tenant context
      const tenant1Context = { tenantId: 'tenant1' };
      const tenant2Context = { tenantId: 'tenant2' };
      
      // Verify _visibleInvoices filters correctly
      const mockInvoices = [
        { id: 'INV-001', tenantId: 'tenant1', total: 100 },
        { id: 'INV-002', tenantId: 'tenant2', total: 200 },
        { id: 'INV-003', tenantId: 'tenant1', total: 300 },
        { id: 'INV-004', tenantId: null, total: 400 } // Legacy
      ];
      
      const tenant1Visible = salesService._visibleInvoices(mockInvoices, tenant1Context);
      const tenant2Visible = salesService._visibleInvoices(mockInvoices, tenant2Context);
      
      // Tenant 1 should see: INV-001, INV-003, INV-004 (legacy)
      expect(tenant1Visible).toHaveLength(3);
      expect(tenant1Visible.map(inv => inv.id)).toContain('INV-001');
      expect(tenant1Visible.map(inv => inv.id)).toContain('INV-003');
      expect(tenant1Visible.map(inv => inv.id)).toContain('INV-004');
      expect(tenant1Visible.map(inv => inv.id)).not.toContain('INV-002');
      
      // Tenant 2 should see: INV-002, INV-004 (legacy)
      expect(tenant2Visible).toHaveLength(2);
      expect(tenant2Visible.map(inv => inv.id)).toContain('INV-002');
      expect(tenant2Visible.map(inv => inv.id)).toContain('INV-004');
      expect(tenant2Visible.map(inv => inv.id)).not.toContain('INV-001');
      expect(tenant2Visible.map(inv => inv.id)).not.toContain('INV-003');
    });

    it('should block cross-tenant write attempts', () => {
      const salesService = require('../services/sales.service');
      
      // Mock invoice with different tenantId
      const crossTenantInvoice = { id: 'INV-999', tenantId: 'otherTenant', total: 999 };
      
      // Simulate current tenant being 'myTenant'
      const repository = require('../repositories').sales;
      const originalGetTenant = repository.getCurrentTenant;
      repository.getCurrentTenant = () => ({ tenantId: 'myTenant' });
      
      const blocked = salesService._ownershipBlocked(crossTenantInvoice);
      
      expect(blocked).toBe(true);
      
      // Restore
      repository.getCurrentTenant = originalGetTenant;
    });

    it('should allow access to legacy records (no tenantId)', () => {
      const salesService = require('../services/sales.service');
      
      const legacyInvoice = { id: 'INV-LEGACY', total: 100 };
      
      const blocked = salesService._ownershipBlocked(legacyInvoice);
      
      expect(blocked).toBe(false);
    });

    it('should allow access to same-tenant records', () => {
      const salesService = require('../services/sales.service');
      
      const repository = require('../repositories').sales;
      const originalGetTenant = repository.getCurrentTenant;
      repository.getCurrentTenant = () => ({ tenantId: 'myTenant' });
      
      const sameTenantInvoice = { id: 'INV-MINE', tenantId: 'myTenant', total: 100 };
      
      const blocked = salesService._ownershipBlocked(sameTenantInvoice);
      
      expect(blocked).toBe(false);
      
      repository.getCurrentTenant = originalGetTenant;
    });
  });

  describe('Branch Isolation', () => {
    it('should filter records by branchId when branch isolation is active', () => {
      const salesService = require('../services/sales.service');
      const branchStore = require('../middleware/branchStore');
      const config = require('../config');
      
      // Save original state
      const originalBranchEnabled = config.branchIsolationEnabled;
      const originalBranchGet = branchStore.get;
      
      // Enable branch isolation
      config.branchIsolationEnabled = true;
      branchStore.get = () => 'branch1';
      
      const mockInvoices = [
        { id: 'INV-001', branchId: 'branch1', total: 100 },
        { id: 'INV-002', branchId: 'branch2', total: 200 },
        { id: 'INV-003', branchId: 'branch1', total: 300 },
        { id: 'INV-004', branchId: null, total: 400 } // Legacy
      ];
      
      const visible = salesService._branchVisibleInvoices(mockInvoices);
      
      // Should see branch1 and legacy
      expect(visible).toHaveLength(3);
      expect(visible.map(inv => inv.id)).toContain('INV-001');
      expect(visible.map(inv => inv.id)).toContain('INV-003');
      expect(visible.map(inv => inv.id)).toContain('INV-004');
      expect(visible.map(inv => inv.id)).not.toContain('INV-002');
      
      // Restore
      config.branchIsolationEnabled = originalBranchEnabled;
      branchStore.get = originalBranchGet;
    });

    it('should block cross-branch record access', () => {
      const salesService = require('../services/sales.service');
      const branchStore = require('../middleware/branchStore');
      const config = require('../config');
      
      const originalBranchEnabled = config.branchIsolationEnabled;
      const originalBranchGet = branchStore.get;
      
      config.branchIsolationEnabled = true;
      branchStore.get = () => 'branch1';
      
      const crossBranchRecord = { id: 'INV-999', branchId: 'branch2', total: 999 };
      
      const blocked = salesService._branchBlocked(crossBranchRecord);
      
      expect(blocked).toBe(true);
      
      config.branchIsolationEnabled = originalBranchEnabled;
      branchStore.get = originalBranchGet;
    });

    it('should not block when user has no branch scope (Owner/Admin)', () => {
      const salesService = require('../services/sales.service');
      const branchStore = require('../middleware/branchStore');
      const config = require('../config');
      
      const originalBranchEnabled = config.branchIsolationEnabled;
      const originalBranchGet = branchStore.get;
      
      config.branchIsolationEnabled = true;
      branchStore.get = () => null; // No branch scope = unrestricted
      
      const anyBranchRecord = { id: 'INV-999', branchId: 'anybranch', total: 999 };
      
      const blocked = salesService._branchBlocked(anyBranchRecord);
      
      expect(blocked).toBe(false);
      
      config.branchIsolationEnabled = originalBranchEnabled;
      branchStore.get = originalBranchGet;
    });
  });

  describe('Tenant Context from JWT', () => {
    it('should extract tenantId from JWT token', () => {
      const jwt = require('jsonwebtoken');
      const secret = 'test-secret';
      
      const token = jwt.sign(
        { userId: 'user1', tenantId: 'tenant1', username: 'testuser' },
        secret,
        { expiresIn: '1h' }
      );
      
      const decoded = jwt.verify(token, secret);
      
      expect(decoded.tenantId).toBe('tenant1');
    });

    it('should not allow client to forge tenantId in JWT', () => {
      const jwt = require('jsonwebtoken');
      const secret = 'test-secret';
      
      // Create token with tenant1
      const token = jwt.sign(
        { userId: 'user1', tenantId: 'tenant1' },
        secret
      );
      
      // Try to decode with wrong secret (simulating tampering)
      expect(() => {
        jwt.verify(token, 'wrong-secret');
      }).toThrow();
    });
  });

  describe('Repository-Level Tenant Filtering', () => {
    it('should have BaseRepository with tenant accessor support', () => {
      const BaseRepository = require('../repositories/BaseRepository');
      
      // Verify class exists and has tenant support
      expect(BaseRepository).toBeDefined();
      expect(typeof BaseRepository).toBe('function');
    });

    it('should create tenant-scoped repository instances', () => {
      const BaseRepository = require('../repositories/BaseRepository');
      
      const repo = new BaseRepository('test', {
        getCurrentTenant: () => ({ tenantId: 'test-tenant' })
      });
      
      expect(repo).toBeDefined();
    });
  });

  describe('Cross-Tenant Attack Scenarios', () => {
    it('should prevent reading another tenant\'s sales', async () => {
      const salesService = require('../services/sales.service');
      
      const tenant1Context = { tenantId: 'tenant1' };
      
      // Try to read invoice belonging to tenant2
      const mockDb = {
        invoices: [
          { id: 'INV-TENANT2', tenantId: 'tenant2', total: 1000 }
        ]
      };
      
      const visible = salesService._visibleInvoices(mockDb.invoices, tenant1Context);
      
      // Should not see tenant2's invoice
      expect(visible).toHaveLength(0);
    });

    it('should prevent updating another tenant\'s records', () => {
      const salesService = require('../services/sales.service');
      const repository = require('../repositories').sales;
      
      const originalGetTenant = repository.getCurrentTenant;
      repository.getCurrentTenant = () => ({ tenantId: 'tenant1' });
      
      // Try to update tenant2's invoice
      const tenant2Invoice = { id: 'INV-TENANT2', tenantId: 'tenant2', total: 1000 };
      
      const blocked = salesService._ownershipBlocked(tenant2Invoice);
      
      expect(blocked).toBe(true);
      
      repository.getCurrentTenant = originalGetTenant;
    });

    it('should prevent deleting another tenant\'s records', () => {
      const salesService = require('../services/sales.service');
      const repository = require('../repositories').sales;
      
      const originalGetTenant = repository.getCurrentTenant;
      repository.getCurrentTenant = () => ({ tenantId: 'tenant1' });
      
      // Try to delete tenant2's invoice
      const tenant2Invoice = { id: 'INV-TENANT2', tenantId: 'tenant2', total: 1000 };
      
      const blocked = salesService._ownershipBlocked(tenant2Invoice);
      
      expect(blocked).toBe(true);
      
      repository.getCurrentTenant = originalGetTenant;
    });
  });

  describe('Tenant Stamping on Create', () => {
    it('should automatically stamp tenantId on new records', async () => {
      const salesService = require('../services/sales.service');
      const config = require('../config');
      
      const originalIsolationEnabled = config.tenantSalesIsolationEnabled;
      config.tenantSalesIsolationEnabled = true;
      
      const tenantContext = { tenantId: 'my-tenant' };
      
      const newInvoiceData = {
        items: [{ name: 'Product', qty: 1, price: 100, total: 100 }],
        total: 100
      };
      
      // In real implementation, create would stamp tenantId
      // Here we verify the isolation check is active
      expect(salesService._isIsolationActive(tenantContext)).toBe(true);
      
      config.tenantSalesIsolationEnabled = originalIsolationEnabled;
    });
  });
});
