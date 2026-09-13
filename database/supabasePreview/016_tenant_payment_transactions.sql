-- PHASE ? DRAFT ONLY. DO NOT EXECUTE FROM THE BROWSER.
-- Tenant payment transaction logging for add-on/subscription purchases.

CREATE TABLE IF NOT EXISTS tenant_payment_transactions (
    id SERIAL PRIMARY KEY,
    transaction_ref VARCHAR(128) NOT NULL UNIQUE,
    tenant_id VARCHAR(64) NOT NULL,
    addon_key VARCHAR(50),
    amount NUMERIC(12, 2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'EGP',
    gateway VARCHAR(50) DEFAULT 'paymob',
    status VARCHAR(20) DEFAULT 'pending',
    payload JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
