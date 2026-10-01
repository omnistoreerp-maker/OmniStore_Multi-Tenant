'use strict';

// Server-side cache of TikTok video metadata for the public Reels feed.
//
// Design:
//   - A page load NEVER calls TikTok. /reels serves the cached snapshot and
//     only refreshes in the background when the snapshot is older than the TTL.
//   - TikTok's own Get Started guide recommends fetching the authorized
//     account's recent videos every 12 hours; the default TTL follows that.
//   - cover_image_url has a documented 6-hour TTL upstream, so a cached cover
//     URL must never be treated as permanently valid: a stale cover is a
//     display concern, never a correctness one.
//   - The snapshot is GLOBAL platform content. There is deliberately no
//     companyId / tenantId field anywhere in this module, and the store key is
//     not parameterized by tenant.

const fileStore = require('../utils/fileStore');
const logger = require('../utils/logger');
const config = require('../config/tiktok');
const displayApi = require('./tiktokDisplayApi.service');
const connection = require('./tiktokConnection.service');

const STORE = 'reelsCache';

// 12h, matching TikTok's documented "fetch and update every 12 hours".
const DEFAULT_TTL_MS = parseInt(process.env.TIKTOK_REELS_TTL_MS, 10) || 12 * 60 * 60 * 1000;
// How many videos to keep in the public feed. One page of the Display API is
// 20 max; keeping 24 means the feed covers one full sync window with a little
// headroom without holding an unbounded cursor chain.
const DEFAULT_MAX_ITEMS = parseInt(process.env.TIKTOK_REELS_MAX_ITEMS, 10) || 24;
// How many pages to walk per sync. Bounded so a sync can never become an
// unbounded crawl against a 600 req/min budget.
const MAX_PAGES_PER_SYNC = 3;

function _empty() {
  return { items: [], cursor: null, hasMore: false, syncedAt: null, lastError: null };
}

function _read() {
  const raw = fileStore.readRaw(STORE);
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) return _empty();
  return Object.assign(_empty(), raw);
}

function _write(record) {
  return fileStore.write(STORE, record);
}

function isStale(record) {
  if (!record || !record.syncedAt) return true;
  return (Date.now() - new Date(record.syncedAt).getTime()) >= DEFAULT_TTL_MS;
}

// The public feed shape. Items are already normalized by the Display API
// service, and only display metadata is present. No tokens, no OAuth
// identifiers, no tenant data.
function getFeed() {
  const record = _read();
  return {
    items: record.items,
    nextCursor: null,
    hasMore: Boolean(record.hasMore),
    syncedAt: record.syncedAt,
    stale: isStale(record),
    connected: connection.isConnected(),
    account: connection.getStatus().username || null,
    lastError: record.lastError
  };
}

// Fetch the authorized account's public videos and store them. Safe to call
// on a timer or on demand; the controller never blocks a page load on it.
async function syncNow() {
  if (!connection.isConnected()) {
    _write(Object.assign(_read(), { lastError: 'not_connected' }));
    return { ok: false, code: 'not_connected' };
  }

  const collected = [];
  let cursor = null;
  let hasMore = false;

  for (let page = 0; page < MAX_PAGES_PER_SYNC; page += 1) {
    const result = await displayApi.listVideos({ maxCount: config.VIDEO_LIST_MAX_COUNT, cursor });
    if (!result.ok) {
      const record = _read();
      _write(Object.assign(record, { lastError: result.code || 'sync_failed' }));
      logger.warn('reelsCache: sync failed (' + (result.code || 'unknown') + ')');
      return { ok: false, code: result.code || 'sync_failed' };
    }
    for (const item of result.items) collected.push(item);
    hasMore = Boolean(result.hasMore);
    // Stop at the first page that reports no more, or that returns nothing new.
    if (!result.hasMore || result.items.length === 0) break;
    cursor = result.cursor;
  }

  // Newest first, de-duplicated by id.
  const seen = new Set();
  const items = [];
  for (const item of collected) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  items.sort((a, b) => {
    const left = a.createdAt || '';
    const right = b.createdAt || '';
    if (left < right) return 1;
    if (left > right) return -1;
    return 0;
  });

  _write({
    items: items.slice(0, DEFAULT_MAX_ITEMS),
    cursor: cursor || null,
    hasMore,
    syncedAt: new Date().toISOString(),
    lastError: null
  });
  logger.info('reelsCache: synced ' + Math.min(items.length, DEFAULT_MAX_ITEMS) + ' public videos');
  return { ok: true, count: items.length };
}

// Serve from cache; refresh in the background when stale so the request is
// never blocked on an upstream call.
async function ensureFresh() {
  const record = _read();
  if (isStale(record)) {
    // Intentionally not awaited: the response uses the current snapshot.
    syncNow().catch(() => {});
  }
  return getFeed();
}

function getCacheInfo() {
  const record = _read();
  return {
    count: record.items.length,
    syncedAt: record.syncedAt,
    ttlMs: DEFAULT_TTL_MS,
    stale: isStale(record),
    lastError: record.lastError
  };
}

function _resetRateBudget() {
  displayApi._resetRateBudget();
}

module.exports = {
  getFeed,
  getCacheInfo,
  syncNow,
  ensureFresh,
  isStale,
  DEFAULT_TTL_MS,
  DEFAULT_MAX_ITEMS,
  _resetRateBudget
};
