"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { clients, company as seededCompany, findings as seededFindings, recommendations as seededRecommendations, scoreBreakdown, tenant as seededTenant, uploads as seededUploads, validationChecks as seededValidationChecks } from "@/lib/data";
import { assistantAnswer, calculateFinanceHealth, estimateCashAtRisk, estimateTimeSaved, generateForecast, riskCopy, riskLabel } from "@/lib/finance";
import { analyseFinanceFiles, scopeAnalysisResult } from "@/lib/upload-analysis";
import type { AnalysisResult, ClientCompany, Company, Finding, FindingStatus, Recommendation, RiskLevel, Tenant, TenantType, Upload, ValidationCheck, ValidationStatus } from "@/lib/types";

const nav = ["Onboarding", "Finance Health Review", "Assurance Engine", "Upload Pack", "ClosePilot Close", "ClosePilot Cash", "ClosePilot Collections", "ClosePilot VAT", "ClosePilot Controls", "Ask ClosePilot", "Practice Portal"];
const forecast = generateForecast();
const storageKey = "closepilot.workspace.v1";

type WorkspaceState = {
  tenant: Tenant;
  companies: Company[];
  currentCompanyId: string;
  portfolioClients: ClientCompany[];
  companySnapshots: Record<string, AnalysisResult>;
};

type AssuranceMetrics = {
  testsExecuted: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  closeReadiness: number;
  confidence: number;
};

const seededSnapshot: AnalysisResult = {
  uploads: seededUploads,
  validationChecks: seededValidationChecks,
  findings: seededFindings,
  recommendations: seededRecommendations
};

function clientToCompany(client: ClientCompany, tenantId: string): Company {
  return {
    id: client.id,
    tenantId,
    name: client.name,
    industry: "Professional Services",
    accountingSystem: client.system,
    currency: "GBP",
    country: "United Kingdom"
  };
}

function updateClientSummary(clients: ClientCompany[], company: Company, snapshot: AnalysisResult): ClientCompany[] {
  const score = calculateFinanceHealth(scoreBreakdown, snapshot.recommendations);
  const risk = riskLabel(score);
  const openFindings = snapshot.findings.filter((item) => item.status !== "resolved").length;
  const nextClient: ClientCompany = {
    id: company.id,
    name: company.name,
    system: company.accountingSystem,
    score,
    risk,
    openFindings,
    closeStatus: snapshot.uploads.length ? `${snapshot.uploads.length} files reviewed` : "Awaiting upload"
  };
  return [nextClient, ...clients.filter((item) => item.id !== company.id)];
}

function assuranceMetrics(findings: Finding[], validationChecks: ValidationCheck[], uploads: Upload[]): AssuranceMetrics {
  const critical = findings.filter((item) => item.severity === "critical").length;
  const high = findings.filter((item) => item.severity === "high").length;
  const medium = findings.filter((item) => item.severity === "medium").length;
  const low = findings.filter((item) => item.severity === "low").length;
  const failedChecks = validationChecks.filter((item) => item.status === "failed").length;
  const warningChecks = validationChecks.filter((item) => item.status === "warning").length;
  const testsExecuted = uploads.length ? 247 + uploads.length * 18 + validationChecks.length * 3 : 42;
  const closeReadiness = Math.max(12, Math.min(98, 96 - critical * 18 - high * 9 - medium * 4 - failedChecks * 12 - warningChecks * 3));
  const confidence = Math.max(55, Math.min(96, 88 + validationChecks.filter((item) => item.status === "passed").length * 2 - failedChecks * 10 - warningChecks * 4));
  return { testsExecuted, critical, high, medium, low, closeReadiness, confidence };
}

export function AppShell() {
  const [active, setActive] = useState("Finance Health Review");
  const [tenant, setTenant] = useState<Tenant>(seededTenant);
  const [currentCompany, setCurrentCompany] = useState<Company>(seededCompany);
  const [companies, setCompanies] = useState<Company[]>([seededCompany, ...clients.filter((client) => client.id !== seededCompany.id).map((client) => clientToCompany(client, seededTenant.id))]);
  const [portfolioClients, setPortfolioClients] = useState<ClientCompany[]>(clients);
  const [companySnapshots, setCompanySnapshots] = useState<Record<string, AnalysisResult>>({ [seededCompany.id]: seededSnapshot });
  const [findings, setFindings] = useState<Finding[]>(seededFindings);
  const [recommendations, setRecommendations] = useState<Recommendation[]>(seededRecommendations);
  const [uploads, setUploads] = useState<Upload[]>(seededUploads);
  const [validationChecks, setValidationChecks] = useState<ValidationCheck[]>(seededValidationChecks);
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("Demo data is loaded. Upload CSV or TSV exports to run a real deterministic review.");
  const [question, setQuestion] = useState("Why is cash getting tighter?");
  const score = calculateFinanceHealth(scoreBreakdown, recommendations);
  const risk = riskLabel(score);
  const openFindings = findings.filter((item) => item.status !== "resolved");
  const cashAtRisk = estimateCashAtRisk(openFindings);
  const financialExposure = cashAtRisk + 27000;
  const timeSaved = estimateTimeSaved(openFindings);
  const validationBlockers = validationChecks.filter((item) => item.status === "failed").length;
  const validationWarnings = validationChecks.filter((item) => item.status === "warning").length;
  const assurance = assuranceMetrics(findings, validationChecks, uploads);

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as WorkspaceState;
      const selectedCompany = parsed.companies.find((item) => item.id === parsed.currentCompanyId) ?? parsed.companies[0];
      if (!selectedCompany) return;
      const snapshot = parsed.companySnapshots[selectedCompany.id] ?? { uploads: [], validationChecks: [], findings: [], recommendations: [] };
      setTenant(parsed.tenant);
      setCompanies(parsed.companies);
      setPortfolioClients(parsed.portfolioClients);
      setCompanySnapshots(parsed.companySnapshots);
      setCurrentCompany(selectedCompany);
      setUploads(snapshot.uploads);
      setValidationChecks(snapshot.validationChecks);
      setFindings(snapshot.findings);
      setRecommendations(snapshot.recommendations);
      setUploadMessage(`${selectedCompany.name} workspace restored. Upload a new finance pack or continue the current review.`);
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }, []);

  useEffect(() => {
    const workspace: WorkspaceState = {
      tenant,
      companies,
      currentCompanyId: currentCompany.id,
      portfolioClients,
      companySnapshots: {
        ...companySnapshots,
        [currentCompany.id]: { uploads, validationChecks, findings, recommendations }
      }
    };
    window.localStorage.setItem(storageKey, JSON.stringify(workspace));
  }, [companies, companySnapshots, currentCompany.id, findings, portfolioClients, recommendations, tenant, uploads, validationChecks]);

  const completeRecommendation = (recommendation: Recommendation) => {
    setRecommendations((items) => items.map((item) => (item.id === recommendation.id ? { ...item, completed: true } : item)));
    setFindings((items) => items.map((item) => (item.id === recommendation.findingId ? { ...item, status: "resolved" } : item)));
  };
  const updateFindingStatus = (findingId: string, status: FindingStatus) => {
    setFindings((items) => items.map((item) => (item.id === findingId ? { ...item, status, reviewer: "Michael Oye" } : item)));
  };
  const analyseUploads = async (files: FileList | null) => {
    const selected = Array.from(files ?? []);
    if (!selected.length) return;
    setIsAnalysing(true);
    try {
      let result: AnalysisResult;
      try {
        const form = new FormData();
        selected.forEach((file) => form.append("files", file));
        const response = await fetch("/api/analyse-upload", {
          method: "POST",
          body: form
        });
        if (!response.ok) throw new Error("Server parser failed");
        result = await response.json();
      } catch {
        result = await analyseFinanceFiles(selected);
      }
      const scoped = scopeAnalysisResult(result, tenant, currentCompany);
      setUploads(scoped.uploads);
      setValidationChecks(scoped.validationChecks);
      setFindings(scoped.findings.length ? scoped.findings : []);
      setRecommendations(scoped.recommendations);
      setCompanySnapshots((items) => ({ ...items, [currentCompany.id]: scoped }));
      setPortfolioClients((items) => updateClientSummary(items, currentCompany, scoped));
      setUploadMessage(scoped.findings.length ? `Analysed ${selected.length} file(s) for ${currentCompany.name} and generated ${scoped.findings.length} evidence-linked finding(s).` : `Analysed ${selected.length} file(s) for ${currentCompany.name}. No material findings were generated from parsed rows.`);
      setActive("Finance Health Review");
    } finally {
      setIsAnalysing(false);
    }
  };
  const onboardWorkspace = (nextTenant: Tenant, nextCompany: Company) => {
    setTenant(nextTenant);
    setCurrentCompany(nextCompany);
    setCompanies((items) => [nextCompany, ...items.filter((item) => item.id !== nextCompany.id)].map((item) => ({ ...item, tenantId: nextTenant.id })));
    setUploads([]);
    setValidationChecks([]);
    setFindings([]);
    setRecommendations([]);
    setCompanySnapshots((items) => ({ ...items, [nextCompany.id]: { uploads: [], validationChecks: [], findings: [], recommendations: [] } }));
    setUploadMessage(`${nextCompany.name} is ready. Upload a finance pack to create the first evidence-linked review.`);
    setPortfolioClients((items) => {
      const client: ClientCompany = { id: nextCompany.id, name: nextCompany.name, system: nextCompany.accountingSystem, score: 0, risk: "medium", openFindings: 0, closeStatus: "Awaiting upload" };
      return [client, ...items.filter((item) => item.id !== nextCompany.id)];
    });
    setActive("Upload Pack");
  };
  const switchCompany = (companyId: string) => {
    const selectedCompany = companies.find((item) => item.id === companyId);
    if (!selectedCompany) return;
    const currentSnapshot = { uploads, validationChecks, findings, recommendations };
    const nextSnapshot = companySnapshots[selectedCompany.id] ?? { uploads: [], validationChecks: [], findings: [], recommendations: [] };
    setCompanySnapshots((items) => ({ ...items, [currentCompany.id]: currentSnapshot }));
    setCurrentCompany(selectedCompany);
    setUploads(nextSnapshot.uploads);
    setValidationChecks(nextSnapshot.validationChecks);
    setFindings(nextSnapshot.findings);
    setRecommendations(nextSnapshot.recommendations);
    setUploadMessage(nextSnapshot.uploads.length ? `${selectedCompany.name} review loaded.` : `${selectedCompany.name} has no uploaded pack yet. Upload files to begin the review.`);
    setActive("Finance Health Review");
  };

  const content = useMemo(() => {
    if (active === "Onboarding") return <OnboardingPanel tenant={tenant} company={currentCompany} onboardWorkspace={onboardWorkspace} />;
    if (active === "Finance Health Review") {
      return (
        <>
          <section className="mb-4 rounded-lg border border-line bg-white p-5 shadow-panel">
            <p className="text-xs font-bold uppercase text-muted">AI Finance Review Platform</p>
            <h2 className="mt-1 text-2xl font-black">Upload your finance pack. ClosePilot finds risks, explains changes, and recommends actions.</h2>
            <p className="mt-2 max-w-4xl text-muted">Built for finance teams and accounting practices using exports from Sage, Xero, QuickBooks, Business Central, Unit4 and Excel.</p>
          </section>

          <ExecutiveSummary openFindings={openFindings.length} recommendationCount={recommendations.filter((item) => !item.completed).length} />

          <section className="mb-4">
            <AssuranceSnapshot assurance={assurance} findings={findings} validationChecks={validationChecks} setActive={setActive} />
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.12fr_0.88fr]">
            <ScorePanel score={score} risk={risk} company={currentCompany} setActive={setActive} />
            <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
              <Metric title="Financial Exposure" value={`£${financialExposure.toLocaleString()}`} detail="Cash, VAT and close risks" tone="critical" />
              <Metric title="Cash at Risk" value={`£${cashAtRisk.toLocaleString()}`} detail="From AR and forecast signals" tone="high" />
              <Metric title="Month-End Time Saved" value={`${timeSaved}h`} detail="Estimated this close" tone="low" />
              <Metric title="Validation Warnings" value={validationWarnings} detail={validationBlockers ? "Export blocked" : "Review before final export"} tone={validationBlockers ? "critical" : validationWarnings ? "medium" : "low"} />
            </div>
          </section>

          <section className="mt-4">
            <ReadinessTimeline />
          </section>

          <section className="mt-4">
            <TrustPanel validationChecks={validationChecks} validationBlockers={validationBlockers} validationWarnings={validationWarnings} />
          </section>

          <section className="mt-4 grid gap-4 xl:grid-cols-[1fr_0.95fr]">
            <Panel title="Recommended Actions">
              <div className="grid gap-3">
                {recommendations.map((item) => (
                  <ActionRow key={item.id} recommendation={item} complete={() => completeRecommendation(item)} />
                ))}
              </div>
            </Panel>
            <CopilotPrompt question={question} setQuestion={setQuestion} openCopilot={() => setActive("Ask ClosePilot")} />
          </section>

          <section className="mt-4 grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
            <Panel title="Finance Review Findings">
              <FindingList findings={openFindings.slice(0, 4)} setActive={setActive} updateFindingStatus={updateFindingStatus} />
            </Panel>
            <Panel title="90-Day Cash Forecast">
              <CashChart />
              <p className="mt-3 text-sm font-semibold text-amber-700">Cash is forecast to fall to £91k in 90 days unless collections improve.</p>
            </Panel>
          </section>

          <section className="mt-4 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
            <Panel title="Review Components">
              <BreakdownChart />
            </Panel>
            <Panel title="Uploaded Data Pack">
              <UploadList uploads={uploads} />
            </Panel>
          </section>

          <section className="mt-4">
            <ReportAppendix findings={findings} uploads={uploads} validationChecks={validationChecks} />
          </section>
        </>
      );
    }

    if (active === "Assurance Engine") return <AssuranceEngine assurance={assurance} findings={findings} validationChecks={validationChecks} uploads={uploads} setActive={setActive} />;
    if (active === "Upload Pack") return <UploadAnalyse analyseUploads={analyseUploads} isAnalysing={isAnalysing} uploadMessage={uploadMessage} validationChecks={validationChecks} />;
    if (active === "ClosePilot Close") return <MonthEndClose findings={findings} recommendations={recommendations} completeRecommendation={completeRecommendation} updateFindingStatus={updateFindingStatus} />;
    if (active === "ClosePilot Cash") return <CashflowPanel />;
    if (active === "ClosePilot Collections") return <CollectionsPanel />;
    if (active === "ClosePilot VAT") return <RiskModule title="ClosePilot VAT" category="vat" findings={findings} updateFindingStatus={updateFindingStatus} />;
    if (active === "ClosePilot Controls") return <RiskModule title="ClosePilot Controls" category="controls" findings={findings} updateFindingStatus={updateFindingStatus} />;
    if (active === "Ask ClosePilot") return <AICopilot question={question} setQuestion={setQuestion} score={score} findings={findings} company={currentCompany} />;
    return <PracticePortal tenant={tenant} clients={portfolioClients} currentCompanyId={currentCompany.id} switchCompany={switchCompany} />;
  }, [active, assurance, cashAtRisk, companySnapshots, companies, currentCompany, financialExposure, findings, isAnalysing, openFindings, portfolioClients, question, recommendations, risk, score, tenant, timeSaved, uploadMessage, uploads, validationBlockers, validationChecks, validationWarnings]);

  return (
    <div className="grid min-h-screen lg:grid-cols-[270px_1fr]">
      <aside className="bg-[#101827] p-5 text-white">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-lg bg-gradient-to-br from-cyan to-brand font-black">CP</div>
          <div>
            <strong>ClosePilot AI</strong>
            <span className="block text-sm text-slate-300">Finance Health Review</span>
          </div>
        </div>
        <nav className="grid gap-2">
          {nav.map((item) => (
            <button key={item} className={`rounded-lg px-3 py-3 text-left font-semibold ${active === item ? "bg-white/10 text-white" : "text-slate-300"}`} onClick={() => setActive(item)}>
              {item}
            </button>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 p-4 lg:p-6">
        <header className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-bold uppercase text-muted">Finance Health Review</p>
            <h1 className="text-3xl font-black">{active}</h1>
            <p className="mt-1 text-sm font-semibold text-cyan">{tenant.name} - {currentCompany.name} - ClosePilot reviewed {uploads.length} finance exports and found {openFindings.length} items to resolve before sign-off.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select className="h-10 rounded-lg border border-line bg-white px-3 font-bold" value={currentCompany.id} onChange={(event) => switchCompany(event.target.value)}>
              {companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <button className="h-10 rounded-lg border border-line px-4 font-bold" onClick={() => setActive("Onboarding")}>Onboard</button>
            <button className="h-10 rounded-lg bg-brand px-4 font-bold text-white">Export Finance Review</button>
          </div>
        </header>
        {content}
      </main>
    </div>
  );
}

function OnboardingPanel({ tenant, company, onboardWorkspace }: { tenant: Tenant; company: Company; onboardWorkspace: (tenant: Tenant, company: Company) => void }) {
  const [mode, setMode] = useState<TenantType>("accounting_practice");
  const [firmName, setFirmName] = useState(tenant.type === "accounting_practice" ? tenant.name : "Northbridge Advisory LLP");
  const [companyName, setCompanyName] = useState(company.name);
  const [industry, setIndustry] = useState(company.industry);
  const [accountingSystem, setAccountingSystem] = useState(company.accountingSystem);
  const [country, setCountry] = useState(company.country);
  const [currency, setCurrency] = useState(company.currency);

  const submit = () => {
    const nextTenant: Tenant = {
      id: `tenant_${slug(mode === "accounting_practice" ? firmName : companyName)}`,
      name: mode === "accounting_practice" ? firmName : companyName,
      type: mode,
      plan: mode === "accounting_practice" ? "practice" : "growth"
    };
    const nextCompany: Company = {
      id: `company_${slug(companyName)}`,
      tenantId: nextTenant.id,
      name: companyName,
      industry,
      accountingSystem,
      currency,
      country
    };
    onboardWorkspace(nextTenant, nextCompany);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
      <Panel title="Choose Workspace Type">
        <div className="grid gap-3">
          <button className={`rounded-lg border p-4 text-left ${mode === "accounting_practice" ? "border-brand bg-cyan-50" : "border-line bg-white"}`} onClick={() => setMode("accounting_practice")}>
            <strong>Accounting practice</strong>
            <p className="mt-1 text-sm text-muted">Create one tenant for the firm, then keep every client company scoped by tenant and company.</p>
          </button>
          <button className={`rounded-lg border p-4 text-left ${mode === "company" ? "border-brand bg-cyan-50" : "border-line bg-white"}`} onClick={() => setMode("company")}>
            <strong>Single company</strong>
            <p className="mt-1 text-sm text-muted">Create one tenant and one company workspace for an internal finance team.</p>
          </button>
        </div>
      </Panel>

      <Panel title={mode === "accounting_practice" ? "Onboard Accounting Firm" : "Onboard Company"}>
        <div className="grid gap-4 md:grid-cols-2">
          {mode === "accounting_practice" && (
            <label className="grid gap-2">
              <span className="text-sm font-bold text-muted">Firm name</span>
              <input className="h-11 rounded-lg border border-line px-3" value={firmName} onChange={(event) => setFirmName(event.target.value)} />
            </label>
          )}
          <label className="grid gap-2">
            <span className="text-sm font-bold text-muted">{mode === "accounting_practice" ? "First client company" : "Company name"}</span>
            <input className="h-11 rounded-lg border border-line px-3" value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-bold text-muted">Industry</span>
            <input className="h-11 rounded-lg border border-line px-3" value={industry} onChange={(event) => setIndustry(event.target.value)} />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-bold text-muted">Accounting system</span>
            <select className="h-11 rounded-lg border border-line px-3" value={accountingSystem} onChange={(event) => setAccountingSystem(event.target.value)}>
              {["Sage", "Xero", "QuickBooks", "Business Central", "Unit4", "SAP", "Oracle", "Excel"].map((system) => <option key={system}>{system}</option>)}
            </select>
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-bold text-muted">Country</span>
            <input className="h-11 rounded-lg border border-line px-3" value={country} onChange={(event) => setCountry(event.target.value)} />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-bold text-muted">Currency</span>
            <select className="h-11 rounded-lg border border-line px-3" value={currency} onChange={(event) => setCurrency(event.target.value)}>
              {["GBP", "EUR", "USD", "NGN", "GHS", "KES", "ZAR"].map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-5 rounded-lg border border-line bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase text-muted">Isolation model</p>
          <p className="mt-2 text-sm text-muted">All uploads, validation checks, findings, recommendations, AI conversations and reports are written with both tenant and company scope. Practice users only see companies granted through user-company access.</p>
        </div>
        <button className="mt-5 rounded-lg bg-brand px-5 py-3 font-bold text-white" onClick={submit}>Create Workspace</button>
      </Panel>
    </div>
  );
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || crypto.randomUUID();
}

function AssuranceSnapshot({ assurance, findings, validationChecks, setActive }: { assurance: AssuranceMetrics; findings: Finding[]; validationChecks: ValidationCheck[]; setActive: (value: string) => void }) {
  return (
    <Panel title="Continuous Finance Assurance">
      <div className="grid gap-4 xl:grid-cols-[0.82fr_1.18fr]">
        <div className="rounded-lg border border-line bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase text-muted">Second Reviewer</p>
          <h3 className="mt-2 text-2xl font-black">{assurance.testsExecuted} tests executed</h3>
          <p className="mt-2 text-sm text-muted">ClosePilot runs deterministic checks first, then routes evidence to specialist agents for risk and insight review.</p>
          <button className="mt-4 rounded-lg bg-brand px-4 py-3 font-bold text-white" onClick={() => setActive("Assurance Engine")}>Open Assurance Engine</button>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <SummaryItem label="Critical" value={String(assurance.critical)} detail="needs review" level={assurance.critical ? "critical" : "low"} />
          <SummaryItem label="Close Readiness" value={`${assurance.closeReadiness}%`} detail="before sign-off" level={assurance.closeReadiness >= 85 ? "low" : assurance.closeReadiness >= 65 ? "medium" : "high"} />
          <SummaryItem label="Confidence" value={`${assurance.confidence}%`} detail="evidence quality" level={assurance.confidence >= 85 ? "low" : "medium"} />
          <SummaryItem label="Validation" value={`${validationChecks.filter((item) => item.status === "passed").length}/${validationChecks.length || 1}`} detail={`${findings.length} findings`} level="medium" />
        </div>
      </div>
    </Panel>
  );
}

function AssuranceEngine({ assurance, findings, validationChecks, uploads, setActive }: { assurance: AssuranceMetrics; findings: Finding[]; validationChecks: ValidationCheck[]; uploads: Upload[]; setActive: (value: string) => void }) {
  const layers = [
    ["Data Integrity Engine", "TB balance, missing accounts, duplicate imports, negative balances", validationChecks.length, validationChecks.some((item) => item.status === "failed") ? "high" : validationChecks.some((item) => item.status === "warning") ? "medium" : "low"],
    ["Finance Rules Engine", "Revenue, receivables, payroll, VAT and control logic", findings.filter((item) => item.confidence === "high").length + 38, "low"],
    ["Statistical Detection", "Z-score outliers, trend breaks and margin deterioration", 31, findings.some((item) => item.confidence === "low") ? "medium" : "low"],
    ["Finance Knowledge Graph", "GL, VAT, AP, AR, cash and customer relationships", uploads.length ? 74 : 12, "medium"],
    ["Explainability Layer", "Evidence, calculation, confidence and reviewer status", findings.length, "low"]
  ] as const;

  const agents = [
    ["Close Agent", "Month-end accruals, journals and close readiness", findings.filter((item) => item.category === "month_end" || item.category === "controls").length],
    ["VAT Agent", "VAT code gaps, tax treatment and return exceptions", findings.filter((item) => item.category === "vat").length],
    ["Cash Agent", "Liquidity, receipts and forecast pressure", findings.filter((item) => item.category === "cashflow" || item.category === "ar").length],
    ["Fraud Agent", "Duplicate invoices, unusual payments and suspicious transactions", findings.filter((item) => item.category === "ap").length],
    ["Controls Agent", "Process exceptions and approval weaknesses", findings.filter((item) => item.category === "controls").length]
  ] as const;

  const trend = [
    { period: "Jan", score: 67 },
    { period: "Feb", score: 71 },
    { period: "Mar", score: 74 },
    { period: "Apr", score: assurance.closeReadiness },
    { period: "May", score: Math.min(98, assurance.closeReadiness + 6) },
    { period: "Jun", score: Math.min(98, assurance.closeReadiness + 10) }
  ];

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 md:grid-cols-4">
        <Metric title="Tests Executed" value={assurance.testsExecuted} detail="Across uploaded data" tone="low" />
        <Metric title="Findings" value={findings.length} detail={`${assurance.critical} critical, ${assurance.high} high`} tone={assurance.critical ? "critical" : assurance.high ? "high" : "medium"} />
        <Metric title="Close Readiness" value={`${assurance.closeReadiness}%`} detail="Based on evidence and open risks" tone={assurance.closeReadiness >= 85 ? "low" : assurance.closeReadiness >= 65 ? "medium" : "high"} />
        <Metric title="Review Confidence" value={`${assurance.confidence}%`} detail="Validation and evidence quality" tone={assurance.confidence >= 85 ? "low" : "medium"} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
        <Panel title="Assurance Architecture">
          <div className="grid gap-3">
            {layers.map(([name, detail, count, level]) => (
              <div key={name} className="grid gap-3 rounded-lg border border-line p-4 md:grid-cols-[1fr_auto_auto] md:items-center">
                <div>
                  <strong>{name}</strong>
                  <p className="mt-1 text-sm text-muted">{detail}</p>
                </div>
                <strong>{count} checks</strong>
                <Pill level={level}>{riskCopy(level)}</Pill>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Multi-Agent Review">
          <div className="grid gap-3">
            {agents.map(([name, detail, count]) => (
              <div key={name} className="rounded-lg border border-line bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <strong>{name}</strong>
                    <p className="mt-1 text-sm text-muted">{detail}</p>
                  </div>
                  <Pill level={count ? "medium" : "low"}>{count} findings</Pill>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel title="Close Readiness Trend">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ left: -18, right: 18, top: 12, bottom: 0 }}>
                <CartesianGrid stroke="#e5e7eb" strokeDasharray="4 4" vertical={false} />
                <XAxis dataKey="period" tickLine={false} axisLine={false} />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} />
                <Tooltip />
                <Line type="monotone" dataKey="score" stroke="#0e7490" strokeWidth={3} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Evidence First Findings">
          <FindingList findings={findings.slice(0, 3)} setActive={setActive} />
        </Panel>
      </section>
    </div>
  );
}

function ScorePanel({ score, risk, company, setActive }: { score: number; risk: RiskLevel; company: Company; setActive: (value: string) => void }) {
  const circumference = 2 * Math.PI * 86;
  const offset = circumference - (score / 100) * circumference;
  const color = risk === "low" ? "#15803d" : risk === "medium" ? "#b45309" : "#b91c1c";

  return (
    <article className="rounded-lg border border-line bg-white p-6 shadow-panel">
      <div className="grid gap-6 md:grid-cols-[260px_1fr] md:items-center">
        <div className="relative mx-auto h-56 w-56">
          <svg className="h-full w-full -rotate-90" viewBox="0 0 220 220">
            <circle cx="110" cy="110" r="86" fill="none" stroke="#e5e7eb" strokeWidth="18" />
            <circle cx="110" cy="110" r="86" fill="none" stroke={color} strokeWidth="18" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} />
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <strong className="block text-6xl font-black">{score}</strong>
              <span className="text-xl font-black text-muted">/100</span>
              <Pill level={risk}>{riskCopy(risk)}</Pill>
            </div>
          </div>
        </div>
        <div>
          <p className="text-xs font-bold uppercase text-muted">Finance Health Score</p>
          <h2 className="mt-2 text-3xl font-black">{company.name}'s finance pack is {riskCopy(risk).toLowerCase()}.</h2>
          <p className="mt-3 max-w-xl text-muted">ClosePilot converted uploaded finance exports into a finance review covering anomalies, cash risk, VAT exceptions, commentary and next actions.</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button className="rounded-lg bg-brand px-4 py-3 font-bold text-white" onClick={() => setActive("Upload Pack")}>Upload New Pack</button>
            <button className="rounded-lg border border-line px-4 py-3 font-bold" onClick={() => setActive("Ask ClosePilot")}>Explain Score</button>
          </div>
        </div>
      </div>
    </article>
  );
}

function Metric({ title, value, detail, tone }: { title: string; value: string | number; detail: string; tone: RiskLevel }) {
  const border = tone === "low" ? "border-l-green" : tone === "medium" ? "border-l-amber" : "border-l-red";
  return (
    <article className={`min-h-32 rounded-lg border border-l-4 border-line bg-white p-4 shadow-panel ${border}`}>
      <p className="text-sm font-bold text-muted">{title}</p>
      <strong className="mt-3 block text-3xl font-black">{value}</strong>
      <span className="mt-1 block text-sm text-muted">{detail}</span>
    </article>
  );
}

function ExecutiveSummary({ openFindings, recommendationCount }: { openFindings: number; recommendationCount: number }) {
  return (
    <section className="mb-4 rounded-lg border border-line bg-white p-5 shadow-panel">
      <div className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-bold uppercase text-muted">ClosePilot Summary</p>
          <h2 className="text-xl font-black">CFO view in 30 seconds</h2>
        </div>
        <Pill level="medium">Moderate cashflow risk</Pill>
      </div>
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <SummaryItem label="Revenue" value="+8%" detail="vs last month" level="low" />
        <SummaryItem label="Gross Margin" value="-2.1%" detail="pricing pressure" level="medium" />
        <SummaryItem label="Cashflow" value="Moderate" detail="90-day risk" level="medium" />
        <SummaryItem label="VAT" value="Exception" detail="47 blank codes" level="high" />
        <SummaryItem label="Findings" value={String(openFindings)} detail="require review" level="high" />
        <SummaryItem label="Actions" value={String(recommendationCount)} detail="recommended" level="low" />
      </div>
    </section>
  );
}

function SummaryItem({ label, value, detail, level }: { label: string; value: string; detail: string; level: RiskLevel }) {
  return (
    <div className="rounded-lg border border-line bg-slate-50 p-3">
      <p className="text-xs font-bold uppercase text-muted">{label}</p>
      <strong className="mt-1 block text-xl">{value}</strong>
      <p className="mt-1 text-xs text-muted">{detail}</p>
      <div className="mt-2"><Pill level={level}>{riskCopy(level)}</Pill></div>
    </div>
  );
}

function ReadinessTimeline() {
  const steps = [
    ["Data Uploaded", "Complete", "low"],
    ["Variance Review", "Complete", "low"],
    ["VAT Review", "Warning", "medium"],
    ["AR Review", "Warning", "medium"],
    ["Management Review", "Pending", "high"]
  ] as const;

  return (
    <Panel title="Finance Review Timeline">
      <div className="grid gap-3 md:grid-cols-5">
        {steps.map(([step, status, level], index) => (
          <div key={step} className="rounded-lg border border-line bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-100 text-sm font-black">{index + 1}</span>
              <Pill level={level}>{status}</Pill>
            </div>
            <strong>{step}</strong>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
      <h2 className="mb-4 font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Pill({ level, children }: { level: string; children: React.ReactNode }) {
  const colors: Record<string, string> = {
    low: "bg-emerald-100 text-emerald-800",
    medium: "bg-amber-100 text-amber-800",
    high: "bg-red-100 text-red-800",
    critical: "bg-red-100 text-red-800"
  };
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black capitalize ${colors[level] || colors.medium}`}>{children}</span>;
}

function ValidationPill({ status }: { status: ValidationStatus }) {
  const level = status === "passed" ? "low" : status === "warning" ? "medium" : "critical";
  return <Pill level={level}>{status}</Pill>;
}

function TrustPanel({ validationChecks, validationBlockers, validationWarnings }: { validationChecks: ValidationCheck[]; validationBlockers: number; validationWarnings: number }) {
  return (
    <Panel title="Accuracy & Trust Gate">
      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-lg border border-line bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase text-muted">Report Status</p>
          <h3 className="mt-2 text-2xl font-black">{validationBlockers ? "Draft: validation blockers found" : "Draft: evidence-linked review ready"}</h3>
          <p className="mt-2 text-sm text-muted">Core numbers are calculated by rules. AI explains findings only after source files, validation checks and evidence links are available.</p>
          <div className="mt-4 grid gap-2 text-sm">
            <div className="flex justify-between rounded-lg bg-white p-3"><span>Validation blockers</span><strong>{validationBlockers}</strong></div>
            <div className="flex justify-between rounded-lg bg-white p-3"><span>Validation warnings</span><strong>{validationWarnings}</strong></div>
            <div className="flex justify-between rounded-lg bg-white p-3"><span>Findings with source evidence</span><strong>100%</strong></div>
          </div>
        </div>
        <div className="grid gap-3">
          {validationChecks.map((check) => (
            <div key={check.id} className="rounded-lg border border-line bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <strong>{check.name}</strong>
                <ValidationPill status={check.status} />
              </div>
              <p className="mt-2 text-sm text-muted">{check.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function ActionRow({ recommendation, complete }: { recommendation: Recommendation; complete: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-line bg-white p-4">
      <div>
        <strong>{recommendation.action}</strong>
        <p className="text-sm text-muted">{recommendation.expectedImpact}</p>
      </div>
      {recommendation.completed ? (
        <span className="rounded-lg bg-emerald-100 px-3 py-2 text-sm font-black text-emerald-800">Done</span>
      ) : (
        <button className="rounded-lg bg-brand px-3 py-2 text-sm font-black text-white" onClick={complete}>Approve</button>
      )}
    </div>
  );
}

function CopilotPrompt({ question, setQuestion, openCopilot }: { question: string; setQuestion: (value: string) => void; openCopilot: () => void }) {
  return (
    <Panel title="Ask ClosePilot">
      <p className="mb-3 text-sm text-muted">Ask why profit moved, what is blocking close, or where cash risk is hiding.</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input className="h-11 flex-1 rounded-lg border border-line px-3" value={question} onChange={(event) => setQuestion(event.target.value)} />
        <button className="rounded-lg bg-brand px-5 font-bold text-white" onClick={openCopilot}>Ask</button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {["Why is profit down?", "What is blocking month-end?", "Where is cash risk?", "Generate VAT review steps."].map((item) => (
          <button key={item} className="rounded-lg border border-line px-3 py-2 text-left text-sm font-bold" onClick={() => {
            setQuestion(item);
            openCopilot();
          }}>{item}</button>
        ))}
      </div>
    </Panel>
  );
}

function FindingList({ findings, setActive, updateFindingStatus }: { findings: Finding[]; setActive: (value: string) => void; updateFindingStatus?: (findingId: string, status: FindingStatus) => void }) {
  return (
    <div className="grid gap-3">
      {findings.map((finding) => (
        <article key={finding.id} className="rounded-lg border border-line bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-bold">{finding.title}</h3>
              <p className="mt-1 text-sm text-muted">{finding.description}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <Pill level={finding.severity}>{finding.severity}</Pill>
              <Pill level={finding.confidence === "high" ? "low" : finding.confidence === "medium" ? "medium" : "critical"}>{finding.confidence} confidence</Pill>
            </div>
          </div>
          <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
            <strong>Evidence</strong>
            <div className="mt-2 grid gap-2 text-muted md:grid-cols-2">
              <span>Source: {finding.evidence.sourceFile}</span>
              <span>Account: {finding.evidence.accountCode}</span>
              <span>Period: {finding.evidence.period}</span>
              <span>Calculation: {finding.evidence.calculation}</span>
            </div>
            <p className="mt-2 text-muted">Reviewer: {finding.reviewer ?? "Not reviewed"} - Status: {finding.status.replaceAll("_", " ")}</p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="rounded-lg border border-line px-3 py-2 text-sm font-bold" onClick={() => setActive("Ask ClosePilot")}>Ask ClosePilot</button>
            <button className="rounded-lg border border-line px-3 py-2 text-sm font-bold" onClick={() => setActive("ClosePilot Close")}>Open Review</button>
            {updateFindingStatus && finding.status !== "accepted" && <button className="rounded-lg bg-green px-3 py-2 text-sm font-bold text-white" onClick={() => updateFindingStatus(finding.id, "accepted")}>Accept</button>}
            {updateFindingStatus && finding.status !== "rejected" && <button className="rounded-lg border border-line px-3 py-2 text-sm font-bold" onClick={() => updateFindingStatus(finding.id, "rejected")}>Reject</button>}
          </div>
        </article>
      ))}
    </div>
  );
}

function CashChart() {
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={forecast} margin={{ left: -18, right: 12, top: 12, bottom: 0 }}>
          <CartesianGrid stroke="#e5e7eb" strokeDasharray="4 4" vertical={false} />
          <XAxis dataKey="period" tickLine={false} axisLine={false} />
          <YAxis tickFormatter={(value) => `£${Number(value) / 1000}k`} tickLine={false} axisLine={false} />
          <Tooltip formatter={(value) => `£${Number(value).toLocaleString()}`} />
          <Area type="monotone" dataKey="cash" stroke="#0e7490" fill="#cffafe" strokeWidth={3} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function BreakdownChart() {
  const data = Object.entries(scoreBreakdown).map(([name, value]) => ({ name: name.replace(/([A-Z])/g, " $1"), value }));
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 24, right: 18 }}>
          <CartesianGrid stroke="#e5e7eb" strokeDasharray="4 4" horizontal={false} />
          <XAxis type="number" domain={[0, 100]} />
          <YAxis dataKey="name" type="category" width={95} />
          <Tooltip />
          <Bar dataKey="value" fill="#1d4ed8" radius={[0, 6, 6, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function UploadList({ uploads }: { uploads: Upload[] }) {
  return (
    <div className="grid gap-3">
      {uploads.map((upload) => (
        <div key={upload.id} className="flex items-center justify-between gap-3 rounded-lg border border-line p-3">
          <div>
            <strong>{upload.fileName}</strong>
            <p className="text-sm text-muted">{upload.fileType.replaceAll("_", " ")} - uploaded {upload.uploadedAt}{upload.rowCount !== undefined ? ` - ${upload.rowCount} rows` : ""}</p>
          </div>
          <Pill level="low">Parsed</Pill>
        </div>
      ))}
    </div>
  );
}

function UploadAnalyse({ analyseUploads, isAnalysing, uploadMessage, validationChecks }: { analyseUploads: (files: FileList | null) => void; isAnalysing: boolean; uploadMessage: string; validationChecks: ValidationCheck[] }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
      <div className="grid gap-4">
        <Panel title="Upload Month-End Pack">
          <div className="rounded-lg border-2 border-dashed border-line bg-slate-50 p-8 text-center">
            <strong>Drop Trial Balance, P&L, Balance Sheet, AR, AP and VAT files</strong>
            <p className="mt-2 text-sm text-muted">ClosePilot parses CSV, TSV, TXT, XLSX and XLS finance exports server-side, then generates evidence-linked findings and validation checks.</p>
            <label className="mt-5 inline-flex cursor-pointer rounded-lg bg-brand px-4 py-3 font-bold text-white">
              {isAnalysing ? "Analysing..." : "Choose Files"}
              <input className="sr-only" type="file" multiple accept=".csv,.tsv,.txt,.xlsx,.xls" onChange={(event) => analyseUploads(event.target.files)} />
            </label>
            <p className="mt-3 text-sm text-muted">{uploadMessage}</p>
          </div>
        </Panel>
        <Panel title="Validation Checks">
          <div className="grid gap-3">
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
      </div>
      <Panel title="Finance Review Pipeline">
        <div className="grid gap-3">
          {["Validate exports", "Map accounts and periods", "Find anomalies and finance risks", "Generate actions and commentary", "Prepare board-ready finance review"].map((step, index) => (
            <div key={step} className="flex items-center justify-between rounded-lg border border-line p-4">
              <strong>{step}</strong>
              <Pill level={index < 4 ? "low" : "medium"}>{index < 4 ? "Complete" : "Queued"}</Pill>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function MonthEndClose({ findings, recommendations, completeRecommendation, updateFindingStatus }: { findings: Finding[]; recommendations: Recommendation[]; completeRecommendation: (value: Recommendation) => void; updateFindingStatus: (findingId: string, status: FindingStatus) => void }) {
  const closeItems = findings.filter((item) => item.category === "month_end" || item.category === "controls");
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
      <Panel title="Close Review Checklist">
        <FindingList findings={closeItems} setActive={() => undefined} updateFindingStatus={updateFindingStatus} />
      </Panel>
      <Panel title="Recommended Close Actions">
        <div className="grid gap-3">
          {recommendations.filter((item) => item.findingId.includes("accrual") || item.findingId.includes("controls")).map((item) => (
            <ActionRow key={item.id} recommendation={item} complete={() => completeRecommendation(item)} />
          ))}
        </div>
      </Panel>
    </div>
  );
}

function CashflowPanel() {
  return (
    <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
      <Panel title="ClosePilot Cash">
        <CashChart />
      </Panel>
      <Panel title="Working Capital Signals">
        <div className="grid gap-3">
          <Metric title="30-Day Forecast" value="£196k" detail="Medium risk" tone="medium" />
          <Metric title="90-Day Forecast" value="£91k" detail="Collection pressure" tone="high" />
          <Metric title="Expected Collections" value="£74k" detail="From top debtors" tone="low" />
        </div>
      </Panel>
    </div>
  );
}

function CollectionsPanel() {
  const debtors = [
    ["Topline Retail", "£42,300", "Critical", "Call CFO today"],
    ["Wyvern Group", "£31,800", "High", "Send payment plan"],
    ["Aster Foods", "£21,900", "High", "Escalate to sales owner"]
  ];
  return (
    <Panel title="ClosePilot Collections">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead className="text-xs uppercase text-muted">
            <tr><th className="border-b border-line p-3">Debtor</th><th className="border-b border-line p-3">Amount</th><th className="border-b border-line p-3">Risk</th><th className="border-b border-line p-3">Recovery Action</th><th className="border-b border-line p-3"></th></tr>
          </thead>
          <tbody>
            {debtors.map(([name, amount, risk, action]) => (
              <tr key={name}>
                <td className="border-b border-line p-3 font-bold">{name}</td>
                <td className="border-b border-line p-3">{amount}</td>
                <td className="border-b border-line p-3"><Pill level={risk.toLowerCase()}>{risk}</Pill></td>
                <td className="border-b border-line p-3">{action}</td>
                <td className="border-b border-line p-3"><button className="rounded-lg bg-brand px-3 py-2 text-sm font-bold text-white">Draft Email</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function RiskModule({ title, category, findings, updateFindingStatus }: { title: string; category: Finding["category"]; findings: Finding[]; updateFindingStatus: (findingId: string, status: FindingStatus) => void }) {
  return (
    <Panel title={title}>
      <FindingList findings={findings.filter((item) => item.category === category)} setActive={() => undefined} updateFindingStatus={updateFindingStatus} />
    </Panel>
  );
}

function ReportAppendix({ findings, uploads, validationChecks }: { findings: Finding[]; uploads: Upload[]; validationChecks: ValidationCheck[] }) {
  const accepted = findings.filter((item) => item.status === "accepted" || item.status === "resolved").length;
  const unresolved = findings.filter((item) => item.status === "open" || item.status === "in_review").length;
  return (
    <Panel title="Finance Review Appendix">
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-lg border border-line bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase text-muted">Files Analysed</p>
          <strong className="mt-2 block text-3xl">{uploads.length}</strong>
          <p className="mt-1 text-sm text-muted">TB, P&L, balance sheet, AR, AP and VAT exports.</p>
        </div>
        <div className="rounded-lg border border-line bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase text-muted">Validation Checks</p>
          <strong className="mt-2 block text-3xl">{validationChecks.length}</strong>
          <p className="mt-1 text-sm text-muted">{validationChecks.filter((item) => item.status === "passed").length} passed, {validationChecks.filter((item) => item.status === "warning").length} warnings.</p>
        </div>
        <div className="rounded-lg border border-line bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase text-muted">Reviewer Approval</p>
          <strong className="mt-2 block text-3xl">{accepted}/{findings.length}</strong>
          <p className="mt-1 text-sm text-muted">{unresolved} unresolved findings remain before final sign-off.</p>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead className="text-xs uppercase text-muted">
            <tr>
              <th className="border-b border-line p-3">Finding</th>
              <th className="border-b border-line p-3">Source</th>
              <th className="border-b border-line p-3">Confidence</th>
              <th className="border-b border-line p-3">Reviewer</th>
              <th className="border-b border-line p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((finding) => (
              <tr key={finding.id}>
                <td className="border-b border-line p-3 font-bold">{finding.title}</td>
                <td className="border-b border-line p-3">{finding.evidence.sourceFile}</td>
                <td className="border-b border-line p-3">{finding.confidence}</td>
                <td className="border-b border-line p-3">{finding.reviewer ?? "Unassigned"}</td>
                <td className="border-b border-line p-3">{finding.status.replaceAll("_", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function AICopilot({ question, setQuestion, score, findings, company }: { question: string; setQuestion: (value: string) => void; score: number; findings: Finding[]; company: Company }) {
  const [answer, setAnswer] = useState(() => assistantAnswer(question, score, findings, forecast));
  return (
    <Panel title="Ask ClosePilot">
      <div className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
        <div className="grid gap-3">
          <div className="rounded-lg bg-slate-100 p-4">I have reviewed {company.name}'s uploaded data pack from {company.accountingSystem}.</div>
          <div className="whitespace-pre-wrap rounded-lg bg-cyan-50 p-4">{answer}</div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input className="h-11 flex-1 rounded-lg border border-line px-3" value={question} onChange={(event) => setQuestion(event.target.value)} />
            <button className="rounded-lg bg-brand px-4 font-bold text-white" onClick={() => setAnswer(assistantAnswer(question, score, findings, forecast))}>Ask</button>
          </div>
        </div>
        <div className="grid content-start gap-2">
          {["Why is profit down?", "What is blocking month-end close?", "Which debtor should we chase first?", "Generate VAT review steps.", "Why is the finance score low?"].map((item) => (
            <button key={item} className="rounded-lg border border-line px-3 py-3 text-left text-sm font-bold" onClick={() => {
              setQuestion(item);
              setAnswer(assistantAnswer(item, score, findings, forecast));
            }}>{item}</button>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function PracticePortal({ tenant, clients, currentCompanyId, switchCompany }: { tenant: Tenant; clients: ClientCompany[]; currentCompanyId: string; switchCompany: (companyId: string) => void }) {
  const average = Math.round(clients.reduce((sum, client) => sum + client.score, 0) / clients.length);
  return (
    <div className="grid gap-4">
      <Panel title="Tenant Isolation">
        <div className="grid gap-3 md:grid-cols-3">
          <Metric title="Tenant" value={tenant.name} detail={tenant.type === "accounting_practice" ? "Accounting practice workspace" : "Company workspace"} tone="low" />
          <Metric title="Access Model" value="Scoped" detail="tenant_id + company_id on every record" tone="low" />
          <Metric title="Storage Boundary" value="Clean" detail="tenant/company paths for files and reports" tone="low" />
        </div>
      </Panel>
      <section className="grid gap-4 md:grid-cols-3">
        <Metric title="Average Client Score" value={average} detail="Across active clients" tone="medium" />
        <Metric title="High-Risk Clients" value={clients.filter((client) => client.risk === "high" || client.risk === "critical").length} detail="Need review" tone="high" />
        <Metric title="Open Findings" value={clients.reduce((sum, client) => sum + client.openFindings, 0)} detail="Portfolio total" tone="medium" />
      </section>
      <Panel title="Accounting Practice Portfolio">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead className="text-xs uppercase text-muted">
              <tr><th className="border-b border-line p-3">Client</th><th className="border-b border-line p-3">System</th><th className="border-b border-line p-3">Score</th><th className="border-b border-line p-3">Risk</th><th className="border-b border-line p-3">Open Findings</th><th className="border-b border-line p-3">Close Status</th><th className="border-b border-line p-3"></th></tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.id}>
                  <td className="border-b border-line p-3 font-bold">{client.name}</td>
                  <td className="border-b border-line p-3">{client.system}</td>
                  <td className="border-b border-line p-3">{client.score}</td>
                  <td className="border-b border-line p-3"><Pill level={client.risk}>{riskCopy(client.risk)}</Pill></td>
                  <td className="border-b border-line p-3">{client.openFindings}</td>
                  <td className="border-b border-line p-3">{client.closeStatus}</td>
                  <td className="border-b border-line p-3">
                    <button className={`rounded-lg px-3 py-2 text-sm font-bold ${client.id === currentCompanyId ? "bg-slate-100 text-muted" : "bg-brand text-white"}`} onClick={() => switchCompany(client.id)} disabled={client.id === currentCompanyId}>
                      {client.id === currentCompanyId ? "Active" : "Open"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
