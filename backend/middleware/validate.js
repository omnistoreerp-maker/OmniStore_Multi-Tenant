const { error: errorResponse } = require('../utils/apiResponse');

// Central schema validation layer.
// Each schema mirrors the corresponding service's _validateRequired EXACTLY,
// so the middleware can never reject a payload the service would accept.
// Services keep their own checks as a backstop; error strings are identical.

function _stringField(data, errors, field) {
  if (data[field] !== undefined && typeof data[field] !== 'string') errors.push(field + ' must be a string');
}

function _numberField(data, errors, field) {
  if (data[field] !== undefined && typeof data[field] !== 'number') errors.push(field + ' must be a number');
}

function _requiredField(data, errors, field, forCreate) {
  if (forCreate && (data[field] === undefined || data[field] === null || String(data[field]).trim() === '')) errors.push(field + ' is required');
}

function _makeSchema({ required = [], strings = [], numbers = [] }) {
  return function validate(data, forCreate) {
    const errors = [];
    required.forEach(f => _requiredField(data, errors, f, forCreate));
    strings.forEach(f => _stringField(data, errors, f));
    numbers.forEach(f => _numberField(data, errors, f));
    return errors;
  };
}

function _invoiceSchema() {
  return function validate(data, forCreate) {
    const errors = [];
    if (forCreate && !data.items) errors.push('items is required');
    if (forCreate && (!data.items || data.items.length === 0)) errors.push('items must be a non-empty array');
    if (forCreate && data.total === undefined) errors.push('total is required');
    if (data.total !== undefined && typeof data.total !== 'number') errors.push('total must be a number');
    if (data.discount !== undefined && typeof data.discount !== 'number') errors.push('discount must be a number');
    if (data.items && !Array.isArray(data.items)) errors.push('items must be an array');
    return errors;
  };
}

function _treasurySchema() {
  return function validate(data, forCreate) {
    const errors = [];
    _requiredField(data, errors, 'type', forCreate);
    if (data.type !== undefined && !['in', 'out'].includes(String(data.type))) errors.push('type must be "in" or "out"');
    if (forCreate && (data.amount === undefined || data.amount === null)) errors.push('amount is required');
    _numberField(data, errors, 'amount');
    _numberField(data, errors, 'balance');
    ['date', 'method', 'desc', 'user'].forEach(f => _stringField(data, errors, f));
    return errors;
  };
}

const SCHEMAS = {
  sales: _invoiceSchema(),
  purchases: _invoiceSchema(),
  inventory: _makeSchema({ required: ['name'], strings: ['name'], numbers: ['buyPrice', 'sellPrice', 'stockQty'] }),
  'inventory-transactions': _makeSchema({ required: ['productId', 'type'], strings: ['type'], numbers: ['qty', 'stockAfter'] }),
  customers: _makeSchema({ required: ['name'], strings: ['name', 'phone', 'phone2', 'address', 'notes'], numbers: ['balance', 'points'] }),
  suppliers: _makeSchema({ required: ['name'], strings: ['name', 'phone', 'phone2', 'email', 'address'], numbers: ['balance'] }),
  treasury: _treasurySchema(),
  employees: _makeSchema({ required: ['name'], strings: ['name', 'position', 'phone', 'phone2', 'address', 'hireDate', 'branchName', 'status', 'username', 'notes'], numbers: ['salary', 'commission', 'bonus', 'advance', 'vacationDays'] }),
  partners: _makeSchema({ required: ['name'], strings: ['name', 'phone', 'phone2'], numbers: ['capital', 'initialCapital', 'percent'] }),
  reports: _makeSchema({ required: ['type'], strings: ['type', 'title', 'month', 'user'] }),
  dashboard: _makeSchema({ required: ['key'], strings: ['key', 'title', 'period', 'user'] }),
  vouchers: _makeSchema({ required: ['type'], strings: ['type', 'partyName', 'partyType', 'method', 'date', 'user'], numbers: ['amount'] }),
  users: _makeSchema({ required: ['username'], strings: ['username', 'password', 'role', 'fullName', 'phone'] })
};

// Rejects malformed payloads (non-object bodies) and schema violations
// with the standard error envelope. Only applies to POST/PUT.
function validateResource(resource) {
  const validate = SCHEMAS[resource];
  return function (req, res, next) {
    if (req.method !== 'POST' && req.method !== 'PUT') return next();
    const data = req.body;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return errorResponse(res, 'Request body must be a JSON object', 400);
    }
    if (validate) {
      const errors = validate(data, req.method === 'POST');
      if (errors.length) return errorResponse(res, errors.join('; '), 400);
    }
    next();
  };
}

module.exports = { validateResource, SCHEMAS };
