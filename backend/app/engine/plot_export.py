"""Publication-Quality Plot Export Engine for MatLens.

Supports:
- Formats: High-res PNG (>=300 DPI), Vector SVG, Multi-page Vector PDF
- Graph Modes: Stacked XRD Pattern, Overlay, Subplot, Peak Comparison
- Annotations: Miller indices (hkl), phase markers, peak shift arrows, legends
- Metadata Preservation: Dataset table, normalization, offsets
"""
from __future__ import annotations

import io
from pathlib import Path
from typing import Any, Literal
import numpy as np

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm


def _setup_korean_font() -> None:
    """Set Korean font in matplotlib for Windows/Linux."""
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


def render_publication_plot(
    plot_data: dict[str, Any],
    format: Literal["png", "svg", "pdf"] = "png",
    dpi: int = 300,
    width_in: float = 7.0,
    height_in: float = 5.2,
    include_metadata_table: bool = True,
) -> bytes:
    """Render publication-grade figure using matplotlib Agg backend."""
    _setup_korean_font()

    plot_type = plot_data.get("plot_type", "stacked")
    title = plot_data.get("title") or "Scientific Data Comparison"
    datasets = [d for d in plot_data.get("datasets", []) if d.get("visible", True)]
    annotations = plot_data.get("annotations", [])
    x_axis_cfg = plot_data.get("x_axis", {})
    y_axis_cfg = plot_data.get("y_axis", {})
    graph_props = plot_data.get("graph_properties", {})

    font_size = float(graph_props.get("font_size", 10.0))
    grid_visible = bool(graph_props.get("grid", True))
    legend_pos = graph_props.get("legend_position", "upper right")

    x_label = x_axis_cfg.get("label", "2θ")
    x_unit = x_axis_cfg.get("unit", "degree")
    x_title = f"{x_label} ({x_unit})" if x_unit else x_label

    y_label = y_axis_cfg.get("label", "Normalized Intensity" if plot_type == "stacked" else "Intensity")
    y_unit = y_axis_cfg.get("unit", "a.u.")
    y_title = f"{y_label} ({y_unit})" if y_unit else y_label

    if plot_type == "subplot" and len(datasets) > 1:
        nrows = len(datasets)
        fig, axes = plt.subplots(
            nrows, 1,
            figsize=(width_in, max(height_in, 1.8 * nrows)),
            sharex=True,
            dpi=dpi,
            gridspec_kw={"hspace": 0.08}
        )
        if nrows == 1:
            axes = [axes]

        for i, (ax, ds) in enumerate(zip(axes, datasets)):
            x = np.array(ds.get("x", []), dtype=float)
            y = np.array(ds.get("y_normalized", ds.get("y_display", [])), dtype=float)
            color = ds.get("color", "#2563EB")
            lw = float(ds.get("line_width", 1.8))
            ls = ds.get("line_style", "solid")
            name = ds.get("sample_name", f"Sample {i+1}")

            ax.plot(x, y, color=color, linewidth=lw, linestyle=ls, label=name)
            ax.tick_params(direction="in", top=True, right=True, labelsize=font_size * 0.9)
            if grid_visible:
                ax.grid(True, linestyle="--", alpha=0.35, color="#94A3B8")
            ax.set_ylabel(y_unit, fontsize=font_size * 0.85)
            ax.legend(loc="upper right", framealpha=0.9, fontsize=font_size * 0.85)

        axes[-1].set_xlabel(x_title, fontsize=font_size, fontweight="semibold")
        axes[0].set_title(title, fontsize=font_size * 1.2, fontweight="bold", pad=12)

    else:
        fig, ax = plt.subplots(figsize=(width_in, height_in), dpi=dpi)

        for ds in datasets:
            x = np.array(ds.get("x", []), dtype=float)
            # In stacked mode use y_display (y_norm + offset); in overlay use y_normalized or y_raw
            if plot_type == "stacked":
                y = np.array(ds.get("y_display", []), dtype=float)
            else:
                y = np.array(ds.get("y_normalized", ds.get("y_raw", [])), dtype=float)

            color = ds.get("color", "#2563EB")
            lw = float(ds.get("line_width", 1.8))
            ls = ds.get("line_style", "solid")
            name = ds.get("sample_name", "Sample")
            offset_val = ds.get("offset", 0.0)

            lbl = f"{name} (+{offset_val:.1f})" if plot_type == "stacked" and offset_val > 0 else name
            ax.plot(x, y, color=color, linewidth=lw, linestyle=ls, label=lbl)

            # Draw baseline offset line for stacked plot
            if plot_type == "stacked" and offset_val > 0 and len(x) > 0:
                ax.hlines(offset_val, x.min(), x.max(), colors=color, linestyles=":", alpha=0.25, linewidth=0.9)

        # Draw Annotations
        for ann in annotations:
            ann_type = ann.get("type", "text")
            ax_x = float(ann.get("x", 0.0))
            ax_y = float(ann.get("y", 0.0))
            text = ann.get("text", "")
            hkl = ann.get("hkl")
            lbl_txt = f"({hkl})" if hkl else text

            if ann_type == "miller_index" or hkl:
                ax.annotate(
                    lbl_txt,
                    xy=(ax_x, ax_y),
                    xytext=(0, 10),
                    textcoords="offset points",
                    ha="center",
                    va="bottom",
                    fontsize=font_size * 0.8,
                    fontweight="bold",
                    color="#1E293B",
                    arrowprops=dict(arrowstyle="->", color="#64748B", lw=0.8),
                )
            elif ann_type == "phase_marker":
                phase_name = ann.get("phase", "Phase")
                ax.scatter([ax_x], [ax_y], marker="v", color="#DC2626", s=40, zorder=5)
                ax.text(ax_x, ax_y * 1.05, phase_name, ha="center", va="bottom", fontsize=font_size * 0.75, color="#B91C1C")
            elif ann_type == "shift_arrow":
                to_x = float(ann.get("to_x", ax_x))
                ax.annotate(
                    "",
                    xy=(to_x, ax_y),
                    xytext=(ax_x, ax_y),
                    arrowprops=dict(arrowstyle="<->", color="#DC2626", lw=1.2),
                )
                delta_str = ann.get("delta_str", f"Δ={to_x - ax_x:+.2f}°")
                ax.text((ax_x + to_x) / 2.0, ax_y * 1.03, delta_str, ha="center", va="bottom", fontsize=font_size * 0.75, color="#DC2626", fontweight="bold")
            else:
                ax.text(ax_x, ax_y, text, fontsize=font_size * 0.85, color="#334155")

        ax.set_xlabel(x_title, fontsize=font_size, fontweight="semibold")
        ax.set_ylabel(y_title, fontsize=font_size, fontweight="semibold")
        ax.set_title(title, fontsize=font_size * 1.2, fontweight="bold", pad=12)

        ax.tick_params(direction="in", top=True, right=True, labelsize=font_size * 0.9)
        if grid_visible:
            ax.grid(True, linestyle="--", alpha=0.35, color="#94A3B8")

        # Custom limits if provided
        if x_axis_cfg.get("min") is not None and x_axis_cfg.get("max") is not None:
            ax.set_xlim(float(x_axis_cfg["min"]), float(x_axis_cfg["max"]))
        if y_axis_cfg.get("min") is not None and y_axis_cfg.get("max") is not None:
            ax.set_ylim(float(y_axis_cfg["min"]), float(y_axis_cfg["max"]))

        ax.legend(loc=legend_pos, framealpha=0.92, fontsize=font_size * 0.88, edgecolor="#CBD5E1")

    fig.tight_layout()

    buf = io.BytesIO()
    if format == "svg":
        fig.savefig(buf, format="svg", bbox_inches="tight")
    elif format == "pdf":
        fig.savefig(buf, format="pdf", bbox_inches="tight", dpi=dpi)
    else:
        fig.savefig(buf, format="png", dpi=dpi, bbox_inches="tight")
    plt.close(fig)

    buf.seek(0)
    return buf.getvalue()
