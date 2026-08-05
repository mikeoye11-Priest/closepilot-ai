# ClosePilot — Compliance pack (drafts)

> **STATUS: DRAFT.** These documents are starting-point templates for the
> non-code compliance track that gates onboarding a real practice's live client
> data. They are grounded in what ClosePilot actually does technically, but they
> are **not legal advice** and **must be reviewed by a qualified data-protection
> adviser / solicitor** and signed off by the company before they are relied on
> or shared with a client.

ClosePilot is a UK-focused accounting **review + accounts-production** platform.
When a practice uploads or syncs a client's financial records, ClosePilot
processes that data **on the practice's behalf** — i.e. the practice (or the
underlying company) is the **data controller** and ClosePilot is the **data
processor**. UK GDPR + the Data Protection Act 2018 apply.

Operating entity: **Zequence Digital Ltd** (update if incorrect).

### Terminology (avoid the "DPA" ambiguity)

- **DPA = Data Processing Agreement** — the Article 28 contract between ClosePilot
  (processor) and a practice (controller). This is [dpa-outline.md](./dpa-outline.md).
  It is a **private contract**; the ICO is not a party to it.
- **DPA 2018 = Data Protection Act 2018** — the UK **statute** (applies alongside
  UK GDPR). Wherever this pack says "the Data Protection Act 2018" it means the Act.
- **ICO = Information Commissioner's Office** — the UK **regulator**. You do not
  sign a DPA *with* the ICO. Your ICO obligations are separate: **register / pay the
  annual data-protection fee** (unless exempt), align your Data Processing Agreement
  to the ICO's data-processing-contract checklist, and report breaches (as
  processor, ClosePilot notifies the controller; the controller notifies the ICO
  within 72 hours).

## Contents

| Document | Purpose | Owner action |
|---|---|---|
| [retention-and-deletion-policy.md](./retention-and-deletion-policy.md) | What data is held, for how long, and how it is deleted | Review + publish |
| [dpa-outline.md](./dpa-outline.md) | Article 28 data-processing terms to sign with each practice | Legal review + execute per client |
| [onboarding-compliance-checklist.md](./onboarding-compliance-checklist.md) | The gate to clear before the first real client dataset | Work through + tick off |

## What is already true (technical measures in the product)

These are implemented and can be cited in the DPA's security annex:

- **Tenant isolation** enforced by PostgreSQL Row-Level Security, **verified** by a
  rolled-back automated test (`npm run verify:isolation`).
- **Encryption in transit** (TLS) and **at rest** (Supabase-managed); OAuth
  tokens for accounting integrations are additionally encrypted with
  **AES-256-GCM** (authenticated) before storage.
- **Right to erasure** implemented (`POST /api/integrations/erase`) — deletes a
  client's synced financial data + connections, with the erasure recorded in an
  audit trail. **Verified** by a rolled-back automated test (`npm run verify:erasure`).
- **Audit trail** of connect / sync / disconnect / erase actions.
- **Reconnect-safe disconnect** (revoking a live connection does not silently
  delete retained evidence).

## What still needs the owner (the actual gate)

- **Backups / point-in-time recovery** enabled and its retention documented
  (Supabase setting).
- **DPA executed** with each practice, and **sub-processor DPAs** in place.
- **Retention policy published** and a **privacy notice** live (a `/privacy` page
  exists — confirm it reflects this pack).
- **Retention periods confirmed** (the `[bracketed]` defaults in the retention
  policy). The code mechanism is ready (`apps/web/lib/retention.ts`) but stays
  report-only until `retentionEnforcementEnabled()` is switched on, which requires
  each confirmed period — so no automated deletion runs against an unconfirmed policy.
- **Incident-response** owner and process named.
