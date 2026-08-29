const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const BaseRepository = require('../repositories/BaseRepository');
const inventoryRepository = require('../repositories').products;
const txRepository = new BaseRepository('inventoryTransactions');
const orderRepository = new BaseRepository('marketOrders');
const salesService = require('../services/sales.service');
const marketConfigService = require('./marketConfig.service');
const marketAuthService = require('./marketAuth.service');
const { stockLock } = require('../utils/asyncLock');
const logger = require('../utils/logger');

function _round(n) {
  return Math.round(n * 100) / 100;
}

function _projectOrder(order) {
  return {
    id: order.id,
    orderCode: order.orderCode,
    trackingToken: order.trackingToken,
    tenantId: order.tenantId,
    customerId: order.customerId,
    items: order.items,
    subtotal: order.subtotal,
    discount: order.discount,
    shippingFee: order.shippingFee,
    total: order.total,
    couponCode: order.couponCode,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    status: order.status,
    shippingAddress: order.shippingAddress,
    saleId: order.saleId,
    createdAt: order.createdAt
  };
}

async function _findByIdempotency(tenantId, key) {
  const db = await orderRepository._rawStoreAsync();
  return (db.orders || []).find(
    (o) => String(o.tenantId) === String(tenantId) && o.idempotencyKey === key
  ) || null;
}

async function processCheckout(input) {
  const {
    tenantId,
    items,
    shippingZoneId,
    paymentMethodId,
    couponCode,
    customerId,
    idempotencyKey,
    shippingAddress,
    customerInfo
  } = input;

  const cfg = marketConfigService.get(tenantId);
  if (!cfg || !cfg.enabled) return { error: 'Market unavailable for tenant', status: 404 };

  if (!Array.isArray(items) || items.length === 0) return { error: 'items are required', status: 400 };

  const cleanItems = [];
  for (const it of items) {
    const productId = String(it.productId || '').trim();
    const qty = Number(it.qty);
    if (!productId) return { error: 'productId is required', status: 400 };
    if (!Number.isInteger(qty) || qty < 1) return { error: 'qty must be a positive integer', status: 400 };
    cleanItems.push({ productId, qty });
  }

  if (idempotencyKey) {
    const existing = await _findByIdempotency(tenantId, idempotencyKey);
    if (existing) return { order: _projectOrder(existing), idempotent: true };
  }

  let customer = null;
  if (customerId) {
    customer = marketAuthService.getById(customerId);
    if (!customer || String(customer.tenantId) !== String(tenantId)) {
      return { error: 'Invalid customer', status: 403 };
    }
  }

  const release = await stockLock.acquire();
  try {
    const db = await inventoryRepository._rawStoreAsync();
    const products = Array.isArray(db.products) ? db.products : [];
    const byId = new Map();
    const orderLines = [];
    let subtotal = 0;

    for (const ci of cleanItems) {
      const p = products.find((x) => String(x.id) === ci.productId);
      if (!p) return { error: 'Product not found: ' + ci.productId, status: 404 };
      const stock = Number(p.stockQty) || 0;
      if (stock < ci.qty) return { error: 'Insufficient stock for ' + (p.name || ci.productId), status: 409 };
      const price = marketConfigService.priceFor(p, cfg);
      byId.set(ci.productId, p);
      orderLines.push({
        productId: ci.productId,
        name: p.name,
        qty: ci.qty,
        unitPrice: price,
        lineTotal: _round(price * ci.qty)
      });
      subtotal += price * ci.qty;
    }
    subtotal = _round(subtotal);

    const coupon = couponCode ? marketConfigService.resolveCoupon(cfg, String(couponCode), subtotal) : null;
    const discount = coupon ? coupon.discount : 0;

    const shipping = marketConfigService.resolveShipping(cfg, shippingZoneId, subtotal);
    const shippingFee = shipping ? shipping.fee : 0;

    const payment = marketConfigService.resolvePayment(cfg, paymentMethodId);
    if (!payment) return { error: 'Invalid payment method', status: 400 };

    const total = _round(subtotal - discount + shippingFee);
    if (total < 0) return { error: 'Invalid order total', status: 400 };

    for (const ci of cleanItems) {
      const p = byId.get(ci.productId);
      p.stockQty = (Number(p.stockQty) || 0) - ci.qty;
    }
    await inventoryRepository.writeAsync(db);

    const txDb = await txRepository._rawStoreAsync();
    if (!txDb.transactions) txDb.transactions = [];
    for (const ci of cleanItems) {
      const p = byId.get(ci.productId);
      txDb.transactions.push({
        id: uuidv4(),
        productId: ci.productId,
        type: 'out',
        qty: ci.qty,
        stockAfter: Number(p.stockQty) || 0,
        user: 'market',
        reason: 'market-checkout',
        tenantId: String(tenantId),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    await txRepository.writeAsync(txDb);

    const invoice = {
      id: 'MKT-' + Date.now().toString().slice(-6) + '-' + uuidv4().slice(0, 4),
      items: orderLines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, price: l.unitPrice })),
      total,
      subtotal,
      discount,
      shippingFee,
      customer: customer ? customer.name : (customerInfo && customerInfo.name) || 'Market Guest',
      customerId: customer ? customer.id : null,
      email: customer ? customer.email : (customerInfo && customerInfo.email) || null,
      payment: payment.id,
      paymentType: payment.type,
      invoiceType: 'market',
      tenantId: String(tenantId),
      status: 'pending',
      date: new Date().toISOString()
    };
    const saleRes = await salesService.create(invoice, { tenantId: String(tenantId) });
    if (saleRes.error) return { error: saleRes.error, status: 400 };

    const orderCode = 'ORD-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const trackingToken = crypto.randomBytes(24).toString('hex');
    const order = {
      id: uuidv4(),
      orderCode,
      trackingToken,
      tenantId: String(tenantId),
      customerId: customer ? customer.id : null,
      customerEmail: customer ? customer.email : (customerInfo && customerInfo.email) || null,
      customerName: customer ? customer.name : (customerInfo && customerInfo.name) || null,
      items: orderLines,
      subtotal,
      discount,
      shippingFee,
      total,
      couponCode: coupon ? coupon.code : null,
      paymentMethod: payment.id,
      paymentStatus: 'pending',
      status: 'received',
      shippingAddress: shippingAddress || null,
      saleId: saleRes.invoice.id,
      idempotencyKey: idempotencyKey || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const odb = await orderRepository._rawStoreAsync();
    if (!odb.orders) odb.orders = [];
    odb.orders.push(order);
    await orderRepository.writeAsync(odb);

    return { order: _projectOrder(order) };
  } catch (err) {
    logger.error('marketCheckout.processCheckout error:', err.message);
    return { error: 'Checkout failed', status: 500 };
  } finally {
    release();
  }
}

module.exports = { processCheckout };
