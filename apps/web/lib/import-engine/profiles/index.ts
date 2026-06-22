import type { ImportMappingProfile, Upload } from "@/lib/types";
import type { ColumnMapping, MappingSuggestion } from "../mappings/aliases";

export type SupportedImportFileType = Extract<Upload["fileType"], "trial_balance" | "aged_debtors" | "aged_creditors" | "vat_report">;

type ProfileSeed = {
  id: string;
  profileName: string;
  vendor: string;
  fileType: SupportedImportFileType;
  mapping: ColumnMapping;
};

const builtInProfiles: ProfileSeed[] = [
  {
    id: "profile_builtin_xero_tb",
    profileName: "Xero Trial Balance",
    vendor: "Xero",
    fileType: "trial_balance",
    mapping: { accountCode: "code", accountName: "name", balance: "balance" },
  },
  {
    id: "profile_builtin_sage_tb",
    profileName: "Sage Trial Balance",
    vendor: "Sage",
    fileType: "trial_balance",
    mapping: { accountCode: "nominal_code", accountName: "description", debit: "debit", credit: "credit" },
  },
  {
    id: "profile_builtin_quickbooks_tb",
    profileName: "QuickBooks Trial Balance",
    vendor: "QuickBooks",
    fileType: "trial_balance",
    mapping: { accountName: "account_name", balance: "amount" },
  },
];

export function headersSignature(headers: string[]) {
  return Array.from(new Set(headers.map((header) => header.trim().toLowerCase()).filter(Boolean))).sort().join("|");
}

export function mappingConfidence(suggestions: MappingSuggestion[]) {
  if (!suggestions.length) return 0;
  return Math.round((suggestions.reduce((sum, item) => sum + item.confidence, 0) / suggestions.length) * 100);
}

export function profileFromSuggestions(input: {
  tenantId?: string;
  companyId?: string;
  fileType: SupportedImportFileType;
  vendor?: string;
  profileName?: string;
  headers: string[];
  mapping: ColumnMapping;
  suggestions: MappingSuggestion[];
  status?: ImportMappingProfile["status"];
  source?: ImportMappingProfile["source"];
}): ImportMappingProfile {
  const confidence = mappingConfidence(input.suggestions);
  const source = input.source ?? "suggested";
  return {
    id: `profile_${source}_${input.fileType}_${headersSignature(input.headers).slice(0, 40).replace(/[^a-z0-9|]+/gi, "_")}`,
    tenantId: input.tenantId,
    companyId: input.companyId,
    profileName: input.profileName ?? `${input.vendor ?? "Detected"} ${labelForFileType(input.fileType)}`,
    vendor: input.vendor,
    fileType: input.fileType,
    mapping: Object.fromEntries(Object.entries(input.mapping).filter(([, value]) => Boolean(value))) as Record<string, string>,
    fields: input.suggestions.map((item) => ({
      targetField: item.targetField,
      sourceColumn: item.sourceColumn,
      confidence: Math.round(item.confidence * 100),
    })),
    confidence,
    status: input.status ?? (confidence >= 85 ? "suggested" : "needs_confirmation"),
    source,
    headersSignature: headersSignature(input.headers),
    lastUsedAt: new Date().toISOString(),
  };
}

export function resolveImportProfile(input: {
  fileType: SupportedImportFileType;
  headers: string[];
  vendor?: string;
  savedProfiles?: ImportMappingProfile[];
}): { mapping?: ColumnMapping; profile?: ImportMappingProfile } {
  const saved = findSavedProfile(input.fileType, input.headers, input.savedProfiles ?? []);
  if (saved) return { mapping: saved.mapping as ColumnMapping, profile: { ...saved, lastUsedAt: new Date().toISOString() } };

  const builtIn = builtInProfiles.find((profile) => {
    if (profile.fileType !== input.fileType) return false;
    if (input.vendor && !profile.vendor.toLowerCase().includes(input.vendor.toLowerCase()) && !input.vendor.toLowerCase().includes(profile.vendor.toLowerCase())) return false;
    return mappingColumnsPresent(profile.mapping, input.headers);
  }) ?? builtInProfiles.find((profile) => profile.fileType === input.fileType && mappingColumnsPresent(profile.mapping, input.headers));

  if (!builtIn) return {};
  const profile: ImportMappingProfile = {
    id: builtIn.id,
    profileName: builtIn.profileName,
    vendor: builtIn.vendor,
    fileType: builtIn.fileType,
    mapping: builtIn.mapping as Record<string, string>,
    fields: Object.entries(builtIn.mapping).map(([targetField, sourceColumn]) => ({ targetField, sourceColumn: sourceColumn ?? "", confidence: 100 })),
    confidence: 100,
    status: "known_profile",
    source: "built_in",
    headersSignature: headersSignature(input.headers),
    lastUsedAt: new Date().toISOString(),
  };
  return { mapping: builtIn.mapping, profile };
}

function findSavedProfile(fileType: SupportedImportFileType, headers: string[], profiles: ImportMappingProfile[]) {
  const signature = headersSignature(headers);
  return profiles.find((profile) =>
    profile.fileType === fileType &&
    profile.status === "confirmed" &&
    (profile.headersSignature === signature || mappingColumnsPresent(profile.mapping as ColumnMapping, headers))
  );
}

function mappingColumnsPresent(mapping: ColumnMapping, headers: string[]) {
  const headerSet = new Set(headers);
  return Object.values(mapping).filter(Boolean).every((sourceColumn) => headerSet.has(sourceColumn));
}

function labelForFileType(fileType: SupportedImportFileType) {
  return {
    trial_balance: "Trial Balance",
    aged_debtors: "Aged Debtors",
    aged_creditors: "Aged Creditors",
    vat_report: "VAT Report",
  }[fileType];
}
