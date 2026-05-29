from fastapi import APIRouter
from app.models.schemas import ChatRequest, ChatResponse
from app.services.analysis import answer_question, calculate_score
from app.services.repository import list_findings, list_recommendations

router = APIRouter(prefix="/api/v1/ai", tags=["ai"])


@router.post("/chat", response_model=ChatResponse)
def chat(payload: ChatRequest) -> ChatResponse:
    findings = list_findings(payload.company_id)
    score = calculate_score(findings, list_recommendations(payload.company_id))
    answer, actions = answer_question(payload.question, score.score, findings)
    return ChatResponse(answer=answer, suggested_actions=actions)
