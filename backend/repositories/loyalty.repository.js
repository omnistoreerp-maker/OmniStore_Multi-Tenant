'use strict';

// Loyalty repository.
// - Tenant-scoped read/write through BaseRepository tenant accessor.
// - Transaction collection: `loyalty` store -> { transactions: [], configs: {} }.
// - Ledger is authoritative; balance is derived, never stored in a separate
//   balance document.

const BaseRepository = require('./BaseRepository');
const tenantStore = require('../middleware/tenantStore');

const DEFAULT_CONFIG = {
  enabled: true,
  earnPerAmount: 100,
  pointsPerUnit: 1,
  redeemValue: 1,
  maxRedeemPercent: 20
};

class LoyaltyRepository {
  constructor() {
    this.repo = new BaseRepository('loyalty', tenantStore.createAccessor());
  }

  async _load() {
    const db = await this.repo.readAsync();
    if (!db || typeof db !== 'object') return { transactions: [], configs: {} };
    if (!Array.isArray(db.transactions)) db.transactions = [];
    if (!db.configs || typeof db.configs !== 'object') db.configs = {};
    return db;
  }

  async _save(db) {
    return this.repo.writeAsync(db);
  }

  _tenantId() {
    return this.repo._currentTenantId();
  }

  _isVisible(record) {
    if (record == null || typeof record !== 'object') return false;
    if (record.tenantId === undefined || record.tenantId === null || record.tenantId === '') return true;
    const current = this._tenantId();
    return current == null || String(record.tenantId) === String(current);
  }

  _filter(arr) {
    if (!Array.isArray(arr)) return [];
    const tenantId = this._tenantId();
    if (tenantId == null) return arr;
    return arr.filter(r => {
      if (!r || typeof r !== 'object') return true;
      if (r.tenantId === undefined || r.tenantId === null || r.tenantId === '') return true;
      return String(r.tenantId) === String(tenantId);
    });
  }

  async listTransactions({ customerId, type, ref, refType, startDate, endDate, page = 1, limit = 50 } = {}) {
    const db = await this._load();
    let transactions = this._filter(db.transactions || []);

    if (customerId) {
      transactions = transactions.filter(t => String(t.customerId) === String(customerId));
    }
    if (type) {
      transactions = transactions.filter(t => t.type === type);
    }
    if (ref) {
      transactions = transactions.filter(t => t.ref === ref);
    }
    if (refType) {
      transactions = transactions.filter(t => t.refType === refType);
    }
    if (startDate) {
      const start = new Date(startDate);
      transactions = transactions.filter(t => new Date(t.createdAt || 0) >= start);
    }
    if (endDate) {
      const end = new Date(endDate);
      transactions = transactions.filter(t => new Date(t.createdAt || 0) <= end);
    }

    transactions.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    const total = transactions.length;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const startIndex = (pageNum - 1) * limitNum;
    const paginated = transactions.slice(startIndex, startIndex + limitNum);

    return { transactions: paginated, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) || 1 };
  }

  async getBalance(customerId) {
    const db = await this._load();
    const transactions = this._filter(db.transactions || []).filter(t => String(t.customerId) === String(customerId));
    const balance = transactions.reduce((sum, t) => sum + (Number(t.points) || 0), 0);
    return { customerId, points: Math.max(0, balance), transactionCount: transactions.length };
  }

  async getTransactionByRef(ref, refType, customerId) {
    const db = await this._load();
    const transactions = this._filter(db.transactions || []);
    return transactions.find(t => t.ref === ref && t.refType === refType && String(t.customerId) === String(customerId)) || null;
  }

  async getReversalForReturn(returnId, customerId) {
    const db = await this._load();
    const transactions = this._filter(db.transactions || []);
    return transactions.find(t => t.ref === returnId && t.type === 'return_deduct' && String(t.customerId) === String(customerId)) || null;
  }

  async appendTransaction(transaction) {
    const db = await this._load();
    if (!Array.isArray(db.transactions)) db.transactions = [];
    db.transactions.unshift(transaction);
    const result = await this._save(db);
    if (!result) return null;
    return transaction;
  }

  async getConfig() {
    const db = await this._load();
    const tenantId = this._tenantId();
    if (tenantId && db.configs[tenantId]) return db.configs[tenantId];
    return { ...DEFAULT_CONFIG };
  }

  async saveConfig(config) {
    const db = await this._load();
    const tenantId = this._tenantId();
    if (!tenantId) return { error: 'No tenant context' };
    db.configs[tenantId] = { ...(db.configs[tenantId] || {}), ...config };
    const result = await this._save(db);
    if (!result) return null;
    return db.configs[tenantId];
  }

  async getMetrics() {
    const db = await this._load();
    const transactions = this._filter(db.transactions || []);
    const byType = transactions.reduce((acc, t) => {
      const key = t.type || 'unknown';
      acc[key] = (acc[key] || 0) + (Number(t.points) || 0);
      return acc;
    }, {});

    const customerIds = new Set(transactions.map(t => t.customerId).filter(Boolean));
    const issued = byType['earn'] || 0;
    const redeemed = Math.abs(byType['redeem'] || 0);
    const returned = Math.abs(byType['return_deduct'] || 0);
    const adjusted = Math.abs(byType['adjustment'] || 0);
    const bonus = byType['bonus'] || 0;
    const outstanding = Math.max(0, issued - redeemed - returned + adjusted + bonus);
    const now = new Date();
    const expired = transactions
      .filter(t => (t.type === 'earn' || t.type === 'bonus') && t.expiresAt && new Date(t.expiresAt) <= now)
      .reduce((sum, t) => sum + (Number(t.points) || 0), 0);

    const tierDistribution = { bronze: 0, silver: 0, gold: 0, platinum: 0 };
    for (const cid of customerIds) {
      const bal = await this.getBalance(cid);
      const pts = bal.points || 0;
      if (pts >= 1000) tierDistribution.platinum++;
      else if (pts >= 500) tierDistribution.gold++;
      else if (pts >= 150) tierDistribution.silver++;
      else tierDistribution.bronze++;
    }

    return {
      totalIssued: issued,
      totalRedeemed: redeemed,
      totalReturned: returned,
      totalAdjusted: adjusted,
      totalBonus: bonus,
      expiredPoints: expired,
      outstandingLiability: outstanding,
      activeCustomerCount: customerIds.size,
      transactionCount: transactions.length,
      tierDistribution
    };
  }
}

module.exports = new LoyaltyRepository();
