from fastapi import APIRouter
from app.services.repository import list_findings, list_recommendations

router = APIRouter(prefix="/api/v1/analysis", tags=["analysis"])


@router.post("/jobs")
def create_job(company_id: str = "company_aurora"):
    return {
        "id": "job_demo_month_end",
        "company_id": company_id,
        "job_type": "month_end_analysis",
        "status": "completed",
        "message": "Demo analysis completed using seeded finance data."
    }


@router.get("/findings")
def findings(company_id: str = "company_aurora"):
    return list_findings(company_id)


@router.get("/recommendations")
def recommendations(company_id: str = "company_aurora"):
    return list_recommendations(company_id)
