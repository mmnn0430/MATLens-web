"""Korean PDF Report Generator with Embedded XRD/SEM Charts (ReportLab + Matplotlib)."""
from __future__ import annotations

import io
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Image as RLImage, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


_BUNDLED_FONT_DIR = Path(__file__).resolve().parent.parent.parent / "assets" / "fonts"

_FONT_Candidates = [
    ("NanumGothic", str(_BUNDLED_FONT_DIR / "NanumGothic.ttf"), str(_BUNDLED_FONT_DIR / "NanumGothicBold.ttf")),
    ("NanumGothic", "/usr/share/fonts/truetype/nanum/NanumGothic.ttf", "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf"),
    ("MalgunGothic", "C:/Windows/Fonts/malgun.ttf", "C:/Windows/Fonts/malgunbd.ttf"),
    ("NotoSansKR", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"),
]


def _register_korean_font() -> tuple[str, str, str | None]:
    """Register Korean TTF font for both ReportLab and Matplotlib."""
    for fam, reg_p, bold_p in _FONT_Candidates:
        if Path(reg_p).exists():
            try:
                # Add to matplotlib font manager
                font_manager.fontManager.addfont(str(reg_p))
                if Path(bold_p).exists():
                    font_manager.fontManager.addfont(str(bold_p))
                matplotlib.rcParams["font.family"] = fam
                matplotlib.rcParams["axes.unicode_minus"] = False

                # Register with ReportLab
                if fam not in pdfmetrics.getRegisteredFontNames():
                    pdfmetrics.registerFont(TTFont(fam, str(reg_p)))
                bold_name = fam
                if Path(bold_p).exists():
                    bold_name = f"{fam}-Bold"
                    if bold_name not in pdfmetrics.getRegisteredFontNames():
                        pdfmetrics.registerFont(TTFont(bold_name, str(bold_p)))
                return fam, bold_name, str(reg_p)
            except Exception:
                continue
    return "Helvetica", "Helvetica-Bold", None


def _render_xrd_chart_png(xrd_res: dict[str, Any], font_path: str | None) -> bytes | None:
    series = xrd_res.get("series")
    if not series or not series.get("two_theta"):
        return None
    fprop = font_manager.FontProperties(fname=font_path) if font_path else None

    fig, (ax1, ax2) = plt.subplots(
        2, 1, figsize=(7.2, 4.0), dpi=180, sharex=True, gridspec_kw={"height_ratios": [3.2, 1.1], "hspace": 0.08}
    )
    tt = series["two_theta"]
    y_raw = series["raw_intensity"]
    y_bg = series["background"]
    y_corr = series["corrected_unsmoothed"]

    ax1.plot(tt, y_raw, color="#6B7684", lw=0.9, alpha=0.8, label="원본 신호 (Raw)")
    ax1.plot(tt, y_bg, color="#D97706", lw=1.0, ls="--", label="ALS 배경선")
    ax1.plot(tt, y_corr, color="#3182F6", lw=1.15, label="배경 제거 정량 신호")

    peaks = [p for p in xrd_res.get("peaks", []) if not p.get("user_excluded")]
    if peaks:
        px = [p["two_theta"] for p in peaks]
        py = [p["height"] for p in peaks]
        ax1.scatter(px, py, color="#DC2626", s=16, zorder=5, label="검출 피크")

    ax1.set_ylabel("Intensity (a.u.)", fontsize=8.5, fontproperties=fprop)
    ax1.set_title("XRD 패턴 및 기준 후보 비교", fontsize=10, fontweight="bold", fontproperties=fprop, pad=6)
    ax1.grid(True, alpha=0.22)
    leg = ax1.legend(loc="upper right", fontsize=7.5, frameon=True)
    if fprop:
        for txt in leg.get_texts():
            txt.set_fontproperties(fprop)

    cands = xrd_res.get("phase_matching", {}).get("candidates", [])
    if cands:
        top = cands[0]
        rx = [v + top["shift_deg"] for v in top["ref_stick_two_theta"]]
        rI = top["ref_stick_intensity"]
        ax2.vlines(rx, 0, rI, color="#16A34A", lw=1.2, label=f"1순위 후보: {top['name']}")
        leg2 = ax2.legend(loc="upper right", fontsize=7.2, frameon=True)
        if fprop:
            for txt in leg2.get_texts():
                txt.set_fontproperties(fprop)
    ax2.set_ylim(0, 110)
    ax2.set_ylabel("Ref (%)", fontsize=8)
    ax2.set_xlabel("2θ (deg)", fontsize=8.5)
    ax2.grid(True, alpha=0.22)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", dpi=180)
    plt.close(fig)
    return buf.getvalue()


def _render_sem_chart_png(
    sem_res: dict[str, Any],
    roi_png: bytes | None,
    overlay_png: bytes | None,
    font_path: str | None,
) -> bytes | None:
    if not overlay_png and not sem_res.get("histogram"):
        return None
    fprop = font_manager.FontProperties(fname=font_path) if font_path else None
    hist = sem_res.get("histogram")
    ncols = 3 if (roi_png and overlay_png and hist) else (2 if (overlay_png and (roi_png or hist)) else 1)
    fig, axes = plt.subplots(1, ncols, figsize=(7.2, 2.55), dpi=180)
    if ncols == 1:
        axes = [axes]

    idx = 0
    if roi_png and idx < ncols:
        im_roi = plt.imread(io.BytesIO(roi_png))
        axes[idx].imshow(im_roi, cmap="gray")
        axes[idx].set_title("SEM 분석 영역 (ROI)", fontsize=8.5, fontproperties=fprop)
        axes[idx].axis("off")
        idx += 1
    if overlay_png and idx < ncols:
        im_ov = plt.imread(io.BytesIO(overlay_png))
        axes[idx].imshow(im_ov)
        axes[idx].set_title("분할 경계 오버레이", fontsize=8.5, fontproperties=fprop)
        axes[idx].axis("off")
        idx += 1
    if hist and idx < ncols:
        edges = hist["bin_edges"]
        counts = hist["counts"]
        centers = [0.5 * (edges[i] + edges[i + 1]) for i in range(len(counts))]
        widths = [(edges[i + 1] - edges[i]) * 0.88 for i in range(len(counts))]
        axes[idx].bar(centers, counts, width=widths, color="#3182F6", alpha=0.85)
        axes[idx].set_title(f"크기 분포 (N={hist['sample_count_n']})", fontsize=8.5, fontproperties=fprop)
        axes[idx].set_xlabel(f"등가원 직경 ({hist['unit']})", fontsize=7.5, fontproperties=fprop)
        axes[idx].set_ylabel("개수", fontsize=7.5, fontproperties=fprop)
        axes[idx].grid(True, alpha=0.22)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", dpi=180)
    plt.close(fig)
    return buf.getvalue()


def generate_pdf_report(
    project: dict[str, Any],
    run_record: dict[str, Any],
    ai_record: dict[str, Any] | None,
    is_ai_outdated: bool,
    roi_png: bytes | None,
    overlay_png: bytes | None,
) -> bytes:
    """Create a full Korean PDF analysis report."""
    font_reg, font_bold, font_path = _register_korean_font()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=16 * mm,
        rightMargin=16 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title=f"MatLens 리포트 - {project.get('sample_name', '')}",
    )

    styles = getSampleStyleSheet()
    st_title = ParagraphStyle("MLTitle", parent=styles["Title"], fontName=font_bold, fontSize=17, leading=23, textColor=colors.HexColor("#191F28"), alignment=0)
    st_sub = ParagraphStyle("MLSub", parent=styles["Normal"], fontName=font_reg, fontSize=9.5, leading=14, textColor=colors.HexColor("#6B7684"))
    st_h2 = ParagraphStyle("MLH2", parent=styles["Heading2"], fontName=font_bold, fontSize=12.5, leading=18, spaceBefore=10, spaceAfter=5, textColor=colors.HexColor("#191F28"))
    st_body = ParagraphStyle("MLBody", parent=styles["Normal"], fontName=font_reg, fontSize=9.2, leading=14.2, textColor=colors.HexColor("#191F28"))
    st_warn = ParagraphStyle("MLWarn", parent=st_body, textColor=colors.HexColor("#B45309"), backColor=colors.HexColor("#FEF3C7"), borderPadding=5)
    st_small = ParagraphStyle("MLSmall", parent=st_body, fontSize=7.8, leading=11.5, textColor=colors.HexColor("#6B7684"))

    story: list[Any] = []
    sample_tag = " [샘플 데이터]" if project.get("is_sample_demo") else ""
    story.append(Paragraph(escape(f"MatLens 재료 분석 리포트 — {project.get('sample_name', '')}{sample_tag}"), st_title))
    story.append(
        Paragraph(
            escape(
                f"실행 번호: Run #{run_record['run_number']} ({run_record['id']}) | 생성 시각: {run_record['created_at']} | "
                "구분 표기: [사용자 입력] · [측정값] · [계산값] · [규칙 요약] · [AI 해석 가설]"
            ),
            st_sub,
        )
    )
    story.append(Spacer(1, 4 * mm))

    # 1. Sample & User Input Table
    story.append(Paragraph("1. 시료 정보 및 분석 조건 [사용자 입력]", st_h2))
    meta_rows = [
        ["항목", "내용"],
        ["시료명", str(project.get("sample_name", "-"))],
        ["시료 설명", str(project.get("description") or "-")],
        ["예상 조성 / 원소", f"{project.get('expected_formula') or '-'} / {', '.join(project.get('expected_elements', [])) or '미지정'}"],
        ["XRD·SEM 동일 시료 확인", "예 (통합 교차 해석 허용)" if project.get("is_same_sample") else "아니오 (개별 분석만 허용)"],
    ]
    t_meta = Table(meta_rows, colWidths=[45 * mm, 133 * mm])
    t_meta.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, 0), font_bold),
                ("FONTNAME", (0, 1), (-1, -1), font_reg),
                ("FONTSIZE", (0, 0), (-1, -1), 8.8),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F2F4F6")),
                ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#191F28")),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E5E8EB")),
                ("PADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    story.append(t_meta)
    story.append(Spacer(1, 3 * mm))

    xrd_res = run_record.get("xrd_result")
    sem_res = run_record.get("sem_result")
    rule_sum = run_record.get("rule_summary") or {}

    # 2. XRD Section
    if xrd_res:
        story.append(Paragraph(f"2. XRD 결정구조 분석 결과 [계산값] — 상태: {escape(xrd_res['status'])}", st_h2))
        xrd_png = _render_xrd_chart_png(xrd_res, font_path)
        if xrd_png:
            story.append(RLImage(io.BytesIO(xrd_png), width=176 * mm, height=96 * mm))
            story.append(Spacer(1, 2 * mm))

        pm = xrd_res.get("phase_matching", {})
        cands = pm.get("candidates", [])
        if cands:
            c_rows = [["순위", "상 이름 (화학식)", "공간군", "매칭 점수 (비확률)", "영점 이동(°)", "일치/미설명 피크"]]
            for i, c in enumerate(cands[:5]):
                c_rows.append(
                    [
                        str(i + 1),
                        f"{c['name']} ({c['formula']})",
                        str(c["spacegroup"]),
                        f"{c['score']} / 100",
                        f"{c['shift_deg']:+.3f}",
                        f"{len(c['matched_peaks'])} / {len(c['unexplained_peak_ids'])}",
                    ]
                )
            tc = Table(c_rows, colWidths=[12 * mm, 56 * mm, 24 * mm, 30 * mm, 24 * mm, 32 * mm])
            tc.setStyle(
                TableStyle(
                    [
                        ("FONTNAME", (0, 0), (-1, 0), font_bold),
                        ("FONTNAME", (0, 1), (-1, -1), font_reg),
                        ("FONTSIZE", (0, 0), (-1, -1), 8.2),
                        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F2F4F6")),
                        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E5E8EB")),
                        ("PADDING", (0, 0), (-1, -1), 4),
                    ]
                )
            )
            story.append(tc)
            story.append(Paragraph(escape(pm.get("library_scope_notice", "")), st_small))

        sch = xrd_res.get("scherrer", {})
        sch_text = (
            f"• 조건부 Scherrer 결정자 크기 추정: 평균 {sch['mean_nm']} nm (범위 {sch['range_nm'][0]}–{sch['range_nm'][1]} nm, "
            f"사용 피크 {sch['n_used_peaks']}개, K={sch['k_factor']}, {sch['instrument_correction_label']})"
            if sch.get("mean_nm") is not None
            else f"• 조건부 Scherrer 결정자 크기 추정: 계산 불가 ({sch.get('reason', '')})"
        )
        story.append(Paragraph(escape(sch_text), st_body))

    # 3. SEM Section
    if sem_res:
        story.append(Paragraph(f"3. SEM 미세구조 정량 결과 [계산값] — 상태: {escape(sem_res['status'])}", st_h2))
        sem_png = _render_sem_chart_png(sem_res, roi_png, overlay_png, font_path)
        if sem_png:
            story.append(RLImage(io.BytesIO(sem_png), width=176 * mm, height=62 * mm))
            story.append(Spacer(1, 2 * mm))

        st = sem_res.get("summary_stats")
        if st:
            u = st["unit"]
            s_rows = [
                ["지표 (2D 이미지 관찰)", "수치", "비고"],
                ["측정 객체 수 (N)", f"{st['sample_count_n']} 개 (제외 {st['excluded_count']}개)", "가장자리/수동 제외 반영"],
                ["평균 ± 표준편차 (개수 기준)", f"{st['mean_diameter']} ± {st['std_diameter']} {u}", f"중앙값 {st['median_diameter']} {u}"],
                ["분포 분위수 D10 / D50 / D90", f"{st['d10']} / {st['d50']} / {st['d90']} {u}", "개수 기준 분포"],
                ["면적 가중 D50", f"{st['area_weighted']['d50']} {u}", "개수 기준과 별도 표기"],
                ["원형도(4πA/P²) / 종횡비 중앙값", f"{st['median_circularity']} / {st['median_aspect_ratio']}", "2D 투영 형상"],
            ]
            ts = Table(s_rows, colWidths=[58 * mm, 62 * mm, 58 * mm])
            ts.setStyle(
                TableStyle(
                    [
                        ("FONTNAME", (0, 0), (-1, 0), font_bold),
                        ("FONTNAME", (0, 1), (-1, -1), font_reg),
                        ("FONTSIZE", (0, 0), (-1, -1), 8.3),
                        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F2F4F6")),
                        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E5E8EB")),
                        ("PADDING", (0, 0), (-1, -1), 4),
                    ]
                )
            )
            story.append(ts)
        elif sem_res.get("grain_intercept"):
            gi = sem_res["grain_intercept"]
            story.append(
                Paragraph(
                    escape(
                        f"• {gi['method_label']}: 시험선 {gi['n_test_lines']}개(총 {gi['total_line_length']} {gi['unit']}), "
                        f"교차 {gi['effective_intersections']}회 → 평균 선형교차 길이 = {gi['mean_intercept_length'] or '계산 불가'} {gi['unit']}"
                    ),
                    st_body,
                )
            )
        else:
            story.append(Paragraph(escape(f"• {sem_res.get('reason', '')}"), st_body))

    # 4. Rule-based Summary
    story.append(Paragraph("4. 규칙 기반 통합 요약 [규칙 요약]", st_h2))
    story.append(Paragraph(escape(rule_sum.get("overview", "")), st_body))
    for cn in rule_sum.get("cross_notes", []):
        story.append(Paragraph(escape(f"• [교차 비교] {cn['text']}"), st_body))
    for chk in rule_sum.get("checks_needed", []):
        story.append(Paragraph(escape(f"• [확인 필요] {chk}"), st_warn))

    # 5. AI Interpretation (if available)
    story.append(Paragraph("5. Gemini AI 보조 해석 및 가설 [AI 해석]", st_h2))
    if is_ai_outdated:
        story.append(
            Paragraph(
                "주의: 아래 AI 해석은 이전 분석 조건(이전 Run) 기준으로 작성된 오래된 결과입니다. 최신 수치에 맞춰 재실행이 권장됩니다.",
                st_warn,
            )
        )
    if ai_record and ai_record.get("status") == "completed" and ai_record.get("report"):
        rep = ai_record["report"]
        story.append(
            Paragraph(
                escape(
                    f"사용 모델: {ai_record.get('model_name')} | 프롬프트 버전: {ai_record.get('prompt_version')} | 생성 시각: {ai_record.get('created_at')}"
                ),
                st_small,
            )
        )
        story.append(Paragraph(escape(f"요약: {rep.get('executive_summary', '')}"), st_body))
        for h in rep.get("integrated_hypotheses", []):
            story.append(
                Paragraph(
                    escape(f"• [가설] {h['hypothesis']} (근거: {', '.join(h.get('basis_ids', []))} | 전제/주의: {h['caveats']})"),
                    st_body,
                )
            )
        for ex in rep.get("next_experiments", []):
            story.append(Paragraph(escape(f"• [다음 실험 제안] {ex['experiment']} — 목적: {ex['purpose']}"), st_body))
    else:
        msg = (
            ai_record.get("error_message")
            if ai_record and ai_record.get("error_message")
            else "AI 해석 미실행 또는 비활성화 상태입니다 (규칙 기반 리포트만 표시)."
        )
        story.append(Paragraph(escape(str(msg)), st_sub))

    # 6. Reproducibility Footer
    story.append(Paragraph("6. 재현성 기록 (Reproducibility Manifest)", st_h2))
    hashes = run_record.get("file_hashes", {})
    hash_str = ", ".join(f"{k}: {v[:16]}..." for k, v in hashes.items()) or "없음"
    story.append(
        Paragraph(
            escape(
                f"원본 파일 SHA-256: {hash_str} | 기준 라이브러리: {run_record.get('ref_library_version')} | "
                f"엔진/패키지 버전: {run_record.get('algo_versions')}"
            ),
            st_small,
        )
    )

    doc.build(story)
    return buf.getvalue()
