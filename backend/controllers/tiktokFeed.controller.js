'use strict';

const { success, error } = require('../utils/apiResponse');
const tiktokFeed = require('../services/tiktokFeed.service');
const logger = require('../utils/logger');

async function getTikTokFeed(req, res) {
  try {
    const result = await tiktokFeed.fetchTikTokFeed();
    success(res, { embeds: result.data, cache: tiktokFeed.getCacheInfo() }, 'TikTok feed retrieved');
  } catch (err) {
    logger.error('tiktokFeed.getTikTokFeed error:', err.message);
    error(res, 'Failed to retrieve TikTok feed', 500);
  }
}

module.exports = {
  getTikTokFeed
};
