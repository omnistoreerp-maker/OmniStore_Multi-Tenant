'use strict';

const { success } = require('../utils/apiResponse');
const registry = require('../permissions/registry');

// GET /api/v1/permissions — returns the enforceable permission registry so
// privileged clients can render permission pickers. Only users with
// users.permissions.view (or an Owner/Admin effective role) reach this route;
// the gate lives on the route, not here.
function listPermissions(req, res) {
  success(res, { groups: registry.groups() }, 'Permissions retrieved');
}

module.exports = { listPermissions };