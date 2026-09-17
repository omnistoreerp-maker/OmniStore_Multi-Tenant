# Phase 28 License and Subscription Report

## License safety

- Format: `OMNI-XXXXXX-XXXXXX-XXXXXX-XXXXXX`.
- Keys are generated using server-side cryptographic UUID material.
- Only SHA-256 hashes and a short prefix are stored.
- The raw key is returned once after explicit generation.
- Validation derives effective states: active, expired, revoked, or not found.
- Generate, validate, renew, revoke, status, and plan changes are audited.

## Plan catalog

Trial, Monthly, Quarterly, Yearly, Lifetime, and Custom plans are seeded. Limits cover users, branches, warehouses, POS devices, products, customers, suppliers, invoices, and storage bytes.

Billing is preview-only in Phase 28. It calculates expected subscription invoices and revenue but has no payment gateway and sends no payment request.
