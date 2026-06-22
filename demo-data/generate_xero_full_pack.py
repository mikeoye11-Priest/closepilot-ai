#!/usr/bin/env python3
"""Generate deterministic, synthetic Xero-style finance packs for ClosePilot.

The output contains no real people, companies, credentials or accounting data.
It deliberately includes known exceptions and an expected-results manifest so
large-pack reviews can be scored rather than judged by appearance.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import random
import shutil
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Iterable, Sequence


PRESETS = {"pilot": 5_000, "medium": 25_000, "large": 100_000, "million": 1_000_000}
PERIOD_END = date(2026, 5, 31)
COMPANY = "Atlas Components UK Ltd"
ORGANISATION_ID = "xero-sim-atlas-components-uk"


@dataclass
class FileResult:
    name: str
    rows: int
    size_bytes: int
    sha256: str


class PackWriter:
    def __init__(self, root: Path):
        self.root = root
        self.files: list[FileResult] = []

    def csv(self, name: str, headers: Sequence[str], rows: Iterable[Sequence[object]]) -> FileResult:
        path = self.root / name
        count = 0
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(headers)
            for row in rows:
                writer.writerow(row)
                count += 1
        result = FileResult(name, count, path.stat().st_size, sha256(path))
        self.files.append(result)
        return result


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def money(value: float) -> str:
    return f"{value:.2f}"


def random_day(rng: random.Random, days: int = 365) -> date:
    return PERIOD_END - timedelta(days=rng.randrange(days))


def synthetic_name(prefix: str, index: int) -> str:
    return f"{prefix} {index:05d} Ltd"


def generate(output: Path, transactions: int, seed: int, make_zip: bool) -> dict:
    rng = random.Random(seed)
    output.mkdir(parents=True, exist_ok=True)
    writer = PackWriter(output)

    totals = {
        "sales_net": 0.0,
        "purchase_net": 0.0,
        "output_vat": 0.0,
        "input_vat": 0.0,
        "blocked_vat": 0.0,
        "pva_net": 0.0,
        "vat_rows": transactions,
    }

    def vat_rows():
        for index in range(1, transactions + 1):
            posted = random_day(rng)
            selector = rng.random()
            missing_code = index % 10_000 == 0 or index == transactions
            if selector < 0.55:
                net = round(rng.uniform(75, 7_500), 2)
                zero_rated = index % 17 == 0
                vat = 0.0 if zero_rated else round(net * 0.20, 2)
                code = "" if missing_code else ("ZERORATEDOUTPUT" if zero_rated else "OUTPUT")
                totals["sales_net"] += net
                totals["output_vat"] += vat
                yield [posted, "ACCREC", synthetic_name("Customer", index % 2_000), "Component sale", money(net), money(vat), money(net + vat), code, "4000", f"INV-{index:08d}", "GB", "goods", "Xero"]
            elif selector < 0.96:
                net = round(rng.uniform(40, 5_000), 2)
                entertainment = index % 25_000 == 0 or index == transactions - 1
                vat = round(net * 0.20, 2)
                code = "" if missing_code else "INPUT"
                description = "Client entertainment — input VAT claimed" if entertainment else "Materials and operating purchase"
                totals["purchase_net"] += net
                totals["input_vat"] += vat
                if entertainment:
                    totals["blocked_vat"] += vat
                yield [posted, "ACCPAY", synthetic_name("Supplier", index % 800), description, money(net), money(vat), money(net + vat), code, "5000", f"BILL-{index:08d}", "GB", "goods", "Xero"]
            elif selector < 0.985:
                net = round(rng.uniform(100, 3_000), 2)
                vat = round(net * 0.20, 2)
                totals["purchase_net"] += net
                totals["input_vat"] += vat
                totals["output_vat"] += vat
                yield [posted, "ACCPAY", "Cloud Services Europe Ltd", "Reverse-charge cloud services", money(net), money(vat), money(net), "ECINPUTSERVICES", "6100", f"RC-{index:08d}", "IE", "services", "Xero"]
            else:
                net = round(rng.uniform(500, 12_000), 2)
                vat = round(net * 0.20, 2)
                totals["purchase_net"] += net
                totals["input_vat"] += vat
                totals["output_vat"] += vat
                totals["pva_net"] += net
                yield [posted, "ACCPAY", "Global Metals Export Co", "Postponed import VAT", money(net), money(vat), money(net), "POSTPONEDIMPORTVAT", "5001", f"PVA-{index:08d}", "CN", "goods", "Xero"]
        box1 = round(totals["output_vat"], 2)
        box4 = round(totals["input_vat"] - totals["blocked_vat"], 2)
        boxes = {"box1": box1, "box2": 0.0, "box3": box1, "box4": box4, "box5": round(box1 - box4, 2), "box6": round(totals["sales_net"], 2), "box7": round(totals["purchase_net"], 2), "box8": 0.0, "box9": round(totals["pva_net"], 2)}
        totals["explicit_box5"] = boxes["box5"]
        for box, amount in boxes.items():
            yield ["", "", "", "", "", "", "", "", "", "", "", "", "", box, money(amount)]

    writer.csv(
        "xero_vat_transactions.csv",
        ["date", "type", "contact", "description", "net_amount", "vat_amount", "gross_amount", "vat_code", "nominal_code", "reference", "country", "supply_type", "source_system", "box", "amount"],
        vat_rows(),
    )

    ar_count = max(250, min(50_000, transactions // 20))
    ar_total = 0.0

    def ar_rows():
        nonlocal ar_total
        seeded = [18_800.0, 14_600.0, 9_200.0]
        for index in range(1, ar_count + 1):
            amount = seeded[index - 1] if index <= len(seeded) else round(rng.uniform(50, 2_500), 2)
            days = 120 + index if index <= 3 else rng.randrange(0, 150)
            invoice_date = PERIOD_END - timedelta(days=days + 30)
            due_date = PERIOD_END - timedelta(days=days)
            status = "Disputed" if index == 4 else "Open"
            customer = ["Harbour Components Ltd", "Cobalt Retail Group Ltd", "Westmere Engineering Ltd"][index - 1] if index <= 3 else synthetic_name("Customer", index % 2_000)
            ar_total += amount
            yield [customer, f"AR-{index:07d}", invoice_date, due_date, days, money(amount), money(amount), status, money(max(1_000, amount * (0.75 if index == 1 else 2))), "GBP"]

    writer.csv("xero_aged_receivables.csv", ["customer", "invoice_number", "invoice_date", "due_date", "days_overdue", "amount", "outstanding", "status", "credit_limit", "currency"], ar_rows())

    ap_count = max(200, min(40_000, transactions // 25))
    ap_total = 0.0

    def ap_rows():
        nonlocal ap_total
        duplicate = ["Vector Plastics Ltd", "VP-7781", PERIOD_END - timedelta(days=75), PERIOD_END - timedelta(days=45), 45, 4_820.0, "Open", "GBP"]
        for index in range(1, ap_count + 1):
            if index in (1, 2):
                row = duplicate
            else:
                amount = 25_000.0 if index == 3 else round(rng.uniform(40, 3_500), 2)
                days = 185 if index == 3 else rng.randrange(0, 130)
                row = [synthetic_name("Supplier", index % 800), f"AP-{index:07d}", PERIOD_END - timedelta(days=days + 30), PERIOD_END - timedelta(days=days), days, amount, "Open", "GBP"]
            ap_total += float(row[5])
            yield [row[0], row[1], row[2], row[3], row[4], money(float(row[5])), money(float(row[5])), row[6], row[7]]

    writer.csv("xero_aged_payables.csv", ["supplier", "invoice_number", "invoice_date", "due_date", "days_overdue", "amount", "outstanding", "status", "currency"], ap_rows())

    bank_count = max(500, transactions // 4)
    bank_opening = 620_000.0
    bank_balance = bank_opening

    def bank_rows():
        nonlocal bank_balance
        for index in range(1, bank_count + 1):
            receipt = index % 3 != 0
            amount = round(rng.uniform(50, 8_000), 2) * (1 if receipt else -1)
            bank_balance += amount
            yield [random_day(rng), "RECEIVE" if receipt else "SPEND", f"BANK-{index:08d}", "Customer receipt" if receipt else "Supplier payment", money(amount), money(bank_balance), "Reconciled" if index % 97 else "Unreconciled", "GBP"]

    writer.csv("xero_bank_transactions.csv", ["date", "type", "reference", "description", "amount", "running_balance", "status", "currency"], bank_rows())

    journal_count = max(100, transactions // 50)

    def journal_rows():
        for index in range(1, journal_count + 1):
            if index == 1:
                yield ["MJ-0000001", "2026-05-31", "9998", "Suspense", "Material suspense clearance posted on Sunday", "18400.00", "0.00", "Demo Admin", "Approved"]
                yield ["MJ-0000001", "2026-05-31", "2100", "Accruals", "Suspense reclassification", "0.00", "18400.00", "Demo Admin", "Approved"]
                continue
            amount = round(rng.uniform(20, 4_000), 2)
            debit_code, credit_code = (("6000", "2100") if index % 2 else ("2100", "6000"))
            yield [f"MJ-{index:07d}", random_day(rng), debit_code, "Operating adjustment", "Routine month-end journal", money(amount), "0.00", f"User {index % 25:02d}", "Approved"]
            yield [f"MJ-{index:07d}", random_day(rng), credit_code, "Journal offset", "Routine month-end journal", "0.00", money(amount), f"User {index % 25:02d}", "Approved"]

    writer.csv("xero_manual_journals.csv", ["journal_id", "posting_date", "account_code", "account_name", "narration", "debit", "credit", "posted_by", "status"], journal_rows())

    # Control mismatches are intentional and recorded in expected-results.json.
    vat_box5 = round(totals["explicit_box5"], 2)
    ar_control = round(ar_total - 45_000, 2)
    ap_control = round(ap_total, 2)
    bank_statement = round(bank_balance, 2)
    bank_ledger = round(bank_statement + 15_000, 2)
    vat_control = round(abs(vat_box5) + 12_300, 2)

    tb = [
        ["1000", "Plant and Machinery", 2_850_000.0],
        ["1010", "Accumulated Depreciation", -740_000.0],
        ["1100", "Inventory", 680_000.0],
        ["1110", "Trade Debtors Control", ar_control],
        ["1150", "Bank Current Account", bank_ledger],
        ["1200", "Prepayments", 95_000.0],
        ["2000", "Trade Creditors Control", -ap_control],
        ["2010", "VAT Control", -vat_control],
        ["2100", "Accruals", -185_000.0],
        ["2500", "Bank Loan", -1_400_000.0],
        ["3000", "Share Capital", -100_000.0],
        ["4000", "Sales", -round(totals["sales_net"], 2)],
        ["5000", "Materials and Purchases", round(totals["purchase_net"], 2)],
        ["6000", "Payroll and Operating Costs", round(max(450_000.0, totals["sales_net"] * 0.18), 2)],
        ["7000", "Depreciation", 165_000.0],
        ["9998", "Suspense", 18_400.0],
    ]
    retained = round(-sum(row[2] for row in tb), 2)
    tb.append(["3010", "Retained Earnings", retained])

    writer.csv(
        "xero_trial_balance.csv",
        ["account_code", "account_name", "debit", "credit", "balance", "period", "source_system"],
        ([code, name, money(max(balance, 0)), money(max(-balance, 0)), money(balance), "2026-05", "Xero"] for code, name, balance in tb),
    )

    revenue = totals["sales_net"]
    purchases = totals["purchase_net"]
    payroll = max(450_000.0, revenue * 0.18)
    depreciation = 165_000.0
    profit = revenue - purchases - payroll - depreciation
    writer.csv("xero_profit_and_loss.csv", ["account_code", "account_name", "category", "amount", "period"], [
        ["4000", "Revenue", "Revenue", money(revenue), "YTD May 2026"],
        ["5000", "Materials and purchases", "Cost of Sales", money(-purchases), "YTD May 2026"],
        ["6000", "Payroll and operating costs", "Operating Expense", money(-payroll), "YTD May 2026"],
        ["7000", "Depreciation", "Operating Expense", money(-depreciation), "YTD May 2026"],
        ["NET", "Net profit / (loss)", "Result", money(profit), "YTD May 2026"],
    ])

    assets = 2_850_000 - 740_000 + 680_000 + ar_control + bank_ledger + 95_000 + 18_400
    liabilities = ap_control + vat_control + 185_000 + 1_400_000
    equity = assets - liabilities
    writer.csv("xero_balance_sheet.csv", ["section", "account_name", "amount", "as_of_date"], [
        ["Assets", "Total assets", money(assets), PERIOD_END],
        ["Liabilities", "Total liabilities", money(-liabilities), PERIOD_END],
        ["Equity", "Total equity", money(-equity), PERIOD_END],
        ["Check", "Assets less liabilities and equity", "0.00", PERIOD_END],
    ])

    writer.csv("xero_bank_reconciliation.csv", ["bank_account", "statement_balance", "ledger_balance", "difference", "unreconciled_item", "as_of_date"], [
        ["Bank statement balance", money(bank_statement), money(bank_ledger), "15000.00", "Unpresented supplier payment", PERIOD_END],
    ])

    payroll_periods = [f"2025-{month:02d}" for month in range(6, 13)] + [f"2026-{month:02d}" for month in range(1, 6)]
    writer.csv("xero_payroll_summary.csv", ["period", "headcount", "gross_pay", "employer_ni", "employer_pension", "tb_posted", "variance_note"], (
        [period, 480 + index, money(310_000 + index * 2_500), money(42_000 + index * 250), money(18_000 + index * 100), "No" if index == 11 else "Yes", "Unposted payroll month" if index == 11 else ""]
        for index, period in enumerate(payroll_periods, start=1)
    ))

    asset_count = max(100, min(10_000, transactions // 500))

    def asset_rows():
        for index in range(1, asset_count + 1):
            cost = 25_000.0 if index == 1 else round(rng.uniform(500, 40_000), 2)
            depreciation = 0.0 if index == 1 else round(rng.uniform(100, min(15_000, cost)), 2)
            annual_depreciation = 0.0 if index == 1 else round(cost / 5, 2)
            yield [f"FA-{index:06d}", "CNC production asset" if index % 4 == 0 else "Office and production equipment", date(2018 + index % 8, 1 + index % 12, 1 + index % 27), money(cost), money(depreciation), money(cost - depreciation), money(annual_depreciation), 5, "Active"]

    writer.csv("xero_fixed_asset_register.csv", ["asset_code", "asset_description", "acquisition_date", "cost", "accumulated_depreciation", "net_book_value", "annual_depreciation", "useful_life_years", "status"], asset_rows())

    forecast_opening = bank_ledger
    writer.csv("xero_cashflow_forecast.csv", ["week", "period_end", "opening_cash", "expected_receipts", "expected_payments", "closing_cash", "scenario"], (
        [week, PERIOD_END + timedelta(days=7 * week), money(forecast_opening - (week - 1) * 12_000), money(185_000 - week * 2_000), money(197_000), money(forecast_opening - week * 12_000), "Base"]
        for week in range(1, 14)
    ))

    known_exceptions = [
        {"id": "SIM-AR-001", "area": "Receivables", "expected_rule_hint": "REC_001 / AR concentration", "exposure": 45_000, "description": "Aged receivables exceed the TB control by GBP 45,000; three overdue customers are seeded."},
        {"id": "SIM-AP-001", "area": "Payables", "expected_rule_hint": "AP_001", "exposure": 4_820, "description": "Vector Plastics invoice VP-7781 is duplicated."},
        {"id": "SIM-VAT-001", "area": "VAT", "expected_rule_hint": "REC_005 / VAT reconciliation", "exposure": 12_300, "description": "VAT control differs from computed Box 5 by GBP 12,300."},
        {"id": "SIM-BANK-001", "area": "Cash", "expected_rule_hint": "CR_008", "exposure": 15_000, "description": "Bank ledger differs from statement by GBP 15,000."},
        {"id": "SIM-CLOSE-001", "area": "Close", "expected_rule_hint": "Suspense", "exposure": 18_400, "description": "A material suspense balance and Sunday journal are present."},
        {"id": "SIM-VAT-002", "area": "VAT", "expected_rule_hint": "Missing VAT code", "expected_count": (transactions + 9_999) // 10_000, "description": "At least one and approximately every 10,000th VAT row has no VAT code."},
        {"id": "SIM-PAY-001", "area": "Payroll", "expected_rule_hint": "Payroll posting", "expected_count": 1, "description": "One payroll month is not posted to the GL."},
        {"id": "SIM-FA-001", "area": "Fixed assets", "expected_rule_hint": "Depreciation", "exposure": 25_000, "description": "One active asset has zero accumulated depreciation."},
    ]

    manifest = {
        "schemaVersion": 1,
        "synthetic": True,
        "containsRealData": False,
        "company": COMPANY,
        "xeroOrganisationId": ORGANISATION_ID,
        "periodEnd": PERIOD_END.isoformat(),
        "seed": seed,
        "requestedVatTransactions": transactions,
        "totalRows": sum(item.rows for item in writer.files),
        "controls": {
            "trialBalanceNet": round(sum(row[2] for row in tb), 2),
            "agedReceivablesTotal": round(ar_total, 2),
            "receivablesControl": ar_control,
            "agedPayablesTotal": round(ap_total, 2),
            "payablesControl": ap_control,
            "computedVatBox5": vat_box5,
            "vatControl": vat_control,
            "bankStatement": bank_statement,
            "bankLedger": bank_ledger,
        },
        "knownExceptions": known_exceptions,
        "files": [item.__dict__ for item in writer.files],
    }
    (output / "expected-results.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (output / "README.txt").write_text(
        "ClosePilot synthetic Xero-style full pack\n"
        "=========================================\n"
        "This dataset is fictional and contains deliberate review exceptions.\n"
        "Use expected-results.json to score import, reconciliation and detection results.\n"
        "Do not present a successful demo as proof of real-world accuracy.\n",
        encoding="utf-8",
    )
    if make_zip:
        shutil.make_archive(str(output), "zip", output)
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preset", choices=PRESETS, default="large", help="Dataset size preset (default: large).")
    parser.add_argument("--transactions", type=int, help="Override VAT transaction row count.")
    parser.add_argument("--seed", type=int, default=20260622, help="Deterministic random seed.")
    parser.add_argument("--output", type=Path, help="Output directory. Defaults under demo-data/generated/.")
    parser.add_argument("--zip", action="store_true", help="Also create a zip archive beside the output directory.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    transactions = args.transactions or PRESETS[args.preset]
    if transactions < 1_000:
        raise SystemExit("Use at least 1,000 transactions so seeded exceptions remain meaningful.")
    output = args.output or Path(__file__).resolve().parent / "generated" / f"xero-{args.preset}-{transactions}"
    manifest = generate(output, transactions, args.seed, args.zip)
    print(f"Generated {len(manifest['files'])} CSV files in {output}")
    print(f"Rows: {manifest['totalRows']:,}")
    print(f"Bytes: {sum(item['size_bytes'] for item in manifest['files']):,}")
    print(f"Known exceptions: {len(manifest['knownExceptions'])}")


if __name__ == "__main__":
    main()
