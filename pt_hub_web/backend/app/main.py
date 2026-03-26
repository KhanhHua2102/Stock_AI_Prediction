import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException, Depends, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import APIKeyHeader
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from app.config import settings
from app.services.process_manager import process_manager
from app.api.routes import trading, training, charts, predictions, settings as settings_routes, analysis, portfolio
from app.api.websocket import router as ws_router


limiter = Limiter(key_func=get_remote_address)

API_KEY_HEADER = APIKeyHeader(name="X-API-Key", auto_error=False)


async def verify_api_key(api_key: str = Security(API_KEY_HEADER)) -> str:
    if api_key is None:
        raise HTTPException(
            status_code=401,
            detail="Missing API Key. Include X-API-Key header.",
            headers={"WWW-Authenticate": "ApiKey"},
        )
    if api_key != settings.api_key:
        raise HTTPException(
            status_code=403,
            detail="Invalid API Key",
            headers={"WWW-Authenticate": "ApiKey"},
        )
    return api_key


@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"\n{'='*60}")
    print("Stock AI Prediction — Hub API Started")
    print(f"Host: {settings.api_host}")
    print(f"Port: {settings.api_port}")
    print(f"API Key required: Yes (X-API-Key header)")
    print(f"{'='*60}\n")
    yield
    process_manager.stop_all()


app = FastAPI(
    title="Stock AI Prediction Hub",
    description="API for stock/ETF prediction system",
    version="2.0.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_cors_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)

app.include_router(
    trading.router,
    prefix="/api/trading",
    tags=["Runner"],
    dependencies=[Depends(verify_api_key)],
)
app.include_router(
    training.router,
    prefix="/api/training",
    tags=["Training"],
    dependencies=[Depends(verify_api_key)],
)
app.include_router(
    charts.router,
    prefix="/api/charts",
    tags=["Charts"],
    dependencies=[Depends(verify_api_key)],
)
app.include_router(
    predictions.router,
    prefix="/api/predictions",
    tags=["Predictions"],
    dependencies=[Depends(verify_api_key)],
)
app.include_router(
    settings_routes.router,
    prefix="/api/settings",
    tags=["Settings"],
    dependencies=[Depends(verify_api_key)],
)
app.include_router(
    analysis.router,
    prefix="/api/analysis",
    tags=["Analysis"],
    dependencies=[Depends(verify_api_key)],
)
app.include_router(
    portfolio.router,
    prefix="/api/portfolio",
    tags=["Portfolio"],
    dependencies=[Depends(verify_api_key)],
)
app.include_router(ws_router)


@app.get("/api/health")
@limiter.limit(f"{settings.rate_limit_per_minute}/minute")
async def health_check(request: Request):
    return {"status": "ok", "project_dir": str(settings.project_dir)}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=True,
    )
