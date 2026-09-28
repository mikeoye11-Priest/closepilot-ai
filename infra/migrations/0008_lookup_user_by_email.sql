-- Resolve an auth user by email, for the invitation path.
--
-- Inviting somebody who already has a ClosePilot account is a NORMAL case now
-- that membership is many-to-many: an accountant who uses ClosePilot at one
-- firm and is invited to a second has an account already. Supabase's
-- inviteUserByEmail refuses those addresses, so without this the invitation
-- was recorded, no email was sent, and the invitee had no way to know.
--
-- Granting them access directly needs their user id. The admin API has no
-- lookup by email - only listUsers, which pages through every user in the
-- project and would get slower as the product grows. This is an indexed
-- single-row lookup instead.

create or replace function lookup_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = auth, public
stable
as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;

-- Deliberately NOT callable by ordinary signed-in users: it answers "does an
-- account exist for this address", which is exactly what the rest of the auth
-- surface is careful never to reveal. Only the service role, used server-side
-- inside the invite route, may call it.
revoke all on function lookup_user_id_by_email(text) from public;
revoke all on function lookup_user_id_by_email(text) from anon;
revoke all on function lookup_user_id_by_email(text) from authenticated;
grant execute on function lookup_user_id_by_email(text) to service_role;
