#!/usr/bin/env node
// Runs the right-to-erasure proof (infra/tests/erasure_proof.sql) against the
// database. The SQL seeds a tenant with a TARGET and a BYSTANDER company, erases
// the target exactly as POST /api/integrations/erase does, asserts the target's
// financial data + connection + payload are gone, the erasure fact is recorded and
// the bystander is untouched, then ROLLS BACK — so it never mutates data and is
// safe against any environment, including production.
//
//   SUPABASE_DB_URL=postgres://... node scripts/verify-erasure.mjs
//   npm run verify:erasure              (auto-loads .env.migrations.local if present)
//
// Requires the `psql` client on PATH. Exits non-zero if any erasure check fails.

import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sqlFile = join(root, "infra", "tests", "erasure_proof.sql");

// Load .env.migrations.local (simple KEY=VALUE) if the URL isn't already set.
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

console.log("→ Running right-to-erasure proof (seeds target + bystander, erases target, asserts, rolls back)…\n");
try {
  const out = execFileSync("psql", [DB_URL, "-v", "ON_ERROR_STOP=1", "-f", sqlFile], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  process.stdout.write(out);
  // Both DO blocks emit a PASS notice; require both (pre-erasure + post-erasure).
  const passes = (out.match(/PASS:/g) || []).length;
  if (passes < 2) {
    console.error(`\n✗ Erasure NOT proven — expected 2 PASS notices, saw ${passes}.`);
    process.exit(1);
  }
  console.log("\n✓ Right to erasure proven: a client's synced financials + connection are removed in full, the erasure fact is retained, and no other client is affected.");
} catch (error) {
  process.stderr.write(error.stdout || "");
  process.stderr.write(error.stderr || "");
  console.error("\n✗ Erasure proof FAILED (see the ERASURE/SETUP FAIL message above).");
  process.exit(1);
}
