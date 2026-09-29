begin;

create or replace function enforce_retention_hold_release_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.released_at is not null then
    raise exception 'Released retention holds are immutable';
  end if;
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.company_id is distinct from old.company_id
     or new.category is distinct from old.category
     or new.resource_id is distinct from old.resource_id
     or new.reason is distinct from old.reason
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Retention hold scope and evidence are immutable';
  end if;
  if new.released_at is null or new.released_by is null
     or length(btrim(coalesce(new.release_reason, ''))) < 3 then
    raise exception 'Releasing a retention hold requires an actor, timestamp, and reason';
  end if;
  return new;
end;
$$;

drop trigger if exists retention_holds_release_only on retention_holds;
create trigger retention_holds_release_only
before update on retention_holds
for each row execute function enforce_retention_hold_release_only();

commit;
