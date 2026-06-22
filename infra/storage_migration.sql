-- Run this in Supabase SQL Editor after the core schema.
-- If CLOSEPILOT_UPLOAD_BUCKET is changed in the app, mirror that bucket name here.

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
    and has_company_access(
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
    and has_company_access(
      ((storage.foldername(name))[2])::uuid,
      ((storage.foldername(name))[4])::uuid
    )
  );
