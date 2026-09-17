// Isolated temporary data stores for tests.
// Nothing here ever touches backend/data — every suite gets its own
// mkdtemp directory which is removed by helpers/cleanup.js.
const fs = require('fs');
const os = require('os');
const path = require('path');

function makeTempDataDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `digitronics-test-${tag || 'data'}-`));
}

function seed(dir, name, payload) {
  fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(payload, null, 2), 'utf-8');
}

function readStore(dir, name) {
  const file = path.join(dir, name + '.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function listStores(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json'));
}

module.exports = { makeTempDataDir, seed, readStore, listStores };
