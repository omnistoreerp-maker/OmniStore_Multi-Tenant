-- PHASE ? DRAFT ONLY. DO NOT EXECUTE FROM THE BROWSER.
-- Tenant custom domain resolution table.

CREATE TABLE IF NOT EXISTS tenant_custom_domains (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    custom_domain VARCHAR(255) NOT NULL UNIQUE,
    status VARCHAR(20) DEFAULT 'pending_verification',
    ssl_status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
