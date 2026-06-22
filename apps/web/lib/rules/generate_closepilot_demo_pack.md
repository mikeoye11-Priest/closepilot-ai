Build a Python script named:

generate_closepilot_demo_pack.py

using:

openpyxl
pandas
numpy
faker

The script must generate a complete enterprise-grade Excel workbook named:

ClosePilot_Enterprise_Demo_Pack.xlsx

==================================================
COMPANY
==================================================

Company:
Northstar Manufacturing Ltd

Industry:
Manufacturing

Country:
United Kingdom

Year End:
31 December 2025

Employees:
75

Revenue:
£8,500,000

==================================================
WORKSHEETS
==================================================

1. Company Profile
2. Trial Balance
3. Balance Sheet
4. Profit & Loss
5. 12 Month P&L History
6. Budget vs Actual
7. AR Aging
8. AP Aging
9. VAT Return
10. VAT Transactions
11. Bank Transactions
12. Bank Reconciliation
13. Payroll Summary
14. Fixed Asset Register
15. Cashflow Forecast
16. Cross File Reconciliation
17. Expected Findings
18. Review Pack Summary

==================================================
TRIAL BALANCE
==================================================

Generate 250+ accounts.

Include:

Assets
Liabilities
Equity
Revenue
Cost Of Sales
Payroll
VAT
Fixed Assets
Depreciation
Interest
Corporation Tax
Accruals
Prepayments
Inventory
Bank Accounts

Columns:

Account Code
Account Name
Balance

Trial Balance must balance.

Inject:

Trade Debtors Control = £850,000
VAT Control = £42,000
Bank Current Account = £340,000

==================================================
BALANCE SHEET
==================================================

Total Assets:

£5,890,000

Fixed Assets = £4,100,000
Inventory = £600,000
Trade Debtors = £850,000
Cash = £340,000

Trade Creditors = £500,000
VAT Control = £42,000
PAYE = £35,000
Bank Loans = £3,200,000
Accruals = £150,000

Share Capital = £100,000
Retained Earnings = £1,863,000

Balance Sheet Equation must balance.

==================================================
PROFIT & LOSS
==================================================

Revenue:
£8,500,000

COGS:
£7,050,000

Gross Margin:
17%

EBITDA:
£180,000

Interest:
£120,000

Generate realistic manufacturing expense structure.

==================================================
12 MONTH HISTORY
==================================================

Generate monthly values for:

Revenue
COGS
Gross Profit
Payroll
Rent
Utilities
EBITDA

Include realistic seasonality.

==================================================
BUDGET VS ACTUAL
==================================================

Generate:

Budget
Actual
Variance
Variance %

==================================================
AR AGING
==================================================

Generate 50 customers.

Include:

Dunlop Retail
£245,000
132 Days

Northern Build
£175,000
95 Days

Tyne Distribution
£145,000
61 Days

Generate 47 additional customers.

Total AR Aging:

£895,000

Deliberate mismatch:

AR Aging = £895,000
Debtors Control = £850,000

Difference:

£45,000

Trigger:

Customer concentration
Overdue debt
Credit limit breach
DSO issues

==================================================
AP AGING
==================================================

Generate 50 suppliers.

Include:

SteelCo Ltd
Power Systems
ABC Services

Personal Payee:

Mr John Smith
£4,950

Create:

Duplicate invoice
Supplier concentration
180+ day creditors

==================================================
VAT RETURN
==================================================

Quarter:

Q4 2025

Box 1 = £50,400
Box 4 = £18,700
Box 6 = £2,850,000
Box 7 = £1,920,000

VAT Control:

£42,000

Difference:

£8,400

==================================================
VAT TRANSACTIONS
==================================================

Generate 300 rows.

Include:

Google Ireland
AWS
Azure
Salesforce
Adobe

Construction suppliers

Entertainment expenses

Company cars

Include VAT codes:

STD
ZR
RC
EX
BLK

Trigger:

Reverse Charge
Blocked VAT
Entertainment VAT
Construction VAT

==================================================
BANK TRANSACTIONS
==================================================

Generate 250 rows.

Columns:

Date
Description
Debit
Credit
Balance

Include:

Month-end postings
Round-number journals
Duplicate amounts

==================================================
BANK RECONCILIATION
==================================================

Bank Statement:

£325,000

TB Balance:

£340,000

Difference:

£15,000

Include:

6 unreconciled items

Oldest:

97 days

==================================================
PAYROLL
==================================================

Employees:

75

Monthly Payroll:

£215,000

Departments:

Operations
Production
Sales
Admin

Inject:

Payroll journal not posted to TB

==================================================
FIXED ASSETS
==================================================

Plant & Machinery
£3.5m

Motor Vehicles
£420k

IT Equipment
£180k

Fields:

Purchase Date
Cost
Useful Life
Depreciation

Inject:

£750,000 assets
with zero depreciation

==================================================
CASHFLOW FORECAST
==================================================

13 weeks.

Generate:

Opening Cash
Receipts
Payments
Closing Cash

Create negative cash balance in Week 8.

==================================================
CROSS FILE RECONCILIATION
==================================================

Create:

AR ↔ Debtors Control = FAIL (£45,000)

AP ↔ Creditors Control = PASS

VAT ↔ VAT Control = FAIL (£8,400)

Bank ↔ TB = FAIL (£15,000)

Balance Sheet Equation = PASS

P&L ↔ Equity = PASS

==================================================
EXPECTED FINDINGS
==================================================

Generate:

Finding ID
Finding
Severity
Exposure
Category

Include:

AR Control Mismatch
VAT Control Mismatch
Payroll Missing
Interest Cover Risk
Customer Concentration
Bank Reconciliation Difference
Zero Depreciation

==================================================
REVIEW PACK SUMMARY
==================================================

Audit Readiness = 79%

Confidence Score = 88%

Finance Health = 82%

Critical Findings = 0

High Findings = 7

Medium Findings = 18

Financial Exposure = £518,100

Breakdown:

AR Risk £450,000
VAT Risk £8,400
Bank Risk £15,000
Other £44,700

==================================================
FORMATTING
==================================================

Use:

Professional formatting
Excel Tables
Currency formatting
Conditional formatting
Bold headers
Frozen panes
Auto filters
Column widths

==================================================
OUTPUT
==================================================

Save workbook as:

ClosePilot_Enterprise_Demo_Pack.xlsx

Workbook should contain:

3,000–5,000 rows

All formulas working

All tabs linked

No errors