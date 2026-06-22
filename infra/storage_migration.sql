-- Run this in Supabase SQL Editor after the core schema.
-- If CLOSEPILOT_UPLOAD_BUCKET is changed in the app, mirror that bucket name here.

do $$
begin
  if to_regclass('public.users') is null
    or to_regclass('public.user_company_access') is null then
    raise exception 'ClosePilot core schema is required before the storage migration.';
  end if;
end
$$;

create or replace function public.has_company_access(p_tenant_id uuid, p_company_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.user_company_access access
    join public.users app_user on app_user.id = access.user_id
    where app_user.id = auth.uid()
      and access.tenant_id = p_tenant_id
      and access.company_id = p_company_id
      and app_user.status = 'active'
  );
$$;

grant execute on function public.has_company_access(uuid, uuid) to authenticated;

insert into storage.buckets (id, name, public)
values ('finance-uploads', 'finance-uploads', false)
on conflict (id) do nothing;

drop policy if exists "Users can upload scoped finance files" on storage.objects;
create policy "Users can upload scoped finance files"
  on storage.objects for insert
  with check (
    bucket_id = 'finance-uploads'
    and (storage.foldername(name))[1] = 'tenants'
    and (storage.foldername(name))[3] = 'companies'
    and public.has_company_access(
      ((storage.foldername(name))[2])::uuid,
      ((storage.foldername(name))[4])::uuid
    )
  );

drop policy if exists "Users can read scoped finance files" on storage.objects;
create policy "Users can read scoped finance files"
  on storage.objects for select
  using (
    bucket_id = 'finance-uploads'
    and (storage.foldername(name))[1] = 'tenants'
    and (storage.foldername(name))[3] = 'companies'
    and public.has_company_access(
      ((storage.foldername(name))[2])::uuid,
      ((storage.foldername(name))[4])::uuid
    )
  );
