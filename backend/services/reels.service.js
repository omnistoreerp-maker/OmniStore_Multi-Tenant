'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');
const fileStore = require('../utils/fileStore');

// Reels are tenant-scoped end to end:
//   - metadata: one JSON store per tenant  -> <dataDir>/reels-<tenantId>.json
//   - media:    per-tenant media storage    -> <dataDir>/reel-media/<tenantId>/<fileName>
// Tenant id always comes from the server-side guard (requireMarketTenant),
// never from the request body.
const DATA_DIR = process.env.DIGITRONICS_DATA_DIR
  ? path.resolve(process.env.DIGITRONICS_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const MEDIA_STORAGE_ROOT = path.join(DATA_DIR, 'reel-media');

// Upload policy (MVP): raw video containers only, bounded and sniffed here so
// no extra dependency is needed. multipart/form-data is not parsed anywhere on
// this surface; svg/html documents and executables are actively rejected.
const ALLOWED_MIME = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/ogg': '.ogg'
};
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

// Feed pagination bounds: every page is clamped between 1 and MAX_LIMIT so the
// public feed can never be asked for an unbounded list.
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;

const VISIBILITY_PUBLIC = 'public';
const STATUS_READY = 'ready';

function _now() {
  return new Date().toISOString();
}

function _safeTenant(tenantId) {
  const safe = String(tenantId == null ? '' : tenantId).replace(/[^A-Za-z0-9_-]/g, '_');
  return safe || 'default';
}

function _storeName(tenantId) {
  return 'reels-' + _safeTenant(tenantId);
}

function _load(tenantId) {
  const data = fileStore.read(_storeName(tenantId));
  if (data && Array.isArray(data.reels)) return data.reels;
  return [];
}

function _save(tenantId, reels) {
  return fileStore.write(_storeName(tenantId), { reels });
}

function _normalizeReel(reel, create = false) {
  if (typeof reel !== 'object' || reel === null) {
    return { error: 'reel must be an object' };
  }
  // Structural/lookup fields: normalize to stable strings.
  const id = String(reel.id || '').trim();
  const mediaUrl = String(reel.mediaUrl || '').trim();
  // User-visible content fields: keep the provider's value intact; do NOT
  // trim or otherwise mutate them on write.
  const thumbnailUrl = reel.thumbnailUrl == null ? '' : String(reel.thumbnailUrl);
  const caption = reel.caption == null ? '' : String(reel.caption);
  const creator = reel.creator == null ? '' : String(reel.creator);
  const hashtags = Array.isArray(reel.hashtags)
    ? reel.hashtags.filter((h) => typeof h === 'string' && h.length > 0).map((h) => h.trim())
    : [];
  const visibility = String(reel.visibility || VISIBILITY_PUBLIC).toLowerCase();
  const status = String(reel.status || STATUS_READY).toLowerCase();

  if (create && !id) {
    return { error: 'id is required' };
  }
  if (!mediaUrl) {
    return { error: 'mediaUrl is required' };
  }
  if (create && !creator) {
    return { error: 'creator is required' };
  }
  if (!['public', 'private', 'draft'].includes(visibility)) {
    return { error: 'visibility must be public, private, or draft' };
  }
  if (!['ready', 'processing', 'failed'].includes(status)) {
    return { error: 'status must be ready, processing, or failed' };
  }

  return {
    id,
    creator,
    mediaUrl,
    thumbnailUrl,
    caption,
    hashtags,
    visibility,
    status,
    createdAt: reel.createdAt || _now()
  };
}

// Reject mediaUrl values that point at ANOTHER tenant's uploaded media so a
// tenant can never wire its public reel to a different tenant's storage.
function _mediaUrlTenant(mediaUrl) {
  const marker = '/platform-public/reels/media/';
  const idx = String(mediaUrl).indexOf(marker);
  if (idx === -1) return null;
  const rest = String(mediaUrl).slice(idx + marker.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  return decodeURIComponent(rest.slice(0, slash));
}

function _encodeCursor(reel) {
  return Buffer.from(String(reel.createdAt) + '|' + String(reel.id), 'utf8').toString('base64');
}

function _decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(String(cursor), 'base64').toString('utf8');
    const sep = raw.lastIndexOf('|');
    if (sep <= 0) return null;
    const createdAt = raw.slice(0, sep);
    const id = raw.slice(sep + 1);
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch (err) {
    return null;
  }
}

// Public feed page: deterministic newest-first ordering, a cursor for stable
// pagination, and a clamped limit. Returns { reels, count, nextCursor }.
function listPublic(tenantId, opts) {
  opts = opts || {};
  const requested = parseInt(opts.limit, 10) || DEFAULT_LIMIT;
  const limit = Math.min(Math.max(requested, 1), MAX_LIMIT);
  const cursor = _decodeCursor(opts.cursor);

  const visible = _load(tenantId)
    .filter((r) => r && r.visibility === VISIBILITY_PUBLIC && r.status === STATUS_READY)
    .slice()
    .sort((a, b) => {
      // Deterministic ordering: createdAt desc, id desc as the tie-break.
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
      return String(b.id).localeCompare(String(a.id));
    });

  let start = 0;
  if (cursor) {
    // Walk past everything newer than the cursor; stop at the first older item.
    start = visible.length;
    for (let i = 0; i < visible.length; i++) {
      const r = visible[i];
      let cmp;
      if (String(r.createdAt) !== cursor.createdAt) {
        cmp = String(r.createdAt) < cursor.createdAt ? -1 : 1;
      } else {
        cmp = String(r.id).localeCompare(cursor.id);
      }
      if (cmp < 0) {
        start = i;
        break;
      }
    }
  }

  const seen = new Set();
  const page = [];
  for (let i = start; i < visible.length && page.length < limit; i++) {
    const id = String(visible[i].id);
    if (seen.has(id)) continue;
    seen.add(id);
    page.push(visible[i]);
  }

  const hasMore = start + page.length < visible.length;
  const nextCursor = page.length > 0 && hasMore ? _encodeCursor(page[page.length - 1]) : null;
  return { reels: page, count: page.length, nextCursor };
}

function getById(id, tenantId) {
  const found = _load(tenantId).find((r) => r && r.id === id);
  if (!found) return null;
  if (found.visibility !== VISIBILITY_PUBLIC || found.status !== STATUS_READY) {
    return null;
  }
  return found;
}

function upsert(reel, create = false, tenantId = null) {
  const normalized = _normalizeReel(reel, create);
  if (normalized.error) return { error: normalized.error };

  const urlTenant = _mediaUrlTenant(normalized.mediaUrl);
  if (urlTenant !== null && _safeTenant(urlTenant) !== _safeTenant(tenantId)) {
    return { error: 'mediaUrl must reference this tenant own uploaded media' };
  }

  const reels = _load(tenantId);
  const idx = reels.findIndex((r) => r && r.id === normalized.id);
  const entry = Object.assign({}, normalized, { updatedAt: _now() });

  if (idx === -1) {
    if (create) {
      reels.push(entry);
      _save(tenantId, reels);
      return { ok: true, reel: entry };
    }
    return { error: 'reel not found' };
  }

  reels[idx] = entry;
  _save(tenantId, reels);
  return { ok: true, reel: entry };
}

// Magic-byte signature check on the Buffer header. No external parser:
//   mp4/isobmff -> 'ftyp' at byte offset 4
//   webm/matroska -> EBML magic 1A 45 DF A3
//   ogg -> 'OggS'
function sniffMediaMagic(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer.slice(4, 8).toString('latin1') === 'ftyp') return 'video/mp4';
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return 'video/webm';
  if (buffer.slice(0, 4).toString('latin1') === 'OggS') return 'video/ogg';
  return null;
}

// Active reject: document and executable headers can never be a media upload.
function looksDangerousHeader(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 2) return false;
  const head = buffer.slice(0, 64).toString('latin1');
  if (head.charAt(0) === '<') return true; // svg/html/xml start with '<'
  if (head.slice(0, 2) === 'MZ') return true; // windows executable
  if (head.slice(0, 4) === '\x7fELF') return true; // elf executable
  return false;
}

function saveUpload(tenantId, buffer, mime) {
  const ext = ALLOWED_MIME[mime];
  if (!ext) return { error: 'Unsupported media type' };
  const tenant = _safeTenant(tenantId);
  const mediaDir = path.join(MEDIA_STORAGE_ROOT, tenant);
  try {
    if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
    const fileName = tenant + '-' + Date.now() + '-' + crypto.randomBytes(6).toString('hex') + ext;
    fs.writeFileSync(path.join(mediaDir, fileName), buffer);
    return {
      mediaUrl: '/api/v1/platform-public/reels/media/' + encodeURIComponent(tenant) + '/' + fileName,
      fileName,
      size: buffer.length
    };
  } catch (err) {
    logger.error('reels.saveUpload error:', err && err.message || err);
    return { error: 'Failed to store uploaded media' };
  }
}

// Resolve an uploaded media file inside this tenant's media directory only.
function mediaPathFor(tenantId, fileName) {
  if (typeof fileName !== 'string' || !/^[A-Za-z0-9._-]+$/.test(fileName)) return null;
  if (fileName.indexOf('..') !== -1) return null;
  const mediaDir = path.join(MEDIA_STORAGE_ROOT, _safeTenant(tenantId));
  const full = path.join(mediaDir, fileName);
  if (path.dirname(full) !== mediaDir) return null;
  return full;
}

function mimeForFile(fileName) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  const byExt = Object.keys(ALLOWED_MIME).reduce((acc, mime) => {
    acc[ALLOWED_MIME[mime]] = mime;
    return acc;
  }, {});
  return byExt[ext] || 'application/octet-stream';
}

module.exports = {
  listPublic,
  getById,
  upsert,
  sniffMediaMagic,
  looksDangerousHeader,
  saveUpload,
  mediaPathFor,
  mimeForFile,
  ALLOWED_MIME,
  MAX_UPLOAD_BYTES,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  VISIBILITY_PUBLIC,
  STATUS_READY
};
