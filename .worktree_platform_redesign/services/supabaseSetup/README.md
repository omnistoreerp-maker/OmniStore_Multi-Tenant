# Supabase Setup Preview

This package produces architecture, schema, RLS, tenant-table, and Edge Function plans only. It has no client import, URL, key, fetch call, database connection, or SQL executor.

The SQL files under `database/supabasePreview` are review artifacts. They are not imported by the application.

Future safe setup must keep privileged credentials in server-managed secrets, require an authenticated owner/admin, validate authorization in an Edge Function, execute reviewed files in a transaction, retain setup logs, and support rollback.
