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
from app.services.file_watcher import file_watcher
from app.api.routes import account, trading, training, charts
from app.api.websocket import router as ws_router


# ============================================================================
# SECURITY FIX (Issue #7): Rate Limiting with slowapi
# ============================================================================
limiter = Limiter(key_func=get_remote_address)


# ============================================================================
# SECURITY FIX (Issue #4): API Key Authentication
# ============================================================================
API_KEY_HEADER = APIKeyHeader(name="X-API-Key", auto_error=False)


async def verify_api_key(api_key: str = Security(API_KEY_HEADER)) -> str:
    """Verify API key for protected endpoints.

    SECURITY: All API endpoints (except health check) require authentication.
    Pass the API key in the X-API-Key header.
    """
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
    """Startup and shutdown events."""
    # Startup: start file watcher
    file_watcher.start()
    print(f"\n{'='*60}")
    print("PowerTrader Hub API Started")
    print(f"Host: {settings.api_host} (localhost only for security)")
    print(f"Port: {settings.api_port}")
    print(f"CORS Origins: {settings.get_cors_origins()}")
    print(f"Rate Limit: {settings.rate_limit_per_minute} requests/minute")
    print(f"API Key required: Yes (use X-API-Key header)")
    print(f"{'='*60}\n")
    yield
    # Shutdown: stop all processes and file watcher
    process_manager.stop_all()
    file_watcher.stop()


app = FastAPI(
    title="PowerTrader Hub API",
    description="API for PowerTrader cryptocurrency trading system",
    version="1.0.0",
    lifespan=lifespan,
)

# Add rate limiter to app state
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# ============================================================================
# SECURITY FIX (Issue #5): Restricted CORS
# Only allow specified origins (default: localhost:3000)
# ============================================================================
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_cors_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)

# Include routers with authentication dependency
app.include_router(
    account.router,
    prefix="/api/account",
    tags=["Account"],
    dependencies=[Depends(verify_api_key)],
)
app.include_router(
    trading.router,
    prefix="/api/trading",
    tags=["Trading"],
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
app.include_router(ws_router)


@app.get("/api/health")
@limiter.limit(f"{settings.rate_limit_per_minute}/minute")
async def health_check(request: Request):
    """Health check endpoint (no authentication required)."""
    return {"status": "ok", "project_dir": str(settings.project_dir)}


@app.get("/api/settings")
@limiter.limit(f"{settings.rate_limit_per_minute}/minute")
async def get_settings(request: Request, api_key: str = Depends(verify_api_key)):
    """Get current application settings."""
    return {
        "coins": settings.coins,
        "default_timeframe": settings.default_timeframe,
        "timeframes": settings.timeframes,
        "candles_limit": settings.candles_limit,
        "ui_refresh_seconds": settings.ui_refresh_seconds,
        "chart_refresh_seconds": settings.chart_refresh_seconds,
        "kraken_configured": settings.kraken_key is not None,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=True,
    )
