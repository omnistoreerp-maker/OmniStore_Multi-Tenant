-- PHASE ? DRAFT ONLY. DO NOT EXECUTE FROM THE BROWSER.
-- Customer WhatsApp Online Store add-on schema.
-- Note: the current OmniStore runtime uses fileStore, not Postgres.
-- This migration documents the intended schema for future Supabase/PostgreSQL
-- provisioning and can be used as a reference for data-shape alignment.

CREATE TABLE IF NOT EXISTS tenant_store_configs (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL UNIQUE,
    store_slug VARCHAR(64) NOT NULL UNIQUE,
    store_name VARCHAR(128) NOT NULL,
    banner_url TEXT,
    whatsapp_number VARCHAR(32) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    delivery_fee NUMERIC(8, 2) DEFAULT 0.00,
    min_order_amount NUMERIC(8, 2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tenant_online_orders (
    id SERIAL PRIMARY KEY,
    order_ref VARCHAR(128) NOT NULL UNIQUE,
    tenant_id VARCHAR(64) NOT NULL,
    customer_name VARCHAR(128) NOT NULL,
    customer_phone VARCHAR(32) NOT NULL,
    customer_address TEXT,
    items JSONB NOT NULL, -- Array of { itemCode, title, quantity, price }
    subtotal NUMERIC(10, 2) NOT NULL,
    delivery_fee NUMERIC(8, 2) DEFAULT 0.00,
    total_amount NUMERIC(10, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'confirmed', 'shipped', 'cancelled'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
