-- Free an email address when the auth account behind it is deleted.
--
-- public.users has no foreign key to auth.users, so deleting someone from
-- Supabase Auth leaves their public row behind. That row holds a UNIQUE email,
-- which means the address can never be used again: re-inviting the same person
-- creates a NEW auth id, and accept_firm_invitation's insert then fails on
-- users_email_key. The invitation is accepted from the user's point of view
-- and silently does nothing.
--
-- A cascading foreign key is not the answer. public.users is referenced by ten
-- tables - findings, comments, activities, review events, audit logs - almost
-- all ON DELETE NO ACTION, deliberately, so that removing a person cannot take
-- the audit trail with them. Cascading would instead make deleting any user
-- with history fail outright.
--
-- So the row stays and becomes a tombstone: the history it anchors is intact,
-- and the address is released.

create or replace function tombstone_orphaned_user(p_email text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  update users
     set email = 'deleted+' || id::text || '@closepilot.invalid',
         status = 'inactive',
         tenant_id = null
   where lower(email) = lower(trim(p_email))
     -- Only when the account really is gone. A live user must never have
     -- their address taken away.
     and not exists (select 1 from auth.users a where a.id = users.id);
end;
$$;

revoke all on function tombstone_orphaned_user(text) from public;
revoke all on function tombstone_orphaned_user(text) from anon;
revoke all on function tombstone_orphaned_user(text) from authenticated;
grant execute on function tombstone_orphaned_user(text) to service_role;

-- Accepting an invitation now clears any tombstone-able row for that address
-- first, so a re-invited person can actually get in.
create or replace function accept_firm_invitation(p_invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
  v_invite firm_invitations%rowtype;
begin
  select email into v_email from auth.users where id = auth.uid();
  if v_email is null then
    raise exception 'not authenticated';
  end if;

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

  -- Release the address from any row whose auth account no longer exists,
  -- otherwise the insert below fails on the unique email and the acceptance
  -- is lost.
  perform tombstone_orphaned_user(v_email);

  insert into users (id, tenant_id, email, role, status)
  values (auth.uid(), v_invite.tenant_id, v_email, v_invite.role, 'active')
  on conflict (id) do update set status = 'active', email = excluded.email;

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

-- One-off: release addresses already stranded by a deletion. Idempotent - it
-- only touches rows whose auth account is gone, and a tombstoned address no
-- longer matches any real one.
update users
   set email = 'deleted+' || id::text || '@closepilot.invalid',
       status = 'inactive',
       tenant_id = null
 where not exists (select 1 from auth.users a where a.id = users.id)
   and email not like 'deleted+%@closepilot.invalid';
