"""Condition Checker & Comparability Gate.

Enforces critical development rules:
1. Never directly compare data when mandatory conditions differ.
2. Restricts quantitative benchmarking if heat treatment, test temperature, strain rate, or specimen geometry do not align.
"""
from __future__ import annotations

from typing import Any
from ...schemas_literature import ConditionCompatibility, ConditionStatus


def check_conditions(
    instrument_type: str,
    meas_conditions: dict[str, Any],
    lit_conditions: dict[str, Any],
) -> ConditionCompatibility:
    mismatches: list[str] = []
    status: ConditionStatus = "compatible"

    inst = instrument_type.upper()
    if inst == "XRD":
        meas_wl = meas_conditions.get("wavelength_angstrom")
        lit_wl = lit_conditions.get("wavelength_angstrom")
        if meas_wl and lit_wl and abs(float(meas_wl) - float(lit_wl)) > 0.005:
            mismatches.append(f"X선 파장 불일치 (실측: {meas_wl} Å, 문헌: {lit_wl} Å). 2θ 각도 직접 비교 시 Bragg 방정식 기반 보정 필수.")

        meas_temp = meas_conditions.get("temperature_K")
        lit_temp = lit_conditions.get("temperature_K")
        if meas_temp and lit_temp and abs(float(meas_temp) - float(lit_temp)) > 30.0:
            mismatches.append(f"측정 온도 차이 (실측: {meas_temp} K, 문헌: {lit_temp} K). 격자 열팽창 계수(CTE) 영향 고려 필요.")

    elif inst == "UTM":
        # Heat treatment is critical for mechanical properties
        meas_ht = str(meas_conditions.get("heat_treatment") or "").strip().lower()
        lit_ht = str(lit_conditions.get("heat_treatment") or "").strip().lower()
        if meas_ht and lit_ht and meas_ht != lit_ht:
            mismatches.append(
                f"열처리 상태 불일치 (실측: '{meas_ht}', 문헌: '{lit_ht}'). 미세조직(석출상/전위밀도)이 다르므로 항복강도 직접 정량 비교 불가."
            )

        meas_sr = meas_conditions.get("strain_rate_per_sec")
        lit_sr = lit_conditions.get("strain_rate_per_sec")
        if meas_sr and lit_sr and abs(float(meas_sr) - float(lit_sr)) > 0.01:
            mismatches.append(f"변형률 속도 불일치 (실측: {meas_sr}/s, 문헌: {lit_sr}/s). 가공경화 및 유동응력 동적 거동 차이 유발.")

        meas_temp = meas_conditions.get("test_temperature_K") or meas_conditions.get("temperature_K")
        lit_temp = lit_conditions.get("test_temperature_K") or lit_conditions.get("temperature_K")
        if meas_temp and lit_temp and abs(float(meas_temp) - float(lit_temp)) > 25.0:
            mismatches.append(f"시험 온도 불일치 (실측: {meas_temp} K, 문헌: {lit_temp} K). 소성 변형 기구(열활성화 slip) 차이 발생.")

    elif inst == "SEM":
        meas_mag = meas_conditions.get("magnification")
        lit_mag = lit_conditions.get("magnification")
        if meas_mag and lit_mag and abs(float(meas_mag) - float(lit_mag)) > 10000:
            mismatches.append(f"관찰 배율 현저한 차이 (실측: {meas_mag}x, 문헌: {lit_mag}x). 분해능 한계에 따른 입경 분포 편향 주의.")

    direct_allowed = True
    warning = None
    if mismatches:
        if any("열처리 상태 불일치" in m for m in mismatches) or len(mismatches) >= 2:
            status = "incompatible"
            direct_allowed = False
            warning = f"필수 실험 조건 불일치로 직접 비교가 금지됩니다: {'; '.join(mismatches)}"
        else:
            status = "conditionally_compatible"
            direct_allowed = True
            warning = f"조건 불일치에 따른 편차 가능성 주의: {'; '.join(mismatches)}"

    return ConditionCompatibility(
        material_similarity=1.0,
        crystal_or_micro_similarity=1.0,
        experimental_method_similarity=1.0,
        condition_compatibility=status,
        condition_mismatches=mismatches,
        direct_comparison_allowed=direct_allowed,
        direct_comparison_warning=warning,
    )
