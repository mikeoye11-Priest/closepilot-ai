import { calculateFinanceScorecard, riskLabel } from "./finance";
import { isOpenFinding } from "./finding-ledger";
import type { AnalysisResult, ClientCompany, Company, ImportMappingProfile } from "./types";
import { VAT_ENGINE_VERSION } from "./vat-engine";
import type { VatReviewResult } from "./vat-engine/types";

export const PERSISTABLE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const emptyAnalysisResult: AnalysisResult = {
  uploads: [],
  validationChecks: [],
  findings: [],
  importProfiles: [],
  findingEvidence: [],
  findingComments: [],
  findingActivities: [],
  collectionCases: [],
  partnerSignOff: undefined,
  recommendations: [],
  vatReview: undefined,
};

export function emptySnapshot(): AnalysisResult {
  return {
    ...emptyAnalysisResult,
    uploads: [],
    validationChecks: [],
    findings: [],
    importProfiles: [],
    findingEvidence: [],
    findingComments: [],
    findingActivities: [],
    collectionCases: [],
    partnerSignOff: undefined,
    recommendations: [],
  };
}

export function isUnusableVatReview(vatReview?: VatReviewResult) {
  if (!vatReview || vatReview.source === "empty") return false;
  if (vatReview.engineVersion === VAT_ENGINE_VERSION) return false;
  const rateFindingFlood = vatReview.findings.filter(
    (finding) => finding.id === "VAT101" || /Invalid VAT rate detected/i.test(finding.finding),
  ).length;
  return (vatReview.scoreBreakdown?.computationAccuracy ?? 100) === 0 && rateFindingFlood >= 20;
}

export type SnapshotFetch = { ok: true; snapshot: AnalysisResult | null } | { ok: false };

export async function fetchCompanySnapshot(companyId: string): Promise<SnapshotFetch> {
  if (!PERSISTABLE_ID.test(companyId)) return { ok: true, snapshot: null };
  try {
    const response = await fetch(`/api/workspace/snapshot?companyId=${encodeURIComponent(companyId)}`);
    if (!response.ok) return { ok: false };
    return { ok: true, snapshot: ((await response.json()).snapshot ?? null) as AnalysisResult | null };
  } catch {
    return { ok: false };
  }
}

export function normaliseSnapshot(
  snapshot?: AnalysisResult,
  options: { preserveStaleVatReview?: boolean } = {},
): AnalysisResult {
  if (!snapshot || snapshot.uploads.length === 0) return emptySnapshot();
  const reviewLocked = snapshot.partnerSignOff?.reviewPackStatus === "LOCKED"
    || snapshot.partnerSignOff?.status === "locked"
    || snapshot.partnerSignOff?.status === "signed";
  const unusableVatReview = isUnusableVatReview(snapshot.vatReview);
  return {
    uploads: snapshot.uploads,
    validationChecks: snapshot.validationChecks ?? [],
    findings: snapshot.findings ?? [],
    importProfiles: snapshot.importProfiles ?? [],
    findingEvidence: snapshot.findingEvidence ?? [],
    findingComments: snapshot.findingComments ?? [],
    findingActivities: snapshot.findingActivities ?? [],
    collectionCases: snapshot.collectionCases ?? [],
    partnerSignOff: snapshot.partnerSignOff,
    recommendations: (snapshot.recommendations ?? []).map((recommendation) => reviewLocked ? { ...recommendation, completed: true } : recommendation),
    vatReview: unusableVatReview && !options.preserveStaleVatReview ? undefined : snapshot.vatReview,
    inventoryReview: snapshot.inventoryReview,
    statements: snapshot.statements,
  };
}

export function clientToCompany(client: ClientCompany, tenantId: string): Company {
  return {
    id: client.id,
    tenantId,
    name: client.name,
    industry: "Professional Services",
    accountingSystem: client.system,
    currency: "GBP",
    country: "United Kingdom",
  };
}

export function updateClientSummary(
  clients: ClientCompany[],
  company: Company,
  snapshot: AnalysisResult,
): ClientCompany[] {
  if (!snapshot.uploads.length) {
    const nextClient: ClientCompany = {
      id: company.id,
      name: company.name,
      system: company.accountingSystem,
      score: 0,
      risk: "medium",
      openFindings: 0,
      closeStatus: "Awaiting upload",
    };
    return [nextClient, ...clients.filter((item) => item.id !== company.id)];
  }
  const score = calculateFinanceScorecard(
    snapshot.findings,
    snapshot.validationChecks,
    snapshot.recommendations,
    snapshot.uploads,
  ).overall;
  const nextClient: ClientCompany = {
    id: company.id,
    name: company.name,
    system: company.accountingSystem,
    score,
    risk: riskLabel(score),
    openFindings: snapshot.findings.filter(isOpenFinding).length,
    closeStatus: `${snapshot.uploads.length} files reviewed`,
  };
  return [nextClient, ...clients.filter((item) => item.id !== company.id)];
}

export function mergeImportProfiles(existing: ImportMappingProfile[], incoming: ImportMappingProfile[]) {
  const merged = new Map(existing.map((profile) => [profile.id, profile]));
  incoming.forEach((profile) => {
    const prior = merged.get(profile.id);
    merged.set(
      profile.id,
      prior?.status === "confirmed"
        ? { ...profile, ...prior, lastUsedAt: profile.lastUsedAt ?? prior.lastUsedAt }
        : profile,
    );
  });
  return Array.from(merged.values());
}
