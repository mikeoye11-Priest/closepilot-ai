from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import ai, analysis, dashboard, onboarding

app = FastAPI(
    title="ClosePilot AI API",
    version="0.1.0",
    description="API for turning finance exports into finance health reviews, risk reports, cash forecasts and management commentary.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://localhost:3004"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(dashboard.router)
app.include_router(analysis.router)
app.include_router(ai.router)
app.include_router(onboarding.router)


@app.get("/health")
def health():
    return {"status": "ok"}
