const fs = require('fs');
const path = require('path');
const config = require('../config');

const isDev = config.env === 'development';
const LOG_FILE = config.logFile;

let _stream = null;
function _fileLine(level, args) {
  if (!LOG_FILE) return;
  try {
    if (!_stream) _stream = fs.createWriteStream(path.resolve(LOG_FILE), { flags: 'a' });
    const line = new Date().toISOString() + ' [' + level + '] ' + args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n';
    _stream.write(line);
  } catch (_) {}
}

const logger = {
  // info/debug are development-only (no console.log in production)
  info: (...args) => { if (isDev) console.log('[INFO]', ...args); _fileLine('INFO', args); },
  warn: (...args) => { console.warn('[WARN]', ...args); _fileLine('WARN', args); },
  error: (...args) => { console.error('[ERROR]', ...args); _fileLine('ERROR', args); },
  debug: (...args) => { if (isDev) console.log('[DEBUG]', ...args); _fileLine('DEBUG', args); },
  // performance logging — always structured, console only in development
  perf: (...args) => { if (isDev) console.log('[PERF]', ...args); _fileLine('PERF', args); },
  // Close the file stream (graceful shutdown). No-op when no file is used.
  close: () => {
    if (_stream) {
      try { _stream.end(); } catch (_) {}
      _stream = null;
    }
  }
};

module.exports = logger;
