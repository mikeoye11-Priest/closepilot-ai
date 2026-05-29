from uuid import uuid4

from fastapi import APIRouter

from app.models.schemas import (
    AccountingFirmOnboardingRequest,
    Company,
    CompanyOnboardingRequest,
    OnboardingResponse,
    Tenant,
    TenantType,
    UserCompanyAccess,
)

router = APIRouter(prefix="/api/v1/onboarding", tags=["onboarding"])


@router.post("/accounting-firm", response_model=OnboardingResponse)
def onboard_accounting_firm(payload: AccountingFirmOnboardingRequest):
    tenant = Tenant(id=str(uuid4()), name=payload.firm_name, tenant_type=TenantType.accounting_practice, plan="practice")
    company = Company(
        id=str(uuid4()),
        tenant_id=tenant.id,
        name=payload.first_client_name,
        industry=payload.industry,
        accounting_system=payload.accounting_system,
        currency=payload.currency,
        country=payload.country,
    )
    access = UserCompanyAccess(user_id="current_user", tenant_id=tenant.id, company_id=company.id, role="practice_admin")
    return OnboardingResponse(tenant=tenant, company=company, access=access)


@router.post("/company", response_model=OnboardingResponse)
def onboard_company(payload: CompanyOnboardingRequest):
    tenant = Tenant(id=str(uuid4()), name=payload.company_name, tenant_type=TenantType.company, plan="growth")
    company = Company(
        id=str(uuid4()),
        tenant_id=tenant.id,
        name=payload.company_name,
        industry=payload.industry,
        accounting_system=payload.accounting_system,
        currency=payload.currency,
        country=payload.country,
    )
    access = UserCompanyAccess(user_id="current_user", tenant_id=tenant.id, company_id=company.id, role="manager")
    return OnboardingResponse(tenant=tenant, company=company, access=access)
