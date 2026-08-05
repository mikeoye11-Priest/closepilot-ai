const required = [
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
];

const missing = required.filter((name) => !process.env[name]?.trim());
const problems = [];

if (missing.length) problems.push(`Missing required environment variables: ${missing.join(", ")}`);
if (process.env.CLOSEPILOT_AUTH_DISABLED === "1") problems.push("CLOSEPILOT_AUTH_DISABLED must not be 1 for a pilot deployment.");

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
if (siteUrl && !/^https:\/\//i.test(siteUrl)) problems.push("NEXT_PUBLIC_SITE_URL must use HTTPS.");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
if (supabaseUrl && !/^https:\/\/.+\.supabase\.co\/?$/i.test(supabaseUrl)) problems.push("NEXT_PUBLIC_SUPABASE_URL must be a Supabase HTTPS project URL.");

// Each live connector is all-or-nothing: if any of its OAuth vars is set, the full
// set (plus the shared token-encryption key) must be present, or Connect will fail
// at the provider. Mirrors the per-provider connector runbook (docs/pilot-1).
const CONNECTORS = [
  { label: "Xero", vars: ["XERO_CLIENT_ID", "XERO_CLIENT_SECRET", "XERO_REDIRECT_URI"] },
  { label: "QuickBooks", vars: ["QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET", "QUICKBOOKS_REDIRECT_URI"] },
  { label: "Sage", vars: ["SAGE_CLIENT_ID", "SAGE_CLIENT_SECRET", "SAGE_REDIRECT_URI"] },
];
const connectorStatus = {};
for (const { label, vars } of CONNECTORS) {
  const enabled = vars.some((name) => process.env[name]?.trim());
  connectorStatus[label] = enabled ? "enabled" : "disabled";
  if (!enabled) continue;
  for (const name of [...vars, "INTEGRATION_ENCRYPTION_KEY"]) {
    if (!process.env[name]?.trim()) problems.push(`${name} is required when ${label} is enabled.`);
  }
}

if (problems.length) {
  console.error("ClosePilot launch readiness: FAILED");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log("ClosePilot launch readiness: PASSED");
console.log(`- Site: ${siteUrl}`);
console.log("- Supabase authentication configured");
console.log(`- AI commentary: ${process.env.GEMINI_API_KEY ? "enabled" : "deterministic fallback"}`);
console.log(`- Connectors: Xero ${connectorStatus.Xero}, QuickBooks ${connectorStatus.QuickBooks}, Sage ${connectorStatus.Sage}`);
