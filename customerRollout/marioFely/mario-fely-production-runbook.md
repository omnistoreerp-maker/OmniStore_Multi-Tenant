# Mario Fely Production Runbook

1. Create a dedicated Supabase project.
2. Configure Edge Function secrets server-side; never paste service-role into the browser.
3. Open Go Live Center and validate the public connection fields.
4. Review Database Installer and Mario Fely Provisioning previews.
5. Create and verify a rollback point.
6. Authenticate as ERP platform owner.
7. Enable Phase 34 Production Mode using its exact confirmation.
8. Execute one controlled operation at a time and verify it before continuing.
9. Run Production Verification.
10. Record the audit and disable Production Mode.

No step is automatic. Stop immediately on partial failure and use the rollback plan.
