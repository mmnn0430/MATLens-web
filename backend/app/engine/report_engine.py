"""Rule-Based Summary & Google Gemini Multimodal Structured Interpretation Engine.

Strict Scientific & AI Guardrails:
1. Rule-based summary always runs deterministically without any external API key.
2. Integrated cross-interpretation is restricted unless BOTH XRD and SEM results exist AND `is_same_sample` is confirmed.
3. Gemini receives ONLY verified numerical engine outputs + cropped SEM ROI & overlay images.
4. Gemini output uses Pydantic JSON Schema (`AIReportSchema`) + separate server-side evidence ID & numerical consistency verification.
5. Never fabricates phases/numbers, never equates SEM particle size with XRD crystallite size, never uses arbitrary fixed D_SEM/D_XRD ratio cutoffs as definitive proof, and never outputs numeric AI confidence scores.
"""
from __future__ import annotations

import json
import re
from typing import Any
from pydantic import BaseModel, Field

from ..config import (
    AI_PROMPT_VERSION,
    GEMINI_FALLBACK_ORDER,
    GEMINI_MODEL_OPTIONS,
    get_gemini_api_key,
    get_gemini_model,
)
from ..db import utc_now_iso
from ..schemas import AIReportSchema

_CONFIDENCE_BAN_RE = re.compile(r"(신뢰도|정답\s*확률|일치\s*확률|확신도|confidence)\s*[:=]?\s*\d+(\.\d+)?\s*%", re.IGNORECASE)
_NUMBER_TOKEN_RE = re.compile(r"(?<![A-Za-z0-9_-])(\d+\.\d+|\d+)(?=\s*(?:nm|µm|um|px|°|Å|%))")


def build_evidence_registry(
    project_meta: dict[str, Any],
    xrd_res: dict[str, Any] | None,
    sem_res: dict[str, Any] | None,
) -> dict[str, dict[str, Any]]:
    """Build a flat dictionary of verifiable Evidence IDs -> {category, label, value}."""
    reg: dict[str, dict[str, Any]] = {
        "SAMPLE-META": {
            "source_type": "사용자 입력",
            "label": "시료 기본 정보 및 공정/합성 이력",
            "value": {
                "sample_name": project_meta.get("sample_name"),
                "description": project_meta.get("description"),
                "expected_formula": project_meta.get("expected_formula"),
                "expected_elements": project_meta.get("expected_elements", []),
                "is_same_sample": bool(project_meta.get("is_same_sample", False)),
            },
        }
    }

    if xrd_res is not None:
        cond = xrd_res.get("conditions", {})
        insp = xrd_res.get("inspection", {})
        reg["XRD-COND"] = {
            "source_type": "측정값/사용자 입력",
            "label": "XRD 측정 및 전처리 조건",
            "value": {
                "wavelength_A": cond.get("wavelength_angstrom"),
                "xray_source": cond.get("xray_source"),
                "wavelength_confirmed": cond.get("wavelength_confirmed"),
                "two_theta_range": [insp.get("two_theta_min"), insp.get("two_theta_max")],
                "step_deg": insp.get("median_step_deg"),
                "is_uniform_step": insp.get("is_uniform_step"),
            },
        }
        active_peaks = [p for p in xrd_res.get("peaks", []) if not p.get("user_excluded")]
        reg["XRD-PEAK-SUMMARY"] = {
            "source_type": "계산값",
            "label": "검출된 유효 XRD 피크 수",
            "value": {"active_peak_count": len(active_peaks), "total_peak_count": len(xrd_res.get("peaks", []))},
        }
        for p in active_peaks[:12]:
            reg[f"XRD-{p['peak_id']}"] = {
                "source_type": "계산값",
                "label": f"피크 {p['peak_id']} ({p['two_theta']}°)",
                "value": {
                    "two_theta": p["two_theta"],
                    "d_spacing_A": p["d_spacing_A"],
                    "rel_intensity_pct": p["rel_intensity_pct"],
                    "fwhm_deg": p["fwhm_deg"],
                    "fit_status": p["fit_status"],
                    "assigned_phase": p.get("assigned_phase"),
                    "assigned_hkl": p.get("assigned_hkl"),
                },
            }

        pm = xrd_res.get("phase_matching", {})
        for idx, cand in enumerate(pm.get("candidates", [])[:5]):
            reg[f"XRD-PHASE-{idx + 1}"] = {
                "source_type": "계산값",
                "label": f"상 후보 {idx + 1}: {cand['name']}",
                "value": {
                    "phase_id": cand["phase_id"],
                    "mp_id": cand.get("mp_id"),
                    "name": cand["name"],
                    "formula": cand["formula"],
                    "spacegroup": cand["spacegroup"],
                    "match_score": cand["score"],
                    "shift_deg": cand["shift_deg"],
                    "e_hull_ev": cand.get("e_hull_ev"),
                    "formation_energy_ev": cand.get("formation_energy_ev"),
                    "stability_badge": cand.get("stability_badge"),
                    "density_g_cm3": cand.get("density_g_cm3"),
                    "band_gap_ev": cand.get("band_gap_ev"),
                    "electronic_label": cand.get("electronic_label"),
                    "z_bse_eff": cand.get("z_bse_eff"),
                    "matched_peak_count": len(cand.get("matched_peaks", [])),
                    "unexplained_peak_count": len(cand.get("unexplained_peak_ids", [])),
                    "source": cand["source"],
                },
            }
        pdbse = xrd_res.get("phase_diagram_bse")
        if pdbse and pdbse.get("enabled"):
            reg["MP-PHASE-DIAGRAM"] = {
                "source_type": "계산값",
                "label": f"Materials Project {pdbse.get('chemsys')} 0 K 상평형도 및 Tie-Line 공존상",
                "value": {
                    "chemsys": pdbse.get("chemsys"),
                    "stable_phases": pdbse.get("stable_formulas", []),
                    "primary_formula": pdbse.get("primary_formula"),
                    "coexisting_equilibrium_neighbors": pdbse.get("coexisting_equilibrium_neighbors", []),
                },
            }
            reg["MP-BSE-CONTRAST"] = {
                "source_type": "계산값",
                "label": "Materials Project 조성 기반 SEM-BSE 유효 원자번호(Z_BSE) 명암 예측",
                "value": [
                    {
                        "formula": row["formula"],
                        "mp_id": row.get("mp_id"),
                        "z_bse_eff": row["z_bse_eff"],
                        "bse_zone": row["bse_zone"],
                        "density_g_cm3": row.get("density_g_cm3"),
                    }
                    for row in pdbse.get("bse_table", [])[:6]
                ],
            }
        if pm.get("multiphase_comparison") and pm["multiphase_comparison"].get("combinations"):
            reg["XRD-MULTIPHASE"] = {
                "source_type": "계산값",
                "label": "다상 후보 조합 잔차 비교",
                "value": {
                    "single_phase_residual": pm["multiphase_comparison"]["single_phase_baseline"]["residual_r_pat"],
                    "top_combination": pm["multiphase_comparison"]["combinations"][0],
                },
            }

        sch = xrd_res.get("scherrer", {})
        reg["XRD-SCHERRER"] = {
            "source_type": "계산값",
            "label": "Scherrer 결정자 크기 추정",
            "value": {
                "status": sch.get("status"),
                "instrument_correction": sch.get("instrument_correction_label"),
                "n_used_peaks": sch.get("n_used_peaks"),
                "mean_nm": sch.get("mean_nm"),
                "median_nm": sch.get("median_nm"),
                "range_nm": sch.get("range_nm"),
                "k_factor": sch.get("k_factor"),
            },
        }
        wh = xrd_res.get("williamson_hall", {})
        if wh.get("enabled"):
            reg["XRD-WH"] = {
                "source_type": "계산값",
                "label": "Williamson–Hall 회귀 결과",
                "value": {
                    "status": wh.get("status"),
                    "phase_name": wh.get("phase_name"),
                    "n_peaks": wh.get("n_peaks"),
                    "crystallite_size_nm": wh.get("crystallite_size_nm"),
                    "microstrain": wh.get("microstrain"),
                    "r2": wh.get("r2"),
                },
            }
        cr = xrd_res.get("crystallinity", {})
        if cr.get("enabled") and cr.get("index_pct") is not None:
            reg["XRD-CRYST"] = {
                "source_type": "계산값",
                "label": "조건부 상대 결정성 지표",
                "value": {
                    "index_pct": cr.get("index_pct"),
                    "sample_family": cr.get("sample_family"),
                    "window_deg": cr.get("window_deg"),
                },
            }

    if sem_res is not None:
        sc = sem_res.get("scale", {})
        reg["SEM-COND"] = {
            "source_type": "측정값/사용자 입력",
            "label": "SEM 분석 영역 및 스케일 보정 상태",
            "value": {
                "mode": sem_res.get("mode"),
                "roi": sem_res.get("roi"),
                "is_calibrated": sc.get("is_calibrated"),
                "display_unit": sc.get("display_unit"),
                "nm_per_px": sc.get("nm_per_px"),
            },
        }
        st = sem_res.get("summary_stats")
        if st is not None:
            reg["SEM-STAT-SIZE"] = {
                "source_type": "계산값",
                "label": "SEM 2D 개수 기준 입자 크기 통계",
                "value": {
                    "sample_count_n": st["sample_count_n"],
                    "unit": st["unit"],
                    "mean_diameter": st["mean_diameter"],
                    "median_diameter": st["median_diameter"],
                    "std_diameter": st["std_diameter"],
                    "d10": st["d10"],
                    "d50": st["d50"],
                    "d90": st["d90"],
                },
            }
            reg["SEM-STAT-AREA-WEIGHTED"] = {
                "source_type": "계산값",
                "label": "SEM 2D 면적 가중 입자 크기",
                "value": st["area_weighted"],
            }
            reg["SEM-STAT-SHAPE"] = {
                "source_type": "계산값",
                "label": "SEM 2D 입자 형상 통계",
                "value": {
                    "sample_count_n": st["sample_count_n"],
                    "median_circularity": st["median_circularity"],
                    "mean_circularity": st["mean_circularity"],
                    "median_aspect_ratio": st["median_aspect_ratio"],
                    "mean_aspect_ratio": st["mean_aspect_ratio"],
                },
            }
        gi = sem_res.get("grain_intercept")
        if gi is not None:
            reg["SEM-GRAIN-INTERCEPT"] = {
                "source_type": "계산값",
                "label": "SEM 선형교차법 기반 추정",
                "value": {
                    "unit": gi["unit"],
                    "mean_intercept_length": gi["mean_intercept_length"],
                    "effective_intersections": gi["effective_intersections"],
                    "total_line_length": gi["total_line_length"],
                    "n_test_lines": gi["n_test_lines"],
                },
            }

    return reg


def build_rule_summary(
    project_meta: dict[str, Any],
    xrd_res: dict[str, Any] | None,
    sem_res: dict[str, Any] | None,
) -> dict[str, Any]:
    """Deterministic, scientific rule-based summary that works completely without AI."""
    evidence_reg = build_evidence_registry(project_meta, xrd_res, sem_res)
    has_both = xrd_res is not None and sem_res is not None
    is_same = bool(project_meta.get("is_same_sample", False))
    can_integrate = has_both and is_same

    xrd_facts: list[dict[str, Any]] = []
    sem_facts: list[dict[str, Any]] = []
    cross_notes: list[dict[str, Any]] = []
    checks_needed: list[str] = []
    limitations: list[str] = []

    if xrd_res is not None:
        insp = xrd_res["inspection"]
        active_peaks = [p for p in xrd_res["peaks"] if not p["user_excluded"]]
        xrd_facts.append(
            {
                "text": (
                    f"2θ {insp['two_theta_min']}°–{insp['two_theta_max']}° 구간(중앙 간격 {insp['median_step_deg']}°)에서 "
                    f"총 {len(active_peaks)}개의 유효 회절 피크가 검출되었습니다."
                ),
                "evidence_ids": ["XRD-COND", "XRD-PEAK-SUMMARY"],
            }
        )
        pm = xrd_res["phase_matching"]
        cands = pm.get("candidates", [])
        if cands:
            top = cands[0]
            mp_meta_bits = []
            if top.get("mp_id"):
                mp_meta_bits.append(f"MP ID: {top['mp_id']}")
            if top.get("e_hull_ev") is not None:
                mp_meta_bits.append(f"E_hull = {top['e_hull_ev']:.3f} eV/atom ({top.get('stability_badge', '')})")
            if top.get("density_g_cm3") is not None:
                mp_meta_bits.append(f"이론 밀도 ρ = {top['density_g_cm3']} g/cm³")
            if top.get("electronic_label"):
                mp_meta_bits.append(top["electronic_label"])
            mp_suffix = f" [{' · '.join(mp_meta_bits)}]" if mp_meta_bits else ""
            xrd_facts.append(
                {
                    "text": (
                        f"내장/Materials Project 기준 라이브러리 비교 결과, 1순위 상 후보는 {top['name']} ({top['spacegroup']}, "
                        f"상대 매칭 점수 {top['score']}/100, 일치 피크 {len(top['matched_peaks'])}개, 미설명 피크 {len(top['unexplained_peak_ids'])}개){mp_suffix}입니다."
                    ),
                    "evidence_ids": ["XRD-PHASE-1"],
                }
            )
            cg = pm.get("composition_guidance")
            if cg and cg.get("interpretation_guide"):
                xrd_facts.append(
                    {
                        "text": cg["interpretation_guide"],
                        "evidence_ids": ["SAMPLE-META", "XRD-PHASE-1"],
                    }
                )
            if top["unexplained_peak_ids"]:
                mp = pm.get("multiphase_comparison")
                if mp and mp.get("combinations") and mp["combinations"][0]["newly_explained_peaks"]:
                    best_c = mp["combinations"][0]
                    xrd_facts.append(
                        {
                            "text": (
                                f"단일상 기준 미설명 피크({', '.join(top['unexplained_peak_ids'])}) 중 일부는 "
                                f"{' + '.join(best_c['phases'])} 조합으로 추가 설명되며 패턴 잔차(R_pat)가 "
                                f"{mp['single_phase_baseline']['residual_r_pat']}에서 {best_c['residual_r_pat']}로 감소했습니다."
                            ),
                            "evidence_ids": ["XRD-PHASE-1", "XRD-MULTIPHASE"],
                        }
                    )
                else:
                    checks_needed.append(
                        f"XRD 패턴에 1순위 후보로 설명되지 않는 피크({', '.join(top['unexplained_peak_ids'])})가 남아 있습니다. 부상(secondary phase) 또는 기판 신호 확인이 필요합니다."
                    )
        else:
            checks_needed.append("현재 기준 라이브러리 범위에서 일치하는 XRD 결정상 후보가 없습니다. 원소 필터 또는 사용자 CIF 업로드를 확인해주세요.")

        sch = xrd_res["scherrer"]
        if sch["mean_nm"] is not None:
            xrd_facts.append(
                {
                    "text": (
                        f"조건부 Scherrer 결정자 크기 추정값은 유효 피크 {sch['n_used_peaks']}개 기준 평균 {sch['mean_nm']} nm "
                        f"(범위 {sch['range_nm'][0]}–{sch['range_nm'][1]} nm, {sch['instrument_correction_label']})입니다."
                    ),
                    "evidence_ids": ["XRD-SCHERRER"],
                }
            )
            if not sch["is_instrument_corrected"]:
                checks_needed.append("기기 선폭 보정 데이터가 입력되지 않아 Scherrer 결정자 크기가 하한 추정값(기기 선폭 미보정 추정값)으로 계산되었습니다.")
        else:
            checks_needed.append(f"Scherrer 결정자 크기 계산 불가: {sch['reason']}")

        wh = xrd_res.get("williamson_hall", {})
        if wh.get("enabled") and wh.get("crystallite_size_nm") is not None:
            strain_txt = f", 미세변형률 ε = {wh['microstrain']}" if wh.get("microstrain") is not None else " (음의 기울기로 미세변형 정량 제한)"
            xrd_facts.append(
                {
                    "text": (
                        f"Williamson–Hall 선형 회귀({wh['phase_name']} 귀속 피크 {wh['n_peaks']}개, R² = {wh['r2']}) 결과, "
                        f"절편 기반 크기 추정은 {wh['crystallite_size_nm']} nm{strain_txt}입니다."
                    ),
                    "evidence_ids": ["XRD-WH"],
                }
            )
        limitations.append("XRD 상 매칭은 활성 기준 라이브러리 내 후보 비교이며, 정확한 상분율(wt%) 정량에는 표준시료 RIR 또는 Rietveld 정밀화가 필요합니다.")

    if sem_res is not None:
        sc = sem_res["scale"]
        if not sc["is_calibrated"]:
            checks_needed.append("SEM 스케일바 실제 길이가 확정되지 않아 모든 치수가 픽셀(px) 단위로 계산되었습니다.")
        if sem_res["mode"] == "particle":
            st = sem_res["summary_stats"]
            if st is not None:
                sem_facts.append(
                    {
                        "text": (
                            f"2D SEM 입자 분할 결과(표본 수 N = {st['sample_count_n']}), 개수 기준 등가원 직경 평균은 "
                            f"{st['mean_diameter']} ± {st['std_diameter']} {st['unit']} "
                            f"(D10 = {st['d10']}, D50 = {st['d50']}, D90 = {st['d90']} {st['unit']})이며, "
                            f"면적 가중 D50은 {st['area_weighted']['d50']} {st['unit']}입니다."
                        ),
                        "evidence_ids": ["SEM-COND", "SEM-STAT-SIZE", "SEM-STAT-AREA-WEIGHTED"],
                    }
                )
                sem_facts.append(
                    {
                        "text": (
                            f"관찰된 객체(N = {st['sample_count_n']})의 형상 중앙값은 원형도(4πA/P²) {st['median_circularity']}, "
                            f"종횡비 {st['median_aspect_ratio']}입니다."
                        ),
                        "evidence_ids": ["SEM-STAT-SHAPE"],
                    }
                )
                if not sem_res.get("segmentation_confirmed"):
                    checks_needed.append("SEM 입자 분할 경계에 대한 사용자 최종 확인이 아직 체크되지 않았습니다.")
            else:
                checks_needed.append(f"SEM 입자 통계 산출 불가: {sem_res['reason']}")
        else:
            gi = sem_res.get("grain_intercept")
            if gi and gi["mean_intercept_length"] is not None:
                sem_facts.append(
                    {
                        "text": (
                            f"결정립 선형교차법 기반 추정 결과, 다방향 시험선 {gi['n_test_lines']}개(총 길이 {gi['total_line_length']} {gi['unit']})에서 "
                            f"유효 경계 교차 {gi['effective_intersections']}회가 관찰되어 평균 선형교차 길이는 {gi['mean_intercept_length']} {gi['unit']}입니다."
                        ),
                        "evidence_ids": ["SEM-COND", "SEM-GRAIN-INTERCEPT"],
                    }
                )
            else:
                checks_needed.append(f"SEM 결정립 선형교차 정량 제한: {sem_res['reason']}")
        limitations.append("SEM 측정치는 2D 투영/단면 이미지에서의 겉보기 치수이며, 화학 조성이나 결정상을 SEM 형태만으로 확정할 수 없습니다.")

    # Cross-modality section
    if has_both and not is_same:
        cross_status = "제한됨 (동일 시료 미확인)"
        cross_restriction_reason = "업로드된 XRD 파일과 SEM 이미지가 ‘동일 시료’로 확인되지 않아 두 결과를 결합한 통합 해석을 제한합니다."
    elif not has_both:
        cross_status = "단일 장비 분석"
        cross_restriction_reason = "XRD와 SEM 중 한 종류의 데이터만 업로드되어 개별 분석 요약만 제공합니다."
    else:
        cross_status = "교차 검토 가능"
        cross_restriction_reason = None
        sch_nm = xrd_res["scherrer"]["mean_nm"] if xrd_res else None
        sem_cal = sem_res["scale"]["is_calibrated"] if sem_res else False
        sem_mode = sem_res["mode"] if sem_res else "particle"

        pdbse = xrd_res.get("phase_diagram_bse") if xrd_res else None
        if pdbse and pdbse.get("enabled"):
            coex = pdbse.get("coexisting_equilibrium_neighbors", [])
            bse_rows = pdbse.get("bse_table", [])
            if coex or bse_rows:
                bse_summary_str = ", ".join(
                    f"{r['formula']}(Z_BSE={r['z_bse_eff']}, {r['bse_zone'].split(' (')[0]})"
                    for r in bse_rows[:4]
                )
                coex_str = ", ".join(coex) if coex else "단일 안정상"
                cross_notes.append(
                    {
                        "text": (
                            f"[Materials Project 상평형도 × SEM-BSE 교차 해석] {pdbse.get('chemsys')} 원소계 0 K Convex Hull에서 "
                            f"주상({pdbse.get('primary_formula')})과 Tie-Line으로 열역학적 평형 공존이 가능한 후보상은 [{coex_str}]이며, "
                            f"질량가중 유효 원자번호(Z_BSE) 기준 후방산란전자(BSE/BED-C) 명암 순서는 {bse_summary_str}입니다."
                        ),
                        "evidence_ids": ["MP-PHASE-DIAGRAM", "MP-BSE-CONTRAST"],
                    }
                )

        if sch_nm is not None and sem_cal and sem_mode == "particle" and sem_res["summary_stats"] is not None:
            st = sem_res["summary_stats"]
            d50_val = st["d50"]
            u = st["unit"]
            d50_nm = d50_val * 1000.0 if u == "µm" else d50_val
            cross_notes.append(
                {
                    "text": (
                        f"XRD 조건부 결정자 크기 추정값(평균 {sch_nm} nm, {xrd_res['scherrer']['instrument_correction_label']})과 "
                        f"SEM 2D 입자 등가원 직경 중앙값(D50 = {d50_val} {u}, 약 {d50_nm:.1f} nm, N = {st['sample_count_n']})은 "
                        "서로 다른 물리량(결맞음 회절 도메인 크기 vs 2D 투영 외형 크기)을 측정합니다."
                    ),
                    "evidence_ids": ["XRD-SCHERRER", "SEM-STAT-SIZE"],
                }
            )
            cross_notes.append(
                {
                    "text": (
                        "두 수치의 차이는 1차 결정자들이 모인 다결정 입자·부분 응집 가능성뿐만 아니라, "
                        "기기 선폭 미보정, 미세변형에 의한 XRD 선폭 확장, 또는 SEM 내 미세 일차입자 미분해 등 여러 원인으로 발생할 수 있으므로 "
                        "고정 비율만으로 상태를 단정하지 않고 TEM/암시야 영상 또는 분산 재측정으로 검증하는 것이 적절합니다."
                    ),
                    "evidence_ids": ["XRD-SCHERRER", "SEM-STAT-SIZE", "SEM-STAT-SHAPE"],
                }
            )
        elif sch_nm is not None and sem_cal and sem_mode == "grain" and sem_res.get("grain_intercept", {}).get("mean_intercept_length") is not None:
            gi = sem_res["grain_intercept"]
            cross_notes.append(
                {
                    "text": (
                        f"XRD 결맞음 회절 도메인 추정값({sch_nm} nm)과 SEM 단면 평균 선형교차 길이({gi['mean_intercept_length']} {gi['unit']})를 함께 기록했습니다. "
                        "소결 조직 내 아결정립(sub-grain)·전위 셀 구조 또는 XRD 분해능 한계 여부를 EBSD/고분해능 XRD로 추가 확인할 수 있습니다."
                    ),
                    "evidence_ids": ["XRD-SCHERRER", "SEM-GRAIN-INTERCEPT"],
                }
            )
        else:
            cross_notes.append(
                {
                    "text": (
                        "동일 시료로 확인되었으나, SEM 실치수 스케일 확정 또는 유효한 XRD 결정자 크기 산출이 완료된 후 정량 스케일 비교가 가능합니다."
                    ),
                    "evidence_ids": ["SAMPLE-META"],
                }
            )

    overview_parts = [f"시료 ‘{project_meta.get('sample_name', '미지정')}’에 대한 규칙 기반 분석 요약입니다."]
    if xrd_facts:
        overview_parts.append(xrd_facts[0]["text"])
    if sem_facts:
        overview_parts.append(sem_facts[0]["text"])
    if cross_restriction_reason:
        overview_parts.append(cross_restriction_reason)

    return {
        "generated_at": utc_now_iso(),
        "generator": "matlens-rule-engine-v1",
        "can_integrate": can_integrate,
        "cross_status": cross_status,
        "cross_restriction_reason": cross_restriction_reason,
        "overview": " ".join(overview_parts),
        "xrd_facts": xrd_facts,
        "sem_facts": sem_facts,
        "cross_notes": cross_notes,
        "checks_needed": checks_needed,
        "limitations": limitations,
        "evidence_registry": evidence_reg,
    }


def describe_external_ai_scope(
    has_xrd: bool,
    has_sem: bool,
    is_same_sample: bool,
) -> dict[str, Any]:
    """Return human-readable disclosure of exact data sent to Google Gemini API before execution."""
    items = ["시료명, 시료 설명, 예상 원소/조성, 동일 시료 확인 여부"]
    if has_xrd:
        items.append("XRD 검증 수치 요약 (측정 조건, 검출 피크 표, 상 후보 매칭 점수, 조건부 Scherrer/W-H 결과)")
    if has_sem:
        items.append("SEM 분석 영역(ROI) 이미지 1장, 분할 경계 오버레이 이미지 1장, 크기·형상 요약 통계")
    return {
        "provider": "Google Gemini API",
        "configured_model": get_gemini_model(),
        "api_key_configured": get_gemini_api_key() is not None,
        "transmitted_items": items,
        "not_transmitted_items": [
            "원본 전체 경로 및 서버 환경 정보",
            "SEM 정보 바(장비 오퍼레이터·기관명이 포함될 수 있는 영역)가 제외된 ROI만 전송",
        ],
        "same_sample_integration_enabled": bool(has_xrd and has_sem and is_same_sample),
    }


def _collect_allowed_numbers(obj: Any, out: set[float]) -> None:
    if isinstance(obj, bool) or obj is None:
        return
    if isinstance(obj, (int, float)):
        val = float(obj)
        if abs(val) < 1e8:
            out.add(val)
    elif isinstance(obj, dict):
        for v in obj.values():
            _collect_allowed_numbers(v, out)
    elif isinstance(obj, list):
        for v in obj:
            _collect_allowed_numbers(v, out)


def validate_ai_report_against_evidence(
    parsed: AIReportSchema,
    evidence_registry: dict[str, dict[str, Any]],
    can_integrate: bool,
) -> dict[str, Any]:
    """Verify evidence ID citations, numeric consistency, and absence of banned numeric AI confidence."""
    known_ids = set(evidence_registry.keys())
    cited_ids: list[str] = []
    invalid_ids: list[str] = []

    for item in parsed.xrd_observed_facts + parsed.sem_observed_facts:
        for eid in item.evidence_ids:
            cited_ids.append(eid)
            if eid not in known_ids:
                invalid_ids.append(eid)

    for hyp in parsed.integrated_hypotheses:
        for eid in hyp.basis_ids:
            cited_ids.append(eid)
            if eid not in known_ids:
                invalid_ids.append(eid)

    for dc in parsed.discrepancies_and_checks:
        for eid in dc.related_ids:
            cited_ids.append(eid)
            if eid not in known_ids:
                invalid_ids.append(eid)

    full_text = json.dumps(parsed.model_dump(), ensure_ascii=False)
    has_banned_confidence = bool(_CONFIDENCE_BAN_RE.search(full_text))

    allowed_nums: set[float] = set()
    _collect_allowed_numbers(evidence_registry, allowed_nums)
    # Also allow unit-converted nm <-> µm equivalents of SEM numbers
    for n in list(allowed_nums):
        allowed_nums.add(n * 1000.0)
        if n != 0:
            allowed_nums.add(n / 1000.0)

    mentioned_unit_numbers: list[float] = []
    unmatched_numbers: list[float] = []
    for m in _NUMBER_TOKEN_RE.finditer(full_text):
        try:
            v = float(m.group(1))
        except ValueError:
            continue
        mentioned_unit_numbers.append(v)
        if allowed_nums:
            matched = any(abs(v - a) <= max(0.55, 0.025 * max(abs(a), 1.0)) for a in allowed_nums)
            if not matched:
                unmatched_numbers.append(v)

    warnings: list[str] = []
    if invalid_ids:
        warnings.append(f"등록되지 않은 결과 ID 참조 {len(set(invalid_ids))}건이 감지되었습니다: {sorted(set(invalid_ids))}")
    if has_banned_confidence:
        warnings.append("숫자로 된 AI 신뢰도/확률 표현이 감지되어 주의 표시했습니다.")
    if unmatched_numbers:
        warnings.append(f"엔진 요약 표에서 직접 일치하지 않는 단위 수치 {sorted(set(unmatched_numbers))}가 포함되어 있으니 원문 수치를 대조하세요.")
    if not can_integrate and len(parsed.integrated_hypotheses) > 0:
        warnings.append("동일 시료 미확인 또는 단일 분석 상태에서 통합 가설 항목이 생성되어 제한 안내로 대체합니다.")

    return {
        "all_evidence_ids_valid": len(invalid_ids) == 0,
        "cited_evidence_count": len(set(cited_ids)),
        "invalid_evidence_ids": sorted(set(invalid_ids)),
        "has_banned_confidence_score": has_banned_confidence,
        "unmatched_unit_numbers": sorted(set(unmatched_numbers)),
        "passed_all_checks": len(invalid_ids) == 0 and not has_banned_confidence and len(unmatched_numbers) == 0,
        "warnings": warnings,
    }


SYSTEM_PROMPT = """당신은 재료과학 결정학(XRD), 전자현미경 미세구조(SEM), 및 재료 공정(합성/열처리/소결) 통합 분석 보조 전문가입니다.
반드시 아래 규칙을 엄격히 준수하여 한국어 JSON 스키마로만 응답하세요.

[필수 준수 원칙]
1. 입력된 evidence_registry에 없는 측정 수치나 결정상 이름을 절대 만들어내지 마세요.
2. 사용자가 입력한 시료 설명 및 합성/공정/열처리 이력(SAMPLE-META의 description)이 존재할 경우, 이를 반드시 참작하여 상형성 과정(결정화, 이차상 석출, 결정립 성장, 산화 등) 및 열역학적 거동과 연결하여 해석 가설(integrated_hypotheses)과 총괄 요약(executive_summary)에 반영하세요.
3. 모든 수치는 입력된 분석 엔진 계산값을 그대로 인용하고, 각 문장의 evidence_ids / basis_ids에 정확한 결과 ID(예: "XRD-PHASE-1", "XRD-SCHERRER", "SEM-STAT-SIZE", "SAMPLE-META")를 연결하세요.
4. 관찰 사실(xrd_observed_facts, sem_observed_facts)과 해석 가설(integrated_hypotheses)을 엄격히 구분하세요.
5. SEM 이미지의 입자 형태만으로 화학 조성이나 결정상을 확정하지 마세요.
6. SEM 2D 입자 크기(외형 투영 치수)와 XRD Scherrer 결정자 크기(결맞음 회절 도메인 크기)를 동일시하지 마세요.
7. 두 크기의 차이를 응집(agglomeration)이나 다결정성(polycrystallinity)의 '확정 증거'로 단정하지 말고, 기기 선폭 미보정·미세변형·2D 투영 한계 등 대안적 원인을 caveats에 함께 서술하세요.
8. 보편적 물리 근거가 없는 고정 비율 임계값(예: "비율이 2 이상이면 무조건 다결정" 등)으로 상태를 판정하지 마세요.
9. 숫자로 된 AI 신뢰도나 정답 확률(예: "신뢰도 95%", "확률 90%")을 절대 작성하지 마세요.
10. can_integrate가 false인 경우(단일 파일이거나 동일 시료 미확인), integrated_hypotheses는 빈 배열([])로 두세요.
"""


def discover_available_gemini_models() -> list[dict[str, str]]:
    """Return available Gemini model options, dynamically enriched from Google GenAI API when a key is present."""
    base_options = list(GEMINI_MODEL_OPTIONS)
    api_key = get_gemini_api_key()
    if not api_key:
        return base_options
    try:
        from google import genai

        client = genai.Client(api_key=api_key)
        seen_ids = {opt["id"] for opt in base_options}
        for m in client.models.list():
            raw_name = getattr(m, "name", "") or ""
            short_id = raw_name.replace("models/", "").strip()
            if (
                short_id.startswith("gemini-")
                and "embedding" not in short_id
                and "imagen" not in short_id
                and "veo" not in short_id
                and "tts" not in short_id
                and short_id not in seen_ids
            ):
                seen_ids.add(short_id)
                base_options.append({"id": short_id, "label": f"{short_id} (계정 가용 모델)"})
    except Exception:
        pass
    return base_options


def generate_gemini_interpretation(
    project_meta: dict[str, Any],
    rule_summary: dict[str, Any],
    roi_png_bytes: bytes | None = None,
    overlay_png_bytes: bytes | None = None,
    override_model: str | None = None,
) -> dict[str, Any]:
    """Call Google Gemini API with structured JSON Schema output, automatic multi-version fallback, and reference validation."""
    api_key = get_gemini_api_key()
    preferred_model = (override_model or get_gemini_model() or "auto").strip()

    if not api_key:
        return {
            "status": "failed",
            "model_name": preferred_model,
            "prompt_version": AI_PROMPT_VERSION,
            "schema_valid": False,
            "reference_check": {},
            "report": None,
            "error_message": "Gemini API 키가 아직 설정되지 않았습니다. 상단 'API·모델 설정' 버튼 또는 api_config.txt 파일에서 키를 입력한 뒤 재시도해주세요.",
            "created_at": utc_now_iso(),
        }

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)
        evidence_registry = rule_summary["evidence_registry"]
        can_integrate = bool(rule_summary["can_integrate"])

        prompt_payload = {
            "sample_context": {
                "sample_name": project_meta.get("sample_name"),
                "description": project_meta.get("description"),
                "expected_formula": project_meta.get("expected_formula"),
                "expected_elements": project_meta.get("expected_elements", []),
                "is_same_sample": bool(project_meta.get("is_same_sample", False)),
                "can_integrate": can_integrate,
            },
            "rule_checks_needed": rule_summary.get("checks_needed", []),
            "evidence_registry": evidence_registry,
        }

        contents: list[Any] = []
        if roi_png_bytes:
            contents.append(types.Part.from_bytes(data=roi_png_bytes, mime_type="image/png"))
        if overlay_png_bytes:
            contents.append(types.Part.from_bytes(data=overlay_png_bytes, mime_type="image/png"))
        contents.append(
            "아래 검증된 분석 엔진 결과(evidence_registry)와 첨부된 SEM ROI/분할 오버레이 이미지를 바탕으로 "
            "지정된 JSON 스키마에 맞춰 통합 분석 보조 해석을 작성하세요.\n\n"
            + json.dumps(prompt_payload, ensure_ascii=False, indent=2)
        )

        cfg = types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            response_mime_type="application/json",
            response_schema=AIReportSchema,
            temperature=0.15,
        )

        # Build automatic multi-version candidate list:
        # 1) User's preferred model (unless "auto")
        # 2) Curated multi-version fallback chain (2.5-flash, 2.0-flash, 2.5-flash-lite, flash-latest, 2.5-pro, 1.5-flash, 1.5-pro...)
        # 3) Any additional dynamically discovered Gemini models on the user's account
        candidate_models: list[str] = []
        if preferred_model and preferred_model.lower() != "auto":
            candidate_models.append(preferred_model)
        for fb in GEMINI_FALLBACK_ORDER:
            if fb not in candidate_models:
                candidate_models.append(fb)
        try:
            for m in client.models.list():
                short_id = (getattr(m, "name", "") or "").replace("models/", "").strip()
                if (
                    short_id.startswith("gemini-")
                    and "embedding" not in short_id
                    and "imagen" not in short_id
                    and "veo" not in short_id
                    and "tts" not in short_id
                    and short_id not in candidate_models
                ):
                    candidate_models.append(short_id)
        except Exception:
            pass

        raw_json_text = None
        used_model = candidate_models[0] if candidate_models else "gemini-2.5-flash"
        last_exc: Exception | None = None
        tried_models: list[str] = []

        for m_name in candidate_models:
            tried_models.append(m_name)
            try:
                resp = client.models.generate_content(model=m_name, contents=contents, config=cfg)
                raw_json_text = resp.text
                used_model = m_name
                if raw_json_text:
                    break
            except Exception as exc:
                last_exc = exc
                msg_up = str(exc).upper()
                if "API_KEY_INVALID" in msg_up or "API KEY NOT VALID" in msg_up:
                    break
                continue

        if not raw_json_text:
            raise RuntimeError(
                f"시도한 Gemini 버전({', '.join(tried_models[:5])})에서 응답을 받지 못했습니다: "
                f"{type(last_exc).__name__ if last_exc else 'EmptyResponse'} ({last_exc})"
            )

        parsed = AIReportSchema.model_validate_json(raw_json_text)
        if not can_integrate:
            parsed.integrated_hypotheses = []

        ref_check = validate_ai_report_against_evidence(parsed, evidence_registry, can_integrate)

        # Scrub any invalid evidence IDs so UI links stay clean while keeping audit record in ref_check
        valid_set = set(evidence_registry.keys())
        for item in parsed.xrd_observed_facts + parsed.sem_observed_facts:
            item.evidence_ids = [eid for eid in item.evidence_ids if eid in valid_set]
        for hyp in parsed.integrated_hypotheses:
            hyp.basis_ids = [eid for eid in hyp.basis_ids if eid in valid_set]
        for dc in parsed.discrepancies_and_checks:
            dc.related_ids = [eid for eid in dc.related_ids if eid in valid_set]

        return {
            "status": "completed",
            "model_name": used_model,
            "prompt_version": AI_PROMPT_VERSION,
            "schema_valid": True,
            "reference_check": ref_check,
            "report": parsed.model_dump(),
            "error_message": None,
            "created_at": utc_now_iso(),
        }
    except Exception as exc:
        # Sanitize error message so API keys are never echoed
        safe_msg = re.sub(r"AIza[0-9A-Za-z\-_]{20,}", "[REDACTED]", str(exc))
        return {
            "status": "failed",
            "model_name": preferred_model,
            "prompt_version": AI_PROMPT_VERSION,
            "schema_valid": False,
            "reference_check": {},
            "report": None,
            "error_message": f"AI 해석 생성 중 오류가 발생했습니다: {safe_msg[:240]}",
            "created_at": utc_now_iso(),
        }


# ---------------- SEM Grain-by-Grain Phase Identification via Gemini Vision ---------------- #
class GrainPhaseZoneAIItem(BaseModel):
    zone: str = Field(..., description="matrix | bright | dark")
    predicted_formula: str = Field(..., description="추정 결정상 화학식 (예: NbFeSb, NbSb2, Fe2Nb)")
    reasoning: str = Field(..., description="SEM 명암 대비(Z_BSE), 면적 분율, XRD 상 매칭 및 상평형도에 기반한 판별 근거")


class GrainPhaseAIItem(BaseModel):
    grain_id: str = Field(..., description="결정립 ID (예: G1, G2...)")
    predicted_formula: str = Field(..., description="해당 결정립의 추정 상 화학식 (예: NbFeSb, NbSb2, Fe2Nb)")
    phase_role: str = Field(..., description="조직 내 역할 (예: 주상 기지 결정립, 고-Z 밝은 석출상 결정립, 저-Z 어두운 입계 이차상)")
    ai_explanation: str = Field(..., description="해당 결정립의 밝기(명암 대비), 크기, 위치 및 형태를 바탕으로 한 구체적인 상(Phase) 판별 설명")


class GrainPhaseAISchema(BaseModel):
    ai_overall_summary: str = Field(..., description="SEM 미세조직 내 결정립들의 구성 상(Phase) 분포 및 형성 메커니즘 종합 요약")
    zone_interpretations: list[GrainPhaseZoneAIItem]
    grain_items: list[GrainPhaseAIItem]
    eds_verification_tip: str = Field(..., description="각 결정립(G1~GN)의 상 확증을 위한 SEM-EDS 점분석/맵핑 원소 확인 가이드")


def _annotate_roi_with_grains(roi_png_bytes: bytes | None, grains: list[dict[str, Any]]) -> bytes | None:
    if not roi_png_bytes or not grains:
        return roi_png_bytes
    try:
        import cv2
        import numpy as np
        from PIL import Image

        with Image.open(io.BytesIO(roi_png_bytes)) as im:
            rgb = np.asarray(im.convert("RGB"), dtype=np.uint8).copy()

        color_map = {
            "matrix": (49, 130, 246),   # Blue
            "bright": (245, 158, 11),   # Amber
            "dark": (16, 185, 129),     # Emerald
        }
        for g in grains:
            col = color_map.get(g.get("zone", "matrix"), (49, 130, 246))
            min_c, min_r, max_c, max_r = g.get("bbox", [0, 0, 10, 10])
            cx, cy = int(round(g.get("roi_x", 0))), int(round(g.get("roi_y", 0)))
            cv2.rectangle(rgb, (min_c, min_r), (max_c, max_r), col, 2)
            cv2.circle(rgb, (cx, cy), 4, col, -1)
            label = g.get("grain_id", "G")
            cv2.putText(rgb, label, (max(4, cx - 12), max(16, cy - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 3, cv2.LINE_AA)
            cv2.putText(rgb, label, (max(4, cx - 12), max(16, cy - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, col, 1, cv2.LINE_AA)

        buf = io.BytesIO()
        Image.fromarray(rgb).save(buf, format="PNG")
        return buf.getvalue()
    except Exception:
        return roi_png_bytes


def generate_grain_phase_ai_interpretation(
    project_meta: dict[str, Any],
    sem_res: dict[str, Any],
    xrd_res: dict[str, Any] | None = None,
    roi_png_bytes: bytes | None = None,
    override_model: str | None = None,
) -> dict[str, Any]:
    """Use Gemini Multimodal Vision to analyze each detected SEM grain (G1..G12) and identify what phase it is composed of."""
    gpm = sem_res.get("grain_phase_map")
    if not gpm or not gpm.get("enabled"):
        return sem_res

    api_key = get_gemini_api_key()
    if not api_key:
        gpm["ai_status"] = "failed"
        gpm["ai_error"] = "Gemini API 키가 설정되지 않아 규칙 기반 상 매핑만 표시됩니다."
        return sem_res

    preferred_model = (override_model or get_gemini_model() or "auto").strip()
    fast_candidates: list[str] = []
    if preferred_model and preferred_model.lower() != "auto":
        fast_candidates.append(preferred_model)
    for m_id in ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.1-flash-lite", *GEMINI_FALLBACK_ORDER]:
        if m_id not in fast_candidates:
            fast_candidates.append(m_id)

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)
        annotated_png = _annotate_roi_with_grains(roi_png_bytes, gpm.get("grains", []))

        xrd_context = None
        if xrd_res:
            cands = xrd_res.get("phase_matching", {}).get("candidates", [])[:5]
            pdbse = xrd_res.get("phase_diagram_bse", {})
            xrd_context = {
                "top_xrd_candidates": [
                    {
                        "formula": c.get("formula"),
                        "name": c.get("name"),
                        "spacegroup": c.get("spacegroup"),
                        "score": c.get("score"),
                        "mp_id": c.get("mp_id"),
                        "z_bse_eff": c.get("z_bse_eff"),
                        "e_hull_ev": c.get("e_hull_ev"),
                    }
                    for c in cands
                ],
                "coexisting_tie_line_phases": pdbse.get("coexisting_equilibrium_neighbors", []),
                "bse_contrast_table": pdbse.get("bse_table", []),
            }

        prompt_data = {
            "sample_name": project_meta.get("sample_name"),
            "sample_description_and_process": project_meta.get("description"),
            "expected_formula": project_meta.get("expected_formula"),
            "expected_elements": project_meta.get("expected_elements", []),
            "sem_mode": sem_res.get("mode_label"),
            "roi_mean_intensity": gpm.get("roi_mean_intensity"),
            "multi_otsu_thresholds": gpm.get("thresholds"),
            "zones": gpm.get("zones", []),
            "detected_grains": [
                {
                    "grain_id": g["grain_id"],
                    "zone": g["zone"],
                    "mean_intensity": g["mean_intensity"],
                    "contrast_delta_pct": g["contrast_delta_pct"],
                    "equiv_diameter": f"{g['equiv_diameter']} {g['unit']}",
                    "area": f"{g['area']} {g['area_unit']}",
                    "initial_predicted_formula": g["predicted_formula"],
                    "z_bse_eff": g.get("z_bse_eff"),
                }
                for g in gpm.get("grains", [])
            ],
            "xrd_and_mp_phase_context": xrd_context,
        }

        sys_inst = (
            "당신은 전자현미경(SEM/BSE) 미세구조, 결정학(XRD, 상평형도), 및 재료 공정(합성/열처리/소결) 통합 분석 전문가입니다. "
            "첨부된 SEM 이미지(G1~G12 결정립 마커 표시됨)와 정량 명암·크기 데이터, XRD/Materials Project 상평형(Z_BSE) 데이터, "
            "그리고 사용자가 입력한 시료 설명 및 합성/공정/열처리 이력(sample_description_and_process)을 바탕으로, "
            "공정 과정에서 일어난 상전이, 소결 거동, 이차상 석출을 고려하여 각 결정립(G1~G12)과 명암 영역(matrix, bright, dark)이 "
            "어떤 결정상(Phase) 물질로 이루어져 있는지 한국어로 명확하고 과학적으로 분석하세요. "
            "SEM 이미지 단독으로는 화학 조성을 100% 단정할 수 없음을 함께 안내하고, 후방산란전자 명암 대비(Z_BSE = Σ w_i Z_i)와 XRD 주상/공존상 근거, 그리고 공정 조건을 연결해 설명하세요."
        )

        contents: list[Any] = []
        if annotated_png:
            contents.append(types.Part.from_bytes(data=annotated_png, mime_type="image/png"))
        contents.append(
            "아래 SEM 결정립 정량 데이터 및 XRD/MP 상 정보를 바탕으로 각 결정립(G1~GN)이 어떤 상(Phase)으로 이루어진 물질인지 JSON 스키마에 맞춰 분석하세요:\n\n"
            + json.dumps(prompt_data, ensure_ascii=False, indent=2)
        )

        cfg = types.GenerateContentConfig(
            system_instruction=sys_inst,
            response_mime_type="application/json",
            response_schema=GrainPhaseAISchema,
            temperature=0.15,
        )

        raw_json = None
        used_model = fast_candidates[0]
        for m_name in fast_candidates:
            try:
                resp = client.models.generate_content(model=m_name, contents=contents, config=cfg)
                if resp.text:
                    raw_json = resp.text
                    used_model = m_name
                    break
            except Exception as exc:
                if "API_KEY_INVALID" in str(exc).upper():
                    break
                continue

        if not raw_json:
            raise RuntimeError("가용한 Gemini 모델에서 응답을 받지 못했습니다.")

        parsed = GrainPhaseAISchema.model_validate_json(raw_json)
        gpm["ai_status"] = "completed"
        gpm["ai_model"] = used_model
        gpm["ai_overall_summary"] = parsed.ai_overall_summary
        gpm["eds_verification_tip"] = parsed.eds_verification_tip

        zone_map = {z.zone: z for z in parsed.zone_interpretations}
        for z_obj in gpm.get("zones", []):
            zm = zone_map.get(z_obj["zone"])
            if zm:
                if zm.predicted_formula:
                    z_obj["predicted_formula"] = zm.predicted_formula
                if zm.reasoning:
                    z_obj["reasoning"] = zm.reasoning

        grain_map = {gi.grain_id: gi for gi in parsed.grain_items}
        for g_obj in gpm.get("grains", []):
            gm = grain_map.get(g_obj["grain_id"])
            if gm:
                if gm.predicted_formula:
                    g_obj["predicted_formula"] = gm.predicted_formula
                if gm.phase_role:
                    g_obj["phase_role"] = gm.phase_role
                if gm.ai_explanation:
                    g_obj["ai_explanation"] = gm.ai_explanation

    except Exception as exc:
        gpm["ai_status"] = "rule_fallback"
        gpm["ai_error"] = str(exc)[:200]

    return sem_res
