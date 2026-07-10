-- 0002_reconcile_rls_policies
-- Reconciles production with every RLS policy defined in infra/schema.sql.
-- schema.sql was applied to prod partially, leaving ~10 tables with RLS enabled
-- but NO policies (deny-all) — silently blocking the app's relational writes
-- (e.g. /api/analysis-results -> findings/evidence/recommendations).
--
-- Fully idempotent: enable-RLS is a no-op when already on, and every policy is
-- dropped-if-exists before being (re)created. Definitions are verbatim from
-- infra/schema.sql. Safe to run repeatedly.

-- ── Ensure RLS is enabled everywhere ─────────────────────────────────────────
alter table companies              enable row level security;
alter table user_company_access    enable row level security;
alter table rule_registry          enable row level security;
alter table uploads                enable row level security;
alter table analysis_jobs          enable row level security;
alter table findings               enable row level security;
alter table finding_evidence_rows  enable row level security;
alter table finding_comments       enable row level security;
alter table finding_activities     enable row level security;
alter table partner_signoffs       enable row level security;
alter table finding_review_events  enable row level security;
alter table validation_checks      enable row level security;
alter table recommendations        enable row level security;
alter table finance_health_scores  enable row level security;
alter table cashflow_forecasts     enable row level security;
alter table reports                enable row level security;
alter table ai_conversations       enable row level security;
alter table audit_logs             enable row level security;
alter table accounting_integrations enable row level security;
alter table accounting_sync_runs   enable row level security;

-- ── companies ────────────────────────────────────────────────────────────────
drop policy if exists "Users can read companies they can access" on companies;
create policy "Users can read companies they can access"
  on companies for select using (has_company_access(tenant_id, id));

-- ── user_company_access ─────────────────────────────────────────────────────
drop policy if exists "Users can read their company access" on user_company_access;
create policy "Users can read their company access"
  on user_company_access for select using (user_id = auth.uid());

-- ── rule_registry ────────────────────────────────────────────────────────────
drop policy if exists "Users can read active rules" on rule_registry;
create policy "Users can read active rules"
  on rule_registry for select using (active = true);

-- ── uploads ──────────────────────────────────────────────────────────────────
drop policy if exists "Users can read scoped uploads" on uploads;
create policy "Users can read scoped uploads"
  on uploads for select using (has_company_access(tenant_id, company_id));
drop policy if exists "Users can add scoped uploads" on uploads;
create policy "Users can add scoped uploads"
  on uploads for insert with check (has_company_access(tenant_id, company_id));
drop policy if exists "Users can update scoped uploads" on uploads;
create policy "Users can update scoped uploads"
  on uploads for update using (has_company_access(tenant_id, company_id))
  with check (has_company_access(tenant_id, company_id));
drop policy if exists "Users can delete scoped uploads" on uploads;
create policy "Users can delete scoped uploads"
  on uploads for delete using (has_company_access(tenant_id, company_id));

-- ── analysis_jobs ────────────────────────────────────────────────────────────
drop policy if exists "Users can read scoped analysis jobs" on analysis_jobs;
create policy "Users can read scoped analysis jobs"
  on analysis_jobs for select using (has_company_access(tenant_id, company_id));
drop policy if exists "Users can add scoped analysis jobs" on analysis_jobs;
create policy "Users can add scoped analysis jobs"
  on analysis_jobs for insert with check (has_company_access(tenant_id, company_id));
drop policy if exists "Users can update scoped analysis jobs" on analysis_jobs;
create policy "Users can update scoped analysis jobs"
  on analysis_jobs for update using (has_company_access(tenant_id, company_id))
  with check (has_company_access(tenant_id, company_id));

-- ── findings ─────────────────────────────────────────────────────────────────
drop policy if exists "Users can read scoped findings" on findings;
create policy "Users can read scoped findings"
  on findings for select using (has_company_access(tenant_id, company_id));
drop policy if exists "Users can add scoped findings" on findings;
create policy "Users can add scoped findings"
  on findings for insert with check (has_company_access(tenant_id, company_id));
drop policy if exists "Users can update scoped findings" on findings;
create policy "Users can update scoped findings"
  on findings for update using (has_company_access(tenant_id, company_id))
  with check (has_company_access(tenant_id, company_id));

-- ── finding_evidence_rows ────────────────────────────────────────────────────
drop policy if exists "Users can read scoped finding evidence" on finding_evidence_rows;
create policy "Users can read scoped finding evidence"
  on finding_evidence_rows for select using (has_company_access(tenant_id, company_id));
drop policy if exists "Users can add scoped finding evidence" on finding_evidence_rows;
create policy "Users can add scoped finding evidence"
  on finding_evidence_rows for insert with check (has_company_access(tenant_id, company_id));

-- ── finding_comments ─────────────────────────────────────────────────────────
drop policy if exists "Users can read scoped finding comments" on finding_comments;
create policy "Users can read scoped finding comments"
  on finding_comments for select using (has_company_access(tenant_id, company_id));
drop policy if exists "Users can add scoped finding comments" on finding_comments;
create policy "Users can add scoped finding comments"
  on finding_comments for insert with check (has_company_access(tenant_id, company_id) and user_id = auth.uid());

-- ── finding_activities ───────────────────────────────────────────────────────
drop policy if exists "Users can read scoped finding activities" on finding_activities;
create policy "Users can read scoped finding activities"
  on finding_activities for select using (has_company_access(tenant_id, company_id));
drop policy if exists "Users can add scoped finding activities" on finding_activities;
create policy "Users can add scoped finding activities"
  on finding_activities for insert with check (has_company_access(tenant_id, company_id) and user_id = auth.uid());

-- ── partner_signoffs ─────────────────────────────────────────────────────────
drop policy if exists "Users can read scoped partner signoffs" on partner_signoffs;
create policy "Users can read scoped partner signoffs"
  on partner_signoffs for select using (has_company_access(tenant_id, company_id));
drop policy if exists "Users can add scoped partner signoffs" on partner_signoffs;
create policy "Users can add scoped partner signoffs"
  on partner_signoffs for insert with check (has_company_access(tenant_id, company_id));

-- ── finding_review_events ────────────────────────────────────────────────────
drop policy if exists "Users can read scoped review events" on finding_review_events;
create policy "Users can read scoped review events"
  on finding_review_events for select using (has_company_access(tenant_id, company_id));
drop policy if exists "Users can add scoped review events" on finding_review_events;
create policy "Users can add scoped review events"
  on finding_review_events for insert with check (has_company_access(tenant_id, company_id) and user_id = auth.uid());

-- ── validation_checks ────────────────────────────────────────────────────────
drop policy if exists "Users can read scoped validation checks" on validation_checks;
create policy "Users can read scoped validation checks"
  on validation_checks for select using (has_company_access(tenant_id, company_id));
drop policy if exists "Users can add scoped validation checks" on validation_checks;
create policy "Users can add scoped validation checks"
  on validation_checks for insert with check (has_company_access(tenant_id, company_id));

-- ── recommendations ──────────────────────────────────────────────────────────
drop policy if exists "Users can read scoped recommendations" on recommendations;
create policy "Users can read scoped recommendations"
  on recommendations for select using (has_company_access(tenant_id, company_id));
drop policy if exists "Users can add scoped recommendations" on recommendations;
create policy "Users can add scoped recommendations"
  on recommendations for insert with check (has_company_access(tenant_id, company_id));
drop policy if exists "Users can update scoped recommendations" on recommendations;
create policy "Users can update scoped recommendations"
  on recommendations for update using (has_company_access(tenant_id, company_id))
  with check (has_company_access(tenant_id, company_id));

-- ── finance_health_scores ────────────────────────────────────────────────────
drop policy if exists "Users can read scoped finance scores" on finance_health_scores;
create policy "Users can read scoped finance scores"
  on finance_health_scores for select using (has_company_access(tenant_id, company_id));
drop policy if exists "Users can add scoped finance scores" on finance_health_scores;
create policy "Users can add scoped finance scores"
  on finance_health_scores for insert with check (has_company_access(tenant_id, company_id));

-- ── cashflow_forecasts ───────────────────────────────────────────────────────
drop policy if exists "Users can read scoped cash forecasts" on cashflow_forecasts;
create policy "Users can read scoped cash forecasts"
  on cashflow_forecasts for select using (has_company_access(tenant_id, company_id));
drop policy if exists "Users can add scoped cash forecasts" on cashflow_forecasts;
create policy "Users can add scoped cash forecasts"
  on cashflow_forecasts for insert with check (has_company_access(tenant_id, company_id));

-- ── reports ──────────────────────────────────────────────────────────────────
drop policy if exists "Users can read scoped reports" on reports;
create policy "Users can read scoped reports"
  on reports for select using (has_company_access(tenant_id, company_id));
drop policy if exists "Users can add scoped reports" on reports;
create policy "Users can add scoped reports"
  on reports for insert with check (has_company_access(tenant_id, company_id));

-- ── ai_conversations ─────────────────────────────────────────────────────────
drop policy if exists "Users can read scoped AI conversations" on ai_conversations;
create policy "Users can read scoped AI conversations"
  on ai_conversations for select using (has_company_access(tenant_id, company_id));
drop policy if exists "Users can add scoped AI conversations" on ai_conversations;
create policy "Users can add scoped AI conversations"
  on ai_conversations for insert with check (has_company_access(tenant_id, company_id) and user_id = auth.uid());

-- ── audit_logs ───────────────────────────────────────────────────────────────
drop policy if exists "Users can read own audit logs" on audit_logs;
create policy "Users can read own audit logs"
  on audit_logs for select using (user_id = auth.uid());
drop policy if exists "Users can add own audit logs" on audit_logs;
create policy "Users can add own audit logs"
  on audit_logs for insert with check (user_id = auth.uid());

-- ── accounting_integrations / accounting_sync_runs ───────────────────────────
drop policy if exists "Users can manage scoped accounting integrations" on accounting_integrations;
create policy "Users can manage scoped accounting integrations"
  on accounting_integrations for all
  using (has_company_access(tenant_id, company_id) and user_id = auth.uid())
  with check (has_company_access(tenant_id, company_id) and user_id = auth.uid());

drop policy if exists "Users can manage scoped accounting sync runs" on accounting_sync_runs;
create policy "Users can manage scoped accounting sync runs"
  on accounting_sync_runs for all
  using (has_company_access(tenant_id, company_id))
  with check (has_company_access(tenant_id, company_id));
