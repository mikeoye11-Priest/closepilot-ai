-- Per-company analysis snapshots, moved out of the single workspace blob.
--
-- user_workspaces.data holds the whole workspace as one JSON document, keyed by
-- user, including companySnapshots: every client's uploads, findings, evidence,
-- comments, activities, collections, recommendations, VAT review and statements.
-- The client loads all of it to show one company, rewrites all of it on every
-- edit, and mirrors all of it into localStorage - which throws past roughly 5MB.
-- At 15 branches of 100 clients that is unusable, and it also means two partners
-- in one firm hold independent copies of the firm's data.
--
-- Snapshots are the bulk of that payload, so they move to a row per company.
-- The shell (tenant, companies, org units, schedules) stays small enough to load
-- whole.

create table if not exists company_snapshots (
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (company_id)
);

-- A practice-wide sweep (scheduled reports, portfolio rollups) filters by
-- tenant; without this it scans every snapshot row in the table.
create index if not exists company_snapshots_tenant_idx on company_snapshots (tenant_id);

-- Keyed by company, not by user: a snapshot is the firm's record of a client's
-- review, not one person's copy. Two partners now see the same data, which the
-- per-user blob could never do. Access is therefore the existing per-company
-- rule rather than auth.uid() = user_id.
alter table company_snapshots enable row level security;

drop policy if exists "Users can read snapshots they can access" on company_snapshots;
create policy "Users can read snapshots they can access"
  on company_snapshots for select
  using (has_company_access(tenant_id, company_id));

drop policy if exists "Users can write snapshots they can access" on company_snapshots;
create policy "Users can write snapshots they can access"
  on company_snapshots for insert
  with check (has_company_access(tenant_id, company_id));

drop policy if exists "Users can update snapshots they can access" on company_snapshots;
create policy "Users can update snapshots they can access"
  on company_snapshots for update
  using (has_company_access(tenant_id, company_id))
  with check (has_company_access(tenant_id, company_id));
