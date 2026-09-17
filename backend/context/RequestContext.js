'use strict';

// RequestContext —— immutable value object describing a single in-flight request.
//
// InfRastructure only; NOT wired into the runtime and NOT produced by any real
// request. It carries only "future slots", all of them null/empty by default:
// requestId, correlationId, tenant, user, locale, timezone, currency, metadata.

class RequestContext {
  constructor(props) {
    this.requestId = props.requestId != null ? props.requestId : null;
    this.correlationId = props.correlationId != null ? props.correlationId : null;
    this.tenant = props.tenant != null ? props.tenant : null;
    this.user = props.user != null ? props.user : null;
    this.locale = props.locale != null ? props.locale : null;
    this.timezone = props.timezone != null ? props.timezone : null;
    this.currency = props.currency != null ? props.currency : null;
    this.metadata = props.metadata != null ? Object.assign({}, props.metadata) : {};
  }

  get isEmpty() {
    return this.requestId === null &&
           this.correlationId === null &&
           this.tenant === null &&
           this.user === null &&
           this.locale === null &&
           this.timezone === null &&
           this.currency === null;
  }

  toJSON() {
    return {
      requestId: this.requestId,
      correlationId: this.correlationId,
      tenant: this.tenant,
      user: this.user,
      locale: this.locale,
      timezone: this.timezone,
      currency: this.currency,
      metadata: Object.assign({}, this.metadata)
    };
  }

  // Immutable copy with shallow overrides (returns a NEW context).
  with(overrides) {
    return new RequestContext(Object.assign(this.toJSON(), overrides));
  }

  static create(props) {
    return new RequestContext(props || {});
  }
}

module.exports = RequestContext;