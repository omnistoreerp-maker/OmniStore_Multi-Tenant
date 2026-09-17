# Phase 15 Runtime Validation Report

The engine validates:

- Business profile and accounting configuration
- Current fiscal year and fiscal period status
- Warehouse existence, active status, and document warehouse references
- Product identifiers/names, stock availability, negative stock, unit conversions, and item costs
- Base/document currency and exchange rates
- Tax configuration, tax account, and valid tax rates
- Customer/supplier references, product links, supported operations, document lines, and duplicate references
- Cash, bank, revenue, expense, COGS, customer, and supplier accounts
- Preview journal balancing
- Posting permissions
- One-preview-per-document consistency and read-only preview markers
- Cross-module cost consistency
- Inventory and accounting reconciliation

Output includes overall score, critical errors, warnings, blocking errors, checklist, posting eligibility, and business/inventory/accounting/permission readiness.

The engine is a validation gate only. Eligibility does not post or authorize any transaction.
