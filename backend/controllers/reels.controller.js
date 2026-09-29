'use strict';

const { success, error } = require('../utils/apiResponse');
const reelsService = require('../services/reels.service');
const logger = require('../utils/logger');

async function getReels(req, res) {
  try {
    const reels = reelsService.listPublic();
    success(res, { reels, count: reels.length }, 'Public reels retrieved');
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
    const reel = reelsService.getById(id);
    if (!reel) {
      return error(res, 'Reel not found', 404);
    }
    success(res, { reel }, 'Reel retrieved');
  } catch (err) {
    logger.error('reels.getReelById error:', err && err.message || err);
    error(res, 'Failed to retrieve reel', 500);
  }
}

module.exports = {
  getReels,
  getReelById
};
