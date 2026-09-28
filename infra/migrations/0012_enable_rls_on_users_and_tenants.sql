-- Enable row level security on users and tenants in the schema itself.
--
-- Production has RLS on for both, but nothing in this repository turns it on:
-- infra/schema.sql creates the tables without it, and it was evidently enabled
-- by hand at some point. Rebuilding the schema from source on a clean database
-- therefore produced users and tenants with RLS OFF - readable by anyone
-- holding the anon key, which is public by definition because it ships in the
-- browser bundle. That is every member's email address and every firm's name.
--
-- Found by actually replaying the schema onto an empty Postgres rather than
-- reading it, and caught by infra/tests/rls_coverage.sql on its first run
-- against that rebuild. It matters now because separating ClosePilot onto its
-- own Supabase project means doing exactly that rebuild.
--
-- No-ops against production, where both are already enabled.

alter table users enable row level security;
alter table tenants enable row level security;
