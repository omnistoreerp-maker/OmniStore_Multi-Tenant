'use strict';

const logger = require('../utils/logger');
const fileStore = require('../utils/fileStore');

const STORE = 'reels';

const VISIBILITY_PUBLIC = 'public';
const STATUS_READY = 'ready';

function _now() {
  return new Date().toISOString();
}

function _defaultDoc() {
  return { reels: [] };
}

function _load() {
  const data = fileStore.read(STORE);
  if (data && Array.isArray(data.reels)) return data.reels;
  return [];
}

function _save(reels) {
  return fileStore.write(STORE, { reels });
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

function listPublic() {
  const reels = _load();
  return reels
    .filter((r) => r && r.visibility === VISIBILITY_PUBLIC && r.status === STATUS_READY)
    .slice()
    .sort((a, b) => {
      if (a.createdAt < b.createdAt) return 1;
      if (a.createdAt > b.createdAt) return -1;
      return 0;
    });
}

function getById(id) {
  const reels = _load();
  const found = reels.find((r) => r && r.id === id);
  if (!found) return null;
  if (found.visibility !== VISIBILITY_PUBLIC || found.status !== STATUS_READY) {
    return null;
  }
  return found;
}

function upsert(reel, create = false) {
  const normalized = _normalizeReel(reel, create);
  if (normalized.error) return { error: normalized.error };

  const reels = _load();
  const idx = reels.findIndex((r) => r && r.id === normalized.id);
  const entry = Object.assign({}, normalized, { updatedAt: _now() });

  if (idx === -1) {
    if (create) {
      reels.push(entry);
      _save(reels);
      return { ok: true, reel: entry };
    }
    return { error: 'reel not found' };
  }

  reels[idx] = entry;
  _save(reels);
  return { ok: true, reel: entry };
}

module.exports = {
  listPublic,
  getById,
  upsert,
  VISIBILITY_PUBLIC,
  STATUS_READY
};
