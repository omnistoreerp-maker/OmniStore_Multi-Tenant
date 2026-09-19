'use strict';

const fs = require('fs');
const path = require('path');

const MARKET_HTML = path.join(__dirname, '..', '..', 'market.html');

describe('market.html document structure', () => {
  let html;

  beforeAll(() => {
    html = fs.readFileSync(MARKET_HTML, 'utf-8');
  });

  test('has exactly one <html> root element', () => {
    const matches = html.match(/<html\b/gi);
    expect(matches).toHaveLength(1);
  });

  test('has exactly one <head> element', () => {
    const matches = html.match(/<head\b/gi);
    expect(matches).toHaveLength(1);
  });

  test('has exactly one </head> closing tag', () => {
    const matches = html.match(/<\/head\s*>/gi);
    expect(matches).toHaveLength(1);
  });

  test('has exactly one <body> element', () => {
    const matches = html.match(/<body\b/gi);
    expect(matches).toHaveLength(1);
  });

  test('has exactly one </body> closing tag', () => {
    const matches = html.match(/<\/body\s*>/gi);
    expect(matches).toHaveLength(1);
  });

  test('does not contain duplicate document roots', () => {
    const doctypes = (html.match(/<!DOCTYPE html>/gi) || []).length;
    expect(doctypes).toBe(1);
  });

  test('does not contain hardcoded game-hosting navigation links', () => {
    expect(html).not.toContain('href="#/game-hosting"');
    expect(html).not.toContain('href="#/game-hosting/requests"');
    expect(html).not.toContain('href="#/game-hosting/my-servers"');
    expect(html).not.toContain('href="#/game-hosting/provision');
  });
});
