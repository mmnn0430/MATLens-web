"""Cross-Instrument Integrated Analysis Engine for MatLens 2.0.

Integrates:
- XRD: Crystal structure, phase identification, lattice parameters, Scherrer crystallite size
- SEM: Microstructure, grain size, morphology, porosity
- Hall Effect: Carrier concentration, carrier mobility, electrical conductivity
- LFA: Thermal diffusivity, specific heat, thermal conductivity
- UTM: Young's modulus, yield strength, tensile ductility

Correlations:
- XRD + SEM: Scherrer crystallite size vs SEM grain size (crystallite != grain!)
- XRD + Hall: Lattice expansion vs dopant activation
- SEM + Hall: Grain boundary barrier scattering (Petritz model)
- SEM + LFA: Porosity & boundary phonon scattering (Maxwell-Eucken relation)
- Hall + LFA: Wiedemann-Franz Law electronic vs lattice thermal conductivity (kappa = kappa_e + kappa_L)
- Full Chain: Processing -> Structure -> Microstructure -> Transport -> Mechanics
"""
from __future__ import annotations

import math
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
        synthesis_to_properties_chain: List[Dict[str, Any]] = None,
        grounded_claims: List[Dict[str, Any]] = None,
        warnings: List[str] = None,
        notes: List[str] = None,
    ):
        self.sample_id = sample_id
        self.material_name = material_name
        self.instruments_included = instruments_included
        self.wiedemann_franz = wiedemann_franz
        self.xrd_sem_correlation = xrd_sem_correlation
        self.sem_hall_correlation = sem_hall_correlation
        self.sem_lfa_correlation = sem_lfa_correlation
        self.xrd_hall_correlation = xrd_hall_correlation
        self.synthesis_to_properties_chain = synthesis_to_properties_chain or []
        self.grounded_claims = grounded_claims or []
        self.warnings = warnings or []
        self.notes = notes or []

    def to_dict(self) -> Dict[str, Any]:
        return {
            "sample_id": self.sample_id,
            "material_name": self.material_name,
            "instruments_included": self.instruments_included,
            "wiedemann_franz": self.wiedemann_franz,
            "xrd_sem_correlation": self.xrd_sem_correlation,
            "sem_hall_correlation": self.sem_hall_correlation,
            "sem_lfa_correlation": self.sem_lfa_correlation,
            "xrd_hall_correlation": self.xrd_hall_correlation,
            "synthesis_to_properties_chain": self.synthesis_to_properties_chain,
            "grounded_claims": self.grounded_claims,
            "warnings": self.warnings,
            "notes": self.notes,
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

    electronic_fraction_pct = (kappa_e / total_thermal_conductivity_W_mK) * 100.0 if total_thermal_conductivity_W_mK > 0 else 0.0
    lattice_fraction_pct = (kappa_L / total_thermal_conductivity_W_mK) * 100.0 if total_thermal_conductivity_W_mK > 0 else 100.0

    dominant_mechanism = "Lattice-dominated (Phonon transport)" if lattice_fraction_pct >= 50.0 else "Carrier-dominated (Electronic transport)"

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


def perform_cross_instrument_analysis(
    sample_id: str,
    material_name: str,
    xrd_data: Optional[Dict[str, Any]] = None,
    sem_data: Optional[Dict[str, Any]] = None,
    hall_data: Optional[Dict[str, Any]] = None,
    lfa_data: Optional[Dict[str, Any]] = None,
    utm_data: Optional[Dict[str, Any]] = None,
    temperature_K: float = 300.0,
) -> IntegratedAnalysisResult:
    """Executes holistic multi-instrument materials analysis across XRD, SEM, Hall, LFA, and UTM."""
    instruments: List[str] = []
    claims: List[Dict[str, Any]] = []
    warnings: List[str] = []
    notes: List[str] = []

    if xrd_data:
        instruments.append("XRD")
    if sem_data:
        instruments.append("SEM")
    if hall_data:
        instruments.append("Hall")
    if lfa_data:
        instruments.append("LFA")
    if utm_data:
        instruments.append("UTM")

    # 1. Hall + LFA (Wiedemann-Franz Law)
    wf_result = None
    if hall_data and lfa_data:
        # Electrical conductivity in S/m:
        cond_S_cm = hall_data.get("electrical_conductivity_S_cm")
        kappa_total = lfa_data.get("thermal_conductivity_W_mK")

        if cond_S_cm is not None and kappa_total is not None:
            cond_S_m = cond_S_cm * 100.0
            wf_result = compute_wiedemann_franz(
                electrical_conductivity_S_m=cond_S_m,
                total_thermal_conductivity_W_mK=kappa_total,
                temperature_K=temperature_K,
            )
            claims.append({
                "claim_text": f"Wiedemann-Franz separation indicates {wf_result['dominant_mechanism']} with kappa_L = {wf_result['lattice_thermal_conductivity_W_mK']} W/(m*K) and kappa_e = {wf_result['electronic_thermal_conductivity_W_mK']} W/(m*K).",
                "category": "Calculated Result",
                "confidence": "High",
                "limitation_note": "Assumes standard Sommerfeld Lorenz number (2.44e-8 W*Ohm/K^2).",
            })

    # 2. XRD + SEM Correlation (Crystallite size vs Grain size)
    xrd_sem_corr = None
    if xrd_data and sem_data:
        crystallite_nm = xrd_data.get("scherrer_crystallite_size_nm") or xrd_data.get("crystallite_size_nm")
        grain_size_um = sem_data.get("mean_intercept_length_um") or sem_data.get("grain_size_um")
        xrd_sem_corr = {
            "scherrer_crystallite_size_nm": crystallite_nm,
            "sem_grain_size_um": grain_size_um,
            "conceptual_distinction": "Scherrer size reflects coherent X-ray scattering sub-domains; SEM grain size reflects physical grain boundary boundaries.",
            "interpretation": (
                f"XRD coherent domain size is {crystallite_nm} nm, while SEM optical grain diameter is {grain_size_um} µm. "
                "Each SEM grain is typically composed of multiple crystalline sub-domains separated by low-angle dislocation boundaries."
            ) if crystallite_nm and grain_size_um else "Both XRD and SEM microstructural features recorded.",
        }
        claims.append({
            "claim_text": xrd_sem_corr["conceptual_distinction"],
            "category": "Literature-Supported",
            "confidence": "High",
        })

    # 3. SEM + Hall Correlation (Grain Boundary Carrier Scattering)
    sem_hall_corr = None
    if sem_data and hall_data:
        grain_size_um = sem_data.get("mean_intercept_length_um") or sem_data.get("grain_size_um")
        mobility = hall_data.get("hall_mobility_cm2_Vs")
        sem_hall_corr = {
            "sem_grain_size_um": grain_size_um,
            "hall_mobility_cm2_Vs": mobility,
            "scattering_hypothesis": "If mobility is suppressed in fine-grained specimens, Petritz grain-boundary potential barrier scattering is a likely contributor.",
            "test_recommendation": "Confirm by temperature-dependent Hall mobility: grain-boundary scattering exhibits activated behavior (mu ~ exp(-E_B / kT)) at low-to-moderate T.",
        }
        claims.append({
            "claim_text": sem_hall_corr["scattering_hypothesis"],
            "category": "Hypothesis",
            "confidence": "Moderate",
            "limitation_note": "Grain boundary scattering must be verified by temperature-dependent Hall measurements.",
        })

    # 4. SEM + LFA Correlation (Grain Boundary Phonon Scattering & Porosity)
    sem_lfa_corr = None
    if sem_data and lfa_data:
        porosity_pct = sem_data.get("porosity_pct", 0.0)
        diffusivity = lfa_data.get("thermal_diffusivity_mm2_s")
        sem_lfa_corr = {
            "porosity_pct": porosity_pct,
            "thermal_diffusivity_mm2_s": diffusivity,
            "model": "Maxwell-Eucken Porosity Correction: kappa_eff = kappa_dense * (1 - 1.5 * porosity)",
            "interpretation": f"Observed microstructural porosity ({porosity_pct:.1f}%) introduces acoustic impedance mismatch, scattering low-frequency phonons.",
        }
        claims.append({
            "claim_text": sem_lfa_corr["interpretation"],
            "category": "Literature-Supported" if porosity_pct > 0 else "Calculated Result",
            "confidence": "Moderate",
        })

    # 5. Synthesis-to-Properties Chain
    chain: List[Dict[str, Any]] = [
        {"stage": "1. Processing", "description": f"Synthesis and thermal processing of {material_name}", "data_source": "Sample Metadata"},
        {"stage": "2. Crystal Structure", "description": f"Phase composition and lattice parameters", "data_source": "XRD" if xrd_data else "Literature nominal"},
        {"stage": "3. Microstructure", "description": f"Grain boundary density, pore distribution, second phases", "data_source": "SEM" if sem_data else "Literature nominal"},
        {"stage": "4. Carrier Transport", "description": f"Carrier density, mobility, electrical conductivity", "data_source": "Hall Effect" if hall_data else "Literature nominal"},
        {"stage": "5. Thermal Transport", "description": f"Thermal diffusivity, specific heat, thermal conductivity", "data_source": "LFA" if lfa_data else "Literature nominal"},
    ]
    if utm_data:
        chain.append({"stage": "6. Mechanical Properties", "description": f"Elastic modulus, tensile strength, fracture mode", "data_source": "UTM"})

    return IntegratedAnalysisResult(
        sample_id=sample_id,
        material_name=material_name,
        instruments_included=instruments,
        wiedemann_franz=wf_result,
        xrd_sem_correlation=xrd_sem_corr,
        sem_hall_correlation=sem_hall_corr,
        sem_lfa_correlation=sem_lfa_corr,
        synthesis_to_properties_chain=chain,
        grounded_claims=claims,
        warnings=warnings,
        notes=notes,
    )
