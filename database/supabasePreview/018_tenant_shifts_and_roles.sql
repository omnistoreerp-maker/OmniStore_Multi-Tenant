-- PHASE ? DRAFT ONLY. DO NOT EXECUTE FROM THE BROWSER.
-- Cashier Shift Management & Multi-Role Permissions tables.
-- Note: the current OmniStore runtime uses fileStore, not Postgres.
-- This migration documents the intended schema for future Supabase/PostgreSQL
-- provisioning and can be used as a reference for data-shape alignment.

CREATE TABLE IF NOT EXISTS tenant_cash_shifts (
    id SERIAL PRIMARY KEY,
    shift_ref VARCHAR(128) NOT NULL UNIQUE,
    tenant_id VARCHAR(64) NOT NULL,
    cashier_id VARCHAR(64) NOT NULL,
    cashier_name VARCHAR(128) NOT NULL,
    opening_cash NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    expected_cash NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    actual_cash NUMERIC(12, 2) DEFAULT NULL,
    cash_variance NUMERIC(12, 2) DEFAULT NULL, -- actual - expected
    status VARCHAR(20) DEFAULT 'open', -- 'open', 'closed'
    opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP DEFAULT NULL,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS tenant_user_roles (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    role VARCHAR(32) DEFAULT 'cashier', -- 'admin', 'manager', 'cashier'
    permissions JSONB DEFAULT '{"can_discount": false, "can_void": false, "can_edit_price": false}',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, user_id)
);
