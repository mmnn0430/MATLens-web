"""Cross-Instrument Integrated Analysis Engine for MatLens 2.0.

Integrates:
- XRD: Crystal structure, phase identification, lattice parameters / peak shift, Scherrer crystallite size
- SEM: Microstructure, grain/particle size, morphology, porosity
- UTM: Elastic modulus, yield strength, ultimate tensile strength, elongation
- Hall Effect: Carrier concentration, carrier mobility, electrical conductivity, carrier type
- LFA: Thermal diffusivity, density, specific heat, thermal conductivity (only when density & Cp are confirmed!)

Strictly enforces scientific integrity rules:
1. Verifies sample linkage criteria (Sample ID, composition, processing condition, measurement temperature)
   and distinguishes Same Specimen vs Connected Series vs Unverified/Mismatched Data.
2. Separates Measured Facts (측정 사실), Calculated Results (계산 결과), and Interpretation Hypotheses (해석 가설).
3. Never fabricates LFA thermal conductivity (kappa) if density (rho) or specific heat (Cp) is missing.
4. Never claims statistical correlation or general trends from a single specimen (N=1), and never asserts causation from correlation alone.
5. Generates a complete, readable 5-stage report (핵심 요약 → 측정 데이터 현황 → 주요 지표 → 통합 분석 → 한계 및 추가 실험)
   even when only a subset of instruments is available.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

# Physical constants
SOMMERFELD_LORENZ_NUMBER = 2.44e-8  # W * Ohm / K^2 (V^2 / K^2)


class IntegratedAnalysisResult:
    def __init__(
        self,
        sample_id: str,
        material_name: str,
        instruments_included: List[str],
        wiedemann_franz: Optional[Dict[str, Any]] = None,
        xrd_sem_correlation: Optional[Dict[str, Any]] = None,
        sem_hall_correlation: Optional[Dict[str, Any]] = None,
        sem_lfa_correlation: Optional[Dict[str, Any]] = None,
        xrd_hall_correlation: Optional[Dict[str, Any]] = None,
        xrd_utm_correlation: Optional[Dict[str, Any]] = None,
        ftir_xrd_correlation: Optional[Dict[str, Any]] = None,
        dsc_xrd_correlation: Optional[Dict[str, Any]] = None,
        tga_dsc_correlation: Optional[Dict[str, Any]] = None,
        synthesis_to_properties_chain: Optional[List[Dict[str, Any]]] = None,
        grounded_claims: Optional[List[Dict[str, Any]]] = None,
        warnings: Optional[List[str]] = None,
        notes: Optional[List[str]] = None,
        # New structured 5-section readability fields
        executive_summary_items: Optional[List[Dict[str, Any]]] = None,
        linkage_assessment: Optional[Dict[str, Any]] = None,
        instrument_availability: Optional[List[Dict[str, Any]]] = None,
        key_metrics_table: Optional[List[Dict[str, Any]]] = None,
        cross_correlations: Optional[List[Dict[str, Any]]] = None,
        limitations_and_next_actions: Optional[Dict[str, Any]] = None,
        report_title: Optional[str] = None,
    ):
        self.sample_id = sample_id
        self.material_name = material_name
        self.instruments_included = instruments_included
        self.wiedemann_franz = wiedemann_franz
        self.xrd_sem_correlation = xrd_sem_correlation
        self.sem_hall_correlation = sem_hall_correlation
        self.sem_lfa_correlation = sem_lfa_correlation
        self.xrd_hall_correlation = xrd_hall_correlation
        self.xrd_utm_correlation = xrd_utm_correlation
        self.ftir_xrd_correlation = ftir_xrd_correlation
        self.dsc_xrd_correlation = dsc_xrd_correlation
        self.tga_dsc_correlation = tga_dsc_correlation
        self.synthesis_to_properties_chain = synthesis_to_properties_chain or []
        self.grounded_claims = grounded_claims or []
        self.warnings = warnings or []
        self.notes = notes or []
        self.executive_summary_items = executive_summary_items or []
        self.linkage_assessment = linkage_assessment or {}
        self.instrument_availability = instrument_availability or []
        self.key_metrics_table = key_metrics_table or []
        self.cross_correlations = cross_correlations or []
        self.limitations_and_next_actions = limitations_and_next_actions or {}
        self.report_title = report_title or f"{sample_id} — {' · '.join(instruments_included) or '통합'} 정밀 분석 리포트"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "sample_id": self.sample_id,
            "material_name": self.material_name,
            "report_title": self.report_title,
            "instruments_included": self.instruments_included,
            "wiedemann_franz": self.wiedemann_franz,
            "xrd_sem_correlation": self.xrd_sem_correlation,
            "sem_hall_correlation": self.sem_hall_correlation,
            "sem_lfa_correlation": self.sem_lfa_correlation,
            "xrd_hall_correlation": self.xrd_hall_correlation,
            "xrd_utm_correlation": self.xrd_utm_correlation,
            "ftir_xrd_correlation": self.ftir_xrd_correlation,
            "dsc_xrd_correlation": self.dsc_xrd_correlation,
            "tga_dsc_correlation": self.tga_dsc_correlation,
            "synthesis_to_properties_chain": self.synthesis_to_properties_chain,
            "grounded_claims": self.grounded_claims,
            "warnings": self.warnings,
            "notes": self.notes,
            "executive_summary_items": self.executive_summary_items,
            "linkage_assessment": self.linkage_assessment,
            "instrument_availability": self.instrument_availability,
            "key_metrics_table": self.key_metrics_table,
            "cross_correlations": self.cross_correlations,
            "limitations_and_next_actions": self.limitations_and_next_actions,
        }


def compute_wiedemann_franz(
    electrical_conductivity_S_m: float,
    total_thermal_conductivity_W_mK: float,
    temperature_K: float = 300.0,
    lorenz_number: float = SOMMERFELD_LORENZ_NUMBER,
) -> Dict[str, Any]:
    """Evaluates the Wiedemann-Franz Law:
        kappa_e = L * sigma * T
        kappa_L = kappa_total - kappa_e
    """
    kappa_e = lorenz_number * electrical_conductivity_S_m * temperature_K
    kappa_L = total_thermal_conductivity_W_mK - kappa_e

    electronic_fraction_pct = (
        (kappa_e / total_thermal_conductivity_W_mK) * 100.0
        if total_thermal_conductivity_W_mK > 0
        else 0.0
    )
    lattice_fraction_pct = (
        (kappa_L / total_thermal_conductivity_W_mK) * 100.0
        if total_thermal_conductivity_W_mK > 0
        else 100.0
    )

    dominant_mechanism = (
        "Lattice-dominated (Phonon transport)"
        if lattice_fraction_pct >= 50.0
        else "Carrier-dominated (Electronic transport)"
    )

    warnings: List[str] = []
    if kappa_L < 0:
        warnings.append(
            "Calculated lattice thermal conductivity kappa_L is negative! The standard Sommerfeld Lorenz number (2.44e-8) "
            "may overestimate electronic transport in this material. Non-degenerate band or bipolar conduction correction required."
        )

    return {
        "temperature_K": temperature_K,
        "lorenz_number_W_Ohm_K2": lorenz_number,
        "is_sommerfeld_limit": lorenz_number == SOMMERFELD_LORENZ_NUMBER,
        "total_thermal_conductivity_W_mK": round(total_thermal_conductivity_W_mK, 3),
        "electronic_thermal_conductivity_W_mK": round(max(0.0, kappa_e), 3),
        "lattice_thermal_conductivity_W_mK": round(max(0.0, kappa_L), 3),
        "electronic_fraction_pct": round(electronic_fraction_pct, 1),
        "lattice_fraction_pct": round(lattice_fraction_pct, 1),
        "dominant_mechanism": dominant_mechanism,
        "warnings": warnings,
    }


def _assess_data_linkage(
    sample_id: str,
    material_name: str,
    temperature_K: float,
    xrd_data: Optional[Dict[str, Any]],
    sem_data: Optional[Dict[str, Any]],
    utm_data: Optional[Dict[str, Any]],
    hall_data: Optional[Dict[str, Any]],
    lfa_data: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Check how the instrument datasets are linked by Sample ID, composition, process condition, and temperature."""
    provided_sources: List[Dict[str, Any]] = []
    for inst_name, d in [
        ("XRD", xrd_data),
        ("SEM", sem_data),
        ("UTM", utm_data),
        ("Hall", hall_data),
        ("LFA", lfa_data),
    ]:
        if not d:
            continue
        sid = d.get("sample_id") or sample_id
        comp = d.get("chemical_composition") or d.get("formula") or material_name
        proc = d.get("process_condition") or d.get("process") or "표준 공정 조건"
        temp_k = d.get("temperature_K") or (
            round(float(d["temperature_C"]) + 273.15, 1)
            if d.get("temperature_C") is not None
            else temperature_K
        )
        is_demo = bool(d.get("is_sample_demo", True))
        provided_sources.append(
            {
                "instrument": inst_name,
                "sample_id": str(sid),
                "composition": str(comp),
                "process_condition": str(proc),
                "temperature_K": float(temp_k),
                "is_sample_demo": is_demo,
                "source_file": d.get("source_file") or f"{inst_name} 측정 데이터",
            }
        )

    unique_sids = {s["sample_id"].strip() for s in provided_sources if s["sample_id"].strip()}
    unique_comps = {
        s["composition"].strip().upper()
        for s in provided_sources
        if s["composition"].strip()
    }
    temps = [s["temperature_K"] for s in provided_sources]
    max_temp_diff = (max(temps) - min(temps)) if len(temps) >= 2 else 0.0

    mismatches: List[str] = []
    if len(unique_comps) > 1:
        mismatches.append(
            f"측정 항목 간 화학 조성/재료명 불일치 감지 ({', '.join(sorted(unique_comps))}) — 연결 근거가 불분명한 이종 재료 데이터를 임의로 합쳐 인과 해석하지 마십시오."
        )
    if len(unique_sids) > 1 and len(unique_comps) <= 1:
        mismatches.append(
            f"시료 ID가 서로 다름 ({', '.join(sorted(unique_sids))}) — 동일 단일 시편이 아닌 ‘동일 조성 시리즈 내 별도 시편’ 간 비교로 해석합니다."
        )
    if max_temp_diff > 25.0:
        mismatches.append(
            f"측정 온도 차이 감지 (최대 ΔT = {max_temp_diff:.1f} K) — 온도에 민감한 전기·열 수송(Wiedemann–Franz 등) 비교 시 온도 차이를 감안해야 합니다."
        )

    if len(unique_comps) > 1:
        linkage_mode = "unverified_mismatch"
        linkage_badge = "연결 기준 불일치 (이종 시료 경고)"
        linkage_summary = "선택된 측정 데이터 간 재료/조성이 서로 달라 교차 인과 해석이 제한됩니다. 동일 시편 또는 동일 시리즈 데이터인지 확인해 주세요."
    elif len(unique_sids) > 1:
        linkage_mode = "connected_series"
        linkage_badge = "동일 시리즈 내 연결 시편"
        linkage_summary = f"동일 모재/조성({material_name}) 시리즈 내 시편({', '.join(sorted(unique_sids))}) 데이터가 조성·공정·온도 기준으로 연결되었습니다."
    else:
        linkage_mode = "same_specimen"
        linkage_badge = "동일 샘플 (Single Specimen, N=1)"
        linkage_summary = f"샘플 ID({sample_id}), 조성({material_name}), 측정 온도({temperature_K:.0f} K) 기준으로 동일 시편의 다종 측정 데이터가 연결되었습니다."

    return {
        "linkage_mode": linkage_mode,
        "linkage_badge": linkage_badge,
        "linkage_summary": linkage_summary,
        "sample_count_n": 1 if len(unique_sids) <= 1 else len(unique_sids),
        "is_single_sample": len(unique_sids) <= 1,
        "criteria_checked": [
            f"샘플 ID: {', '.join(sorted(unique_sids)) or sample_id}",
            f"화학 조성 / 재료명: {material_name}",
            f"측정 온도: {temperature_K:.0f} K ({temperature_K - 273.15:.1f} °C)",
            f"참여 장비 수: {len(provided_sources)}종 ({', '.join(s['instrument'] for s in provided_sources) or '없음'})",
        ],
        "mismatches": mismatches,
        "sources": provided_sources,
    }


def perform_cross_instrument_analysis(
    sample_id: str,
    material_name: str,
    xrd_data: Optional[Dict[str, Any]] = None,
    sem_data: Optional[Dict[str, Any]] = None,
    hall_data: Optional[Dict[str, Any]] = None,
    lfa_data: Optional[Dict[str, Any]] = None,
    utm_data: Optional[Dict[str, Any]] = None,
    ftir_data: Optional[Dict[str, Any]] = None,
    dsc_data: Optional[Dict[str, Any]] = None,
    tga_data: Optional[Dict[str, Any]] = None,
    temperature_K: float = 300.0,
    selected_instruments: Optional[List[str]] = None,
) -> IntegratedAnalysisResult:
    """Executes holistic multi-instrument materials analysis across XRD, SEM, UTM, Hall, LFA, FT-IR, DSC, and TGA."""
    sel_norm = [s.lower().replace("-", "").strip() for s in selected_instruments] if selected_instruments else None

    def _is_sel(inst_code: str) -> bool:
        if sel_norm is None:
            return True
        return inst_code.lower().replace("-", "").strip() in sel_norm

    instruments: List[str] = []
    claims: List[Dict[str, Any]] = []
    warnings: List[str] = []
    notes: List[str] = []

    # Filter data strictly if instrument not in selected_instruments
    eff_xrd = xrd_data if _is_sel("xrd") else None
    eff_sem = sem_data if _is_sel("sem") else None
    eff_utm = utm_data if _is_sel("utm") else None
    eff_hall = hall_data if _is_sel("hall") else None
    eff_lfa = lfa_data if _is_sel("lfa") else None
    eff_ftir = ftir_data if _is_sel("ftir") else None
    eff_dsc = dsc_data if _is_sel("dsc") else None
    eff_tga = tga_data if _is_sel("tga") else None

    if eff_xrd:
        instruments.append("XRD")
    if eff_sem:
        instruments.append("SEM")
    if eff_utm:
        instruments.append("UTM")
    if eff_hall:
        instruments.append("Hall")
    if eff_lfa:
        instruments.append("LFA")
    if eff_ftir:
        instruments.append("FT-IR")
    if eff_dsc:
        instruments.append("DSC")
    if eff_tga:
        instruments.append("TGA")

    linkage = _assess_data_linkage(
        sample_id=sample_id,
        material_name=material_name,
        temperature_K=temperature_K,
        xrd_data=eff_xrd,
        sem_data=eff_sem,
        utm_data=eff_utm,
        hall_data=eff_hall,
        lfa_data=eff_lfa,
    )
    warnings.extend(linkage.get("mismatches", []))

    # Validate LFA density & Cp requirement before computing or trusting thermal_conductivity_W_mK
    lfa_alpha = eff_lfa.get("thermal_diffusivity_mm2_s") if eff_lfa else None
    lfa_rho = eff_lfa.get("density_g_cm3") if eff_lfa else None
    lfa_cp = eff_lfa.get("specific_heat_J_gK") if eff_lfa else None
    lfa_has_rho_cp = bool(
        lfa_rho is not None
        and float(lfa_rho) > 0
        and lfa_cp is not None
        and float(lfa_cp) > 0
    )

    lfa_kappa: Optional[float] = None
    if eff_lfa:
        if lfa_has_rho_cp and lfa_alpha is not None and float(lfa_alpha) > 0:
            computed_k = float(lfa_alpha) * float(lfa_rho) * float(lfa_cp)
            provided_k = eff_lfa.get("thermal_conductivity_W_mK")
            lfa_kappa = round(float(provided_k) if provided_k is not None else computed_k, 3)
        elif eff_lfa.get("thermal_conductivity_W_mK") is not None and lfa_rho is None and lfa_cp is None:
            if "density_g_cm3" not in eff_lfa and "specific_heat_J_gK" not in eff_lfa:
                lfa_kappa = round(float(eff_lfa["thermal_conductivity_W_mK"]), 3)
            else:
                lfa_kappa = None
                warnings.append(
                    "LFA 열전도도(κ) 계산 보류: 시편 밀도(ρ) 또는 비열(Cp) 필수 값이 확인되지 않아 열확산도(α)만 표시하고 임의로 열전도도를 계산하지 않았습니다."
                )
        else:
            lfa_kappa = None
            warnings.append(
                "LFA 열전도도(κ) 계산 보류: 열확산도(α)로부터 열전도도(κ = α·ρ·Cp)를 계산하기 위한 필수 입력값(밀도 ρ 및 비열 Cp)이 누락되어 임의 계산을 중단했습니다."
            )

    # 1. Hall + LFA (Wiedemann-Franz Law) — ONLY if both Hall conductivity and valid LFA kappa exist
    wf_result = None
    if eff_hall and eff_lfa and lfa_kappa is not None and linkage["linkage_mode"] != "unverified_mismatch":
        cond_S_cm = eff_hall.get("electrical_conductivity_S_cm")
        if cond_S_cm is not None and float(cond_S_cm) > 0:
            cond_S_m = float(cond_S_cm) * 100.0
            wf_result = compute_wiedemann_franz(
                electrical_conductivity_S_m=cond_S_m,
                total_thermal_conductivity_W_mK=lfa_kappa,
                temperature_K=temperature_K,
            )
            warnings.extend(wf_result.get("warnings", []))
            claims.append(
                {
                    "claim_text": (
                        f"Wiedemann-Franz separation indicates {wf_result['dominant_mechanism']} with "
                        f"kappa_L = {wf_result['lattice_thermal_conductivity_W_mK']} W/(m*K) ({wf_result['lattice_fraction_pct']}%) and "
                        f"kappa_e = {wf_result['electronic_thermal_conductivity_W_mK']} W/(m*K) ({wf_result['electronic_fraction_pct']}%)."
                    ),
                    "category": "Calculated Result",
                    "confidence": "High",
                    "limitation_note": "Assumes standard Sommerfeld Lorenz number (2.44e-8 W*Ohm/K^2) at matching temperature.",
                }
            )

    # 2. XRD + SEM Correlation (Crystallite size vs Grain size)
    xrd_sem_corr = None
    if eff_xrd and eff_sem:
        crystallite_nm = eff_xrd.get("scherrer_crystallite_size_nm") or eff_xrd.get("crystallite_size_nm")
        grain_size_um = eff_sem.get("mean_intercept_length_um") or eff_sem.get("grain_size_um")
        xrd_sem_corr = {
            "scherrer_crystallite_size_nm": crystallite_nm,
            "sem_grain_size_um": grain_size_um,
            "conceptual_distinction": "Scherrer size reflects coherent X-ray scattering sub-domains; SEM grain size reflects physical grain boundary dimensions.",
            "interpretation": (
                f"XRD 결맞음 회절 도메인 크기({crystallite_nm} nm)와 SEM 2D 결정립/입자 크기({grain_size_um} µm)는 서로 다른 물리량입니다. "
                "하나의 SEM 결정립 내부에 소각 결정립계나 전위 셀로 나뉜 여러 결맞음 회절 도메인이 포함될 수 있습니다."
            )
            if crystallite_nm and grain_size_um
            else "XRD 결정구조와 SEM 미세조직 데이터가 함께 기록되었습니다.",
        }
        claims.append(
            {
                "claim_text": xrd_sem_corr["conceptual_distinction"],
                "category": "Literature-Supported",
                "confidence": "High",
            }
        )

    # 3. XRD / SEM + UTM Correlation (Structure & Microstructure <-> Mechanical Properties)
    xrd_utm_corr = None
    if eff_utm and (eff_xrd or eff_sem):
        uts_mpa = eff_utm.get("tensile_strength_MPa") or eff_utm.get("uts_MPa")
        ys_mpa = eff_utm.get("yield_strength_MPa")
        e_gpa = eff_utm.get("elastic_modulus_GPa")
        elong_pct = eff_utm.get("elongation_pct")
        phase_str = (eff_xrd or {}).get("primary_phase") or (eff_xrd or {}).get("space_group") or material_name
        crystallite_nm = (eff_xrd or {}).get("crystallite_size_nm") or (eff_xrd or {}).get("scherrer_crystallite_size_nm")
        grain_um = (eff_sem or {}).get("grain_size_um")
        porosity_pct = (eff_sem or {}).get("porosity_pct")

        xrd_utm_corr = {
            "primary_phase_or_structure": phase_str,
            "crystallite_size_nm": crystallite_nm,
            "sem_grain_size_um": grain_um,
            "porosity_pct": porosity_pct,
            "tensile_strength_MPa": uts_mpa,
            "yield_strength_MPa": ys_mpa,
            "elastic_modulus_GPa": e_gpa,
            "elongation_pct": elong_pct,
            "mechanism_hypothesis": (
                "결정구조의 화학결합 강성이 탄성계수(E)의 상한을 결정하며, 결정립계 밀도(Hall–Petch 관계)와 기공·이차상 분포가 항복강도 및 파단 연신율에 영향을 줄 수 있습니다."
            ),
            "caution": "단일 시편 데이터만으로 결정자 크기와 강도 간의 통계적 상관관계나 인과관계를 단정할 수 없으며, 시편 치수·기공률·하중축 배향 효과를 함께 확인해야 합니다.",
        }
        claims.append(
            {
                "claim_text": xrd_utm_corr["mechanism_hypothesis"],
                "category": "Hypothesis",
                "confidence": "Moderate",
                "limitation_note": xrd_utm_corr["caution"],
            }
        )

    # 4. XRD + Hall Correlation (Crystal Structure / Doping <-> Electrical Transport)
    xrd_hall_corr = None
    if eff_xrd and eff_hall:
        phase_str = eff_xrd.get("primary_phase") or eff_xrd.get("space_group") or material_name
        peak_shift = eff_xrd.get("peak_shift_deg")
        n_cm3 = eff_hall.get("carrier_concentration_cm3")
        mob = eff_hall.get("hall_mobility_cm2_Vs")
        ctype = eff_hall.get("carrier_type")
        xrd_hall_corr = {
            "structure": phase_str,
            "peak_shift_deg": peak_shift,
            "carrier_type": ctype,
            "carrier_concentration_cm3": n_cm3,
            "hall_mobility_cm2_Vs": mob,
            "hypothesis": (
                "XRD에서 확인된 주상 결정구조 및 도펀트 고용(격자 피크 이동)은 Hall 측정의 유효 캐리어 농도 발현과 연결될 수 있으며, "
                "잔류 결함·이차상 산란이 이동도(µ_H)를 제한할 가능성이 있습니다."
            ),
        }

    # 5. SEM + Hall Correlation (Grain Boundary Carrier Scattering)
    sem_hall_corr = None
    if eff_sem and eff_hall:
        grain_size_um = eff_sem.get("mean_intercept_length_um") or eff_sem.get("grain_size_um")
        mobility = eff_hall.get("hall_mobility_cm2_Vs")
        sem_hall_corr = {
            "sem_grain_size_um": grain_size_um,
            "hall_mobility_cm2_Vs": mobility,
            "scattering_hypothesis": "If mobility is suppressed in fine-grained specimens, Petritz grain-boundary potential barrier scattering is a likely contributor.",
            "test_recommendation": "Confirm by temperature-dependent Hall mobility: grain-boundary scattering exhibits activated behavior (mu ~ exp(-E_B / kT)) at low-to-moderate T.",
        }
        claims.append(
            {
                "claim_text": sem_hall_corr["scattering_hypothesis"],
                "category": "Hypothesis",
                "confidence": "Moderate",
                "limitation_note": "Grain boundary scattering must be verified by temperature-dependent Hall measurements.",
            }
        )

    # 6. SEM + LFA Correlation (Grain Boundary Phonon Scattering & Porosity)
    sem_lfa_corr = None
    if eff_sem and eff_lfa:
        porosity_pct = float(eff_sem.get("porosity_pct") or 0.0)
        diffusivity = lfa_alpha
        sem_lfa_corr = {
            "porosity_pct": porosity_pct,
            "thermal_diffusivity_mm2_s": diffusivity,
            "model": "Maxwell-Eucken Porosity Correction: kappa_eff = kappa_dense * (1 - 1.5 * porosity)",
            "interpretation": f"Observed microstructural porosity ({porosity_pct:.1f}%) introduces acoustic impedance mismatch, scattering low-frequency phonons.",
        }
        claims.append(
            {
                "claim_text": sem_lfa_corr["interpretation"],
                "category": "Literature-Supported" if porosity_pct > 0 else "Calculated Result",
                "confidence": "Moderate",
            }
        )

    # 7. FT-IR + XRD Correlation
    ftir_xrd_corr = None
    if eff_ftir and eff_xrd:
        peaks_cnt = len(eff_ftir.get("detected_peaks") or [])
        ftir_xrd_corr = {
            "xrd_phase": eff_xrd.get("primary_phase") or material_name,
            "ftir_detected_peaks_count": peaks_cnt,
            "interpretation": (
                "XRD로 판별된 결정 격자의 대칭성과 FT-IR에서 관찰된 분자 진동 흡수 피크를 상호 대조하여, "
                "결정 내부 결합(무기 격자)과 표면 유기 작용기/리간드의 공존 상태를 상호 보완적으로 해석합니다."
            ),
        }

    # 8. DSC + XRD Correlation
    dsc_xrd_corr = None
    if eff_dsc and eff_xrd:
        tm_c = eff_dsc.get("melting_temp_C") or (eff_dsc.get("thermal_events") or {}).get("melting_peak_C")
        dsc_xrd_corr = {
            "xrd_spacegroup": eff_xrd.get("space_group"),
            "dsc_melting_temp_C": tm_c,
            "interpretation": (
                "XRD 회절선의 결정도(Crystallinity) 및 격자 안정성과 DSC의 상전이·융점(Tm) 거동을 연계하여 "
                "열역학적 상전이 거동을 결정학적 결정 구조와 교차 검증합니다."
            ),
        }

    # 9. TGA + DSC Correlation
    tga_dsc_corr = None
    if eff_tga and eff_dsc:
        t_onset = eff_tga.get("onset_temp_C") or eff_tga.get("t_onset_C")
        t_res = eff_tga.get("final_residue_pct") or eff_tga.get("residue_pct")
        tga_dsc_corr = {
            "tga_onset_temp_C": t_onset,
            "tga_residue_pct": t_res,
            "interpretation": (
                "TGA 질량 감량 곡선과 DSC 열류량 곡선을 결합하여, 질량 변화 없는 순수 물리적 상전이(용융 등)와 "
                "질량 감소를 동반하는 열분해/증발 반응을 명확히 분리하여 해석합니다."
            ),
        }

    # -------------------------------------------------------------------------
    # Build 5-Part Readability Report Structure
    # -------------------------------------------------------------------------
    # Part 2: Instrument Availability Status Table
    all_instrument_descriptors: List[Dict[str, Any]] = [
        {
            "instrument": "XRD",
            "label": "XRD (결정구조 · 상 분석)",
            "available": eff_xrd is not None,
            "status_badge": "분석 가능" if eff_xrd else "데이터 미입력",
            "data_source_badge": (
                "예시/검증 데이터"
                if (eff_xrd and eff_xrd.get("is_sample_demo", True))
                else ("실제 측정 데이터" if eff_xrd else "-")
            ),
            "summary": (
                f"주상 {eff_xrd.get('primary_phase') or material_name} ({eff_xrd.get('space_group') or '-'}), "
                f"결정자 크기 D = {eff_xrd.get('crystallite_size_nm') or eff_xrd.get('scherrer_crystallite_size_nm') or '-'} nm"
            )
            if eff_xrd
            else "XRD 회절 데이터가 없습니다.",
            "missing_impact": (
                None
                if eff_xrd
                else "결정상 동정, 공간군, 격자상수 변화 및 결정자 크기(Scherrer)에 기반한 구조적 원인 해석이 제한됩니다."
            ),
        },
        {
            "instrument": "SEM",
            "label": "SEM (미세조직 · 입경 · 기공률)",
            "available": eff_sem is not None,
            "status_badge": "분석 가능" if eff_sem else "데이터 미입력",
            "data_source_badge": (
                "예시/검증 데이터"
                if (eff_sem and eff_sem.get("is_sample_demo", True))
                else ("실제 측정 데이터" if eff_sem else "-")
            ),
            "summary": (
                f"평균 결정립/입자 크기 {eff_sem.get('grain_size_um') or '-'} µm, "
                f"기공률 {eff_sem.get('porosity_pct') if eff_sem.get('porosity_pct') is not None else '-'}%"
            )
            if eff_sem
            else "SEM 미세조직 데이터가 없습니다.",
            "missing_impact": (
                None
                if eff_sem
                else "결정립 크기(2D 투영) 및 기공 분포와 기계·전기·열 특성 간의 미세조직 연계 검증이 제한됩니다."
            ),
        },
        {
            "instrument": "UTM",
            "label": "UTM (기계적 인장·강도 특성)",
            "available": eff_utm is not None,
            "status_badge": "분석 가능" if eff_utm else "데이터 미입력",
            "data_source_badge": (
                "예시/검증 데이터"
                if (eff_utm and eff_utm.get("is_sample_demo", True))
                else ("실제 측정 데이터" if eff_utm else "-")
            ),
            "summary": (
                f"인장강도 {eff_utm.get('tensile_strength_MPa') or '-'} MPa, "
                f"탄성계수 {eff_utm.get('elastic_modulus_GPa') or '-'} GPa, "
                f"연신율 {eff_utm.get('elongation_pct') or '-'}%"
            )
            if eff_utm
            else "UTM 기계적 측정 데이터가 없습니다.",
            "missing_impact": (
                None
                if eff_utm
                else "결정구조·결정립 크기 변화에 따른 강도(인장/항복강도), 탄성계수 및 연신율 연계 해석이 생략됩니다."
            ),
        },
        {
            "instrument": "Hall",
            "label": "Hall Effect (전기적 수송 특성)",
            "available": eff_hall is not None,
            "status_badge": "분석 가능" if eff_hall else "데이터 미입력",
            "data_source_badge": (
                "예시/검증 데이터"
                if (eff_hall and eff_hall.get("is_sample_demo", True))
                else ("실제 측정 데이터" if eff_hall else "-")
            ),
            "summary": (
                f"{eff_hall.get('carrier_type') or '-'}, "
                f"n = {float(eff_hall.get('carrier_concentration_cm3') or 0):.2e} cm⁻³, "
                f"µ_H = {eff_hall.get('hall_mobility_cm2_Vs')} cm²/V·s, "
                f"σ = {eff_hall.get('electrical_conductivity_S_cm')} S/cm"
            )
            if (eff_hall and eff_hall.get("carrier_concentration_cm3") is not None)
            else ("Hall 전기 수송 데이터 입력됨" if eff_hall else "Hall 측정 데이터가 없습니다."),
            "missing_impact": (
                None
                if eff_hall
                else "캐리어 농도·이동도·전기전도도 해석 및 LFA와의 Wiedemann–Franz 전자 열전도도(κ_e) 분리가 불가능합니다."
            ),
        },
        {
            "instrument": "LFA",
            "label": "LFA (열확산도 · 열전도 특성)",
            "available": eff_lfa is not None,
            "status_badge": (
                "분석 가능 (κ 계산 완료)"
                if (eff_lfa and lfa_kappa is not None)
                else ("부분 가능 (α만 확인 · ρ/Cp 미입력)" if eff_lfa else "데이터 미입력")
            ),
            "data_source_badge": (
                "예시/검증 데이터"
                if (eff_lfa and eff_lfa.get("is_sample_demo", True))
                else ("실제 측정 데이터" if eff_lfa else "-")
            ),
            "summary": (
                f"열확산도 α = {lfa_alpha} mm²/s"
                + (
                    f", 열전도도 κ = {lfa_kappa} W/m·K (ρ={lfa_rho} g/cm³, Cp={lfa_cp} J/g·K)"
                    if lfa_kappa is not None
                    else " (밀도 ρ 또는 비열 Cp 미확보로 열전도도 κ 미산출)"
                )
            )
            if eff_lfa
            else "LFA 열물성 데이터가 없습니다.",
            "missing_impact": (
                None
                if (eff_lfa and lfa_kappa is not None)
                else (
                    "밀도(ρ) 또는 비열(Cp)이 없어 열전도도(κ = α·ρ·Cp) 및 Wiedemann–Franz 격자 열전도도(κ_L) 계산을 수행하지 않습니다."
                    if eff_lfa
                    else "열확산도·열전도도 및 포논 산란 연계 해석이 생략됩니다."
                )
            ),
        },
        {
            "instrument": "FT-IR",
            "label": "FT-IR (적외선 분광 · 분자 결합 및 작용기)",
            "available": eff_ftir is not None,
            "status_badge": "분석 가능" if eff_ftir else "데이터 미입력",
            "data_source_badge": (
                "예시/검증 데이터"
                if (eff_ftir and eff_ftir.get("is_sample_demo", True))
                else ("실제 측정 데이터" if eff_ftir else "-")
            ),
            "summary": (
                f"검출 피크 수 {len(eff_ftir.get('detected_peaks') or [])}개, "
                + "주요 결합: "
                + (
                    ", ".join([str(p.get("assignment") or f"{p.get('wavenumber_cm1')} cm⁻¹") for p in (eff_ftir.get("detected_peaks") or [])[:3]])
                    if (eff_ftir.get("detected_peaks"))
                    else "-"
                )
            )
            if eff_ftir
            else "FT-IR 분광 데이터가 없습니다.",
            "missing_impact": (
                None
                if eff_ftir
                else "유기 작용기 및 표면 분자 결합 흡수대 분석이 제외됩니다."
            ),
        },
        {
            "instrument": "DSC",
            "label": "DSC (시차 주사 열량 · 상전이 및 비열)",
            "available": eff_dsc is not None,
            "status_badge": "분석 가능" if eff_dsc else "데이터 미입력",
            "data_source_badge": (
                "예시/검증 데이터"
                if (eff_dsc and eff_dsc.get("is_sample_demo", True))
                else ("실제 측정 데이터" if eff_dsc else "-")
            ),
            "summary": (
                f"융점/상전이 {eff_dsc.get('melting_temp_C') or (eff_dsc.get('thermal_events') or {}).get('melting_peak_C') or '-'} °C, "
                f"엔탈피 {eff_dsc.get('enthalpy_J_g') or '-'} J/g"
            )
            if eff_dsc
            else "DSC 열량 분석 데이터가 없습니다.",
            "missing_impact": (
                None
                if eff_dsc
                else "상전이 온도(Tm, Tg) 및 엔탈피 변화 해석이 제외됩니다."
            ),
        },
        {
            "instrument": "TGA",
            "label": "TGA (열중량 분석 · 열분해 및 잔류량)",
            "available": eff_tga is not None,
            "status_badge": "분석 가능" if eff_tga else "데이터 미입력",
            "data_source_badge": (
                "예시/검증 데이터"
                if (eff_tga and eff_tga.get("is_sample_demo", True))
                else ("실제 측정 데이터" if eff_tga else "-")
            ),
            "summary": (
                f"분해 개시 {eff_tga.get('onset_temp_C') or eff_tga.get('t_onset_C') or '-'} °C, "
                f"최종 잔류량 {eff_tga.get('final_residue_pct') or eff_tga.get('residue_pct') or '-'}%"
            )
            if eff_tga
            else "TGA 열분해 데이터가 없습니다.",
            "missing_impact": (
                None
                if eff_tga
                else "열분해 온도 및 고온 산화/감량 거동 해석이 제외됩니다."
            ),
        },
    ]

    # Filter instrument_availability strictly if selected_instruments was specified,
    # or maintain backward compatibility for legacy 5-instrument tests when FT-IR/DSC/TGA are not provided.
    if selected_instruments is not None:
        instrument_availability: List[Dict[str, Any]] = [
            item for item in all_instrument_descriptors
            if _is_sel(item["instrument"])
        ]
    else:
        instrument_availability = [
            item for item in all_instrument_descriptors
            if item["instrument"] in ["XRD", "SEM", "UTM", "Hall", "LFA"] or (
                (item["instrument"] == "FT-IR" and eff_ftir is not None) or
                (item["instrument"] == "DSC" and eff_dsc is not None) or
                (item["instrument"] == "TGA" and eff_tga is not None)
            )
        ]

    # Part 3: Key Quantitative Metrics Table with plain-Korean explanations
    key_metrics_table: List[Dict[str, Any]] = []
    temp_str = f"{temperature_K:.0f} K ({temperature_K - 273.15:.1f} °C)"

    if eff_xrd:
        if eff_xrd.get("primary_phase") or eff_xrd.get("space_group"):
            key_metrics_table.append(
                {
                    "instrument": "XRD",
                    "metric_name": "주 결정상 및 공간군 (Crystal Phase & Space Group)",
                    "value": f"{eff_xrd.get('primary_phase') or material_name} ({eff_xrd.get('space_group') or '-'})",
                    "unit": "-",
                    "condition": eff_xrd.get("xray_source") or "Cu Kα (λ = 1.5406 Å), 상온",
                    "category": "측정 사실",
                    "source_label": eff_xrd.get("source_file") or "XRD 회절 패턴",
                    "term_explanation": "X선 회절 피크 위치와 상대 강도를 기준 결정 구조와 대조하여 확인한 원자 배열 구조입니다.",
                }
            )
        cryst_val = eff_xrd.get("crystallite_size_nm") or eff_xrd.get("scherrer_crystallite_size_nm")
        if cryst_val is not None:
            key_metrics_table.append(
                {
                    "instrument": "XRD",
                    "metric_name": "Scherrer 결정자 크기 (Coherent Domain Size)",
                    "value": f"{cryst_val}",
                    "unit": "nm",
                    "condition": "K = 0.9, 비겹침 주피크 반가폭(FWHM) 기준",
                    "category": "계산 결과",
                    "source_label": eff_xrd.get("source_file") or "XRD 피크 프로파일 피팅",
                    "term_explanation": "X선이 위상차 없이 결맞게 산란되는 최소 단결정 도메인 크기로, SEM에서 보이는 외형 입자/결정립 크기와는 별개의 물리량입니다.",
                }
            )
        lat_params = eff_xrd.get("lattice_parameters") or eff_xrd.get("lattice_params")
        if lat_params and isinstance(lat_params, dict):
            lat_parts = [
                f"{k} = {v:.4f} Å" if isinstance(v, (int, float)) else f"{k} = {v}"
                for k, v in lat_params.items()
                if k in ["a", "b", "c"]
            ]
            if lat_parts:
                key_metrics_table.append(
                    {
                        "instrument": "XRD",
                        "metric_name": "격자 상수 (Lattice Parameters)",
                        "value": ", ".join(lat_parts),
                        "unit": "Å",
                        "condition": "결정학적 피크 피팅 기반",
                        "category": "계산 결과",
                        "source_label": eff_xrd.get("source_file") or "XRD 회절 패턴",
                        "term_explanation": "단위 격자(Unit Cell)의 축 길이로, 원자 간 결합 거리 및 고용체 치환에 따른 격자 변형을 반영합니다.",
                    }
                )
        peaks = eff_xrd.get("peaks") or []
        if isinstance(peaks, list) and len(peaks) > 0 and isinstance(peaks[0], dict):
            top_p = max(peaks, key=lambda p: float(p.get("intensity") or p.get("height") or 0.0))
            p_pos = top_p.get("two_theta") or top_p.get("position")
            p_fwhm = top_p.get("fwhm")
            if p_pos is not None:
                fwhm_str = f", FWHM = {float(p_fwhm):.3f}°" if p_fwhm is not None else ""
                key_metrics_table.append(
                    {
                        "instrument": "XRD",
                        "metric_name": "최대 회절 피크 위치 및 반가폭 (Peak Position & FWHM)",
                        "value": f"2θ = {float(p_pos):.2f}°{fwhm_str}",
                        "unit": "° (deg)",
                        "condition": eff_xrd.get("xray_source") or "Cu Kα (λ = 1.5406 Å)",
                        "category": "측정 사실",
                        "source_label": eff_xrd.get("source_file") or "XRD 회절 피크 검출",
                        "term_explanation": "가장 강하게 검출된 브래그 회절 피크의 각도와 반가폭으로, 결정 배향성 및 결정립 미세도/격자 불완전성을 나타냅니다.",
                    }
                )

    if eff_sem:
        g_size = (
            eff_sem.get("grain_size_um")
            or eff_sem.get("mean_intercept_length_um")
            or (eff_sem.get("summary_stats") or {}).get("mean_diameter")
            or (round(float(eff_sem["mean_diameter_nm"]) / 1000.0, 3) if eff_sem.get("mean_diameter_nm") is not None else None)
        )
        if g_size is not None:
            key_metrics_table.append(
                {
                    "instrument": "SEM",
                    "metric_name": "평균 결정립 / 입자 크기 (2D Grain/Particle Size)",
                    "value": f"{g_size}",
                    "unit": "µm",
                    "condition": eff_sem.get("magnification") or "2D 전자현미경 스케일 보정 시야",
                    "category": "계산 결과",
                    "source_label": eff_sem.get("source_file") or "SEM 미세조직 이미지",
                    "term_explanation": "SEM 2차원 표면/단면 영상에서 분할된 입자 또는 결정립계의 겉보기 치수입니다.",
                }
            )
        porosity = eff_sem.get("porosity_pct") if eff_sem.get("porosity_pct") is not None else (eff_sem.get("summary_stats") or {}).get("porosity_pct")
        if porosity is not None:
            key_metrics_table.append(
                {
                    "instrument": "SEM",
                    "metric_name": "면적 기공률 추정치 (2D Area Porosity)",
                    "value": f"{porosity}",
                    "unit": "%",
                    "condition": "SEM 단면 명암 임계 분할",
                    "category": "계산 결과",
                    "source_label": eff_sem.get("source_file") or "SEM 미세조직 이미지",
                    "term_explanation": "소결체나 코팅 단면 내 빈 공간(기공)의 면적 분율로, 기계적 강도와 열전도도를 낮추는 요인입니다.",
                }
            )
        sem_stats = eff_sem.get("summary_stats") or {}
        if sem_stats.get("d50") is not None:
            d10 = sem_stats.get("d10")
            d50 = sem_stats.get("d50")
            d90 = sem_stats.get("d90")
            d_parts = [f"D50 = {d50} µm"]
            if d10 is not None:
                d_parts.insert(0, f"D10 = {d10} µm")
            if d90 is not None:
                d_parts.append(f"D90 = {d90} µm")
            key_metrics_table.append(
                {
                    "instrument": "SEM",
                    "metric_name": "입도 분포 대표값 (Size Distribution D10/D50/D90)",
                    "value": " | ".join(d_parts),
                    "unit": "µm",
                    "condition": sem_stats.get("distribution_basis") or "2D 이미지 분할 누적 입경",
                    "category": "계산 결과",
                    "source_label": eff_sem.get("source_file") or "SEM 입자 분석",
                    "term_explanation": "누적 입도 분포 곡선에서 10%, 50%(중간 직경), 90%에 해당하는 대표 입자 직경입니다.",
                }
            )
        grain_info = eff_sem.get("grain_intercept") or {}
        if grain_info.get("astm_grain_size_number") is not None:
            key_metrics_table.append(
                {
                    "instrument": "SEM",
                    "metric_name": "ASTM 결정립도 번호 (ASTM Grain Size Number, G)",
                    "value": f"G = {grain_info.get('astm_grain_size_number')}",
                    "unit": "-",
                    "condition": "ASTM E112 절단선법 (Intercept method)",
                    "category": "계산 결과",
                    "source_label": eff_sem.get("source_file") or "SEM 결정립 분석",
                    "term_explanation": "표준 ASTM E112 시험 규격에 따라 산출한 결정립도 번호로, 숫자가 클수록 결정립이 미세함을 의미합니다.",
                }
            )
        p_count = eff_sem.get("particle_count") or sem_stats.get("total_count") or eff_sem.get("n_valid_objects")
        if p_count is not None and int(p_count) > 0:
            key_metrics_table.append(
                {
                    "instrument": "SEM",
                    "metric_name": "검출된 유효 입자/결정립 수 (Count)",
                    "value": f"{int(p_count)}개",
                    "unit": "개",
                    "condition": "유효 ROI 영역 내",
                    "category": "측정 사실",
                    "source_label": eff_sem.get("source_file") or "SEM 미세조직 이미지",
                    "term_explanation": "스케일 보정된 분석 영역 내에서 통계적으로 유효하게 계측된 입자 또는 결정립 개수입니다.",
                }
            )

    if eff_utm:
        uts_val = eff_utm.get("tensile_strength_MPa") or eff_utm.get("uts_MPa")
        if uts_val is not None:
            key_metrics_table.append(
                {
                    "instrument": "UTM",
                    "metric_name": "최대 인장강도 (Ultimate Tensile Strength, UTS)",
                    "value": f"{uts_val}",
                    "unit": "MPa",
                    "condition": eff_utm.get("test_condition") or "단축 인장 시험 (공칭 응력 기준)",
                    "category": "측정 사실",
                    "source_label": eff_utm.get("source_file") or "UTM 응력–변형률 곡선",
                    "term_explanation": "시편이 파단되기 전까지 견딘 최대 공칭 응력(최대 하중 ÷ 초기 단면적 A0)입니다.",
                }
            )
        ys_val = eff_utm.get("yield_strength_MPa") or eff_utm.get("rp02_MPa")
        if ys_val is not None:
            key_metrics_table.append(
                {
                    "instrument": "UTM",
                    "metric_name": "0.2% 오프셋 항복강도 (Yield Strength, Rp0.2)",
                    "value": f"{ys_val}",
                    "unit": "MPa",
                    "condition": "0.2% 소성 변형 오프셋 교점",
                    "category": "계산 결과",
                    "source_label": eff_utm.get("source_file") or "UTM 탄성 회귀선 분석",
                    "term_explanation": "영구적인 소성 변형이 본격적으로 시작되는 기준 응력입니다.",
                }
            )
        mod_val = eff_utm.get("elastic_modulus_GPa") or eff_utm.get("modulus_GPa")
        if mod_val is not None:
            key_metrics_table.append(
                {
                    "instrument": "UTM",
                    "metric_name": "탄성계수 (Young's Modulus, E)",
                    "value": f"{mod_val}",
                    "unit": "GPa",
                    "condition": "초기 선형 탄성 구간 기울기",
                    "category": "계산 결과",
                    "source_label": eff_utm.get("source_file") or "UTM 탄성 구간 선형 회귀",
                    "term_explanation": "탄성 변형 구간에서 응력과 변형률의 비례 상수로, 재료의 원자 결합 강성(고유 강성)을 반영합니다.",
                }
            )
        elong_val = eff_utm.get("elongation_pct") or eff_utm.get("fracture_strain_pct")
        if elong_val is not None:
            key_metrics_table.append(
                {
                    "instrument": "UTM",
                    "metric_name": "파단 연신율 (Elongation at Break)",
                    "value": f"{elong_val}",
                    "unit": "%",
                    "condition": "파단 시점 최대 공칭 변형률",
                    "category": "측정 사실",
                    "source_label": eff_utm.get("source_file") or "UTM 응력–변형률 곡선",
                    "term_explanation": "시편이 파단될 때까지 늘어난 비율로, 재료의 연성(Ductility) 대 취성(Brittleness)을 나타냅니다.",
                }
            )

    if eff_hall:
        if eff_hall.get("carrier_concentration_cm3") is not None:
            key_metrics_table.append(
                {
                    "instrument": "Hall",
                    "metric_name": f"전하 캐리어 농도 ({eff_hall.get('carrier_type') or 'Carrier Density'})",
                    "value": f"{float(eff_hall['carrier_concentration_cm3']):.2e}",
                    "unit": "cm⁻³",
                    "condition": f"Van der Pauw · {temp_str}",
                    "category": "계산 결과",
                    "source_label": eff_hall.get("source_file") or "Hall 자기장–전압(B–V_H) 선형 회귀",
                    "term_explanation": "홀 계수(R_H = 1 / n·e)로부터 구한 단위 부피당 이동 가능한 전자(n-type) 또는 정공(p-type)의 개수입니다.",
                }
            )
        if eff_hall.get("hall_mobility_cm2_Vs") is not None:
            key_metrics_table.append(
                {
                    "instrument": "Hall",
                    "metric_name": "홀 이동도 (Hall Mobility, µ_H)",
                    "value": f"{eff_hall.get('hall_mobility_cm2_Vs')}",
                    "unit": "cm²/(V·s)",
                    "condition": f"µ_H = |R_H| · σ · {temp_str}",
                    "category": "계산 결과",
                    "source_label": eff_hall.get("source_file") or "Hall + 면저항 결합 계산",
                    "term_explanation": "단위 전기장당 전하 캐리어가 결정 격자 내부를 얼마나 방해받지 않고 빠르게 이동하는지 나타내는 지표입니다.",
                }
            )
        if eff_hall.get("electrical_conductivity_S_cm") is not None:
            key_metrics_table.append(
                {
                    "instrument": "Hall",
                    "metric_name": "전기전도도 (Electrical Conductivity, σ)",
                    "value": f"{eff_hall.get('electrical_conductivity_S_cm')}",
                    "unit": "S/cm",
                    "condition": f"4단자 면저항 및 두께 기반 · {temp_str}",
                    "category": "측정 사실",
                    "source_label": eff_hall.get("source_file") or "Hall / Van der Pauw 측정",
                    "term_explanation": "전류가 흐르는 정도(σ = n·e·µ_H)로, 캐리어 농도와 이동도의 곱에 비례합니다.",
                }
            )
        res_val = eff_hall.get("resistivity_Ohm_cm")
        if res_val is not None:
            key_metrics_table.append(
                {
                    "instrument": "Hall",
                    "metric_name": "비저항 (Electrical Resistivity, ρ)",
                    "value": f"{res_val}",
                    "unit": "Ω·cm",
                    "condition": f"Van der Pauw 면저항 기반 · {temp_str}",
                    "category": "측정 사실",
                    "source_label": eff_hall.get("source_file") or "Hall 측정",
                    "term_explanation": "전류의 흐름을 방해하는 재료 고유의 전기적 저항률(ρ = 1/σ)입니다.",
                }
            )

    if eff_lfa:
        if lfa_alpha is not None:
            key_metrics_table.append(
                {
                    "instrument": "LFA",
                    "metric_name": "열확산도 (Thermal Diffusivity, α)",
                    "value": f"{lfa_alpha}",
                    "unit": "mm²/s",
                    "condition": f"Parker 반상승 시간(t₁/₂) 모델 · {temp_str}",
                    "category": "측정 사실",
                    "source_label": eff_lfa.get("source_file") or "LFA 레이저 섬광 과도 온도 곡선",
                    "term_explanation": "시편 전면 레이저 조사 후 후면 온도가 최고점의 절반에 도달하는 시간(t₁/₂)으로부터 구한 열 전파 속도(α = 0.1388·L²/t₁/₂)입니다.",
                }
            )
        if lfa_kappa is not None:
            key_metrics_table.append(
                {
                    "instrument": "LFA",
                    "metric_name": "총 열전도도 (Total Thermal Conductivity, κ)",
                    "value": f"{lfa_kappa}",
                    "unit": "W/(m·K)",
                    "condition": f"κ = α·ρ·Cp (ρ={lfa_rho or '-'} g/cm³, Cp={lfa_cp or '-'} J/g·K) · {temp_str}",
                    "category": "계산 결과",
                    "source_label": "LFA 열확산도 + 밀도·비열 결합 계산",
                    "term_explanation": "열확산도(α), 시편 밀도(ρ), 비열(Cp) 세 가지 값을 곱해 산출한 정상 상태 열전달 능력입니다.",
                }
            )
        if lfa_rho is not None and float(lfa_rho) > 0:
            key_metrics_table.append(
                {
                    "instrument": "LFA",
                    "metric_name": "시편 측정 밀도 (Density, ρ)",
                    "value": f"{lfa_rho}",
                    "unit": "g/cm³",
                    "condition": "아르키메데스법 / 치수-질량 계측",
                    "category": "측정 사실",
                    "source_label": eff_lfa.get("source_file") or "LFA 시편 조건",
                    "term_explanation": "열전도도 계산에 사용된 시편의 부피당 질량입니다.",
                }
            )
        if lfa_cp is not None and float(lfa_cp) > 0:
            key_metrics_table.append(
                {
                    "instrument": "LFA",
                    "metric_name": "시편 비열 (Specific Heat, Cp)",
                    "value": f"{lfa_cp}",
                    "unit": "J/(g·K)",
                    "condition": f"DSC/표준 문헌 기준 · {temp_str}",
                    "category": "측정 사실",
                    "source_label": eff_lfa.get("source_file") or "LFA 시편 조건",
                    "term_explanation": "단위 질량의 시편 온도를 1 K 올리는 데 필요한 열용량입니다.",
                }
            )

    if eff_ftir:
        detected_p = eff_ftir.get("detected_peaks") or []
        p_count = len(detected_p)
        key_metrics_table.append(
            {
                "instrument": "FT-IR",
                "metric_name": "검출 피크 수 및 주요 흡수대",
                "value": f"{p_count}개 피크",
                "unit": "개",
                "condition": eff_ftir.get("spectral_range") or "400 - 4000 cm⁻¹",
                "category": "측정 사실",
                "source_label": eff_ftir.get("source_file") or "FT-IR 스펙트럼",
                "term_explanation": "화학 결합의 고유 분자 진동 흡수 피크 개수 및 파수 위치입니다.",
            }
        )
        if detected_p and isinstance(detected_p, list):
            # Format top 3 peaks
            top_peaks_str = []
            for dp in detected_p[:3]:
                if isinstance(dp, dict):
                    wn = dp.get("wavenumber") or dp.get("position")
                    assign = dp.get("assignment") or dp.get("functional_group") or ""
                    if wn is not None:
                        top_peaks_str.append(f"{float(wn):.1f} cm⁻¹" + (f" ({assign})" if assign else ""))
                elif isinstance(dp, (int, float)):
                    top_peaks_str.append(f"{float(dp):.1f} cm⁻¹")
            if top_peaks_str:
                key_metrics_table.append(
                    {
                        "instrument": "FT-IR",
                        "metric_name": "주요 특성 흡수 피크 (Absorption Peaks)",
                        "value": ", ".join(top_peaks_str),
                        "unit": "cm⁻¹",
                        "condition": "피크 피팅 및 베이스라인 보정",
                        "category": "측정 사실",
                        "source_label": eff_ftir.get("source_file") or "FT-IR 스펙트럼",
                        "term_explanation": "분자 결합의 신축(Stretching) 또는 굽힘(Bending) 진동에 대응하는 고유 적외선 흡수 파수입니다.",
                    }
                )

    if eff_dsc:
        tg_val = eff_dsc.get("glass_transition_temp_C") or (eff_dsc.get("thermal_events") or {}).get("tg_C")
        if tg_val is not None:
            key_metrics_table.append(
                {
                    "instrument": "DSC",
                    "metric_name": "유리전이온도 (Glass Transition Temp, Tg)",
                    "value": f"{tg_val}",
                    "unit": "°C",
                    "condition": eff_dsc.get("heating_rate") or "승온 열류 측정 (변곡점)",
                    "category": "측정 사실",
                    "source_label": eff_dsc.get("source_file") or "DSC 열류 곡선",
                    "term_explanation": "비정질 고분자 또는 유리질 매트릭스가 단단한 유리 상태에서 유연한 고무 상태로 전이하는 기준 온도입니다.",
                }
            )
        tc_val = eff_dsc.get("crystallization_temp_C") or (eff_dsc.get("thermal_events") or {}).get("tc_C")
        if tc_val is not None:
            key_metrics_table.append(
                {
                    "instrument": "DSC",
                    "metric_name": "결정화 온도 (Crystallization Temp, Tc)",
                    "value": f"{tc_val}",
                    "unit": "°C",
                    "condition": eff_dsc.get("heating_rate") or "발열 피크 정점",
                    "category": "측정 사실",
                    "source_label": eff_dsc.get("source_file") or "DSC 열류 곡선",
                    "term_explanation": "가열 또는 냉각 중 무질서한 사슬이 규칙적인 결정 격자를 형성하며 열을 방출하는 전이 온도입니다.",
                }
            )
        tm_val = eff_dsc.get("melting_temp_C") or (eff_dsc.get("thermal_events") or {}).get("melting_peak_C")
        if tm_val is not None:
            key_metrics_table.append(
                {
                    "instrument": "DSC",
                    "metric_name": "용융 전이 온도 (Melting Temp, Tm)",
                    "value": f"{tm_val}",
                    "unit": "°C",
                    "condition": eff_dsc.get("heating_rate") or "승온 흡열 피크 정점",
                    "category": "측정 사실",
                    "source_label": eff_dsc.get("source_file") or "DSC 열류 곡선",
                    "term_explanation": "결정 격자가 완전히 붕괴되어 액상으로 변화하는 고체-액체 상전이 온도입니다.",
                }
            )
        dh_val = eff_dsc.get("enthalpy_change_J_g") or eff_dsc.get("delta_H_J_g") or (eff_dsc.get("thermal_events") or {}).get("melting_enthalpy_J_g")
        if dh_val is not None:
            key_metrics_table.append(
                {
                    "instrument": "DSC",
                    "metric_name": "상전이 엔탈피 변화 (Enthalpy Change, ΔH)",
                    "value": f"{dh_val}",
                    "unit": "J/g",
                    "condition": "열류 피크 면적 적분",
                    "category": "계산 결과",
                    "source_label": eff_dsc.get("source_file") or "DSC 피크 적분",
                    "term_explanation": "상전이 과정에서 흡수되거나 방출된 단위 질량당 총 잠열(Latent Heat) 에너지입니다.",
                }
            )

    if eff_tga:
        t_onset = eff_tga.get("onset_temp_C") or eff_tga.get("t_onset_C")
        if t_onset is not None:
            key_metrics_table.append(
                {
                    "instrument": "TGA",
                    "metric_name": "열분해 개시 온도 (Onset Degradation Temp)",
                    "value": f"{t_onset}",
                    "unit": "°C",
                    "condition": "접선 교점 기준",
                    "category": "계산 결과",
                    "source_label": eff_tga.get("source_file") or "TGA 열중량 곡선",
                    "term_explanation": "시편의 열분해로 인한 급격한 중량 감량이 시작되는 개시 온도입니다.",
                }
            )
        t5_val = eff_tga.get("t5_C") or eff_tga.get("temp_5pct_loss_C")
        t10_val = eff_tga.get("t10_C") or eff_tga.get("temp_10pct_loss_C")
        if t5_val is not None or t10_val is not None:
            t_str_parts = []
            if t5_val is not None:
                t_str_parts.append(f"T5% = {t5_val} °C")
            if t10_val is not None:
                t_str_parts.append(f"T10% = {t10_val} °C")
            key_metrics_table.append(
                {
                    "instrument": "TGA",
                    "metric_name": "열안정성 지표 (5% / 10% 감량 온도)",
                    "value": " | ".join(t_str_parts),
                    "unit": "°C",
                    "condition": "초기 중량 대비 백분율 감량점",
                    "category": "측정 사실",
                    "source_label": eff_tga.get("source_file") or "TGA 열중량 곡선",
                    "term_explanation": "초기 중량에서 각각 5% 및 10%의 질량이 소실된 온도로, 내열성 평가의 표준 기준입니다.",
                }
            )
        t_res = eff_tga.get("final_residue_pct") or eff_tga.get("residue_pct")
        if t_res is not None:
            key_metrics_table.append(
                {
                    "instrument": "TGA",
                    "metric_name": "최종 고체 잔류량 (Residue %)",
                    "value": f"{t_res}",
                    "unit": "%",
                    "condition": "최고 도달 온도 기준",
                    "category": "측정 사실",
                    "source_label": eff_tga.get("source_file") or "TGA 열중량 곡선",
                    "term_explanation": "고온 가열 완료 후 분해되지 않고 잔존한 시편의 중량 백분율입니다.",
                }
            )

    if wf_result:
        key_metrics_table.append(
            {
                "instrument": "Hall + LFA",
                "metric_name": "격자 포논 열전도도 (κ_L) / 전자 열전도도 (κ_e)",
                "value": f"κ_L = {wf_result['lattice_thermal_conductivity_W_mK']} ({wf_result['lattice_fraction_pct']}%) | κ_e = {wf_result['electronic_thermal_conductivity_W_mK']} ({wf_result['electronic_fraction_pct']}%)",
                "unit": "W/(m·K)",
                "condition": f"Wiedemann–Franz (L₀ = 2.44×10⁻⁸ W·Ω/K²) · {temp_str}",
                "category": "계산 결과",
                "source_label": "Hall 전기전도도(σ) + LFA 총 열전도도(κ) 결합",
                "term_explanation": "전체 열전도도를 자유전자가 운반하는 열(κ_e = L·σ·T)과 결정 격자 진동(포논)이 운반하는 열(κ_L = κ - κ_e)로 분리한 값입니다.",
            }
        )

    # Part 4: Structured Cross-Instrument Correlations (측정 사실 · 계산 결과 · 해석 가설 분리)
    cross_correlations: List[Dict[str, Any]] = []

    if eff_xrd and eff_utm:
        cross_correlations.append(
            {
                "id": "corr_xrd_utm",
                "title": "결정구조 · 결정립(XRD/SEM) ↔ 기계적 강도 · 연신율(UTM) 연계 해석",
                "instruments": ["XRD", "UTM"] + (["SEM"] if eff_sem else []),
                "basis_condition": f"시료 ID: {sample_id} | 조성: {material_name} | 온도: {temp_str}",
                "measured_facts": [
                    f"[XRD 측정 사실] 주 결정상 {eff_xrd.get('primary_phase') or material_name} (공간군 {eff_xrd.get('space_group') or '-'}); "
                    f"UTM 최대 인장강도 {eff_utm.get('tensile_strength_MPa') or '-'} MPa, 파단 연신율 {eff_utm.get('elongation_pct') or '-'}%."
                ],
                "calculated_results": [
                    f"[계산 결과] XRD Scherrer 결정자 크기 D = {eff_xrd.get('crystallite_size_nm') or eff_xrd.get('scherrer_crystallite_size_nm') or '-'} nm"
                    + (f", SEM 평균 결정립 크기 {eff_sem.get('grain_size_um')} µm (기공률 {eff_sem.get('porosity_pct')}%)" if eff_sem else "")
                    + f", UTM 탄성계수 E = {eff_utm.get('elastic_modulus_GPa') or '-'} GPa, 0.2% 항복강도 = {eff_utm.get('yield_strength_MPa') or '-'} MPa."
                ],
                "interpretation_hypotheses": [
                    "[해석 가설] 탄성계수(E)는 XRD로 확인된 결정구조의 원자간 결합 강성을 반영하며, 미세한 결정립/도메인 경계는 전위 이동을 방해(Hall–Petch 강화 메커니즘)하여 항복강도 상승에 기여할 수 있습니다.",
                    "[해석 가설] 반면 잔류 기공이나 취성 이차상이 결정립계에 존재할 경우 응력 집중점으로 작용해 조기 파단 및 낮은 연신율을 유발할 수 있습니다.",
                ],
                "caution_note": "주의: 단일 시편(N=1) 측정만으로는 결정자 크기와 인장강도 사이의 인과관계를 확정할 수 없으며, 시편 가공 결함 및 기공률 영향을 분리해야 합니다.",
            }
        )

    if eff_xrd and eff_hall:
        cross_correlations.append(
            {
                "id": "corr_xrd_hall",
                "title": "결정구조 · 도펀트 고용(XRD/SEM) ↔ 전하 수송 특성(Hall Effect) 연계 해석",
                "instruments": ["XRD", "Hall"] + (["SEM"] if eff_sem else []),
                "basis_condition": f"시료 ID: {sample_id} | 조성: {material_name} | 온도: {temp_str}",
                "measured_facts": [
                    f"[측정 사실] XRD 주상 {eff_xrd.get('primary_phase') or material_name} 확인 및 Hall 전기전도도 σ = {eff_hall.get('electrical_conductivity_S_cm') or '-'} S/cm ({eff_hall.get('carrier_type') or '-'})."
                ],
                "calculated_results": [
                    f"[계산 결과] Hall 캐리어 농도 n = {float(eff_hall['carrier_concentration_cm3']):.2e} cm⁻³, 홀 이동도 µ_H = {eff_hall.get('hall_mobility_cm2_Vs')} cm²/(V·s), XRD 결정자 크기 D = {eff_xrd.get('crystallite_size_nm') or eff_xrd.get('scherrer_crystallite_size_nm') or '-'} nm."
                    if eff_hall.get("carrier_concentration_cm3") is not None
                    else "[계산 결과] Hall 전하 수송 지표 및 XRD 결정자 크기 산출 완료."
                ],
                "interpretation_hypotheses": [
                    "[해석 가설] 치환형 도펀트가 주 결정격자 위치에 고용되면 격자 상수 변화(XRD 피크 이동)와 함께 유효 전하 캐리어 농도(n)가 변화합니다.",
                    "[해석 가설] 결정립계 밀도(SEM 결정립 크기)나 점결함 농도가 높을 경우 전위 장벽 산란(Petritz 모델) 및 이온화 불순물 산란으로 인해 홀 이동도(µ_H)가 제한될 수 있습니다.",
                ],
                "caution_note": "주의: 결정립계 산란 지배 여부는 상온 단일 측정만으로 단정할 수 없으며, 온도 가변 Hall 이동도(µ_H–T) 측정을 통해 검증해야 합니다.",
            }
        )

    if eff_lfa and (eff_xrd or eff_sem or eff_hall):
        lfa_calc_strs = [f"열확산도 α = {lfa_alpha} mm²/s"]
        if lfa_kappa is not None:
            lfa_calc_strs.append(f"총 열전도도 κ = {lfa_kappa} W/(m·K)")
        if wf_result:
            lfa_calc_strs.append(
                f"Wiedemann–Franz 분리: 격자 열전도도 κ_L = {wf_result['lattice_thermal_conductivity_W_mK']} W/(m·K) ({wf_result['lattice_fraction_pct']}%), "
                f"전자 열전도도 κ_e = {wf_result['electronic_thermal_conductivity_W_mK']} W/(m·K) ({wf_result['electronic_fraction_pct']}%)"
            )
        cross_correlations.append(
            {
                "id": "corr_structure_thermal",
                "title": "결정구조 · 미세조직 · 전기수송(XRD/SEM/Hall) ↔ 열전달 메커니즘(LFA) 연계 해석",
                "instruments": [i for i in ["XRD", "SEM", "Hall", "LFA"] if i in instruments],
                "basis_condition": f"시료 ID: {sample_id} | 조성: {material_name} | 온도: {temp_str}",
                "measured_facts": [
                    f"[측정 사실] LFA 레이저 섬광 과도 응답으로부터 열확산도 α = {lfa_alpha} mm²/s 확보"
                    + (f", Hall 전기전도도 σ = {eff_hall.get('electrical_conductivity_S_cm')} S/cm." if eff_hall else ".")
                ],
                "calculated_results": [f"[계산 결과] {', '.join(lfa_calc_strs)}."],
                "interpretation_hypotheses": [
                    (
                        f"[해석 가설] 전체 열전도도 중 격자 포논 기여분(κ_L = {wf_result['lattice_thermal_conductivity_W_mK']} W/m·K, {wf_result['lattice_fraction_pct']}%)이 확인되며, "
                        "나노 결정자 경계(XRD)와 결정립계·기공(SEM)이 중·장파장 음향 포논을 산란시켜 격자 열전도도를 낮추는 데 기여할 수 있습니다."
                    )
                    if wf_result
                    else (
                        "[해석 가설] 밀도(ρ) 또는 비열(Cp) 미입력으로 열전도도(κ)는 계산하지 않았으나, 측정된 열확산도(α)는 결정격자 내 포논 평균자유행로 및 기공·입계 산란 상태의 영향을 받습니다."
                    )
                ],
                "caution_note": (
                    "주의: Wiedemann–Franz 분리는 축퇴 반도체 기준 Sommerfeld 로렌츠 수(L₀ = 2.44×10⁻⁸ W·Ω/K²) 가정에 기반하며, 비축퇴 영역이나 양극성(Bipolar) 전도 구간에서는 실제 L 값과 차이가 날 수 있습니다."
                ),
            }
        )

    if eff_xrd and eff_sem and not any(c.get("id") == "corr_xrd_sem" for c in cross_correlations):
        cross_correlations.append(
            {
                "id": "corr_xrd_sem_only",
                "title": "XRD 결맞음 회절 도메인 ↔ SEM 미세조직 입경/결정립 연계 해석",
                "instruments": ["XRD", "SEM"],
                "basis_condition": f"시료 ID: {sample_id} | 조성: {material_name}",
                "measured_facts": [
                    f"[측정 사실] XRD 주 결정상({eff_xrd.get('primary_phase') or material_name})과 SEM 미세조직 시야가 동일 시편 기준으로 확보되었습니다."
                ],
                "calculated_results": [
                    f"[계산 결과] XRD Scherrer 결정자 크기 D = {eff_xrd.get('crystallite_size_nm') or eff_xrd.get('scherrer_crystallite_size_nm') or '-'} nm vs SEM 결정립/입자 크기 = {eff_sem.get('grain_size_um') or '-'} µm."
                ],
                "interpretation_hypotheses": [
                    "[해석 가설] SEM 입자 크기가 XRD 결정자 크기보다 큰 것은 여러 1차 결정자(Sub-domain)들이 응집되었거나 다결정 결정립을 형성했기 때문일 수 있습니다."
                ],
                "caution_note": "주의: 기기 선폭 미보정이나 격자 미소변형(Microstrain)에 의해서도 XRD 선폭이 넓어질 수 있으므로 크기 차이만으로 다결정성을 단정하지 않습니다.",
            }
        )

    if ftir_xrd_corr:
        cross_correlations.append(
            {
                "id": "corr_ftir_xrd",
                "title": "XRD 결정 격자 대칭성 ↔ FT-IR 분자 진동/표면 작용기 연계 해석",
                "instruments": ["XRD", "FT-IR"],
                "basis_condition": f"시료 ID: {sample_id} | 조성: {material_name}",
                "measured_facts": [
                    f"[측정 사실] XRD 주 결정상 {eff_xrd.get('primary_phase') or material_name} 및 FT-IR {len(eff_ftir.get('detected_peaks') or [])}개 흡수 피크 검출."
                ],
                "calculated_results": [
                    "[계산 결과] 분자 결합 고유 진동 주파수와 무기 결정 격자 회절 패턴 대조 완료."
                ],
                "interpretation_hypotheses": [
                    ftir_xrd_corr["interpretation"]
                ],
                "caution_note": "주의: FT-IR의 유기 리간드 피크는 표면 오염이나 잔류 흡착수 영향일 수 있으므로 진공 열처리 전후 스펙트럼 비교가 권장됩니다.",
            }
        )

    if dsc_xrd_corr:
        cross_correlations.append(
            {
                "id": "corr_dsc_xrd",
                "title": "XRD 결정도 및 상 안정성 ↔ DSC 열역학적 상전이 거동 연계 해석",
                "instruments": ["XRD", "DSC"],
                "basis_condition": f"시료 ID: {sample_id} | 조성: {material_name}",
                "measured_facts": [
                    f"[측정 사실] XRD 회절 피크와 DSC 상전이 피크(온도: {dsc_xrd_corr.get('dsc_melting_temp_C') or '-'} °C) 확인."
                ],
                "calculated_results": [
                    f"[계산 결과] 결정 구조({dsc_xrd_corr.get('xrd_spacegroup') or '-'}) 기준 상전이 엔탈피 교차 검증."
                ],
                "interpretation_hypotheses": [
                    dsc_xrd_corr["interpretation"]
                ],
                "caution_note": "주의: 승온 속도(Scan Rate)에 따라 DSC 피크 온도가 이동하므로 표준 보정(Indium 등) 조건을 확인해야 합니다.",
            }
        )

    if tga_dsc_corr:
        cross_correlations.append(
            {
                "id": "corr_tga_dsc",
                "title": "TGA 열분해/질량 감량 ↔ DSC 열류 반응 메커니즘 결합 해석",
                "instruments": ["TGA", "DSC"],
                "basis_condition": f"시료 ID: {sample_id} | 조성: {material_name}",
                "measured_facts": [
                    f"[측정 사실] TGA 분해 개시 온도({tga_dsc_corr.get('tga_onset_temp_C') or '-'} °C), 최종 잔류량 {tga_dsc_corr.get('tga_residue_pct') or '-'}%."
                ],
                "calculated_results": [
                    "[계산 결과] 질량 감량 단계별 열류 흡열/발열 신호 매핑 완료."
                ],
                "interpretation_hypotheses": [
                    tga_dsc_corr["interpretation"]
                ],
                "caution_note": "주의: 분위기 가스(N2 vs Air) 및 도가니 재질에 따른 산화 및 분해 경로 차이에 유의해야 합니다.",
            }
        )

    # Part 1: Executive Summary Items (3~5 concise items: key findings + cautions)
    executive_summary_items: List[Dict[str, Any]] = [
        {
            "type": "finding",
            "badge": "분석 대상 및 연결 기준",
            "text": f"{linkage['linkage_badge']} — {linkage['linkage_summary']}",
        }
    ]
    if eff_xrd or eff_sem:
        parts_s = []
        if eff_xrd:
            parts_s.append(
                f"XRD 주상 {eff_xrd.get('primary_phase') or material_name} (결정자 크기 {eff_xrd.get('crystallite_size_nm') or eff_xrd.get('scherrer_crystallite_size_nm') or '-'} nm)"
            )
        if eff_sem:
            parts_s.append(
                f"SEM 평균 입경/결정립 {eff_sem.get('grain_size_um') or '-'} µm (기공률 {eff_sem.get('porosity_pct') if eff_sem.get('porosity_pct') is not None else '-'}%)"
            )
        executive_summary_items.append(
            {
                "type": "finding",
                "badge": "구조 · 미세조직 핵심 결과",
                "text": " · ".join(parts_s) + " (XRD 결정자 크기와 SEM 2D 외형 입경은 별개의 물리량으로 구분).",
            }
        )

    if eff_utm or eff_hall or eff_lfa:
        parts_p = []
        if eff_utm:
            parts_p.append(
                f"UTM 인장강도 {eff_utm.get('tensile_strength_MPa') or '-'} MPa · 탄성계수 {eff_utm.get('elastic_modulus_GPa') or '-'} GPa · 연신율 {eff_utm.get('elongation_pct') or '-'}%"
            )
        if eff_hall and eff_hall.get("carrier_concentration_cm3") is not None:
            parts_p.append(
                f"Hall {eff_hall.get('carrier_type') or ''} n={float(eff_hall['carrier_concentration_cm3']):.2e} cm⁻³, µ_H={eff_hall.get('hall_mobility_cm2_Vs')} cm²/V·s"
            )
        if eff_lfa:
            if lfa_kappa is not None:
                parts_p.append(f"LFA α={lfa_alpha} mm²/s, κ={lfa_kappa} W/m·K")
            else:
                parts_p.append(f"LFA α={lfa_alpha} mm²/s (밀도·비열 미확보로 κ 미계산)")
        executive_summary_items.append(
            {
                "type": "finding",
                "badge": "기계 · 전기 · 열 핵심 물성",
                "text": " | ".join(parts_p),
            }
        )

    if eff_ftir:
        executive_summary_items.append(
            {
                "type": "finding",
                "badge": "FT-IR 분자 결합 및 작용기",
                "text": f"FT-IR 스펙트럼에서 {len(eff_ftir.get('detected_peaks') or [])}개 주요 흡수 피크가 검출되어 유기/표면 작용기 특성이 확인되었습니다.",
            }
        )

    if eff_dsc or eff_tga:
        parts_th = []
        if eff_dsc:
            parts_th.append(f"DSC 상전이 온도 {eff_dsc.get('melting_temp_C') or (eff_dsc.get('thermal_events') or {}).get('melting_peak_C') or '-'} °C")
        if eff_tga:
            parts_th.append(f"TGA 열분해 개시 {eff_tga.get('onset_temp_C') or eff_tga.get('t_onset_C') or '-'} °C (잔류 {eff_tga.get('final_residue_pct') or eff_tga.get('residue_pct') or '-'}%)")
        executive_summary_items.append(
            {
                "type": "finding",
                "badge": "열안정성 및 상전이 거동",
                "text": " · ".join(parts_th),
            }
        )

    if wf_result:
        executive_summary_items.append(
            {
                "type": "finding",
                "badge": "Wiedemann–Franz 열수송 분리",
                "text": (
                    f"총 열전도도({wf_result['total_thermal_conductivity_W_mK']} W/m·K) 중 격자 포논 기여분 κ_L = {wf_result['lattice_thermal_conductivity_W_mK']} W/m·K ({wf_result['lattice_fraction_pct']}%), "
                    f"전자 기여분 κ_e = {wf_result['electronic_thermal_conductivity_W_mK']} W/m·K ({wf_result['electronic_fraction_pct']}%)로 산출됨."
                ),
            }
        )

    # Mandatory scientific caution item
    missing_insts = [it["instrument"] for it in instrument_availability if not it["available"]]
    caution_msg = "단일 시편(N=1) 측정 결과이므로 특성 간 통계적 상관관계나 인과관계를 단정하지 않으며, 모든 해석 가설은 측정 사실·계산 결과와 분리하여 제시합니다."
    if missing_insts:
        caution_msg += f" (선택 장비 중 미입력: {', '.join(missing_insts)} — 확보된 데이터 범위 내에서만 리포트를 생성함)"
    executive_summary_items.append(
        {
            "type": "caution",
            "badge": "핵심 주의사항 및 데이터 범위",
            "text": caution_msg,
        }
    )

    # Part 5: Limitations and Recommended Next Actions
    cannot_determine: List[str] = [
        "단일 샘플(N=1) 또는 제한된 시편 수만으로는 결정자/결정립 크기와 기계적·전기적·열적 물성 사이의 통계적 상관관계나 보편적 인과 법칙을 확립할 수 없습니다.",
    ]
    for it in instrument_availability:
        if it["missing_impact"]:
            cannot_determine.append(f"[{it['instrument']} 제한사항] {it['missing_impact']}")
    if eff_sem:
        cannot_determine.append(
            "SEM 2D 이미지만으로는 내부 3차원 기공 연결성이나 국소 이차상의 정확한 화학 조성을 확정할 수 없습니다 (EDS/EBSD 추가 확인 필요)."
        )

    next_actions: List[str] = []
    if eff_lfa and lfa_kappa is None:
        next_actions.append(
            "LFA 열전도도(κ = α·ρ·Cp) 산출을 위해 아르키메데스 밀도(ρ, g/cm³)와 DSC 비열(Cp, J/g·K) 측정값을 입력한 뒤 통합 분석을 다시 실행하세요."
        )
    if missing_insts:
        next_actions.append(
            f"선택된 기기 중 누락된 측정 항목({', '.join(missing_insts)})의 데이터가 확보되면 해당 기기 분석 패널에서 분석을 완료한 뒤 다시 실행하세요."
        )
    next_actions.extend(
        [
            "온도 가변(300 K ~ 800 K) Hall 및 LFA 측정을 추가로 수행하여 결정립계 전위 장벽 산란(µ_H ~ exp(-E_B/kT)) 및 우세한 포논 산란(Umklapp vs 경계 산란) 메커니즘을 검증하세요.",
            "동일 모재에서 열처리 온도나 도펀트 함량만 단일 변수로 바꾼 3개 이상의 시리즈 시편을 측정하여 구조–물성 변화의 재현성(표준편차)을 확인하세요.",
        ]
    )

    limitations_and_next_actions = {
        "cannot_determine_now": cannot_determine,
        "recommended_next_steps": next_actions,
    }

    # Synthesis-to-Properties Chain
    chain: List[Dict[str, Any]] = [
        {
            "stage": "1. Processing",
            "description": f"Synthesis and thermal processing of {material_name}",
            "data_source": "Sample Metadata",
        },
    ]
    if _is_sel("xrd"):
        chain.append({
            "stage": "2. Crystal Structure",
            "description": "Phase composition and lattice parameters",
            "data_source": "XRD" if eff_xrd else "미입력 (해석 제외)",
        })
    if _is_sel("sem"):
        chain.append({
            "stage": "3. Microstructure",
            "description": "Grain boundary density, pore distribution, second phases",
            "data_source": "SEM" if eff_sem else "미입력 (해석 제외)",
        })
    if _is_sel("hall"):
        chain.append({
            "stage": "4. Carrier Transport",
            "description": "Carrier density, mobility, electrical conductivity",
            "data_source": "Hall Effect" if eff_hall else "미입력 (해석 제외)",
        })
    if _is_sel("lfa"):
        chain.append({
            "stage": "5. Thermal Transport",
            "description": "Thermal diffusivity, specific heat, thermal conductivity",
            "data_source": "LFA" if eff_lfa else "미입력 (해석 제외)",
        })
    if _is_sel("utm"):
        chain.append({
            "stage": "6. Mechanical Properties",
            "description": "Elastic modulus, yield/tensile strength, fracture elongation",
            "data_source": "UTM" if eff_utm else "미입력 (해석 제외)",
        })
    if _is_sel("ftir"):
        chain.append({
            "stage": "7. Chemical Bonding",
            "description": "Molecular functional groups and vibration modes",
            "data_source": "FT-IR" if eff_ftir else "미입력 (해석 제외)",
        })
    if _is_sel("dsc") or _is_sel("tga"):
        chain.append({
            "stage": "8. Thermal Stability & Phase Transition",
            "description": "Melting, crystallization, degradation and mass loss",
            "data_source": "DSC / TGA" if (eff_dsc or eff_tga) else "미입력 (해석 제외)",
        })

    return IntegratedAnalysisResult(
        sample_id=sample_id,
        material_name=material_name,
        instruments_included=instruments,
        wiedemann_franz=wf_result,
        xrd_sem_correlation=xrd_sem_corr,
        sem_hall_correlation=sem_hall_corr,
        sem_lfa_correlation=sem_lfa_corr,
        xrd_hall_correlation=xrd_hall_corr,
        xrd_utm_correlation=xrd_utm_corr,
        synthesis_to_properties_chain=chain,
        grounded_claims=claims,
        warnings=warnings,
        notes=notes,
        executive_summary_items=executive_summary_items,
        linkage_assessment=linkage,
        instrument_availability=instrument_availability,
        key_metrics_table=key_metrics_table,
        cross_correlations=cross_correlations,
        limitations_and_next_actions=limitations_and_next_actions,
    )
