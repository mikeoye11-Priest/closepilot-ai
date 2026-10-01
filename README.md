# ClosePilot AI

ClosePilot AI turns finance exports into a board-ready finance health review.

Upload Trial Balance, P&L, Balance Sheet, AR, AP and VAT files. ClosePilot finds risks, explains changes, forecasts cash, produces management commentary and recommends actions.

## Positioning

ClosePilot does not replace Sage, Xero, QuickBooks, Business Central, Unit4, SAP or Oracle.

ClosePilot is an AI Finance Review Platform that sits above accounting systems and helps finance teams answer:

- What changed?
- What looks wrong?
- What is blocking month-end close?
- Where is cash risk hiding?
- What should the board know?
- What should finance do next?

## Wedge

**Upload your finance pack. ClosePilot finds risks, explains changes, and recommends actions.**

Month-end review is one module. The broader platform supports daily finance health review across cash, AR, AP, VAT, controls and management insight.

## Accuracy & Trust Model

ClosePilot is designed around the principle:

**AI writes the narrative. Rules produce the evidence. Humans approve the conclusion.**

Accuracy requirements:

- Core calculations must be deterministic, not AI-generated.
- Every finding must link back to source files, account codes, periods and calculation logic.
- Uploaded packs must pass validation checks before a final report can be exported.
- Findings must show confidence levels and reviewer status.
- Low-confidence findings must be labelled as review items, not facts.
- Users must be able to accept, reject or resolve findings before sign-off.
- Every exported finance review must include an appendix showing files analysed, checks run, rules applied, unresolved findings and approvals.

ClosePilot does not guess. It analyses finance exports, shows its evidence, and lets finance teams approve the final review.

## Continuous Finance Assurance

The long-term product direction is not another reporting tool. ClosePilot should become the second finance reviewer that never gets tired and reviews 100% of the available data every time.

Target flow:

```text
Data
  -> Data Integrity Engine
  -> Finance Rules Engine
  -> Statistical Detection
  -> Finance Knowledge Graph
  -> AI Insight Engine
  -> Human Review
```

The layers are deliberately separated:

- Data Integrity Engine checks source quality before analysis.
- Finance Rules Engine applies deterministic accounting logic.
- Statistical Detection finds outliers, trend breaks and unusual movements.
- Finance Knowledge Graph links GL, VAT, AP, AR, bank, payroll, customers and suppliers.
- AI Insight Engine explains the evidence and recommends next actions.
- Human Review accepts, rejects or resolves findings before sign-off.

The moat is the finance rules library, anomaly dataset, industry benchmarks and knowledge graph. OpenAI powers narrative and reasoning support; it must not be the source of deterministic calculations.

## Multi-tenant model

Three shapes are supported by one structure:

| Tenant | Org unit (optional) | Company |
|---|---|---|
| Accounting practice | Branch / office | Client |
| Multi-entity group | Division / region | Legal entity |
| Single company | *none* | The company itself |

`companies.org_unit_id` is nullable, so a single entity and a practice that has
not organised its branches both work without special-casing. The vocabulary
(`branch` vs `division`, `client` vs `entity`) is derived from the tenant type
in `lib/org-units.ts`, not stored in the schema.

**Membership is many-to-many.** A person can belong to several firms — an
accountant who consults for two practices, or a ClosePilot facilitator across
pilot firms. `users.tenant_id` is only a home-tenant hint; membership lives in
`user_scope_access`.

Access is granted at the level a firm thinks in:

- `user_scope_access` — whole tenant (`org_unit_id` null) or one org unit.
- `user_company_access` — one company, which is the right shape for a client
  user who should see only their own entity.

`has_company_access()` ORs both, so every RLS policy written against it honours
either. Granting per company alone does not scale: "manages the Manchester
branch" would be 100 rows, and would silently exclude the 101st client.

### Roles

`practice_admin` · `manager` · `preparer` · `client_user`, mapped to
capabilities in `lib/permissions.ts` rather than compared as strings at call
sites. Capability is the **union** of every grant held, since a user can be
firm-wide preparer and manager of one branch. Nobody can grant a role above
their own.

The four-eyes split is enforced, not just modelled: a manager can approve a
finding but cannot partner sign off. Enforcement is server-side on the snapshot
write, because sign-off persists through the snapshot rather than its own
endpoint; the UI gating is advisory.

### Data separation

Every client-facing table carries `tenant_id`, and row-level security enforces
scope from the authenticated session. Two proofs run against a real database:

- `npm run verify:isolation` — seeds two tenants, assumes each identity, asserts
  no cross-tenant reads, rolls back.
- `npm run verify:rls` — fails if any table has RLS enabled with **no policies**
  (silently unreadable — PostgREST returns an empty result, never an error), or
  if a tenant-scoped table has RLS off (readable with the public anon key).

The second exists because three tables reached production in that state.

## Authentication

Supabase email/password. `apps/web/proxy.ts` is the gate; `CLOSEPILOT_AUTH_DISABLED=1`
bypasses it in development only (never when `NODE_ENV=production`).

- `/forgot-password` → `/api/auth/reset-request` (server-side, so send failures
  reach error tracking rather than only the user) → `/auth/confirm` → `/update-password`
- `/practice/people` → invite → `/auth/confirm` → `/join` → `/update-password`

`/auth/confirm` verifies a `token_hash` via `verifyOtp`, which needs no
browser-bound state and therefore works when the email is opened on a different
device. It also accepts a PKCE `code`, and forwards a parameterless request to
`/auth/confirm/recover`, which reads an implicit-flow session from the URL
fragment. That fallback matters: Supabase's stock `{{ .ConfirmationURL }}`
template returns the token in the fragment, which is never sent to the server.

Inviting an address that already has an account grants access directly instead
of failing — a normal case once membership is many-to-many.

## Repository layout

- `apps/web` — Next.js 16 (App Router, Turbopack), TypeScript, Tailwind. 38 API
  routes. `components/app-shell.tsx` holds most of the UI and is ~13k lines;
  splitting it is the main obstacle to fast UI iteration.
- `apps/api` — FastAPI modular monolith scaffold.
- `infra/schema.sql` + `infra/*.sql` — the historical baseline, applied by hand
  and known to have drifted.
- `infra/migrations/NNNN_*.sql` — tracked, idempotent, one transaction each.
  **New schema changes go here, never in the legacy files.**
- `infra/tests/*.sql` — isolation, erasure and RLS proofs.
- `qa/` — 40 test suites.

## Current state

Working and exercised against the deployed app:

- Upload → validation → evidence-linked findings → manager review → partner
  sign-off → exported review pack.
- Deliverables: management accounts, FRS 102 (1A and full), draft CT600, draft
  iXBRL. `npm run test:pilot-readiness` drives the whole chain for Xero,
  QuickBooks, Sage and upload, asserting each balances and cites the correct source.
- Integrations: Xero, QuickBooks and Sage Business Cloud (OAuth), plus Sage 50
  and generic file import. All three are configured in production, but live
  OAuth has only been exercised for Xero; QuickBooks currently points at
  **sandbox**, and Sage Business Cloud has never been connected live.
- Auth: password reset and invitations, both verified end to end in production.

Known constraints, stated plainly:

- The Supabase project is **shared with an unrelated product**. RLS protects
  users from each other, not applications — that product's service-role key can
  read every table. See `docs/supabase-project-separation.md`.
- No firm switcher yet; a user in two firms loads whichever they have most
  grants in.
- Free-tier Supabase pauses on inactivity, which presents as
  `TypeError: Failed to fetch` with no mention of Supabase.
- Auth email requires Resend SMTP on **port 465**. Port 587 fails with an
  unhelpful `unexpected_failure` and no entry in Resend's logs, which is hard
  to diagnose from the error alone.

## Running it

```bash
npm install
npm run dev            # http://localhost:3004
```

Needs `apps/web/.env.local` with `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SITE_URL`. See `.env.example`.

```bash
pip install -r apps/api/requirements.txt
npm run dev:api
```

### Database

```bash
npm run db:migrate     # applies any unapplied infra/migrations/*.sql
```

Reads `SUPABASE_DB_URL` from the environment or `.env.migrations.local`, and
needs `psql` on PATH. Re-running is safe. To check SQL without applying it:

```bash
{ echo "begin;"; cat infra/migrations/00NN_x.sql; echo "rollback;"; } \
  | psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1
```

### Verifying

```bash
npm run verify              # the full gate: build + every suite
npm run test:pilot-readiness  # the deliverable chain, all four sources
npm run verify:rls            # RLS posture on every table
npm run verify:isolation      # cross-tenant read proof
npm run verify:erasure        # right-to-erasure proof
```

The three `verify:*` scripts are read-only or roll back, so they are safe to run
against any environment including production.

## Accuracy in practice

The trust model above is enforced by gates rather than intent:

- `npm run test:rules` — rule accuracy and false-positive rate. A false positive
  costs more than a missed finding here: a partner who chases one phantom stops
  trusting the tool.
- `npm run test:ai-explanations` — every narrative must be grounded in the
  evidence it cites.
- `npm run test:invariants` — cross-module checks, including that every
  deliverable balances and cites the right source.

## UI simplification roadmap

The product is functionally broad, but the interface currently exposes too much
context, guidance and supporting evidence at the same time. The design goal is
to move from “show everything ClosePilot knows” to “show the decision the user
needs to make next, with evidence available on demand.” This is an information-
architecture and content-density programme, not a visual rebrand.

### Product-wide design rules

- Each page has one title, at most one short context line and one primary action.
- Operational pages show no more than four headline metrics.
- Evidence, calculations, score explanations and methodology use progressive
  disclosure instead of competing with the primary task.
- Marketing-style headlines belong in onboarding and the public site. Inside
  the application, headings use literal task names such as `Upload finance
  pack`, `Review status`, `Collection priorities` and `Assurance coverage`.
- Colour is reserved for blockers, warnings, successful sign-off and destructive
  actions; ordinary information should not look like an alert.
- Findings are the centre of the product. Other modules should lead users to a
  decision, evidence request, resolution or sign-off rather than duplicating the
  finding lifecycle.
- Practice-value estimates such as time saved and manager capacity belong in
  Practice Metrics, not in every client-review header.

### Information architecture

The main navigation should present five primary areas, with the existing
capabilities nested beneath them:

1. **Overview** — the current client's decision status and blockers.
2. **Review** — findings, finance review, VAT, controls, audit readiness and
   close review.
3. **Reports** — review pack, accounts, cash, collections, change analysis and
   inventory/WIP.
4. **Clients & firm** — finance-pack intake, client portfolio, people, practice
   metrics and scheduled reports.
5. **Settings & help** — integrations/settings, assurance configuration,
   compatibility and guidance.

`Ask ClosePilot` should ultimately become a contextual assistant available from
the current screen rather than a separate destination. On mobile, the horizontal
rail should be replaced by a grouped menu drawer.

### Priority screens

**Overview / Partner Summary**

- Answer four questions first: can this be signed off, what is material, what
  remains unresolved, and what happens next.
- Lead with sign-off state, material exposure, unresolved blockers and evidence
  completion.
- Put score drivers, forecasts, activity, commercial value and extended metrics
  behind expandable secondary sections.
- Do not show multiple competing expressions of the same readiness state.

**Upload Finance Pack**

- Put the upload control before explanatory and diagnostic material.
- Use the concise instruction `Drop files here or choose files`.
- After upload, show coverage, mapping and validation in one compact status row.
- Remove duplicated instructions across the header, upload box, checklist,
  progress panel and next-action panel.

**Findings**

- Bring the review queue to the top and use a master-detail layout on wide
  screens: filters and findings on the left, evidence and decision controls on
  the right.
- Keep lifecycle statistics, sign-off gates and readiness forecasts in a compact
  Review Progress disclosure.
- Prioritise critical/high, evidence-needed and unresolved filters.

**Reports and specialist modules**

- Treat Finance Review, VAT, Controls and Audit Readiness as views of one review,
  not unrelated product destinations.
- Treat Accounts and Review Pack as report outputs.
- Place Collections beneath Cash unless user research proves it is a distinct
  daily workspace.
- Keep draft CT600 and iXBRL limitations visible at the point of export without
  repeating the full disclaimer throughout the application.

### Visual and responsive system

- Use three levels: primary decision, supporting workflow, and on-demand detail.
- Reduce nested cards and reserve bordered containers for meaningful groups.
- Use one strong page heading; use medium-weight section titles and regular body
  copy instead of repeated uppercase eyebrows and `font-black` headings.
- Convert wide operational tables into stacked summary rows on small screens.
- Test at 320px, 768px, 1024px and 1440px, including keyboard navigation between
  the findings list and detail panel.

### Delivery phases

- **P0 — simplify without changing behaviour:** regroup navigation, quieten the
  global header, remove duplicate next-action guidance, shorten operational
  copy, limit top-line metrics and expose the primary task sooner.
- **P1 — rebuild the core journey:** redesign Overview, Upload Finance Pack and
  Findings around the task-first structures above.
- **P2 — consolidate modules:** merge overlapping review/report destinations,
  introduce the contextual assistant and separate client-level from practice-
  level measures.
- **P3 — responsive and accessibility refinement:** mobile drawer, responsive
  finding/table layouts, non-colour status cues and full keyboard testing.

P0 implementation began on 1 October 2026. Behaviour, calculations, evidence,
permissions and export controls must remain unchanged while presentation is
simplified.
