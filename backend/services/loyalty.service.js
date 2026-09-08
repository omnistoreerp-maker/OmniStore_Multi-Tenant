'use strict';

// Loyalty service.
// - Backend-authoritative ledger for loyalty transactions.
// - customer.points in localStorage is NOT modified here.
// - Tenant-scoped; branchId is provenance only.

const AsyncMutex = require('../utils/asyncMutex');
const loyaltyRepo = require('../repositories/loyalty.repository');
const customersService = require('../services/customers.service');
const { success, error } = require('../utils/apiResponse');

const DEFAULT_CONFIG = {
  enabled: true,
  earnPerAmount: 100,
  pointsPerUnit: 1,
  redeemValue: 1,
  maxRedeemPercent: 20,
  birthdayBonusPoints: 50,
  expiryEnabled: false,
  defaultExpiryDays: 365,
  tierExpiryOverrides: {},
  tierBenefits: {
    bronze: { discountPercent: 0, badge: 'badge-yellow', earnMultiplier: 1, redeemLimitPercent: 100, expiryDays: 365 },
    silver: { discountPercent: 5, badge: 'badge-green', earnMultiplier: 1, redeemLimitPercent: 100, expiryDays: 365 },
    gold: { discountPercent: 10, badge: 'badge-yellow', earnMultiplier: 1.2, redeemLimitPercent: 100, expiryDays: 540 },
    platinum: { discountPercent: 15, badge: 'badge-blue', earnMultiplier: 1.5, redeemLimitPercent: 100, expiryDays: 730 }
  }
};

class LoyaltyService {
  constructor() {
    this._mutex = new AsyncMutex();
  }

  async _loadConfig() {
    const cfg = await loyaltyRepo.getConfig();
    this._cfg = { ...DEFAULT_CONFIG, ...cfg };
    return this._cfg;
  }

  _validateConfig(cfg) {
    const errors = [];
    if (cfg.enabled !== undefined && typeof cfg.enabled !== 'boolean') errors.push('enabled must be boolean');
    if (cfg.earnPerAmount !== undefined && (typeof cfg.earnPerAmount !== 'number' || cfg.earnPerAmount < 1)) errors.push('earnPerAmount must be a number >= 1');
    if (cfg.pointsPerUnit !== undefined && (typeof cfg.pointsPerUnit !== 'number' || cfg.pointsPerUnit < 1)) errors.push('pointsPerUnit must be a number >= 1');
    if (cfg.redeemValue !== undefined && (typeof cfg.redeemValue !== 'number' || cfg.redeemValue <= 0)) errors.push('redeemValue must be a number > 0');
    if (cfg.maxRedeemPercent !== undefined && (typeof cfg.maxRedeemPercent !== 'number' || cfg.maxRedeemPercent < 1)) errors.push('maxRedeemPercent must be a number >= 1');
    if (cfg.birthdayBonusPoints !== undefined && (typeof cfg.birthdayBonusPoints !== 'number' || cfg.birthdayBonusPoints < 0)) errors.push('birthdayBonusPoints must be a number >= 0');
    if (cfg.expiryEnabled !== undefined && typeof cfg.expiryEnabled !== 'boolean') errors.push('expiryEnabled must be boolean');
    if (cfg.defaultExpiryDays !== undefined && (typeof cfg.defaultExpiryDays !== 'number' || cfg.defaultExpiryDays < 1)) errors.push('defaultExpiryDays must be a number >= 1');
    if (cfg.tierBenefits !== undefined && typeof cfg.tierBenefits !== 'object') errors.push('tierBenefits must be an object');
    if (cfg.tierExpiryOverrides !== undefined && typeof cfg.tierExpiryOverrides !== 'object') errors.push('tierExpiryOverrides must be an object');
    return errors;
  }

  async getConfig() {
    return this._loadConfig();
  }

  async updateConfig(update) {
    const errors = this._validateConfig(update);
    if (errors.length) return { error: errors.join(', ') };
    const cfg = await loyaltyRepo.saveConfig(update);
    if (!cfg) return { error: 'Failed to save config' };
    return { config: cfg };
  }

  async _resolveCustomer(customerId) {
    const customer = await customersService.getById(customerId);
    if (!customer) return { error: 'Customer not found' };
    return { customer };
  }

  _tenantId() {
    return loyaltyRepo._tenantId();
  }

  _tierForPoints(points) {
    const cfg = this._cfg || DEFAULT_CONFIG;
    const benefits = cfg.tierBenefits || DEFAULT_CONFIG.tierBenefits;
    if (points >= 1000) return { code: 'platinum', ...benefits.platinum };
    if (points >= 500) return { code: 'gold', ...benefits.gold };
    if (points >= 150) return { code: 'silver', ...benefits.silver };
    return { code: 'bronze', ...benefits.bronze };
  }

  _earnMultiplierForTier(tierCode) {
    const cfg = this._cfg || DEFAULT_CONFIG;
    const benefits = cfg.tierBenefits || DEFAULT_CONFIG.tierBenefits;
    const tier = benefits[tierCode] || benefits.bronze || {};
    return Number(tier.earnMultiplier) || 1;
  }

  _expiryDaysForTier(tierCode) {
    const cfg = this._cfg || DEFAULT_CONFIG;
    if (cfg.tierExpiryOverrides && tierCode in cfg.tierExpiryOverrides) {
      return Number(cfg.tierExpiryOverrides[tierCode]) || cfg.defaultExpiryDays;
    }
    const benefits = cfg.tierBenefits || DEFAULT_CONFIG.tierBenefits;
    const tier = benefits[tierCode] || benefits.bronze || {};
    return Number(tier.expiryDays) || cfg.defaultExpiryDays || 365;
  }

  _computeExpiresAt(earnedAt, tierCode) {
    const cfg = this._cfg || DEFAULT_CONFIG;
    if (!cfg.expiryEnabled) return null;
    const days = this._expiryDaysForTier(tierCode);
    const d = new Date(earnedAt);
    d.setDate(d.getDate() + days);
    return d.toISOString();
  }

  _isExpired(transaction) {
    if (!transaction.expiresAt) return false;
    return new Date(transaction.expiresAt) <= new Date();
  }

  async getBalance(customerId) {
    const resolved = await this._resolveCustomer(customerId);
    if (resolved.error) return { error: resolved.error };
    const balance = await loyaltyRepo.getBalance(customerId);
    const cfg = await this._loadConfig();
    const reward = this._rewardStatus(balance.points, resolved.customer);
    const transactions = await loyaltyRepo.listTransactions({ customerId });
    const now = new Date();
    const expiredPoints = transactions.transactions
      .filter(t => t.type === 'earn' || t.type === 'bonus')
      .filter(t => t.expiresAt && new Date(t.expiresAt) <= now)
      .reduce((sum, t) => sum + (Number(t.points) || 0), 0);
    const availablePoints = Math.max(0, balance.points - expiredPoints);
    const nextExpiry = transactions.transactions
      .filter(t => (t.type === 'earn' || t.type === 'bonus') && t.expiresAt && new Date(t.expiresAt) > now)
      .sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt))[0]?.expiresAt || null;
    return {
      ...balance,
      points: availablePoints,
      expiredPoints,
      totalEarned: balance.points + expiredPoints,
      nextExpiry,
      tier: reward,
      config: { maxRedeemPercent: cfg.maxRedeemPercent, redeemValue: cfg.redeemValue, enabled: cfg.enabled, expiryEnabled: cfg.expiryEnabled, defaultExpiryDays: cfg.defaultExpiryDays }
    };
  }

  async getTransactions(customerId, query = {}) {
    const resolved = await this._resolveCustomer(customerId);
    if (resolved.error) return { error: resolved.error };
    return loyaltyRepo.listTransactions({ customerId, ...query });
  }

  async getMetrics() {
    return loyaltyRepo.getMetrics();
  }

  async earn({ customerId, points, amount, ref, refType = 'sale', note, branchId, source = 'pos', userId, userName }) {
    const cfg = await this._loadConfig();
    if (!cfg.enabled) return { error: 'Loyalty is disabled' };

    const resolved = await this._resolveCustomer(customerId);
    if (resolved.error) return { error: resolved.error };

    const safePoints = Math.max(0, parseInt(points, 10) || 0);
    if (safePoints <= 0) return { error: 'points must be > 0' };

    const safeAmount = Math.max(0, parseFloat(amount) || 0);
    const refStr = String(ref || '').trim();
    if (!refStr) return { error: 'ref is required' };

    const tenantId = this._tenantId();
    const tier = this._tierForPoints(resolved.customer?.points || 0);
    const multiplier = this._earnMultiplierForTier(tier.code);
    const earnedPoints = Math.max(1, Math.round(safePoints * multiplier));
    const expiresAt = this._computeExpiresAt(new Date().toISOString(), tier.code);

    return this._mutex.runExclusive(async () => {
      const existing = await loyaltyRepo.getTransactionByRef(refStr, refType, customerId);
      if (existing) {
        return { transaction: existing, duplicate: true };
      }

      const balanceResult = await loyaltyRepo.getBalance(customerId);
      const previousBalance = balanceResult.points;
      const newBalance = previousBalance + earnedPoints;

      const transaction = {
        id: 'LP-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        tenantId,
        branchId: branchId || null,
        customerId: String(customerId),
        type: 'earn',
        points: earnedPoints,
        amount: safeAmount,
        balanceAfter: newBalance,
        ref: refStr,
        refType,
        note: note || '',
        userId: userId || null,
        userName: userName || null,
        source: source || 'pos',
        expiresAt,
        tier: tier.code,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const saved = await loyaltyRepo.appendTransaction(transaction);
      if (!saved) return { error: 'Failed to save transaction' };

      return { transaction: saved, duplicate: false, appliedMultiplier: multiplier, earnedPoints };
    });
  }

  async redeem({ customerId, points, amount, ref, refType = 'manual', note, branchId, source = 'pos', userId, userName }) {
    const cfg = await this._loadConfig();
    if (!cfg.enabled) return { error: 'Loyalty is disabled' };

    const resolved = await this._resolveCustomer(customerId);
    if (resolved.error) return { error: resolved.error };

    const safePoints = Math.max(0, parseInt(points, 10) || 0);
    if (safePoints <= 0) return { error: 'points must be > 0' };

    const safeAmount = Math.max(0, parseFloat(amount) || 0);
    const refStr = String(ref || '').trim();
    if (!refStr) return { error: 'ref is required' };

    const tenantId = this._tenantId();

    return this._mutex.runExclusive(async () => {
      const existing = await loyaltyRepo.getTransactionByRef(refStr, refType, customerId);
      if (existing) {
        return { transaction: existing, duplicate: true };
      }

      const allTx = await loyaltyRepo.listTransactions({ customerId });
      const now = new Date();
      const nonExpiredEarns = allTx.transactions
        .filter(t => (t.type === 'earn' || t.type === 'bonus') && (!t.expiresAt || new Date(t.expiresAt) > now))
        .sort((a, b) => new Date(a.expiresAt || '9999-12-31') - new Date(b.expiresAt || '9999-12-31'));

      const availablePoints = nonExpiredEarns.reduce((sum, t) => sum + (Number(t.points) || 0), 0);

      const maxAmountByPercent = safeAmount * (cfg.maxRedeemPercent / 100);
      const amountByPoints = safePoints * cfg.redeemValue;
      const allowedAmount = Math.min(amountByPoints, maxAmountByPercent);
      const normalizedPoints = Math.floor(allowedAmount / cfg.redeemValue);

      if (normalizedPoints <= 0) return { error: 'No points available for redemption' };
      if (normalizedPoints > availablePoints) return { error: 'Insufficient points', balance: availablePoints };

      const newBalance = Math.max(0, availablePoints - normalizedPoints);

      const transaction = {
        id: 'LP-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        tenantId,
        branchId: branchId || null,
        customerId: String(customerId),
        type: 'redeem',
        points: -normalizedPoints,
        amount: allowedAmount,
        balanceAfter: newBalance,
        ref: refStr,
        refType,
        note: note || '',
        userId: userId || null,
        userName: userName || null,
        source: source || 'pos',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const saved = await loyaltyRepo.appendTransaction(transaction);
      if (!saved) return { error: 'Failed to save transaction' };

      return { transaction: saved, duplicate: false, balance: newBalance };
    });
  }

  async reverse({ customerId, originalSaleId, returnId, refundAmount, note, branchId, userId, userName }) {
    const cfg = await this._loadConfig();
    if (!cfg.enabled) return { error: 'Loyalty is disabled' };

    const resolved = await this._resolveCustomer(customerId);
    if (resolved.error) return { error: resolved.error };

    const saleRef = String(originalSaleId || '').trim();
    const returnRef = String(returnId || '').trim();
    if (!saleRef || !returnRef) return { error: 'originalSaleId and returnId are required' };

    const safeRefund = Math.max(0, parseFloat(refundAmount) || 0);
    if (safeRefund <= 0) return { error: 'refundAmount must be > 0' };

    const tenantId = this._tenantId();

    return this._mutex.runExclusive(async () => {
      const existingReversal = await loyaltyRepo.getReversalForReturn(returnRef, customerId);
      if (existingReversal) {
        return { transaction: existingReversal, duplicate: true };
      }

      const points = Math.floor((safeRefund / cfg.earnPerAmount) * cfg.pointsPerUnit);
      if (points <= 0) return { error: 'No points to reverse' };

      const allTx = await loyaltyRepo.listTransactions({ customerId });
      const now = new Date();
      const nonExpiredEarns = allTx.transactions
        .filter(t => (t.type === 'earn' || t.type === 'bonus') && (!t.expiresAt || new Date(t.expiresAt) > now))
        .sort((a, b) => new Date(a.expiresAt || '9999-12-31') - new Date(b.expiresAt || '9999-12-31'));

      const availablePoints = nonExpiredEarns.reduce((sum, t) => sum + (Number(t.points) || 0), 0);
      const deductPoints = Math.min(points, availablePoints);
      const newBalance = Math.max(0, availablePoints - deductPoints);

      const transaction = {
        id: 'LP-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        tenantId,
        branchId: branchId || null,
        customerId: String(customerId),
        type: 'return_deduct',
        points: -deductPoints,
        amount: safeRefund,
        balanceAfter: newBalance,
        ref: returnRef,
        refType: 'return',
        note: note || 'خصم نقاط بسبب مرتجع بيع',
        userId: userId || null,
        userName: userName || null,
        source: 'return',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const saved = await loyaltyRepo.appendTransaction(transaction);
      if (!saved) return { error: 'Failed to save transaction' };

      return { transaction: saved, duplicate: false, balance: newBalance };
    });
  }

  async awardBirthdayBonus(customerId, { branchId, userId, userName } = {}) {
    const cfg = await this._loadConfig();
    if (!cfg.enabled) return { error: 'Loyalty is disabled' };

    const resolved = await this._resolveCustomer(customerId);
    if (resolved.error) return { error: resolved.error };

    const customer = resolved.customer;
    const birthDate = customer.birthDate || customer.birthday || customer.dob || null;
    if (!birthDate) return { error: 'Customer has no birth date' };

    const today = new Date();
    const birth = new Date(birthDate);
    const isBirthday = today.getMonth() === birth.getMonth() && today.getDate() === birth.getDate();

    if (!isBirthday) return { error: 'Today is not the customer\'s birthday' };

    const bonusPoints = parseInt(cfg.birthdayBonusPoints, 10) || 0;
    if (bonusPoints <= 0) return { error: 'Birthday bonus is not configured' };

    const tenantId = this._tenantId();
    const refStr = `birthday-${customerId}-${today.getFullYear()}`;

    return this._mutex.runExclusive(async () => {
      const existing = await loyaltyRepo.getTransactionByRef(refStr, 'birthday_bonus', customerId);
      if (existing) {
        return { transaction: existing, duplicate: true };
      }

      const balanceResult = await loyaltyRepo.getBalance(customerId);
      const previousBalance = balanceResult.points;
      const newBalance = previousBalance + bonusPoints;

      const transaction = {
        id: 'LP-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        tenantId,
        branchId: branchId || null,
        customerId: String(customerId),
        type: 'bonus',
        points: bonusPoints,
        amount: 0,
        balanceAfter: newBalance,
        ref: refStr,
        refType: 'birthday_bonus',
        note: 'هدية عيد الميلاد',
        userId: userId || null,
        userName: userName || null,
        source: 'admin',
        expiresAt: this._computeExpiresAt(new Date().toISOString(), 'bronze'),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const saved = await loyaltyRepo.appendTransaction(transaction);
      if (!saved) return { error: 'Failed to save transaction' };

      return { transaction: saved, duplicate: false, balance: newBalance };
    });
  }

  _rewardStatus(points, customer) {
    const cfg = this._cfg || DEFAULT_CONFIG;
    const benefits = cfg.tierBenefits || DEFAULT_CONFIG.tierBenefits;
    const tier = this._tierForPoints(points);
    const benefit = benefits[tier.code] || benefits.bronze || {};
    return {
      code: tier.code,
      label: tier.label,
      badge: benefit.badge || tier.badge || 'badge-yellow',
      discountPercent: benefit.discountPercent || 0,
      earnMultiplier: benefit.earnMultiplier || 1,
      redeemLimitPercent: benefit.redeemLimitPercent || 100,
      expiryDays: benefit.expiryDays || cfg.defaultExpiryDays || 365
    };
  }
}

module.exports = new LoyaltyService();
