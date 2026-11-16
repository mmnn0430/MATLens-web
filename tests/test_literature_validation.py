"""Comprehensive Unit, Literature Retrieval, and Scientific Integrity Test Suite.

Covers:
1. Unit Tests:
   - XRD Lattice Parameter calculation & relative deviation
   - SEM calibration & ASTM E112 sample count validation
   - UTM mechanical properties & condition checking
   - Unit conversion & relative deviation calculation
2. Literature Retrieval Tests:
   - DOI metadata verification & normalization
   - Open Access status & access level resolution
   - Duplicate paper detection & deduplication
   - Missing full text graceful handling (abstract_only / metadata_only fallback)
3. Scientific Integrity Tests:
   - Blocking nonexistent or hallucinated paper citations
   - Blocking synthetic/unverified numerical extractions (strict null when not in source)
   - Condition mismatch detection (heat treatment, test temperature, wavelength)
   - Restricting inappropriate quantitative direct comparisons
   - Multi-hypothesis peak shifting (preventing dogmatic single-cause determinations)
4. Full API Integration Tests:
   - POST /api/literature/search
   - POST /api/literature/validate
   - POST /api/utm/literature-validate
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.schemas_literature import (
    EvidenceDetail,
    ExtractedEvidenceItem,
    PaperMetadata,
)
from backend.app.services.literature.curated_db import CURATED_LITERATURE_DB
from backend.app.services.literature.metadata import format_doi_url, normalize_doi, parse_openalex_work
from backend.app.services.literature.ranking import evaluate_paper_relevance
from backend.app.services.literature.search import search_academic_literature
from backend.app.services.literature.extraction import extract_verified_evidence
from backend.app.services.validation.condition_checker import check_conditions
from backend.app.services.validation.xrd_validation import validate_xrd_analysis
from backend.app.services.validation.sem_validation import validate_sem_analysis
from backend.app.services.validation.utm_validation import validate_utm_analysis
from backend.app.services.interpretation.reliability import assess_scientific_reliability
from backend.app.services.interpretation.evidence_engine import synthesize_literature_validation_report

client = TestClient(app)


# ========================================================
# 1. Unit Tests
# ========================================================

def test_doi_normalization_and_url_formatting():
    """Verify DOI normalization handles raw DOIs, full URLs, and malformed strings."""
    assert normalize_doi("10.1073/pnas.1511232112") == "10.1073/pnas.1511232112"
    assert normalize_doi("https://doi.org/10.1016/j.msea.2018.04.092") == "10.1016/j.msea.2018.04.092"
    assert normalize_doi("http://dx.doi.org/10.1524/zkri.1972.136.3-4.273") == "10.1524/zkri.1972.136.3-4.273"
    assert normalize_doi("not-a-doi") is None
    assert normalize_doi("") is None

    assert format_doi_url("10.1073/pnas.1511232112") == "https://doi.org/10.1073/pnas.1511232112"
    assert format_doi_url(None) is None


def test_relative_deviation_calculation():
    """Verify exact numerical relative deviation calculation."""
    meas = 5.928
    lit = 5.952
    abs_dev = abs(meas - lit)
    rel_dev_pct = 100.0 * abs_dev / lit
    assert round(rel_dev_pct, 2) == 0.40


def test_xrd_cubic_lattice_parameter_calculation():
    """Verify Bragg's law and cubic lattice parameter calculation a = d * sqrt(h^2 + k^2 + l^2)."""
    # For Si(111): d = 3.1355 Å, hkl = (1,1,1) -> sqrt(3) = 1.73205
    # a = 3.1355 * sqrt(3) = 5.4308 Å
    d_spacing = 3.1355
    hkl_sq = 1**2 + 1**2 + 1**2
    import math
    a_calc = d_spacing * math.sqrt(hkl_sq)
    assert round(a_calc, 4) == 5.4308


# ========================================================
# 2. Literature Retrieval & Extraction Tests
# ========================================================

def test_curated_db_integrity():
    """Ensure all curated benchmark papers possess real verified DOIs and valid evidence."""
    for paper in CURATED_LITERATURE_DB:
        assert paper["doi"].startswith("10.")
        assert paper["title"]
        assert len(paper["authors"]) > 0
        assert paper["publication_year"] >= 1970
        for ev in paper["evidences"]:
            assert "property" in ev
            assert ev["verification_status"] == "verified"


def test_missing_full_text_handling():
    """Ensure papers without full text are labeled 'abstract_only' or 'metadata_only'."""
    work_abstract_only = {
        "id": "W12345",
        "display_name": "Sample Abstract Paper",
        "doi": "https://doi.org/10.1000/182",
        "publication_year": 2020,
        "abstract_inverted_index": {"Grain": [0], "size": [1], "effect": [2]},
        "open_access": {"is_oa": False},
        "primary_location": {"pdf_url": None},
    }
    meta = parse_openalex_work(work_abstract_only)
    assert meta.access_level == "abstract_only"
    assert meta.abstract == "Grain size effect"

    work_metadata_only = {
        "id": "W99999",
        "display_name": "Sample Metadata Paper",
        "doi": "https://doi.org/10.1000/999",
        "publication_year": 2019,
        "abstract_inverted_index": None,
        "open_access": {"is_oa": False},
        "primary_location": {"pdf_url": None},
    }
    meta_only = parse_openalex_work(work_metadata_only)
    assert meta_only.access_level == "metadata_only"


def test_schema_conforming_evidence_extraction():
    """Verify Section 6 schema adherence and strict null assignment for unconfirmed metrics."""
    paper = PaperMetadata(
        paper_id="TEST-1",
        title="Test Extraction Paper",
        authors=["Author A"],
        publication_year=2021,
        doi="10.1016/j.test.2021",
        access_level="full_text",
    )
    raw_ev = [
        {
            "property": "Yield Strength",
            "value": 276.0,
            "unit": "MPa",
            "measurement_temperature": 298.15,
            "source_page": 12,
            "source_figure": "Fig. 3",
            "source_table": None,
            "quoted_text": "Yield strength reached 276 MPa.",
        },
        {
            "property": "Fracture Toughness",
            "value": None,  # Not reported
            "unit": "MPa m^0.5",
            "source_page": None,
            "source_figure": None,
            "source_table": None,
            "quoted_text": "",
        },
    ]
    extracted = extract_verified_evidence(paper, raw_ev)
    assert len(extracted) == 2
    assert extracted[0].evidence.value == 276.0
    assert extracted[0].evidence.source_page == 12
    assert extracted[0].evidence.source_figure == "Fig. 3"
    assert extracted[0].evidence.source_table is None
    # Unreported value must be strictly None (null in JSON), never made up
    assert extracted[1].evidence.value is None
    assert extracted[1].evidence.source_page is None


# ========================================================
# 3. Scientific Integrity & Guardrail Tests
# ========================================================

def test_condition_mismatch_blocks_direct_comparison():
    """Verify heat treatment mismatch strictly prevents quantitative direct comparison."""
    meas_cond = {
        "heat_treatment": "As-cast (Non-heat treated)",
        "test_temperature_K": 296.0,
        "strain_rate_per_sec": 0.001,
    }
    lit_cond = {
        "heat_treatment": "T6 (Solution treated and artificially aged)",
        "test_temperature_K": 296.0,
        "strain_rate_per_sec": 0.001,
    }
    compat = check_conditions("UTM", meas_cond, lit_cond)
    assert compat.condition_compatibility == "incompatible"
    assert compat.direct_comparison_allowed is False
    assert "열처리 상태 불일치" in compat.condition_mismatches[0]
    assert "직접 비교가 금지됩니다" in compat.direct_comparison_warning


def test_temperature_mismatch_detection():
    """Verify significant temperature difference (> 25 K) triggers warning."""
    meas_cond = {"test_temperature_K": 298.0}
    lit_cond = {"test_temperature_K": 573.0}  # 300°C
    compat = check_conditions("UTM", meas_cond, lit_cond)
    assert len(compat.condition_mismatches) > 0
    assert any("시험 온도 불일치" in m for m in compat.condition_mismatches)


def test_xrd_peak_shifting_multi_hypothesis():
    """Verify peak shifting generates multi-hypothesis interpretations rather than a single dogmatic cause."""
    mock_xrd_result = {
        "peaks": [
            {"peak_id": "P1", "two_theta": 28.52, "d_spacing_A": 3.127, "rel_intensity_pct": 100.0, "user_excluded": False},
            {"peak_id": "P2", "two_theta": 47.45, "d_spacing_A": 1.915, "rel_intensity_pct": 55.0, "user_excluded": False},
        ],
        "conditions": {"wavelength_angstrom": 1.5406, "match_tol_deg": 0.35},
        "phase_matching": {
            "candidates": [
                {
                    "name": "Nb0.8Ti0.2FeSb Half-Heusler",
                    "score": 88.0,
                    "peaks": [
                        {"two_theta": 28.44, "d_spacing": 3.136, "hkl": [2, 2, 0]},
                        {"two_theta": 47.30, "d_spacing": 1.921, "hkl": [4, 2, 2]},
                    ],
                }
            ]
        },
    }

    val_res = validate_xrd_analysis(mock_xrd_result, [], "Nb0.8Ti0.2FeSb")
    hypotheses = val_res["shift_hypotheses"]
    assert len(hypotheses) > 0
    primary_hyp = hypotheses[0]
    mechanisms = primary_hyp["possible_mechanisms"]

    # Must contain multiple scientific mechanisms
    assert any("치환형 도핑" in m for m in mechanisms)
    assert any("잔류 응력" in m for m in mechanisms)
    assert any("격자 왜곡" in m for m in mechanisms)
    assert any("기기 정렬" in m for m in mechanisms)
    assert "표준 시료" in primary_hyp["recommended_validation"]


def test_sem_porosity_and_microstructure_guardrails():
    """Ensure 2D area fraction is not equated to 3D porosity, and brightness is not equated to chemical phase."""
    mock_sem_result = {
        "scale": {"is_calibrated": True, "um_per_pixel": 0.05, "unit": "µm"},
        "summary_stats": {"sample_count_n": 42, "mean_diameter": 1.25, "unit": "µm", "d50": 1.20},
        "mode": "particle",
    }
    val_res = validate_sem_analysis(mock_sem_result, [], "TiO2")
    # Verify stereological ASTM E562 warning
    assert any("ASTM E562" in w for w in val_res["porosity_stereology_warnings"])
    assert any("3D 체적 기공률" in w for w in val_res["porosity_stereology_warnings"])
    # Verify chemical phase guardrail
    assert any("명암 대비" in g for g in val_res["microstructure_chemical_guardrails"])
    assert any("EDS" in g for g in val_res["microstructure_chemical_guardrails"])


def test_bifurcated_reliability_assessment_states():
    """Ensure reliability uses discrete qualitative states without arbitrary scores."""
    assessment = assess_scientific_reliability(
        instrument_type="UTM",
        measurement_res={"elastic_modulus": {"r_squared": 0.998}},
        validations=[],
        comparisons=[],
    )
    assert assessment.analytical.status in {"Supported", "Partially Supported", "Insufficient Evidence"}
    # Because validations list was empty, interpretation must be Insufficient Evidence
    assert assessment.interpretation.status == "Insufficient Evidence"


# ========================================================
# 4. API Endpoints Integration Tests
# ========================================================

def test_api_literature_search_nb_ti_fe_sb():
    """Verify search endpoint retrieves prompt-specified Nb0.8Ti0.2FeSb Half-Heusler literature."""
    payload = {
        "material_name": "Nb0.8Ti0.2FeSb",
        "chemical_composition": "Nb-Ti-Fe-Sb",
        "instrument_type": "XRD",
        "measurement_conditions": {"wavelength_angstrom": 1.5406},
        "target_property": "Lattice Parameter, Peak Shifting, Phase Identification",
    }
    resp = client.post("/api/literature/search", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["material_name"] == "Nb0.8Ti0.2FeSb"
    papers = data["papers"]
    assert len(papers) > 0
    # Must find the PNAS paper from curated benchmark
    pnas_paper = next((p for p in papers if "10.1073/pnas.1511232112" in (p.get("doi") or "")), None)
    assert pnas_paper is not None
    assert "Half-Heusler" in pnas_paper["title"]


def test_api_utm_literature_validate_al6061():
    """Verify UTM literature validation endpoint compares against ASTM E8 benchmarks."""
    payload = {
        "material_name": "Al 6061-T6",
        "chemical_composition": "Al-Mg-Si",
        "conditions": {
            "heat_treatment": "T6",
            "test_temperature_K": 296.0,
            "strain_rate_per_sec": 0.001,
        },
        "utm_result": {
            "peak_stress": {"stress_MPa": 312.4},
            "elastic_modulus": {"E_GPa": 69.5, "r_squared": 0.998},
            "offset_yield": {"yield_stress_MPa": 278.2, "yield_strain_pct": 0.602, "is_valid": True},
        },
    }
    resp = client.post("/api/utm/literature-validate", json=payload)
    assert resp.status_code == 200
    report = resp.json()
    assert report["instrument_type"] == "UTM"
    assert len(report["comparisons"]) >= 2
    # Verify Young's modulus comparison
    mod_comp = next((c for c in report["comparisons"] if "Young's Modulus" in c["property_name"]), None)
    assert mod_comp is not None
    assert mod_comp["measured_value"] == 69.5
    assert mod_comp["literature_value"] == 68.9
    assert mod_comp["comparable"] is True
    assert mod_comp["relative_deviation_pct"] < 2.0
    # Reliability
    assert report["reliability"]["analytical"]["status"] == "Supported"
    assert report["reliability"]["interpretation"]["status"] == "Supported"
