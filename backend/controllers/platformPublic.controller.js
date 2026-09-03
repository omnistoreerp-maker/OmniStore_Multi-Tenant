'use strict';

const { success, error } = require('../utils/apiResponse');
const platformCatalog = require('../services/platformCatalog.service');

function notFound(req, res) {
  return error(res, 'Not found', 404);
}

function getCatalog(req, res) {
  try {
    const data = platformCatalog.getCatalog();
    success(res, data, 'Platform catalog retrieved');
  } catch (err) {
    error(res, 'Failed to retrieve platform catalog', 500);
  }
}

function getFeatures(req, res) {
  try {
    const data = platformCatalog.getCatalog();
    success(res, { features: data.features || [] }, 'Features retrieved');
  } catch (err) {
    error(res, 'Failed to retrieve features', 500);
  }
}

function getStats(req, res) {
  try {
    const data = platformCatalog.getCatalog();
    success(res, { stats: data.stats || [] }, 'Stats retrieved');
  } catch (err) {
    error(res, 'Failed to retrieve stats', 500);
  }
}

function getHighlights(req, res) {
  try {
    const data = platformCatalog.getCatalog();
    success(res, { highlights: data.highlights || [] }, 'Highlights retrieved');
  } catch (err) {
    error(res, 'Failed to retrieve highlights', 500);
  }
}

module.exports = {
  getCatalog,
  getFeatures,
  getStats,
  getHighlights,
  notFound
};
