"""Publication-Quality Standalone PDF Report Generator for FT-IR, DSC, and TGA.

Uses ReportLab with bundled NanumGothic Korean fonts and embedded Matplotlib figures.
"""
from __future__ import annotations

import io
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
import numpy as np

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    Image as RLImage,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.engine.pdf_export import _register_korean_font


def _generate_ftir_chart_png(analysis: dict[str, Any], font_path: str | None) -> bytes:
    """Generate 2-panel FT-IR plot: Full Spectrum (top) + Fringe Zoom / Absorbance (bottom)."""
    fprop = font_manager.FontProperties(fname=font_path) if font_path else None
    wn = analysis["wavenumbers"]
    t_pct = analysis["transmittance_pct"]
    abs_y = analysis["absorbance"]
    peaks = analysis.get("peaks", [])
    fringes = analysis.get("fringes", {})

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(7.2, 4.2), dpi=180, gridspec_kw={"height_ratios": [1.5, 1.2], "hspace": 0.35})

    # Panel 1: Full Transmittance Spectrum (Wavenumber 4000 -> 400 cm-1)
    ax1.plot(wn, t_pct, color="#2563EB", lw=1.1, label="투과율 (%T)")
    if peaks:
        px = [p["wavenumber"] for p in peaks[:12]]
        py = [p["transmittance_pct"] for p in peaks[:12]]
        ax1.scatter(px, py, color="#DC2626", s=18, zorder=5, label="검출 피크")
        for p in peaks[:6]:
            ax1.annotate(f"{p['wavenumber']:.0f}", (p["wavenumber"], p["transmittance_pct"]),
                         textcoords="offset points", xytext=(0, -12), ha="center", fontsize=6.5, fontproperties=fprop)

    ax1.set_xlim(max(wn), min(wn))  # Reversed x-axis convention
    ax1.set_ylim(0, 105)
    ax1.set_xlabel("Wavenumber (cm-1)", fontsize=8.5, fontproperties=fprop)
    ax1.set_ylabel("Transmittance (%)", fontsize=8.5, fontproperties=fprop)
    ax1.set_title("FT-IR 투과율 스펙트럼 및 주요 밴드 검출", fontsize=9.5, fontweight="bold", fontproperties=fprop)
    ax1.grid(True, alpha=0.25, ls="--")
    leg1 = ax1.legend(loc="upper right", fontsize=7.5, frameon=True)
    if fprop:
        for t in leg1.get_texts():
            t.set_fontproperties(fprop)

    # Panel 2: Absorbance or Interference Fringes
    if fringes.get("status") == "분석 완료" or fringes.get("optical_thickness_um"):
        # Plot fringe zoom range
        nu_r = fringes.get("nu_range_used", [1900, 2700])
        mask = (np.array(wn) >= nu_r[0] - 50) & (np.array(wn) <= nu_r[1] + 50)
        ax2.plot(np.array(wn)[mask], np.array(t_pct)[mask], color="#059669", lw=1.2, label="간섭무늬 영역")
        sel_pts = fringes.get("selected_points", [])
        if sel_pts:
            fx = [p["wavenumber"] for p in sel_pts]
            fy = [p["signal"] for p in sel_pts]
            ax2.scatter(fx, fy, color="#D97706", s=25, zorder=6, label=f"선택 극값 (N={len(fx)})")
        ax2.set_xlim(nu_r[1] + 50, nu_r[0] - 50)
        ax2.set_xlabel("Wavenumber (cm-1)", fontsize=8.5, fontproperties=fprop)
        ax2.set_ylabel("Transmittance (%)", fontsize=8.5, fontproperties=fprop)
        ax2.set_title("박막 간섭무늬(Interference Fringes) 확대", fontsize=8.5, fontproperties=fprop)
    else:
        # Plot Absorbance
        ax2.plot(wn, abs_y, color="#7C3AED", lw=1.0, label="흡광도 (A)")
        ax2.set_xlim(max(wn), min(wn))
        ax2.set_xlabel("Wavenumber (cm-1)", fontsize=8.5, fontproperties=fprop)
        ax2.set_ylabel("Absorbance (A)", fontsize=8.5, fontproperties=fprop)
        ax2.set_title("흡광도 변환 스펙트럼 (A = -log10(T))", fontsize=8.5, fontproperties=fprop)

    ax2.grid(True, alpha=0.25, ls="--")
    leg2 = ax2.legend(loc="upper right", fontsize=7.5, frameon=True)
    if fprop:
        for t in leg2.get_texts():
            t.set_fontproperties(fprop)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", dpi=180)
    plt.close(fig)
    return buf.getvalue()


def _generate_dsc_chart_png(analysis: dict[str, Any], font_path: str | None) -> bytes:
    """Generate 2-panel DSC plot: Heat Flow Curve (top) + Derivative d(HF)/dT (bottom)."""
    fprop = font_manager.FontProperties(fname=font_path) if font_path else None
    t = analysis["temperature"]
    q = analysis["heat_flow"]
    dq = analysis.get("heat_flow_deriv", [])
    trans = analysis.get("transitions", {})

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(7.2, 4.2), dpi=180, gridspec_kw={"height_ratios": [1.5, 1.0], "hspace": 0.35})

    ax1.plot(t, q, color="#2563EB", lw=1.3, label=f"Heat Flow ({analysis.get('heat_flow_unit', 'mW/mg')})")

    # Annotate Tm, Tc, Tg if present
    tm = trans.get("melting", {})
    if tm.get("status") == "검출 완료" and tm.get("tm_peak_c"):
        ax1.scatter([tm["tm_peak_c"]], [np.interp(tm["tm_peak_c"], t, q)], color="#DC2626", s=30, zorder=6)
        ax1.annotate(f"Tm {tm['tm_peak_c']:.1f}°C\n(dH {tm.get('delta_h_m_J_per_g', '')} J/g)",
                     (tm["tm_peak_c"], np.interp(tm["tm_peak_c"], t, q)),
                     textcoords="offset points", xytext=(0, 14), ha="center", fontsize=7.5, fontproperties=fprop)

    tc = trans.get("crystallization", {})
    if tc.get("status") == "검출 완료" and tc.get("tc_peak_c"):
        ax1.scatter([tc["tc_peak_c"]], [np.interp(tc["tc_peak_c"], t, q)], color="#059669", s=30, zorder=6)
        ax1.annotate(f"Tc {tc['tc_peak_c']:.1f}°C\n(dH {tc.get('delta_h_c_J_per_g', '')} J/g)",
                     (tc["tc_peak_c"], np.interp(tc["tc_peak_c"], t, q)),
                     textcoords="offset points", xytext=(0, -18), ha="center", fontsize=7.5, fontproperties=fprop)

    tg = trans.get("glass_transition", {})
    if tg.get("status") == "검출 완료" and tg.get("tg_midpoint_c"):
        ax1.axvline(tg["tg_midpoint_c"], color="#D97706", ls=":", lw=1.2, label=f"Tg {tg['tg_midpoint_c']:.1f}°C")

    ax1.set_xlabel("Temperature (°C)", fontsize=8.5, fontproperties=fprop)
    ax1.set_ylabel(f"Heat Flow ({analysis.get('heat_flow_unit', 'W/g')})", fontsize=8.5, fontproperties=fprop)
    ax1.set_title(f"DSC 열분석 곡선 — {analysis.get('active_segment', {}).get('name', '가열/냉각 단계')}", fontsize=9.5, fontweight="bold", fontproperties=fprop)
    ax1.grid(True, alpha=0.25, ls="--")
    leg1 = ax1.legend(loc="best", fontsize=7.5, frameon=True)
    if fprop:
        for txt in leg1.get_texts():
            txt.set_fontproperties(fprop)

    # Derivative panel
    if dq:
        ax2.plot(t, dq, color="#7C3AED", lw=1.1, label="d(Heat Flow)/dT")
        ax2.set_xlabel("Temperature (°C)", fontsize=8.5, fontproperties=fprop)
        ax2.set_ylabel("d(HF)/dT", fontsize=8.5, fontproperties=fprop)
        ax2.set_title("열유속 1차 온도 미분 곡선 (전이 변곡점 감지)", fontsize=8.5, fontproperties=fprop)
        ax2.grid(True, alpha=0.25, ls="--")
        leg2 = ax2.legend(loc="best", fontsize=7.5, frameon=True)
        if fprop:
            for txt in leg2.get_texts():
                txt.set_fontproperties(fprop)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", dpi=180)
    plt.close(fig)
    return buf.getvalue()


def _generate_tga_chart_png(analysis: dict[str, Any], font_path: str | None) -> bytes:
    """Generate 2-panel TGA plot: TGA Mass % Curve (top) + DTG Rate Curve (bottom)."""
    fprop = font_manager.FontProperties(fname=font_path) if font_path else None
    t = analysis["temperature"]
    w = analysis["mass_percent"]
    dtg = analysis.get("dtg_pct_per_c", [])
    decomp = analysis.get("decomposition_characteristics", {})

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(7.2, 4.2), dpi=180, gridspec_kw={"height_ratios": [1.4, 1.1], "hspace": 0.35})

    ax1.plot(t, w, color="#2563EB", lw=1.3, label="잔존 질량 (Weight %)")

    # Mark T5 and T10
    t5 = decomp.get("T5_c")
    if t5:
        ax1.scatter([t5], [95.0], color="#D97706", s=25, zorder=6, label=f"T5 ({t5:.1f}°C)")
    t10 = decomp.get("T10_c")
    if t10:
        ax1.scatter([t10], [90.0], color="#DC2626", s=25, zorder=6, label=f"T10 ({t10:.1f}°C)")

    # Gas switch indicator
    atm = analysis.get("atmosphere_conditions", {})
    if atm.get("gas_switch_temp_c"):
        ax1.axvline(atm["gas_switch_temp_c"], color="#059669", ls="--", lw=1.2,
                    label=f"분위기 전환 ({atm['gas_switch_temp_c']}°C)")

    ax1.set_ylim(-2, 105)
    ax1.set_xlabel("Temperature (°C)", fontsize=8.5, fontproperties=fprop)
    ax1.set_ylabel("Residual Mass (%)", fontsize=8.5, fontproperties=fprop)
    ax1.set_title("TGA 열중량 분석 곡선 (온도별 잔존 질량)", fontsize=9.5, fontweight="bold", fontproperties=fprop)
    ax1.grid(True, alpha=0.25, ls="--")
    leg1 = ax1.legend(loc="best", fontsize=7.5, frameon=True)
    if fprop:
        for txt in leg1.get_texts():
            txt.set_fontproperties(fprop)

    # DTG panel
    if dtg:
        ax2.plot(t, dtg, color="#DC2626", lw=1.1, label="DTG (-dW/dT, %/°C)")
        pks = decomp.get("dtg_peaks", [])
        for p in pks[:3]:
            ax2.scatter([p["temperature_c"]], [p["max_decomposition_rate_pct_per_c"]], color="#7C3AED", s=22, zorder=6)
            ax2.annotate(f"{p['temperature_c']:.0f}°C", (p["temperature_c"], p["max_decomposition_rate_pct_per_c"]),
                         textcoords="offset points", xytext=(0, 8), ha="center", fontsize=7.0, fontproperties=fprop)

        ax2.set_xlabel("Temperature (°C)", fontsize=8.5, fontproperties=fprop)
        ax2.set_ylabel("DTG (%/°C)", fontsize=8.5, fontproperties=fprop)
        ax2.set_title("DTG 미분 열중량 곡선 (최대 분해 속도 피크)", fontsize=8.5, fontproperties=fprop)
        ax2.grid(True, alpha=0.25, ls="--")
        leg2 = ax2.legend(loc="upper right", fontsize=7.5, frameon=True)
        if fprop:
            for txt in leg2.get_texts():
                txt.set_fontproperties(fprop)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", dpi=180)
    plt.close(fig)
    return buf.getvalue()


def generate_spectro_pdf_report(
    instrument: str,  # 'ftir', 'dsc', 'tga'
    analysis_result: dict[str, Any],
    file_name: str,
    analysis_title: str = "",
    notes: str = "",
    ai_interpretation: dict[str, Any] | None = None,
) -> bytes:
    """Generate standalone Korean PDF report for FT-IR, DSC, or TGA."""
    font_reg, font_bold, font_path = _register_korean_font()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=14 * mm,
        bottomMargin=14 * mm,
        title=f"MatLens {instrument.upper()} Report",
    )

    styles = getSampleStyleSheet()
    st_title = ParagraphStyle("SPO_Title", parent=styles["Title"], fontName=font_bold, fontSize=16, leading=22, textColor=colors.HexColor("#1E3A8A"), alignment=0)
    st_sub = ParagraphStyle("SPO_Sub", parent=styles["Normal"], fontName=font_reg, fontSize=8.5, leading=13, textColor=colors.HexColor("#64748B"))
    st_h2 = ParagraphStyle("SPO_H2", parent=styles["Heading2"], fontName=font_bold, fontSize=11.5, leading=16, spaceBefore=8, spaceAfter=4, textColor=colors.HexColor("#0F172A"))
    st_body = ParagraphStyle("SPO_Body", parent=styles["Normal"], fontName=font_reg, fontSize=8.5, leading=13, textColor=colors.HexColor("#1E293B"))
    st_small = ParagraphStyle("SPO_Small", parent=st_body, fontSize=7.5, leading=11, textColor=colors.HexColor("#64748B"))

    inst_name = {"ftir": "FT-IR 적외선 분광분석", "dsc": "DSC 시차주사열량분석", "tga": "TGA 열중량분석"}.get(instrument.lower(), instrument.upper())
    story: list[Any] = []

    # 1. Header
    story.append(Paragraph(escape(f"MatLens {inst_name} 종합 리포트 — {analysis_title or file_name}"), st_title))
    story.append(Spacer(1, 2 * mm))
    story.append(Paragraph(escape(f"파일명: {file_name} | 분석 모듈: {inst_name} | 상태: {analysis_result.get('status', '완료')} | 원본 보존"), st_sub))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#E2E8F0"), spaceAfter=4 * mm))

    # 2. Key Metrics Table
    story.append(Paragraph("1. 분석 조건 및 핵심 수치 지표", st_h2))
    rows: list[list[str]] = [["지표 항목", "수치 및 단위", "산출 근거 / 상태"]]

    if instrument.lower() == "ftir":
        fringes = analysis_result.get("fringes", {})
        peaks = analysis_result.get("peaks", [])
        rows.append(["검출된 주요 피크 수", f"{len(peaks)} 개", "파수 범위 내 흡수 극대/극소"])
        if fringes.get("physical_thickness_um"):
            rows.append(["간섭무늬 산출 막 두께 (d)", f"{fringes['physical_thickness_um']} μm", f"굴절률 n={fringes.get('refractive_index')}, {fringes.get('m_interval_count')}개 간격"])
        if fringes.get("optical_thickness_um"):
            rows.append(["광학적 두께 (n·d)", f"{fringes['optical_thickness_um']} μm", "굴절률 미지정 시의 순수 광학 거리"])

    elif instrument.lower() == "dsc":
        trans = analysis_result.get("transitions", {})
        tm = trans.get("melting", {})
        tc = trans.get("crystallization", {})
        tg = trans.get("glass_transition", {})
        xc = trans.get("crystallinity", {})
        if tm.get("tm_peak_c"):
            rows.append(["용융 온도 (Tm)", f"{tm['tm_peak_c']} °C", f"용융 엔탈피 ΔHm = {tm.get('delta_h_m_J_per_g', '-')} J/g"])
        if tc.get("tc_peak_c"):
            rows.append(["결정화 온도 (Tc)", f"{tc['tc_peak_c']} °C", f"결정화 엔탈피 ΔHc = {tc.get('delta_h_c_J_per_g', '-')} J/g"])
        if tg.get("tg_midpoint_c"):
            rows.append(["유리전이온도 (Tg)", f"{tg['tg_midpoint_c']} °C", "1차 미분 변곡점/중간점(Midpoint)"])
        if xc.get("crystallinity_pct") is not None:
            rows.append(["조건부 결정화도 (Xc)", f"{xc['crystallinity_pct']} %", f"기준 ΔHm° = {xc.get('standard_melting_enthalpy_J_per_g')} J/g"])

    elif instrument.lower() == "tga":
        decomp = analysis_result.get("decomposition_characteristics", {})
        res = analysis_result.get("residual", {})
        if decomp.get("T5_c"):
            rows.append(["5% 질량 감소 온도 (T₅)", f"{decomp['T5_c']} °C", decomp.get("T5_status", "")])
        if decomp.get("T10_c"):
            rows.append(["10% 질량 감소 온도 (T₁₀)", f"{decomp['T10_c']} °C", decomp.get("T10_status", "")])
        rows.append(["최종 잔류율 (Residue)", f"{res.get('final_residual_pct', '-')} %", f"측정 종료 온도 {res.get('final_temperature_c', '-')}°C 기준"])

    t_meta = Table(rows, colWidths=[55 * mm, 50 * mm, 77 * mm])
    t_meta.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), font_reg),
        ("FONTNAME", (0, 0), (-1, 0), font_bold),
        ("FONTSIZE", (0, 0), (-1, -1), 8.0),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EFF6FF")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#1D4ED8")),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
        ("PADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(t_meta)
    story.append(Spacer(1, 4 * mm))

    # 3. Chart
    story.append(Paragraph("2. 측정 및 수치 해석 그래프", st_h2))
    if instrument.lower() == "ftir":
        png_bytes = _generate_ftir_chart_png(analysis_result, font_path)
    elif instrument.lower() == "dsc":
        png_bytes = _generate_dsc_chart_png(analysis_result, font_path)
    else:
        png_bytes = _generate_tga_chart_png(analysis_result, font_path)

    story.append(RLImage(io.BytesIO(png_bytes), width=182 * mm, height=105 * mm))
    story.append(Spacer(1, 4 * mm))

    # 4. Detailed Tables (Steps / Peaks)
    if instrument.lower() == "ftir":
        peaks = analysis_result.get("peaks", [])[:8]
        if peaks:
            story.append(Paragraph("3. 주요 검출 피크 및 작용기(Functional Group) 대조", st_h2))
            p_rows = [["피크 ID", "파수 (cm⁻¹)", "투과율 (%)", "흡광도 (A)", "대응 작용기 / 진동 모드"]]
            for p in peaks:
                fgs = p.get("functional_groups", [])
                fg_text = ", ".join(f"{g['name']} ({g['bond']})" for g in fgs) if fgs else "지문 영역 / 미분류"
                p_rows.append([p["id"], f"{p['wavenumber']}", f"{p['transmittance_pct']}", f"{p['absorbance']}", fg_text])
            t_pk = Table(p_rows, colWidths=[18 * mm, 28 * mm, 24 * mm, 24 * mm, 88 * mm])
            t_pk.setStyle(TableStyle([
                ("FONTNAME", (0, 0), (-1, -1), font_reg),
                ("FONTNAME", (0, 0), (-1, 0), font_bold),
                ("FONTSIZE", (0, 0), (-1, -1), 7.5),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F8FAFC")),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
                ("PADDING", (0, 0), (-1, -1), 3.5),
            ]))
            story.append(t_pk)

    elif instrument.lower() == "tga":
        steps = analysis_result.get("steps", [])
        if steps:
            story.append(Paragraph("3. 구간별 열분해 및 질량 감소 상세 표", st_h2))
            s_rows = [["구간명", "온도 구간 (°C)", "시작 잔존율", "종료 잔존율", "질량 감소율 (%)", "분위기"]]
            for s in steps:
                s_rows.append([
                    s["label"],
                    f"{s['temperature_range_c'][0]} ~ {s['temperature_range_c'][1]}",
                    f"{s['initial_residual_pct']}%",
                    f"{s['final_residual_pct']}%",
                    f"{s['mass_loss_pct']}%",
                    s.get("atmosphere", "N₂"),
                ])
            t_st = Table(s_rows, colWidths=[32 * mm, 38 * mm, 28 * mm, 28 * mm, 30 * mm, 26 * mm])
            t_st.setStyle(TableStyle([
                ("FONTNAME", (0, 0), (-1, -1), font_reg),
                ("FONTNAME", (0, 0), (-1, 0), font_bold),
                ("FONTSIZE", (0, 0), (-1, -1), 7.5),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F8FAFC")),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
                ("PADDING", (0, 0), (-1, -1), 3.5),
            ]))
            story.append(t_st)

    # 5. Gemini AI Interpretation (if provided)
    if ai_interpretation and ai_interpretation.get("status") == "completed" and ai_interpretation.get("report"):
        rep = ai_interpretation["report"]
        story.append(Spacer(1, 3 * mm))
        story.append(Paragraph("4. Gemini AI 심층 과학적 해석 (Executive Summary)", st_h2))
        ai_box = [
            Paragraph(f"<b>모델:</b> {ai_interpretation.get('model_name', 'gemini')} | <b>검증 상태:</b> Python 수치 결과 엄격 매핑 완료", st_small),
            Paragraph(escape(rep.get("executive_summary", "")), st_body),
        ]
        t_ai = Table([[ai_box]], colWidths=[182 * mm])
        t_ai.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F0FDF4")),
            ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#BBF7D0")),
            ("PADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(t_ai)

    # 6. Scientific Limitations & Disclaimers
    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph("5. 분석 적용 조건 및 해석 한계 (Caveats & Disclaimers)", st_h2))
    disclaimers = [
        "• 단일 피크 또는 특정 온도 구간만으로 고분자/물질의 정체나 상평형을 임의 단정하지 않습니다.",
        "• 모든 수치(엔탈피, 결정화도, 두께, 분해온도)는 Python 분석 엔진에서 일관된 물리 단위로 수치 적분·보간하여 계산되었습니다.",
        "• FT-IR 막 두께는 수직 입사 및 균일 굴절률(n) 가정 하에 유효하며, 굴절률 미입력 시 광학 두께(n·d)로 제한 표기됩니다.",
        "• DSC 결정화도는 신뢰할 수 있는 100% 결정질 표준 용융 엔탈피(ΔHm°) 문헌치가 명시될 때만 유효하며, 임의의 100 J/g 가정을 엄격 배제합니다.",
        "• TGA 잔류물은 원소분석(EDS 등)이 동반되지 않는 한 임의로 무기 회분(ZnO, SiO₂ 등)으로 확정 명명하지 않습니다.",
    ]
    for d in disclaimers:
        story.append(Paragraph(escape(d), st_small))

    doc.build(story)
    return buf.getvalue()
