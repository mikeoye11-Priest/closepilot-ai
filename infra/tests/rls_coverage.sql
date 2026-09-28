-- Proves every public table is actually readable by the people who should read
-- it, and closed to everyone else.
--
-- Three tables shipped with row level security ENABLED and NO policies:
-- public.users, tenants and subscriptions. That state is not a lockdown, it is
-- a silent outage. PostgREST reports a blocked read as an EMPTY RESULT, never
-- an error, so an embedded join returns null and nothing anywhere complains.
--
-- The symptoms were: members listed by raw UUID because the join to users
-- returned nothing, and an invited member sent to onboarding to create their
-- own firm because tenants returned nothing. Both looked like missing data
-- rather than a permissions fault, which is why they survived review and
-- reached production.
--
-- Read-only: inspects catalogues only, mutates nothing.

do $$
declare
  v_offenders text;
  v_count int;
begin
  select count(*), string_agg(c.relname, ', ' order by c.relname)
    into v_count, v_offenders
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_policy p on p.polrelid = c.oid
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relrowsecurity            -- RLS on
    -- schema_migrations is deliberately outside the app's reach: it is written
    -- by the migration runner as the owner and never read through PostgREST.
    and c.relname <> 'schema_migrations'
  group by c.oid, c.relname
  having count(p.polname) = 0;

  if v_count is not null and v_count > 0 then
    raise exception 'RLS FAIL: % table(s) have row level security enabled with NO policies, so every read silently returns nothing: %', v_count, v_offenders;
  end if;

end $$;

select 'PASS: no public table has RLS enabled without policies.' as check_1;

do $$
declare
  v_offenders text;
  v_count int;
begin
  -- The opposite mistake: a tenant-scoped table with RLS switched off is
  -- readable by anyone holding the anon key, which is public by definition
  -- since it ships in the browser bundle.
  select count(*), string_agg(c.relname, ', ' order by c.relname)
    into v_count, v_offenders
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnum > 0
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not c.relrowsecurity;

  if v_count is not null and v_count > 0 then
    raise exception 'RLS FAIL: % tenant-scoped table(s) have row level security DISABLED and are readable with the public anon key: %', v_count, v_offenders;
  end if;

end $$;

select 'PASS: every tenant-scoped table has row level security enabled.' as check_2;
