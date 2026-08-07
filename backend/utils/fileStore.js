const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// Tests point DIGITRONICS_DATA_DIR at an isolated temp directory; when the
// variable is unset the default location (and runtime behavior) is unchanged.
const DATA_DIR = process.env.DIGITRONICS_DATA_DIR
  ? path.resolve(process.env.DIGITRONICS_DATA_DIR)
  : path.join(__dirname, '..', 'data');

function _empty(name) {
  return name === 'sales' ? { invoices: [] } : {};
}

let _dirEnsured = false;

// Read cache: parsed content keyed by store name, validated by mtime.
// Avoids re-reading and re-parsing unchanged files on every request.
// The cache only reflects states that were durably written: it is
// refreshed after every successful write and invalidated on failure.
const _cache = new Map();

const fileStore = {
  _ensureDir() {
    if (_dirEnsured) return;
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    _dirEnsured = true;
  },

  _path(name) {
    return path.join(DATA_DIR, name + '.json');
  },

  read(name) {
    const filePath = this._path(name);
    try {
      if (!fs.existsSync(filePath)) {
        // No store yet: serve the empty shape WITHOUT creating a file.
        // Reads stay read-only; the file appears on the first real write.
        const empty = _empty(name);
        _cache.set(name, { data: empty, mtimeMs: 0 });
        return empty;
      }
      const stat = fs.statSync(filePath);
      const cached = _cache.get(name);
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.data;

      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      _cache.set(name, { data, mtimeMs: stat.mtimeMs, size: stat.size });
      return data;
    } catch (err) {
      logger.error(`fileStore.read('${name}') failed:`, err.message);
      // JSON.parse throws SyntaxError on corruption; detect it by type,
      // not by error-message text (which varies across Node versions).
      if (err instanceof SyntaxError) {
        logger.warn(`Corrupted ${name}.json – resetting`);
        const empty = _empty(name);
        fileStore.write(name, empty);
        return empty;
      }
      _cache.delete(name);
      return _empty(name);
    }
  },

  write(name, data) {
    this._ensureDir();
    const filePath = this._path(name);
    const tmpPath = filePath + '.tmp';
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tmpPath, filePath);
      // Cache only what was durably written.
      const stat = fs.statSync(filePath);
      _cache.set(name, { data, mtimeMs: stat.mtimeMs, size: stat.size });
      return true;
    } catch (err) {
      logger.error(`fileStore.write('${name}') failed:`, err.message);
      _cache.delete(name);
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
      return false;
    }
  },

  // Writes are synchronous and write-through, so there is never anything
  // pending; flushAll exists so shutdown code has a stable hook.
  flushAll() {
    return true;
  }
};

module.exports = fileStore;
