'use strict';

// ContextErrors —— domain error types for the request context infrastructure.
//
// Scaffolded infrastructure only; NOT wired into the runtime. Reserved error
// codes give future call sites a stable contract.

class ContextError extends Error {
  constructor(code, message, meta) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.meta = meta || {};
  }
}

class ContextNotFoundError extends ContextError {
  constructor(meta) {
    super('CONTEXT_NOT_FOUND', 'Request context not found', meta);
  }
}

class ContextAlreadyExistsError extends ContextError {
  constructor(meta) {
    super('CONTEXT_ALREADY_EXISTS', 'Request context already exists', meta);
  }
}

class ContextInvalidError extends ContextError {
  constructor(meta) {
    super('CONTEXT_INVALID', 'Invalid request context', meta);
  }
}

module.exports = {
  ContextError,
  ContextNotFoundError,
  ContextAlreadyExistsError,
  ContextInvalidError
};