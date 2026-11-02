"""Materials Project (MP) API Integration, Thermodynamic Convex Hull Phase Diagram,
and SEM-BSE Atomic-Number Contrast Cross-Analysis Engine.

Features implemented:
1. Live Materials Project REST v2 query (`https://api.materialsproject.org/materials/summary/`)
   by chemical system (`chemsys`) when `MP_API_KEY` is configured in server environment variables,
   with local JSON caching (`data/mp_cache/`) and seamless fallback to curated MP metadata.
2. Thermodynamic stability classification (`energy_above_hull` E_hull and `formation_energy_per_atom` ΔH_f)
   and configurable E_hull filtering to suppress physically implausible false-positive phase matches.
3. `pymatgen.analysis.phase_diagram.PhaseDiagram` 0 K Convex Hull & Tie-Line calculation
   (both Binary ΔH_f vs composition hull and Ternary Gibbs triangle tie-lines) + equilibrium coexistence analysis.
4. Fundamental physical properties (`mp-id`, theoretical density ρ_theo, band gap E_g, metallic/semiconductor nature)
   and effective Backscattered Electron atomic number (Z_BSE = Σ w_i Z_i) for linking XRD phases to SEM BED-C contrast.
"""
from __future__ import annotations

import itertools
import json
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

import numpy as np
from pymatgen.analysis.diffraction.xrd import XRDCalculator
from pymatgen.analysis.phase_diagram import PDEntry, PhaseDiagram
from pymatgen.core import Composition, Structure

from ..config import MP_CACHE_DIR, get_mp_api_key, has_mp_api_key

# Curated Materials Project thermodynamic & physical property reference table
# (Used to enrich built-in phases and provide offline MP data when MP_API_KEY is not set)
CURATED_MP_METADATA: dict[str, dict[str, Any]] = {
    "REF-TIO2-ANA": {
        "mp_id": "mp-390",
        "e_hull_ev": 0.0,
        "formation_energy_ev": -3.231,
        "band_gap_ev": 3.20,
        "is_metal": False,
        "electronic_label": "광대역 반도체 (간접 밴드갭 ~3.20 eV)",
    },
    "REF-TIO2-RUT": {
        "mp_id": "mp-2657",
        "e_hull_ev": 0.012,
        "formation_energy_ev": -3.219,
        "band_gap_ev": 3.03,
        "is_metal": False,
        "electronic_label": "반도체 (직접/간접 밴드갭 ~3.03 eV)",
    },
    "REF-SIO2-QTZ": {
        "mp_id": "mp-7000",
        "e_hull_ev": 0.004,
        "formation_energy_ev": -3.278,
        "band_gap_ev": 5.68,
        "is_metal": False,
        "electronic_label": "절연체 (밴드갭 ~5.68 eV)",
    },
    "REF-AL2O3-COR": {
        "mp_id": "mp-1143",
        "e_hull_ev": 0.0,
        "formation_energy_ev": -3.438,
        "band_gap_ev": 5.85,
        "is_metal": False,
        "electronic_label": "절연체 (세라믹, 밴드갭 ~5.85 eV)",
    },
    "REF-ZNO-WUR": {
        "mp_id": "mp-2133",
        "e_hull_ev": 0.0,
        "formation_energy_ev": -1.802,
        "band_gap_ev": 3.37,
        "is_metal": False,
        "electronic_label": "직접천이 반도체 (밴드갭 ~3.37 eV)",
    },
    "REF-CEO2-FLU": {
        "mp_id": "mp-20194",
        "e_hull_ev": 0.0,
        "formation_energy_ev": -3.694,
        "band_gap_ev": 2.15,
        "is_metal": False,
        "electronic_label": "산소이온 전도성 산화물 반도체",
    },
    "REF-ZRO2-CUB": {
        "mp_id": "mp-1565",
        "e_hull_ev": 0.056,
        "formation_energy_ev": -3.729,
        "band_gap_ev": 3.45,
        "is_metal": False,
        "electronic_label": "고온상/안정화 지르코니아 (절연체)",
    },
    "REF-ZRO2-MON": {
        "mp_id": "mp-2858",
        "e_hull_ev": 0.0,
        "formation_energy_ev": -3.785,
        "band_gap_ev": 3.58,
        "is_metal": False,
        "electronic_label": "상온 안정 단사정 지르코니아 (절연체)",
    },
    "REF-MGO-PER": {
        "mp_id": "mp-1265",
        "e_hull_ev": 0.0,
        "formation_energy_ev": -3.065,
        "band_gap_ev": 4.77,
        "is_metal": False,
        "electronic_label": "절연체 (내화 산화물)",
    },
    "REF-NIO-BUN": {
        "mp_id": "mp-19009",
        "e_hull_ev": 0.0,
        "formation_energy_ev": -1.245,
        "band_gap_ev": 2.20,
        "is_metal": False,
        "electronic_label": "p형 전이금속 산화물 반도체",
    },
    "REF-FE2O3-HEM": {
        "mp_id": "mp-19770",
        "e_hull_ev": 0.0,
        "formation_energy_ev": -1.708,
        "band_gap_ev": 2.10,
        "is_metal": False,
        "electronic_label": "반강자성/약강자성 산화물 반도체",
    },
    "REF-FE3O4-MAG": {
        "mp_id": "mp-19306",
        "e_hull_ev": 0.0,
        "formation_energy_ev": -1.615,
        "band_gap_ev": 0.0,
        "is_metal": True,
        "electronic_label": "준금속/하프메탈 페리자성체",
    },
    "REF-CO3O4-SPI": {
        "mp_id": "mp-18748",
        "e_hull_ev": 0.0,
        "formation_energy_ev": -1.352,
        "band_gap_ev": 1.62,
        "is_metal": False,
        "electronic_label": "스피넬 p형 반도체",
    },
    "REF-SNO2-CAS": {
        "mp_id": "mp-856",
        "e_hull_ev": 0.0,
        "formation_energy_ev": -1.964,
        "band_gap_ev": 3.60,
        "is_metal": False,
        "electronic_label": "n형 투명전도성 산화물 반도체",
    },
    "REF-CUO-TEN": {
        "mp_id": "mp-704645",
        "e_hull_ev": 0.0,
        "formation_energy_ev": -0.824,
        "band_gap_ev": 1.35,
        "is_metal": False,
        "electronic_label": "협밴드갭 산화물 반도체",
    },
    "REF-CU2O-CUP": {
        "mp_id": "mp-361",
        "e_hull_ev": 0.0,
        "formation_energy_ev": -0.602,
        "band_gap_ev": 2.17,
        "is_metal": False,
        "electronic_label": "p형 산화물 반도체",
    },
    "REF-BATIO3-TET": {
        "mp_id": "mp-5986",
        "e_hull_ev": 0.003,
        "formation_energy_ev": -3.452,
        "band_gap_ev": 3.20,
        "is_metal": False,
        "electronic_label": "강유전체 페로브스카이트 절연체",
    },
    "REF-SRTIO3-CUB": {
        "mp_id": "mp-5229",
        "e_hull_ev": 0.0,
        "formation_energy_ev": -3.479,
        "band_gap_ev": 3.25,
        "is_metal": False,
        "electronic_label": "상유전체 페로브스카이트 산화물",
    },
    "REF-SI-DIA": {
        "mp_id": "mp-149",
        "e_hull_ev": 0.0,
        "formation_energy_ev": 0.0,
        "band_gap_ev": 1.12,
        "is_metal": False,
        "electronic_label": "간접천이 반도체 (1.12 eV)",
    },
    "REF-SIC-3C": {
        "mp_id": "mp-8062",
        "e_hull_ev": 0.001,
        "formation_energy_ev": -0.342,
        "band_gap_ev": 2.36,
        "is_metal": False,
        "electronic_label": "광대역 탄화물 반도체 (2.36 eV)",
    },
    "REF-GAN-WUR": {
        "mp_id": "mp-804",
        "e_hull_ev": 0.0,
        "formation_energy_ev": -0.841,
        "band_gap_ev": 3.40,
        "is_metal": False,
        "electronic_label": "직접천이 질화물 반도체 (3.40 eV)",
    },
    "REF-C-GRA": {
        "mp_id": "mp-48",
        "e_hull_ev": 0.0,
        "formation_energy_ev": 0.0,
        "band_gap_ev": 0.0,
        "is_metal": True,
        "electronic_label": "층상 반금속 전도체 (Graphite)",
    },
    "REF-MOS2-2H": {
        "mp_id": "mp-2815",
        "e_hull_ev": 0.0,
        "formation_energy_ev": -0.916,
        "band_gap_ev": 1.23,
        "is_metal": False,
        "electronic_label": "2D 층상 칼코제나이드 반도체",
    },
    "REF-CU-FCC": {
        "mp_id": "mp-30",
        "e_hull_ev": 0.0,
        "formation_energy_ev": 0.0,
        "band_gap_ev": 0.0,
        "is_metal": True,
        "electronic_label": "FCC 금속 전도체",
    },
    "REF-AL-FCC": {
        "mp_id": "mp-134",
        "e_hull_ev": 0.0,
        "formation_energy_ev": 0.0,
        "band_gap_ev": 0.0,
        "is_metal": True,
        "electronic_label": "FCC 금속 전도체",
    },
    "REF-NI-FCC": {
        "mp_id": "mp-23",
        "e_hull_ev": 0.0,
        "formation_energy_ev": 0.0,
        "band_gap_ev": 0.0,
        "is_metal": True,
        "electronic_label": "FCC 강자성 금속",
    },
    "REF-AG-FCC": {
        "mp_id": "mp-124",
        "e_hull_ev": 0.0,
        "formation_energy_ev": 0.0,
        "band_gap_ev": 0.0,
        "is_metal": True,
        "electronic_label": "FCC 귀금속 전도체",
    },
    "REF-AU-FCC": {
        "mp_id": "mp-81",
        "e_hull_ev": 0.0,
        "formation_energy_ev": 0.0,
        "band_gap_ev": 0.0,
        "is_metal": True,
        "electronic_label": "FCC 귀금속 전도체",
    },
    "REF-FE-BCC": {
        "mp_id": "mp-13",
        "e_hull_ev": 0.0,
        "formation_energy_ev": 0.0,
        "band_gap_ev": 0.0,
        "is_metal": True,
        "electronic_label": "BCC 강자성 금속 (α-Fe)",
    },
    "REF-CACO3-CAL": {
        "mp_id": "mp-3953",
        "e_hull_ev": 0.0,
        "formation_energy_ev": -2.708,
        "band_gap_ev": 5.02,
        "is_metal": False,
        "electronic_label": "탄산염 광물 절연체",
    },
    "REF-LICOO2-R3M": {
        "mp_id": "mp-22526",
        "e_hull_ev": 0.0,
        "formation_energy_ev": -1.832,
        "band_gap_ev": 2.10,
        "is_metal": False,
        "electronic_label": "층상계 리튬이온 양극재 반도체",
    },
    "REF-LIFEPO4-PNMA": {
        "mp_id": "mp-19017",
        "e_hull_ev": 0.0,
        "formation_energy_ev": -2.411,
        "band_gap_ev": 3.70,
        "is_metal": False,
        "electronic_label": "올리빈계 양극재 (폴라론 전도체)",
    },
    # Nb-Fe-Sb Thermoelectric System
    "REF-NBFESB-HH": {
        "mp_id": "mp-9437",
        "e_hull_ev": 0.0,
        "formation_energy_ev": -0.324,
        "band_gap_ev": 0.53,
        "is_metal": False,
        "electronic_label": "p형 Half-Heusler 열전 반도체 (Eg ≈ 0.53 eV)",
    },
    "REF-FESB2-MAR": {
        "mp_id": "mp-2002",
        "e_hull_ev": 0.0,
        "formation_energy_ev": -0.106,
        "band_gap_ev": 0.04,
        "is_metal": False,
        "electronic_label": "협밴드갭 Kondo/열전 반도체 (FeSb2)",
    },
    "REF-FESB-NIC": {
        "mp_id": "mp-754",
        "e_hull_ev": 0.018,
        "formation_energy_ev": -0.068,
        "band_gap_ev": 0.0,
        "is_metal": True,
        "electronic_label": "금속성 금속간화합물 (NiAs-type FeSb)",
    },
    "REF-SB-R3M": {
        "mp_id": "mp-104",
        "e_hull_ev": 0.0,
        "formation_energy_ev": 0.0,
        "band_gap_ev": 0.0,
        "is_metal": True,
        "electronic_label": "능면체 반금속 (순수 Sb)",
    },
    "REF-NB-BCC": {
        "mp_id": "mp-75",
        "e_hull_ev": 0.0,
        "formation_energy_ev": 0.0,
        "band_gap_ev": 0.0,
        "is_metal": True,
        "electronic_label": "BCC 내화 금속 (순수 Nb)",
    },
    "REF-NB3SB-A15": {
        "mp_id": "mp-1983",
        "e_hull_ev": 0.0,
        "formation_energy_ev": -0.228,
        "band_gap_ev": 0.0,
        "is_metal": True,
        "electronic_label": "A15 금속성 금속간화합물 (Nb3Sb)",
    },
    "REF-NBSB2-C2M": {
        "mp_id": "mp-568224",
        "e_hull_ev": 0.0,
        "formation_energy_ev": -0.261,
        "band_gap_ev": 0.0,
        "is_metal": True,
        "electronic_label": "단사정 반금속/금속간화합물 (NbSb2)",
    },
}


def compute_effective_bse_z(formula: str) -> float:
    """Compute mass-fraction weighted atomic number Z_BSE = sum(w_i * Z_i),
    which governs Backscattered Electron (BSE / BED-C) brightness in SEM micrographs.
    """
    try:
        comp = Composition(formula)
        total_wt = comp.weight
        if total_wt <= 0:
            return 0.0
        z_eff = 0.0
        for el, amt in comp.items():
            wt_frac = ( float(amt) * float(el.atomic_mass) ) / float(total_wt)
            z_eff += wt_frac * float(el.Z)
        return round(float(z_eff), 2)
    except Exception:
        return 0.0


def classify_e_hull_stability(e_hull_ev: float | None) -> dict[str, str]:
    """Classify thermodynamic phase stability from Energy Above Convex Hull (eV/atom)."""
    if e_hull_ev is None:
        return {
            "tier": "unknown",
            "badge": "안정성 미상 (사용자 CIF)",
            "description": "열역학 Convex Hull 에너지가 제공되지 않은 사용자 구조입니다.",
        }
    if e_hull_ev <= 0.005:
        return {
            "tier": "stable",
            "badge": f"열역학적 안정상 (E_hull = {e_hull_ev:.3f} eV/atom)",
            "description": "0 K DFT Convex Hull 위의 기저 상태(Ground State) 평형 안정상입니다.",
        }
    if e_hull_ev <= 0.050:
        return {
            "tier": "metastable",
            "badge": f"준안정상 (E_hull = {e_hull_ev:.3f} eV/atom)",
            "description": "열역학적 평형선에서 50 meV/atom 이내에 위치하여 실험적 합성이나 급랭(As-Cast) 시 자주 관찰되는 준안정상입니다.",
        }
    return {
        "tier": "unstable",
        "badge": f"고에너지 준안정상 (E_hull = {e_hull_ev:.3f} eV/atom)",
        "description": "E_hull > 50 meV/atom인 불안정/고압상으로 일반 합성 조건에서는 출현 가능성이 낮습니다.",
    }


def enrich_entry_with_mp_properties(entry: dict[str, Any]) -> dict[str, Any]:
    """Attach MP thermodynamic & physical properties and Z_BSE to a reference library entry."""
    ref_id = entry.get("id", "")
    meta = CURATED_MP_METADATA.get(ref_id, {})
    formula = entry.get("formula", "")
    z_bse = entry.get("z_bse_eff") or compute_effective_bse_z(formula)
    e_hull = entry.get("e_hull_ev") if "e_hull_ev" in entry else meta.get("e_hull_ev")
    form_e = (
        entry.get("formation_energy_ev")
        if "formation_energy_ev" in entry
        else meta.get("formation_energy_ev")
    )
    bg = entry.get("band_gap_ev") if "band_gap_ev" in entry else meta.get("band_gap_ev")
    is_metal = entry.get("is_metal") if "is_metal" in entry else meta.get("is_metal")
    mp_id = entry.get("mp_id") or meta.get("mp_id")
    elec_label = entry.get("electronic_label") or meta.get("electronic_label")
    if not elec_label and bg is not None:
        elec_label = "금속/반금속 (Eg = 0 eV)" if (is_metal or bg <= 0.01) else f"반도체/절연체 (Eg = {bg:.2f} eV)"

    stab = classify_e_hull_stability(e_hull)
    enriched = dict(entry)
    enriched.update(
        {
            "mp_id": mp_id,
            "e_hull_ev": e_hull,
            "formation_energy_ev": form_e,
            "band_gap_ev": bg,
            "is_metal": is_metal,
            "electronic_label": elec_label or "물성 정보 없음",
            "z_bse_eff": z_bse,
            "stability_tier": stab["tier"],
            "stability_badge": stab["badge"],
            "stability_description": stab["description"],
            "dft_lattice_note": (
                "Materials Project DFT(0 K, GGA-PBE) 격자 기준 — 상온 실험 XRD 대비 약 0.5~1.2% 격자 편차(Δ2θ 이동)가 발생할 수 있습니다."
                if entry.get("is_mp_live")
                else "실험/문헌 결정구조(COD) 격자 + Materials Project 물성(mp-id, E_hull, ΔH_f) 연동"
            ),
        }
    )
    return enriched


def fetch_mp_phases_for_elements(
    elements: list[str],
    max_e_hull_ev: float = 0.15,
    force_refresh: bool = False,
) -> dict[str, Any]:
    """Query Materials Project REST API v2 for all chemical subsystems of `elements` if MP_API_KEY is set,
    cache locally, and return converted pymatgen XRD reference entries.
    """
    clean_elems = sorted({e.strip() for e in elements if e.strip()})
    if not clean_elems or len(clean_elems) > 5:
        return {
            "status": "skipped",
            "mp_api_configured": has_mp_api_key(),
            "source_mode": "curated_mp_library",
            "message": "원소가 1~5개 선택된 경우 Materials Project 화학계 검색이 활성화됩니다.",
            "entries": [],
        }

    chemsys_root = "-".join(clean_elems)
    cache_file = MP_CACHE_DIR / f"mp_{chemsys_root}_{int(max_e_hull_ev * 1000)}mev.json"
    MP_CACHE_DIR.mkdir(parents=True, exist_ok=True)

    if cache_file.exists() and not force_refresh:
        try:
            cached = json.loads(cache_file.read_text(encoding="utf-8"))
            return {
                "status": "ok",
                "mp_api_configured": has_mp_api_key(),
                "source_mode": "mp_live_cache",
                "chemsys": chemsys_root,
                "message": f"Materials Project 캐시에서 {chemsys_root} 화학계 {len(cached.get('entries', []))}개 결정구조를 불러왔습니다.",
                "entries": cached.get("entries", []),
            }
        except Exception:
            pass

    api_key = get_mp_api_key()
    if not api_key:
        return {
            "status": "curated_fallback",
            "mp_api_configured": False,
            "source_mode": "curated_mp_library",
            "chemsys": chemsys_root,
            "message": (
                f"서버에 MP_API_KEY가 설정되어 있지 않아 내장된 Materials Project 연동 데이터({chemsys_root} 계)를 사용합니다. "
                "(.env에 MP_API_KEY를 추가하면 15만+ 전체 MP 결정구조 실시간 조회가 활성화됩니다.)"
            ),
            "entries": [],
        }

    # Build all 1..N element chemical system strings (e.g., Nb, Fe, Sb, Fe-Nb, Fe-Sb, Nb-Sb, Fe-Nb-Sb)
    sub_chemsys: list[str] = []
    for r in range(1, len(clean_elems) + 1):
        for comb in itertools.combinations(clean_elems, r):
            sub_chemsys.append("-".join(sorted(comb)))

    calc = XRDCalculator(wavelength=1.5406)
    fetched_entries: list[dict[str, Any]] = []
    fields = (
        "material_id,formula_pretty,symmetry,structure,"
        "energy_above_hull,formation_energy_per_atom,band_gap,is_metal,density"
    )

    try:
        for cs in sub_chemsys:
            params = urllib.parse.urlencode(
                {
                    "chemsys": cs,
                    "energy_above_hull_min": 0.0,
                    "energy_above_hull_max": max(0.05, float(max_e_hull_ev)),
                    "_fields": fields,
                    "_limit": 25,
                }
            )
            url = f"https://api.materialsproject.org/materials/summary/?{params}"
            req = urllib.request.Request(
                url,
                headers={
                    "X-API-KEY": api_key,
                    "Accept": "application/json",
                    "User-Agent": "MatLens-MaterialsAnalysis/1.2",
                },
            )
            with urllib.request.urlopen(req, timeout=12) as resp:
                payload = json.loads(resp.read().decode("utf-8"))

            for doc in payload.get("data", []):
                mp_id = doc.get("material_id")
                struct_dict = doc.get("structure")
                if not mp_id or not struct_dict:
                    continue
                struct = Structure.from_dict(struct_dict)
                pat = calc.get_pattern(struct, scaled=True, two_theta_range=(5.0, 120.0))
                hkls = [
                    ", ".join("(" + "".join(str(i) for i in h["hkl"]) + ")" for h in fam)
                    for fam in pat.hkls
                ]
                sym = doc.get("symmetry") or {}
                sg_symbol = sym.get("symbol") or "P1"
                formula = doc.get("formula_pretty") or struct.composition.reduced_formula
                e_hull = round(float(doc.get("energy_above_hull") or 0.0), 4)
                form_e = (
                    round(float(doc.get("formation_energy_per_atom")), 4)
                    if doc.get("formation_energy_per_atom") is not None
                    else 0.0
                )
                bg = round(float(doc.get("band_gap") or 0.0), 3)
                is_metal = bool(doc.get("is_metal", bg <= 0.01))
                dens = round(float(doc.get("density") or struct.density), 3)

                entry_raw = {
                    "id": f"MP-{mp_id.upper()}",
                    "mp_id": mp_id,
                    "name": f"{formula} ({sg_symbol}, {mp_id})",
                    "formula": formula,
                    "spacegroup": sg_symbol,
                    "category": "Materials Project 실시간 조회",
                    "source": f"Materials Project REST API v2 ({mp_id}, DFT 0 K 구조 → pymatgen 계산)",
                    "is_user_cif": False,
                    "is_mp_live": True,
                    "calc_wavelength_A": 1.5406,
                    "calc_two_theta_range": [5.0, 120.0],
                    "lattice": [round(float(v), 4) for v in struct.lattice.parameters],
                    "elements": sorted({str(e) for e in struct.composition.elements}),
                    "density_g_cm3": dens,
                    "e_hull_ev": e_hull,
                    "formation_energy_ev": form_e,
                    "band_gap_ev": bg,
                    "is_metal": is_metal,
                    "two_theta_cu": [round(float(v), 4) for v in pat.x],
                    "intensity": [round(float(v), 2) for v in pat.y],
                    "d_A": [round(float(v), 5) for v in pat.d_hkls],
                    "hkl": hkls,
                }
                fetched_entries.append(enrich_entry_with_mp_properties(entry_raw))

        if fetched_entries:
            cache_file.write_text(
                json.dumps({"chemsys": chemsys_root, "entries": fetched_entries}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        return {
            "status": "ok",
            "mp_api_configured": True,
            "source_mode": "mp_live_api",
            "chemsys": chemsys_root,
            "message": f"Materials Project API에서 {chemsys_root} 화학계 {len(fetched_entries)}개 결정구조를 실시간 동기화했습니다.",
            "entries": fetched_entries,
        }
    except Exception as exc:
        return {
            "status": "error_fallback",
            "mp_api_configured": True,
            "source_mode": "curated_mp_library",
            "chemsys": chemsys_root,
            "message": f"Materials Project 실시간 호출 중 네트워크/키 예외가 발생하여 내장 MP 데이터를 사용합니다 ({exc}).",
            "entries": [],
        }


def compute_phase_diagram_and_bse_analysis(
    ref_entries: list[dict[str, Any]],
    expected_elements: list[str],
    top_candidates: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build a 0 K Convex Hull Phase Diagram (using pymatgen.analysis.phase_diagram)
    and Backscattered Electron (SEM-BSE Z_eff) contrast mapping for the active chemical system.
    """
    # Determine chemical system elements (from user Periodic Table selection or top XRD candidate)
    elems = sorted({e.strip() for e in expected_elements if e.strip()})
    if not elems and top_candidates:
        elems = sorted(set(top_candidates[0].get("elements", [])))
    if not elems or len(elems) > 4:
        return {
            "enabled": False,
            "reason": "주기율표에서 2~3개 원소(예: Nb-Fe-Sb, Ti-O)를 선택하면 상평형도(Phase Diagram)와 SEM-BSE 명암 대조 분석이 생성됩니다.",
        }

    elem_set = set(elems)
    sys_entries = [
        enrich_entry_with_mp_properties(e)
        for e in ref_entries
        if set(e.get("elements", [])).issubset(elem_set)
    ]

    # Build pymatgen PDEntry objects using per-atom formation energy (E_total = N_atoms * ΔH_f)
    pd_entries: list[PDEntry] = []
    entry_by_formula: dict[str, dict[str, Any]] = {}
    present_pure_elems: set[str] = set()

    for e in sys_entries:
        formula = e["formula"]
        form_e = e.get("formation_energy_ev")
        if form_e is None:
            continue
        comp = Composition(formula)
        if len(comp.elements) == 1:
            present_pure_elems.add(str(comp.elements[0]))
        total_e = float(form_e) * float(comp.num_atoms)
        pd_entries.append(PDEntry(comp, total_e, name=e["id"]))
        if formula not in entry_by_formula or (e.get("e_hull_ev") or 0.0) < (entry_by_formula[formula].get("e_hull_ev") or 9.0):
            entry_by_formula[formula] = e

    # Ensure every terminal element has a 0 eV/atom reference state so PhaseDiagram never fails
    for el_sym in elems:
        if el_sym not in present_pure_elems:
            comp = Composition(el_sym)
            pd_entries.append(PDEntry(comp, 0.0, name=f"PURE-{el_sym}"))
            entry_by_formula.setdefault(
                el_sym,
                enrich_entry_with_mp_properties(
                    {
                        "id": f"PURE-{el_sym}",
                        "name": f"{el_sym} (순수 원소 기준상)",
                        "formula": el_sym,
                        "spacegroup": "-",
                        "elements": [el_sym],
                        "e_hull_ev": 0.0,
                        "formation_energy_ev": 0.0,
                        "band_gap_ev": 0.0,
                        "is_metal": True,
                        "density_g_cm3": None,
                    }
                ),
            )

    try:
        pd_obj = PhaseDiagram(pd_entries)
    except Exception as exc:
        return {
            "enabled": False,
            "reason": f"상평형도 구성 중 수치 예외가 발생했습니다: {exc}",
        }

    # Helper to compute 2D plotting coordinates:
    # - For 2 elements (A-B): x = atomic fraction of B, y = formation energy ΔH_f (eV/atom)
    # - For 3 elements (A-B-C): Gibbs triangle coordinates (x = x_B + 0.5 * x_C, y = (sqrt(3)/2) * x_C)
    dim = len(elems)
    sqrt3_half = float(np.sqrt(3.0) / 2.0)

    def _coords(comp: Composition, form_e_atom: float) -> tuple[float, float]:
        if dim == 2:
            x_b = float(comp.get_atomic_fraction(elems[1]))
            return round(x_b, 4), round(form_e_atom, 4)
        if dim == 3:
            x_b = float(comp.get_atomic_fraction(elems[1]))
            x_c = float(comp.get_atomic_fraction(elems[2]))
            px = x_b + 0.5 * x_c
            py = sqrt3_half * x_c
            return round(px, 4), round(py, 4)
        return 0.0, round(form_e_atom, 4)

    matched_formulas = {c["formula"]: c for c in top_candidates}
    stable_nodes: list[dict[str, Any]] = []
    unstable_nodes: list[dict[str, Any]] = []
    coord_by_formula: dict[str, tuple[float, float]] = {}

    for pde in pd_entries:
        r_formula = pde.composition.reduced_formula
        e_hull_calc = round(float(pd_obj.get_e_above_hull(pde)), 4)
        form_e_calc = round(float(pd_obj.get_form_energy_per_atom(pde)), 4)
        meta_e = entry_by_formula.get(r_formula, {})
        px, py = _coords(pde.composition, form_e_calc)
        coord_by_formula[r_formula] = (px, py)

        is_stab = pde in pd_obj.stable_entries
        node = {
            "formula": r_formula,
            "mp_id": meta_e.get("mp_id"),
            "spacegroup": meta_e.get("spacegroup", "-"),
            "e_hull_ev": e_hull_calc,
            "formation_energy_ev": form_e_calc,
            "density_g_cm3": meta_e.get("density_g_cm3"),
            "band_gap_ev": meta_e.get("band_gap_ev"),
            "electronic_label": meta_e.get("electronic_label", "-"),
            "z_bse_eff": meta_e.get("z_bse_eff") or compute_effective_bse_z(r_formula),
            "x": px,
            "y": py,
            "is_stable": is_stab,
            "is_xrd_detected": r_formula in matched_formulas,
            "xrd_match_score": matched_formulas[r_formula]["score"] if r_formula in matched_formulas else None,
        }
        if is_stab:
            stable_nodes.append(node)
        else:
            unstable_nodes.append(node)

    # Extract tie-lines from PhaseDiagram facets (simplices)
    tie_lines: list[dict[str, Any]] = []
    neighbors_map: dict[str, set[str]] = {n["formula"]: set() for n in stable_nodes}
    seen_edges: set[tuple[str, str]] = set()

    if dim in (2, 3):
        for facet in pd_obj.facets:
            facet_entries = [pd_obj.qhull_entries[idx] for idx in facet]
            facet_formulas = [fe.composition.reduced_formula for fe in facet_entries]
            for f1, f2 in itertools.combinations(sorted(set(facet_formulas)), 2):
                edge = (f1, f2)
                neighbors_map.setdefault(f1, set()).add(f2)
                neighbors_map.setdefault(f2, set()).add(f1)
                if edge not in seen_edges and f1 in coord_by_formula and f2 in coord_by_formula:
                    seen_edges.add(edge)
                    c1 = coord_by_formula[f1]
                    c2 = coord_by_formula[f2]
                    tie_lines.append(
                        {
                            "from_formula": f1,
                            "to_formula": f2,
                            "x0": c1[0],
                            "y0": c1[1],
                            "x1": c2[0],
                            "y1": c2[1],
                        }
                    )

    # Primary XRD phase equilibrium & coexistence analysis
    primary_cand = top_candidates[0] if top_candidates else None
    primary_formula = primary_cand["formula"] if primary_cand else None
    coexisting_neighbors: list[dict[str, Any]] = []
    if primary_formula and primary_formula in neighbors_map:
        for nb_f in sorted(neighbors_map[primary_formula]):
            nb_meta = entry_by_formula.get(nb_f, {})
            coexisting_neighbors.append(
                {
                    "formula": nb_f,
                    "mp_id": nb_meta.get("mp_id"),
                    "spacegroup": nb_meta.get("spacegroup", "-"),
                    "z_bse_eff": nb_meta.get("z_bse_eff") or compute_effective_bse_z(nb_f),
                    "is_xrd_detected": nb_f in matched_formulas,
                    "xrd_score": matched_formulas[nb_f]["score"] if nb_f in matched_formulas else None,
                }
            )

    # SEM-BSE Atomic-Number (Z_BSE) Contrast Table sorted from brightest (highest Z_BSE) to darkest
    bse_rows: list[dict[str, Any]] = []
    seen_f: set[str] = set()
    for n in sorted(stable_nodes + unstable_nodes, key=lambda item: -float(item["z_bse_eff"] or 0.0)):
        if n["formula"] in seen_f:
            continue
        seen_f.add(n["formula"])
        bse_rows.append(n)

    z_vals = [float(r["z_bse_eff"]) for r in bse_rows if r["z_bse_eff"] > 0]
    z_min = min(z_vals) if z_vals else 0.0
    z_max = max(z_vals) if z_vals else 1.0
    z_span = max(1.0, z_max - z_min)

    for r in bse_rows:
        rel_z = (float(r["z_bse_eff"]) - z_min) / z_span
        if rel_z >= 0.67:
            zone_label = "밝은 영역 (Bright BSE · 고-Z 상)"
        elif rel_z >= 0.33:
            zone_label = "중간 회색 기지 (Medium-Gray · 중-Z 상)"
        else:
            zone_label = "어두운 영역 (Dark BSE · 저-Z 상)"
        r["bse_contrast_zone"] = zone_label
        r["bse_zone"] = zone_label

    coex_formulas = [c["formula"] for c in coexisting_neighbors]
    return {
        "enabled": True,
        "chemsys": "-".join(elems),
        "elements": elems,
        "dimension": dim,
        "nodes": stable_nodes + unstable_nodes,
        "stable_formulas": [n["formula"] for n in stable_nodes],
        "stable_phases": stable_nodes,
        "unstable_phases": unstable_nodes,
        "tie_lines": tie_lines,
        "primary_formula": primary_formula,
        "coexisting_equilibrium_neighbors": coex_formulas,
        "coexisting_equilibrium_neighbor_details": coexisting_neighbors,
        "bse_table": bse_rows,
        "sem_bse_contrast_table": bse_rows,
        "interpretation_guide": (
            f"{'-'.join(elems)} 화학계의 Materials Project 0 K 등온 상평형도(Convex Hull)와 유효 원자번호(Z_BSE) 분석 결과입니다. "
            + (
                f"주상 후보 {primary_formula}와 상평형 공존선(tie-line)으로 직접 연결된 평형 이차상은 "
                f"{', '.join(coex_formulas)}이며, "
                "후방산란전자(SEM-BSE/BED-C) 이미지에서 Z_BSE가 큰 상일수록 밝게(Bright), 작은 상일수록 어둡게(Dark) 관찰됩니다."
                if primary_formula and coex_formulas
                else "후방산란전자(SEM-BSE) 이미지에서 유효 원자번호(Z_BSE)가 높은 상일수록 밝게 관찰됩니다."
            )
        ),
    }
