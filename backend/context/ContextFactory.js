'use strict';

// ContextFactory —— Factory Pattern for creating empty RequestContext instances.
//
// InfRastructure only; NOT wired into the runtime. It deliberately does NOT
// read a real request, express req, JWT, tenant, or call AsyncLocalStorage.
// It only produces an empty context (optionally with an explicit requestId).

const RequestContext = require('./RequestContext');
const { assertValidRequestId } = require('./ContextTypes');

const ContextFactory = {
  // Create an EMPTY request context.
  create(requestId) {
    if (requestId !== undefined) {
      assertValidRequestId(requestId);
    }
    return RequestContext.create(requestId != null ? { requestId } : {});
  },

  // Create an empty context from arbitrary metadata (never from a request).
  createEmpty(metadata) {
    return RequestContext.create(metadata != null ? { metadata } : {});
  }
};

module.exports = ContextFactory;
module.exports.RequestContext = RequestContext;