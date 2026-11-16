"""Schemas for Literature-Grounded Scientific Validation System.

Conforms strictly to MatLens scientific guardrails:
1. Measurement Analysis (direct calculations) vs Literature Evidence (verified papers) vs Scientific Interpretation (hypotheses & limits).
2. Never fabricates values, DOIs, pages or figures.
3. Discrete qualitative reliability states (Supported, Partially Supported, Insufficient Evidence, Conflicting Evidence, Not Comparable).
4. Full evidence traceability with paper DOI, extraction method, and verification status.
"""
from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, Field

AccessLevel = Literal["full_text", "abstract_only", "metadata_only"]
ReliabilityStatus = Literal[
    "Supported",
    "Partially Supported",
    "Insufficient Evidence",
    "Conflicting Evidence",
    "Not Comparable",
]
ConditionStatus = Literal["compatible", "conditionally_compatible", "incompatible"]


class PaperMetadata(BaseModel):
    paper_id: str = Field(description="고유 논문 식별자 (OpenAlex ID, DOI 또는 로컬 레퍼런스 ID)")
    title: str = Field(description="논문 제목")
    authors: list[str] = Field(default_factory=list, description="저자 목록")
    publication_year: int | None = Field(default=None, description="출판 연도")
    journal: str | None = Field(default=None, description="학술지 또는 학회명")
    doi: str | None = Field(default=None, description="Digital Object Identifier (DOI)")
    landing_page_url: str | None = Field(default=None, description="원문 또는 랜딩 페이지 URL")
    pdf_url: str | None = Field(default=None, description="합법적 오픈 액세스 PDF URL (있는 경우)")
    access_level: AccessLevel = Field(default="abstract_only", description="원문 접근 수준")
    citation_count: int | None = Field(default=None, description="피인용 횟수")
    open_access_status: str = Field(default="closed", description="오픈 액세스 상태 (gold, green, hybrid, closed 등)")
    abstract: str | None = Field(default=None, description="논문 초록 요약")


class EvidenceDetail(BaseModel):
    property: str = Field(description="보고된 물성 또는 분석 항목 (예: Lattice Parameter a, Yield Strength 등)")
    value: float | None = Field(default=None, description="학술 논문에서 확인된 수치 (미확인 시 null)")
    unit: str = Field(default="", description="물성 단위 (Å, MPa, GPa, nm, µm 등)")
    measurement_temperature: float | None = Field(default=None, description="측정 온도 (K 또는 °C)")
    source_page: int | str | None = Field(default=None, description="논문 페이지 번호 (임의 생성 금지, 미확인 시 null)")
    source_figure: str | None = Field(default=None, description="인용 Figure 번호 (임의 생성 금지, 미확인 시 null)")
    source_table: str | None = Field(default=None, description="인용 Table 번호 (임의 생성 금지, 미확인 시 null)")
    quoted_text: str = Field(default="", description="논문 원문 발췌 인용구")
    extraction_method: str = Field(
        default="deterministic_table_extraction",
        description="추출 방식 (deterministic_table_extraction, abstract_curation, verified_reference_db 등)",
    )
    verification_status: Literal["verified", "pending", "unverified"] = Field(
        default="verified", description="검증 상태"
    )


class ExtractedEvidenceItem(BaseModel):
    """Section 6 Schema Standard."""
    paper: dict[str, Any] = Field(
        default_factory=lambda: {
            "title": "",
            "doi": "",
            "publication_year": None,
            "access_level": "abstract_only",
        }
    )
    evidence: EvidenceDetail = Field(default_factory=EvidenceDetail)


LiteraturePaper = PaperMetadata
ScientificEvidenceRecord = ExtractedEvidenceItem


class ConditionCompatibility(BaseModel):
    material_similarity: float = Field(default=1.0, ge=0.0, le=1.0, description="재료 조성 유사도 (0~1)")
    crystal_or_micro_similarity: float = Field(default=1.0, ge=0.0, le=1.0, description="결정구조/미세조직 유사도")
    experimental_method_similarity: float = Field(default=1.0, ge=0.0, le=1.0, description="실험/측정 방법 유사도")
    condition_compatibility: ConditionStatus = Field(default="compatible", description="측정 조건 부합성")
    condition_mismatches: list[str] = Field(default_factory=list, description="불일치하는 조건 목록")
    direct_comparison_allowed: bool = Field(default=True, description="정량적 직접 비교 허용 여부")
    direct_comparison_warning: str | None = Field(default=None, description="직접 비교 제한 시 경고 사유")


class ComparisonMetricItem(BaseModel):
    property_name: str = Field(description="비교 대상 물성명")
    measured_value: float | None = Field(default=None, description="실측 계산값")
    literature_value: float | None = Field(default=None, description="문헌 보고값")
    unit: str = Field(default="", description="단위")
    absolute_deviation: float | None = Field(default=None, description="절대 편차 (|측정 - 문헌|)")
    relative_deviation_pct: float | None = Field(default=None, description="상대 편차 (%)")
    comparable: bool = Field(default=True, description="직접 비교 가능 여부")
    reason_if_not_comparable: str | None = Field(default=None, description="비교 불가 시 사유")


class AnalyticalReliability(BaseModel):
    status: ReliabilityStatus = Field(description="분석 신뢰도 상태")
    calibration_availability: bool = Field(default=True, description="측정 보정(스케일/파장/게이지) 확보 여부")
    data_quality_label: str = Field(description="측정 데이터 품질 평가")
    fitting_residual_label: str = Field(description="피팅 잔차 또는 수치 결정계수 평가")
    measurement_uncertainty: str = Field(description="측정 불확도 서술")
    details: list[str] = Field(default_factory=list, description="세부 신뢰도 근거")


class InterpretationReliability(BaseModel):
    status: ReliabilityStatus = Field(description="해석 신뢰도 상태")
    evidence_traceability: str = Field(description="문헌 근거 추적 가능성 수준")
    condition_compatibility_label: str = Field(description="실험 조건 부합성 평가")
    literature_agreement: str = Field(description="선행 연구와의 일치성 평가")
    unverified_assumptions: list[str] = Field(default_factory=list, description="미검증 가정 목록")
    details: list[str] = Field(default_factory=list, description="세부 신뢰도 근거")


class ScientificReliabilityAssessment(BaseModel):
    analytical: AnalyticalReliability = Field(description="측정 및 계산 신뢰도")
    interpretation: InterpretationReliability = Field(description="학술적 해석 및 문헌 비교 신뢰도")


class LiteratureValidationItem(BaseModel):
    paper: PaperMetadata
    compatibility: ConditionCompatibility
    evidence_items: list[ExtractedEvidenceItem] = Field(default_factory=list)
    relevance_score: float = Field(default=0.8, ge=0.0, le=1.0)
    comparison_status: ReliabilityStatus = Field(default="Supported")


class LiteratureValidationReport(BaseModel):
    instrument_type: Literal["XRD", "SEM", "UTM", "INTEGRATED"] = Field(description="분석 기기 유형")
    material_name: str = Field(description="재료명 / 화학식")
    target_property: str = Field(description="검증 대상 물성 또는 분석 항목")
    papers: list[PaperMetadata] = Field(default_factory=list, description="검색된 학술 논문 목록")
    validations: list[LiteratureValidationItem] = Field(default_factory=list, description="논문별 적합성 평가")
    comparisons: list[ComparisonMetricItem] = Field(default_factory=list, description="실측치 vs 문헌치 비교 메트릭")
    reliability: ScientificReliabilityAssessment = Field(description="이원화된 신뢰성 평가")
    findings_verified: list[str] = Field(default_factory=list, description="A. 검증된 실측 관찰 결과")
    findings_literature: list[str] = Field(default_factory=list, description="B. 학술 문헌 근거 및 비교 결과")
    hypotheses_and_limitations: list[str] = Field(default_factory=list, description="C. 과학적 해석 가설 및 한계")
    recommended_experiments: list[str] = Field(default_factory=list, description="추가 검증 권장 실험")
    disclaimers: list[str] = Field(default_factory=list, description="학술적 고지 사항")


class SearchLiteratureRequest(BaseModel):
    material_name: str
    chemical_composition: str | None = None
    instrument_type: Literal["XRD", "SEM", "UTM", "INTEGRATED"]
    measurement_conditions: dict[str, Any] = Field(default_factory=dict)
    target_property: str = Field(default="")
    analysis_result: dict[str, Any] = Field(default_factory=dict)
