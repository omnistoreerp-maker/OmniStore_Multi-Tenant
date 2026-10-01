'use strict';

// Platform Content Catalog — DATA_ENTRY domain for the Platform Control Center.
//
// This is the operational content surface for the DATA_ENTRY platform role.
// It is PLATFORM-scoped and deliberately independent from every tenant store:
// it never reads or writes tenant data and never touches tenant isolation.
//
// Store shape (backend/data/platformContent.json):
//   { entries: [{ id, type, title, body, icon, status,
//                 createdAt, updatedAt, createdBy, updatedBy }] }
//
// The store is fully additive and self-contained; it does NOT alter the public
// platform catalog/homepage (platformPublic) or any tenant catalog. Wiring the
// published entries into a public surface is intentionally left to a future,
// separately-reviewed activation (see the task's DEFERRED register).

const { v4: uuidv4 } = require('uuid');
const storageAdapter = require('../repositories/storageAdapter');

const STORE = 'platformContent';

const CONTENT_TYPES = ['feature', 'highlight', 'banner', 'faq'];
const CONTENT_STATUSES = ['draft', 'published', 'archived'];

function _load() {
  const data = storageAdapter.read(STORE);
  if (data && Array.isArray(data.entries)) return data.entries;
  return [];
}

function _save(entries) {
  return storageAdapter.write(STORE, { entries });
}

function _normalizeType(type) {
  return String(type || '').trim().toLowerCase();
}

function _publicEntry(entry) {
  return {
    id: entry.id,
    type: entry.type,
    title: entry.title,
    body: entry.body,
    icon: entry.icon || null,
    status: entry.status,
    createdAt: entry.createdAt || null,
    updatedAt: entry.updatedAt || null,
    createdBy: entry.createdBy || null,
    updatedBy: entry.updatedBy || null
  };
}

// List content entries. Optional type/status filters come from the caller but
// are validated against the known sets (unknown values simply match nothing).
function list(query) {
  const q = query || {};
  let entries = _load();
  if (q.type) entries = entries.filter(e => e.type === _normalizeType(q.type));
  if (q.status) entries = entries.filter(e => e.status === String(q.status).toLowerCase());
  entries = entries.slice().sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  return entries.map(_publicEntry);
}

function getById(id) {
  const entry = _load().find(e => e && String(e.id) === String(id));
  return entry ? _publicEntry(entry) : null;
}

// Create a content entry. `actor` is the server-resolved platform identity.
function create(actor, data) {
  const title = String((data && data.title) || '').trim();
  if (!title) return { error: 'title is required', status: 400 };
  const type = _normalizeType((data && data.type) || 'feature');
  if (!CONTENT_TYPES.includes(type)) {
    return { error: 'type must be one of ' + CONTENT_TYPES.join(', '), status: 400 };
  }
  const status = String((data && data.status) || 'draft').toLowerCase();
  if (!CONTENT_STATUSES.includes(status)) {
    return { error: 'status must be one of ' + CONTENT_STATUSES.join(', '), status: 400 };
  }

  const now = new Date().toISOString();
  const entry = {
    id: uuidv4(),
    type,
    title,
    body: String((data && data.body) || '').trim(),
    icon: (data && data.icon) ? String(data.icon).trim() : null,
    status,
    createdAt: now,
    updatedAt: now,
    createdBy: actor ? actor.username : null,
    updatedBy: actor ? actor.username : null
  };
  const entries = _load();
  entries.push(entry);
  _save(entries);
  return { ok: true, entry: _publicEntry(entry) };
}

// Update a content entry (partial). Never changes id/createdAt/createdBy.
function update(actor, id, data) {
  const entries = _load();
  const idx = entries.findIndex(e => e && String(e.id) === String(id));
  if (idx === -1) return { error: 'Content entry not found', status: 404 };
  const entry = entries[idx];

  if (data && data.title !== undefined) {
    const title = String(data.title).trim();
    if (!title) return { error: 'title must not be empty', status: 400 };
    entry.title = title;
  }
  if (data && data.body !== undefined) entry.body = String(data.body).trim();
  if (data && data.icon !== undefined) entry.icon = data.icon ? String(data.icon).trim() : null;
  if (data && data.type !== undefined) {
    const type = _normalizeType(data.type);
    if (!CONTENT_TYPES.includes(type)) {
      return { error: 'type must be one of ' + CONTENT_TYPES.join(', '), status: 400 };
    }
    entry.type = type;
  }
  if (data && data.status !== undefined) {
    const status = String(data.status).toLowerCase();
    if (!CONTENT_STATUSES.includes(status)) {
      return { error: 'status must be one of ' + CONTENT_STATUSES.join(', '), status: 400 };
    }
    entry.status = status;
  }
  entry.updatedAt = new Date().toISOString();
  entry.updatedBy = actor ? actor.username : null;
  entries[idx] = entry;
  _save(entries);
  return { ok: true, entry: _publicEntry(entry) };
}

function remove(id) {
  const entries = _load();
  const idx = entries.findIndex(e => e && String(e.id) === String(id));
  if (idx === -1) return { error: 'Content entry not found', status: 404 };
  const removed = entries.splice(idx, 1)[0];
  _save(entries);
  return { ok: true, entry: _publicEntry(removed) };
}

module.exports = {
  CONTENT_TYPES,
  CONTENT_STATUSES,
  list,
  getById,
  create,
  update,
  remove
};