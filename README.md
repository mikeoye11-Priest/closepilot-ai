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

## Multi-Tenant Practice Model

ClosePilot supports two onboarding paths:

- Accounting practice: one tenant owns many client companies.
- Single company: one tenant owns one internal company workspace.

Data separation rules:

- Every client-facing table carries `tenant_id` and `company_id`.
- Practice users see client data through `user_company_access`, not by broad tenant membership alone.
- Uploads, findings, recommendations, reports, validation checks and AI conversations are always scoped to one company inside one tenant.
- File storage should use tenant/company paths, for example `tenants/{tenant_id}/companies/{company_id}/uploads/{upload_id}/{filename}`.
- AI prompts must only receive the active tenant and company context plus evidence from that same scope.
- PostgreSQL row-level security should enforce tenant and company scope from the authenticated user session.

This keeps accounting practice data clean: one firm can manage 20, 50 or 100 clients, while each client's uploads, findings, reports and conversations remain isolated.

## Platform Architecture

**Company / Platform:** ClosePilot

**Product:** ClosePilot AI

**Category:** AI Finance Operations Platform

**Modules:**

- ClosePilot Close
- ClosePilot Cash
- ClosePilot VAT
- ClosePilot Collections
- ClosePilot Controls

## Apps

- `apps/web`: Next.js 16, TypeScript, Tailwind CSS, React Query-ready UI.
- `apps/api`: FastAPI modular monolith scaffold.
- `infra`: PostgreSQL schema for tenants, companies, uploads, findings, recommendations, reports, audit logs, and AI conversations.

## Upload-to-Findings MVP

The current MVP can run deterministic analysis on CSV, TSV, TXT, XLSX and XLS exports uploaded through the `Upload Pack` screen.

Supported file inference:

- Trial Balance: filenames containing `trial`, `tb`, or default uploads
- P&L: filenames containing `p&l`, `profit`, or `loss`
- Balance Sheet: filenames containing `balance_sheet`, `balance-sheet`, or `bs_`
- Aged Debtors / AR: filenames containing `debtor`, `ar`, or `receivable`
- Aged Creditors / AP: filenames containing `creditor`, `ap`, or `payable`
- VAT: filenames containing `vat` or `tax`

Generated outputs:

- Validation checks
- Evidence-linked findings
- Confidence labels
- Recommendations
- Finance Review Appendix

Excel workbooks are parsed through a server-side Next.js route using a Node runtime parser. The browser keeps a CSV/TSV fallback, but workbook parsing does not happen client-side.

## Local Development

```bash
npm install
npm run dev:web
```

API dependencies:

```bash
pip install -r apps/api/requirements.txt
npm run dev:api
```

The MVP currently uses seeded demo data so the finance-health-review workflow can be reviewed before live parsers and accounting integrations are added.
