'use strict';

// ApplicationContext —— immutable snapshot of the resolved application state.
//
// Infrastructure only. Produced by the container during a future boot sequence;
// NOT created or consumed by the current runtime. It is a plain, inert value
// object describing what "the running application" would look like once the
// container is adopted.

const SERVICE_KINDS = Object.freeze({
  CONFIG: 'config',
  REPOSITORY: 'repository',
  TENANT: 'tenant',
  LOGGER: 'logger',
  CACHE: 'cache',
  STORAGE: 'storage',
  DATABASE: 'database',
  FEATURE_FLAG: 'feature-flag',
  METRICS: 'metrics',
  EVENTS: 'events',
  SCHEDULER: 'scheduler'
});

class ApplicationContext {
  constructor(props) {
    this.appName = props.appName != null ? props.appName : null;
    this.env = props.env != null ? props.env : null;
    this.services = props.services != null ? Object.freeze(Object.assign({}, props.services)) : Object.freeze({});
    this.startedAt = props.startedAt != null ? props.startedAt : null;
    this.settings = props.settings != null ? Object.freeze(Object.assign({}, props.settings)) : Object.freeze({});
  }

  // Query whether a given service kind is present on this context.
  has(kind) {
    return Object.prototype.hasOwnProperty.call(this.services, kind);
  }

  get(kind) {
    return this.services[kind];
  }

  toJSON() {
    return {
      appName: this.appName,
      env: this.env,
      startedAt: this.startedAt,
      settings: this.settings
    };
  }

  static create(props) {
    return new ApplicationContext(props);
  }
}

module.exports = ApplicationContext;
module.exports.SERVICE_KINDS = SERVICE_KINDS;