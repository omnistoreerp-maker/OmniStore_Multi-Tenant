'use strict';

const storageAdapter = require('../repositories/storageAdapter');
const logger = require('../utils/logger');

const STORE_KEY = 'companyProfile';

function _defaultProfile(companyId) {
  return {
    companyId: companyId,
    identity: {
      displayName: '',
      legalName: '',
      slug: '',
      logo: null,
      coverImage: null,
      shortDescription: '',
      fullDescription: '',
      category: '',
      status: 'INACTIVE'
    },
    contact: {
      phone: '',
      email: '',
      website: '',
      address: '',
      city: '',
      region: '',
      workingHours: ''
    },
    products: [],
    services: [],
    offers: [],
    media: [],
    socialChannels: [],
    lastUpdated: new Date().toISOString()
  };
}

function _defaultRegistry() {
  return {
    profiles: [],
    lastUpdated: new Date().toISOString()
  };
}

function _readStore() {
  try {
    const raw = storageAdapter.read(STORE_KEY);
    if (raw && typeof raw === 'object') return raw;
  } catch (err) {
    logger.warn('companyProfile.service: failed to read store, falling back to default', err.message);
  }
  return _defaultRegistry();
}

function _toArray(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.profiles)) return data.profiles;
  return [];
}

function _sanitizeIdentity(identity) {
  if (!identity || typeof identity !== 'object') return {};
  return {
    displayName: String(identity.displayName || ''),
    legalName: String(identity.legalName || ''),
    slug: String(identity.slug || ''),
    logo: identity.logo && typeof identity.logo === 'object' ? {
      url: String(identity.logo.url || ''),
      alt: String(identity.logo.alt || '')
    } : null,
    coverImage: identity.coverImage && typeof identity.coverImage === 'object' ? {
      url: String(identity.coverImage.url || ''),
      alt: String(identity.coverImage.alt || '')
    } : null,
    shortDescription: String(identity.shortDescription || ''),
    fullDescription: String(identity.fullDescription || ''),
    category: String(identity.category || ''),
    status: String(identity.status || 'INACTIVE')
  };
}

function _sanitizeContact(contact) {
  if (!contact || typeof contact !== 'object') return {};
  return {
    phone: String(contact.phone || ''),
    email: String(contact.email || ''),
    website: String(contact.website || ''),
    address: String(contact.address || ''),
    city: String(contact.city || ''),
    region: String(contact.region || ''),
    workingHours: String(contact.workingHours || '')
  };
}

function _sanitizeRefList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const ref = {};
      for (const key of Object.keys(item)) {
        if (key === 'id' || key === 'companyId' || key === 'title' || key === 'description' ||
            key === 'category' || key === 'image' || key === 'thumbnail' || key === 'active' ||
            key === 'displayState' || key === 'summary' || key === 'startDate' || key === 'endDate' ||
            key === 'target' || key === 'source' || key === 'externalRef' || key === 'type' ||
            key === 'url' || key === 'displayStatus' || key === 'cta') {
          ref[key] = item[key];
        }
      }
      return ref;
    });
}

function _sanitizeMediaList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(item => item && typeof item === 'object')
    .map(item => ({
      type: String(item.type || 'image'),
      url: String(item.url || ''),
      thumbnail: String(item.thumbnail || ''),
      title: String(item.title || ''),
      description: String(item.description || ''),
      source: String(item.source || ''),
      externalRef: String(item.externalRef || ''),
      displayStatus: String(item.displayStatus || 'visible')
    }));
}

function _sanitizeSocialChannels(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(item => item && typeof item === 'object')
    .map(item => ({
      provider: String(item.provider || ''),
      handle: String(item.handle || ''),
      url: String(item.url || ''),
      displayStatus: String(item.displayStatus || 'visible')
    }));
}

function getProfile(companyId) {
  if (!companyId || typeof companyId !== 'string') return null;
  const profiles = _toArray(_readStore());
  const found = profiles.find(p => p && String(p.companyId) === companyId);
  if (!found) return null;
  return {
    companyId: String(found.companyId),
    identity: _sanitizeIdentity(found.identity),
    contact: _sanitizeContact(found.contact),
    products: _sanitizeRefList(found.products),
    services: _sanitizeRefList(found.services),
    offers: _sanitizeRefList(found.offers),
    media: _sanitizeMediaList(found.media),
    socialChannels: _sanitizeSocialChannels(found.socialChannels),
    lastUpdated: found.lastUpdated || null
  };
}

function getDefaultProfile(companyId) {
  return _defaultProfile(companyId);
}

function listCompanyIds() {
  return _toArray(_readStore()).map(p => p && p.companyId).filter(Boolean);
}

function getDefaultRegistry() {
  return _defaultRegistry();
}

module.exports = {
  getProfile,
  getDefaultProfile,
  listCompanyIds,
  getDefaultRegistry
};
