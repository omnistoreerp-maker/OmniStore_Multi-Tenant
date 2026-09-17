# Accounting Persistence Services

This service folder contains design-time helpers for Phase 11.

It does not connect to Supabase and does not execute SQL.

## Files

- `AccountingSchemaValidator.js`
- `JournalPersistencePreview.js`
- `PostingPersistenceMapper.js`
- `AccountingMigrationReadinessChecker.js`
- `AccountingRollbackPlanner.js`

## Purpose

- Validate draft schema files.
- Preview how Phase 8 vouchers could map into future persistence tables.
- Check migration readiness for manual review.
- Provide rollback planning.

## Non-Goals

- No real accounting posting.
- No database connection.
- No SQL execution.
- No UI integration.
