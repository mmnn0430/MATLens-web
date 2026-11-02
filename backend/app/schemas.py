"""Pydantic schemas for API requests, responses, analysis parameters, and structured Gemini AI output."""
from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, Field


class CrystallinityConfig(BaseModel):
    enabled: bool = False
    sample_family: str = ""  # e.g., "oxide_amorphous_silica_matrix", "semicrystalline_polymer"
    background_model: str = "als_envelope"
    separation_method: str = "crystalline_peak_area_over_total_coherent_scatter"
    two_theta_min: float = 10.0
    two_theta_max: float = 70.0


class XRDParams(BaseModel):
    col_two_theta: int | str | None = None
    col_intensity: int | str | None = None
    xray_source: str = "Cu Kα (1.5406 Å)"
    wavelength_angstrom: float = Field(default=1.5406, gt=0.1, lt=5.0)
    wavelength_confirmed: bool = True
    two_theta_min: float | None = None
    two_theta_max: float | None = None
    # Preprocessing
    als_lam: float = Field(default=1e5, ge=1e2, le=1e9)
    als_p: float = Field(default=0.01, gt=0.0001, lt=0.5)
    use_smoothing: bool = True
    smooth_window: int = Field(default=9, ge=5, le=51)
    smooth_polyorder: int = Field(default=3, ge=2, le=5)
    # Peak detection & fitting
    prominence_rel: float = Field(default=0.025, ge=0.002, le=0.5)
    min_rel_height: float = Field(default=0.02, ge=0.002, le=0.5)
    min_distance_deg: float = Field(default=0.14, ge=0.02, le=5.0)
    fit_profile: Literal["pseudo_voigt", "gaussian", "lorentzian"] = "pseudo_voigt"
    excluded_peak_ids: list[str] = Field(default_factory=list)
    # Phase matching & Materials Project thermodynamic filters
    match_tol_deg: float = Field(default=0.22, ge=0.03, le=1.0)
    max_shift_deg: float = Field(default=0.15, ge=0.0, le=0.5)
    use_element_filter: bool = True
    enable_multiphase: bool = True
    max_e_hull_ev: float = Field(default=0.15, ge=0.0, le=1.0)
    use_mp_live: bool = True
    # Scherrer & Williamson-Hall
    scherrer_k: float = Field(default=0.90, ge=0.6, le=1.2)
    inst_fwhm_deg: float | None = Field(default=None, ge=0.0, le=1.0)
    enable_williamson_hall: bool = True
    # Conditional relative crystallinity
    crystallinity: CrystallinityConfig = Field(default_factory=CrystallinityConfig)


class ROIRect(BaseModel):
    x: int = 0
    y: int = 0
    w: int = 0
    h: int = 0


class Point2D(BaseModel):
    x: float
    y: float


class SEMParams(BaseModel):
    mode: Literal["particle", "grain"] = "particle"
    roi: ROIRect | None = None
    # Scale calibration
    scale_confirmed: bool = False
    scale_x0: float | None = None
    scale_y0: float | None = None
    scale_x1: float | None = None
    scale_y1: float | None = None
    scale_length_px: float | None = None
    scale_real_value: float | None = None
    scale_unit: Literal["nm", "µm", "mm"] = "µm"
    # Image enhancement & segmentation
    clahe_clip: float = Field(default=2.0, ge=0.5, le=10.0)
    gaussian_blur: int = Field(default=3, ge=0, le=15)
    invert_polarity: bool = False
    threshold_mode: Literal["otsu", "manual"] = "otsu"
    manual_threshold: int = Field(default=128, ge=1, le=254)
    min_size_px: int = Field(default=25, ge=5, le=5000)
    split_sensitivity: float = Field(default=0.55, ge=0.0, le=1.0)
    exclude_border: bool = True
    excluded_object_ids: list[int] = Field(default_factory=list)
    segmentation_confirmed: bool = False
    # Grain boundary & linear intercept extension
    grain_boundary_confirmed: bool = False
    grain_block_size: int = Field(default=41, ge=11, le=151)
    grain_offset: float = Field(default=4.0, ge=-20.0, le=30.0)
    n_test_lines: int = Field(default=6, ge=2, le=20)
    added_intersections: list[Point2D] = Field(default_factory=list)
    removed_intersection_ids: list[str] = Field(default_factory=list)


class RunAnalysisRequest(BaseModel):
    xrd_params: XRDParams = Field(default_factory=XRDParams)
    sem_params: SEMParams = Field(default_factory=SEMParams)
    run_ai_interpretation: bool = True


class CreateProjectRequest(BaseModel):
    sample_name: str = Field(..., min_length=1, max_length=120)
    description: str = Field(default="", max_length=1000)
    expected_elements: list[str] = Field(default_factory=list)
    expected_formula: str = Field(default="", max_length=80)
    is_same_sample: bool = False


class UpdateProjectRequest(BaseModel):
    sample_name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    expected_elements: list[str] | None = None
    expected_formula: str | None = None
    is_same_sample: bool | None = None
    current_conditions: dict[str, Any] | None = None
    change_summary: str | None = None


class UpdateAIConfigRequest(BaseModel):
    gemini_api_key: str | None = None
    gemini_model: str | None = None
    mp_api_key: str | None = None


# ---------------- Gemini Structured Output Schema ---------------- #
class EvidenceStatement(BaseModel):
    statement: str = Field(description="관찰된 사실 문장 (한국어). 입력된 수치만 인용하며 추측을 섞지 않음.")
    evidence_ids: list[str] = Field(description="근거가 되는 분석 엔진 결과 ID 목록 (예: XRD-PHASE-1, SEM-STAT-D50).")


class HypothesisItem(BaseModel):
    hypothesis: str = Field(description="두 결과를 함께 본 해석 가설 (한국어). 확정 표현 대신 가능성/가설로 서술.")
    basis_ids: list[str] = Field(description="가설이 참조한 분석 결과 ID 목록.")
    caveats: str = Field(description="이 가설이 성립하기 위한 전제 또는 대안적 설명.")


class DiscrepancyCheckItem(BaseModel):
    item: str = Field(description="불일치하거나 추가 확인이 필요한 항목 (한국어).")
    reason: str = Field(description="확인이 필요한 구체적 이유.")
    related_ids: list[str] = Field(default_factory=list, description="관련 결과 ID 목록.")


class NextExperimentItem(BaseModel):
    experiment: str = Field(description="제안하는 다음 분석 또는 실험명 (예: TEM/SAED, EDS 원소 맵핑, 표준시료 LaB6 측정 등).")
    purpose: str = Field(description="이 실험을 통해 검증하거나 해결하려는 구체적인 목적.")


class AIReportSchema(BaseModel):
    executive_summary: str = Field(description="한눈에 보는 요약 (2~4문장, 한국어). 숫자로 된 AI 신뢰도 표기 금지.")
    xrd_observed_facts: list[EvidenceStatement] = Field(description="XRD 분석 결과에서 관찰된 사실 목록.")
    sem_observed_facts: list[EvidenceStatement] = Field(description="SEM 분석 결과 및 이미지에서 관찰된 사실 목록.")
    integrated_hypotheses: list[HypothesisItem] = Field(description="XRD와 SEM 결과를 함께 연결한 해석 가설 목록.")
    discrepancies_and_checks: list[DiscrepancyCheckItem] = Field(description="불일치 또는 추가 확인이 필요한 항목.")
    next_experiments: list[NextExperimentItem] = Field(description="다음 실험 제안과 각 실험의 목적.")
    limitations: list[str] = Field(description="본 분석의 물리적·방법론적 한계 목록.")
