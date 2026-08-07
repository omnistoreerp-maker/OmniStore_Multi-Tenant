'use strict';

// ContainerErrors —— domain error types for the application runtime container.
//
// Scaffolded infrastructure only. Not wired into the runtime. Reserved error
// codes give future call sites a stable contract when the container is adopted.

class ContainerError extends Error {
  constructor(code, message, meta) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.meta = meta || {};
  }
}

class ServiceNotFoundError extends ContainerError {
  constructor(meta) {
    super('SERVICE_NOT_FOUND', 'Service not found in container', meta);
  }
}

class ServiceAlreadyRegisteredError extends ContainerError {
  constructor(meta) {
    super('SERVICE_ALREADY_REGISTERED', 'Service already registered', meta);
  }
}

class CircularDependencyError extends ContainerError {
  constructor(meta) {
    super('CIRCULAR_DEPENDENCY', 'Circular dependency detected', meta);
  }
}

class ProviderAlreadyRegisteredError extends ContainerError {
  constructor(meta) {
    super('PROVIDER_ALREADY_REGISTERED', 'Provider already registered', meta);
  }
}

class LifecycleError extends ContainerError {
  constructor(meta) {
    super('LIFECYCLE_ERROR', 'Container lifecycle error', meta);
  }
}

module.exports = {
  ContainerError,
  ServiceNotFoundError,
  ServiceAlreadyRegisteredError,
  CircularDependencyError,
  ProviderAlreadyRegisteredError,
  LifecycleError
};