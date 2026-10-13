from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class VigorStats(BaseModel):
    model_config = ConfigDict(extra="ignore")

    mean_vigor: float = Field(ge=0.0, le=1.0)
    stressed_pct: float = Field(ge=0.0, le=100.0)
    vigorous_pct: float = Field(ge=0.0, le=100.0)


class VigorMapResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    vigor_map: str
    surface_3d: str
    grid: list[list[float]] = Field(default_factory=list)
    stats: VigorStats


class AnalysisMode(str, Enum):
    disease_diagnosis = "disease_diagnosis"
    crop_identification = "crop_identification"
    field_health_analysis = "field_health_analysis"


class Severity(str, Enum):
    none = "none"
    low = "low"
    medium = "medium"
    high = "high"
    unknown = "unknown"


class RegionOfInterest(BaseModel):
    """One machine-readable lesion/region box, normalized 0-1, for SVG overlay."""

    model_config = ConfigDict(extra="forbid")

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(ge=0, le=1)
    height: float = Field(ge=0, le=1)
    label: str = Field(min_length=1, max_length=200)
    confidence: float = Field(ge=0, le=1)


class VisionAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    analysis_mode: AnalysisMode
    crop: str | None = None
    condition: str
    confidence: float = Field(ge=0, le=1)
    severity: Severity = Severity.unknown
    severity_score: float = Field(default=0.0, ge=0, le=1)
    observations: list[str] = Field(default_factory=list, max_length=10)
    recommended_actions: list[str] = Field(default_factory=list, max_length=10)
    regions: list[RegionOfInterest] = Field(default_factory=list, max_length=20)
    needs_expert_review: bool = True
    summary: str = Field(min_length=1, max_length=2000)
    # Gateway-orchestrated dense insight passthrough (LLM fusion of
    # stage-1 label + stage-2 description). None when served raw.
    insight: str | None = Field(default=None, max_length=2000)
    # Fast-model seam: which stage-1 produced the label.
    stage1_model: str = Field(default="vlm-regions", max_length=200)
