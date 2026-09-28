#!/usr/bin/env node
// Checks every public table's row-level-security posture
// (infra/tests/rls_coverage.sql). Read-only: inspects catalogues, mutates
// nothing, so it is safe against any environment including production.
//
//   SUPABASE_DB_URL=postgres://... node scripts/verify-rls-coverage.mjs
//   npm run verify:rls            (auto-loads .env.migrations.local if present)
//
// Exists because three tables reached production with RLS enabled and no
// policies. That is not a lockdown, it is a silent outage: PostgREST reports a
// blocked read as an empty result, never an error, so the symptom is missing
// data rather than a permissions error and it survives review.
//
// Requires the `psql` client on PATH. Exits non-zero if any check fails.

import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sqlFile = join(root, "infra", "tests", "rls_coverage.sql");

if (!process.env.SUPABASE_DB_URL) {
  const envFile = join(root, ".env.migrations.local");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  }
}

const DB_URL = process.env.SUPABASE_DB_URL || process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("No database URL. Set SUPABASE_DB_URL (or add it to .env.migrations.local).");
  process.exit(1);
}

console.log("→ Checking row-level-security coverage on every public table…\n");
try {
  const out = execFileSync("psql", [DB_URL, "-v", "ON_ERROR_STOP=1", "-f", sqlFile], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  process.stdout.write(out);
  // Both checks emit a PASS notice; require both, so a silently skipped block
  // cannot be mistaken for success.
  const passes = (out.match(/PASS:/g) || []).length;
  if (passes < 2) {
    console.error(`\n✗ RLS coverage NOT proven — expected 2 PASS notices, saw ${passes}.`);
    process.exit(1);
  }
  console.log("\n✓ RLS coverage proven: no table is silently unreadable, and no tenant-scoped table is open to the anon key.");
} catch (error) {
  process.stderr.write(error.stdout || "");
  process.stderr.write(error.stderr || "");
  console.error("\n✗ RLS coverage check FAILED (see the RLS FAIL message above).");
  process.exit(1);
}
