// Health service unit tests.
const { makeTempDataDir } = require('./helpers/testData');

let dataDir;

beforeAll(() => {
  dataDir = makeTempDataDir('health-unit');
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  jest.resetModules();
});

afterAll(() => {
  const fs = require('fs');
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('health.service', () => {
  let health;

  beforeAll(() => {
    jest.resetModules();
    health = require('../services/health.service');
  });

  test('runAll returns ok with all component checks', () => {
    const result = health.runAll();
    expect(result.status).toBe('ok');
    expect(result.checks).toHaveProperty('persistence');
    expect(result.checks).toHaveProperty('audit');
    expect(result.checks).toHaveProperty('metrics');
    expect(result.checks).toHaveProperty('eventbus');
    expect(result.checks).toHaveProperty('jobs');
    expect(result.checks).toHaveProperty('webhooks');
    expect(result.checks.persistence.status).toBe('ok');
  });

  test('runOne returns a single component', () => {
    const result = health.runOne('persistence');
    expect(result).toHaveProperty('persistence');
    expect(result.persistence.status).toBe('ok');
  });

  test('runOne returns null for unknown component', () => {
    expect(health.runOne('nope')).toBeNull();
  });

  test('CHECKS registry covers expected components', () => {
    expect(Object.keys(health.CHECKS).sort()).toEqual(
      ['audit', 'eventbus', 'jobs', 'metrics', 'persistence', 'webhooks'].sort()
    );
  });
});