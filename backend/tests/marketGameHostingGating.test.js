'use strict';

const fs = require('fs');
const path = require('path');

const APP_JS = path.join(__dirname, '..', '..', 'market', 'js', 'app.js');

describe('market app.js game-hosting gating', () => {
  let source;

  beforeAll(() => {
    source = fs.readFileSync(APP_JS, 'utf-8');
  });

  test('fetches platform sections on init', () => {
    expect(source).toMatch(/ensureSections/);
    expect(source).toMatch(/loadJSON\(['"]\/sections['"]\)/);
  });

  test('caches sections result', () => {
    expect(source).toMatch(/_sections\s*=\s*null/);
    expect(source).toMatch(/_sectionsPromise/);
  });

  test('checks game-hosting status before rendering game-hosting routes', () => {
    expect(source).toMatch(/isGameHostingActive/);
    expect(source).toMatch(/game-hosting/);
  });

  test('shows under-construction page when game-hosting is not active', () => {
    expect(source).toMatch(/under_construction_title/);
    expect(source).toMatch(/under_construction_message/);
  });

  test('does not reference game-hosting in active nav selector map', () => {
    const match = source.match(/updateActiveNav\s*\([^)]*\)\s*\{[\s\S]*?selectorMap\s*=\s*\{([\s\S]*?)\}/);
    if (match) {
      expect(match[1]).not.toMatch(/game-hosting/);
    }
  });
});
