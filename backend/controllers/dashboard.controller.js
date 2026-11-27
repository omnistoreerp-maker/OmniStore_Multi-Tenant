const dashboardService = require('../services/dashboard.service');
const salesService = require('../services/sales.service');
const inventoryService = require('../services/inventory.service');
const customersService = require('../services/customers.service');
const suppliersService = require('../services/suppliers.service');
const treasuryService = require('../services/treasury.service');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { isPrivilegedRole } = require('../services/authorization.service');

function hasPerm(user, perm) {
  if (!user || typeof user !== 'object') return false;
  if (isPrivilegedRole(user.role)) return true;
  return Array.isArray(user.permissions) && user.permissions.includes(perm);
}

function filterByTenant(records, tenantId) {
  if (!Array.isArray(records) || !tenantId) return [];
  return records.filter(r => r && String(r.tenantId) === String(tenantId));
}

async function list(req, res) {
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

async function fetchAllItems(listFn, itemKey, query = {}) {
  const all = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const result = await Promise.resolve(listFn({ ...query, page, limit: 100 }));
    const items = Array.isArray(result[itemKey]) ? result[itemKey] : [];
    all.push(...items);
    totalPages = result.totalPages || 1;
    if (totalPages <= 1) break;
    page++;
  }
  return all;
}

async function getTenantHome(req, res) {
  try {
    // Tenant identity is mandatory — fail closed without a trusted tenant.
    const tenantContext = req.tenantContext || {};
    const tenantId = tenantContext.tenantId != null ? String(tenantContext.tenantId) : null;
    if (!tenantId) {
      return error(res, 'Tenant context required', 403, { code: 'TENANT_CONTEXT_REQUIRED' });
    }

    const user = req.user || {};
    const role = user.effectiveRole || user.role;
    if (!isPrivilegedRole(role)) {
      return error(res, 'Insufficient role', 403, { code: 'INSUFFICIENT_ROLE' });
    }

    // Field-level permissions (Owner/Admin bypass via isPrivilegedRole, but
    // checked explicitly for defense-in-depth and future role changes).
    const canViewSales = hasPerm(user, 'sales.view');
    const canViewInventory = hasPerm(user, 'inventory.view');
    const canViewCustomers = hasPerm(user, 'customers.view');
    const canViewSuppliers = hasPerm(user, 'suppliers.view');
    const canViewTreasury = hasPerm(user, 'treasury.view');

    // Sales overview — complete tenant-scoped totals. Paginate through ALL
    // invoices, then filter by trusted tenantId. Never treat a capped sample
    // as a complete lifetime total.
    let sales = { count: 0, totalSales: 0, cashSales: 0, creditSales: 0, profit: 0, available: false };
    if (canViewSales) {
      try {
        const allInvoices = await fetchAllItems(salesService.list.bind(salesService), 'invoices');
        const invoices = filterByTenant(allInvoices, tenantId);
        let totalSales = 0, cashSales = 0, creditSales = 0, totalProfit = 0;
        invoices.forEach(inv => {
          const t = Number(inv.total) || 0;
          totalSales += t;
          totalProfit += Number(inv.profit) || 0;
          const pay = String(inv.payment || inv.paymentType || inv.invoiceType || 'cash').toLowerCase();
          if (pay === 'cash') cashSales += t;
          else creditSales += t;
        });
        sales = {
          count: invoices.length,
          totalSales: Math.round(totalSales * 100) / 100,
          cashSales: Math.round(cashSales * 100) / 100,
          creditSales: Math.round(creditSales * 100) / 100,
          profit: Math.round(totalProfit * 100) / 100,
          available: true
        };
      } catch (err) {
        logger.warn('tenant-home sales stats unavailable:', err.message);
      }
    }

    // Inventory position — products are platform-GLOBAL (GLOBAL_STORES),
    // never tenant-scoped. Do not present global products as tenant inventory.
    let inventory = { totalItems: 0, lowStockCount: 0, recentItems: [], available: false };
    if (canViewInventory) {
      try {
        const inv = await inventoryService.list({ limit: 8, sortBy: 'updatedAt', sortOrder: 'desc' });
        const products = Array.isArray(inv.products) ? inv.products : [];
        // Products carry no tenantId — they are platform-global catalog items,
        // not tenant-owned stock. Report honest unavailable state.
        inventory = { totalItems: 0, lowStockCount: 0, recentItems: [], available: false };
      } catch (err) {
        logger.warn('tenant-home inventory unavailable:', err.message);
      }
    }

    // Customers — complete tenant-scoped count. Paginate through ALL customers,
    // filter by trusted tenantId, then count. Never derive total from a
    // list capped at five records.
    let customers = { count: 0, recentCustomers: [], available: false };
    if (canViewCustomers) {
      try {
        const allCustomers = await fetchAllItems(customersService.list.bind(customersService), 'customers');
        const list = filterByTenant(allCustomers, tenantId);
        const recent = list.slice(0, 5);
        customers = {
          count: list.length,
          recentCustomers: recent.map(cust => ({
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
    }

    // Suppliers — complete tenant-scoped count. Paginate through ALL suppliers,
    // filter by trusted tenantId, then count. Never derive total from a
    // list capped at five records.
    let suppliers = { count: 0, recentSuppliers: [], available: false };
    if (canViewSuppliers) {
      try {
        const allSuppliers = await fetchAllItems(suppliersService.list.bind(suppliersService), 'suppliers');
        const list = filterByTenant(allSuppliers, tenantId);
        const recent = list.slice(0, 5);
        suppliers = {
          count: list.length,
          recentSuppliers: recent.map(supp => ({
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
    }

    // Treasury — complete tenant-scoped transactions. Paginate through ALL
    // entries, filter by trusted tenantId, then report recent transactions.
    // Never label a capped sample as the total number of treasury transactions.
    let treasury = { recentTransactions: [], available: false };
    if (canViewTreasury) {
      try {
        const allEntries = await fetchAllItems(treasuryService.list.bind(treasuryService), 'entries');
        const list = filterByTenant(allEntries, tenantId);
        const recent = list.slice(0, 8);
        treasury = {
          recentTransactions: recent.map(tx => ({
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
    }

    success(res, {
      tenant: { id: tenantId, available: true },
      role,
      perms: [canViewSales && 'sales.view', canViewInventory && 'inventory.view', canViewCustomers && 'customers.view', canViewSuppliers && 'suppliers.view', canViewTreasury && 'treasury.view'].filter(Boolean),
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
