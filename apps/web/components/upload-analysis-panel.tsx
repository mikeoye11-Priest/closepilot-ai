"use client";

import { useState, type ReactNode } from "react";
import { formatUploadBytes } from "@/lib/upload-capacity";
import type { Finding, ImportMappingProfile, Recommendation, RiskLevel, Upload, ValidationCheck, ValidationStatus } from "@/lib/types";

export type UploadJobState = {
  id: string;
  status: string;
  progressPercent: number;
  currentStage: string;
  bytesProcessed?: number;
  rowsProcessed?: number;
  error?: string | null;
  resultSummary?: Record<string, unknown>;
};

const uploadTypeLabels: Record<Upload["fileType"], string> = {
  trial_balance: "Trial Balance",
  profit_loss: "P&L",
  balance_sheet: "Balance Sheet",
  aged_debtors: "Aged Debtors",
  aged_creditors: "Aged Creditors",
  vat_report: "VAT Report",
  bank_reconciliation: "Bank Reconciliation",
  cashflow_forecast: "Cashflow Forecast",
  payroll_summary: "Payroll Summary",
  fixed_asset_register: "Fixed Asset Register",
  inventory_report: "Inventory & WIP",
};
const coreUploadTypes: Upload["fileType"][] = ["trial_balance", "profit_loss", "balance_sheet", "aged_debtors", "aged_creditors", "vat_report"];

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-xl border border-line bg-surface p-5 shadow-card"><div className="mb-4 flex items-center gap-2.5"><span className="h-4 w-1 rounded-full bg-gradient-to-b from-cyan to-brand" aria-hidden="true" /><h2 className="text-[15px] font-bold tracking-tight text-ink">{title}</h2></div>{children}</section>;
}
function Pill({ level, children }: { level: string; children: ReactNode }) {
  const colors: Record<string, string> = { low: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", medium: "bg-amber-50 text-amber-700 ring-amber-600/20", high: "bg-red-50 text-red-700 ring-red-600/20", critical: "bg-red-50 text-red-700 ring-red-600/20", none: "bg-slate-100 text-slate-500 ring-slate-500/20" };
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold capitalize leading-none ring-1 ring-inset ${colors[level] || colors.medium}`}>{children}</span>;
}
function MetricTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="rounded-xl border border-line bg-slate-50/70 p-4"><p className="text-xs font-bold uppercase text-muted">{label}</p><strong className="mt-2 block text-2xl font-black">{value}</strong><p className="mt-1 text-xs text-muted">{sub}</p></div>;
}
function Metric({ title, value, detail, tone }: { title: string; value: string | number; detail: string; tone: RiskLevel }) {
  const border = tone === "low" ? "border-l-green" : tone === "medium" ? "border-l-amber" : "border-l-red";
  const soft = tone === "low" ? "from-emerald-50" : tone === "medium" ? "from-amber-50" : "from-red-50";
  return <article className={`min-h-32 rounded-xl border border-l-4 border-line bg-gradient-to-br ${soft} to-white p-4 shadow-card ${border}`}><p className="text-sm font-bold text-muted">{title}</p><strong className="mt-3 block break-words text-3xl font-black leading-none tracking-tight text-ink">{value}</strong><span className="mt-2 block text-sm text-muted">{detail}</span></article>;
}
function ValidationPill({ status }: { status: ValidationStatus | "warning" | "passed" | "failed" }) {
  const level = status === "passed" ? "low" : status === "warning" ? "medium" : "critical";
  return <Pill level={level}>{status}</Pill>;
}

export function UploadList({ uploads, onDelete, onClear }: { uploads: Upload[]; onDelete?: (id: string) => void; onClear?: () => void }) {
  if (uploads.length === 0) return <p className="py-4 text-center text-sm text-muted">No files uploaded yet.</p>;
  return (
    <div className="grid gap-3">
      {onClear && (
        <div className="flex justify-end">
          <button
            className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 transition-colors hover:bg-red-50"
            onClick={() => {
              if (confirm("Clear this review and remove all uploaded data, findings, scores, VAT review and recommendations?")) {
                onClear();
              }
            }}
          >
            Clear Review
          </button>
        </div>
      )}
      {uploads.map((upload) => (
        <div key={upload.id} className="flex items-center justify-between gap-3 rounded-lg border border-line p-3">
          <div className="min-w-0">
            <strong className="block truncate">{upload.fileName}</strong>
            <p className="text-sm text-muted">{uploadTypeLabels[upload.fileType]} · {upload.uploadedAt}{upload.rowCount !== undefined ? ` · ${upload.rowCount} rows` : ""}</p>
            {upload.mappingProfileName && (
              <p className="mt-1 text-xs text-muted">
                {upload.mappingProfileName} · {upload.mappingConfidence ?? 0}% mapping · {upload.importConfidence ?? upload.mappingConfidence ?? 0}% import · {(upload.importGateStatus ?? "review_required").replaceAll("_", " ")}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Pill level="low">Parsed</Pill>
            {onDelete && (
              <button
                title="Remove this file and its findings"
                className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 transition-colors"
                onClick={() => {
                  if (confirm(`Remove "${upload.fileName}" and its associated findings?`)) {
                    onDelete(upload.id);
                  }
                }}
              >
                Remove
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function UploadIntelligence({ uploads }: { uploads: Upload[] }) {
  const [overrides, setOverrides] = useState<Record<string, Upload["fileType"]>>({});
  const displayedUploads = uploads.map((upload) => ({ ...upload, fileType: overrides[upload.id] ?? upload.fileType }));
  const detectedTypes = new Set(displayedUploads.map((upload) => upload.fileType));
  const missingCore = coreUploadTypes.filter((fileType) => !detectedTypes.has(fileType));
  const averageConfidence = uploads.length
    ? Math.round(uploads.reduce((sum, upload) => sum + (upload.detectionConfidence ?? 70), 0) / uploads.length)
    : 0;
  const vendorSummary = Array.from(new Set(uploads.map((upload) => upload.detectedVendor).filter(Boolean))).join(", ") || "Not detected yet";

  return (
    <Panel title="Upload Intelligence">
      {uploads.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-slate-50 p-5 text-sm text-muted">
          ClosePilot will identify document type, likely vendor format and confidence after upload.
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-3">
            <MetricTile label="Files Detected" value={String(uploads.length)} sub={`${detectedTypes.size} document type(s)`} />
            <MetricTile label="Format Confidence" value={`${averageConfidence}%`} sub={averageConfidence >= 85 ? "High confidence" : averageConfidence >= 70 ? "Review recommended" : "Needs confirmation"} />
            <MetricTile label="Vendor Signal" value={vendorSummary} sub="From headers and file structure" />
          </div>

          <div className="grid gap-2">
            {displayedUploads.map((upload) => {
              const confidence = upload.detectionConfidence ?? 70;
              const confidenceLevel: RiskLevel = confidence >= 85 ? "low" : confidence >= 70 ? "medium" : "high";
              return (
                <div key={upload.id} className="grid gap-3 rounded-lg border border-line p-3 lg:grid-cols-[1fr_190px_120px] lg:items-center">
                  <div className="min-w-0">
                    <strong className="block truncate">{upload.fileName}</strong>
                    <p className="mt-1 text-sm text-muted">
                      {upload.detectedVendor ?? "Unknown format"} · {upload.rowCount ?? 0} rows · {upload.detectionBasis ?? "Detected from filename and headers"}
                    </p>
                    {upload.importGateStatus && (
                      <p className="mt-1 text-xs text-muted">
                        Import confidence {upload.importConfidence ?? 0}% · rules {upload.importGateStatus === "ready" ? "enabled" : "paused"}
                      </p>
                    )}
                  </div>
                  <select
                    className="h-10 rounded-lg border border-line bg-white px-3 text-sm font-bold"
                    value={upload.fileType}
                    onChange={(event) => setOverrides((items) => ({ ...items, [upload.id]: event.target.value as Upload["fileType"] }))}
                  >
                    {Object.entries(uploadTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <Pill level={confidenceLevel}>{confidence}% confidence</Pill>
                </div>
              );
            })}
          </div>

          <div className="rounded-lg border border-line bg-slate-50 p-4">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <p className="font-bold">Required Finance Pack Coverage</p>
                <p className="mt-1 text-sm text-muted">
                  {missingCore.length ? `${missingCore.length} core document(s) still missing.` : "All core review documents detected."}
                </p>
              </div>
              <Pill level={missingCore.length ? "medium" : "low"}>{missingCore.length ? "Incomplete" : "Complete"}</Pill>
            </div>
            {missingCore.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {missingCore.map((fileType) => <span key={fileType} className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-bold">{uploadTypeLabels[fileType]}</span>)}
              </div>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

function ImportMappingProfilesPanel({ profiles, confirmImportProfile }: { profiles: ImportMappingProfile[]; confirmImportProfile: (profileId: string) => void }) {
  return (
    <Panel title="Mapping Profiles">
      {profiles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-slate-50 p-5 text-sm text-muted">
          Upload a finance export to see detected column mappings and save reusable profiles.
        </div>
      ) : (
        <div className="grid gap-3">
          {profiles.map((profile) => {
            const level: RiskLevel = profile.status === "confirmed" || profile.status === "known_profile" ? "low" : profile.status === "needs_confirmation" ? "high" : "medium";
            return (
              <div key={profile.id} className="rounded-lg border border-line p-4">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div>
                    <strong>{profile.profileName}</strong>
                    <p className="mt-1 text-sm text-muted">
                      {uploadTypeLabels[profile.fileType]} · {profile.vendor ?? "Unknown vendor"} · {profile.confidence}% mapping confidence
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Pill level={level}>{profile.status.replaceAll("_", " ")}</Pill>
                    {profile.status !== "confirmed" && (
                      <button className="rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white hover:bg-blue-700" onClick={() => confirmImportProfile(profile.id)}>
                        Confirm
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {profile.fields.map((field) => (
                    <div key={`${profile.id}_${field.targetField}`} className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
                      <span className="font-black">{field.targetField}</span>
                      <span className="text-muted"> from </span>
                      <span className="font-bold">{field.sourceColumn}</span>
                      <span className="text-muted"> · {field.confidence}%</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

export function UploadAnalyse({ analyseUploads, isAnalysing, uploadMessage, uploadJob, validationChecks, uploads, importProfiles, confirmImportProfile, findings, recommendations, onDelete, onClear, setActive }: { analyseUploads: (files: FileList | null) => void; isAnalysing: boolean; uploadMessage: string; uploadJob: UploadJobState | null; validationChecks: ValidationCheck[]; uploads: Upload[]; importProfiles: ImportMappingProfile[]; confirmImportProfile: (profileId: string) => void; findings: Finding[]; recommendations: Recommendation[]; onDelete: (id: string) => void; onClear: () => void; setActive: (value: string) => void }) {
  const expectedFiles: Array<{ type: Upload["fileType"]; label: string; required: boolean }> = [
    { type: "trial_balance", label: "Trial Balance", required: true },
    { type: "profit_loss", label: "Profit & Loss", required: true },
    { type: "balance_sheet", label: "Balance Sheet", required: true },
    { type: "aged_debtors", label: "Aged Debtors", required: true },
    { type: "aged_creditors", label: "Aged Creditors", required: true },
    { type: "vat_report", label: "VAT Report", required: true },
    { type: "bank_reconciliation", label: "Bank Reconciliation", required: false },
  ];
  const uploadedTypes = new Set(uploads.map((upload) => upload.fileType));
  const requiredFiles = expectedFiles.filter((file) => file.required);
  const requiredPresent = requiredFiles.filter((file) => uploadedTypes.has(file.type)).length;
  const missingRequired = requiredFiles.filter((file) => !uploadedTypes.has(file.type));
  const coverage = Math.round(requiredPresent / requiredFiles.length * 100);
  const mappingIssues = uploads.filter((upload) => upload.importGateStatus && upload.importGateStatus !== "ready").length;
  const failedChecks = validationChecks.filter((check) => check.status === "failed").length;
  const warningChecks = validationChecks.filter((check) => check.status === "warning").length;
  const intakeStatus = !uploads.length ? "Awaiting finance pack" : isAnalysing ? "Review running" : mappingIssues ? "File mapping required" : failedChecks ? "Validation review required" : missingRequired.length ? "Review available with missing files" : "Finance pack ready";
  const canContinue = uploads.length > 0 && !isAnalysing && mappingIssues === 0;

  return (
    <div className="grid gap-4">
      {uploads.length > 0 && <section className="rounded-lg border border-line bg-white p-5 shadow-panel" aria-label="Finance pack readiness">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div><h2 className="text-xl font-bold">Upload finance pack</h2><p className="mt-1 max-w-3xl text-sm text-muted">Add the prepared-account exports for this review.</p></div>
          <div className="flex shrink-0 items-center gap-2">
            <Pill level={!uploads.length || mappingIssues || failedChecks ? "medium" : "low"}>{intakeStatus}</Pill>
            {/* Available whenever a review exists — uploaded OR synced — so a Xero/
                QuickBooks review can be cleared even though it has no uploaded files. */}
            {(uploads.length > 0 || findings.length > 0 || validationChecks.length > 0) && (
              <button
                className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 transition-colors hover:bg-red-50"
                onClick={() => { if (confirm("Clear this review? This removes the findings, scores, VAT review, recommendations, statements and any uploaded files for this client. (Provider connections are not affected.)")) onClear(); }}
              >
                Clear Review
              </button>
            )}
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric title="Core File Coverage" value={`${coverage}%`} detail={`${requiredPresent}/${requiredFiles.length} required files`} tone={coverage === 100 ? "low" : "medium"} />
          <Metric title="File Mapping" value={mappingIssues ? String(mappingIssues) : "Ready"} detail={mappingIssues ? "Files need confirmation" : "No mapping hold"} tone={mappingIssues ? "high" : "low"} />
          <Metric title="Validation" value={failedChecks ? `${failedChecks} blocked` : "Ready"} detail={`${warningChecks} warning${warningChecks === 1 ? "" : "s"}`} tone={failedChecks ? "critical" : warningChecks ? "medium" : "low"} />
          <Metric title="Review Output" value={String(findings.length)} detail={`${recommendations.length} recommended actions`} tone={findings.length ? "medium" : "low"} />
        </div>
        {uploadJob && (
          <div className={`mt-4 rounded-lg border p-4 ${uploadJob.status === "failed" ? "border-red-200 bg-red-50" : uploadJob.status === "completed" ? "border-emerald-200 bg-emerald-50" : "border-blue-200 bg-blue-50"}`} aria-label="Background upload progress">
            <div className="flex items-center justify-between gap-3"><span><strong className="block">Background review</strong><span className="mt-1 block text-sm text-muted">{uploadJob.currentStage}</span></span><Pill level={uploadJob.status === "failed" ? "high" : uploadJob.status === "completed" ? "low" : "medium"}>{uploadJob.status.replaceAll("_", " ")}</Pill></div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.max(2, Math.min(100, uploadJob.progressPercent))}%` }} /></div>
            <div className="mt-2 flex justify-between text-xs font-bold text-muted"><span>{uploadJob.status === "uploading" ? `${formatUploadBytes(uploadJob.bytesProcessed ?? 0)} transferred` : `${uploadJob.rowsProcessed?.toLocaleString("en-GB") ?? 0} rows processed`}</span><span>{uploadJob.progressPercent}%</span></div>
            {uploadJob.error ? <p className="mt-2 text-sm font-semibold text-red-800">{uploadJob.error}</p> : null}
          </div>
        )}
      </section>}

      <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="grid content-start gap-4">
        <Panel title="Import Prepared Accounts">
          <div className="rounded-lg border-2 border-dashed border-line bg-slate-50 p-8 text-center">
            <strong>Drop files here or choose files</strong>
            <p className="mt-2 text-sm text-muted">CSV and Excel supported. Add files together where possible.</p>
            <label className="mt-5 inline-flex cursor-pointer rounded-lg bg-brand px-4 py-3 font-bold text-white">
              {isAnalysing ? "Reviewing files…" : uploads.length ? "Add more files" : "Choose files"}
              <input className="sr-only" type="file" multiple accept=".csv,.tsv,.txt,.xlsx,.xls" onChange={(event) => analyseUploads(event.target.files)} />
            </label>
            <p className="mt-3 text-sm text-muted">{uploadMessage}</p>
          </div>
        </Panel>
        <Panel title="Imported Files">
          <UploadList uploads={uploads} onDelete={onDelete} onClear={uploads.length ? onClear : undefined} />
        </Panel>
        </div>

        <div className="grid content-start gap-4">
          <Panel title="Prepared Accounts Checklist">
            <div className="grid gap-2 sm:grid-cols-2">
              {expectedFiles.map((file) => {
                const present = uploadedTypes.has(file.type);
                return <div key={file.type} className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${present ? "border-emerald-200 bg-emerald-50" : file.required ? "border-amber-200 bg-amber-50" : "border-line bg-slate-50"}`}><span><strong className="block text-sm">{file.label}</strong><span className="text-xs text-muted">{file.required ? "Core review file" : "Recommended for audit readiness"}</span></span><span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${present ? "bg-emerald-600 text-white" : "bg-white text-muted"}`}>{present ? "✓" : "—"}</span></div>;
              })}
            </div>
            {missingRequired.length ? <p className="mt-3 text-sm text-amber-900"><strong>Missing:</strong> {missingRequired.map((file) => file.label).join(", ")}. You can continue, but these areas will have less review coverage.</p> : <p className="mt-3 text-sm font-semibold text-emerald-800">All core review files are present.</p>}
          </Panel>

          <Panel title="What To Do Next">
            <div className={`rounded-lg border p-4 ${canContinue ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
              <p className="text-xs font-bold uppercase text-muted">Next action</p>
              <h3 className="mt-1 text-lg font-black">{!uploads.length ? "Import the prepared accounts" : isAnalysing ? "Wait while the review completes" : mappingIssues ? "Confirm the file mapping" : findings.length ? "Work through the findings" : "Open the finance review"}</h3>
              <p className="mt-1 text-sm text-muted">{!uploads.length ? "Start with the six core exports shown in the checklist." : mappingIssues ? "Confirm the suggested columns before relying on the results." : failedChecks ? "The review ran, but failed checks require attention before sign-off." : "The files have been reviewed and the next decision is ready."}</p>
              {canContinue && <button className="mt-4 rounded-lg bg-brand px-4 py-2.5 text-sm font-bold text-white" onClick={() => setActive(findings.length ? "Findings" : "Finance Review")}>{findings.length ? "Open Review Findings" : "Open Finance Review"}</button>}
            </div>
          </Panel>

          <details className="rounded-xl border border-line bg-surface shadow-card">
            <summary className="cursor-pointer px-5 py-4 text-[15px] font-bold">Review progress</summary>
            <div className="border-t border-line p-5">
            <div className="grid gap-3">
              {([
                ["Files recognised", uploads.length > 0, uploads.length ? `${uploads.length} exports reviewed` : "Awaiting upload"],
                ["Columns confirmed", uploads.length > 0 && mappingIssues === 0, mappingIssues ? `${mappingIssues} mapping confirmation required` : uploads.length ? "Ready" : "Not started"],
                ["Balances checked", validationChecks.length > 0, validationChecks.length ? `${validationChecks.length} checks completed` : "Not started"],
                ["Findings created", findings.length > 0, findings.length ? `${findings.length} findings ready for decision` : "No findings yet"],
              ] as [string, boolean, string][]).map(([step, done, detail]) => (
                <div key={step} className="flex items-center justify-between gap-3 rounded-lg border border-line p-4"><span><strong className="block">{step}</strong><span className="mt-1 block text-xs text-muted">{detail}</span></span><Pill level={done ? "low" : "medium"}>{done ? "Complete" : "Pending"}</Pill></div>
              ))}
            </div>
            </div>
          </details>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="grid content-start gap-4">
          <UploadIntelligence uploads={uploads} />
          <ImportMappingProfilesPanel profiles={importProfiles} confirmImportProfile={confirmImportProfile} />
        </div>
        <Panel title="Validation Checks">
          <div className="grid gap-3">
            {validationChecks.length === 0 && <p className="text-sm text-muted">No validation checks yet. Upload a finance pack to begin.</p>}
            {validationChecks.map((check) => (
              <div key={check.id} className="rounded-lg border border-line p-3">
                <div className="flex items-start justify-between gap-3">
                  <strong>{check.name}</strong>
                  <ValidationPill status={check.status} />
                </div>
                <p className="mt-1 text-sm text-muted">{check.detail}</p>
              </div>
            ))}
          </div>
        </Panel>
      </section>
    </div>
  );
}
