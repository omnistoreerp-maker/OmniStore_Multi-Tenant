'use strict';

// gameHostingProvider — Provider adapter for Game Hosting infrastructure.
//
// This is the BOUNDARY between the Game Hosting service and the
// real infrastructure (Raspberry Pi fleet, cloud VMs, etc.).
//
// Per Drive 1 protocol §12:
//   - If a real provider exists, implement a provider-specific adapter.
//   - If no real provider exists, DO NOT invent fake production
//     provisioning. Instead implement the contract, validation, and
//     an explicit "unavailable/deferred" response.
//
// Status: BLOCKED / NOT IMPLEMENTED
//
// Every method returns a structured response that the controller can
// forward to the frontend. The frontend MUST display this status
// transparently (e.g., "Provider integration is currently unavailable")
// rather than pretending the operation succeeded.

const PROVIDER_STATUS = Object.freeze({
  status: 'BLOCKED',
  reason: 'Provider integration is not yet implemented. The contract, validation, and lifecycle state machine are in place. A real provider adapter (Raspberry Pi, cloud VM, etc.) must be implemented before production provisioning can occur.',
  implementedOperations: [],
  blockedOperations: ['start', 'stop', 'terminate', 'provision', 'deprovision'],
  lastUpdated: new Date().toISOString()
});

function getStatus() {
  return Object.assign({}, PROVIDER_STATUS, { lastUpdated: new Date().toISOString() });
}

async function execute(operation, _context) {
  return {
    status: 'BLOCKED',
    operation: operation,
    reason: 'Provider integration is not implemented. This operation was recorded but not executed.',
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  getStatus,
  execute
};
