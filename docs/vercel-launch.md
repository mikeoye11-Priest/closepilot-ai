# ClosePilot Vercel Launch Runbook

This runbook prepares a private Preview deployment before any production or real-client launch.

## 1. Vercel project

Import `mikeoye11-Priest/closepilot-ai` into Vercel with:

- Framework Preset: **Next.js**
- Root Directory: repository root (`.`)
- Install Command: `npm ci`
- Build Command: `npm run build:web`
- Output Directory: `apps/web/.next`
- Node.js: a supported 20.x or 22.x release
- Function region: London (`lhr1`)

These settings are also captured in `vercel.json`.

## 2. Supabase

Create a dedicated staging Supabase project. Run, in order:

1. `infra/schema.sql`
2. `infra/workspace_migration.sql`
3. `infra/storage_migration.sql`
4. `infra/report_metadata_migration.sql`
5. `infra/accounting_integrations_migration.sql` only if integrations are enabled

Confirm Row Level Security policies exist and create named pilot users. Do not use a production client database for the first deployment rehearsal.

## 3. Environment variables

Copy the names from `.env.example` into Vercel Project Settings. Configure them separately for Preview and Production. Do not set `CLOSEPILOT_AUTH_DISABLED=1` in Vercel.

Required:

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Optional for Pilot 1:

- `GEMINI_API_KEY` — deterministic answers remain available without it
- Xero variables — configure all four together or leave all disabled

After changing an environment variable, redeploy; Vercel changes do not affect an existing deployment.

## 4. Preview deployment

Create a `pilot-preview` branch and deploy it as a Vercel Preview. Set `NEXT_PUBLIC_SITE_URL` to its stable branch URL, then redeploy so redirects and OAuth callbacks use the correct origin.

Run:

```bash
vercel link
vercel env pull .env.vercel.local
vercel build
```

Or allow the Git integration to build the preview from the branch.

## 5. Deployment gates

The deployment is not pilot-ready until all pass:

```bash
npm test
npm run test:rules
npm run test:finance-regression
npm run test:ai-explanations
```

With Vercel variables loaded locally:

```bash
node --env-file=.env.vercel.local scripts/check-launch-readiness.mjs
```

Against the Preview URL:

```bash
curl --fail https://closepilot-ai-nvlz.vercel.app/api/health
CLOSEPILOT_QA_URL=https://closepilot-ai-nvlz.vercel.app npm run test:upload
CLOSEPILOT_QA_URL=https://closepilot-ai-nvlz.vercel.app npm run test:ui
```

Vercel Functions accept request bodies up to 4.5 MB. ClosePilot therefore limits each pilot upload request to 12 supported files and 4 MB combined. Larger packs need direct-to-storage upload work before they are supported.

## 6. Manual security and data checks

- [ ] Unauthenticated users are redirected to `/login`.
- [ ] Production ignores any accidental auth-disable flag.
- [ ] User A cannot see User B's firm, client, uploads or reports.
- [ ] Uploaded files land in the correct private Supabase Storage path.
- [ ] Wrong-tenant IDs are rejected by RLS.
- [ ] Sign-out returns to the configured site URL.
- [ ] Browser security headers are present.
- [ ] `/api/health` returns `ready` without exposing secret values.
- [ ] File deletion and agreed retention behaviour are verified.
- [ ] Runtime logs and an incident alert route are assigned to an owner.

## 7. Promote

Only promote the tested Preview deployment after:

- the Pilot 1 launch-pack placeholders are complete;
- data-processing terms are signed;
- the staging URL has passed the 60-minute internal rehearsal;
- a rollback owner is named; and
- the first pilot session is supervised.

Use Vercel's Preview-to-Production promotion or deploy the verified commit with `vercel --prod`. Record the deployment URL and commit SHA in `docs/pilot-1/01-staging-access.md`.

## Safe pilot-data reset

To return the application to first-run onboarding without deleting Auth users or schema, run `infra/pilot_data_reset.sql` in the Supabase SQL Editor. Then open **Storage → finance-uploads**, select the `tenants` folder and delete it through the Storage UI. Sign out and back in to confirm the onboarding screen appears.
