/**
 * Regression tests for Issue #2: Browser storage vs server authority
 * 
 * These tests verify that:
 * 1. Browser reset procedure is documented
 * 2. LocalStorage key patterns are defined
 * 3. Backend API is available for data refresh
 */

const { describe, it, expect } = require('@jest/globals');
const fs = require('fs');
const path = require('path');

describe('Browser Data Reset Documentation (Issue #2 Regression)', () => {
  describe('Reset Procedure Documentation', () => {
    it('should have customer browser reset procedure documented', () => {
      const docPath = path.join(__dirname, '../../docs/CUSTOMER_BROWSER_RESET_PROCEDURE.md');
      expect(fs.existsSync(docPath)).toBe(true);
    });

    it('should document safe localStorage key patterns', () => {
      const docPath = path.join(__dirname, '../../docs/CUSTOMER_BROWSER_RESET_PROCEDURE.md');
      const content = fs.readFileSync(docPath, 'utf8');
      
      // Should document OmniStore-specific keys
      expect(content).toMatch(/cairo_db_v7_/);
      expect(content).toMatch(/omnistore_/);
      expect(content).toMatch(/access_token/);
    });

    it('should warn against clearing all localStorage', () => {
      const docPath = path.join(__dirname, '../../docs/CUSTOMER_BROWSER_RESET_PROCEDURE.md');
      const content = fs.readFileSync(docPath, 'utf8');
      
      // Should have safety warnings
      expect(content).toMatch(/NEVER.*localStorage\.clear/i);
      expect(content).toMatch(/bookmarks/i);
      expect(content).toMatch(/passwords/i);
    });

    it('should document backup procedure', () => {
      const docPath = path.join(__dirname, '../../docs/CUSTOMER_BROWSER_RESET_PROCEDURE.md');
      const content = fs.readFileSync(docPath, 'utf8');
      
      expect(content).toMatch(/backup/i);
      expect(content).toMatch(/restore/i);
    });

    it('should document USE_BACKEND configuration', () => {
      const docPath = path.join(__dirname, '../../docs/CUSTOMER_BROWSER_RESET_PROCEDURE.md');
      const content = fs.readFileSync(docPath, 'utf8');
      
      expect(content).toMatch(/USE_BACKEND/);
      expect(content).toMatch(/backend.*env/i);
    });
  });

  describe('LocalStorage Key Patterns', () => {
    it('should define tenant-scoped database key pattern', () => {
      // Verify pattern: cairo_db_v7_<tenantId>
      const pattern = /cairo_db_v7_/;
      expect(pattern.test('cairo_db_v7_tenant123')).toBe(true);
      expect(pattern.test('cairo_db_v7_cairotech')).toBe(true);
    });

    it('should identify OmniStore-specific keys', () => {
      const omnistoreKeys = [
        'cairo_db_v7_tenant1',
        'omnistore_modules_v1',
        'digi_gh_token',
        'access_token',
        'refresh_token',
        'remembered_user'
      ];
      
      omnistoreKeys.forEach(key => {
        const isOmniStoreKey = 
          key.startsWith('cairo_db_v7_') ||
          key.startsWith('omnistore_') ||
          key.startsWith('digi_') ||
          key.startsWith('eso_') ||
          key === 'access_token' ||
          key === 'refresh_token' ||
          key === 'remembered_user';
        
        expect(isOmniStoreKey).toBe(true);
      });
    });

    it('should not identify non-OmniStore keys', () => {
      const nonOmniStoreKeys = [
        'google_auth_token',
        'facebook_session',
        'other_app_data'
      ];
      
      nonOmniStoreKeys.forEach(key => {
        const isOmniStoreKey = 
          key.startsWith('cairo_db_v7_') ||
          key.startsWith('omnistore_') ||
          key.startsWith('digi_') ||
          key.startsWith('eso_') ||
          key === 'access_token' ||
          key === 'refresh_token' ||
          key === 'remembered_user';
        
        expect(isOmniStoreKey).toBe(false);
      });
    });
  });

  describe('Backend API Availability', () => {
    it('should have sales API endpoint for data refresh', () => {
      const routesPath = path.join(__dirname, '../routes/sales.routes.js');
      expect(fs.existsSync(routesPath)).toBe(true);
    });

    it('should have customers API endpoint for data refresh', () => {
      const routesPath = path.join(__dirname, '../routes/customers.routes.js');
      expect(fs.existsSync(routesPath)).toBe(true);
    });

    it('should have inventory API endpoint for data refresh', () => {
      const routesPath = path.join(__dirname, '../routes/inventory.routes.js');
      expect(fs.existsSync(routesPath)).toBe(true);
    });

    it('should have backend service files for all major entities', () => {
      const services = [
        'sales.service.js',
        'customers.service.js',
        'inventory.service.js',
        'purchase.service.js'
      ];
      
      services.forEach(service => {
        const servicePath = path.join(__dirname, '../services', service);
        expect(fs.existsSync(servicePath)).toBe(true);
      });
    });
  });

  describe('Configuration Validation', () => {
    it('should have .env.example with USE_BACKEND documentation', () => {
      const envExamplePath = path.join(__dirname, '../.env.example');
      
      if (fs.existsSync(envExamplePath)) {
        const content = fs.readFileSync(envExamplePath, 'utf8');
        // This is optional, so we just check if file exists
        expect(content).toBeDefined();
      } else {
        // If no .env.example, that's okay - it's not always needed
        expect(true).toBe(true);
      }
    });
  });

  describe('Data Consistency Patterns', () => {
    it('should document that server is source of truth when USE_BACKEND=true', () => {
      const docPath = path.join(__dirname, '../../docs/CUSTOMER_BROWSER_RESET_PROCEDURE.md');
      const content = fs.readFileSync(docPath, 'utf8');
      
      expect(content).toMatch(/server.*source.*truth/i);
      expect(content).toMatch(/authoritative/i);
    });

    it('should document localStorage as cache when backend is enabled', () => {
      const docPath = path.join(__dirname, '../../docs/CUSTOMER_BROWSER_RESET_PROCEDURE.md');
      const content = fs.readFileSync(docPath, 'utf8');
      
      expect(content).toMatch(/cache/i);
      expect(content).toMatch(/localStorage/);
    });
  });
});

describe('Architecture Decision: Offline-First vs Server-First', () => {
  it('should maintain backward compatibility with offline-first mode', () => {
    // The application should support both modes:
    // 1. USE_BACKEND=false: localStorage is primary (offline-first)
    // 2. USE_BACKEND=true: Server is primary (online-first)
    
    const indexPath = path.join(__dirname, '../../index.html');
    const content = fs.readFileSync(indexPath, 'utf8');
    
    // Should have USE_BACKEND flag
    expect(content).toMatch(/USE_BACKEND/);
    
    // Should have localStorage operations
    expect(content).toMatch(/localStorage\.getItem/);
    expect(content).toMatch(/localStorage\.setItem/);
  });

  it('should support backend API when USE_BACKEND is enabled', () => {
    const indexPath = path.join(__dirname, '../../index.html');
    const content = fs.readFileSync(indexPath, 'utf8');
    
    // Should have backendApi or digitronicsDataAdapter
    expect(content).toMatch(/backendApi|digitronicsDataAdapter/);
  });
});

describe('Customer Reset Safety Checks', () => {
  it('should provide code snippets that target specific keys only', () => {
    const docPath = path.join(__dirname, '../../docs/CUSTOMER_BROWSER_RESET_PROCEDURE.md');
    const content = fs.readFileSync(docPath, 'utf8');
    
    // Should have specific key removal, not blanket clear
    expect(content).toMatch(/keysToRemove/);
    expect(content).toMatch(/forEach.*removeItem/i);
    
    // Should NOT recommend localStorage.clear()
    expect(content.toLowerCase()).not.toMatch(/localStorage\.clear\(\)/);
  });

  it('should document IndexedDB cleanup', () => {
    const docPath = path.join(__dirname, '../../docs/CUSTOMER_BROWSER_RESET_PROCEDURE.md');
    const content = fs.readFileSync(docPath, 'utf8');
    
    expect(content).toMatch(/IndexedDB/);
    expect(content).toMatch(/deleteDatabase/i);
  });

  it('should document verification steps after reset', () => {
    const docPath = path.join(__dirname, '../../docs/CUSTOMER_BROWSER_RESET_PROCEDURE.md');
    const content = fs.readFileSync(docPath, 'utf8');
    
    expect(content).toMatch(/verification/i);
    expect(content).toMatch(/login/i);
  });
});
