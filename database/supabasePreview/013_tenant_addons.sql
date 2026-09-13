-- PHASE ? DRAFT ONLY. DO NOT EXECUTE FROM THE BROWSER.
-- Tenant add-ons / feature flags table for subscription-gated features.

CREATE TABLE IF NOT EXISTS public.tenant_addons (
  tenant_id VARCHAR(64) NOT NULL,
  addon_key VARCHAR(50) NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  expires_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, addon_key)
);
