import pytest
from fastapi import HTTPException

from app.main import health
from app.models.schemas import ChatRequest, CompanyOnboardingRequest
from app.routers.ai import chat
from app.routers.analysis import create_job
from app.routers.dashboard import dashboard
from app.routers.onboarding import onboard_company


def test_health_check_returns_ok():
    assert health() == {"status": "ok"}


def test_dashboard_returns_seeded_assurance_summary():
    body = dashboard()

    assert body.tenant.name == "Northbridge Advisory LLP"
    assert body.company.name == "Aurora Components Ltd"
    assert 0 <= body.score.score <= 100
    assert body.open_findings == 4
    assert body.cash_at_risk > 0
    assert len(body.findings) == 4
    assert len(body.recommendations) == 3
    assert len(body.validation_checks) == 4


def test_dashboard_returns_404_for_unknown_company():
    with pytest.raises(HTTPException) as exc:
        dashboard(company_id="missing")

    assert exc.value.status_code == 404
    assert exc.value.detail == "Company not found"


def test_analysis_job_completes_for_requested_company():
    body = create_job(company_id="company_test")

    assert body["company_id"] == "company_test"
    assert body["status"] == "completed"
    assert body["job_type"] == "month_end_analysis"


def test_ai_chat_returns_answer_and_suggested_actions():
    body = chat(
        ChatRequest(
            tenant_id="tenant_demo",
            company_id="company_aurora",
            question="Why is cash tight?",
        )
    )

    assert body.answer
    assert body.suggested_actions


def test_company_onboarding_returns_tenant_company_and_access():
    body = onboard_company(
        CompanyOnboardingRequest(
            company_name="QA Components Ltd",
            industry="Manufacturing",
            accounting_system="Xero",
            currency="GBP",
            country="United Kingdom",
        )
    )

    assert body.tenant.name == "QA Components Ltd"
    assert body.tenant.tenant_type == "company"
    assert body.company.name == "QA Components Ltd"
    assert body.company.accounting_system == "Xero"
    assert body.access.role == "manager"
