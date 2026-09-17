# Phase 36 Go Live — Customer #001 Mario Fely

This package prepares OmniStore ERP v1.0 and the Mario Fely rollout inside the Master project.

- Production Mode defaults OFF and is read from the controlled Phase 34 boundary.
- Public Supabase configuration is kept in memory and tested only after an explicit click.
- Service-role and JWT secrets are described only as server-side secrets.
- Database installation and Customer #001 provisioning are previews with zero execution.
- The customer package, release snapshot, verification checklist, runbook, and rollback plan are deterministic artifacts.

The Go Live layer does not import or modify Accounting, Inventory, Sales, Purchases, POS, Posting, reports logic, or business rules.
