-- PHASE ? DRAFT ONLY. DO NOT EXECUTE FROM THE BROWSER.
-- Student Services & Printing Engine add-on tables.
-- Note: the current OmniStore runtime uses fileStore, not Postgres.
-- This migration documents the intended schema for future Supabase/PostgreSQL
-- provisioning and can be used as a reference for data-shape alignment.

CREATE TABLE IF NOT EXISTS tenant_print_rates (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    paper_size VARCHAR(20) DEFAULT 'A4', -- 'A4', 'A3'
    print_type VARCHAR(20) DEFAULT 'bw',   -- 'bw' (Black & White), 'color'
    duplex_type VARCHAR(20) DEFAULT 'single', -- 'single' (Simplex), 'double' (Duplex)
    price_per_page NUMERIC(8, 2) NOT NULL,
    binding_price NUMERIC(8, 2) DEFAULT 0.00, -- Cover / Binding fee
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tenant_print_orders (
    id SERIAL PRIMARY KEY,
    order_ref VARCHAR(128) NOT NULL UNIQUE,
    tenant_id VARCHAR(64) NOT NULL,
    student_name VARCHAR(128),
    student_phone VARCHAR(32) NOT NULL,
    document_name VARCHAR(255),
    total_pages INT NOT NULL,
    copies INT DEFAULT 1,
    paper_size VARCHAR(20) DEFAULT 'A4',
    print_type VARCHAR(20) DEFAULT 'bw',
    duplex_type VARCHAR(20) DEFAULT 'single',
    has_binding BOOLEAN DEFAULT FALSE,
    total_amount NUMERIC(10, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'printing', 'ready', 'delivered'
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tenant_student_passes (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    student_name VARCHAR(128),
    student_phone VARCHAR(32) NOT NULL,
    pass_type VARCHAR(20) DEFAULT 'monthly', -- 'monthly', 'weekly'
    month VARCHAR(7) NOT NULL, -- 'YYYY-MM'
    year INT NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'active', -- 'active', 'expired'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
