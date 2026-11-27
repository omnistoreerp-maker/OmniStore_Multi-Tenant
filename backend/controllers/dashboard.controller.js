const dashboardService = require('../services/dashboard.service');
const salesService = require('../services/sales.service');
const inventoryService = require('../services/inventory.service');
const customersService = require('../services/customers.service');
const suppliersService = require('../services/suppliers.service');
const treasuryService = require('../services/treasury.service');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');

function list(req, res) {
  try {
    const result = dashboardService.list(req.query);
    success(res, result, 'Dashboard entries retrieved');
  } catch (err) {
    logger.error('dashboard.list error:', err.message);
    error(res, 'Failed to retrieve dashboard entries', 500);
  }
}

function getById(req, res) {
  try {
    const entry = dashboardService.getById(req.params.id);
    if (!entry) return error(res, 'Dashboard entry not found', 404);
    success(res, entry, 'Dashboard entry retrieved');
  } catch (err) {
    logger.error('dashboard.getById error:', err.message);
    error(res, 'Failed to retrieve dashboard entry', 500);
  }
}

function getStats(req, res) {
  try {
    const result = dashboardService.stats();
    success(res, result, 'Dashboard stats retrieved');
  } catch (err) {
    logger.error('dashboard.stats error:', err.message);
    error(res, 'Failed to retrieve dashboard stats', 500);
  }
}

async function getTenantHome(req, res) {
  try {
    const tenantContext = req.tenantContext || {};
    const tenantId = tenantContext.tenantId != null ? String(tenantContext.tenantId) : null;

    // Sales overview — real sales data, tenant-scoped by the service
    let sales = { count: 0, totalSales: 0, cashSales: 0, creditSales: 0, profit: 0, available: false };
    try {
      const s = await salesService.stats(tenantContext);
      sales = { ...sales, ...s, available: true };
    } catch (err) {
      logger.warn('tenant-home sales stats unavailable:', err.message);
    }

    // Inventory position — real inventory items, tenant-filtered at repository level
    let inventory = { totalItems: 0, lowStockCount: 0, recentItems: [], available: false };
    try {
      const inv = await inventoryService.list({ limit: 8, sortBy: 'updatedAt', sortOrder: 'desc' });
      const products = Array.isArray(inv.products) ? inv.products : [];
      let lowStock = 0;
      const recentItems = products.map(p => {
        const stockQty = Number(p.stockQty || 0);
        if (stockQty > 0 && stockQty <= 10) lowStock++;
        return {
          id: p.id,
          name: p.name || 'Unnamed Item',
          sku: p.sku || '',
          stockQty,
          buyPrice: Number(p.buyPrice || 0),
          sellPrice: Number(p.sellPrice || 0),
          updatedAt: p.updatedAt || p.createdAt
        };
      });
      inventory = { totalItems: inv.total || products.length, lowStockCount: lowStock, recentItems, available: true };
    } catch (err) {
      logger.warn('tenant-home inventory unavailable:', err.message);
    }

    // Customers — real customer data
    let customers = { count: 0, recentCustomers: [], available: false };
    try {
      const c = await customersService.list({ limit: 5 });
      const list = Array.isArray(c.customers) ? c.customers : [];
      customers = {
        count: c.total || list.length,
        recentCustomers: list.map(cust => ({
          id: cust.id,
          name: cust.fullName || cust.name || 'Unnamed Customer',
          phone: cust.phone || '',
          email: cust.email || '',
          createdAt: cust.createdAt || cust.updatedAt
        })),
        available: true
      };
    } catch (err) {
      logger.warn('tenant-home customers unavailable:', err.message);
    }

    // Suppliers — real supplier data
    let suppliers = { count: 0, recentSuppliers: [], available: false };
    try {
      const s = await suppliersService.list({ limit: 5 });
      const list = Array.isArray(s.suppliers) ? s.suppliers : [];
      suppliers = {
        count: s.total || list.length,
        recentSuppliers: list.map(supp => ({
          id: supp.id,
          name: supp.fullName || supp.name || 'Unnamed Supplier',
          phone: supp.phone || '',
          email: supp.email || '',
          createdAt: supp.createdAt || supp.updatedAt
        })),
        available: true
      };
    } catch (err) {
      logger.warn('tenant-home suppliers unavailable:', err.message);
    }

    // Treasury — recent transactions
    let treasury = { recentTransactions: [], available: false };
    try {
      const t = await treasuryService.list({ limit: 8 });
      const list = Array.isArray(t.transactions) ? t.transactions : [];
      treasury = {
        recentTransactions: list.map(tx => ({
          id: tx.id,
          type: tx.type || 'deposit',
          amount: Number(tx.amount || 0),
          description: tx.description || '',
          createdAt: tx.createdAt || tx.updatedAt
        })),
        available: true
      };
    } catch (err) {
      logger.warn('tenant-home treasury unavailable:', err.message);
    }

    success(res, {
      tenant: { id: tenantId, available: tenantId != null },
      sales,
      inventory,
      customers,
      suppliers,
      treasury,
      generatedAt: new Date().toISOString()
    }, 'Tenant home dashboard data retrieved');
  } catch (err) {
    logger.error('dashboard.tenant-home error:', err.message);
    error(res, 'Failed to retrieve tenant home dashboard data', 500);
  }
}

function create(req, res) {
  try {
    const result = dashboardService.create(req.body);
    if (result.error) return error(res, result.error, 400);
    success(res, result.entry, 'Dashboard entry created', 201);
  } catch (err) {
    logger.error('dashboard.create error:', err.message);
    error(res, 'Failed to create dashboard entry', 500);
  }
}

function update(req, res) {
  try {
    const result = dashboardService.update(req.params.id, req.body);
    if (result.error === 'Dashboard entry not found') return error(res, result.error, 404);
    if (result.error) return error(res, result.error, 400);
    success(res, result.entry, 'Dashboard entry updated');
  } catch (err) {
    logger.error('dashboard.update error:', err.message);
    error(res, 'Failed to update dashboard entry', 500);
  }
}

function remove(req, res) {
  try {
    const result = dashboardService.delete(req.params.id);
    if (result.error) return error(res, result.error, 404);
    success(res, null, 'Dashboard entry deleted');
  } catch (err) {
    logger.error('dashboard.remove error:', err.message);
    error(res, 'Failed to delete dashboard entry', 500);
  }
}

module.exports = { list, getById, getStats, getTenantHome, create, update, remove };
