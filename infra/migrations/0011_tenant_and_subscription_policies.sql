-- Let a member read the firm they belong to.
--
-- tenants had row level security enabled and NO policies, so no signed-in user
-- could read a single row. buildSharedShell reads tenants with the caller's
-- own session to assemble a workspace for someone who has no personal
-- user_workspaces row - which is every invited member on their first sign-in.
-- It found nothing, returned null, and the client sent them to onboarding:
-- an invited preparer would have been asked to create a firm of their own
-- instead of seeing the one that invited them.
--
-- That is precisely the failure buildSharedShell exists to prevent, so the
-- multi-user work shipped today did not actually work for a second member.
-- Verified before the fix: the invited preparer could see 1 company and 1
-- grant, but 0 tenants.
--
-- Same silent shape as public.users in 0009: PostgREST reports a blocked read
-- as an empty result, never an error, so nothing anywhere complained.

drop policy if exists "Members can read their tenant" on tenants;
create policy "Members can read their tenant"
  on tenants for select
  using (has_tenant_access(id));

-- subscriptions had the same gap. Nothing reads it yet, so this is not a live
-- fault, but leaving a table permanently unreadable is a trap for whoever
-- wires up billing later - it will appear to work and return nothing.
alter table subscriptions enable row level security;

drop policy if exists "Members can read their tenant's subscription" on subscriptions;
create policy "Members can read their tenant's subscription"
  on subscriptions for select
  using (has_tenant_access(tenant_id));
