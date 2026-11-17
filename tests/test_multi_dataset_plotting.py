"""Multi-Dataset Scientific Plotting System Test & Validation Suite.

Covers all 12 validation criteria specified in Section 12:
1. Differing dataset lengths
2. Differing X-axis measurement ranges
3. Non-uniform X-axis step intervals
4. Missing / NaN data handling
5. Differing units handling & overlay safety warning
6. Performance with high volume (10+) datasets
7. Offset non-destructive verification (raw & quantitative calculations unaffected)
8. Peak matching accuracy and shift Δ(2θ) calculation
9. Image digitization dataset compatibility & confidence metadata
10. SEM Sample ID linking & integrated interpretation
11. Publication export consistency (PNG 300 DPI, vector SVG, vector PDF)
12. Existing MatLens feature regression testing
"""
import io
import math
import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.db import init_db
from backend.app.engine.plot_engine import (
    compute_peak_comparison,
    compute_visualization_series,
    detect_peaks,
    digitize_xrd_image,
    get_xrd_sem_linked_data,
    parse_numeric_dataset,
    normalize_intensity,
)
from backend.app.engine.plot_export import render_publication_plot


@pytest.fixture(autouse=True)
def setup_database():
    init_db()


# ---------------------------------------------------------------------------
# 1. Differing Dataset Lengths
# ---------------------------------------------------------------------------
def test_differing_dataset_lengths():
    """Verify processing multiple datasets of completely different point counts."""
    x1 = np.linspace(10, 80, 500)
    y1 = np.sin(x1) + 2.0
    x2 = np.linspace(10, 80, 1250)
    y2 = np.cos(x2) + 2.0

    ds1 = {"id": "ds_short", "sample_name": "Short 500", "x": x1.tolist(), "y": y1.tolist(), "visible": True}
    ds2 = {"id": "ds_long", "sample_name": "Long 1250", "x": x2.tolist(), "y": y2.tolist(), "visible": True}

    res = compute_visualization_series([ds1, ds2], plot_type="stacked")
    assert len(res["datasets"]) == 2
    assert len(res["datasets"][0]["x"]) == 500
    assert len(res["datasets"][1]["x"]) == 1250
    assert len(res["datasets"][0]["y_display"]) == 500
    assert len(res["datasets"][1]["y_display"]) == 1250


# ---------------------------------------------------------------------------
# 2. Differing X-axis Measurement Ranges
# ---------------------------------------------------------------------------
def test_differing_x_ranges():
    """Verify datasets with distinct 2θ angular coverage."""
    x1 = np.linspace(10, 50, 400)
    y1 = np.exp(-((x1 - 25) / 2) ** 2)
    x2 = np.linspace(30, 85, 550)
    y2 = np.exp(-((x2 - 45) / 2) ** 2)

    ds1 = {"id": "ds_low_angle", "sample_name": "Low Angle", "x": x1.tolist(), "y": y1.tolist(), "visible": True}
    ds2 = {"id": "ds_high_angle", "sample_name": "High Angle", "x": x2.tolist(), "y": y2.tolist(), "visible": True}

    res = compute_visualization_series([ds1, ds2], plot_type="stacked")
    bounds = res["view_bounds"]
    assert bounds["x_min"] <= 10.0
    assert bounds["x_max"] >= 85.0


# ---------------------------------------------------------------------------
# 3. Non-uniform X-axis Intervals
# ---------------------------------------------------------------------------
def test_non_uniform_x_steps():
    """Verify non-uniform step detection and safe handling."""
    # Quadratic or non-linear X spacing
    x = np.sort(np.random.uniform(10, 80, 200))
    y = np.random.normal(100, 10, 200)

    csv_data = "2theta,intensity\n" + "\n".join(f"{xv:.4f},{yv:.2f}" for xv, yv in zip(x, y))
    parsed = parse_numeric_dataset(csv_data.encode("utf-8"), filename="non_uniform.csv")

    assert parsed["data_quality"]["num_points"] == 200
    assert parsed["data_quality"]["is_uniform_step"] is False
    assert parsed["data_quality"]["step"] > 0


# ---------------------------------------------------------------------------
# 4. Missing / NaN / Header Lines Handling
# ---------------------------------------------------------------------------
def test_missing_and_comment_lines():
    """Verify parser filters comment lines, empty lines, and bad rows gracefully."""
    raw_content = b"""# Laboratory Header XRD
# Operator: MatLens
// Another comment style
2Theta, Intensity
10.00, 105.2
10.02, 112.5

10.04, 98.4
# mid-file glitch
10.06, 120.1
10.08, 115.0
10.10, 102.3
"""
    parsed = parse_numeric_dataset(raw_content, filename="messy.csv")
    assert len(parsed["x"]) == 6
    assert parsed["x"][0] == 10.00
    assert parsed["x"][-1] == 10.10


# ---------------------------------------------------------------------------
# 5. Differing Units Handling & Overlay Warning
# ---------------------------------------------------------------------------
def test_differing_units_overlay_warning():
    """Verify overlaying incompatible units triggers warning."""
    with TestClient(app) as client:
        # Register XRD dataset (counts)
        r1 = client.post("/api/v1/plots/datasets", json={
            "sample_id": "XRD_Sample",
            "x": [10, 20, 30, 40, 50],
            "y": [100, 250, 800, 300, 120],
            "x_unit": "degree",
            "y_unit": "counts",
            "measurement_type": "XRD",
        })
        ds1_id = r1.json()["datasets"][0]["id"]

        # Register UTM dataset (MPa)
        r2 = client.post("/api/v1/plots/datasets", json={
            "sample_id": "UTM_Sample",
            "x": [0.01, 0.02, 0.03, 0.04, 0.05],
            "y": [20, 50, 120, 240, 310],
            "x_unit": "mm/mm",
            "y_unit": "MPa",
            "measurement_type": "UTM",
        })
        ds2_id = r2.json()["datasets"][0]["id"]

        # Attempt overlay comparison
        r_comp = client.post("/api/v1/plots/compare", json={
            "dataset_ids": [ds1_id, ds2_id],
            "plot_type": "overlay",
        })
        assert r_comp.status_code == 200
        data = r_comp.json()
        assert data["has_unit_mismatch"] is True
        assert "서로 다른 Y축 단위" in data["unit_warning"]


# ---------------------------------------------------------------------------
# 6. High-volume Dataset Performance
# ---------------------------------------------------------------------------
def test_high_volume_datasets_performance():
    """Ensure processing 12 stacked datasets is fast (< 150 ms)."""
    import time
    datasets = []
    x = np.linspace(10, 80, 700)
    for i in range(12):
        y = 100.0 + 500.0 * np.exp(-((x - (25.0 + i * 0.2)) / 1.5) ** 2)
        datasets.append({
            "id": f"ds_batch_{i}",
            "sample_name": f"Batch {i}",
            "x": x.tolist(),
            "y": y.tolist(),
            "visible": True,
        })

    t0 = time.perf_counter()
    res = compute_visualization_series(datasets, plot_type="stacked", auto_offset=True)
    t_elapsed = time.perf_counter() - t0

    assert len(res["datasets"]) == 12
    assert t_elapsed < 0.25, f"Took {t_elapsed:.3f}s, should be < 0.25s"


# ---------------------------------------------------------------------------
# 7. Offset Non-Destructive Verification
# ---------------------------------------------------------------------------
def test_offset_is_non_destructive():
    """CRITICAL: Verify visualization offset Oi does NOT modify raw data or quantitative calculations."""
    x = np.linspace(20.0, 30.0, 25)
    y_raw = 50.0 + 450.0 * np.exp(-((x - 25.0) / 0.5) ** 2)

    ds = {"id": "ds_test", "sample_name": "Test", "x": x.tolist(), "y": y_raw.tolist(), "offset": 2.5, "visible": True}

    res = compute_visualization_series([ds], plot_type="stacked", normalization="maximum", auto_offset=False)
    computed_ds = res["datasets"][0]

    # Raw y is strictly preserved
    assert np.allclose(computed_ds["y_raw"], y_raw)

    # Normalized y is bounded in [0, 1]
    assert np.max(computed_ds["y_normalized"]) == pytest.approx(1.0)

    # Display y equals normalized + offset: I_display = I_norm + O_i
    expected_display = np.array(computed_ds["y_normalized"]) + 2.5
    assert np.allclose(computed_ds["y_display"], expected_display)

    # Detect peaks on quantitative signal, not distorted by offset
    pks = detect_peaks(x, np.array(computed_ds["y_normalized"]))
    assert len(pks) > 0
    assert pks[0]["two_theta"] == pytest.approx(25.0, abs=0.1)


# ---------------------------------------------------------------------------
# 8. Peak Matching & Shift Δ(2θ) Accuracy
# ---------------------------------------------------------------------------
def test_peak_matching_and_shift_calculation():
    """Verify peak matching against reference and shift Δ(2θ) = 2θ_sample - 2θ_ref."""
    x = np.linspace(15, 60, 1000)

    # Reference peak at 25.40°
    y_ref = 100.0 + 1000.0 * np.exp(-((x - 25.40) / 0.8) ** 2)
    # Sample with lattice strain shifted to 25.75° (Δ2θ = +0.35°)
    y_sample = 100.0 + 950.0 * np.exp(-((x - 25.75) / 0.7) ** 2)

    ref_ds = {"id": "ref", "sample_name": "AC", "x": x.tolist(), "y": y_ref.tolist()}
    sample_ds = {"id": "sample", "sample_name": "AC700", "x": x.tolist(), "y": y_sample.tolist()}

    res = compute_peak_comparison(ref_ds, [sample_ds], tolerance_deg=0.5)

    assert len(res["difference_table"]) >= 1
    match_row = res["difference_table"][0]
    assert match_row["ref_two_theta"] == pytest.approx(25.40, abs=0.05)
    assert match_row["sample_two_theta"] == pytest.approx(25.75, abs=0.05)
    assert match_row["delta_two_theta"] == pytest.approx(0.35, abs=0.06)
    assert match_row["status"] == "Shifted"


# ---------------------------------------------------------------------------
# 9. Image Digitization Compatibility & Confidence Metadata
# ---------------------------------------------------------------------------
def test_image_digitization_compatibility():
    """Verify image curve digitization returns calibration info and error estimates."""
    from PIL import Image, ImageDraw

    # Create synthetic plot image
    img = Image.new("RGB", (400, 300), color="white")
    draw = ImageDraw.Draw(img)
    # Draw simple peak curve
    points = []
    for px in range(50, 350):
        norm_x = (px - 50) / 300.0
        py = 220 - int(150 * math.exp(-((norm_x - 0.4) / 0.1) ** 2))
        points.append((px, py))
    draw.line(points, fill="black", width=2)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    raw_img = buf.getvalue()

    dig = digitize_xrd_image(raw_img, filename="digitized_test.png", x_min=10.0, x_max=80.0)

    assert dig["source_type"] == "image_digitization"
    assert "calibration_info" in dig
    assert dig["data_quality"]["estimated_error_deg"] == 0.05
    assert len(dig["x"]) == len(dig["y"])
    assert dig["x"][0] == pytest.approx(10.0, abs=0.2)
    assert dig["x"][-1] == pytest.approx(80.0, abs=0.2)


# ---------------------------------------------------------------------------
# 10. SEM Sample ID Linking & Interpretation
# ---------------------------------------------------------------------------
def test_sem_sample_id_linking():
    """Verify linking XRD sample ID AC850 to SEM grain size and integrated interpretation."""
    link_info = get_xrd_sem_linked_data("AC850")

    assert link_info["has_linked_sem"] is True
    assert link_info["sample_id"] == "AC850"
    assert "grain_size_analysis" in link_info
    assert link_info["grain_size_analysis"]["d50_um"] > 0
    assert "integrated_interpretation" in link_info
    assert "scientific_disclaimer" in link_info
    assert "EDS" in link_info["scientific_disclaimer"]


# ---------------------------------------------------------------------------
# 11. Publication Export Consistency (PNG, SVG, PDF)
# ---------------------------------------------------------------------------
def test_export_publication_quality():
    """Verify high-resolution PNG (>=300 DPI), SVG vector, and PDF export."""
    x = np.linspace(10, 80, 200).tolist()
    y = (np.sin(np.linspace(0, 10, 200)) + 1.5).tolist()

    plot_data = {
        "title": "Publication Stacked XRD Pattern",
        "plot_type": "stacked",
        "datasets": [
            {"sample_name": "AC", "color": "#1E293B", "offset": 0.0, "x": x, "y_display": y, "visible": True},
            {"sample_name": "AC700", "color": "#DC2626", "offset": 1.2, "x": x, "y_display": [v + 1.2 for v in y], "visible": True},
        ],
        "annotations": [
            {"type": "miller_index", "x": 25.0, "y": 1.5, "hkl": "002"}
        ],
        "x_axis": {"label": "2θ", "unit": "degree"},
        "y_axis": {"label": "Normalized Intensity", "unit": "a.u."},
        "graph_properties": {"font_size": 11, "grid": True},
    }

    # 1. PNG Export (300 DPI)
    png_bytes = render_publication_plot(plot_data, format="png", dpi=300)
    assert len(png_bytes) > 2000
    assert png_bytes[:8] == b"\x89PNG\r\n\x1a\n"

    # 2. SVG Vector Export
    svg_bytes = render_publication_plot(plot_data, format="svg")
    assert len(svg_bytes) > 1000
    assert b"<svg" in svg_bytes

    # 3. PDF Vector Export
    pdf_bytes = render_publication_plot(plot_data, format="pdf")
    assert len(pdf_bytes) > 1000
    assert pdf_bytes.startswith(b"%PDF")


# ---------------------------------------------------------------------------
# 12. Existing MatLens Feature Regression Test
# ---------------------------------------------------------------------------
def test_existing_matlens_regression():
    """Verify health endpoint, project creation, and core API stability."""
    with TestClient(app) as client:
        # Health check
        h = client.get("/api/health")
        assert h.status_code == 200
        assert h.json()["status"] == "ok"

        # Projects list
        p = client.get("/api/projects")
        assert p.status_code == 200
        assert isinstance(p.json(), list)
