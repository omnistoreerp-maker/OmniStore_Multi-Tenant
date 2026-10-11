const { success, error } = require('../utils/apiResponse');
const marketAuthService = require('../services/marketAuth.service');
const marketCatalogService = require('../services/marketCatalog.service');
const marketConfigService = require('../services/marketConfig.service');
const marketCheckoutService = require('../services/marketCheckout.service');
const marketOrderService = require('../services/marketOrder.service');
const marketOrderStateMachine = require('../services/marketOrderStateMachine.service');
const { revokeToken } = require('../utils/tokenStore');
const { extractToken } = require('../middleware/marketAuth');
const fs = require('fs');
const logger = require('../utils/logger');
const productCatalogService = require('../services/productCatalog.service');
const productCategoryService = require('../services/productCategories.service');
const productImagesService = require('../services/productImages.service');

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
    if (!product) return success(res, null, 'Product retrieved');
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

async function cancelMyOrder(req, res) {
  try {
    const reason = req.body && typeof req.body.reason === 'string' ? req.body.reason : null;
    const result = await marketOrderStateMachine.cancelOrder({
      orderId: req.params.id,
      customerId: req.customer.id,
      tenantId: req.marketTenant,
      reason
    });
    if (result.error === 'not_found') return error(res, 'Order not found', 404);
    if (result.error === 'invalid_state') {
      return error(res, 'Order cannot be cancelled (current state: ' + result.current + ')', 409);
    }
    if (result.error === 'persist_failed') return error(res, 'Failed to cancel order', 500);
    if (result.error) return error(res, result.error, 400);
    const projected = await marketOrderService.getForCustomer(req.params.id, req.customer.id, req.marketTenant);
    return success(res, projected, 'Order cancelled');
  } catch (err) {
    return error(res, 'Failed to cancel order', 500);
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

// ---------------------------------------------------------------
// Product management (operator only)
// ---------------------------------------------------------------

async function createProduct(req, res) {
  try {
    const result = await productCatalogService.createProduct(req.marketTenant, req.body);
    if (result.error) return error(res, result.error, 400);
    success(res, { product: result.product }, 'Product created', 201);
  } catch (err) {
    logger.error('market.createProduct error:', err && err.message || err);
    return error(res, 'Failed to create product', 500);
  }
}

async function updateProduct(req, res) {
  try {
    const result = await productCatalogService.updateProduct(req.marketTenant, req.params.id, req.body);
    if (result.error) return error(res, result.error, 404);
    success(res, { product: result.product }, 'Product updated');
  } catch (err) {
    logger.error('market.updateProduct error:', err && err.message || err);
    return error(res, 'Failed to update product', 500);
  }
}

async function deleteProduct(req, res) {
  try {
    const purge = req.query.purge === 'true';
    const result = purge
      ? await productCatalogService.hardDeleteProduct(req.marketTenant, req.params.id, req.customer.id)
      : await productCatalogService.softDeleteProduct(req.marketTenant, req.params.id, req.customer.id);
    if (result.error) return error(res, result.error, 404);
    success(res, purge ? { ok: true } : { product: result.product }, purge ? 'Product purged' : 'Product deleted');
  } catch (err) {
    logger.error('market.deleteProduct error:', err && err.message || err);
    return error(res, 'Failed to delete product', 500);
  }
}

async function setPublish(req, res) {
  try {
    const result = await productCatalogService.setPublish(req.marketTenant, req.params.id, req.body.published);
    if (result.error) return error(res, result.error, String(result.error).includes('not found') ? 404 : 400);
    success(res, { product: result.product }, 'Publish state updated');
  } catch (err) {
    logger.error('market.setPublish error:', err && err.message || err);
    return error(res, 'Failed to update publish state', 500);
  }
}

// ---------------------------------------------------------------
// Category management (operator only)
// ---------------------------------------------------------------

async function createCategory(req, res) {
  try {
    const result = await productCategoryService.createCategory(req.marketTenant, req.body);
    if (result.error) return error(res, result.error, 400);
    success(res, { category: result.category }, 'Category created', 201);
  } catch (err) {
    logger.error('market.createCategory error:', err && err.message || err);
    return error(res, 'Failed to create category', 500);
  }
}

async function updateCategory(req, res) {
  try {
    const result = await productCategoryService.updateCategory(req.marketTenant, req.params.id, req.body);
    if (result.error) return error(res, result.error, 404);
    success(res, { category: result.category }, 'Category updated');
  } catch (err) {
    logger.error('market.updateCategory error:', err && err.message || err);
    return error(res, 'Failed to update category', 500);
  }
}

async function deleteCategory(req, res) {
  try {
    const result = await productCategoryService.deleteCategory(req.marketTenant, req.params.id);
    if (result.error) return error(res, result.error, 400);
    success(res, { ok: true }, 'Category deleted');
  } catch (err) {
    logger.error('market.deleteCategory error:', err && err.message || err);
    return error(res, 'Failed to delete category', 500);
  }
}

// ---------------------------------------------------------------
// Product media (operator only)
// ---------------------------------------------------------------

function _isProductVisible(tenantId, productId) {
  const cfg = marketConfigService.get(tenantId);
  if (!cfg) return false;
  const allow = marketConfigService.resolveProductVisibility(cfg);
  return allow(productId);
}

async function uploadMedia(req, res) {
  try {
    const buffer = req.rawBody;
    const contentType = req.headers['content-type'] || 'application/octet-stream';
    const validation = productImagesService.validateUpload(buffer, contentType);
    if (validation.error) return error(res, validation.error, 400);
    const result = await productImagesService.saveUpload(req.marketTenant, buffer, contentType);
    if (result.error) return error(res, result.error, 500);
    success(res, { mediaUrl: result.mediaUrl, size: result.size, mime: result.mime }, 'Media uploaded', 201);
  } catch (err) {
    logger.error('market.uploadMedia error:', err && err.message || err);
    return error(res, 'Failed to upload media', 500);
  }
}

async function replaceMedia(req, res) {
  try {
    const productId = req.params.productId;
    const mediaId = req.params.mediaId;
    const buffer = req.rawBody;
    const contentType = req.headers['content-type'] || 'application/octet-stream';
    if (!_isProductVisible(req.marketTenant, productId)) {
      return error(res, 'Product not found', 404);
    }
    const validation = productImagesService.validateUpload(buffer, contentType);
    if (validation.error) return error(res, validation.error, 400);
    const urlCheck = productImagesService.validateMediaUrl(req.body.mediaUrl || '', req.marketTenant);
    if (urlCheck.error) return error(res, urlCheck.error, 400);
    await productImagesService.deleteMedia(req.marketTenant, mediaId);
    const result = await productImagesService.saveUpload(req.marketTenant, buffer, contentType);
    if (result.error) return error(res, result.error, 500);
    success(res, { mediaUrl: result.mediaUrl, size: result.size, mime: result.mime }, 'Media replaced');
  } catch (err) {
    logger.error('market.replaceMedia error:', err && err.message || err);
    return error(res, 'Failed to replace media', 500);
  }
}

async function deleteMedia(req, res) {
  try {
    const productId = req.params.productId;
    const mediaId = req.params.mediaId;
    if (!_isProductVisible(req.marketTenant, productId)) {
      return error(res, 'Product not found', 404);
    }
    const result = await productImagesService.deleteMedia(req.marketTenant, mediaId);
    if (result.error) return error(res, result.error, 404);
    success(res, { ok: true }, 'Media deleted');
  } catch (err) {
    logger.error('market.deleteMedia error:', err && err.message || err);
    return error(res, 'Failed to delete media', 500);
  }
}

async function serveMedia(req, res) {
  try {
    const tenantId = req.marketTenant;
    const mediaTenant = String(req.params.tenantId || '');
    if (mediaTenant !== tenantId) {
      return error(res, 'Media not found', 404);
    }
    const fileName = String(req.params.fileName || '');
    const full = productImagesService.mediaPathFor(tenantId, fileName);
    if (!full || !fs.existsSync(full)) {
      return error(res, 'Media not found', 404);
    }
    res.setHeader('Content-Type', productImagesService.mimeForFile(fileName));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.sendFile(full);
  } catch (err) {
    logger.error('market.serveMedia error:', err && err.message || err);
    return error(res, 'Media not found', 404);
  }
}

// ---------------------------------------------------------------
// Internal: operator bootstrap (protected by the operator admin secret).
// ---------------------------------------------------------------

async function promoteOperator(req, res) {
  try {
    const { customerId, tenantId, role } = req.body || {};
    if (!customerId || !tenantId) return error(res, 'customerId and tenantId are required', 400);
    if (!marketConfigService.exists(tenantId)) return error(res, 'Unknown tenant', 404);
    const result = marketAuthService.setOperatorRole(customerId, tenantId, role);
    if (result.error) return error(res, result.error, 400);
    success(res, { customer: { id: customerId, tenantId: tenantId, role: 'operator' } }, 'Operator role granted');
  } catch (err) {
    logger.error('market.promoteOperator error:', err && err.message || err);
    return error(res, 'Failed to grant operator role', 500);
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
  cancelMyOrder,
  config,
  createProduct,
  updateProduct,
  deleteProduct,
  setPublish,
  createCategory,
  updateCategory,
  deleteCategory,
  uploadMedia,
  replaceMedia,
  deleteMedia,
  serveMedia,
  promoteOperator
};
