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

if (process.env.XERO_CLIENT_ID || process.env.XERO_CLIENT_SECRET || process.env.XERO_REDIRECT_URI) {
  for (const name of ["XERO_CLIENT_ID", "XERO_CLIENT_SECRET", "XERO_REDIRECT_URI", "INTEGRATION_ENCRYPTION_KEY"]) {
    if (!process.env[name]?.trim()) problems.push(`${name} is required when Xero is enabled.`);
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
console.log(`- Xero: ${process.env.XERO_CLIENT_ID ? "enabled" : "disabled"}`);
