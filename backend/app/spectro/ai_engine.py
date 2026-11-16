"""Gemini AI Scientific Interpretation Engine for Spectroscopy and Thermal Analysis (FT-IR, DSC, TGA).

Enforces:
- Evidence ID binding to Python calculated metrics
- Strict structured JSON schema
- Non-hallucination rules (never invents polymer identity, enthalpy standards, or unknown additives)
- Graceful degradation when Gemini API key is missing
"""
from __future__ import annotations

import json
from typing import Any
from pydantic import BaseModel, Field

from app.config import (
    GEMINI_FALLBACK_ORDER,
    get_gemini_api_key,
    get_gemini_model,
)
from app.db import utc_now_iso


class SpectroFact(BaseModel):
    statement: str = Field(description="수치적으로 검증된 관찰 사실")
    evidence_id: str = Field(description="관련 수치 근거 ID")


class SpectroHypothesis(BaseModel):
    hypothesis: str = Field(description="재료과학적 가설 및 해석")
    basis_ids: list[str] = Field(default_factory=list, description="근거가 되는 지표 ID 목록")
    caveats: str = Field(description="가설의 한계 및 주의사항")


class SpectroAIReportSchema(BaseModel):
    executive_summary: str = Field(description="2~3문단의 핵심 과학적 종합 요약")
    observed_facts: list[SpectroFact] = Field(default_factory=list, description="엔진 계산값에 근거한 관찰 사실")
    physical_interpretations: list[SpectroHypothesis] = Field(default_factory=list, description="열적/분광학적 물성 해석 가설")
    discrepancies_and_checks: list[str] = Field(default_factory=list, description="확인 필요 사항 및 단위/조건 점검")
    next_experiments: list[str] = Field(default_factory=list, description="상호보완적 추천 후속 분석 (XRD, SEM, GPC, EDS 등)")
    limitations: list[str] = Field(default_factory=list, description="본 분석 기법의 물리적 한계점")


SYSTEM_PROMPT = """당신은 재료공학 및 고분자 분석 전문 연구원 AI입니다.
FT-IR 적외선 분광, DSC 시차주사열량, TGA 열중량 분석의 파이썬 수치 계산 결과(evidence_registry)만을 엄격히 바탕으로
객관적인 분석 보조 리포트를 작성해야 합니다.

[절대 준수 규칙]
1. evidence_registry에 없는 수치, 물질명, 화학식, 표준 엔탈피 값을 임의로 날조(hallucination)하지 마십시오.
2. 단일 FT-IR 피크만으로 고분자나 화합물 종류를 확정하지 마십시오.
3. DSC에서 사용자가 기준 용융 엔탈피(ΔHm°)를 명시하지 않은 경우 결정화도(Xc)를 추측하여 단정하지 마십시오.
4. TGA에서 특정 온도 구간의 질량 감소나 잔류물만으로 성분(카본블랙, 회분, ZnO 등)을 임의 확정하지 마십시오.
5. 계산값과 추론 가설을 엄격히 분리하여 서술하십시오.
"""


def build_spectro_evidence_registry(instrument: str, analysis: dict[str, Any]) -> dict[str, Any]:
    """Compile Python calculations into flat evidence registry for AI grounding."""
    registry: dict[str, Any] = {}
    inst = instrument.lower()

    if inst == "ftir":
        peaks = analysis.get("peaks", [])
        fringes = analysis.get("fringes", {})
        registry["FTIR-PEAK-COUNT"] = {"label": "검출된 유효 피크 수", "value": len(peaks)}
        for i, p in enumerate(peaks[:8]):
            fgs = [g["name"] for g in p.get("functional_groups", [])]
            registry[f"FTIR-PEAK-{i+1}"] = {
                "label": f"피크 {p['id']} ({p['wavenumber']} cm⁻¹)",
                "value": {"wavenumber": p["wavenumber"], "transmittance_pct": p["transmittance_pct"], "absorbance": p["absorbance"], "groups": fgs},
            }
        if fringes.get("status") == "분석 완료" or fringes.get("optical_thickness_um"):
            registry["FTIR-FRINGE-THICKNESS"] = {
                "label": "간섭무늬 박막 두께",
                "value": {
                    "physical_thickness_um": fringes.get("physical_thickness_um"),
                    "optical_thickness_um": fringes.get("optical_thickness_um"),
                    "m_intervals": fringes.get("m_interval_count"),
                    "refractive_index": fringes.get("refractive_index"),
                },
            }

    elif inst == "dsc":
        trans = analysis.get("transitions", {})
        tm = trans.get("melting", {})
        tc = trans.get("crystallization", {})
        tg = trans.get("glass_transition", {})
        xc = trans.get("crystallinity", {})

        if tm.get("tm_peak_c"):
            registry["DSC-TM"] = {"label": "용융 피크 Tm", "value": {"peak_c": tm["tm_peak_c"], "delta_h_m_J_per_g": tm.get("delta_h_m_J_per_g")}}
        if tc.get("tc_peak_c"):
            registry["DSC-TC"] = {"label": "결정화 피크 Tc", "value": {"peak_c": tc["tc_peak_c"], "delta_h_c_J_per_g": tc.get("delta_h_c_J_per_g")}}
        if tg.get("tg_midpoint_c"):
            registry["DSC-TG"] = {"label": "유리전이온도 Tg", "value": {"midpoint_c": tg["tg_midpoint_c"]}}
        if xc.get("crystallinity_pct") is not None:
            registry["DSC-XC"] = {"label": "조건부 결정화도 Xc", "value": {"crystallinity_pct": xc["crystallinity_pct"], "delta_hm_zero": xc.get("standard_melting_enthalpy_J_per_g")}}

    elif inst == "tga":
        decomp = analysis.get("decomposition_characteristics", {})
        res = analysis.get("residual", {})
        steps = analysis.get("steps", [])

        if decomp.get("T5_c"):
            registry["TGA-T5"] = {"label": "5% 질량 감소 온도 T5", "value": decomp["T5_c"]}
        if decomp.get("T10_c"):
            registry["TGA-T10"] = {"label": "10% 질량 감소 온도 T10", "value": decomp["T10_c"]}
        for p in decomp.get("dtg_peaks", [])[:3]:
            registry[f"TGA-DTG-PEAK-{p['peak_index']}"] = {"label": f"DTG 최대 분해속도 피크 {p['peak_index']}", "value": p}
        for s in steps:
            registry[f"TGA-STEP-{s['step_index']}"] = {"label": s["label"], "value": s}
        registry["TGA-RESIDUE"] = {"label": "최종 잔류율", "value": res}

    return registry


def generate_rule_based_fallback_summary(instrument: str, analysis: dict[str, Any]) -> dict[str, Any]:
    """High-quality rule-based technical summary when Gemini API is unconfigured."""
    inst = instrument.lower()
    facts: list[dict[str, str]] = []
    hyps: list[dict[str, Any]] = []
    checks: list[str] = []
    next_exps: list[str] = []
    limits: list[str] = []

    if inst == "ftir":
        peaks = analysis.get("peaks", [])
        fringes = analysis.get("fringes", {})
        exec_sum = f"FT-IR 스펙트럼 분석 결과 총 {len(peaks)}개의 유효 흡수 피크가 검출되었습니다."
        if fringes.get("physical_thickness_um"):
            exec_sum += f" 투과 간섭무늬(Interference Fringes, m={fringes.get('m_interval_count')}개 간격) 분석을 통해 박막의 물리적 두께는 약 {fringes['physical_thickness_um']:.2f} μm (굴절률 n={fringes.get('refractive_index')})로 산출되었습니다."
        facts.append({"statement": f"파수 4000~400 cm⁻¹ 영역에서 {len(peaks)}개의 특징 밴드 검출", "evidence_id": "FTIR-PEAK-COUNT"})
        checks.append("대기 중 이산화탄소(2349 cm⁻¹) 및 수분 흡습 밴드(3300 cm⁻¹ 부근) 영향 여부 확인")
        next_exps.append("미지 시료 구조 확정을 위한 XRD 회절 패턴 및 고해상도 NMR/GPC 상호 교차 검증")
        limits.append("FT-IR 단독 분석만으로는 화학 구조의 결합 유형만 확인 가능하며 분자량이나 3차원 입체 형태를 확정할 수 없습니다.")

    elif inst == "dsc":
        trans = analysis.get("transitions", {})
        tm = trans.get("melting", {})
        tc = trans.get("crystallization", {})
        tg = trans.get("glass_transition", {})
        xc = trans.get("crystallinity", {})

        parts = []
        if tg.get("tg_midpoint_c"):
            parts.append(f"유리전이온도(Tg) {tg['tg_midpoint_c']}°C")
            facts.append({"statement": f"열유속 미분 변곡점 기준 Tg = {tg['tg_midpoint_c']}°C", "evidence_id": "DSC-TG"})
        if tm.get("tm_peak_c"):
            parts.append(f"용융피크(Tm) {tm['tm_peak_c']}°C (엔탈피 {tm.get('delta_h_m_J_per_g')} J/g)")
            facts.append({"statement": f"가열 단계 흡열 용융 피크 Tm = {tm['tm_peak_c']}°C", "evidence_id": "DSC-TM"})
        if tc.get("tc_peak_c"):
            parts.append(f"냉각 결정화(Tc) {tc['tc_peak_c']}°C (엔탈피 {tc.get('delta_h_c_J_per_g')} J/g)")
            facts.append({"statement": f"냉각 단계 발열 결정화 피크 Tc = {tc['tc_peak_c']}°C", "evidence_id": "DSC-TC"})

        exec_sum = f"DSC 열특성 분석 결과: {', '.join(parts)}가 명확하게 관찰되었습니다."
        if xc.get("crystallinity_pct") is not None:
            exec_sum += f" 기준 100% 용융 엔탈피(ΔHm° = {xc.get('standard_melting_enthalpy_J_per_g')} J/g) 기준 결정화도는 {xc['crystallinity_pct']}%로 계산되었습니다."
            facts.append({"statement": f"조건부 결정화도 Xc = {xc['crystallinity_pct']}%", "evidence_id": "DSC-XC"})

        checks.append("1차 승온 이력(열이력 잔류)과 2차 승온 이력 간의 전이 피크 선폭 및 엔탈피 차이 비교 검토")
        next_exps.append("고온 분해 거동 파악을 위한 TGA 열중량 연계 분석 및 동적 점탄성(DMA) 측정")
        limits.append("DSC는 전체 시료의 평균 열 흐름만을 감지하므로 미세영역의 국소 상 분리나 결정립계 거동을 직접 시각화할 수 없습니다.")

    else:
        decomp = analysis.get("decomposition_characteristics", {})
        res = analysis.get("residual", {})
        steps = analysis.get("steps", [])

        exec_sum = f"TGA 열분해 분석 결과, 5% 질량 감소 온도 T₅ = {decomp.get('T5_c', '미도달')}°C, 10% 감소 온도 T₁₀ = {decomp.get('T10_c', '미도달')}°C로 측정되었습니다. 총 {len(steps)}단계의 질량 감소 구간이 확인되었으며, 측정 종료 시점 잔류율은 {res.get('final_residual_pct', '-')}%입니다."
        if decomp.get("T5_c"):
            facts.append({"statement": f"초기 5% 분해 도달 온도 T5 = {decomp['T5_c']}°C", "evidence_id": "TGA-T5"})
        for s in steps:
            facts.append({"statement": f"{s['label']}: 온도 {s['temperature_range_c'][0]}~{s['temperature_range_c'][1]}°C, 감량 {s['mass_loss_pct']}%", "evidence_id": f"TGA-STEP-{s['step_index']}"})

        checks.append("분위기 전환(불활성 N2 -> 산화 Air) 조건에 따른 탄소계 카본블랙 및 탄화 잔류물의 연소 거동 분리 확인")
        next_exps.append("열분해 기체 생성물 조성을 실시간 규명하기 위한 TGA-FTIR / TGA-MS 연계 장비 측정")
        limits.append("TGA는 총 질량 변화율만을 감지하므로 방출 가스의 화학종이나 잔류물의 결정 구조를 단독으로 동정할 수 없습니다.")

    return {
        "status": "completed",
        "model_name": "rule-based-engine",
        "prompt_version": "matlens-spectro-rule-v1.0",
        "schema_valid": True,
        "report": {
            "executive_summary": exec_sum,
            "observed_facts": facts,
            "physical_interpretations": hyps,
            "discrepancies_and_checks": checks,
            "next_experiments": next_exps,
            "limitations": limits,
        },
    }


def generate_spectro_gemini_interpretation(
    instrument: str,
    analysis_result: dict[str, Any],
    file_name: str = "spectro_data",
    override_model: str | None = None,
    user_notes: str | None = None,
) -> dict[str, Any]:
    """Execute Gemini AI structured interpretation for FT-IR, DSC, or TGA."""
    api_key = get_gemini_api_key()
    if not api_key:
        fallback = generate_rule_based_fallback_summary(instrument, analysis_result)
        fallback["error_message"] = "Gemini API 키가 설정되지 않아 규칙 기반(Rule-based) 과학적 요약 리포트를 제공합니다."
        return fallback

    evidence_registry = build_spectro_evidence_registry(instrument, analysis_result)
    preferred_model = (override_model or get_gemini_model() or "auto").strip()

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)

        prompt_payload = {
            "instrument": instrument.upper(),
            "filename": file_name,
            "evidence_registry": evidence_registry,
            "analysis_metadata": {
                "status": analysis_result.get("status"),
                "warnings": analysis_result.get("warnings", []),
            },
        }

        user_content = (
            f"아래 {instrument.upper()} 분석 장비의 파이썬 수치 계산 결과(evidence_registry)만을 바탕으로 "
            "엄격한 JSON 스키마에 맞춰 과학적 종합 분석 리포트를 작성하십시오.\n\n"
            + json.dumps(prompt_payload, ensure_ascii=False, indent=2)
        )

        cfg = types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            response_mime_type="application/json",
            response_schema=SpectroAIReportSchema,
            temperature=0.15,
        )

        candidate_models: list[str] = []
        if preferred_model and preferred_model.lower() != "auto":
            candidate_models.append(preferred_model)
        for fb in GEMINI_FALLBACK_ORDER:
            if fb not in candidate_models:
                candidate_models.append(fb)

        raw_json_text = None
        used_model = candidate_models[0]
        for m_name in candidate_models:
            try:
                resp = client.models.generate_content(model=m_name, contents=user_content, config=cfg)
                raw_json_text = resp.text
                used_model = m_name
                if raw_json_text:
                    break
            except Exception:
                continue

        if not raw_json_text:
            fallback = generate_rule_based_fallback_summary(instrument, analysis_result)
            fallback["error_message"] = "Gemini API 응답을 받지 못하여 규칙 기반 요약으로 대체했습니다."
            return fallback

        parsed = SpectroAIReportSchema.model_validate_json(raw_json_text)
        return {
            "status": "completed",
            "model_name": used_model,
            "prompt_version": "matlens-spectro-gemini-v1.0",
            "schema_valid": True,
            "report": parsed.model_dump(),
            "created_at": utc_now_iso(),
        }

    except Exception as e:
        fallback = generate_rule_based_fallback_summary(instrument, analysis_result)
        fallback["error_message"] = f"Gemini API 호출 중 오류 발생 ({e}). 규칙 기반 요약으로 안전하게 대체했습니다."
        return fallback


run_spectro_ai_interpretation = generate_spectro_gemini_interpretation

