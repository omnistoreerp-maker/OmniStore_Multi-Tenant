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
  tierBenefits: {
    bronze: { discountPercent: 0, badge: 'badge-yellow' },
    silver: { discountPercent: 5, badge: 'badge-green' },
    gold: { discountPercent: 10, badge: 'badge-yellow' },
    platinum: { discountPercent: 15, badge: 'badge-blue' }
  }
};

class LoyaltyService {
  constructor() {
    this._mutex = new AsyncMutex();
  }

  async _loadConfig() {
    const cfg = await loyaltyRepo.getConfig();
    return { ...DEFAULT_CONFIG, ...cfg };
  }

  _validateConfig(cfg) {
    const errors = [];
    if (cfg.enabled !== undefined && typeof cfg.enabled !== 'boolean') errors.push('enabled must be boolean');
    if (cfg.earnPerAmount !== undefined && (typeof cfg.earnPerAmount !== 'number' || cfg.earnPerAmount < 1)) errors.push('earnPerAmount must be a number >= 1');
    if (cfg.pointsPerUnit !== undefined && (typeof cfg.pointsPerUnit !== 'number' || cfg.pointsPerUnit < 1)) errors.push('pointsPerUnit must be a number >= 1');
    if (cfg.redeemValue !== undefined && (typeof cfg.redeemValue !== 'number' || cfg.redeemValue <= 0)) errors.push('redeemValue must be a number > 0');
    if (cfg.maxRedeemPercent !== undefined && (typeof cfg.maxRedeemPercent !== 'number' || cfg.maxRedeemPercent < 1)) errors.push('maxRedeemPercent must be a number >= 1');
    if (cfg.birthdayBonusPoints !== undefined && (typeof cfg.birthdayBonusPoints !== 'number' || cfg.birthdayBonusPoints < 0)) errors.push('birthdayBonusPoints must be a number >= 0');
    if (cfg.tierBenefits !== undefined && typeof cfg.tierBenefits !== 'object') errors.push('tierBenefits must be an object');
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

  async getBalance(customerId) {
    const resolved = await this._resolveCustomer(customerId);
    if (resolved.error) return { error: resolved.error };
    const balance = await loyaltyRepo.getBalance(customerId);
    const cfg = await this._loadConfig();
    const reward = this._rewardStatus(balance.points, resolved.customer);
    return { ...balance, tier: reward, config: { maxRedeemPercent: cfg.maxRedeemPercent, redeemValue: cfg.redeemValue, enabled: cfg.enabled } };
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

    return this._mutex.runExclusive(async () => {
      const existing = await loyaltyRepo.getTransactionByRef(refStr, refType, customerId);
      if (existing) {
        return { transaction: existing, duplicate: true };
      }

      const balanceResult = await loyaltyRepo.getBalance(customerId);
      const previousBalance = balanceResult.points;
      const newBalance = previousBalance + safePoints;

      const transaction = {
        id: 'LP-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        tenantId,
        branchId: branchId || null,
        customerId: String(customerId),
        type: 'earn',
        points: safePoints,
        amount: safeAmount,
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

      return { transaction: saved, duplicate: false };
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

      const balanceResult = await loyaltyRepo.getBalance(customerId);
      const previousBalance = balanceResult.points;

      const maxAmountByPercent = safeAmount * (cfg.maxRedeemPercent / 100);
      const amountByPoints = safePoints * cfg.redeemValue;
      const allowedAmount = Math.min(amountByPoints, maxAmountByPercent);
      const normalizedPoints = Math.floor(allowedAmount / cfg.redeemValue);

      if (normalizedPoints <= 0) return { error: 'No points available for redemption' };
      if (normalizedPoints > previousBalance) return { error: 'Insufficient points', balance: previousBalance };

      const newBalance = previousBalance - normalizedPoints;

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

      const balanceResult = await loyaltyRepo.getBalance(customerId);
      const previousBalance = balanceResult.points;
      const newBalance = Math.max(0, previousBalance - points);

      const transaction = {
        id: 'LP-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        tenantId,
        branchId: branchId || null,
        customerId: String(customerId),
        type: 'return_deduct',
        points: -points,
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
        note: 'Ù‡Ø¯ÙŠØ© Ù…ÙŠÙ„Ø§Ø¯',
        userId: userId || null,
        userName: userName || null,
        source: 'admin',
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
    const benefits = (cfg.tierBenefits || DEFAULT_CONFIG.tierBenefits);
    if (points >= 1000) return { code: 'platinum', label: 'Platinum', badge: benefits.platinum?.badge || 'badge-blue', discountPercent: benefits.platinum?.discountPercent || 15 };
    if (points >= 500) return { code: 'gold', label: 'Gold', badge: benefits.gold?.badge || 'badge-yellow', discountPercent: benefits.gold?.discountPercent || 10 };
    if (points >= 150) return { code: 'silver', label: 'Silver', badge: benefits.silver?.badge || 'badge-green', discountPercent: benefits.silver?.discountPercent || 5 };
    return { code: 'bronze', label: 'Bronze', badge: benefits.bronze?.badge || 'badge-yellow', discountPercent: benefits.bronze?.discountPercent || 0 };
  }
}

module.exports = new LoyaltyService();
