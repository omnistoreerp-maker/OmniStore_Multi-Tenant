'use strict';

const platformCatalog = require('../services/platformCatalog.service');

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
