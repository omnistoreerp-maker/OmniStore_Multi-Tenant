'use strict';

const fs = require('fs');
const { success, error } = require('../utils/apiResponse');
const reelsService = require('../services/reels.service');
const logger = require('../utils/logger');

// Public feed page (cursor + clamped limit). Tenant id comes from the
// server-side guard context, never from the request body.
async function getReels(req, res) {
  try {
    const tenantId = req.marketTenant;
    const page = reelsService.listPublic(tenantId, {
      cursor: req.query.cursor,
      limit: req.query.limit
    });
    success(res, { reels: page.reels, count: page.count, nextCursor: page.nextCursor }, 'Public reels retrieved');
  } catch (err) {
    logger.error('reels.getReels error:', err && err.message || err);
    error(res, 'Failed to retrieve public reels', 500);
  }
}

async function getReelById(req, res) {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) {
      return error(res, 'Reel id is required', 400);
    }
    // Lookup is scoped to this tenant's store: another tenant's reel id is
    // indistinguishable from a missing one (non-disclosing 404).
    const reel = reelsService.getById(id, req.marketTenant);
    if (!reel) {
      return error(res, 'Reel not found', 404);
    }
    success(res, { reel }, 'Reel retrieved');
  } catch (err) {
    logger.error('reels.getReelById error:', err && err.message || err);
    error(res, 'Failed to retrieve reel', 500);
  }
}

// Operator-only metadata create. requireMarketTenant + requireOperator run
// first, so the tenant identity is guard-derived and the caller is a real
// operator of that tenant.
async function createReel(req, res) {
  try {
    const tenantId = req.marketTenant;
    const payload = (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) ? req.body : {};
    const result = reelsService.upsert(payload, true, tenantId);
    if (result.error) {
      return error(res, result.error, 400);
    }
    return success(res, { reel: result.reel }, 'Reel created', 201);
  } catch (err) {
    logger.error('reels.createReel error:', err && err.message || err);
    error(res, 'Failed to create reel', 500);
  }
}

// Operator-only raw media upload (express.raw bounded by MAX_UPLOAD_BYTES).
async function uploadMedia(req, res) {
  try {
    const tenantId = req.marketTenant;
    const contentType = String((req.headers && req.headers['content-type']) || '')
      .split(';')[0].trim().toLowerCase();

    // Active reject list: documents and multipart streams are never valid
    // media uploads and are refused before any storage work happens.
    if (contentType === 'image/svg+xml' || contentType === 'text/html' || contentType === 'multipart/form-data') {
      return error(res, 'Unsupported media type', 415);
    }
    if (!Object.prototype.hasOwnProperty.call(reelsService.ALLOWED_MIME, contentType)) {
      return error(res, 'Unsupported media type', 415);
    }

    const buffer = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buffer || buffer.length === 0) {
      return error(res, 'upload body is required', 400);
    }
    if (buffer.length > reelsService.MAX_UPLOAD_BYTES) {
      return error(res, 'Upload exceeds maxSize', 413);
    }
    if (reelsService.looksDangerousHeader(buffer)) {
      return error(res, 'Unsupported media type', 415); // svg/html/executable headers
    }
    const sniffed = reelsService.sniffMediaMagic(buffer); // magic-byte signature validation
    if (!sniffed || sniffed !== contentType) {
      return error(res, 'Unsupported media type', 415);
    }

    const saved = reelsService.saveUpload(tenantId, buffer, contentType);
    if (saved.error) {
      return error(res, saved.error, 500); // explicit upload failure state
    }
    success(res, { mediaUrl: saved.mediaUrl, mime: contentType, size: saved.size }, 'Upload stored', 201);
  } catch (err) {
    logger.error('reels.uploadMedia error:', err && err.message || err);
    error(res, 'Upload failed', 500);
  }
}

// Tenant-scoped media serving: the URL tenant segment must equal the guarded
// tenant, otherwise the file does not exist as far as the caller knows.
async function serveMedia(req, res) {
  try {
    const tenantId = req.marketTenant;
    const mediaTenant = String(req.params.tenantId || '');
    if (mediaTenant !== tenantId) {
      return error(res, 'Media not found', 404); // cross-tenant read: non-disclosing
    }
    const fileName = String(req.params.fileName || '');
    const full = reelsService.mediaPathFor(tenantId, fileName);
    if (!full || !fs.existsSync(full)) {
      return error(res, 'Media not found', 404);
    }
    res.setHeader('Content-Type', reelsService.mimeForFile(fileName));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.sendFile(full);
  } catch (err) {
    logger.error('reels.serveMedia error:', err && err.message || err);
    return error(res, 'Media not found', 404);
  }
}

module.exports = {
  getReels,
  getReelById,
  createReel,
  uploadMedia,
  serveMedia
};
