# Pre-onboarding compliance checklist

> The gate to clear **before** a real practice's live client data is loaded into
> ClosePilot. Tick each item; link the evidence. **DRAFT — confirm with your
> data-protection adviser.**

## A. Legal & policy

- [ ] **ICO registration** — registered with the ICO and the **annual data-
      protection fee** paid (unless a documented exemption applies). *(This is a
      filing with the regulator — separate from the Data Processing Agreement below.)*
- [ ] **DPA executed** — Data Processing Agreement (Art 28 controller↔processor
      contract) signed with the practice (see [dpa-outline.md](./dpa-outline.md)).
- [ ] **Sub-processor DPAs / Art 28 terms** in place: Supabase, Vercel, Google
      (Gemini), Upstash, Sentry. — evidence: [link]
- [ ] **Retention & deletion policy** finalised and published
      ([retention-and-deletion-policy.md](./retention-and-deletion-policy.md)).
- [ ] **Privacy notice** live and accurate (`/privacy` page reviewed against this
      pack).
- [ ] **Terms of service** reviewed (`/terms`).
- [ ] **International-transfer** mechanism confirmed for each sub-processor
      (region / IDTA / SCCs).
- [ ] **Lawful basis** and controller/processor roles documented.

## B. Technical controls (verify, don't assume)

- [ ] **Backups / point-in-time recovery** enabled on the database; recovery
      window + backup retention documented. — evidence: [Supabase setting]
- [ ] **Tenant isolation** re-verified: `npm run verify:isolation` passes. —
      evidence: [run output/date]
- [ ] **Encryption at rest** confirmed on the DB host; **`INTEGRATION_ENCRYPTION_KEY`**
      set (integration tokens AES-256-GCM encrypted).
- [ ] **TLS** enforced on all endpoints (HTTPS only).
- [ ] **Erasure path** tested end-to-end on non-production data
      (`POST /api/integrations/erase`).
- [ ] **Rate limiting** active (Upstash configured) on AI / upload / sync
      endpoints.
- [ ] **Error monitoring** (Sentry DSN) live; PII scrubbing reviewed.
- [ ] **Secrets** managed via environment variables only; no secrets in the repo.
- [ ] **Access to production data** limited to named individuals; list maintained.

## C. Operational readiness

- [ ] **Incident-response** owner named + a documented breach process (target
      notification **[48h]**).
- [ ] **Data-subject request** handling process (access / erasure) defined with
      an SLA.
- [ ] **Sub-processor change** notification process (30-day notice) in place.
- [ ] **Personnel confidentiality** obligations signed; onboarding/offboarding
      access process defined.
- [ ] **AI processing** reviewed: only the grounded fact sheet is sent to Gemini;
      confirm the provider's no-training / retention terms; feature is on-demand
      and labelled *AI-drafted*.

## D. Pilot-specific

- [ ] Practice informed which sub-processors are used and where data is hosted.
- [ ] Agreed **scope** (which clients, which data types) and **retention** for the
      pilot in writing.
- [ ] A named contact on both sides.
- [ ] Roll-back / exit plan (how the practice's data is returned or deleted if the
      pilot ends).

---

**Sign-off:** onboarding of live client data is authorised only when Sections A–C
are complete.

Authorised by: ______________________  Date: __________
