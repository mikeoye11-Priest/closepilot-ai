#!/usr/bin/env node
// Runs the tenant-isolation proof (infra/tests/tenant_isolation.sql) against the
// database. The SQL seeds two tenants, assumes each one's authenticated identity
// and asserts no cross-tenant reads, then ROLLS BACK — so it never mutates data
// and is safe against any environment, including production.
//
//   SUPABASE_DB_URL=postgres://... node scripts/verify-tenant-isolation.mjs
//   npm run verify:isolation            (auto-loads .env.migrations.local if present)
//
// Requires the `psql` client on PATH. Exits non-zero if any isolation check fails.

import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sqlFile = join(root, "infra", "tests", "tenant_isolation.sql");

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

console.log("→ Running tenant-isolation proof (seeds two tenants, asserts no cross-tenant reads, rolls back)…\n");
try {
  const out = execFileSync("psql", [DB_URL, "-v", "ON_ERROR_STOP=1", "-f", sqlFile], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  process.stdout.write(out);
  // Both DO blocks emit a PASS notice; require both.
  const passes = (out.match(/PASS:/g) || []).length;
  if (passes < 2) {
    console.error(`\n✗ Tenant isolation NOT proven — expected 2 PASS notices, saw ${passes}.`);
    process.exit(1);
  }
  console.log("\n✓ Tenant isolation proven: neither tenant can read the other's integrations, sync runs or audit logs.");
} catch (error) {
  process.stderr.write(error.stdout || "");
  process.stderr.write(error.stderr || "");
  console.error("\n✗ Tenant-isolation proof FAILED (see the ISOLATION/SETUP FAIL message above).");
  process.exit(1);
}
