// Month-end close adviser insights.
//
// Synthesises what stands between the ledger and a clean month-end close:
// outstanding close tasks (recommendations), failed control reconciliations, and
// open critical/high findings — prioritised and explained, with a grounded fact
// sheet. Deterministic.

import type { Finding, Recommendation, ValidationCheck } from "./types";
import type { FinanceSignal } from "./finance-insights";

export type CloseInsights = { headline: string; signals: FinanceSignal[]; factSheet: string; openTasks: number; available: boolean };

const CLOSED = new Set(["resolved", "approved", "closed", "false_positive", "accepted_risk", "accepted", "rejected", "not_applicable"]);
const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, positive: 3, info: 4 };

const RECONCILIATIONS = [
  { label: "Trial balance", patterns: ["trial balance balances"] },
  { label: "VAT control", patterns: ["vat report agrees", "vat control"] },
  { label: "AR control", patterns: ["ar ledger agrees", "debtors control"] },
  { label: "AP control", patterns: ["ap ledger agrees", "creditors control"] },
  { label: "Bank reconciliation", patterns: ["bank reconciliation", "cash accounts ready"] },
];

function checkStatus(checks: ValidationCheck[], patterns: string[]): string | undefined {
  const match = checks.find((check) => patterns.some((p) => String(check.name ?? "").toLowerCase().includes(p)));
  return match?.status;
}

export function buildCloseInsights(findings: Finding[], recommendations: Recommendation[], validationChecks: ValidationCheck[]): CloseInsights {
  const openTasks = (recommendations ?? []).filter((r) => !r.completed);
  const openFindings = (findings ?? []).filter((f) => !CLOSED.has(f.status));
  const openCritical = openFindings.filter((f) => f.severity === "critical").length;
  const openHigh = openFindings.filter((f) => f.severity === "high").length;
  const failedRecon = RECONCILIATIONS
    .map((r) => ({ ...r, status: checkStatus(validationChecks, r.patterns) }))
    .filter((r) => r.status && r.status !== "passed");

  if (!openTasks.length && !openFindings.length && !validationChecks.length) {
    return { headline: "Upload a finance pack to assess close readiness.", signals: [], factSheet: "", openTasks: 0, available: false };
  }

  const signals: FinanceSignal[] = [];

  if (openCritical > 0) {
    signals.push({ severity: "critical", area: "Findings", title: `${openCritical} critical finding${openCritical === 1 ? "" : "s"} block the close`, detail: "Critical exceptions remain unresolved.", action: "Resolve or document accepted risk before closing the period." });
  }
  for (const recon of failedRecon) {
    signals.push({ severity: "high", area: "Reconciliation", title: `${recon.label} not reconciled`, detail: `The ${recon.label.toLowerCase()} control check has not passed.`, action: "Complete and evidence this reconciliation before closing." });
  }
  const highTasks = openTasks.filter((r) => r.priority === "high");
  if (openTasks.length > 0) {
    signals.push({ severity: highTasks.length ? "high" : "medium", area: "Tasks", title: `${openTasks.length} close task${openTasks.length === 1 ? "" : "s"} outstanding`, detail: highTasks.length ? `Including ${highTasks.length} high-priority: ${highTasks.slice(0, 2).map((t) => t.action).join("; ")}` : openTasks.slice(0, 2).map((t) => t.action).join("; "), action: "Work through the outstanding close tasks and mark them complete." });
  }
  if (openHigh > 0) {
    signals.push({ severity: "high", area: "Findings", title: `${openHigh} high-severity finding${openHigh === 1 ? "" : "s"} open`, detail: "High-risk exceptions still need a reviewer decision.", action: "Clear these before sign-off." });
  }
  if (!openTasks.length && !failedRecon.length && openCritical === 0 && openHigh === 0) {
    signals.push({ severity: "positive", area: "Close", title: "Ready to close", detail: "Tasks are complete, controls reconcile and no critical/high exceptions remain.", action: "Lock the period and issue the close pack." });
  }

  signals.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const blockers = openTasks.length + failedRecon.length + openCritical;
  const headline = blockers > 0
    ? `Close not ready — ${openTasks.length} task${openTasks.length === 1 ? "" : "s"}, ${failedRecon.length} reconciliation${failedRecon.length === 1 ? "" : "s"} and ${openCritical} critical finding${openCritical === 1 ? "" : "s"} outstanding.`
    : "Ready to close — tasks done, controls reconcile and no critical exceptions remain.";

  const factSheet = [
    `CLOSE READINESS`,
    `Outstanding close tasks: ${openTasks.length} (high priority: ${highTasks.length})`,
    `Failed control reconciliations: ${failedRecon.length ? failedRecon.map((r) => r.label).join(", ") : "none"}`,
    `Open findings: ${openFindings.length} (critical ${openCritical}, high ${openHigh})`,
    "",
    "OUTSTANDING TASKS:",
    ...(openTasks.length ? openTasks.slice(0, 8).map((t) => `- [${t.priority}] ${t.action}`) : ["- none"]),
  ].join("\n");

  return { headline, signals, factSheet, openTasks: openTasks.length, available: signals.length > 0 };
}
