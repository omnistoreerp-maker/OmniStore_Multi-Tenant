'use strict';

const fs = require('fs');
const path = require('path');

const SERVER_JS = path.join(__dirname, '..', 'server.js');

describe('backend CSP configuration', () => {
  let source;

  beforeAll(() => {
    source = fs.readFileSync(SERVER_JS, 'utf-8');
  });

  test('script-src includes unpkg.com for lucide icons', () => {
    expect(source).toMatch(/https:\/\/unpkg\.com/);
  });

  test('script-src does not use wildcard *', () => {
    const scriptSrcBlock = source.match(/scriptSrc\s*:\s*\[([\s\S]*?)\]/);
    if (scriptSrcBlock) {
      expect(scriptSrcBlock[1]).not.toMatch(/'\*'/);
      expect(scriptSrcBlock[1]).not.toMatch(/"\*"/);
    }
  });

  test('script-src includes required origins', () => {
    expect(source).toMatch(/'self'/);
    expect(source).toMatch(/https:\/\/cdn\.jsdelivr\.net/);
    expect(source).toMatch(/https:\/\/unpkg\.com/);
  });

  test('connect-src includes api.github.com and cdn.jsdelivr.net', () => {
    const connectSrcBlock = source.match(/connectSrc\s*:\s*\[([\s\S]*?)\]/);
    if (connectSrcBlock) {
      expect(connectSrcBlock[1]).toMatch(/https:\/\/api\.github\.com/);
      expect(connectSrcBlock[1]).toMatch(/https:\/\/cdn\.jsdelivr\.net/);
    }
  });

  test('frame-src and object-src are locked to none', () => {
    expect(source).toMatch(/frameSrc:\s*\[\s*"\'none\'"\s*\]/);
    expect(source).toMatch(/objectSrc:\s*\[\s*"\'none\'"\s*\]/);
  });
});
