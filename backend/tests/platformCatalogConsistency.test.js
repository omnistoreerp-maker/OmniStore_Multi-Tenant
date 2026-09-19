'use strict';

const fs = require('fs');
const path = require('path');

const PLATFORM_JS = path.join(__dirname, '..', '..', 'platform', 'platform.js');

function loadService(dataDir) {
  jest.resetModules();
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  return require('../services/platformCatalog.service');
}

describe('platformCatalog consistency', () => {
  test('default catalog never contains duplicate section ids', () => {
    const service = loadService(path.join(process.env.TEMP || '', 'omnistore-platform-consistency-default'));
    const doc = service.getDefaultDoc();
    const ids = doc.sections.map(s => s.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  test('stored duplicate section ids are normalized to a deterministic single entry', () => {
    const dataDir = path.join(process.env.TEMP || '', 'omnistore-platform-consistency-store');
    fs.mkdirSync(dataDir, { recursive: true });
    const payload = {
      sections: [
        { id: 'marketplace', title: 'Marketplace A', status: 'active', url: '/market.html', icon: 'fa-store' },
        { id: 'marketplace', title: 'Marketplace B', status: 'under-construction', url: null, icon: 'fa-store' },
        { id: 'business-services', title: 'Business', status: 'active', url: '/business.html', icon: 'fa-building' },
        { id: 'business-services', title: 'Business 2', status: 'coming-soon', url: null, icon: 'fa-building' }
      ]
    };
    fs.writeFileSync(path.join(dataDir, 'platformPublic.json'), JSON.stringify(payload), 'utf-8');
    const service = loadService(dataDir);
    const catalog = service.getCatalog();
    const ids = catalog.sections.map(s => s.id);
    expect(ids.length).toBe(new Set(ids).size);
    const byId = Object.fromEntries(catalog.sections.map(s => [s.id, s]));
    expect(byId['marketplace'].title).toBe('Marketplace A');
    expect(byId['marketplace'].status).toBe('active');
    expect(byId['marketplace'].url).toBe('/market.html');
    expect(byId['business-services'].title).toBe('Business');
    expect(byId['business-services'].status).toBe('active');
    expect(byId['business-services'].url).toBe('/business.html');
  });

  test('active section with missing or unknown url becomes under-construction', () => {
    const dataDir = path.join(process.env.TEMP || '', 'omnistore-platform-consistency-active');
    fs.mkdirSync(dataDir, { recursive: true });
    const payload = {
      sections: [
        { id: 'marketplace', title: 'Marketplace', status: 'active', url: '/unknown.html', icon: 'fa-store' },
        { id: 'student-services', title: 'Students', status: 'active', url: null, icon: 'fa-graduation-cap' }
      ]
    };
    fs.writeFileSync(path.join(dataDir, 'platformPublic.json'), JSON.stringify(payload), 'utf-8');
    const service = loadService(dataDir);
    const catalog = service.getCatalog();
    const byId = Object.fromEntries(catalog.sections.map(s => [s.id, s]));
    expect(byId['marketplace'].status).toBe('under-construction');
    expect(byId['marketplace'].url).toBeNull();
    expect(byId['student-services'].status).toBe('under-construction');
    expect(byId['student-services'].url).toBeNull();
  });

  test('non-active sections never expose a url', () => {
    const dataDir = path.join(process.env.TEMP || '', 'omnistore-platform-consistency-nonactive');
    fs.mkdirSync(dataDir, { recursive: true });
    const payload = {
      sections: [
        { id: 'game-hosting', title: 'Games', status: 'under-construction', url: '/games.html', icon: 'fa-gamepad' },
        { id: 'media-reels', title: 'Reels', status: 'coming-soon', url: '/reels.html', icon: 'fa-film' },
        { id: 'support', title: 'Support', status: 'coming-soon', url: '/support.html', icon: 'fa-headset' }
      ]
    };
    fs.writeFileSync(path.join(dataDir, 'platformPublic.json'), JSON.stringify(payload), 'utf-8');
    const service = loadService(dataDir);
    const catalog = service.getCatalog();
    const byId = Object.fromEntries(catalog.sections.map(s => [s.id, s]));
    expect(byId['game-hosting'].status).toBe('under-construction');
    expect(byId['game-hosting'].url).toBeNull();
    expect(byId['media-reels'].status).toBe('coming-soon');
    expect(byId['media-reels'].url).toBeNull();
    expect(byId.support.status).toBe('coming-soon');
    expect(byId.support.url).toBeNull();
  });

  test('invalid section status is normalized to coming-soon', () => {
    const dataDir = path.join(process.env.TEMP || '', 'omnistore-platform-consistency-invalid');
    fs.mkdirSync(dataDir, { recursive: true });
    const payload = {
      sections: [
        { id: 'marketplace', title: 'Marketplace', status: 'invalid', url: '/market.html', icon: 'fa-store' }
      ]
    };
    fs.writeFileSync(path.join(dataDir, 'platformPublic.json'), JSON.stringify(payload), 'utf-8');
    const service = loadService(dataDir);
    const catalog = service.getCatalog();
    expect(catalog.sections[0].status).toBe('coming-soon');
    expect(catalog.sections[0].url).toBeNull();
  });
});

describe('platform.js section gating', () => {
  let source;

  beforeAll(() => {
    source = fs.readFileSync(PLATFORM_JS, 'utf-8');
  });

  test('renders active links only when section is active and has url', () => {
    expect(source).toMatch(/if\s*\(\s*s\.url\s*&&\s*s\.status\s*===\s*'active'\s*\)/);
  });

  test('renders disabled status for non-active sections', () => {
    expect(source).toMatch(/section-link-disabled/);
    expect(source).toMatch(/statusLabel\s*\(\s*s\.status\s*\)/);
  });

  test('does not hardcode section state', () => {
    expect(source).not.toMatch(/game-hosting.*active/);
    expect(source).not.toMatch(/support.*active/);
  });
});
