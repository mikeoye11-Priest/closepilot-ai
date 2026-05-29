from fastapi import APIRouter, HTTPException
from app.models.schemas import DashboardResponse
from app.services.analysis import calculate_score, cash_at_risk, time_saved
from app.services.repository import get_company, get_tenant, list_findings, list_recommendations, list_validation_checks

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])


@router.get("", response_model=DashboardResponse)
def dashboard(tenant_id: str = "tenant_demo", company_id: str = "company_aurora"):
    try:
        tenant = get_tenant(tenant_id)
        company = get_company(tenant_id, company_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Company not found") from exc

    findings = list_findings(company.id)
    recommendations = list_recommendations(company.id)
    score = calculate_score(findings, recommendations)
    return DashboardResponse(
        tenant=tenant,
        company=company,
        score=score,
        open_findings=len([item for item in findings if item.status != "resolved"]),
        cash_at_risk=cash_at_risk(findings),
        time_saved_hours=time_saved(findings),
        findings=findings,
        recommendations=recommendations,
        validation_checks=list_validation_checks(),
    )
