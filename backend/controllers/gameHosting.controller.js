'use strict';

// gameHosting.controller — Phase B HTTP layer for Game Hosting.
//
// Architecture (per Drive 1 protocol §10):
//
//   Frontend
//      ↓
//   Controller (this file)
//      ↓
//   Service (gameHosting.service)
//      ↓
//   Provider Adapter (gameHostingProvider — stub, BLOCKED)
//      ↓
//   Infrastructure (not integrated)
//
// The controller NEVER reads tenantId or customerId from the request
// body. Tenant comes from req.marketTenant (set by the tenant
// resolution middleware). Customer comes from req.customer (set by the
// customer JWT middleware).
//
// Implementation status (per protocol §15):
//   Plans CRUD:           IMPLEMENTED
//   Servers CRUD:         IMPLEMENTED
//   Provisioning requests: PARTIALLY IMPLEMENTED (record only; provider BLOCKED)
//   Server lifecycle:     PARTIALLY IMPLEMENTED (status transitions; provider BLOCKED)
//   Billing:              BLOCKED
//   Provider integration: BLOCKED

const { success, error } = require('../utils/apiResponse');
const gameHostingService = require('../services/gameHosting.service');
const gameHostingProvider = require('./gameHostingProvider');
const gameHostingStateMachine = require('./gameHostingStateMachine');

function _tenantContext(req) {
  return { tenantId: req.marketTenant || null };
}

function _customerContext(req) {
  if (!req.customer) return null;
  return {
    id: req.customer.id,
    tenantId: req.customer.tenantId,
    email: req.customer.email,
    name: req.customer.name
  };
}

// === Plans ===

async function listPlans(req, res) {
  try {
    const plans = await gameHostingService.listPlans({ tenantContext: _tenantContext(req) });
    return success(res, { plans }, 'Plans retrieved');
  } catch (err) {
    return error(res, 'Failed to list plans', 500);
  }
}

async function getPlan(req, res) {
  try {
    const plan = await gameHostingService.getPlanById({ id: req.params.id, tenantContext: _tenantContext(req) });
    if (!plan) return error(res, 'Plan not found', 404);
    return success(res, plan, 'Plan retrieved');
  } catch (err) {
    return error(res, 'Failed to get plan', 500);
  }
}

async function createPlan(req, res) {
  try {
    const result = await gameHostingService.createPlan({ data: req.body, tenantContext: _tenantContext(req) });
    if (result.error) return error(res, result.error, 400);
    return success(res, result.plan, 'Plan created', 201);
  } catch (err) {
    return error(res, 'Failed to create plan', 500);
  }
}

async function updatePlan(req, res) {
  try {
    const result = await gameHostingService.updatePlan({ id: req.params.id, data: req.body, tenantContext: _tenantContext(req) });
    if (result.error === 'Plan not found') return error(res, 'Plan not found', 404);
    if (result.error) return error(res, result.error, 400);
    return success(res, result.plan, 'Plan updated');
  } catch (err) {
    return error(res, 'Failed to update plan', 500);
  }
}

async function deletePlan(req, res) {
  try {
    const result = await gameHostingService.deletePlan({ id: req.params.id, tenantContext: _tenantContext(req) });
    if (result.error === 'Plan not found') return error(res, 'Plan not found', 404);
    if (result.error) return error(res, result.error, 500);
    return success(res, { deleted: true }, 'Plan deleted');
  } catch (err) {
    return error(res, 'Failed to delete plan', 500);
  }
}

// === Servers ===

async function listServers(req, res) {
  try {
    const servers = await gameHostingService.listServers({ query: req.query, tenantContext: _tenantContext(req) });
    return success(res, { servers }, 'Servers retrieved');
  } catch (err) {
    return error(res, 'Failed to list servers', 500);
  }
}

async function getServer(req, res) {
  try {
    const server = await gameHostingService.getServerById({ id: req.params.id, tenantContext: _tenantContext(req) });
    if (!server) return error(res, 'Server not found', 404);
    // Ownership: if a customer is authenticated, they can only see their own servers.
    const cust = _customerContext(req);
    if (cust && server.customerId && String(server.customerId) !== String(cust.id)) {
      return error(res, 'Server not found', 404);
    }
    return success(res, server, 'Server retrieved');
  } catch (err) {
    return error(res, 'Failed to get server', 500);
  }
}

async function createServer(req, res) {
  try {
    const cust = _customerContext(req);
    const data = Object.assign({}, req.body || {});
    if (cust) data.customerId = cust.id;
    const result = await gameHostingService.createServer({ data, tenantContext: _tenantContext(req) });
    if (result.error) return error(res, result.error, 400);
    return success(res, result.server, 'Server created', 201);
  } catch (err) {
    return error(res, 'Failed to create server', 500);
  }
}

async function updateServer(req, res) {
  try {
    // Ownership check before update
    const existing = await gameHostingService.getServerById({ id: req.params.id, tenantContext: _tenantContext(req) });
    if (!existing) return error(res, 'Server not found', 404);
    const cust = _customerContext(req);
    if (cust && existing.customerId && String(existing.customerId) !== String(cust.id)) {
      return error(res, 'Server not found', 404);
    }
    // Validate the status transition through the lifecycle state machine
    if (req.body && req.body.status !== undefined) {
      const trans = gameHostingStateMachine.validateTransition(existing.status, req.body.status);
      if (!trans.ok) return error(res, 'Invalid status transition: ' + existing.status + ' -> ' + req.body.status, 400);
    }
    const result = await gameHostingService.updateServer({ id: req.params.id, data: req.body, tenantContext: _tenantContext(req) });
    if (result.error === 'Server not found') return error(res, 'Server not found', 404);
    if (result.error) return error(res, result.error, 400);
    return success(res, result.server, 'Server updated');
  } catch (err) {
    return error(res, 'Failed to update server', 500);
  }
}

async function deleteServer(req, res) {
  try {
    const existing = await gameHostingService.getServerById({ id: req.params.id, tenantContext: _tenantContext(req) });
    if (!existing) return error(res, 'Server not found', 404);
    const cust = _customerContext(req);
    if (cust && existing.customerId && String(existing.customerId) !== String(cust.id)) {
      return error(res, 'Server not found', 404);
    }
    const result = await gameHostingService.deleteServer({ id: req.params.id, tenantContext: _tenantContext(req) });
    if (result.error === 'Server not found') return error(res, 'Server not found', 404);
    if (result.error) return error(res, result.error, 500);
    return success(res, { deleted: true }, 'Server deleted');
  } catch (err) {
    return error(res, 'Failed to delete server', 500);
  }
}

// === Provisioning ===

async function createProvisioningRequest(req, res) {
  try {
    const cust = _customerContext(req);
    const data = Object.assign({}, req.body || {});
    if (cust) data.customerId = cust.id;
    const result = await gameHostingService.createProvisioningRequest({ data, tenantContext: _tenantContext(req) });
    if (result.error) return error(res, result.error, 400);
    // Provider integration is BLOCKED. The request is recorded but
    // no actual provisioning happens. The response includes the
    // provider status so the frontend can show the deferred state.
    return success(res, {
      request: result.request,
      provider: gameHostingProvider.getStatus()
    }, 'Provisioning request recorded (provider integration blocked)', 201);
  } catch (err) {
    return error(res, 'Failed to create provisioning request', 500);
  }
}

async function listProvisioningRequests(req, res) {
  try {
    const requests = await gameHostingService.listProvisioningRequests({ tenantContext: _tenantContext(req) });
    return success(res, { requests, provider: gameHostingProvider.getStatus() }, 'Provisioning requests retrieved');
  } catch (err) {
    return error(res, 'Failed to list provisioning requests', 500);
  }
}

// === Lifecycle actions ===

// startServer / stopServer / terminateServer are lifecycle action
// endpoints. They use the state machine to validate the transition
// and then call the provider adapter. The provider is BLOCKED, so
// these endpoints record the intent but do not perform real
// infrastructure operations.

async function startServer(req, res) {
  return _lifecycleAction(req, res, 'start', 'provisioning');
}

async function stopServer(req, res) {
  return _lifecycleAction(req, res, 'stop', 'stopped');
}

async function terminateServer(req, res) {
  return _lifecycleAction(req, res, 'terminate', 'terminated');
}

async function _lifecycleAction(req, res, action, targetStatus) {
  try {
    const existing = await gameHostingService.getServerById({ id: req.params.id, tenantContext: _tenantContext(req) });
    if (!existing) return error(res, 'Server not found', 404);
    const cust = _customerContext(req);
    if (cust && existing.customerId && String(existing.customerId) !== String(cust.id)) {
      return error(res, 'Server not found', 404);
    }
    // Validate transition
    const trans = gameHostingStateMachine.validateTransition(existing.status, targetStatus);
    if (!trans.ok) return error(res, 'Invalid transition: ' + existing.status + ' -> ' + targetStatus, 409);
    // Call provider (BLOCKED)
    const providerResult = await gameHostingProvider.execute(action, {
      serverId: existing.id,
      tenantId: existing.tenantId
    });
    // Update server status
    const updateResult = await gameHostingService.updateServer({
      id: req.params.id,
      data: { status: targetStatus },
      tenantContext: _tenantContext(req)
    });
    if (updateResult.error) return error(res, updateResult.error, 500);
    return success(res, {
      server: updateResult.server,
      provider: providerResult
    }, 'Server ' + action + ' requested (provider integration blocked)');
  } catch (err) {
    return error(res, 'Failed to ' + action + ' server', 500);
  }
}

// === Provider status (for frontend transparency) ===

async function providerStatus(req, res) {
  return success(res, gameHostingProvider.getStatus(), 'Provider status');
}

module.exports = {
  // Plans
  listPlans,
  getPlan,
  createPlan,
  updatePlan,
  deletePlan,
  // Servers
  listServers,
  getServer,
  createServer,
  updateServer,
  deleteServer,
  // Provisioning
  createProvisioningRequest,
  listProvisioningRequests,
  // Lifecycle
  startServer,
  stopServer,
  terminateServer,
  // Provider
  providerStatus
};
