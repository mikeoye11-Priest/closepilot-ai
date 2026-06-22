-- Run this in Supabase SQL Editor for existing ClosePilot databases.
alter table reports add column if not exists title text;
alter table reports add column if not exists export_status text not null default 'draft';
alter table reports add column if not exists metadata jsonb not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'audit_logs'
      and policyname = 'Users can add own audit logs'
  ) then
    create policy "Users can add own audit logs"
      on audit_logs for insert
      with check (user_id = auth.uid());
  end if;
end
$$;
