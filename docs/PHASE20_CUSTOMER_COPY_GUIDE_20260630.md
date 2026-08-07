# Safe Customer Copy Guide

1. Start from an approved Master release snapshot.
2. Select a brand-new, empty destination outside the Master project.
3. Never overwrite an existing customer directory.
4. Copy only the approved release files.
5. Fill `templates/customerCopy/` inside the new copy.
6. Keep `computer_shop` as the default business type unless another type is approved.
7. Keep UAT/Beta and Preview Only safety labels visible.
8. Run the complete regression suite in the customer copy.
9. Review customer branding, workflows, reports, training, limitations, and sign-off.
10. Document source version, destination, creation date, test result, and rollback owner.

## Never change in Master

- Customer identity or contact data
- Customer-specific credentials or connection settings
- Core POS, Sales, Purchases, Inventory, or Reports logic
- Tests, reports, rollback files, or UAT safety labels
- SQL, migration, or posting state

This guide is planning documentation only and does not execute a copy.
