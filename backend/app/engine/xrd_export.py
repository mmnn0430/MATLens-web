"""XRD High-Resolution Figure Exporter with Phase Candidates, Peak Labels, and Reference Patterns.
Generates publication-quality (300 DPI) PNG charts matching standard crystallographic and materials literature formats.
"""
from __future__ import annotations

import io
from pathlib import Path
from typing import Any
import numpy as np

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm


def _setup_korean_font() -> None:
    """Set reliable Korean font in matplotlib for Windows/Linux."""
    bundled_font = Path(__file__).resolve().parent.parent.parent / "assets" / "fonts" / "NanumGothic.ttf"
    if bundled_font.exists():
        try:
            fm.fontManager.addfont(str(bundled_font))
            matplotlib.rcParams["font.family"] = ["NanumGothic", "DejaVu Sans"]
            matplotlib.rcParams["axes.unicode_minus"] = False
            return
        except Exception:
            pass

    available = {f.name for f in fm.fontManager.ttflist}
    for candidate in ["NanumGothic", "Malgun Gothic", "Noto Sans KR", "Gulim", "AppleGothic", "DejaVu Sans"]:
        if candidate in available:
            matplotlib.rcParams["font.family"] = [candidate, "DejaVu Sans"]
            break
    matplotlib.rcParams["axes.unicode_minus"] = False


def generate_xrd_figure_png(
    sample_name: str,
    xrd_result: dict[str, Any],
    selected_candidate_id: str | None = None,
    dpi: int = 300,
) -> bytes:
    """Render high-resolution XRD graph with:
    1. Experimental diffraction signal (Raw / Background-Corrected)
    2. Detected Peak markers with two-theta and hkl / phase labels
    3. Selected Phase Candidate theoretical Bragg stick pattern
    4. Top Phase Candidates list box with matching score, spacegroup, and E_hull
    5. Clean scientific publication styling (axes in 2θ (°), Intensity (a.u.), etc.)
    """
    _setup_korean_font()

    # Retrieve series data with multiple fallbacks
    series = xrd_result.get("series") or xrd_result.get("signals") or {}
    insp = xrd_result.get("inspection") or {}

    tt = np.asarray(series.get("two_theta", insp.get("two_theta", [])), dtype=float)
    corr = np.asarray(series.get("corrected_unsmoothed", []), dtype=float)
    raw = np.asarray(series.get("raw_intensity", insp.get("intensity_raw", [])), dtype=float)
    bg = np.asarray(series.get("background", []), dtype=float)

    # Fallback if corrected is empty
    if len(corr) == 0 and len(raw) > 0:
        corr = raw
    elif len(raw) == 0 and len(corr) > 0:
        raw = corr

    peaks = xrd_result.get("peaks", [])
    active_peaks = [p for p in peaks if not p.get("user_excluded")]

    pm = xrd_result.get("phase_matching", {})
    candidates = pm.get("candidates", [])

    active_cand = None
    if selected_candidate_id:
        active_cand = next((c for c in candidates if c.get("phase_id") == selected_candidate_id), None)
    if not active_cand and candidates:
        active_cand = candidates[0]

    # Create figure with 2 subplots (Top: XRD Pattern & Peak Positions, Bottom: Bragg Stick Bar)
    fig = plt.figure(figsize=(11.0, 7.2), dpi=dpi, facecolor="white")
    gs = fig.add_gridspec(nrows=2, ncols=1, height_ratios=[4.0, 1.2], hspace=0.18)
    ax_main = fig.add_subplot(gs[0])
    ax_stick = fig.add_subplot(gs[1], sharex=ax_main)

    # 1. Main XRD curve (Background-corrected and raw / background)
    max_y = float(np.max(corr)) if len(corr) > 0 else 100.0
    if max_y <= 0:
        max_y = 100.0

    if len(corr) > 0 and len(tt) == len(corr):
        ax_main.plot(tt, corr, color="#1D4ED8", lw=1.5, label="배경보정 회절 패턴 (Corrected)", zorder=3)
    elif len(raw) > 0 and len(tt) == len(raw):
        ax_main.plot(tt, raw, color="#1D4ED8", lw=1.5, label="회절 원시 패턴 (Raw)", zorder=3)

    if len(bg) > 0 and len(tt) == len(bg) and np.any(bg > 0):
        ax_main.plot(tt, bg, color="#94A3B8", lw=1.1, ls="--", label="추정 배경선 (Background)", zorder=2)

    # 2. Detected Peak Position Markers & Labels
    matched_ids = set(active_cand.get("explained_peak_ids", [])) if active_cand else set()

    # Determine peak annotations
    y_margin = max_y * 0.18
    for p in active_peaks:
        px = float(p.get("two_theta", 0))
        py = float(p.get("height", 0))
        pid = p.get("peak_id", "")
        hkl = p.get("assigned_hkl")
        rel_i = float(p.get("rel_intensity_pct", 0))
        is_matched = pid in matched_ids

        marker_col = "#16A34A" if is_matched else "#D97706"
        ax_main.scatter([px], [py], color=marker_col, s=38, zorder=5, edgecolor="white", linewidth=0.9)

        # Show label for matched or major peaks
        if is_matched or rel_i >= 5.0:
            lbl_parts = [f"{px:.2f}°"]
            if hkl and is_matched:
                lbl_parts.append(f"{hkl}")
            ax_main.annotate(
                "\n".join(lbl_parts),
                xy=(px, py),
                xytext=(0, 6),
                textcoords="offset points",
                ha="center",
                va="bottom",
                fontsize=7.2,
                color="#0F172A",
                fontweight="bold" if is_matched else "normal",
                rotation=90 if len(active_peaks) > 12 else 0,
                bbox=dict(boxstyle="round,pad=0.15", facecolor="white", edgecolor="none", alpha=0.8),
                zorder=6,
            )

    ax_main.set_ylabel("Intensity (a.u.)", fontsize=11, fontweight="semibold")
    ax_main.set_ylim(-max_y * 0.03, max_y + y_margin)
    if len(tt) > 0:
        ax_main.set_xlim(float(np.min(tt)), float(np.max(tt)))
    ax_main.tick_params(direction="in", top=True, right=True, labelsize=9.5)
    ax_main.grid(True, linestyle=":", alpha=0.45, color="#CBD5E1")

    # 3. Reference Candidate Phase Stick Pattern (Bragg Positions)
    has_sticks = False
    if active_cand:
        # Check standard stick fields in candidate
        stick_tts = active_cand.get("ref_stick_two_theta") or []
        stick_ints = active_cand.get("ref_stick_intensity") or []
        stick_hkls = active_cand.get("ref_stick_hkl") or []

        # Fallback to reference_peaks dict list if ref_stick_* not present
        if not stick_tts and active_cand.get("reference_peaks"):
            ref_list = active_cand.get("reference_peaks", [])
            stick_tts = [float(rp.get("two_theta", 0)) for rp in ref_list]
            stick_ints = [float(rp.get("rel_intensity_pct", 0)) for rp in ref_list]
            stick_hkls = [rp.get("hkl") for rp in ref_list]

        if stick_tts and len(stick_tts) > 0:
            has_sticks = True
            cand_formula = active_cand.get("formula") or active_cand.get("name") or "후보 상"
            spg = active_cand.get("spacegroup", "")
            mp_id = active_cand.get("mp_id", "")
            cand_label = f"참조 브래그 피크 (Bragg Sticks): {cand_formula}"
            if spg:
                cand_label += f" [{spg}]"
            if mp_id:
                cand_label += f" ({mp_id})"

            for rx, ri, rhkl in zip(stick_tts, stick_ints, stick_hkls):
                ri_norm = float(ri) / 100.0 if float(ri) > 1.0 else float(ri)
                ax_stick.vlines(rx, 0, ri_norm, color="#DC2626", lw=1.8, zorder=3)
                if rhkl and ri_norm >= 0.20:
                    ax_stick.text(
                        rx,
                        min(ri_norm + 0.05, 1.15),
                        str(rhkl),
                        ha="center",
                        va="bottom",
                        fontsize=7.0,
                        color="#B91C1C",
                        fontweight="medium",
                    )

            ax_stick.set_ylim(0, 1.28)
            ax_stick.set_yticks([0, 0.5, 1.0])
            ax_stick.set_yticklabels(["0", "50%", "100%"])
            ax_stick.set_ylabel("상대 강도", fontsize=9.0)
            ax_stick.text(
                0.015,
                0.80,
                cand_label,
                transform=ax_stick.transAxes,
                fontsize=8.5,
                fontweight="semibold",
                color="#991B1B",
                bbox=dict(boxstyle="round,pad=0.3", facecolor="#FEF2F2", edgecolor="#FECACA", alpha=0.92),
            )

    if not has_sticks:
        ax_stick.set_yticks([])
        ax_stick.text(
            0.5,
            0.5,
            "선택된 상 후보에 대한 브래그 피크 정보가 없습니다.",
            transform=ax_stick.transAxes,
            ha="center",
            va="center",
            fontsize=8.5,
            color="#94A3B8",
        )

    ax_stick.set_xlabel("Diffraction Angle 2θ (deg)", fontsize=11, fontweight="semibold")
    ax_stick.tick_params(direction="in", top=False, right=True, labelsize=9.5)
    ax_stick.grid(True, linestyle=":", alpha=0.45, color="#CBD5E1")
    if len(tt) > 0:
        ax_stick.set_xlim(float(np.min(tt)), float(np.max(tt)))

    # 4. Phase Candidates Summary Info Box (Top Right)
    cand_lines = [f"[상 매칭 결과: {sample_name}]"]
    for i, c in enumerate(candidates[:4], 1):
        score = c.get("score", 0)
        formula = c.get("formula", "")
        spg = c.get("spacegroup", "")
        e_hull = c.get("e_hull_ev")
        mp_id = c.get("mp_id", "")
        mp_str = f" ({mp_id})" if mp_id else ""
        eh_str = f", Eh={e_hull:.3f}eV" if e_hull is not None else ""
        cand_lines.append(f" {i}. {formula} [{spg}]{mp_str} : {score}점{eh_str}")

    info_text = "\n".join(cand_lines)
    ax_main.text(
        0.985,
        0.965,
        info_text,
        transform=ax_main.transAxes,
        fontsize=8.5,
        verticalalignment="top",
        horizontalalignment="right",
        bbox=dict(boxstyle="round,pad=0.45", facecolor="#F8FAFC", edgecolor="#CBD5E1", alpha=0.92),
        zorder=7,
    )

    # 5. Title & Metadata
    conditions = xrd_result.get("conditions", {})
    wl = conditions.get("wavelength_angstrom", 1.5406)
    xray_src = conditions.get("xray_source", "Cu Kα (1.5406 Å)")
    sch_nm = xrd_result.get("scherrer", {}).get("mean_nm")
    sch_str = f" · Scherrer 결정자 크기: {sch_nm} nm" if sch_nm else ""

    ax_main.set_title(
        f"XRD 패턴 및 상 후보 정합 분석 — {sample_name} ({xray_src}{sch_str})",
        fontsize=12.5,
        fontweight="bold",
        pad=10,
        color="#0F172A",
    )
    handles, labels = ax_main.get_legend_handles_labels()
    if handles:
        ax_main.legend(handles, labels, loc="upper left", framealpha=0.9, fontsize=8.5, edgecolor="#E2E8F0")

    # Save to high-res PNG bytes
    buf = io.BytesIO()
    plt.savefig(buf, format="png", dpi=dpi, bbox_inches="tight")
    plt.close(fig)
    return buf.getvalue()
