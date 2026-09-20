'use strict';

const fs = require('fs');
const { makeTempDataDir, seed } = require('./helpers/testData');

const platformCatalog = require('../services/platformCatalog.service');

function loadService(dataDir) {
  jest.resetModules();
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  return require('../services/platformCatalog.service');
}

describe('platformCatalog.service default sections', () => {
  test('default catalog has unique section ids', () => {
    const doc = platformCatalog.getDefaultDoc();
    const ids = doc.sections.map((s) => s.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  test('student-services is a single active section pointing at student.html', () => {
    const doc = platformCatalog.getDefaultDoc();
    const students = doc.sections.filter((s) => s.id === 'student-services');
    expect(students).toHaveLength(1);
    expect(students[0].status).toBe('active');
    expect(students[0].url).toBe('/student.html');
  });

  test('planned but incomplete sections stay non-active', () => {
    const doc = platformCatalog.getDefaultDoc();
    const byId = Object.fromEntries(doc.sections.map((s) => [s.id, s]));
    expect(byId['game-hosting'].status).toBe('under-construction');
    expect(byId['game-hosting'].url).toBeNull();
    expect(byId['media-reels'].status).toBe('coming-soon');
    expect(byId['media-reels'].url).toBeNull();
    expect(byId.support.status).toBe('coming-soon');
    expect(byId.support.url).toBeNull();
  });

  test('getCatalog fills missing sections from defaults', () => {
    const catalog = platformCatalog.getCatalog();
    expect(Array.isArray(catalog.sections)).toBe(true);
    expect(catalog.sections.length).toBeGreaterThanOrEqual(5);
    const ids = catalog.sections.map((s) => s.id);
    expect(ids.length).toBe(new Set(ids).size);
    expect(ids).toContain('marketplace');
    expect(ids).toContain('business-services');
    expect(ids).toContain('student-services');
    expect(ids).toContain('game-hosting');
    expect(ids).toContain('media-reels');
  });
});

describe('platformCatalog.service section merge and URL sanitization', () => {
  let dataDir;
  const ORIGINAL_DIR = process.env.DIGITRONICS_DATA_DIR;

  afterEach(() => {
    if (ORIGINAL_DIR === undefined) delete process.env.DIGITRONICS_DATA_DIR;
    else process.env.DIGITRONICS_DATA_DIR = ORIGINAL_DIR;
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('incomplete stored catalog is filled from defaults without duplicate ids', () => {
    dataDir = makeTempDataDir('platform-catalog-merge');
    seed(dataDir, 'platformPublic', {
      meta: { name: 'Partial Catalog', tagline: 'Test', version: '0.0.1' },
      sections: [
        { id: 'marketplace', title: 'Marketplace', description: 'Shop', status: 'active', url: '/market.html', icon: 'fa-store' }
      ]
    });
    const service = loadService(dataDir);
    const catalog = service.getCatalog();
    const ids = catalog.sections.map((s) => s.id);
    expect(ids.length).toBe(new Set(ids).size);
    expect(ids).toEqual(expect.arrayContaining([
      'marketplace',
      'business-services',
      'student-services',
      'game-hosting',
      'media-reels',
      'support'
    ]));
    const byId = Object.fromEntries(catalog.sections.map((s) => [s.id, s]));
    expect(byId.marketplace.status).toBe('active');
    expect(byId.marketplace.url).toBe('/market.html');
    expect(byId['student-services'].status).toBe('active');
    expect(byId['student-services'].url).toBe('/student.html');
    expect(byId.support.status).toBe('coming-soon');
    expect(byId.support.url).toBeNull();
  });

  test('active sections with missing or unknown urls become under-construction', () => {
    dataDir = makeTempDataDir('platform-catalog-sanitize');
    seed(dataDir, 'platformPublic', {
      sections: [
        { id: 'marketplace', title: 'Marketplace', status: 'active', url: '/missing-market.html', icon: 'fa-store' },
        { id: 'business-services', title: 'Business', status: 'active', url: null, icon: 'fa-building' },
        { id: 'student-services', title: 'Students', status: 'active', url: '/student.html', icon: 'fa-graduation-cap' },
        { id: 'game-hosting', title: 'Games', status: 'active', url: '/games-fake.html', icon: 'fa-gamepad' }
      ]
    });
    const service = loadService(dataDir);
    const byId = Object.fromEntries(service.getCatalog().sections.map((s) => [s.id, s]));
    expect(byId.marketplace.status).toBe('under-construction');
    expect(byId.marketplace.url).toBeNull();
    expect(byId['business-services'].status).toBe('under-construction');
    expect(byId['business-services'].url).toBeNull();
    expect(byId['student-services'].status).toBe('active');
    expect(byId['student-services'].url).toBe('/student.html');
    expect(byId['game-hosting'].status).toBe('under-construction');
    expect(byId['game-hosting'].url).toBeNull();
  });

  test('non-active sections never expose a url', () => {
    dataDir = makeTempDataDir('platform-catalog-nourl');
    seed(dataDir, 'platformPublic', {
      sections: [
        { id: 'media-reels', title: 'Reels', status: 'coming-soon', url: '/reels.html', icon: 'fa-film' },
        { id: 'support', title: 'Support', status: 'under-construction', url: '/support.html', icon: 'fa-headset' }
      ]
    });
    const service = loadService(dataDir);
    const byId = Object.fromEntries(service.getCatalog().sections.map((s) => [s.id, s]));
    expect(byId['media-reels'].status).toBe('coming-soon');
    expect(byId['media-reels'].url).toBeNull();
    expect(byId.support.status).toBe('under-construction');
    expect(byId.support.url).toBeNull();
  });
});
