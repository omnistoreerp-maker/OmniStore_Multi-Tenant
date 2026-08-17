const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const repository = require('../repositories').products;

class InventoryService {
  async _load() {
    const db = await repository.readAsync();
    if (!db || typeof db !== 'object') return { products: [] };
    if (!Array.isArray(db.products)) db.products = [];
    return db;
  }
  async _save(db) { return repository.writeAsync(db); }

  // FULL, unfiltered store document for WRITES (BaseRepository._rawStore
  // rule): a write must never persist a tenant-filtered snapshot that could
  // drop other tenants' records from the shared document. Products are
  // GLOBAL (no tenantId) so this is a no-op safety net today, kept for the
  // same reason Customers uses it.
  async _loadRaw() {
    const db = await repository._rawStoreAsync();
    if (!db || typeof db !== 'object') return { products: [] };
    if (!Array.isArray(db.products)) db.products = [];
    return db;
  }

  _validateRequired(data, forCreate) {
    const errors = [];
    if (forCreate && (data.name === undefined || String(data.name).trim() === '')) errors.push('name is required');
    if (data.name !== undefined && typeof data.name !== 'string') errors.push('name must be a string');
    if (data.buyPrice !== undefined && typeof data.buyPrice !== 'number') errors.push('buyPrice must be a number');
    if (data.sellPrice !== undefined && typeof data.sellPrice !== 'number') errors.push('sellPrice must be a number');
    if (data.stockQty !== undefined && typeof data.stockQty !== 'number') errors.push('stockQty must be a number');
    return errors;
  }

  _normalizeId(id) {
    return String(id).trim();
  }

  _matchesId(product, normalized) {
    return this._normalizeId(product.id) === normalized || this._normalizeId(product._backendId || '') === normalized;
  }

  async list(query = {}) {
    const db = await this._load();
    let products = db.products || [];

    if (query.search || query.name) {
      const q = String(query.search || query.name).toLowerCase();
      products = products.filter(p => (p.name || '').toLowerCase().includes(q) || String(p.sku || '').toLowerCase().includes(q) || String(p.barcode || '').toLowerCase().includes(q));
    }
    if (query.categoryId !== undefined && query.categoryId !== '') {
      products = products.filter(p => String(p.categoryId) === String(query.categoryId));
    }
    if (query.brandId !== undefined && query.brandId !== '') {
      products = products.filter(p => String(p.brandId) === String(query.brandId));
    }
    if (query.hasSerial !== undefined && query.hasSerial !== '') {
      const want = String(query.hasSerial) === 'true';
      products = products.filter(p => !!(p.hasSerial || p.serial_tracking) === want);
    }

    const sortBy = query.sortBy || 'name';
    const sortOrder = query.sortOrder === 'desc' ? -1 : 1;
    products.sort((a, b) => {
      let va = a[sortBy], vb = b[sortBy];
      if (sortBy === 'createdAt' || sortBy === 'updatedAt') {
        va = new Date(va || 0).getTime();
        vb = new Date(vb || 0).getTime();
      } else if (sortBy === 'buyPrice' || sortBy === 'sellPrice' || sortBy === 'stockQty' || sortBy === 'id') {
        va = Number(va) || 0;
        vb = Number(vb) || 0;
      } else {
        va = String(va || '').toLowerCase();
        vb = String(vb || '').toLowerCase();
      }
      return va < vb ? -sortOrder : va > vb ? sortOrder : 0;
    });

    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
    const total = products.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const paginated = products.slice(start, start + limit);

    return { products: paginated, total, page, limit, totalPages };
  }

  async getById(id) {
    const db = await this._load();
    const normalized = this._normalizeId(id);
    return (db.products || []).find(p => this._matchesId(p, normalized)) || null;
  }

  async stats() {
    const db = await this._load();
    const products = db.products || [];
    const categories = new Set();
    const brands = new Set();
    let serialized = 0;
    products.forEach(p => {
      if (p.categoryId !== undefined && p.categoryId !== null) categories.add(String(p.categoryId));
      if (p.brandId !== undefined && p.brandId !== null) brands.add(String(p.brandId));
      if (p.hasSerial || p.serial_tracking) serialized++;
    });
    return { count: products.length, serialized, categories: categories.size, brands: brands.size };
  }

  async create(data) {
    const errors = this._validateRequired(data, true);
    if (errors.length) return { error: errors.join('; ') };

    const db = await this._loadRaw();
    const product = {
      id: data.id !== undefined && data.id !== null ? data.id : uuidv4(),
      ...data,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const normalized = this._normalizeId(product.id);
    if ((db.products || []).some(p => this._normalizeId(p.id) === normalized)) {
      return { error: 'Duplicate product ID: ' + product.id };
    }

    if (!Array.isArray(db.products)) db.products = [];
    db.products.push(product);
    if (await this._save(db)) return { product };
    return { error: 'Failed to persist product' };
  }

  async update(id, data) {
    const db = await this._loadRaw();
    const normalized = this._normalizeId(id);
    const idx = (db.products || []).findIndex(p => this._matchesId(p, normalized));
    if (idx === -1) return { error: 'Product not found' };

    const errors = this._validateRequired(data, false);
    if (errors.length) return { error: errors.join('; ') };

    db.products[idx] = { ...db.products[idx], ...data, id: db.products[idx].id, updatedAt: new Date().toISOString() };
    if (await this._save(db)) return { product: db.products[idx] };
    return { error: 'Failed to persist update' };
  }

  async delete(id) {
    const db = await this._loadRaw();
    const normalized = this._normalizeId(id);
    const idx = (db.products || []).findIndex(p => this._matchesId(p, normalized));
    if (idx === -1) return { error: 'Product not found' };
    db.products.splice(idx, 1);
    if (await this._save(db)) return { success: true };
    return { error: 'Failed to persist deletion' };
  }
}

module.exports = new InventoryService();
