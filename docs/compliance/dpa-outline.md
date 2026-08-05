# Data Processing Agreement (DPA) — outline

> **DRAFT — requires legal review before execution.** This is a structured
> outline of the Article 28 (UK GDPR) terms to put in place between ClosePilot
> (processor) and each practice (controller). It is **not** a signable contract
> and **not** legal advice. Have a solicitor turn it into your executed DPA.
>
> **"DPA" here = Data Processing Agreement** (this controller↔processor contract),
> **not** the Data Protection Act 2018 (the UK statute) and **not** anything filed
> with the ICO. ICO registration / the data-protection fee is a separate obligation
> — see the [checklist](./onboarding-compliance-checklist.md) §A.

## Parties

- **Processor:** Zequence Digital Ltd, trading as ClosePilot ("ClosePilot").
- **Controller:** the accounting practice (or company) that uploads or connects
  client financial data ("Customer").

Where the Customer processes the personal data of *its* clients, the Customer may
itself be a processor and ClosePilot a **sub-processor**; the terms flow down
accordingly.

## 1. Subject matter, nature, purpose & duration

- **Subject matter:** provision of the ClosePilot accounting review + accounts-
  production platform.
- **Nature & purpose:** hosting, organising, analysing and generating review /
  accounts / VAT / cash-flow outputs from financial records, on the Customer's
  documented instructions.
- **Duration:** the term of the Customer's subscription, plus the deletion/return
  window in §9.

## 2. Categories of data subjects & personal data

- **Data subjects:** the Customer's staff (platform users) and individuals
  appearing in the client's financial records (e.g. named customers, suppliers,
  directors, payees).
- **Personal data:** contact/account data (name, email); financial records that
  may contain personal data (aged debtor/creditor names and balances, payroll-
  related figures, transaction narratives); OAuth tokens.
- **No special-category data** is intentionally processed. The Customer must not
  upload special-category data unless separately agreed.

## 3. Processor obligations (UK GDPR Art 28(3))

ClosePilot shall:
1. Process personal data only on the Customer's **documented instructions**
   (including this DPA and use of the platform), unless required by law.
2. Ensure persons authorised to process are under a **duty of confidentiality**.
3. Implement appropriate **technical and organisational measures** (Annex A).
4. Engage **sub-processors** only per §4.
5. **Assist** the Customer in responding to data-subject rights requests (access,
   rectification, erasure, portability) using platform features where possible.
6. **Assist** with the Customer's security, breach-notification, DPIA and
   consultation obligations (Arts 32–36).
7. **Notify** the Customer without undue delay after becoming aware of a personal-
   data breach (target: **[within 48 hours]**).
8. **Delete or return** personal data at the end of provision (§9).
9. Make available information to demonstrate compliance and allow **audits** (§8).

## 4. Sub-processors

The canonical, client-facing list is the **[sub-processor register](./sub-processors.md)**
(keep this table in step with it). The Customer provides general authorisation for
the sub-processors below; ClosePilot will give **[30 days]** notice of
additions/changes and allow objection.

| Sub-processor | Purpose | Location | Notes |
|---|---|---|---|
| **Supabase** | Managed PostgreSQL database, authentication, file storage | **[confirm region — e.g. EU]** | Primary data store; encryption at rest |
| **Vercel** | Application hosting / compute | **[confirm region]** | Serverless request processing |
| **Google (Gemini API)** | AI narration of insights / commentary | **[confirm region/terms]** | **Only the grounded fact sheet is sent** (a short numeric summary); no bulk records. Confirm no-training / retention terms. |
| **Upstash** | Rate limiting (Redis) | **[confirm region]** | Stores counters keyed by user/IP; no financial data |
| **Sentry** | Error monitoring | **[confirm region]** | Application errors + limited context; scrub PII |
| **Xero / Intuit (QuickBooks) / Sage** | Source accounting systems the Customer connects | Provider-controlled | The Customer authorises the connection; these are the client's own systems |

> A DPA (or equivalent Art 28 terms) must be in place with each sub-processor.

## 5. International transfers

Where a sub-processor processes data outside the UK, transfers rely on **[UK IDTA
/ EU SCCs + UK Addendum / adequacy]** as applicable. **[Confirm per sub-processor;
prefer UK/EU regions to minimise transfers.]**

## 6. Security — see Annex A.

## 7. Personal-data breach

ClosePilot will notify the Customer without undue delay (target **[48 hours]**) of
a breach affecting the Customer's data, with the information the Customer needs to
meet its own ICO/subject notification duties.

## 8. Audit

ClosePilot will make available compliance information and, on reasonable notice
and **[no more than once per year]** (or after a breach), support a Customer audit
— satisfiable via documentation, this pack, and the isolation-proof evidence.

## 9. Deletion / return on termination

On termination, ClosePilot will, at the Customer's choice, **delete or return**
the Customer's personal data within **[30 days]**, and delete existing copies
unless retention is legally required. Backup copies are deleted on backup expiry
(see retention policy §4).

---

## Annex A — Technical & organisational measures

Grounded in what the platform implements (verify each before signing):

- **Access control & isolation:** multi-tenant separation enforced by PostgreSQL
  Row-Level Security; **verified** by an automated rolled-back isolation test
  (`npm run verify:isolation`). Application access requires authentication.
- **Encryption:** TLS in transit; encryption at rest (database host). Accounting
  OAuth tokens encrypted with **AES-256-GCM** (authenticated) before storage,
  under a dedicated key.
- **Data-subject rights support:** self-service erasure of a client's synced data
  and connections; non-destructive disconnect; audit trail of connect/sync/
  disconnect/erase.
- **Monitoring:** structured logging + error reporting (Sentry); per-caller rate
  limiting on sensitive endpoints.
- **Resilience:** managed database backups / point-in-time recovery **[confirm
  window]**; stuck-job watchdog and concurrency guards on integration syncs.
- **Secure development:** least-privilege secrets via environment variables; code
  review; automated test suite gating changes.
- **Organisational:** confidentiality obligations on personnel; **[access review
  cadence, onboarding/offboarding process, incident-response owner — confirm]**.
