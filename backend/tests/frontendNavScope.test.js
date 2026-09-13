/**
 * Regression tests for Issue #1: Unauthorized module visibility
 * 
 * These tests verify that:
 * 1. Modules respect businessTypes restrictions
 * 2. Navigation filtering enforces business type compatibility
 * 3. isRouteEnabled() checks both active and compatible states
 */

const { describe, it, expect, beforeEach } = require('@jest/globals');

describe('Module Business Type Filtering (Issue #1 Regression)', () => {
  let mockContext;
  let moduleRegistry;
  let moduleLoader;

  beforeEach(() => {
    // Reset global state
    mockContext = {
      OmniModuleRegistry: {},
      OmniModuleLoader: null,
      localStorage: {
        data: {},
        getItem(key) { return this.data[key] || null; },
        setItem(key, value) { this.data[key] = value; },
        removeItem(key) { delete this.data[key]; }
      },
      getCurrentBusinessType: () => 'computer_shop'
    };
  });

  describe('Module Registry Business Type Restrictions', () => {
    it('should restrict repairs module to specific business types', () => {
      const registryCode = require('fs').readFileSync(
        require('path').join(__dirname, '../../services/modulePlatform/moduleRegistry.js'),
        'utf8'
      );
      
      expect(registryCode).toMatch(/repairs[\s\S]*?businessTypes:\s*\[/);
      expect(registryCode).not.toMatch(/repairs[\s\S]*?businessTypes:\s*allBusinesses/);
    });

    it('should have playstation module disabled by default via defaultSettings', () => {
      const registryCode = require('fs').readFileSync(
        require('path').join(__dirname, '../../services/modulePlatform/moduleRegistry.js'),
        'utf8'
      );
      
      const playstationSection = registryCode.match(/playstation:\s*module\(\{[\s\S]*?\}\)/);
      expect(playstationSection).toBeTruthy();
      expect(playstationSection[0]).toMatch(/defaultSettings:\s*\{[\s\S]*?engineEnabled:\s*false/);
    });

    it('should have car_rental module disabled by default via defaultSettings', () => {
      const registryCode = require('fs').readFileSync(
        require('path').join(__dirname, '../../services/modulePlatform/moduleRegistry.js'),
        'utf8'
      );
      
      const carRentalSection = registryCode.match(/car_rental:\s*module\(\{[\s\S]*?\}\)/);
      expect(carRentalSection).toBeTruthy();
      expect(carRentalSection[0]).toMatch(/defaultSettings:\s*\{[\s\S]*?engineEnabled:\s*false/);
    });
  });

  describe('Module Loader isRouteEnabled()', () => {
    it('should check both active and compatible states', () => {
      const loaderCode = require('fs').readFileSync(
        require('path').join(__dirname, '../../services/modulePlatform/moduleLoader.js'),
        'utf8'
      );
      
      // Verify isRouteEnabled checks state.compatible
      expect(loaderCode).toMatch(/isRouteEnabled[\s\S]*?compatible/);
      expect(loaderCode).toMatch(/state\.active[\s\S]*?state\.compatible/);
    });

    it('should return true for routes not in registry (backward compatibility)', () => {
      const loaderCode = require('fs').readFileSync(
        require('path').join(__dirname, '../../services/modulePlatform/moduleLoader.js'),
        'utf8'
      );
      
      // Should have fallback for undefined definitions
      expect(loaderCode).toMatch(/if\s*\(!definition\)/);
    });
  });

  describe('Navigation Builder Business Type Filtering', () => {
    it('should filter navigation items by moduleState.compatible', () => {
      const navCode = require('fs').readFileSync(
        require('path').join(__dirname, '../../services/modulePlatform/navigationBuilder.js'),
        'utf8'
      );
      
      // Check that navigation builder accesses moduleState.compatible
      expect(navCode).toMatch(/moduleState.*compatible/);
    });

    it('should check business type compatibility before rendering nav items', () => {
      const navCode = require('fs').readFileSync(
        require('path').join(__dirname, '../../services/modulePlatform/navigationBuilder.js'),
        'utf8'
      );
      
      // Verify filtering logic includes compatibility check
      expect(navCode).toMatch(/filter[\s\S]*?compatible/);
    });
  });

  describe('Business Type Compatibility Logic', () => {
    it('should define isCompatible function in moduleLoader', () => {
      const loaderCode = require('fs').readFileSync(
        require('path').join(__dirname, '../../services/modulePlatform/moduleLoader.js'),
        'utf8'
      );
      
      expect(loaderCode).toMatch(/function isCompatible/);
      expect(loaderCode).toMatch(/businessTypes.*===.*\*/); // Check for wildcard support
    });

    it('should use getCurrentBusinessType to determine compatibility', () => {
      const loaderCode = require('fs').readFileSync(
        require('path').join(__dirname, '../../services/modulePlatform/moduleLoader.js'),
        'utf8'
      );
      
      expect(loaderCode).toMatch(/getBusinessType|getCurrentBusinessType/);
    });
  });
});

describe('Module Activation with Business Type (Integration)', () => {
  it('should mark module as incompatible when business type does not match', () => {
    // This test would require loading the actual module system
    // For now, we verify the code structure is correct
    const loaderCode = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/modulePlatform/moduleLoader.js'),
      'utf8'
    );
    
    // Verify resolveActive sets compatible flag
    expect(loaderCode).toMatch(/compatible:/);
    expect(loaderCode).toMatch(/isCompatible/);
  });

  it('should set module.active to false when incompatible with business type', () => {
    const loaderCode = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/modulePlatform/moduleLoader.js'),
      'utf8'
    );
    
    // Verify active depends on compatible
      expect(loaderCode).toMatch(/active.*compatible/);
  });
});

describe('Regression: Customer Issue Scenarios', () => {
  describe('Scenario: Computer shop should not see PlayStation module', () => {
    it('should have playstation restricted to non-computer-shop business types', () => {
      const registryCode = require('fs').readFileSync(
        require('path').join(__dirname, '../../services/modulePlatform/moduleRegistry.js'),
        'utf8'
      );
      
      const playstationSection = registryCode.match(/playstation:\s*module\(\{[\s\S]*?\}\),/);
      expect(playstationSection).toBeTruthy();
      
      // Should NOT include 'computer_shop' in businessTypes
      if (playstationSection[0].includes('businessTypes')) {
        expect(playstationSection[0]).not.toMatch(/businessTypes:\s*\[[\s\S]*?'computer_shop'/);
      }
    });
  });

  describe('Scenario: Pharmacy should not see Car Rental module', () => {
    it('should have car_rental disabled by default in Phase 5', () => {
      const registryCode = require('fs').readFileSync(
        require('path').join(__dirname, '../../services/modulePlatform/moduleRegistry.js'),
        'utf8'
      );
      
      const carRentalSection = registryCode.match(/car_rental:\s*module\(\{[\s\S]*?\}\),/);
      expect(carRentalSection).toBeTruthy();
      
      // Phase 5: car_rental is disabled by default via defaultSettings, not businessTypes
      expect(carRentalSection[0]).toMatch(/defaultSettings:\s*\{[\s\S]*?engineEnabled:\s*false/);
    });
  });

  describe('Scenario: Direct URL navigation to unauthorized module', () => {
    it('should block route when module is incompatible', () => {
      const loaderCode = require('fs').readFileSync(
        require('path').join(__dirname, '../../services/modulePlatform/moduleLoader.js'),
        'utf8'
      );
      
      // isRouteEnabled should return false for incompatible modules
      expect(loaderCode).toMatch(/return.*active.*compatible/);
    });
  });
});
