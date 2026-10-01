import { findingEvidenceReference } from "@/lib/finding-workflow";
import type { Finding, FindingEvidenceRow } from "@/lib/types";

function evidenceRowPreview(row: FindingEvidenceRow) {
  const entries = Object.entries(row.sourceRow ?? {})
    .filter(([, value]) => String(value ?? "").trim())
    .slice(0, 4);
  return entries.length ? entries.map(([key, value]) => `${key}: ${value}`).join(" · ") : "Source row captured";
}

function evidenceCalculationLabel(row: FindingEvidenceRow) {
  const label = row.calculationInput?.label;
  return typeof label === "string" && label ? label : row.accountCode || "Evidence row";
}

function EvidenceSummaryLine({ label, value }: { label: string; value: string | number }) {
  return <div><span className="block text-xs font-bold uppercase text-muted">{label}</span><strong className="mt-1 block break-words">{value}</strong></div>;
}

export function EvidenceRowsPreview({ finding, compact = false }: { finding: Finding; compact?: boolean }) {
  const rows = finding.evidence.rows ?? [];
  const evidenceRef = findingEvidenceReference(finding);
  if (!rows.length) {
    return (
      <div className="mt-3 rounded-lg border border-dashed border-line bg-white p-3 text-xs text-muted">
        <p className="font-bold text-slate-700">No source rows were captured for this finding.</p>
        <p className="mt-1">Source: {evidenceRef.sourceFile}. Calculation: {evidenceRef.calculation}</p>
      </div>
    );
  }

  const visibleRows = compact ? rows.slice(0, 3) : rows.slice(0, 8);
  return (
    <div className="mt-3 rounded-lg border border-line bg-white">
      <div className="flex flex-col gap-1 border-b border-line p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase text-muted">Source Rows</p>
          <p className="mt-1 text-sm font-semibold">{evidenceRef.sourceFile}</p>
        </div>
        <p className="text-xs text-muted">{rows.length} row{rows.length !== 1 ? "s" : ""} captured{compact && rows.length > visibleRows.length ? `, showing ${visibleRows.length}` : ""}</p>
      </div>
      <div className="grid gap-2 border-b border-line bg-slate-50 p-3 text-xs sm:grid-cols-3">
        <EvidenceSummaryLine label="Rows" value={evidenceRef.rowIndexes} />
        <EvidenceSummaryLine label="Account / Party" value={evidenceRef.accountOrParty} />
        <EvidenceSummaryLine label="Calculation" value={evidenceRef.calculation} />
      </div>
      <ul className="grid gap-2 p-3 md:hidden" data-testid="evidence-row-cards">
        {visibleRows.map((row, index) => (
          <li key={`${row.sourceFile}-${row.rowIndex ?? "row"}-${index}`} className="rounded-lg border border-line bg-slate-50 p-3 text-xs">
            <div className="flex items-start justify-between gap-3"><strong className="break-words">{evidenceCalculationLabel(row)}</strong><span className="shrink-0 font-bold">{typeof row.amount === "number" ? `£${Math.round(Math.abs(row.amount)).toLocaleString("en-GB")}` : "—"}</span></div>
            <dl className="mt-3 grid grid-cols-2 gap-3">
              <div><dt className="font-bold uppercase text-muted">Row</dt><dd className="mt-1 font-mono">{row.sheetName ? `${row.sheetName} · ` : ""}{row.rowIndex ? `#${row.rowIndex}` : "n/a"}</dd></div>
              <div><dt className="font-bold uppercase text-muted">Account / Party</dt><dd className="mt-1">{row.accountCode || "—"}</dd></div>
              <div className="col-span-2"><dt className="font-bold uppercase text-muted">Source values</dt><dd className="mt-1 break-words">{evidenceRowPreview(row)}</dd></div>
            </dl>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[920px] border-collapse text-left text-xs">
          <thead className="bg-slate-50 uppercase text-muted"><tr><th className="border-b border-line p-2">Source File</th><th className="border-b border-line p-2">Row</th><th className="border-b border-line p-2">Calculation Input</th><th className="border-b border-line p-2">Account / Party</th><th className="border-b border-line p-2">Amount</th><th className="border-b border-line p-2">Raw Source Values</th></tr></thead>
          <tbody>
            {visibleRows.map((row, index) => (
              <tr key={`${row.sourceFile}-${row.rowIndex ?? "row"}-${index}`}>
                <td className="border-b border-line p-2 font-semibold">{row.sourceFile || evidenceRef.sourceFile}</td>
                <td className="border-b border-line p-2 font-mono">{row.sheetName ? `${row.sheetName} · ` : ""}{row.rowIndex ? `#${row.rowIndex}` : "n/a"}</td>
                <td className="border-b border-line p-2 font-semibold">{evidenceCalculationLabel(row)}</td>
                <td className="border-b border-line p-2">{row.accountCode || "—"}</td>
                <td className="border-b border-line p-2">{typeof row.amount === "number" ? `£${Math.round(Math.abs(row.amount)).toLocaleString("en-GB")}` : "—"}</td>
                <td className="border-b border-line p-2">{evidenceRowPreview(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
