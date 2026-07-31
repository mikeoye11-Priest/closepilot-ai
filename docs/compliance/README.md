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
  audit trail.
- **Audit trail** of connect / sync / disconnect / erase actions.
- **Reconnect-safe disconnect** (revoking a live connection does not silently
  delete retained evidence).

## What still needs the owner (the actual gate)

- **Backups / point-in-time recovery** enabled and its retention documented
  (Supabase setting).
- **DPA executed** with each practice, and **sub-processor DPAs** in place.
- **Retention policy published** and a **privacy notice** live (a `/privacy` page
  exists — confirm it reflects this pack).
- **Incident-response** owner and process named.
