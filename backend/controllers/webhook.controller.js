const webhookService = require('../services/webhook.service');
const { trustedTenantId } = require('../middleware/authorize');
const { success, error } = require('../utils/apiResponse');

function register(req, res) {
  try {
    const hook = webhookService.register({
      url: req.body.url,
      events: req.body.events,
      secret: req.body.secret,
      description: req.body.description,
      tenantId: trustedTenantId(req)
    });
    return success(res, hook, 'Webhook registered', 201);
  } catch (err) {
    return error(res, err.message || 'Failed to register webhook', 400);
  }
}

function list(req, res) {
  return success(res, webhookService.list({ tenantId: trustedTenantId(req) }), 'Webhooks retrieved');
}

function getById(req, res) {
  const hook = webhookService.getById(req.params.id, trustedTenantId(req));
  if (!hook) return error(res, 'Webhook not found', 404);
  return success(res, hook, 'Webhook retrieved');
}

function update(req, res) {
  try {
    const hook = webhookService.update(req.params.id, {
      url: req.body.url,
      events: req.body.events,
      active: req.body.active,
      description: req.body.description
    }, trustedTenantId(req));
    if (!hook) return error(res, 'Webhook not found', 404);
    return success(res, hook, 'Webhook updated');
  } catch (err) {
    return error(res, err.message || 'Failed to update webhook', 400);
  }
}

function remove(req, res) {
  const ok = webhookService.remove(req.params.id, trustedTenantId(req));
  if (!ok) return error(res, 'Webhook not found', 404);
  return success(res, null, 'Webhook removed');
}

async function sendTest(req, res) {
  const tenantId = trustedTenantId(req);
  const hook = webhookService.getById(req.params.id, tenantId);
  if (!hook) return error(res, 'Webhook not found', 404);
  const result = await webhookService.sendTest(hook, req.body.event, tenantId);
  if (result.ok) return success(res, result, 'Test webhook delivered');
  return error(res, 'Test webhook failed', 502, result);
}

module.exports = { register, list, getById, update, remove, sendTest };