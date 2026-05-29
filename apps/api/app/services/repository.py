from app.models.schemas import Company, Finding, FindingEvidence, Recommendation, RiskLevel, Tenant, TenantType, ValidationCheck, ValidationStatus


tenant = Tenant(
    id="tenant_demo",
    name="Northbridge Advisory LLP",
    tenant_type=TenantType.accounting_practice,
    plan="practice",
)

company = Company(
    id="company_aurora",
    tenant_id=tenant.id,
    name="Aurora Components Ltd",
    industry="Manufacturing",
    accounting_system="Sage",
)

findings = [
    Finding(id="finding_accruals", tenant_id=tenant.id, company_id=company.id, severity=RiskLevel.high, category="month_end", title="Likely missing accruals in logistics and utilities", description="April cost run-rate is below the prior three-month average despite stable volumes.", expected_impact="£18k-£26k close adjustment", confidence="high", evidence=FindingEvidence(source_file="trial-balance-april.xlsx", account_code="5200 Logistics / 5400 Utilities", period="Apr 2026", calculation="Jan-Mar average £42k vs Apr £24k. Variance £18k below expected run-rate.")),
    Finding(id="finding_ar", tenant_id=tenant.id, company_id=company.id, severity=RiskLevel.critical, category="ar", title="Three debtors create 64% of overdue cash risk", description="Large invoices moved into 60+ day ageing with no recent collection notes.", expected_impact="£96k collection exposure", confidence="high", evidence=FindingEvidence(source_file="aged-debtors-april.csv", account_code="Topline Retail / Wyvern Group / Aster Foods", period="Apr 2026", calculation="60+ day balances total £96k out of £150k overdue AR.")),
    Finding(id="finding_vat", tenant_id=tenant.id, company_id=company.id, severity=RiskLevel.high, category="vat", title="Missing VAT codes on 47 purchase transactions", description="Supplier spend includes blank VAT treatment on categories normally coded standard-rate.", expected_impact="Potential VAT return error", status="in_review", confidence="medium", reviewer="Priya Shah", evidence=FindingEvidence(source_file="vat-detail-april.csv", account_code="Purchase VAT detail", period="Apr 2026", calculation="47 purchase rows have blank VAT treatment where supplier category usually carries standard-rate VAT.")),
    Finding(id="finding_ap", tenant_id=tenant.id, company_id=company.id, severity=RiskLevel.medium, category="ap", title="Possible duplicate supplier invoice", description="Two invoices share supplier, date, amount and similar invoice references.", expected_impact="£4,820 potential saving", confidence="medium", evidence=FindingEvidence(source_file="aged-creditors-april.csv", account_code="Supplier: Meridian Freight", period="Apr 2026", calculation="Invoice 4491A and 4491-A match supplier, date and amount £4,820.")),
]

validation_checks = [
    ValidationCheck(id="val_tb", name="Trial balance balances to zero", status=ValidationStatus.passed, detail="Debit and credit totals agree within £0.00 tolerance."),
    ValidationCheck(id="val_bs", name="Balance sheet equation", status=ValidationStatus.passed, detail="Assets equal liabilities plus equity for uploaded period."),
    ValidationCheck(id="val_ar", name="AR agrees to debtor control", status=ValidationStatus.warning, detail="Aged debtors is £3,840 below debtor control. Review unmatched receipts."),
    ValidationCheck(id="val_vat", name="VAT report agrees to VAT control", status=ValidationStatus.warning, detail="VAT detail includes 47 blank-coded purchase transactions."),
]

recommendations = [
    Recommendation(id="rec_collect", tenant_id=tenant.id, company_id=company.id, finding_id="finding_ar", action="Prioritise collection calls for Topline Retail, Wyvern Group and Aster Foods.", expected_impact="+£74k expected collections", priority="high"),
    Recommendation(id="rec_accrual", tenant_id=tenant.id, company_id=company.id, finding_id="finding_accruals", action="Create accrual review for logistics, utilities and professional fees.", expected_impact="+9 close confidence", priority="high"),
    Recommendation(id="rec_vat", tenant_id=tenant.id, company_id=company.id, finding_id="finding_vat", action="Review blank VAT code transactions and attach exception notes.", expected_impact="+12 VAT health", priority="high"),
]


def get_company(tenant_id: str, company_id: str) -> Company:
    if tenant_id == company.tenant_id and company_id == company.id:
        return company
    raise KeyError("company not found")


def get_tenant(tenant_id: str) -> Tenant:
    if tenant_id == tenant.id:
        return tenant
    raise KeyError("tenant not found")


def list_findings(company_id: str) -> list[Finding]:
    return [item for item in findings if item.company_id == company_id]


def list_recommendations(company_id: str = company.id) -> list[Recommendation]:
    return [item for item in recommendations if item.company_id == company_id]


def list_validation_checks() -> list[ValidationCheck]:
    return validation_checks
