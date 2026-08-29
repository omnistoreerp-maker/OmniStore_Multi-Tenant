const BaseRepository = require('../repositories/BaseRepository');
const repository = new BaseRepository('marketOrders');

async function _load() {
  const db = await repository._rawStoreAsync();
  if (!db || typeof db !== 'object') return { orders: [] };
  if (!Array.isArray(db.orders)) db.orders = [];
  return db;
}

function _publicTrack(order) {
  return {
    orderCode: order.orderCode,
    status: order.status,
    paymentStatus: order.paymentStatus,
    items: (order.items || []).map((i) => ({ name: i.name, qty: i.qty })),
    createdAt: order.createdAt
  };
}

function _publicCustomer(order) {
  return {
    id: order.id,
    orderCode: order.orderCode,
    trackingToken: order.trackingToken,
    customerId: order.customerId,
    status: order.status,
    paymentStatus: order.paymentStatus,
    items: order.items,
    subtotal: order.subtotal,
    discount: order.discount,
    shippingFee: order.shippingFee,
    total: order.total,
    couponCode: order.couponCode,
    paymentMethod: order.paymentMethod,
    shippingAddress: order.shippingAddress,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt
  };
}

async function getByTracking(token) {
  const db = await _load();
  const order = db.orders.find((o) => o.trackingToken === token);
  return order ? _publicTrack(order) : null;
}

async function listForCustomer(customerId, tenantId) {
  const db = await _load();
  return db.orders
    .filter((o) => String(o.customerId) === String(customerId) && String(o.tenantId) === String(tenantId))
    .map(_publicCustomer);
}

async function getForCustomer(orderId, customerId, tenantId) {
  const db = await _load();
  const order = db.orders.find(
    (o) => String(o.id) === String(orderId) && String(o.customerId) === String(customerId) && String(o.tenantId) === String(tenantId)
  );
  return order ? _publicCustomer(order) : null;
}

module.exports = { getByTracking, listForCustomer, getForCustomer };
