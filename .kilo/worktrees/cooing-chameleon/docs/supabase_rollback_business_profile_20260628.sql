-- Non-destructive rollback guidance for the optional Business Profile migration.
-- Intentionally does not DROP, DELETE, UPDATE, or rename anything.
-- The application can be rolled back independently because it does not require
-- this table and continues to use LocalStorage/GitHub fallback data.

do $$
begin
  raise notice 'No database action performed. business_profile was preserved to prevent data loss.';
end
$$;
