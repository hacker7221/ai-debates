from fastapi import APIRouter
from typing import Optional, Dict, Any
from app.services.openrouter_client import openrouter_client
from app.schemas.schemas import ModelsResponse, ValidateModelsRequest, ValidateModelsResponse, ValidationResult
import time
import asyncio

router = APIRouter()

@router.get("/credits", response_model=Dict[str, float])
async def get_credits(api_key: Optional[str] = None) -> Dict[str, float]:
    """
    Get current account credits.
    """
    credits: float = await openrouter_client.get_credits(api_key=api_key)
    return {"credits": credits}

@router.get("", response_model=ModelsResponse)
async def get_models() -> Dict[str, Any]:
    """
    Get list of available models from OpenRouter.
    """
    models = await openrouter_client.get_models()
    return {
        "data": models,
        "timestamp": time.time()
    }

@router.post("/validate", response_model=ValidateModelsResponse)
async def validate_models(request: ValidateModelsRequest):
    """
    Validate a list of models by sending a short prompt to each.
    """
    results = []
    
    async def check_one(model_id: str) -> ValidationResult:
        is_ok, error_msg = await openrouter_client.validate_model(model_id, api_key=request.api_key)
        return ValidationResult(
            model_id=model_id,
            status="ok" if is_ok else "error",
            error=error_msg
        )

    tasks = [check_one(mid) for mid in request.model_ids]
    results = await asyncio.gather(*tasks)
    
    return {"results": results}
