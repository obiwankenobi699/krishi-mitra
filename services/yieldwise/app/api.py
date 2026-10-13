from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from shared.core.security import require_internal_api_key

from .agents.financial_agents import FinancialServiceUnavailable, financial_agent

router = APIRouter(dependencies=[Depends(require_internal_api_key)])

class PlanRequest(BaseModel):
    land_size: float = Field(..., gt=0, description="Size of land in acres")
    crop: str = Field(..., min_length=2, max_length=100, description="The crop to be planted")
    state: str = Field(..., min_length=2, max_length=100)
    district: str = Field(..., min_length=2, max_length=100)

    @field_validator("crop", "state", "district")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("must not be blank")
        return value


class PlanResponse(BaseModel):
    plan: str

@router.post("/generate-plan", response_model=PlanResponse, tags=["Finance"])
async def generate_plan(request: PlanRequest) -> PlanResponse:
    """Generates a high-level financial plan for a farmer."""
    try:
        plan = await financial_agent.get_financial_plan(
            request.land_size, request.crop, request.state, request.district
        )
        return PlanResponse(plan=plan)
    except FinancialServiceUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
