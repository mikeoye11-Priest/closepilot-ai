# ClosePilot — Sub-processor Register

> **DRAFT — requires confirmation before publication.** This is the client-facing
> register of the sub-processors ClosePilot engages to provide the service. Values
> in **[brackets]** (regions, transfer safeguards) must be confirmed against each
> provider's current terms before this is shared with a practice or relied upon.
> Not legal advice.

**Processor:** Zequence Digital Ltd, trading as ClosePilot
**Version:** 0.1 (draft) · **Last updated:** [confirm date on publication]
**Canonical source:** this file. The DPA ([dpa-outline.md](./dpa-outline.md) §4) and
the public privacy notice (`/privacy` §7) both reference it; keep them in step.

## What a sub-processor is here

ClosePilot processes a practice's client financial data **on the practice's
instructions** (the practice is the controller; ClosePilot is the processor — see
the [compliance README](./README.md)). A **sub-processor** is a third party
ClosePilot engages that may process that data in turn. Each is engaged under Article
28 terms and must offer protections consistent with the
[retention & deletion policy](./retention-and-deletion-policy.md).

The **connected accounting systems** (Xero, Intuit/QuickBooks, Sage) are listed
separately below: they are the client's **own source systems**, connected on the
Customer's authorisation — not sub-processors ClosePilot chooses.

## Sub-processors

| Sub-processor | Service provided | Data processed | Hosting region | Transfer safeguard |
|---|---|---|---|---|
| **Supabase** | Managed PostgreSQL database, authentication, file storage | All platform data: account data, uploaded/synced financial records, encrypted OAuth tokens, audit logs | **[confirm — prefer EU/UK]** | **[adequacy / UK IDTA / SCCs+Addendum — confirm]** |
| **Vercel** | Application hosting & serverless compute (region `lhr1`) | Requests in transit; transient compute over the above data | **[London `lhr1` — confirm data residency]** | **[confirm]** |
| **Google (Gemini API)** | AI narration of insights / accounts commentary | **Only the grounded fact sheet** — a short numeric summary of the figures. No bulk records, no customer files. | **[confirm region]** | **[confirm; require no-training / no-retention terms]** |
| **Upstash** | Rate limiting (Redis) on sensitive endpoints | Request counters keyed by user/IP. **No financial data.** | **[confirm region]** | **[confirm]** |
| **Sentry** | Application error monitoring | Error events + limited technical context; **PII scrubbed** | **[confirm region]** | **[confirm]** |

> If AI narration is not configured (`GEMINI_API_KEY` absent), commentary falls back
> to deterministic, on-platform text and **no data is sent to Google** at all.

## Connected accounting systems (Customer-authorised source systems)

| System | Role | Notes |
|---|---|---|
| **Xero** | Source accounting system | Connected by the Customer via OAuth; ClosePilot requests read-only scopes and does not modify records. |
| **Intuit (QuickBooks Online)** | Source accounting system | As above. |
| **Sage (Business Cloud Accounting)** | Source accounting system | As above. Sage 50 (desktop) has no API and is used via file upload, not a connection. |

These mirror records the client already holds in their own accounting system;
disconnecting or erasing in ClosePilot does not delete the source records.

## Change notification

The Customer gives general authorisation for the sub-processors above. ClosePilot
will give **[30 days]** notice before adding or replacing a sub-processor and allow
the Customer to object, per the DPA. Material changes update this register and its
version/date.

## International transfers

Where a sub-processor processes data outside the UK, transfers rely on the safeguard
stated in its row (**[UK IDTA / EU SCCs + UK Addendum / adequacy]**). ClosePilot
prefers UK/EU regions to minimise transfers. **[Confirm per provider before
publication.]**

## Owner actions before this is published

- [ ] Confirm each provider's **processing region** and **transfer safeguard**.
- [ ] Confirm the **Gemini API** commercial terms disable training on / retention of
      submitted content.
- [ ] Put Article 28 terms (or each provider's DPA) **in place with every
      sub-processor** and keep copies.
- [ ] Set the published **version + date** and link this register from `/privacy`.
