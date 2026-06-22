# ClosePilot Pilot Readiness

ClosePilot is evolving from a rules-and-score engine into a financial review,
assurance, and sign-off operating system for UK accounting firms.

The next 90 days should focus on one question:

> Will this help a partner trust ClosePilot enough to use it on a real client review?

## 90-Day Objective

Get 5 accounting firms using ClosePilot on real client files.

Do not prioritise more AI, more dashboards, or more rules until the pilot workflow
is trusted.

## Pilot Workflow

```text
Upload Pack
  ↓
Run Assurance
  ↓
Review Findings
  ↓
Request / Upload Evidence
  ↓
Resolve Issues
  ↓
Manager Review
  ↓
Partner Sign-Off
  ↓
Export Review Pack
```

## Phase 1 Deliverables

- Finding lifecycle:
  - Open
  - Under Review
  - Evidence Requested
  - Evidence Received
  - Resolved
  - Accepted Risk
  - False Positive
  - Closed
- Evidence management:
  - Evidence upload
  - Evidence request
  - Evidence review
  - Evidence acceptance
- Review actions:
  - Assign
  - Request evidence
  - Resolve
  - Accept risk
  - False positive
  - Manager approve
  - Manager return
  - Manager escalate
- Partner sign-off:
  - No critical findings open
  - No validation blockers
  - All evidence requests closed
  - Manager review complete
  - Readiness above threshold
- Review pack export:
  - Finance Health Score
  - Audit Readiness Score
  - Findings
  - Exposure
  - Evidence
  - Reviewer notes
  - Manager review
  - Partner sign-off
- QA and reliability framework:
  - Clean packs
  - Known-error packs
  - False-positive packs
  - Expected results
  - Rule accuracy gate

## Trust Gate

Before any pilot release:

- Rule Accuracy >= 95%
- False Positive Rate <= 5%
- Critical Rule Coverage = 100%
- VAT Coverage = 100%
- Pilot walkthrough QA passes
- Review pack export QA passes

Run:

```bash
npm run test:rules
npm test
```

When a local web server is running:

```bash
CLOSEPILOT_RULE_ENGINE_URL=http://127.0.0.1:3004 npm run test:rules:engine
CLOSEPILOT_QA_URL=http://127.0.0.1:3004 npm run test:ui
```

## The Biggest Technical Challenge

The hardest problem in ClosePilot is not AI, scoring, audit readiness, or VAT
maths.

The hardest problem is reliably ingesting finance data from many accounting
firms, each exporting files differently.

If the import layer is weak, even perfect rules will generate false positives.
That destroys trust.

## ClosePilot Data Pipeline

Rules should never run directly on uploaded files.

```text
Client File
  ↓
Import Layer
  ↓
Mapping Layer
  ↓
Canonical Financial Model
  ↓
Rule Engine
```

### Layer 1: Raw Import

Uploaded files can vary heavily by source system.

Examples:

```text
Xero Trial Balance:
Code | Name | Balance

Sage Trial Balance:
Account | Description | Debit | Credit

QuickBooks:
Account Name | Amount

ERP Export:
GL Account | Period Balance
```

ClosePilot should parse the file, preserve the raw rows, and avoid applying
review rules until mapping and normalisation have succeeded.

### Layer 2: Mapping Engine

The mapping layer converts firm-specific columns into ClosePilot fields.

Example:

```text
ACCT → accountCode
DESC → accountName
DR   → debit
CR   → credit
```

AI can help here, but the user must be able to confirm mappings before the
mapping profile becomes trusted.

### Layer 3: Canonical Financial Model

Everything inside ClosePilot should use one internal format.

```ts
interface TrialBalanceLine {
  accountCode: string;
  accountName: string;
  balance: number;
}

interface Debtor {
  customerName: string;
  invoiceNumber: string;
  amount: number;
  dueDate?: string;
}

interface Creditor {
  supplierName: string;
  invoiceNumber: string;
  amount: number;
  dueDate?: string;
}

interface VatTransaction {
  date?: string;
  vatCode: string;
  netAmount: number;
  vatAmount: number;
}
```

### Layer 4: Rules

Rules should consume canonical data only.

They should not care whether data came from:

- Xero
- Sage
- QuickBooks
- SAP
- Excel
- ERP exports

## Short-Term Import Scope

For the next 6 months, support a narrow but reliable set of data types.

### Trial Balance

Accept:

- Account Code
- Account Name
- Balance

Or:

- Account Code
- Account Name
- Debit
- Credit

### Aged Debtors

Accept:

- Customer
- Invoice
- Due Date
- Amount

### Aged Creditors

Accept:

- Supplier
- Invoice
- Due Date
- Amount

### VAT Report

Accept:

- Date
- VAT Code
- Net
- VAT

## Mapping Profiles

ClosePilot should store mapping profiles per firm and export type.

```json
{
  "firmId": "abc-accountants",
  "profileName": "Sage 50 Trial Balance",
  "fileType": "trial_balance",
  "mappings": {
    "ACCT": "accountCode",
    "DESC": "accountName",
    "DR": "debit",
    "CR": "credit"
  }
}
```

On the next upload, ClosePilot should recognise the profile and apply it
automatically, subject to validation checks.

## Upload Validation Strategy

Every upload should pass these checks before rule execution:

- Mandatory columns present
- Data types valid
- Numeric fields parse safely
- Debit/credit or balance normalises correctly
- Trial balance balances
- Accounting equation validates where relevant
- VAT control reconciliation possible when VAT report and TB are present

## Target Architecture

```text
lib/
  import-engine/
    parsers/
    mappers/
    validators/
    normalizers/
    profiles/
```

The data normalisation engine is almost as important as the rule engine. It is
what lets ClosePilot scale from 5 pilot firms to 500 firms without rewriting
rules for every accounting package.

## Priority Ranking

1. Review Workflow
2. Data Normalisation Engine
3. QA Harness
4. Pilot Firms
5. More Rules

## Strategic Roadmap

### Phase 1: Pilot Ready

Objective: first 5 accounting firms using real client data.

Focus:

- Workflow
- Evidence
- Sign-off
- QA reliability
- Import trust

### Phase 2: Commercial Launch

Objective: first paying firms.

Deliver:

- Findings repository
- Practice dashboard
- Xero connector
- QuickBooks connector

### Phase 3: VAT Intelligence Platform

Objective: strongest VAT review platform for UK SMEs.

Support:

- Standard rate
- Reduced rate
- Zero rate
- Exempt
- Outside scope
- Reverse charge
- Import VAT
- Postponed VAT Accounting
- Partial exemption
- Capital Goods Scheme
- CIS VAT

### Phase 4: Accounts Production Engine

Input:

- GL transactions

Output:

- Trial balance
- P&L
- Balance sheet
- Cash flow
- VAT return

Target folder:

```text
accounts-engine/
  tb-builder.ts
  pnl-builder.ts
  balance-sheet.ts
  cashflow.ts
  vat-return.ts
```

### Phase 5: ClosePilot Accounts

Input:

- Bank
- Invoices
- Expenses
- Payroll

Output:

- TB
- P&L
- Balance sheet
- Cash flow
- VAT

### Phase 6: Audit Readiness OS

Every finding linked to:

- Document
- Evidence
- Comment
- Approval
- Resolution

Auditors should be able to see:

- Finding
- Evidence
- Resolution
- Approver

### Phase 7: ClosePilot CFO

Outputs:

- Monthly board pack
- P&L commentary
- Balance sheet commentary
- Cash flow commentary
- KPIs
- Risks
- Recommendations
- Forecasting
- Budgeting
- Scenario planning

## Pilot Firm Success Metric

ClosePilot is pilot-ready when a partner can say:

> I understand the workflow, I can see the evidence, I can review the exceptions,
> and I trust the sign-off pack enough to use this on a real client file.
