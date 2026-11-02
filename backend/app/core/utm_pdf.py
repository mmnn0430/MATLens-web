"""UTM PDF and Chart Generation Module.

Generates standalone high-resolution charts and PDF reports for UTM tensile test data.
Completely isolated from existing XRD/SEM report generators.
"""

from __future__ import annotations

import io
from typing import Any, Dict, Optional
from xml.sax.saxutils import escape

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import (
    HRFlowable,
    Image,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from app.engine.pdf_export import _register_korean_font


def generate_utm_charts_image(analysis_result: Dict[str, Any], title: str = "UTM Tensile Test Analysis") -> bytes:
    """Generate a combined 3-panel chart image (Stress-Strain, Load-Disp, Time-Load)."""
    curves = analysis_result.get("curves", {})
    strain_pct = curves.get("strain_pct", [])
    stress_MPa = curves.get("stress_MPa", [])
    disp_raw = curves.get("disp_raw", [])
    load_N = curves.get("load_N", [])
    load_raw = curves.get("load_raw", [])
    time_sec = curves.get("time", [])

    peak_s = analysis_result.get("peak_stress") or {}
    peak_l = analysis_result.get("peak_load") or {}
    elastic = analysis_result.get("elastic_modulus") or {}
    offset_y = analysis_result.get("offset_yield") or {}

    _register_korean_font()
    plt.rcParams["axes.unicode_minus"] = False

    fig, axes = plt.subplots(1, 3, figsize=(15, 4.5), dpi=150)

    # 1. Stress - Strain curve
    ax1 = axes[0]
    if strain_pct and stress_MPa:
        ax1.plot(strain_pct, stress_MPa, color="#2563EB", lw=2, label="Engineering Stress-Strain")
        if peak_s.get("strain_pct") is not None and peak_s.get("stress_MPa") is not None:
            ax1.scatter(
                [peak_s["strain_pct"]],
                [peak_s["stress_MPa"]],
                color="#DC2626",
                s=60,
                zorder=5,
                label=f"Max Stress ({peak_s['stress_MPa']} MPa)",
            )
        if offset_y.get("is_valid"):
            ax1.scatter(
                [offset_y["yield_strain_pct"]],
                [offset_y["yield_stress_MPa"]],
                color="#059669",
                s=50,
                zorder=5,
                label=f"0.2% Offset ({offset_y['yield_stress_MPa']} MPa)",
            )
        ax1.set_xlabel("Strain (%)", fontweight="bold", fontsize=10)
        ax1.set_ylabel("Stress (MPa)", fontweight="bold", fontsize=10)
        ax1.set_title("Stress vs Strain", fontweight="bold", fontsize=11, color="#1E293B")
        ax1.grid(True, linestyle="--", alpha=0.5)
        ax1.legend(fontsize=8, loc="best")
    else:
        ax1.text(0.5, 0.5, "No Stress-Strain Data", ha="center", va="center")

    # 2. Load - Displacement curve
    ax2 = axes[1]
    if disp_raw and load_N:
        ax2.plot(disp_raw, load_N, color="#0284C7", lw=1.8, label="Load (N)")
        if peak_l.get("load_N") is not None:
            ax2.scatter(
                [disp_raw[peak_l.get("index", 0) - analysis_result["analysis_range"]["start_idx"]]],
                [peak_l["load_N"]],
                color="#DC2626",
                s=50,
                zorder=5,
                label=f"Max Load ({peak_l['load_N']} N)",
            )
        ax2.set_xlabel("Displacement (mm)", fontweight="bold", fontsize=10)
        ax2.set_ylabel("Load (N)", fontweight="bold", fontsize=10)
        ax2.set_title("Load vs Displacement", fontweight="bold", fontsize=11, color="#1E293B")
        ax2.grid(True, linestyle="--", alpha=0.5)
        ax2.legend(fontsize=8, loc="best")
    else:
        ax2.text(0.5, 0.5, "No Load-Disp Data", ha="center", va="center")

    # 3. Time - Load curve
    ax3 = axes[2]
    if time_sec and load_N:
        ax3.plot(time_sec, load_N, color="#7C3AED", lw=1.6, label="Load (N)")
        ax3.axhline(0, color="#94A3B8", linestyle=":", lw=1)
        ax3.set_xlabel("Time (sec)", fontweight="bold", fontsize=10)
        ax3.set_ylabel("Load (N)", fontweight="bold", fontsize=10)
        ax3.set_title("Time vs Load", fontweight="bold", fontsize=11, color="#1E293B")
        ax3.grid(True, linestyle="--", alpha=0.5)
        ax3.legend(fontsize=8, loc="best")
    else:
        ax3.text(0.5, 0.5, "No Time-Load Data", ha="center", va="center")

    plt.tight_layout()
    buf = io.BytesIO()
    plt.savefig(buf, format="png", bbox_inches="tight")
    plt.close(fig)
    return buf.getvalue()


def generate_utm_pdf_report(
    analysis_result: Dict[str, Any],
    file_name: str,
    analysis_name: str = "UTM 인장시험 분석",
    notes: str = "",
) -> bytes:
    """Generate a clean, professional PDF report for UTM tensile testing."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=36,
        rightMargin=36,
        topMargin=36,
        bottomMargin=36,
    )

    font_reg, font_bold, font_path = _register_korean_font()

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "UTMTitle",
        parent=styles["Normal"],
        fontSize=20,
        leading=24,
        textColor=colors.HexColor("#1E3A8A"),
        fontName=font_bold,
    )
    subtitle_style = ParagraphStyle(
        "UTMSubtitle",
        parent=styles["Normal"],
        fontSize=10,
        leading=14,
        textColor=colors.HexColor("#64748B"),
        fontName=font_reg,
    )
    h2_style = ParagraphStyle(
        "UTMH2",
        parent=styles["Normal"],
        fontSize=12,
        leading=16,
        textColor=colors.HexColor("#1E293B"),
        fontName=font_bold,
        spaceBefore=10,
        spaceAfter=6,
    )
    body_style = ParagraphStyle(
        "UTMBody",
        parent=styles["Normal"],
        fontSize=9,
        leading=13,
        textColor=colors.HexColor("#334155"),
        fontName=font_reg,
    )

    story = []

    # Header
    story.append(Paragraph("MatLens UTM Tensile Test Analysis Report", title_style))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(f"Analysis: {escape(analysis_name)} | File: {escape(file_name)} | Standard Unit: MPa / N / %", subtitle_style)
    )
    story.append(Spacer(1, 10))
    story.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor("#3B82F6"), spaceAfter=12))

    # Meta Table
    rng = analysis_result.get("analysis_range", {})
    meta_data = [
        ["Dataset File", file_name, "Analysis Title", analysis_name],
        ["Total Row Count", f"{rng.get('total_count', 0)} rows", "Analyzed Slice", f"{rng.get('count', 0)} rows ({rng.get('start_idx', 0)+1}~{rng.get('end_idx', 0)})"],
        ["User Notes", notes or "None", "Conversion Standard", "kgf*9.80665=N, kgf/mm2*9.80665=MPa"],
    ]
    cell_style = ParagraphStyle("UTMCell", parent=body_style, fontSize=8, leading=11, wordWrap="CJK")
    meta_data = [[Paragraph(escape(str(value)), cell_style) for value in row] for row in meta_data]
    t_meta = Table(meta_data, colWidths=[90, 170, 100, 160])
    t_meta.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
            ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#1E293B")),
            ("FONTNAME", (0, 0), (-1, -1), font_reg),
            ("FONTNAME", (0, 0), (0, -1), font_bold),
            ("FONTNAME", (2, 0), (2, -1), font_bold),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
            ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#CBD5E1")),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ])
    )
    story.append(t_meta)
    story.append(Spacer(1, 14))

    # Metrics Summary Table
    story.append(Paragraph("1. Primary Tensile Properties & Numerical Indicators", h2_style))
    peak_s = analysis_result.get("peak_stress") or {}
    peak_l = analysis_result.get("peak_load") or {}
    elastic = analysis_result.get("elastic_modulus") or {}
    offset_y = analysis_result.get("offset_yield") or {}

    metric_rows = [
        ["Metric", "Value", "Raw Value / Condition", "Serial No / Details"],
        [
            "Peak Stress (UTS Candidate)",
            f"{peak_s.get('stress_MPa', '-')} MPa",
            f"{peak_s.get('stress_raw', '-')} {peak_s.get('stress_raw_unit', '')}",
            f"No. {peak_s.get('serial_number', '-')} (Strain: {peak_s.get('strain_pct', '-')}% @ {peak_s.get('time_sec', '-')}s)",
        ],
        [
            "Peak Load",
            f"{peak_l.get('load_N', '-')} N",
            f"{peak_l.get('load_raw', '-')} {peak_l.get('load_raw_unit', '')}",
            f"No. {peak_l.get('serial_number', '-')}",
        ],
        [
            "Elastic Modulus (E)",
            f"{elastic.get('E_GPa', '-')} GPa" if elastic.get("is_valid") else "Restricted",
            f"R2 = {elastic.get('r_squared', '-')}" if elastic.get("is_valid") else elastic.get("reason", "N/A"),
            f"Range: {elastic.get('strain_start_pct', '-')}% ~ {elastic.get('strain_end_pct', '-')}% ({elastic.get('point_count', 0)} pts)",
        ],
        [
            "0.2% Offset Yield (Rp0.2)",
            f"{offset_y.get('yield_stress_MPa', '-')} MPa" if offset_y.get("is_valid") else "Restricted",
            f"Strain: {offset_y.get('yield_strain_pct', '-')}%" if offset_y.get("is_valid") else offset_y.get("reason", "N/A"),
            offset_y.get("method", "Not verified"),
        ],
    ]
    metric_rows = [[Paragraph(escape(str(value)), cell_style) for value in row] for row in metric_rows]
    t_metric = Table(metric_rows, colWidths=[130, 90, 150, 150])
    t_metric.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EFF6FF")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#1D4ED8")),
            ("FONTNAME", (0, 0), (-1, -1), font_reg),
            ("FONTNAME", (0, 0), (-1, 0), font_bold),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
            ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#BFDBFE")),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ])
    )
    story.append(t_metric)
    story.append(Spacer(1, 14))

    # Visual Charts
    story.append(Paragraph("2. Experimental Curves (Stress-Strain, Load-Displacement, Time-Load)", h2_style))
    try:
        chart_bytes = generate_utm_charts_image(analysis_result, title=analysis_name)
        chart_io = io.BytesIO(chart_bytes)
        img = Image(chart_io, width=520, height=155)
        story.append(img)
    except Exception as e:
        story.append(Paragraph(f"Chart generation error: {e}", body_style))
    story.append(Spacer(1, 12))

    # Notes & Warnings
    story.append(Paragraph("3. Analysis Notes, Warnings & Verification Guidelines", h2_style))
    neg_info = analysis_result.get("negative_load_summary", {})
    neg_text = (
        f"Negative load detected: {neg_info.get('count', 0)} rows (Serial No. {neg_info.get('first_serial')} ~ {neg_info.get('last_serial')}). "
        "Likely due to transducer zero drift or post-break slack."
        if neg_info.get("count", 0) > 0
        else "No negative loads detected in analyzed slice."
    )
    notes_paragraphs = [
        f"• <b>Negative Load Status:</b> {neg_text}",
        "• <b>True Stress / True Strain:</b> Preserved as provided in raw file without unverified conversion. Engineering curves are prioritized.",
        "• <b>Crosshead vs Extensometer:</b> If displacement was recorded from crosshead stroke rather than clip-on extensometer, machine compliance may affect strain accuracy.",
    ]
    for np_text in notes_paragraphs:
        story.append(Paragraph(np_text, body_style))
        story.append(Spacer(1, 3))

    doc.build(story)
    return buf.getvalue()
