'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PLATFORM_CATALOG = require('../services/platformCatalog.service');
const INTERNAL_CHANGE_CENTER_CONTROLLER = require('../controllers/internalChangeCenter.controller');
const CUSTOMER_REQUEST_CONTROLLER = require('../controllers/customerRequest.controller');

function repoFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

describe('Support and Change Center honest gating', () => {
  test('Support is cataloged as coming-soon with no active URL', () => {
    const catalog = PLATFORM_CATALOG.getCatalog();
    const support = catalog.sections.find(function (s) { return s.id === 'support'; });
    expect(support).toBeDefined();
    expect(support.status).toBe('coming-soon');
    expect(support.url).toBeNull();
  });

  test('Change Center and My Requests are cataloged as coming-soon with no active URL', () => {
    const catalog = PLATFORM_CATALOG.getCatalog();
    const changeCenter = catalog.sections.find(function (s) { return s.id === 'change-center'; });
    const myRequests = catalog.sections.find(function (s) { return s.id === 'my-requests'; });
    expect(changeCenter).toBeDefined();
    expect(changeCenter.status).toBe('coming-soon');
    expect(changeCenter.url).toBeNull();
    expect(myRequests).toBeDefined();
    expect(myRequests.status).toBe('coming-soon');
    expect(myRequests.url).toBeNull();
  });

  test('platform.html does not contain active navigation links to inactive support pages', () => {
    const html = repoFile('platform.html');
    expect(html).not.toContain('href="internal.html"');
    expect(html).not.toContain('href="customer.html"');
  });

  test('internal.html is an honest Under Construction placeholder with no fake data or APIs', () => {
    const html = repoFile('internal.html');
    expect(html).toContain('Under Construction');
    expect(html).toContain('Change Center');
    expect(html).not.toMatch(/<script[^>]*src=.*api/i);
    expect(html).not.toMatch(/fetch\s*\(/i);
  });

  test('customer.html is an honest Under Construction placeholder with no fake data or APIs', () => {
    const html = repoFile('customer.html');
    expect(html).toContain('Under Construction');
    expect(html).toContain('My Requests');
    expect(html).not.toMatch(/<script[^>]*src=.*api/i);
    expect(html).not.toMatch(/fetch\s*\(/i);
  });
});

describe('Change Center API authorization', () => {
  test('internalChangeCenter controller exports require platform-admin middleware in routes', () => {
    const routes = repoFile('backend/routes/internalChangeCenter.routes.js');
    expect(routes).toContain('requirePlatformAdmin');
    expect(routes).toContain('requireAuth');
  });

  test('customerRequest controller requires authenticated company context', () => {
    const controller = CUSTOMER_REQUEST_CONTROLLER;
    expect(controller.listRequests).toBeDefined();
    expect(controller.getRequest).toBeDefined();
    expect(controller.createRequest).toBeDefined();
  });
});
