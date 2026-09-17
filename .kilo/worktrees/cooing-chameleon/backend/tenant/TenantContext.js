'use strict';

// TenantContext —— immutable value object describing a resolved tenant.
//
// THIS IS INFRASTRUCTURE ONLY. It is NOT wired into JWT, request handling,
// repositories, services, or anything else. It is a plain, inert context
// container; nothing reads it in the current runtime.

const {
  TENANT_STATUS,
  STORAGE_PROVIDERS,
  DATABASE_PROVIDERS
} = require('./TenantConstants');
const { isValidTenantId } = require('./TenantTypes');

class TenantContext {
  constructor(props) {
    this.tenantId = props.tenantId;
    this.tenantName = props.tenantName != null ? props.tenantName : null;
    this.status = props.status != null ? props.status : TENANT_STATUS.ACTIVE;
    this.storageProvider = props.storageProvider != null ? props.storageProvider : STORAGE_PROVIDERS.JSON;
    this.databaseProvider = props.databaseProvider != null ? props.databaseProvider : DATABASE_PROVIDERS.NONE;
    this.region = props.region != null ? props.region : null;
    this.timezone = props.timezone != null ? props.timezone : null;
    this.currency = props.currency != null ? props.currency : null;
    this.locale = props.locale != null ? props.locale : null;
    this.features = Array.isArray(props.features) ? props.features.slice() : [];
    this.metadata = props.metadata != null ? Object.assign({}, props.metadata) : {};
  }

  get isActive() {
    return this.status === TENANT_STATUS.ACTIVE;
  }

  toJSON() {
    return {
      tenantId: this.tenantId,
      tenantName: this.tenantName,
      status: this.status,
      storageProvider: this.storageProvider,
      databaseProvider: this.databaseProvider,
      region: this.region,
      timezone: this.timezone,
      currency: this.currency,
      locale: this.locale,
      features: this.features.slice(),
      metadata: Object.assign({}, this.metadata)
    };
  }

  static create(props) {
    if (!props || !isValidTenantId(props.tenantId)) {
      throw new Error('TenantContext requires a valid tenantId');
    }
    return new TenantContext(props);
  }

  // Copies a context, allowing a shallow override of some fields.
  with(overrides) {
    return new TenantContext(Object.assign(this.toJSON(), overrides));
  }
}

module.exports = TenantContext;