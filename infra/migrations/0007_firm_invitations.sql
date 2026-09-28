-- Invitations: the missing half of multi-user.
--
-- bootstrap_workspace grants a user_company_access row to the calling user and
-- nobody else, and there was no invite path anywhere, so a firm was one login.
-- docs/pilot-1/01-staging-access.md meanwhile asks for a partner, manager and
-- preparer to be named and their access tested.

create table if not exists firm_invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  email text not null,
  role text not null check (role in ('practice_admin', 'manager', 'preparer', 'client_user')),
  -- null invites to the whole firm; set scopes the invite to one branch.
  org_unit_id uuid null references org_units(id) on delete cascade,
  invited_by uuid not null references users(id),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  expires_at timestamptz not null default now() + interval '14 days',
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid null references users(id)
);

-- At most one live invitation per address per firm. Partial, so a revoked or
-- accepted invitation does not block re-inviting somebody later.
create unique index if not exists firm_invitations_pending_idx
  on firm_invitations (tenant_id, lower(email)) where status = 'pending';

-- Acceptance looks the invitation up by the signed-in user's verified email.
create index if not exists firm_invitations_email_idx on firm_invitations (lower(email));

-- As on user_scope_access: an invitation naming both a tenant and a unit must
-- agree on which tenant the unit is in, or accepting it would grant access
-- inside a different firm.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'firm_invitations_unit_same_tenant'
  ) then
    alter table firm_invitations
      add constraint firm_invitations_unit_same_tenant
      foreign key (org_unit_id, tenant_id)
      references org_units (id, tenant_id)
      on delete cascade;
  end if;
end $$;

alter table firm_invitations enable row level security;

-- Members can see their firm's invitations; the People page lists them.
drop policy if exists "Members can read their firm's invitations" on firm_invitations;
create policy "Members can read their firm's invitations"
  on firm_invitations for select
  using (has_tenant_access(tenant_id));

-- Writes go through the API with the service role, which bypasses RLS: issuing
-- and accepting both need to act before the invitee is a member of anything,
-- so there is deliberately no insert/update policy for ordinary callers.

/**
 * Accepts an invitation for the signed-in user.
 *
 * Runs as one transaction because a half-accepted invitation - a grant with no
 * user row, or an invitation marked accepted with no grant - leaves somebody
 * either locked out or silently privileged.
 *
 * Matching on the caller's email is safe only because Supabase's invite link
 * proves control of that address. The lookup is against auth.users, never a
 * value supplied by the caller.
 */
create or replace function accept_firm_invitation(p_invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_invite firm_invitations%rowtype;
begin
  select email into v_email from auth.users where id = auth.uid();
  if v_email is null then
    raise exception 'not authenticated';
  end if;

  -- Locked so two clicks on the same link cannot both pass the status check
  -- and produce two grants.
  select * into v_invite
  from firm_invitations
  where id = p_invitation_id
  for update;

  if v_invite.id is null then
    raise exception 'invitation not found';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'invitation is no longer pending';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'invitation has expired';
  end if;
  if lower(v_invite.email) <> lower(v_email) then
    raise exception 'invitation was issued to a different address';
  end if;

  -- The person may already exist from another firm: membership is many-to-many
  -- now, so this must not clobber their identity or their home tenant.
  insert into users (id, tenant_id, email, role, status)
  values (auth.uid(), v_invite.tenant_id, v_email, v_invite.role, 'active')
  on conflict (id) do update set status = 'active';

  insert into user_scope_access (user_id, tenant_id, org_unit_id, role)
  values (auth.uid(), v_invite.tenant_id, v_invite.org_unit_id, v_invite.role)
  on conflict do nothing;

  update firm_invitations
     set status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
   where id = v_invite.id;

  return v_invite.tenant_id;
end;
$$;

grant execute on function accept_firm_invitation(uuid) to authenticated;
