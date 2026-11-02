"""SEM Image Analysis Engine (Particle Watershed Mode & Grain Boundary Linear Intercept Mode).

Principles:
- Preserves original image resolution coordinates for ROI, scale bar endpoints, and object centroids.
- If scale calibration is not confirmed, all dimensions are strictly reported in 'px' / 'px²' (never fake nm).
- Never treats powder particle watershed segmentation automatically as crystallographic grains.
- Clearly marks all results as observations from a 2D projected micrograph with sample count N and unit.
"""
from __future__ import annotations

import io
import math
from typing import Any

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage import color, filters, measure, morphology, segmentation
from skimage.feature import peak_local_max

from ..config import MAX_IMAGE_PIXELS
from ..schemas import ROIRect, SEMParams


def load_sem_grayscale_and_rgb(raw: bytes) -> tuple[np.ndarray, np.ndarray, str]:
    """Decode JPG/PNG safely, enforce max pixel count, and return (gray_uint8, rgb_uint8, format)."""
    Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
    try:
        with Image.open(io.BytesIO(raw)) as im:
            fmt = (im.format or "PNG").upper()
            w, h = im.size
            if w * h > MAX_IMAGE_PIXELS:
                raise ValueError(
                    f"이미지 해상도({w}×{h} = {w * h:,} px)가 허용 상한({MAX_IMAGE_PIXELS:,} px)을 초과합니다."
                )
            if w < 32 or h < 32:
                raise ValueError(f"이미지 크기({w}×{h} px)가 너무 작아 분석할 수 없습니다 (최소 32×32 px).")
            rgb = np.asarray(im.convert("RGB"), dtype=np.uint8)
            gray = np.asarray(im.convert("L"), dtype=np.uint8)
    except (OSError, Image.DecompressionBombError) as exc:
        raise ValueError("SEM 이미지 파일을 읽을 수 없습니다. 손상 여부와 실제 이미지 형식을 확인해주세요.") from exc
    return gray, rgb, fmt


def detect_info_bar_row(gray: np.ndarray) -> int | None:
    """Estimate bottom SEM data/info bar starting y-coordinate, or None if not detected."""
    h, w = gray.shape
    start = int(h * 0.65)
    rows = gray[start:].astype(float)
    if len(rows) < 10:
        return None
    extreme = ((rows < 28) | (rows > 228)).mean(axis=1)
    row_means = rows.mean(axis=1)
    diffs = np.abs(np.diff(row_means))
    best_score = 0.0
    best_row: int | None = None
    for i in range(len(diffs)):
        below = extreme[i + 1 :]
        if len(below) < max(8, int(h * 0.025)):
            break
        above_mean = float(extreme[: i + 1].mean()) if i >= 0 else 0.0
        below_mean = float(below.mean())
        score = float(diffs[i]) * (below_mean - above_mean)
        if below_mean > 0.58 and score > best_score:
            best_score = score
            best_row = start + i + 1
    return best_row if (best_score > 1.2 and best_row is not None and best_row < h - 6) else None


def detect_scalebar_candidates(gray: np.ndarray, databar_y: int | None) -> list[dict[str, Any]]:
    """Detect horizontal scale bar candidates in the info bar or bottom 22% of the image."""
    h, w = gray.shape
    y_offset = databar_y if (databar_y is not None and databar_y < h - 8) else int(h * 0.78)
    region = gray[y_offset:]
    bg_med = float(np.median(region))
    polarities = ["bright", "dark"] if bg_med < 128 else ["dark", "bright"]

    raw_segments: list[dict[str, Any]] = []
    for pol in polarities:
        mask = (region > 205) if pol == "bright" else (region < 45)
        for r in range(mask.shape[0]):
            row = mask[r].astype(np.int8)
            d = np.diff(np.concatenate([[0], row, [0]]))
            starts = np.where(d == 1)[0]
            ends = np.where(d == -1)[0]
            for s, e in zip(starts, ends):
                length = int(e - s)
                if int(0.04 * w) <= length <= int(0.55 * w):
                    raw_segments.append(
                        {
                            "x0": int(s),
                            "x1": int(e),
                            "y": int(r + y_offset),
                            "length_px": length,
                            "polarity": pol,
                        }
                    )
        if raw_segments:
            break

    if not raw_segments:
        return []

    # Cluster nearby rows belonging to the same thick scale bar rectangle
    raw_segments.sort(key=lambda s: (-s["length_px"], s["y"]))
    clustered: list[dict[str, Any]] = []
    for seg in raw_segments:
        if any(
            abs(seg["y"] - c["y0"]) <= 12 and abs(seg["x0"] - c["x0"]) <= 12 and abs(seg["x1"] - c["x1"]) <= 12
            for c in clustered
        ):
            continue
        clustered.append(
            {
                "x0": seg["x0"],
                "y0": seg["y"],
                "x1": seg["x1"],
                "y1": seg["y"],
                "length_px": float(seg["length_px"]),
                "polarity": seg["polarity"],
            }
        )
        if len(clustered) >= 3:
            break
    return clustered


def inspect_sem_bytes(raw: bytes) -> dict[str, Any]:
    """Inspect uploaded SEM image: dimensions, info bar, scalebar candidates, and suggested safe ROI."""
    gray, _, fmt = load_sem_grayscale_and_rgb(raw)
    h, w = gray.shape
    databar_y = detect_info_bar_row(gray)
    candidates = detect_scalebar_candidates(gray, databar_y)
    safe_h = databar_y if databar_y is not None else h
    default_roi = {"x": 0, "y": 0, "w": int(w), "h": int(safe_h)}
    primary_sb = candidates[0] if candidates else None

    return {
        "format": fmt,
        "width_px": int(w),
        "height_px": int(h),
        "detected_databar_y": databar_y,
        "suggested_roi": default_roi,
        "scalebar_candidates": candidates,
        "primary_scalebar": primary_sb,
        "notes": [
            (
                f"하단 정보 표시 영역(y ≥ {databar_y} px)을 자동 감지하여 기본 분석 ROI에서 제외했습니다."
                if databar_y is not None
                else "별도의 하단 정보 바가 감지되지 않아 전체 영역을 기본 ROI로 설정했습니다."
            ),
            (
                f"스케일바 후보({primary_sb['length_px']:.0f} px)를 찾았습니다. 실제 길이와 단위를 입력·확인해주세요."
                if primary_sb is not None
                else "스케일바를 자동 감지하지 못했습니다. 이미지 위에서 양 끝점을 지정하거나 픽셀 단위로 분석할 수 있습니다."
            ),
        ],
    }


def _resolve_scale(params: SEMParams) -> dict[str, Any]:
    """Compute physical scale conversion or fall back strictly to uncalibrated px."""
    px_len: float | None = None
    if (
        params.scale_x0 is not None
        and params.scale_y0 is not None
        and params.scale_x1 is not None
        and params.scale_y1 is not None
    ):
        dist = math.hypot(params.scale_x1 - params.scale_x0, params.scale_y1 - params.scale_y0)
        if dist >= 2.0:
            px_len = dist
    if px_len is None and params.scale_length_px is not None and params.scale_length_px >= 2.0:
        px_len = float(params.scale_length_px)

    if not params.scale_confirmed or px_len is None or params.scale_real_value is None or params.scale_real_value <= 0:
        return {
            "is_calibrated": False,
            "status": "확인 필요",
            "reason": "스케일바 길이와 단위가 확인되지 않아 모든 치수를 픽셀(px) 단위로 표시합니다.",
            "scale_length_px": round(px_len, 2) if px_len else None,
            "scale_real_value": params.scale_real_value,
            "scale_input_unit": params.scale_unit,
            "display_unit": "px",
            "area_unit": "px²",
            "unit_per_px": 1.0,
            "nm_per_px": None,
        }

    to_nm = {"nm": 1.0, "µm": 1000.0, "mm": 1_000_000.0}[params.scale_unit]
    nm_per_px = (float(params.scale_real_value) * to_nm) / px_len

    # Choose readable display unit: nm for nano/sub-micron regimes (<15 nm/px), µm for micron-scale micrographs
    if nm_per_px >= 15.0 and params.scale_unit in ("µm", "mm"):
        disp_unit = "µm"
        area_unit = "µm²"
        unit_per_px = nm_per_px / 1000.0
    else:
        disp_unit = "nm"
        area_unit = "nm²"
        unit_per_px = nm_per_px

    return {
        "is_calibrated": True,
        "status": "분석 완료",
        "reason": f"스케일 보정 적용됨 ({px_len:.1f} px = {params.scale_real_value:g} {params.scale_unit}, 1 px = {nm_per_px:.3f} nm)",
        "scale_length_px": round(px_len, 2),
        "scale_real_value": params.scale_real_value,
        "scale_input_unit": params.scale_unit,
        "display_unit": disp_unit,
        "area_unit": area_unit,
        "unit_per_px": unit_per_px,
        "nm_per_px": round(nm_per_px, 5),
    }


def _resolve_roi(gray: np.ndarray, roi_spec: ROIRect | None, databar_y: int | None) -> dict[str, int]:
    h, w = gray.shape
    default_h = databar_y if (databar_y is not None and databar_y >= 32) else h
    if roi_spec is None or roi_spec.w <= 0 or roi_spec.h <= 0:
        return {"x": 0, "y": 0, "w": int(w), "h": int(default_h)}
    x = max(0, min(int(roi_spec.x), w - 16))
    y = max(0, min(int(roi_spec.y), h - 16))
    rw = max(16, min(int(roi_spec.w), w - x))
    rh = max(16, min(int(roi_spec.h), h - y))
    return {"x": x, "y": y, "w": rw, "h": rh}


def _enhance_roi(roi_gray: np.ndarray, clahe_clip: float, blur_ksize: int) -> np.ndarray:
    clahe = cv2.createCLAHE(clipLimit=float(clahe_clip), tileGridSize=(8, 8))
    enhanced = clahe.apply(roi_gray)
    if blur_ksize > 0:
        k = int(blur_ksize) | 1
        enhanced = cv2.GaussianBlur(enhanced, (k, k), 0)
    return enhanced


def _encode_png(rgb_arr: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(rgb_arr).save(buf, format="PNG")
    return buf.getvalue()


# ---------------- Mode A: Particle Watershed Analysis ---------------- #
def _run_particle_mode(
    roi_gray: np.ndarray,
    roi_rect: dict[str, int],
    scale_info: dict[str, Any],
    params: SEMParams,
) -> tuple[dict[str, Any], bytes, bytes]:
    enh = _enhance_roi(roi_gray, params.clahe_clip, params.gaussian_blur)
    if params.threshold_mode == "manual":
        th_val = float(params.manual_threshold)
        binary = enh > th_val
    else:
        th_val, mask_u8 = cv2.threshold(enh, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        binary = mask_u8 > 0

    if params.invert_polarity:
        binary = ~binary

    binary = morphology.remove_small_objects(binary, max_size=max(1, params.min_size_px - 1))
    binary = ndi.binary_fill_holes(binary)
    binary = morphology.opening(binary, morphology.disk(1))

    dist = ndi.distance_transform_edt(binary)
    min_dist = max(3, int(round((1.0 - params.split_sensitivity) * 16.0)) + 3)
    conn_labels = measure.label(binary)
    coords = peak_local_max(dist, min_distance=min_dist, labels=conn_labels, exclude_border=False)
    markers = np.zeros_like(dist, dtype=np.int32)
    if len(coords) > 0:
        markers[tuple(coords.T)] = np.arange(1, len(coords) + 1, dtype=np.int32)
    labels = segmentation.watershed(-dist, markers, mask=binary)

    if params.exclude_border:
        labels = segmentation.clear_border(labels)
    labels = morphology.remove_small_objects(labels, max_size=max(1, params.min_size_px - 1))
    labels, _, _ = segmentation.relabel_sequential(labels)

    u_per_px = float(scale_info["unit_per_px"])
    disp_unit = scale_info["display_unit"]
    area_unit = scale_info["area_unit"]
    excluded_set = set(params.excluded_object_ids)

    props = measure.regionprops(labels)
    objects_list: list[dict[str, Any]] = []

    for reg in props:
        oid = int(reg.label)
        area_px = float(reg.area)
        perim_px = max(float(reg.perimeter), 1.0)
        eq_d_px = float(reg.equivalent_diameter_area)
        maj_px = max(float(reg.axis_major_length), eq_d_px * 0.5, 1.0)
        min_px = max(float(reg.axis_minor_length), 1.0)
        circ = min(1.0, max(0.0, (4.0 * math.pi * area_px) / (perim_px**2)))
        ar = maj_px / min_px
        cy_roi, cx_roi = reg.centroid
        min_r, min_c, max_r, max_c = reg.bbox

        objects_list.append(
            {
                "object_id": oid,
                "excluded": oid in excluded_set,
                "centroid_x": round(float(roi_rect["x"] + cx_roi), 1),
                "centroid_y": round(float(roi_rect["y"] + cy_roi), 1),
                "roi_cx": round(float(cx_roi), 1),
                "roi_cy": round(float(cy_roi), 1),
                "roi_bbox": [int(min_c), int(min_r), int(max_c), int(max_r)],
                "area_px2": round(area_px, 1),
                "area": round(area_px * (u_per_px**2), 2),
                "equiv_diameter_px": round(eq_d_px, 2),
                "equiv_diameter": round(eq_d_px * u_per_px, 2),
                "major_axis": round(maj_px * u_per_px, 2),
                "minor_axis": round(min_px * u_per_px, 2),
                "aspect_ratio": round(ar, 3),
                "circularity": round(circ, 3),
                "unit": disp_unit,
                "area_unit": area_unit,
            }
        )

    # Render segmentation overlay (active objects in clear tint + yellow contour; excluded objects in red contour)
    active_labels = labels.copy()
    excl_mask = np.zeros_like(labels, dtype=bool)
    for oid in excluded_set:
        m = labels == oid
        if np.any(m):
            active_labels[m] = 0
            excl_mask |= m

    rgb_base = color.label2rgb(active_labels, image=roi_gray, alpha=0.26, bg_label=0, image_alpha=1.0)
    rgb_bound = segmentation.mark_boundaries(rgb_base, active_labels, color=(0.98, 0.85, 0.15), mode="thin")
    overlay_u8 = (np.clip(rgb_bound, 0.0, 1.0) * 255).astype(np.uint8)
    if np.any(excl_mask):
        excl_bound = segmentation.find_boundaries(excl_mask, mode="thick")
        overlay_u8[excl_mask] = (0.65 * overlay_u8[excl_mask] + 0.35 * np.array([220, 38, 38])).astype(np.uint8)
        overlay_u8[excl_bound] = np.array([220, 38, 38], dtype=np.uint8)

    roi_rgb_u8 = np.stack([roi_gray, roi_gray, roi_gray], axis=-1)
    overlay_png = _encode_png(overlay_u8)
    roi_png = _encode_png(roi_rgb_u8)

    active_objs = [o for o in objects_list if not o["excluded"]]
    n_active = len(active_objs)
    n_excluded = len(objects_list) - n_active

    if n_active == 0:
        return (
            {
                "status": "계산 불가",
                "reason": "검출된 유효 입자가 0개입니다. 밝기 반전(어두운 입자 여부), 임계값, 또는 최소 객체 크기(px)를 조정해주세요.",
                "mode": "particle",
                "mode_label": "입자 분석 (Watershed 분할)",
                "projection_notice": "2D 투영 SEM 이미지에서의 관찰 결과입니다.",
                "segmentation_confirmed": params.segmentation_confirmed,
                "threshold_used": round(th_val, 1),
                "roi": roi_rect,
                "scale": scale_info,
                "n_total_detected": len(objects_list),
                "n_excluded": n_excluded,
                "n_valid_objects": 0,
                "summary_stats": None,
                "histogram": None,
                "objects": objects_list,
                "grain_intercept": None,
            },
            overlay_png,
            roi_png,
        )

    diams = np.asarray([o["equiv_diameter"] for o in active_objs], dtype=float)
    areas = np.asarray([o["area"] for o in active_objs], dtype=float)
    circs = np.asarray([o["circularity"] for o in active_objs], dtype=float)
    ars = np.asarray([o["aspect_ratio"] for o in active_objs], dtype=float)
    majors = np.asarray([o["major_axis"] for o in active_objs], dtype=float)
    minors = np.asarray([o["minor_axis"] for o in active_objs], dtype=float)

    d10, d50, d90 = np.percentile(diams, [10, 50, 90])

    # Area-weighted cumulative distribution D50_area (explicitly distinguished from number-based!)
    order = np.argsort(diams)
    sorted_d = diams[order]
    cum_area = np.cumsum(areas[order])
    tot_area = float(cum_area[-1]) if len(cum_area) else 1.0
    area_d50 = float(np.interp(0.5 * tot_area, cum_area, sorted_d))
    area_mean = float(np.sum(diams * areas) / max(tot_area, 1e-9))

    n_bins = min(20, max(6, int(round(math.sqrt(n_active) * 1.4))))
    hist_counts, hist_edges = np.histogram(diams, bins=n_bins)

    status = "분석 완료" if (scale_info["is_calibrated"] and params.segmentation_confirmed and n_active >= 10) else "확인 필요"
    reasons = []
    if not scale_info["is_calibrated"]:
        reasons.append("스케일 미확정(px 단위)")
    if not params.segmentation_confirmed:
        reasons.append("분리된 입자 경계 확인 전")
    if n_active < 10:
        reasons.append(f"표본 수 적음(N={n_active})")
    reason_str = (
        f"유효 입자 N={n_active}개 측정 완료"
        if not reasons
        else f"유효 입자 N={n_active}개 측정 ({', '.join(reasons)})"
    )

    summary_stats = {
        "unit": disp_unit,
        "area_unit": area_unit,
        "sample_count_n": n_active,
        "excluded_count": n_excluded,
        "distribution_basis": "개수 기준 분포 (Number-weighted)",
        "mean_diameter": round(float(np.mean(diams)), 2),
        "median_diameter": round(float(np.median(diams)), 2),
        "std_diameter": round(float(np.std(diams, ddof=1)), 2) if n_active >= 2 else 0.0,
        "cv_pct": round(float(100.0 * np.std(diams, ddof=1) / np.mean(diams)), 1) if (n_active >= 2 and np.mean(diams) > 0) else 0.0,
        "d10": round(float(d10), 2),
        "d50": round(float(d50), 2),
        "d90": round(float(d90), 2),
        "area_weighted": {
            "basis_label": "면적 가중 분포 (Area-weighted, 개수 기준 분포와 구분)",
            "mean_diameter": round(area_mean, 2),
            "d50": round(area_d50, 2),
            "unit": disp_unit,
        },
        "mean_area": round(float(np.mean(areas)), 2),
        "mean_major_axis": round(float(np.mean(majors)), 2),
        "mean_minor_axis": round(float(np.mean(minors)), 2),
        "mean_aspect_ratio": round(float(np.mean(ars)), 3),
        "median_aspect_ratio": round(float(np.median(ars)), 3),
        "mean_circularity": round(float(np.mean(circs)), 3),
        "median_circularity": round(float(np.median(circs)), 3),
    }

    return (
        {
            "status": status,
            "reason": reason_str,
            "mode": "particle",
            "mode_label": "입자 분석 (Watershed 분할)",
            "projection_notice": "모든 크기·형상 통계는 2D 투영 SEM 이미지에서 관찰된 겉보기 단면/투영 수치입니다.",
            "segmentation_confirmed": params.segmentation_confirmed,
            "threshold_used": round(th_val, 1),
            "roi": roi_rect,
            "scale": scale_info,
            "n_total_detected": len(objects_list),
            "n_excluded": n_excluded,
            "n_valid_objects": n_active,
            "summary_stats": summary_stats,
            "histogram": {
                "unit": disp_unit,
                "basis": "개수 기준 (Number count)",
                "sample_count_n": n_active,
                "bin_edges": [round(float(v), 2) for v in hist_edges],
                "counts": [int(c) for c in hist_counts],
            },
            "objects": objects_list,
            "grain_intercept": None,
        },
        overlay_png,
        roi_png,
    )


# ---------------- Mode B: Grain Boundary & Linear Intercept Extension ---------------- #
def _collect_line_hits(skel: np.ndarray, pts_rc: np.ndarray, line_id: str) -> list[dict[str, Any]]:
    hits_idx = np.where(skel[pts_rc[:, 0], pts_rc[:, 1]])[0]
    if len(hits_idx) == 0:
        return []
    # Merge contiguous/near pixels (< 4 steps along line) so a single boundary isn't counted multiple times
    merged: list[int] = [int(hits_idx[0])]
    for idx in hits_idx[1:]:
        if int(idx) - merged[-1] >= 4:
            merged.append(int(idx))
    out = []
    for k, m_idx in enumerate(merged):
        r, c = int(pts_rc[m_idx, 0]), int(pts_rc[m_idx, 1])
        out.append({"id": f"{line_id}-H{k + 1}", "x": float(c), "y": float(r), "source": "auto"})
    return out


def _run_grain_mode(
    roi_gray: np.ndarray,
    roi_rect: dict[str, int],
    scale_info: dict[str, Any],
    params: SEMParams,
) -> tuple[dict[str, Any], bytes, bytes]:
    roi_rgb_u8 = np.stack([roi_gray, roi_gray, roi_gray], axis=-1)
    roi_png = _encode_png(roi_rgb_u8)

    if not params.grain_boundary_confirmed:
        return (
            {
                "status": "계산 불가",
                "reason": (
                    "결정립 분석은 경계(grain boundary)가 실제로 관찰되는 치밀 소결체·식각 단면 이미지에서만 활성화됩니다. "
                    "분말 입자 분할 결과를 자동으로 결정립으로 간주하지 않으므로, 이미지에서 결정립계가 관찰되는지 확인 후 스위치를 켜주세요."
                ),
                "mode": "grain",
                "mode_label": "결정립 경계 및 선형교차법 기반 추정",
                "projection_notice": "2D 단면 이미지 관찰 결과이며, 표준 인증 결과가 아닌 선형교차법 기반 추정입니다.",
                "roi": roi_rect,
                "scale": scale_info,
                "n_valid_objects": 0,
                "summary_stats": None,
                "histogram": None,
                "objects": [],
                "grain_intercept": None,
            },
            roi_png,
            roi_png,
        )

    enh = _enhance_roi(roi_gray, params.clahe_clip, params.gaussian_blur)
    blk = max(11, int(params.grain_block_size) | 1)
    thresh_mode = cv2.THRESH_BINARY if params.invert_polarity else cv2.THRESH_BINARY_INV
    bmask = (
        cv2.adaptiveThreshold(enh, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, thresh_mode, blk, float(params.grain_offset))
        > 0
    )
    bmask = morphology.remove_small_objects(bmask, max_size=24)
    bmask = morphology.closing(bmask, morphology.disk(1))
    skel = morphology.skeletonize(bmask)

    rh, rw = roi_gray.shape
    boundary_px_ratio = float(np.mean(skel))
    contrast_std = float(np.std(enh))

    # Build multi-directional test lines: Horizontal, Vertical, and two Diagonals
    test_lines: list[dict[str, Any]] = []
    auto_hits: list[dict[str, Any]] = []
    total_len_px = 0.0

    n_each = max(2, int(params.n_test_lines) // 2)
    margin_r = int(0.08 * rh)
    margin_c = int(0.08 * rw)

    # Horizontal lines
    for i, r in enumerate(np.linspace(margin_r, rh - margin_r - 1, n_each).astype(int)):
        cols = np.arange(margin_c, rw - margin_c)
        pts = np.column_stack([np.full_like(cols, r), cols])
        lid = f"LH{i + 1}"
        length = float(len(cols) - 1)
        total_len_px += length
        test_lines.append({"id": lid, "orientation": "0° (수평)", "x0": int(cols[0]), "y0": int(r), "x1": int(cols[-1]), "y1": int(r), "length_px": round(length, 1)})
        auto_hits.extend(_collect_line_hits(skel, pts, lid))

    # Vertical lines
    for i, c in enumerate(np.linspace(margin_c, rw - margin_c - 1, n_each).astype(int)):
        rows = np.arange(margin_r, rh - margin_r)
        pts = np.column_stack([rows, np.full_like(rows, c)])
        lid = f"LV{i + 1}"
        length = float(len(rows) - 1)
        total_len_px += length
        test_lines.append({"id": lid, "orientation": "90° (수직)", "x0": int(c), "y0": int(rows[0]), "x1": int(c), "y1": int(rows[-1]), "length_px": round(length, 1)})
        auto_hits.extend(_collect_line_hits(skel, pts, lid))

    # Two diagonal lines (+45° and -45° across ROI)
    n_diag = max(20, min(rh - 2 * margin_r, rw - 2 * margin_c))
    rs_d1 = np.linspace(margin_r, rh - margin_r - 1, n_diag).astype(int)
    cs_d1 = np.linspace(margin_c, rw - margin_c - 1, n_diag).astype(int)
    len_d = math.hypot(float(rs_d1[-1] - rs_d1[0]), float(cs_d1[-1] - cs_d1[0]))
    total_len_px += 2.0 * len_d
    test_lines.append({"id": "LD1", "orientation": "+45° (대각)", "x0": int(cs_d1[0]), "y0": int(rs_d1[0]), "x1": int(cs_d1[-1]), "y1": int(rs_d1[-1]), "length_px": round(len_d, 1)})
    auto_hits.extend(_collect_line_hits(skel, np.column_stack([rs_d1, cs_d1]), "LD1"))

    rs_d2 = rs_d1[::-1]
    test_lines.append({"id": "LD2", "orientation": "-45° (대각)", "x0": int(cs_d1[0]), "y0": int(rs_d2[0]), "x1": int(cs_d1[-1]), "y1": int(rs_d2[-1]), "length_px": round(len_d, 1)})
    auto_hits.extend(_collect_line_hits(skel, np.column_stack([rs_d2, cs_d1]), "LD2"))

    removed_set = set(params.removed_intersection_ids)
    all_intersections: list[dict[str, Any]] = []
    for h_pt in auto_hits:
        all_intersections.append({**h_pt, "removed": h_pt["id"] in removed_set})
    for idx, u_pt in enumerate(params.added_intersections):
        ux = max(0.0, min(float(u_pt.x), float(rw - 1)))
        uy = max(0.0, min(float(u_pt.y), float(rh - 1)))
        all_intersections.append({"id": f"USER-H{idx + 1}", "x": round(ux, 1), "y": round(uy, 1), "source": "manual", "removed": False})

    active_hits = [pt for pt in all_intersections if not pt["removed"]]
    n_hits = len(active_hits)

    # Render overlay: grayscale + cyan skeleton + blue test lines + green active hits + red X removed hits
    ov = np.stack([roi_gray, roi_gray, roi_gray], axis=-1).copy()
    skel_dil = morphology.dilation(skel, morphology.disk(1))
    ov[skel_dil] = (0.45 * ov[skel_dil] + 0.55 * np.array([56, 189, 248])).astype(np.uint8)
    for tl in test_lines:
        cv2.line(ov, (tl["x0"], tl["y0"]), (tl["x1"], tl["y1"]), (49, 130, 246), 1, cv2.LINE_AA)
    for pt in all_intersections:
        px, py = int(round(pt["x"])), int(round(pt["y"]))
        if pt["removed"]:
            cv2.circle(ov, (px, py), 4, (220, 38, 38), 1, cv2.LINE_AA)
        elif pt["source"] == "manual":
            cv2.circle(ov, (px, py), 5, (22, 163, 74), -1, cv2.LINE_AA)
            cv2.circle(ov, (px, py), 6, (255, 255, 255), 1, cv2.LINE_AA)
        else:
            cv2.circle(ov, (px, py), 4, (250, 204, 21), -1, cv2.LINE_AA)
            cv2.circle(ov, (px, py), 5, (25, 31, 40), 1, cv2.LINE_AA)

    overlay_png = _encode_png(ov)

    u_per_px = float(scale_info["unit_per_px"])
    disp_unit = scale_info["display_unit"]
    total_len_unit = total_len_px * u_per_px

    quality_issues: list[str] = []
    if contrast_std < 12.0:
        quality_issues.append(f"영역 명암 대비가 매우 낮음 (표준편차 {contrast_std:.1f})")
    if boundary_px_ratio < 0.004:
        quality_issues.append("검출된 결정립계 골격 밀도가 매우 낮음")
    elif boundary_px_ratio > 0.16:
        quality_issues.append("노이즈 과검출로 경계 골격 밀도가 비정상적으로 높음 (블록 크기/오프셋 조절 권장)")
    if n_hits < 10:
        quality_issues.append(f"유효 경계 교차점 수가 부족함 ({n_hits}개 < 권장 10개)")

    # Hard gate: if contrast is essentially flat or zero hits or severe noise flood (>0.22), restrict result!
    severe_quality_fail = n_hits < 4 or contrast_std < 8.0 or boundary_px_ratio > 0.22
    mean_intercept = round(total_len_unit / n_hits, 2) if (n_hits > 0 and not severe_quality_fail) else None

    if severe_quality_fail:
        status = "계산 불가"
        reason = "경계 검출 품질 또는 교차점 수가 기준에 미달하여 정량 평균 선형교차 길이를 산출하지 않았습니다: " + "; ".join(
            quality_issues or ["유효 교차점 부족"]
        )
    elif quality_issues or not scale_info["is_calibrated"]:
        status = "확인 필요"
        reason = "; ".join(quality_issues + ([] if scale_info["is_calibrated"] else ["스케일 미확정(px 단위)"]))
    else:
        status = "분석 완료"
        reason = f"선형교차법 기반 추정 완료 (다방향 시험선 {len(test_lines)}개, 유효 교차 {n_hits}회)"

    grain_info = {
        "method_label": "선형교차법 기반 추정 (비인증 연구 보조 지표 — 공식 표준 시험 성적서를 대체하지 않음)",
        "counting_rule": "수평·수직·±45° 다방향 시험선이 스켈레톤 경계와 교차할 때 1회당 1점 계수 (인접 4 px 이내 중복 억제, 사용자 수동 교차점 편집 반영)",
        "unit": disp_unit,
        "n_test_lines": len(test_lines),
        "total_line_length_px": round(total_len_px, 1),
        "total_line_length": round(total_len_unit, 2),
        "auto_intersections_count": len(auto_hits),
        "manual_added_count": len(params.added_intersections),
        "manual_removed_count": sum(1 for p in all_intersections if p["removed"]),
        "effective_intersections": n_hits,
        "mean_intercept_length": mean_intercept,
        "boundary_skeleton_density": round(boundary_px_ratio, 4),
        "quality_issues": quality_issues,
        "test_lines": test_lines,
        "intersections": all_intersections,
    }

    return (
        {
            "status": status,
            "reason": reason,
            "mode": "grain",
            "mode_label": "결정립 분석 (선형교차법 기반 추정)",
            "projection_notice": "2D 단면 이미지에서 측정된 평균 선형교차 길이이며, 3차원 실제 결정립 직경과 형상 계수 차이가 있습니다.",
            "roi": roi_rect,
            "scale": scale_info,
            "n_valid_objects": n_hits,
            "summary_stats": None,
            "histogram": None,
            "objects": [],
            "grain_intercept": grain_info,
        },
        overlay_png,
        roi_png,
    )


def compute_grain_phase_map(
    roi_gray: np.ndarray,
    roi_rect: dict[str, int],
    scale_info: dict[str, Any],
    xrd_result: dict[str, Any] | None = None,
    expected_formula: str | None = None,
) -> dict[str, Any]:
    """Segment SEM ROI into 3 brightness/contrast zones (Matrix / Bright High-Z / Dark Low-Z),
    extract representative individual grains (G1..G12), and map each grain to its candidate phase
    using XRD Phase Matching + Materials Project Z_BSE & Tie-Line equilibrium coexistence data.
    """
    rh, rw = roi_gray.shape
    total_px = max(1, rh * rw)
    roi_mean_i = float(np.mean(roi_gray))

    # 1) Multi-Otsu 3-class segmentation (Dark / Matrix / Bright)
    blur = cv2.GaussianBlur(roi_gray, (5, 5), 0)
    try:
        t1, t2 = [float(t) for t in filters.threshold_multiotsu(blur, classes=3)]
        if t2 - t1 < 8.0:
            raise ValueError("low dynamic range")
    except Exception:
        t1 = float(np.percentile(blur, 22))
        t2 = float(np.percentile(blur, 78))
        if t2 <= t1 + 2.0:
            t1 = max(1.0, roi_mean_i - 15.0)
            t2 = min(254.0, roi_mean_i + 15.0)

    mask_dark = blur < t1
    mask_matrix = (blur >= t1) & (blur <= t2)
    mask_bright = blur > t2

    # Ensure the zone with the largest area among the middle/bright is treated as primary matrix if needed
    pct_dark = round(float(np.sum(mask_dark)) * 100.0 / total_px, 1)
    pct_matrix = round(float(np.sum(mask_matrix)) * 100.0 / total_px, 1)
    pct_bright = round(float(100.0 - pct_dark - pct_matrix), 1)

    # 2) Resolve phase candidates from XRD + Materials Project BSE table
    cands = (xrd_result or {}).get("phase_matching", {}).get("candidates", []) if xrd_result else []
    pdbse = (xrd_result or {}).get("phase_diagram_bse", {}) if xrd_result else {}
    bse_rows = pdbse.get("bse_table", []) if pdbse else []
    coex_list = set(pdbse.get("coexisting_equilibrium_neighbors", []) if pdbse else [])

    top_cand = cands[0] if cands else None
    second_cand = cands[1] if len(cands) > 1 else None

    primary_formula = (
        (top_cand.get("formula") if top_cand else None)
        or pdbse.get("primary_formula")
        or (expected_formula.strip() if expected_formula else None)
        or "주상 기지(Matrix)"
    )
    primary_name = (
        f"{top_cand['formula']} ({top_cand['spacegroup']} 기지 주상)"
        if top_cand
        else f"{primary_formula} (기지 결정립 주상)"
    )
    primary_mp_id = (top_cand.get("mp_id") if top_cand else None) or None
    primary_z = (top_cand.get("z_bse_eff") if top_cand else None) or pdbse.get("primary_z_bse")

    # Find Bright (High-Z) and Dark (Low-Z) phase candidates
    bright_row = None
    dark_row = None
    if bse_rows and primary_z is not None:
        higher_z = [r for r in bse_rows if r.get("formula") != primary_formula and (r.get("z_bse_eff") or 0) > primary_z + 0.3]
        lower_z = [r for r in bse_rows if r.get("formula") != primary_formula and (r.get("z_bse_eff") or 999) < primary_z - 0.3]
        higher_z.sort(key=lambda r: (0 if r.get("formula") in coex_list else 1, -(r.get("z_bse_eff") or 0)))
        lower_z.sort(key=lambda r: (0 if r.get("formula") in coex_list else 1, (r.get("z_bse_eff") or 999)))
        if higher_z:
            bright_row = higher_z[0]
        if lower_z:
            dark_row = lower_z[0]

    if bright_row:
        bright_formula = bright_row["formula"]
        bright_mp_id = bright_row.get("mp_id")
        bright_z = bright_row.get("z_bse_eff")
        coex_tag = " · Tie-Line 평형 공존" if bright_formula in coex_list else ""
        bright_name = f"{bright_formula} (고-Z 밝은 상, Z_BSE={bright_z}{coex_tag})"
    elif second_cand:
        bright_formula = second_cand["formula"]
        bright_mp_id = second_cand.get("mp_id")
        bright_z = second_cand.get("z_bse_eff")
        bright_name = f"{second_cand['name']} (2순위 부상 후보)"
    else:
        bright_formula = f"{primary_formula} (고명암 방위/석출 결정립)"
        bright_mp_id = primary_mp_id
        bright_z = primary_z
        bright_name = f"{primary_formula} 고명암 결정립 (돌출 입자 또는 고-Z 미량 석출상)"

    if dark_row:
        dark_formula = dark_row["formula"]
        dark_mp_id = dark_row.get("mp_id")
        dark_z = dark_row.get("z_bse_eff")
        coex_tag = " · Tie-Line 평형 공존" if dark_formula in coex_list else ""
        dark_name = f"{dark_formula} (저-Z 어두운 상, Z_BSE={dark_z}{coex_tag})"
    else:
        dark_formula = "저-Z 이차상 / 결정립계·기공"
        dark_mp_id = None
        dark_z = None
        dark_name = "저-Z 이차상 또는 결정립계(Grain Boundary)·미세기공 영역"

    zone_defs = {
        "matrix": {
            "zone": "matrix",
            "zone_label": "중간 회색 기지 결정립 (Matrix Phase)",
            "area_pct": pct_matrix,
            "mean_intensity": round(float(np.mean(roi_gray[mask_matrix])) if np.any(mask_matrix) else roi_mean_i, 1),
            "threshold_range": f"{round(t1, 0):.0f}–{round(t2, 0):.0f}",
            "predicted_formula": primary_formula,
            "predicted_phase_name": primary_name,
            "mp_id": primary_mp_id,
            "z_bse_eff": primary_z,
            "color_hex": "#3182F6",
            "reasoning": (
                f"전체 면적의 {pct_matrix}%를 차지하는 주된 기지(Matrix) 조직으로, XRD 1순위 매칭 상인 "
                f"{primary_formula}{f' ({primary_mp_id}, Z_BSE={primary_z})' if primary_z else ''} 결정립에 해당합니다."
            ),
        },
        "bright": {
            "zone": "bright",
            "zone_label": "밝은 고명암 결정립 (High-Z / Bright Phase)",
            "area_pct": pct_bright,
            "mean_intensity": round(float(np.mean(roi_gray[mask_bright])) if np.any(mask_bright) else min(255.0, t2 + 15.0), 1),
            "threshold_range": f"> {round(t2, 0):.0f}",
            "predicted_formula": bright_formula,
            "predicted_phase_name": bright_name,
            "mp_id": bright_mp_id,
            "z_bse_eff": bright_z,
            "color_hex": "#F59E0B",
            "reasoning": (
                f"평균 밝기 {round(float(np.mean(roi_gray[mask_bright])) if np.any(mask_bright) else t2, 1)} (상위 {pct_bright}% 영역)의 고명암 결정립으로, "
                + (
                    f"기지({primary_formula}, Z_BSE={primary_z})보다 유효 원자번호가 큰 무거운 원소 풍부상 {bright_formula} (Z_BSE={bright_z})으로 판별됩니다."
                    if bright_row and primary_z
                    else f"2순위 부상 후보 또는 표면 위상/결정 방위 대비가 높은 {bright_formula} 결정립 영역입니다."
                )
            ),
        },
        "dark": {
            "zone": "dark",
            "zone_label": "어두운 저명암 결정립·입계 (Low-Z / Dark Phase)",
            "area_pct": pct_dark,
            "mean_intensity": round(float(np.mean(roi_gray[mask_dark])) if np.any(mask_dark) else max(0.0, t1 - 15.0), 1),
            "threshold_range": f"< {round(t1, 0):.0f}",
            "predicted_formula": dark_formula,
            "predicted_phase_name": dark_name,
            "mp_id": dark_mp_id,
            "z_bse_eff": dark_z,
            "color_hex": "#10B981",
            "reasoning": (
                f"평균 밝기 {round(float(np.mean(roi_gray[mask_dark])) if np.any(mask_dark) else t1, 1)} (하위 {pct_dark}% 영역)의 어두운 조직으로, "
                + (
                    f"기지({primary_formula}, Z_BSE={primary_z})보다 가벼운 원소 비중이 높은 저-Z 공존상 {dark_formula} (Z_BSE={dark_z}) 및 일부 입계/기공 영역에 해당합니다."
                    if dark_row and primary_z
                    else "결정립계(Grain Boundary) 식각 골, 미세 기공(Pore), 또는 경원소 풍부 이차상 영역에 해당합니다."
                )
            ),
        },
    }

    # 3) Segment individual representative grains across the 3 zones (up to 12 grains: G1..G12)
    u_per_px = float(scale_info["unit_per_px"])
    disp_unit = scale_info["display_unit"]
    area_unit = scale_info["area_unit"]
    min_grain_px = max(20, int(total_px * 0.00025))
    min_sep_px = max(24.0, min(rw, rh) * 0.065)

    raw_candidates: list[dict[str, Any]] = []
    zone_quotas = [("matrix", mask_matrix, 5), ("bright", mask_bright, 4), ("dark", mask_dark, 3)]

    for z_key, z_mask, quota in zone_quotas:
        cleaned = morphology.remove_small_objects(z_mask, max_size=max(4, min_grain_px // 2))
        cleaned = morphology.opening(cleaned, morphology.disk(1))
        dist = ndi.distance_transform_edt(cleaned)
        peak_sep = max(10, int(min(rw, rh) * 0.045))
        lbl_conn = measure.label(cleaned)
        coords = peak_local_max(dist, min_distance=peak_sep, labels=lbl_conn, num_peaks=40, exclude_border=False)
        if len(coords) > 0:
            markers = np.zeros_like(dist, dtype=np.int32)
            markers[tuple(coords.T)] = np.arange(1, len(coords) + 1, dtype=np.int32)
            ws_labels = segmentation.watershed(-dist, markers, mask=cleaned)
        else:
            ws_labels = lbl_conn

        props = measure.regionprops(ws_labels, intensity_image=roi_gray)
        # Sort by area descending, but avoid full-frame background flood by preferring compact grains
        valid_regs = [
            reg for reg in props
            if reg.area >= min_grain_px and reg.area <= total_px * 0.38
        ]
        if not valid_regs and props:
            valid_regs = sorted(props, key=lambda r: r.area, reverse=True)[:quota]
        else:
            valid_regs.sort(key=lambda r: r.area, reverse=True)

        picked_for_zone = 0
        for reg in valid_regs:
            cy, cx = reg.centroid
            if any(math.hypot(cx - prev["roi_x"], cy - prev["roi_y"]) < min_sep_px for prev in raw_candidates):
                continue
            min_r, min_c, max_r, max_c = reg.bbox
            area_px = float(reg.area)
            eq_d_px = float(reg.equivalent_diameter_area)
            mean_i = float(reg.mean_intensity)
            z_info = zone_defs[z_key]
            delta_pct = round((mean_i - roi_mean_i) / max(roi_mean_i, 1.0) * 100.0, 1)

            # Refine dark zone label if intensity is extremely dark (< 35 -> pore/void likelihood)
            pred_formula = z_info["predicted_formula"]
            pred_name = z_info["predicted_phase_name"]
            if z_key == "dark" and mean_i < 38.0 and dark_row is not None:
                pred_name = f"{dark_formula} 또는 미세기공(Pore)"

            raw_candidates.append(
                {
                    "zone": z_key,
                    "zone_label": z_info["zone_label"],
                    "roi_x": round(float(cx), 1),
                    "roi_y": round(float(cy), 1),
                    "image_x": round(float(roi_rect["x"] + cx), 1),
                    "image_y": round(float(roi_rect["y"] + cy), 1),
                    "bbox": [int(min_c), int(min_r), int(max_c), int(max_r)],
                    "area_px2": round(area_px, 1),
                    "area": round(area_px * (u_per_px**2), 2),
                    "equiv_diameter_px": round(eq_d_px, 1),
                    "equiv_diameter": round(eq_d_px * u_per_px, 2),
                    "unit": disp_unit,
                    "area_unit": area_unit,
                    "mean_intensity": round(mean_i, 1),
                    "contrast_delta_pct": delta_pct,
                    "predicted_formula": pred_formula,
                    "predicted_phase_name": pred_name,
                    "mp_id": z_info["mp_id"],
                    "z_bse_eff": z_info["z_bse_eff"],
                    "color_hex": z_info["color_hex"],
                }
            )
            picked_for_zone += 1
            if picked_for_zone >= quota:
                break

    # Number grains G1..GN in spatial reading order (top-to-bottom, left-to-right) or by zone importance
    grains_out: list[dict[str, Any]] = []
    for idx, g in enumerate(raw_candidates[:12], start=1):
        gid = f"G{idx}"
        sign_str = f"+{g['contrast_delta_pct']}%" if g["contrast_delta_pct"] >= 0 else f"{g['contrast_delta_pct']}%"
        z_eff_str = f" (Z_BSE={g['z_bse_eff']})" if g.get("z_bse_eff") else ""
        if g["zone"] == "matrix":
            default_expl = (
                f"평균 명암 {g['mean_intensity']} (ROI 평균 대비 {sign_str}), 등가직경 {g['equiv_diameter']} {g['unit']}의 대표 기지 결정립으로, "
                f"XRD 1순위 주상인 {g['predicted_formula']}{z_eff_str} 매트릭스 상으로 판별됩니다."
            )
        elif g["zone"] == "bright":
            default_expl = (
                f"평균 명암 {g['mean_intensity']} (ROI 평균 대비 {sign_str})로 주변 기지보다 밝게 관찰되는 결정립이며, "
                f"고원자번호 원소(예: Sb/Nb) 비율이 높은 {g['predicted_formula']}{z_eff_str} 상으로 추정됩니다."
            )
        else:
            default_expl = (
                f"평균 명암 {g['mean_intensity']} (ROI 평균 대비 {sign_str})로 어둡게 관찰되는 영역이며, "
                f"경원소(예: Fe/Nb) 비중이 높은 저-Z 공존상 {g['predicted_formula']}{z_eff_str} 또는 입계/기공 영역으로 추정됩니다."
            )
        grains_out.append(
            {
                "grain_id": gid,
                **g,
                "ai_explanation": default_expl,
                "phase_role": (
                    "주상 기지 결정립 (Primary Matrix)"
                    if g["zone"] == "matrix"
                    else "고-Z 밝은 이차상 결정립 (Bright Secondary)"
                    if g["zone"] == "bright"
                    else "저-Z 어두운 이차상/입계 영역 (Dark Secondary)"
                ),
            }
        )

    return {
        "enabled": True,
        "thresholds": [round(t1, 1), round(t2, 1)],
        "roi_mean_intensity": round(roi_mean_i, 1),
        "primary_formula": primary_formula,
        "zones": [zone_defs["matrix"], zone_defs["bright"], zone_defs["dark"]],
        "grains": grains_out,
        "ai_status": "rule_initialized",
        "ai_model": None,
        "ai_overall_summary": (
            f"SEM 영역의 명암 대비(Multi-Otsu 임계값 {round(t1):.0f} / {round(t2):.0f})와 XRD·Materials Project 상평형(Z_BSE) 데이터를 결합한 결과, "
            f"전체 조직은 주상 기지 결정립인 {primary_formula} ({pct_matrix}%)를 중심으로 "
            f"밝은 고-Z 상 후보 {bright_formula} ({pct_bright}%) 및 어두운 저-Z 상 후보 {dark_formula} ({pct_dark}%)로 구성되어 있습니다."
        ),
        "eds_verification_tip": (
            f"대표 결정립(G1~G{len(grains_out)}) 위치에서 SEM-EDS 점분석(Point Analysis)을 수행하여 "
            f"중간 회색 기지({primary_formula}) 대비 밝은 결정립({bright_formula})과 어두운 결정립({dark_formula})의 화학 조성비(at.%) 차이를 교차 검증하는 것을 권장합니다."
        ),
    }


def run_sem_pipeline(
    raw: bytes,
    params: SEMParams,
    xrd_result: dict[str, Any] | None = None,
    expected_formula: str | None = None,
) -> tuple[dict[str, Any], bytes, bytes]:
    gray, _, fmt = load_sem_grayscale_and_rgb(raw)
    databar_y = detect_info_bar_row(gray)
    roi_rect = _resolve_roi(gray, params.roi, databar_y)
    scale_info = _resolve_scale(params)

    roi_gray = gray[roi_rect["y"] : roi_rect["y"] + roi_rect["h"], roi_rect["x"] : roi_rect["x"] + roi_rect["w"]]
    if params.mode == "grain":
        res, ov_png, roi_png = _run_grain_mode(roi_gray, roi_rect, scale_info, params)
    else:
        res, ov_png, roi_png = _run_particle_mode(roi_gray, roi_rect, scale_info, params)

    res["grain_phase_map"] = compute_grain_phase_map(
        roi_gray=roi_gray,
        roi_rect=roi_rect,
        scale_info=scale_info,
        xrd_result=xrd_result,
        expected_formula=expected_formula,
    )

    res["image_meta"] = {
        "format": fmt,
        "original_width_px": int(gray.shape[1]),
        "original_height_px": int(gray.shape[0]),
        "detected_databar_y": databar_y,
    }
    res["conditions"] = params.model_dump()
    return res, ov_png, roi_png
