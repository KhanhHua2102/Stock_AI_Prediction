from fastapi import APIRouter, HTTPException

from app.config import settings
from app.services.market_review import generate_market_review
from app.services.analysis_db import AnalysisDB

router = APIRouter()


@router.get("/review")
async def get_market_review():
    """Return the latest market review, generating one for today if needed."""
    if not settings.llm_api_key:
        raise HTTPException(status_code=400, detail="LLM API key not configured.")
    try:
        review = await generate_market_review()
        return {"review": review}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/review/generate")
async def force_generate_review():
    """Force-regenerate today's market review."""
    if not settings.llm_api_key:
        raise HTTPException(status_code=400, detail="LLM API key not configured.")
    try:
        review = await generate_market_review(force=True)
        return {"review": review}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/review/latest")
async def get_latest_review():
    """Return the most recent market review without generating."""
    db = AnalysisDB(settings.analysis_db_path)
    review = db.get_latest_market_review()
    return {"review": review}
