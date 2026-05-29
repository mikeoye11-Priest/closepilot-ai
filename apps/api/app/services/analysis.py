from datetime import datetime
from app.models.schemas import FinanceHealthScore, Finding, Recommendation, RiskLevel


def classify(score: int) -> RiskLevel:
    if score >= 85:
        return RiskLevel.low
    if score >= 70:
        return RiskLevel.medium
    if score >= 50:
        return RiskLevel.high
    return RiskLevel.critical


def calculate_score(findings: list[Finding], recommendations: list[Recommendation]) -> FinanceHealthScore:
    penalties = {
        RiskLevel.low: 2,
        RiskLevel.medium: 6,
        RiskLevel.high: 12,
        RiskLevel.critical: 20,
    }
    open_penalty = sum(penalties[item.severity] for item in findings if item.status != "resolved")
    completed_boost = len([item for item in recommendations if item.completed]) * 3
    score = max(0, min(100, 88 - open_penalty + completed_boost))
    return FinanceHealthScore(company_id=findings[0].company_id if findings else "unknown", score=score, risk_level=classify(score), calculated_at=datetime.utcnow())


def cash_at_risk(findings: list[Finding]) -> int:
    values = {
        RiskLevel.low: 1200,
        RiskLevel.medium: 7500,
        RiskLevel.high: 18000,
        RiskLevel.critical: 42000,
    }
    return sum(values[item.severity] for item in findings if item.status != "resolved")


def time_saved(findings: list[Finding]) -> int:
    return round(len([item for item in findings if item.status != "resolved"]) * 2.4 + 8)


def answer_question(question: str, score: int, findings: list[Finding]) -> tuple[str, list[str]]:
    normalized = question.lower()
    top = sorted(findings, key=lambda item: {"low": 1, "medium": 2, "high": 3, "critical": 4}[item.severity], reverse=True)[0]
    if "cash" in normalized:
        return "Cash risk is concentrated in overdue debtors. Prioritise the three largest 60+ day accounts and pause non-critical supplier payments.", ["Draft collection emails", "Review payment run", "Update 90-day forecast"]
    if "vat" in normalized:
        return "VAT risk is driven by missing VAT codes and unusual input VAT movement. Review blank-coded purchase transactions before submission.", ["Review blank VAT codes", "Attach exception notes", "Reconcile VAT control"]
    if "score" in normalized:
        return f"Finance Health Score is {score}/100. The main drag is: {top.title}.", ["Resolve high findings", "Complete review checklist", "Rerun analysis"]
    return f"Start with {top.title}. It has the highest impact on close quality and finance risk.", ["Open finding", "Assign owner", "Generate checklist"]
