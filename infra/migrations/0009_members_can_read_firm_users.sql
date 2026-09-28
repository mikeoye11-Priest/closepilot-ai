-- Let a member see who else is in their firm.
--
-- public.users has row level security enabled and NO policies at all, so no
-- signed-in user could read a single row. PostgREST does not error on that: an
-- embedded join just comes back null. The People page therefore listed members
-- by raw UUID, which tells a partner nothing about who has access to their
-- clients' data - the one question that page exists to answer.
--
-- Scoped to people who share a firm with the caller. has_tenant_access is
-- security definer, so it does not re-enter this policy.

drop policy if exists "Members can read users in their firm" on users;
create policy "Members can read users in their firm"
  on users for select
  using (
    -- Always your own row, even before any grant exists.
    id = auth.uid()
    -- Anyone holding a scope grant in a tenant you belong to.
    or exists (
      select 1 from user_scope_access scope
      where scope.user_id = users.id
        and has_tenant_access(scope.tenant_id)
    )
    -- Anyone holding a per-company grant in a tenant you belong to. Both grant
    -- kinds count, as they do everywhere else membership is decided.
    or exists (
      select 1 from user_company_access access
      where access.user_id = users.id
        and has_tenant_access(access.tenant_id)
    )
  );
