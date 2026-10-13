from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class CurrentUser(BaseModel):
    id: UUID
    email: str | None = None
    user_metadata: dict = Field(default_factory=dict)
    access_token: str


class FarmCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    state: str = Field(min_length=2, max_length=100)
    district: str = Field(min_length=2, max_length=100)
    village: str | None = Field(default=None, max_length=120)
    acreage: Decimal | None = Field(default=None, gt=0)
    soil_type: str | None = Field(default=None, max_length=80)
    irrigation_type: str | None = Field(default=None, max_length=80)
    current_crop: str | None = Field(default=None, max_length=80)
    sowing_date: date | None = None


class FarmUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    state: str | None = Field(default=None, min_length=2, max_length=100)
    district: str | None = Field(default=None, min_length=2, max_length=100)
    village: str | None = Field(default=None, max_length=120)
    acreage: Decimal | None = Field(default=None, gt=0)
    soil_type: str | None = Field(default=None, max_length=80)
    irrigation_type: str | None = Field(default=None, max_length=80)
    current_crop: str | None = Field(default=None, max_length=80)
    sowing_date: date | None = None


class ListingCreate(BaseModel):
    title: str = Field(min_length=3, max_length=140)
    crop: str = Field(min_length=2, max_length=80)
    variety: str | None = Field(default=None, max_length=80)
    description: str = Field(default="", max_length=3000)
    quantity: Decimal = Field(gt=0)
    unit: Literal["kg", "quintal", "tonne", "piece", "crate"]
    price: Decimal = Field(ge=0)
    state: str = Field(min_length=2, max_length=100)
    district: str = Field(min_length=2, max_length=100)
    harvest_date: date | None = None
    contact_phone: str | None = Field(default=None, min_length=7, max_length=20)
    image_paths: list[str] = Field(default_factory=list, max_length=8)
    status: Literal["draft", "active"] = "active"


class ListingUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=140)
    description: str | None = Field(default=None, max_length=3000)
    quantity: Decimal | None = Field(default=None, gt=0)
    price: Decimal | None = Field(default=None, ge=0)
    contact_phone: str | None = Field(default=None, min_length=7, max_length=20)
    image_paths: list[str] | None = Field(default=None, max_length=8)
    status: Literal["draft", "active", "reserved", "sold", "expired"] | None = None


class NewsIngestRequest(BaseModel):
    feed_urls: list[str] | None = Field(default=None, max_length=20)


class PlanRequest(BaseModel):
    land_size: float = Field(gt=0)
    crop: str = Field(min_length=2, max_length=100)
    state: str = Field(min_length=2, max_length=100)
    district: str = Field(min_length=2, max_length=100)


class QueryRequest(BaseModel):
    query: str = Field(min_length=2, max_length=2000)


class FieldPlanRegion(BaseModel):
    label: str = Field(min_length=1, max_length=200)
    confidence: float = Field(default=0.5, ge=0, le=1)


class FieldPlanRequest(BaseModel):
    regions: list[FieldPlanRegion] = Field(min_length=1, max_length=20)
    land_size: float | None = Field(default=None, gt=0)
    state: str | None = Field(default=None, min_length=2, max_length=100)
    district: str | None = Field(default=None, min_length=2, max_length=100)
    season: Literal["kharif", "rabi", "zaid"] = "kharif"
    goal: Literal["yield", "money"] = "yield"


class FieldPlanZone(BaseModel):
    region_label: str = Field(max_length=200)
    crop: str = Field(max_length=80)
    color: Literal["grow", "consider", "rest"]
    reason: str = Field(max_length=300)
    estimated_revenue_inr_per_acre: float | None = Field(default=None, ge=0)
    price_source: str | None = Field(default=None, max_length=40)


class MarketSnapshotEntry(BaseModel):
    crop: str = Field(max_length=80)
    avg_min_price: float = Field(ge=0)
    avg_max_price: float = Field(ge=0)
    unit: str = Field(default="Rs/quintal", max_length=20)
    as_of: str = Field(max_length=20)


class FieldPlanResponse(BaseModel):
    zones: list[FieldPlanZone]
    summary: str = Field(max_length=1000)
    enriched: bool
    market_snapshot: list[MarketSnapshotEntry] = Field(default_factory=list)
