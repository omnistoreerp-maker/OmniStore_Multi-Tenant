'use strict';

const logger = require('../utils/logger');

const TIKTOK_USERNAME = String(process.env.TIKTOK_USERNAME || 'YOUR_TIKTOK_USERNAME_HERE');
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_EMBEDS = 6;
const PROFILE_URL = 'https://www.tiktok.com/@' + encodeURIComponent(TIKTOK_USERNAME);
const OEMBED_URL = 'https://www.tiktok.com/oembed';

let cachedAt = 0;
let cache = null;

async function _fetchJson(url, opts) {
  const res = await fetch(url, opts || {});
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}
  if (!res.ok) return { ok: false, status: res.status, data, rawText: text };
  return { ok: true, status: res.status, data, rawText: text };
}

function _extractVideoUrls(html) {
  const urls = new Set();
  const regex = /https:\/\/www\.tiktok\.com\/@[\w._-]+\/video\/(\d+)/g;
  let m;
  while ((m = regex.exec(html)) && urls.size < MAX_EMBEDS) {
    urls.add(m[0]);
  }
  return Array.from(urls);
}

async function _fetchOEmbedForUrl(videoUrl) {
  const qs = new URLSearchParams({ url: videoUrl });
  const result = await _fetchJson(OEMBED_URL + '?' + qs.toString(), {
    headers: { Accept: 'application/json' }
  });
  if (!result.ok || !result.data) return null;
  return {
    url: videoUrl,
    author_name: result.data.author_name || TIKTOK_USERNAME,
    title: result.data.title || '',
    thumbnail: result.data.thumbnail_url || '',
    embed_html: result.data.html || '',
    width: result.data.width || 325,
    height: result.data.height || 580
  };
}

async function _scrapeProfile() {
  const result = await _fetchJson(PROFILE_URL, {
    headers: { Accept: 'text/html,application/xhtml+xml' }
  });
  if (!result.ok) return [];
  const html = String(result.rawText != null ? result.rawText : (result.data == null ? '' : result.data));
  const urls = _extractVideoUrls(html);
  if (!urls.length) return [];
  const embeds = [];
  for (let i = 0; i < urls.length && embeds.length < MAX_EMBEDS; i++) {
    const embed = await _fetchOEmbedForUrl(urls[i]);
    if (embed) embeds.push(embed);
  }
  return embeds;
}

async function fetchTikTokFeed() {
  const now = Date.now();
  if (cache && (now - cachedAt) < CACHE_TTL_MS) {
    return { data: cache, cached: true };
  }

  let embeds = [];
  try {
    embeds = await _scrapeProfile();
  } catch (err) {
    logger.warn('tiktokFeed.service: profile scrape failed: ' + (err && err.message || err));
  }

  if (!embeds.length) {
    embeds = [{
      url: PROFILE_URL,
      author_name: TIKTOK_USERNAME,
      title: 'Check out our TikTok',
      thumbnail: '',
      embed_html: '',
      width: 325,
      height: 580,
      fallback: true
    }];
  }

  cache = embeds;
  cachedAt = now;
  return { data: embeds, cached: false };
}

function getCacheInfo() {
  const age = cache ? Date.now() - cachedAt : null;
  return {
    cachedAt: cachedAt ? new Date(cachedAt).toISOString() : null,
    ageMs: age,
    ttlMs: CACHE_TTL_MS,
    stale: !cache || age > CACHE_TTL_MS
  };
}

module.exports = {
  TIKTOK_USERNAME,
  fetchTikTokFeed,
  getCacheInfo
};
