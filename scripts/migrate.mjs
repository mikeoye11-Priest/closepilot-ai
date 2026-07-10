#!/usr/bin/env node
// Applies pending SQL migrations in infra/migrations/ that are not yet recorded
// in the schema_migrations table. Idempotent and transactional per file.
//
//   SUPABASE_DB_URL=postgres://... node scripts/migrate.mjs
//   npm run db:migrate            (auto-loads .env.migrations.local if present)
//
// Requires the `psql` client on PATH.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "infra", "migrations");

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

function psql(args, inherit = false) {
  return execFileSync("psql", [DB_URL, "-v", "ON_ERROR_STOP=1", ...args], {
    encoding: "utf8",
    stdio: inherit ? "inherit" : ["ignore", "pipe", "inherit"],
  });
}

// 1. tracking table
psql(["-q", "-c", "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now());"]);

// 2. already-applied set
const applied = new Set(
  psql(["-tAc", "select name from schema_migrations;"]).split("\n").map((s) => s.trim()).filter(Boolean),
);

// 3. apply pending migrations in filename order, each in its own transaction
const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
let ran = 0;
for (const file of files) {
  if (applied.has(file)) {
    console.log(`= ${file} (already applied)`);
    continue;
  }
  console.log(`→ applying ${file}`);
  psql(["-1", "-f", join(migrationsDir, file)], true);
  psql(["-q", "-c", `insert into schema_migrations (name) values ('${file.replace(/'/g, "''")}') on conflict (name) do nothing;`]);
  ran += 1;
}

console.log(ran ? `\n✓ Applied ${ran} migration(s).` : "\n✓ Up to date — nothing to apply.");
