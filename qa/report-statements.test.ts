import test from "node:test";
import assert from "node:assert/strict";
import { loadReportStatements } from "../apps/web/lib/report-statements";

// Minimal chainable Supabase stub: records .eq() filters and resolves the query to
// the latest (started_at desc) matching accounting_sync_runs row; user_workspaces
// resolves empty so the sync-run path is what's under test.
type Run = { tenant_id: string; company_id: string; provider: string; status: string; started_at: string; result_summary: unknown };
function stub(runs: Run[]) {
  const state = { table: "", filters: {} as Record<string, unknown> };
  const builder: Record<string, unknown> = {
    from(t: string) { state.table = t; state.filters = {}; return builder; },
    select() { return builder; },
    order() { return builder; },
    limit() { return builder; },
    eq(col: string, val: unknown) { state.filters[col] = val; return builder; },
    then(resolve: (v: { data: unknown[] }) => void) {
      if (state.table !== "accounting_sync_runs") return resolve({ data: [] });
      const matched = runs
        .filter((r) => Object.entries(state.filters).every(([k, v]) => (r as Record<string, unknown>)[k] === v))
        .sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
      resolve({ data: matched.slice(0, 1) });
    },
  };
  return builder as never;
}

const bs = (sourceProvider?: string) => ({ statements: { asOfDate: "2026-05-31", ...(sourceProvider ? { sourceProvider } : {}), balanceSheet: [{ category: "Current Assets", item: "Cash", amount: "1" }], profitLoss: [] }, analysis: { findings: [] } });
const opts = { userId: "u", tenantId: "t", companyId: "c" };

test("a report scoped to QuickBooks never returns the Xero run (no cross-provider leak)", async () => {
  const runs: Run[] = [
    { tenant_id: "t", company_id: "c", provider: "xero", status: "completed", started_at: "2026-06-02", result_summary: bs("xero") },       // newer
    { tenant_id: "t", company_id: "c", provider: "quickbooks", status: "completed", started_at: "2026-06-01", result_summary: bs("quickbooks") }, // older
  ];
  const loaded = await loadReportStatements(stub(runs), { ...opts, provider: "quickbooks" });
  assert.equal(loaded?.source, "quickbooks", "source is the requested provider, not xero");
  assert.equal(loaded?.statements.sourceProvider, "quickbooks");
});

test("without a provider the latest run is returned, labelled by its real provider (not hardcoded xero)", async () => {
  const runs: Run[] = [
    { tenant_id: "t", company_id: "c", provider: "quickbooks", status: "completed", started_at: "2026-06-02", result_summary: bs("quickbooks") },
  ];
  const loaded = await loadReportStatements(stub(runs), opts);
  assert.equal(loaded?.source, "quickbooks", "the run's actual provider, not the old hardcoded 'xero'");
});

test("a provider with no completed run does not fall through to another provider's data", async () => {
  const runs: Run[] = [
    { tenant_id: "t", company_id: "c", provider: "xero", status: "completed", started_at: "2026-06-02", result_summary: bs("xero") },
  ];
  // Request QuickBooks — there is no QuickBooks run, so it must NOT return the Xero one.
  const loaded = await loadReportStatements(stub(runs), { ...opts, provider: "quickbooks" });
  assert.equal(loaded, null, "no QuickBooks data → null, never the Xero run");
});

test("source falls back to the run's provider column when statements carry no provenance", async () => {
  const runs: Run[] = [
    { tenant_id: "t", company_id: "c", provider: "sage", status: "completed", started_at: "2026-06-02", result_summary: bs() },
  ];
  const loaded = await loadReportStatements(stub(runs), { ...opts, provider: "sage" });
  assert.equal(loaded?.source, "sage");
});
