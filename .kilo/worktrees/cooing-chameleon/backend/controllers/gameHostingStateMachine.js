'use strict';

// gameHostingStateMachine — Server lifecycle state machine.
//
// The server lifecycle has six states:
//
//   pending → provisioning → running ⇄ stopped
//                ↓                ↓
//              error          terminated (terminal)
//
// Allowed transitions:
//   pending       → provisioning, terminated
//   provisioning  → running, error, terminated
//   running       → stopped, terminated
//   stopped       → running, terminated
//   error         → provisioning (retry), terminated
//   terminated    → (terminal, no transitions out)
//
// This is a PURE module — no I/O, no storage. The controller calls
// validateTransition() before any status update, and the service
// stores the status. The provider adapter (gameHostingProvider)
// is the boundary that would execute the actual infrastructure
// operation in a real integration.

const STATES = Object.freeze(['pending', 'provisioning', 'running', 'stopped', 'terminated', 'error']);
const TERMINAL_STATES = Object.freeze(['terminated']);

const ALLOWED_TRANSITIONS = Object.freeze({
  pending: Object.freeze(['provisioning', 'terminated']),
  provisioning: Object.freeze(['running', 'error', 'terminated']),
  running: Object.freeze(['stopped', 'terminated']),
  stopped: Object.freeze(['running', 'terminated']),
  error: Object.freeze(['provisioning', 'terminated']),
  terminated: Object.freeze([])
});

function isValidState(s) {
  return STATES.indexOf(s) !== -1;
}

function isTerminal(s) {
  return TERMINAL_STATES.indexOf(s) !== -1;
}

function getAllowedTransitions(from) {
  if (!isValidState(from)) return [];
  return ALLOWED_TRANSITIONS[from].slice();
}

function canTransition(from, to) {
  if (!isValidState(from) || !isValidState(to)) return false;
  return ALLOWED_TRANSITIONS[from].indexOf(to) !== -1;
}

function validateTransition(from, to) {
  if (from == null || to == null) return { error: 'from and to are required' };
  if (typeof from !== 'string' || typeof to !== 'string') return { error: 'from and to must be strings' };
  if (!isValidState(from)) return { error: 'Unknown source state: ' + from };
  if (!isValidState(to)) return { error: 'Unknown target state: ' + to };
  if (isTerminal(from)) return { error: 'Cannot transition from terminal state: ' + from };
  if (!canTransition(from, to)) {
    return {
      error: 'Invalid transition: ' + from + ' -> ' + to,
      allowed: getAllowedTransitions(from)
    };
  }
  return { ok: true };
}

module.exports = {
  STATES,
  TERMINAL_STATES,
  ALLOWED_TRANSITIONS,
  isValidState,
  isTerminal,
  getAllowedTransitions,
  canTransition,
  validateTransition
};
