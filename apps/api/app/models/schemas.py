from datetime import datetime
from enum import StrEnum
from pydantic import BaseModel, Field


class RiskLevel(StrEnum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class JobStatus(StrEnum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"


class ConfidenceLevel(StrEnum):
    high = "high"
    medium = "medium"
    low = "low"


class ValidationStatus(StrEnum):
    passed = "passed"
    warning = "warning"
    failed = "failed"


class TenantType(StrEnum):
    accounting_practice = "accounting_practice"
    company = "company"


class Tenant(BaseModel):
    id: str
    name: str
    tenant_type: TenantType
    plan: str = "starter"


class UserCompanyAccess(BaseModel):
    user_id: str
    tenant_id: str
    company_id: str
    role: str


class FindingEvidence(BaseModel):
    source_file: str
    account_code: str
    period: str
    calculation: str


class ValidationCheck(BaseModel):
    id: str
    name: str
    status: ValidationStatus
    detail: str


class Company(BaseModel):
    id: str
    tenant_id: str
    name: str
    industry: str
    accounting_system: str
    currency: str = "GBP"
    country: str = "United Kingdom"


class Finding(BaseModel):
    id: str
    tenant_id: str
    company_id: str
    severity: RiskLevel
    category: str
    title: str
    description: str
    expected_impact: str
    status: str = "open"
    confidence: ConfidenceLevel = ConfidenceLevel.medium
    evidence: FindingEvidence
    reviewer: str | None = None


class Recommendation(BaseModel):
    id: str
    tenant_id: str
    company_id: str
    finding_id: str
    action: str
    expected_impact: str
    priority: str
    completed: bool = False


class FinanceHealthScore(BaseModel):
    company_id: str
    score: int = Field(ge=0, le=100)
    risk_level: RiskLevel
    calculated_at: datetime


class DashboardResponse(BaseModel):
    tenant: Tenant | None = None
    company: Company
    score: FinanceHealthScore
    open_findings: int
    cash_at_risk: int
    time_saved_hours: int
    findings: list[Finding]
    recommendations: list[Recommendation]
    validation_checks: list[ValidationCheck]


class ChatRequest(BaseModel):
    tenant_id: str
    company_id: str
    question: str


class ChatResponse(BaseModel):
    answer: str
    suggested_actions: list[str]


class AccountingFirmOnboardingRequest(BaseModel):
    firm_name: str
    first_client_name: str
    industry: str = "Professional Services"
    accounting_system: str = "Sage"
    currency: str = "GBP"
    country: str = "United Kingdom"


class CompanyOnboardingRequest(BaseModel):
    company_name: str
    industry: str = "Professional Services"
    accounting_system: str = "Sage"
    currency: str = "GBP"
    country: str = "United Kingdom"


class OnboardingResponse(BaseModel):
    tenant: Tenant
    company: Company
    access: UserCompanyAccess
