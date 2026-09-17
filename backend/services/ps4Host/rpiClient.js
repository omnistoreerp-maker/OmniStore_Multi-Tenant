'use strict';

// rpiClient — isolated RPI integration boundary for the PS4 Host.
//
// This module is the ONLY place in the OmniStore backend that knows the
// RPI bridge exists. The ps4Host.service delegates every install request
// through this boundary. Everything above this boundary is pure business
// logic; everything below it is a network concern that lives out of process.
//
// === STATUS: RPI EXECUTION DEFERRED — PROTOCOL NOT IMPLEMENTED ===
//
// The real RPI<->PS4 protocol (GoldHEN payload, rest-mode wakeup, port-12800
// forwarding, signed install commands, etc.) is NOT defined in the OmniStore
// repository. Per the Safe PS4 Host Integration Plan §13 and the Phase 2
// instructions, this boundary is a STUB that returns an explicit deferred
// result. No network I/O is performed by this module.
//
// The implementation contract for the future real client is:
//   - All outbound traffic is to a single configured RPI HTTP endpoint
//     (env: PS4_RPI_URL, default http://127.0.0.1:9090).
//   - The client sends a JSON body { gameId, ps4Target, localDownloadUrl }
//     and reads a JSON response { status, installId?, reason? }.
//   - The PS4 port (12800) is never addressed directly from OmniStore —
//     the RPI is the only process allowed to talk to the PS4.
//
// Until the real protocol is verified, this stub returns:
//
//   { status: 'deferred', reason: 'RPI EXECUTION DEFERRED — PROTOCOL NOT IMPLEMENTED' }
//
// No fetch, no http.get, no http.request, no DNS lookup, no socket open.

const RPI_DEFERRED = Object.freeze({
  status: 'deferred',
  reason: 'RPI EXECUTION DEFERRED — PROTOCOL NOT IMPLEMENTED'
});

// The configured RPI endpoint. Read once at module load so the boundary is
// explicit and testable. The value is NEVER used by the stub today; it is
// recorded for the future real client and to make the contract visible.
const RPI_URL = (process.env.PS4_RPI_URL || 'http://127.0.0.1:9090').replace(/\/+$/, '');

// Public API. Today: returns the deferred result. Tomorrow: will perform
// the actual HTTP request to RPI_URL.
//
// Input shape (documented for the future real client):
//   {
//     gameId:           string (uuid), required
//     titleId:          string, required (forwarded for RPI-side logging)
//     ps4Target:        string (IP address), required
//     localDownloadUrl: string (https URL), required — already validated
//                      by the catalog at create-time
//   }
function installGame(_input) {
  // STUB: no network I/O. The real implementation will be added in a future
  // phase once the RPI protocol is verified.
  return Object.assign({}, RPI_DEFERRED);
}

// Exposed for tests so they can assert the deferred contract without
// reaching into the (frozen) constant.
function _deferred() { return Object.assign({}, RPI_DEFERRED); }

module.exports = {
  installGame,
  RPI_URL,
  _deferred
};
