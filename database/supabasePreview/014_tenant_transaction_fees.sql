-- PHASE ? DRAFT ONLY. DO NOT EXECUTE FROM THE BROWSER.
-- Tenant transaction fee logging table for async fee capture.

CREATE TABLE IF NOT EXISTS tenant_transaction_fees (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    invoice_id VARCHAR(128) NOT NULL,
    transaction_amount NUMERIC(12, 2) NOT NULL,
    fee_percentage NUMERIC(5, 4) DEFAULT 0.0050,
    fee_amount NUMERIC(12, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'unbilled',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
