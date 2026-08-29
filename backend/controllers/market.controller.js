const { success, error } = require('../utils/apiResponse');
const marketAuthService = require('../services/marketAuth.service');
const marketCatalogService = require('../services/marketCatalog.service');
const marketConfigService = require('../services/marketConfig.service');
const marketCheckoutService = require('../services/marketCheckout.service');
const marketOrderService = require('../services/marketOrder.service');
const { revokeToken } = require('../utils/tokenStore');
const { extractToken } = require('../middleware/marketAuth');

async function register(req, res) {
  try {
    const result = await marketAuthService.register({
      tenantId: req.marketTenant,
      email: req.body && req.body.email,
      name: req.body && req.body.name,
      password: req.body && req.body.password,
      phone: req.body && req.body.phone
    });
    if (result.error) return error(res, result.error, 400);
    success(res, { customer: result.customer, token: result.token }, 'Customer registered', 201);
  } catch (err) {
    return error(res, 'Registration failed', 500);
  }
}

async function login(req, res) {
  try {
    const result = await marketAuthService.login({
      tenantId: req.marketTenant,
      email: req.body && req.body.email,
      password: req.body && req.body.password
    });
    if (result.error) return error(res, result.error, 401);
    success(res, { customer: result.customer, token: result.token }, 'Login successful');
  } catch (err) {
    return error(res, 'Login failed', 500);
  }
}

async function logout(req, res) {
  try {
    const token = extractToken(req);
    if (token) revokeToken(token);
    success(res, null, 'Logout successful');
  } catch (err) {
    return error(res, 'Logout failed', 500);
  }
}

async function me(req, res) {
  try {
    const customer = marketAuthService.getById(req.customer.id);
    if (!customer) return error(res, 'Customer not found', 404);
    success(res, {
      customer: {
        id: customer.id,
        tenantId: customer.tenantId,
        email: customer.email,
        name: customer.name,
        phone: customer.phone,
        addresses: Array.isArray(customer.addresses) ? customer.addresses : []
      }
    }, 'Customer retrieved');
  } catch (err) {
    return error(res, 'Failed to retrieve customer', 500);
  }
}

async function updateProfile(req, res) {
  try {
    const result = await marketAuthService.updateProfile(req.customer.id, req.body || {});
    if (result.error) return error(res, result.error, result.error === 'Customer not found' ? 404 : 400);
    success(res, { customer: result.customer }, 'Profile updated');
  } catch (err) {
    return error(res, 'Failed to update profile', 500);
  }
}

async function changePassword(req, res) {
  try {
    const result = await marketAuthService.changePassword(
      req.customer.id,
      req.body && req.body.currentPassword,
      req.body && req.body.newPassword
    );
    if (result.error) return error(res, result.error, result.error === 'Customer not found' ? 404 : 400);
    success(res, { customer: result.customer, token: result.token }, 'Password changed');
  } catch (err) {
    return error(res, 'Failed to change password', 500);
  }
}

async function listProducts(req, res) {
  try {
    const result = await marketCatalogService.listProducts(req.marketTenant, req.query);
    success(res, result, 'Products retrieved');
  } catch (err) {
    return error(res, 'Failed to retrieve products', 500);
  }
}

async function getProduct(req, res) {
  try {
    const product = await marketCatalogService.getProduct(req.marketTenant, req.params.id);
    if (!product) return error(res, 'Product not found', 404);
    success(res, product, 'Product retrieved');
  } catch (err) {
    return error(res, 'Failed to retrieve product', 500);
  }
}

async function categories(req, res) {
  try {
    const result = await marketCatalogService.categories(req.marketTenant);
    success(res, { categories: result }, 'Categories retrieved');
  } catch (err) {
    return error(res, 'Failed to retrieve categories', 500);
  }
}

async function search(req, res) {
  try {
    const q = (req.query && req.query.q) || (req.query && req.query.search) || '';
    const result = await marketCatalogService.search(req.marketTenant, q);
    success(res, result, 'Search results');
  } catch (err) {
    return error(res, 'Search failed', 500);
  }
}

async function availability(req, res) {
  try {
    const raw = (req.query && req.query.ids) || '';
    const ids = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
    const result = await marketCatalogService.availability(req.marketTenant, ids);
    success(res, { availability: result }, 'Availability retrieved');
  } catch (err) {
    return error(res, 'Availability failed', 500);
  }
}

async function checkout(req, res) {
  try {
    const result = await marketCheckoutService.processCheckout({
      tenantId: req.marketTenant,
      items: req.body && req.body.items,
      shippingZoneId: req.body && req.body.shippingZoneId,
      paymentMethodId: req.body && req.body.paymentMethodId,
      couponCode: req.body && req.body.couponCode,
      customerId: req.customer ? req.customer.id : null,
      idempotencyKey: req.body && req.body.idempotencyKey,
      shippingAddress: req.body && req.body.shippingAddress,
      customerInfo: req.body && req.body.customerInfo
    });
    if (result.error) return error(res, result.error, result.status || 400);
    success(res, { order: result.order, idempotent: result.idempotent === true }, 'Order placed', 201);
  } catch (err) {
    return error(res, 'Checkout failed', 500);
  }
}

async function track(req, res) {
  try {
    const order = await marketOrderService.getByTracking(req.params.token);
    if (!order) return error(res, 'Order not found', 404);
    success(res, order, 'Order tracking');
  } catch (err) {
    return error(res, 'Tracking failed', 500);
  }
}

async function myOrders(req, res) {
  try {
    const orders = await marketOrderService.listForCustomer(req.customer.id, req.marketTenant);
    success(res, { orders }, 'Orders retrieved');
  } catch (err) {
    return error(res, 'Failed to retrieve orders', 500);
  }
}

async function myOrder(req, res) {
  try {
    const order = await marketOrderService.getForCustomer(req.params.id, req.customer.id, req.marketTenant);
    if (!order) return error(res, 'Order not found', 404);
    success(res, order, 'Order retrieved');
  } catch (err) {
    return error(res, 'Failed to retrieve order', 500);
  }
}

async function config(req, res) {
  try {
    const cfg = marketConfigService.get(req.marketTenant);
    if (!cfg) return error(res, 'Unknown tenant', 404);
    success(res, {
      storeName: cfg.storeName,
      currency: cfg.currency,
      locale: cfg.locale,
      shippingZones: cfg.shippingZones || [],
      paymentMethods: (cfg.paymentMethods || []).filter((m) => m.active !== false),
      enabled: cfg.enabled
    }, 'Market config');
  } catch (err) {
    return error(res, 'Failed to retrieve config', 500);
  }
}

module.exports = {
  register,
  login,
  logout,
  me,
  updateProfile,
  changePassword,
  listProducts,
  getProduct,
  categories,
  search,
  availability,
  checkout,
  track,
  myOrders,
  myOrder,
  config
};
