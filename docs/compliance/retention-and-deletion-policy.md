# Data Retention & Deletion Policy — ClosePilot

> **DRAFT — requires legal review.** Values in **[brackets]** are decisions the
> company must confirm. Not legal advice.

**Owner:** [Data Protection lead]  **Entity:** Zequence Digital Ltd
**Version:** 0.1 (draft)  **Review cycle:** annual, or on any material change.

## 1. Purpose & scope

This policy sets out how long ClosePilot retains personal and client financial
data, and how that data is deleted. It applies to all data processed by the
ClosePilot platform, whether uploaded by a practice or synced from a connected
accounting system.

ClosePilot acts as a **data processor** for client financial data; the practice
(or the underlying company) is the **controller** and sets the ultimate retention
requirement. Where a controller specifies a different period, the controller's
instruction (recorded in the DPA) prevails over the defaults below.

## 2. Data categories & retention

| Category | Examples | Default retention | Basis |
|---|---|---|---|
| **Client financial records** | Trial balance, P&L, balance sheet, aged debtors/creditors, VAT data, bank data (synced or uploaded) | **[Duration of the engagement + 12 months]**, then deleted | Processing on controller instruction |
| **Accounting-integration tokens** | Encrypted OAuth access/refresh tokens (Xero/QuickBooks/Sage) | Until disconnect or **[90 days]** of inactivity, whichever first | Necessary to provide the service |
| **Review outputs** | Findings, evidence links, reconciliations, review/accounts packs | With the financial records they derive from | Processing on controller instruction |
| **User accounts** | Name, email, authentication data | Until account closure + **[30 days]** | Contract / legitimate interest |
| **Audit logs** | Connect / sync / disconnect / erase events | **[24 months]** | Security / accountability (UK GDPR Art 5(2)) |
| **Operational logs & error reports** | Application logs, Sentry error events | **[90 days]** | Legitimate interest (security, reliability) |
| **Backups** | Database point-in-time recovery / snapshots | **[per backup schedule — see §4]** | Resilience |

> Accounting-integration data mirrors records the client already holds in Xero /
> QuickBooks / Sage; deleting it in ClosePilot does not delete the source records.

## 3. Deletion mechanisms

- **Right to erasure (per client):** `POST /api/integrations/erase` permanently
  deletes a company's synced financial data and its connections. The **fact** of
  erasure is retained in the audit log; the data itself is removed. RLS scopes the
  operation to the requesting user's tenant. **Proven** by a rolled-back automated
  test — `npm run verify:erasure` (`infra/tests/erasure_proof.sql`) — which seeds a
  target and a bystander client, erases the target, and asserts the target's
  financials + payload + connection are gone, the erasure fact is recorded, and the
  bystander is untouched.
- **Disconnect (non-destructive):** revoking a live integration stops future
  syncing and removes the stored token, but **retains** already-produced reviews
  and evidence (so a disconnect is not an accidental deletion).
- **Account / workspace closure:** on closure, associated client data is deleted
  or returned per the DPA within **[30 days]**.
- **Automated expiry:** categories with a fixed period are pruned on a
  **[scheduled]** basis. The mechanism is codified in `apps/web/lib/retention.ts` —
  each category (§2) is bound to its table + timestamp column and default period,
  and `planRetention()` computes which rows are past retention. It is a **planner,
  not an executor**: no scheduled deletion is enabled, and a purge job must gate on
  `retentionEnforcementEnabled()`, which stays **false until every [bracketed]
  period above is confirmed** by the Data Protection lead. Until then it is
  report-only.

## 4. Backups

- Backups / point-in-time recovery are provided by the database host (Supabase).
  **[Confirm PITR is enabled and state the recovery window, e.g. 7 days.]**
- Backup retention: **[e.g. 30 days rolling]**. Deleted data persists in backups
  until the backup expires; erasure requests are honoured in the live system
  immediately and in backups by expiry.
- Restores are for disaster recovery only and are access-controlled.

## 5. Sub-processors

Data may be processed by the sub-processors listed in the DPA (host, hosting,
AI narration, rate-limiting, error monitoring). Each must offer retention and
deletion consistent with this policy; see [dpa-outline.md](./dpa-outline.md).

## 6. Responsibilities & review

- The **[Data Protection lead]** owns this policy and reviews it at least annually.
- Deletion requests from controllers are actioned within **[the DPA SLA]**.
- Changes to retention periods are recorded in the version history.
