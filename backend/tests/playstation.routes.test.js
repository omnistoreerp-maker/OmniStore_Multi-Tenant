'use strict';

// playstation.routes.test — unit tests for the PlayStation route layer.
//
// Verifies that the route file exports a valid Express router and that
// the expected route methods are registered. No server is started.

const router = require('../routes/playstation.routes');

describe('playstation.routes', () => {
  test('exports an Express router', () => {
    expect(router).toBeDefined();
    expect(router.stack).toBeDefined();
    expect(Array.isArray(router.stack)).toBe(true);
  });

  test('has non-empty route stack', () => {
    const methods = router.stack
      .filter(layer => layer.route)
      .map(layer => layer.route.methods);
    expect(methods.length).toBeGreaterThan(0);
  });

  test('registers device routes', () => {
    const paths = router.stack
      .filter(layer => layer.route)
      .map(layer => layer.route.path);
    expect(paths).toContain('/devices');
    expect(paths).toContain('/devices/:id');
    expect(paths).toContain('/devices/:id/transition');
  });

  test('registers pricing routes', () => {
    const paths = router.stack
      .filter(layer => layer.route)
      .map(layer => layer.route.path);
    expect(paths).toContain('/pricing');
    expect(paths).toContain('/pricing/:id');
  });

  test('registers session routes', () => {
    const paths = router.stack
      .filter(layer => layer.route)
      .map(layer => layer.route.path);
    expect(paths).toContain('/sessions');
    expect(paths).toContain('/sessions/:id');
    expect(paths).toContain('/sessions/:id/start');
    expect(paths).toContain('/sessions/:id/stop');
    expect(paths).toContain('/sessions/:id/cancel');
    expect(paths).toContain('/sessions/:id/payment');
  });

  test('has GET routes for devices, pricing, sessions', () => {
    const getPaths = router.stack
      .filter(layer => layer.route && layer.route.methods.get)
      .map(layer => layer.route.path);
    expect(getPaths).toContain('/devices');
    expect(getPaths).toContain('/pricing');
    expect(getPaths).toContain('/sessions');
  });

  test('has POST routes for device creation and session actions', () => {
    const postPaths = router.stack
      .filter(layer => layer.route && layer.route.methods.post)
      .map(layer => layer.route.path);
    expect(postPaths).toContain('/devices');
    expect(postPaths).toContain('/devices/:id/transition');
    expect(postPaths).toContain('/sessions');
    expect(postPaths).toContain('/sessions/:id/start');
    expect(postPaths).toContain('/sessions/:id/stop');
    expect(postPaths).toContain('/sessions/:id/cancel');
  });

  test('has PUT routes for device and pricing updates', () => {
    const putPaths = router.stack
      .filter(layer => layer.route && layer.route.methods.put)
      .map(layer => layer.route.path);
    expect(putPaths).toContain('/devices/:id');
    expect(putPaths).toContain('/pricing/:id');
  });

  test('has DELETE routes for devices and pricing', () => {
    const deletePaths = router.stack
      .filter(layer => layer.route && layer.route.methods.delete)
      .map(layer => layer.route.path);
    expect(deletePaths).toContain('/devices/:id');
    expect(deletePaths).toContain('/pricing/:id');
  });
});
