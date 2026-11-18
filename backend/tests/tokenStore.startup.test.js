'use strict';

// D1 regression: a valid existing token store must survive validation on
// second initialization (same process and a fresh process). Corrupt or
// unavailable stores must fail closed without being recreated.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const BACKEND = path.join(__dirname, '..');
let dataDir;
const originalDataDir = process.env.DIGITRONICS_DATA_DIR;

function loadStore() {
  jest.resetModules();
  return require('../utils/tokenStore.sqlite');
}

beforeAll(() => {
  dataDir = makeTempDataDir('d1-startup');
  process.env.DIGITRONICS_DATA_DIR = dataDir;
});

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.DIGITRONICS_DATA_DIR;
  else process.env.DIGITRONICS_DATA_DIR = originalDataDir;
});

registerCleanup(() => [], () => [dataDir]);

test('first initialise creates a store that validates immediately', () => {
  const store = loadStore();
  const { path: storePath } = store.initialise();
  expect(storePath).toBe(path.join(dataDir, 'tokenStore.sqlite'));
  expect(store.validateStartupConfiguration()).toBe(storePath);
  store.closeDb();
});

test('second initialization in the same process validates the existing database', () => {
  const store = loadStore();
  expect(store.validateStartupConfiguration()).toBe(path.join(dataDir, 'tokenStore.sqlite'));
  store.initialise();
  store.closeDb();
});

test('a fresh process opening the same valid database validates successfully', () => {
  const script = "const ts=require('./utils/tokenStore.sqlite');process.stdout.write(ts.validateStartupConfiguration());";
  const res = spawnSync(process.execPath, ['-e', script], {
    cwd: BACKEND,
    env: { ...process.env, DIGITRONICS_DATA_DIR: dataDir },
    encoding: 'utf8'
  });
  expect(res.status).toBe(0);
  expect(res.stdout.trim()).toBe(path.join(dataDir, 'tokenStore.sqlite'));
});

test('a corrupt database fails closed in a fresh process and is not recreated', () => {
  const storePath = path.join(dataDir, 'tokenStore.sqlite');
  const original = fs.readFileSync(storePath);
  fs.writeFileSync(storePath, 'not a sqlite database');
  const corrupted = fs.readFileSync(storePath);

  const script = "const ts=require('./utils/tokenStore.sqlite');ts.validateStartupConfiguration();";
  const res = spawnSync(process.execPath, ['-e', script], {
    cwd: BACKEND,
    env: { ...process.env, DIGITRONICS_DATA_DIR: dataDir },
    encoding: 'utf8'
  });

  expect(res.status).not.toBe(0);
  const output = String(res.stderr || '') + String(res.stdout || '');
  expect(output).toMatch(/not usable|corrupt|not a database/i);
  expect(Buffer.compare(fs.readFileSync(storePath), corrupted)).toBe(0);

  fs.writeFileSync(storePath, original);
});

test('an unavailable store path fails closed', () => {
  const missingDir = path.join(dataDir, 'no-such-dir');
  const script = [
    "const ts=require('./utils/tokenStore.sqlite');",
    "try{ts.validateStartupConfiguration();console.log('VALIDATED');process.exit(0);}",
    "catch(e){console.error(e.message);process.exit(3);}"
  ].join('');
  const res = spawnSync(process.execPath, ['-e', script], {
    cwd: BACKEND,
    env: {
      ...process.env,
      DIGITRONICS_DATA_DIR: dataDir,
      TOKEN_STORE_PATH: path.join(missingDir, 'tokenStore.sqlite')
    },
    encoding: 'utf8'
  });
  expect(res.status).toBe(3);
  expect(String(res.stderr)).toMatch(/directory missing|not writable|required/i);
});
