from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

router = APIRouter()


def _get_property_db():
    from app.config import property_db
    return property_db


# ── Request Models ─────────────────────────────────────────────

AU_STATES = ("NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT")
PROPERTY_TYPES = ("house", "apartment", "townhouse", "land", "villa", "unit")


class PropertyCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    address: str = Field(..., min_length=1)
    suburb: str = Field(..., min_length=1)
    state: str = Field(..., pattern="^(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)$")
    postcode: str = Field(..., pattern=r"^\d{4}$")
    property_type: str = Field(..., pattern="^(house|apartment|townhouse|land|villa|unit)$")
    bedrooms: int = Field(default=0, ge=0)
    bathrooms: int = Field(default=0, ge=0)
    parking: int = Field(default=0, ge=0)
    land_size_sqm: Optional[float] = None
    purchase_date: Optional[str] = None
    purchase_price: Optional[float] = None
    current_estimate: Optional[float] = None
    rental_income_weekly: Optional[float] = 0
    loan_amount: Optional[float] = 0
    loan_rate_pct: Optional[float] = 0
    notes: Optional[str] = None


class PropertyUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    suburb: Optional[str] = None
    state: Optional[str] = Field(default=None, pattern="^(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)$")
    postcode: Optional[str] = Field(default=None, pattern=r"^\d{4}$")
    property_type: Optional[str] = Field(default=None, pattern="^(house|apartment|townhouse|land|villa|unit)$")
    bedrooms: Optional[int] = Field(default=None, ge=0)
    bathrooms: Optional[int] = Field(default=None, ge=0)
    parking: Optional[int] = Field(default=None, ge=0)
    land_size_sqm: Optional[float] = None
    purchase_date: Optional[str] = None
    purchase_price: Optional[float] = None
    current_estimate: Optional[float] = None
    rental_income_weekly: Optional[float] = None
    loan_amount: Optional[float] = None
    loan_rate_pct: Optional[float] = None
    notes: Optional[str] = None


class ValuationCreate(BaseModel):
    date: str = Field(..., min_length=10, max_length=10)
    estimated_value: float = Field(..., gt=0)
    source: str = Field(default="manual", pattern="^(manual|domain|corelogic|proptrack|openagent)$")
    notes: Optional[str] = None


class FavoriteSuburbCreate(BaseModel):
    suburb: str = Field(..., min_length=1)
    state: str = Field(..., pattern="^(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)$")
    postcode: str = Field(..., pattern=r"^\d{4}$")


class SuburbMetricCreate(BaseModel):
    suburb: str = Field(..., min_length=1)
    state: str = Field(..., pattern="^(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)$")
    postcode: str = Field(..., pattern=r"^\d{4}$")
    date: str = Field(..., min_length=7)
    metric_type: str = Field(
        ...,
        pattern="^(median_house_price|median_unit_price|median_rent_house|median_rent_unit|"
                "population|vacancy_rate|days_on_market|auction_clearance|yield_gross|"
                "annual_growth_house|annual_growth_unit)$",
    )
    value: float
    source: str = Field(default="manual")


# ── Property CRUD ──────────────────────────────────────────────

@router.post("/properties")
async def create_property(req: PropertyCreate):
    db = _get_property_db()
    pid = db.create_property(req.model_dump())
    return {"id": pid, "name": req.name}


@router.get("/properties")
async def list_properties():
    db = _get_property_db()
    properties = db.get_properties()
    return {"properties": properties}


@router.get("/properties/{property_id}")
async def get_property(property_id: int):
    db = _get_property_db()
    p = db.get_property(property_id)
    if not p:
        raise HTTPException(status_code=404, detail="Property not found")
    return p


@router.put("/properties/{property_id}")
async def update_property(property_id: int, req: PropertyUpdate):
    db = _get_property_db()
    if not db.get_property(property_id):
        raise HTTPException(status_code=404, detail="Property not found")
    db.update_property(property_id, **req.model_dump(exclude_none=True))
    return {"status": "updated"}


@router.delete("/properties/{property_id}")
async def delete_property(property_id: int):
    db = _get_property_db()
    if not db.get_property(property_id):
        raise HTTPException(status_code=404, detail="Property not found")
    db.delete_property(property_id)
    return {"status": "deleted"}


@router.put("/properties/{property_id}/projection-params")
async def save_projection_params(property_id: int, params: dict):
    import json
    db = _get_property_db()
    if not db.get_property(property_id):
        raise HTTPException(status_code=404, detail="Property not found")
    db.update_property(property_id, projection_params=json.dumps(params))
    return {"status": "saved"}


# ── Valuations ─────────────────────────────────────────────────

@router.post("/properties/{property_id}/valuations")
async def add_valuation(property_id: int, req: ValuationCreate):
    db = _get_property_db()
    if not db.get_property(property_id):
        raise HTTPException(status_code=404, detail="Property not found")
    vid = db.add_valuation(property_id, req.date, req.estimated_value, req.source, req.notes)
    return {"id": vid}


@router.get("/properties/{property_id}/valuations")
async def list_valuations(property_id: int, limit: int = Query(default=100, le=500)):
    db = _get_property_db()
    if not db.get_property(property_id):
        raise HTTPException(status_code=404, detail="Property not found")
    valuations = db.get_valuations(property_id, limit=limit)
    return {"valuations": valuations}


@router.delete("/valuations/{valuation_id}")
async def delete_valuation(valuation_id: int):
    db = _get_property_db()
    pid = db.delete_valuation(valuation_id)
    if pid is None:
        raise HTTPException(status_code=404, detail="Valuation not found")
    return {"status": "deleted", "property_id": pid}


@router.post("/properties/{property_id}/valuations/fetch")
async def fetch_valuation_history(property_id: int):
    """Fetch historical suburb median prices and store as valuations."""
    db = _get_property_db()
    prop = db.get_property(property_id)
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    from app.services.property_data import fetch_valuation_history as _fetch
    valuations = await _fetch(
        prop["suburb"], prop["state"], prop["postcode"], prop.get("property_type", "house"),
    )

    added = 0
    for v in valuations:
        try:
            db.add_valuation(property_id, v["date"], v["estimated_value"], v["source"])
            added += 1
        except Exception:
            pass  # Skip duplicates or constraint errors

    return {"added": added, "total_fetched": len(valuations)}


# ── Dashboard ──────────────────────────────────────────────────

@router.get("/dashboard")
async def get_dashboard():
    db = _get_property_db()
    return db.get_dashboard_summary()


# ── Suburb Metrics ─────────────────────────────────────────────

@router.post("/suburb-metrics")
async def upsert_suburb_metric(req: SuburbMetricCreate):
    db = _get_property_db()
    db.upsert_suburb_metric(
        req.suburb, req.state, req.postcode,
        req.date, req.metric_type, req.value, req.source,
    )
    return {"status": "ok"}


@router.get("/suburb-metrics/{suburb}/{state}")
async def get_suburb_metrics(
    suburb: str, state: str,
    metric_type: Optional[str] = None,
    limit: int = Query(default=60, le=500),
):
    db = _get_property_db()
    metrics = db.get_suburb_metrics(suburb, state, metric_type=metric_type, limit=limit)
    return {"metrics": metrics}


@router.get("/suburb-metrics/{suburb}/{state}/summary")
async def get_suburb_summary(suburb: str, state: str):
    db = _get_property_db()
    return db.get_suburb_summary(suburb, state)


@router.post("/suburb-metrics/{suburb}/{state}/refresh")
async def refresh_suburb_data(suburb: str, state: str, postcode: str = Query(..., pattern=r"^\d{4}$")):
    """Fetch suburb metrics from all available external sources."""
    from app.services.property_data import refresh_suburb_data as _refresh
    result = await _refresh(suburb.upper(), state.upper(), postcode)
    return result


# ── Favorite Suburbs ──────────────────────────────────────────

@router.get("/favorite-suburbs")
async def list_favorite_suburbs():
    db = _get_property_db()
    return {"favorites": db.get_favorite_suburbs()}


@router.post("/favorite-suburbs")
async def add_favorite_suburb(req: FavoriteSuburbCreate):
    db = _get_property_db()
    fid = db.add_favorite_suburb(req.suburb.upper(), req.state.upper(), req.postcode)
    return {"id": fid, "suburb": req.suburb.upper(), "state": req.state.upper()}


@router.delete("/favorite-suburbs/{suburb}/{state}")
async def remove_favorite_suburb(suburb: str, state: str):
    db = _get_property_db()
    db.remove_favorite_suburb(suburb.upper(), state.upper())
    return {"status": "deleted"}
