import React, { useMemo, useState } from "react";
import { RefreshCw, Eye, EyeOff, ChevronRight, Info, Download, Sparkles } from "lucide-react";
import { api } from "../api";
import type { XRDParams } from "../types";
import { PlotlyChart } from "./PlotlyChart";
import { PeriodicTablePicker } from "./PeriodicTablePicker";
import {
  Button,
  Card,
  CollapsiblePanel,
  MetricCard,
  SourceTag,
  StatusBadge,
  SwitchControl,
} from "./ui/primitives";

interface XrdViewProps {
  runId: string;
  xrdResult: any;
  xrdParams: XRDParams;
  expectedElements?: string[];
  isBusy: boolean;
  onChangeParams: (next: XRDParams) => void;
  onChangeExpectedElements?: (nextElems: string[]) => void;
  onRerun: () => void;
}

export function XrdView({
  runId,
  xrdResult,
  xrdParams,
  expectedElements = [],
  isBusy,
  onChangeParams,
  onChangeExpectedElements,
  onRerun,
}: XrdViewProps) {
  const [selectedCandIdx, setSelectedCandIdx] = useState<number>(0);
  const [showRawAndBg, setShowRawAndBg] = useState<boolean>(true);
  const [showSmoothedDetect, setShowSmoothedDetect] = useState<boolean>(false);
  const [expandedPeakId, setExpandedPeakId] = useState<string | null>(null);

  if (!xrdResult) {
    return (
      <Card className="py-16 text-center space-y-2">
        <div className="text-[16px] font-bold text-[#191F28]">업로드된 XRD 데이터가 없습니다</div>
        <p className="text-[14px] text-[#6B7684]">
          상단 ‘시료·파일 설정’ 화면에서 XRD CSV 파일을 추가하면 결정상 비교 및 결정자 크기 추정을 함께 볼 수 있습니다.
        </p>
      </Card>
    );
  }

  const candidates = xrdResult.phase_matching?.candidates || [];
  const activeCand = candidates[selectedCandIdx] || candidates[0] || null;
  const scherrer = xrdResult.scherrer || {};
  const wh = xrdResult.williamson_hall || {};
  const cryst = xrdResult.crystallinity || {};
  const peaks: any[] = xrdResult.peaks || [];
  const activePeaks = peaks.filter((p) => !p.user_excluded);
  const schMap = useMemo(() => {
    const m: Record<string, any> = {};
    for (const r of scherrer.per_peak || []) {
      m[r.peak_id] = r;
    }
    return m;
  }, [scherrer]);

  // Build interactive Plotly traces (Main Diffractogram + Reference Stick Pattern)
  const plotData = useMemo(() => {
    const s = xrdResult.series || {};
    const tt: number[] = s.two_theta || [];
    const traces: any[] = [];

    if (showRawAndBg) {
      traces.push({
        x: tt,
        y: s.raw_intensity || [],
        type: "scatter",
        mode: "lines",
        name: "원본 측정 신호 [측정값]",
        line: { color: "#9CA3AF", width: 1.1 },
        xaxis: "x",
        yaxis: "y",
      });
      traces.push({
        x: tt,
        y: s.background || [],
        type: "scatter",
        mode: "lines",
        name: "ALS 추정 배경 [계산값]",
        line: { color: "#D97706", width: 1.3, dash: "dash" },
        xaxis: "x",
        yaxis: "y",
      });
    }

    traces.push({
      x: tt,
      y: s.corrected_unsmoothed || [],
      type: "scatter",
      mode: "lines",
      name: "배경보정 정량 신호(비평활) [계산값]",
      line: { color: "#3182F6", width: 1.6 },
      xaxis: "x",
      yaxis: "y",
    });

    if (showSmoothedDetect) {
      traces.push({
        x: tt,
        y: s.detection_smoothed || [],
        type: "scatter",
        mode: "lines",
        name: "검출 전용 평활화 신호",
        line: { color: "#8B5CF6", width: 1.2, dash: "dot" },
        xaxis: "x",
        yaxis: "y",
      });
    }

    // Matched vs Unexplained Peak Markers
    const matchedIds = new Set<string>(activeCand?.explained_peak_ids || []);
    const matchedPts = activePeaks.filter((p) => matchedIds.has(p.peak_id));
    const unexpPts = activePeaks.filter((p) => !matchedIds.has(p.peak_id));
    const exclPts = peaks.filter((p) => p.user_excluded);

    if (matchedPts.length > 0) {
      traces.push({
        x: matchedPts.map((p) => p.two_theta),
        y: matchedPts.map((p) => p.height),
        text: matchedPts.map(
          (p) => `${p.peak_id} (${p.two_theta}°, FWHM ${p.fwhm_deg ?? "피팅실패"}°)`
        ),
        customdata: matchedPts.map((p) => p.peak_id),
        type: "scatter",
        mode: "markers",
        name: activeCand ? `일치 피크 (${activeCand.name})` : "검출 피크",
        marker: { color: "#16A34A", size: 8, symbol: "circle" },
        xaxis: "x",
        yaxis: "y",
      });
    }

    if (unexpPts.length > 0) {
      traces.push({
        x: unexpPts.map((p) => p.two_theta),
        y: unexpPts.map((p) => p.height),
        text: unexpPts.map(
          (p) => `${p.peak_id} [미설명] (${p.two_theta}°, FWHM ${p.fwhm_deg ?? "피팅실패"}°)`
        ),
        customdata: unexpPts.map((p) => p.peak_id),
        type: "scatter",
        mode: "markers",
        name: activeCand ? "미일치(미설명) 실측 피크" : "검출 실측 피크",
        marker: { color: "#D97706", size: 8, symbol: "diamond" },
        xaxis: "x",
        yaxis: "y",
      });
    }

    if (exclPts.length > 0) {
      traces.push({
        x: exclPts.map((p) => p.two_theta),
        y: exclPts.map((p) => p.height),
        text: exclPts.map((p) => `${p.peak_id} (사용자 제외됨)`),
        customdata: exclPts.map((p) => p.peak_id),
        type: "scatter",
        mode: "markers",
        name: "사용자 제외 피크",
        marker: { color: "#DC2626", size: 8, symbol: "x" },
        xaxis: "x",
        yaxis: "y",
      });
    }

    // Reference stick pattern in bottom subplot y2
    if (activeCand) {
      const stickX: Array<number | null> = [];
      const stickY: Array<number | null> = [];
      const stickText: string[] = [];
      const rxList: number[] = activeCand.ref_stick_two_theta || [];
      const riList: number[] = activeCand.ref_stick_intensity || [];
      const hklList: string[] = activeCand.ref_stick_hkl || [];

      rxList.forEach((rx0, idx) => {
        const shifted = rx0 + (activeCand.shift_deg || 0);
        stickX.push(shifted, shifted, null);
        stickY.push(0, riList[idx], null);
        const label = `${activeCand.name} ${hklList[idx] || ""} (${shifted.toFixed(3)}°, I=${riList[idx]}%)`;
        stickText.push(label, label, "");
      });

      traces.push({
        x: stickX,
        y: stickY,
        text: stickText,
        hoverinfo: "text",
        type: "scatter",
        mode: "lines",
        name: `기준 패턴: ${activeCand.name}`,
        line: { color: "#16A34A", width: 2 },
        xaxis: "x",
        yaxis: "y2",
      });
    }

    return traces;
  }, [xrdResult, activeCand, showRawAndBg, showSmoothedDetect, activePeaks, peaks]);

  const plotLayout = useMemo(
    () => ({
      grid: { rows: 2, columns: 1, subplots: [["xy"], ["xy2"]], roworder: "top to bottom" },
      xaxis: {
        title: { text: "2θ (deg)" },
        gridcolor: "#F2F4F6",
        zeroline: false,
      },
      yaxis: {
        domain: [0.3, 1.0],
        title: { text: "강도 (Intensity, a.u.)" },
        gridcolor: "#F2F4F6",
      },
      yaxis2: {
        domain: [0.0, 0.22],
        title: { text: "기준 (%)" },
        range: [0, 110],
        gridcolor: "#F2F4F6",
      },
      legend: { orientation: "h", y: 1.12, x: 0 },
      hovermode: "closest",
    }),
    []
  );

  const togglePeakExclusion = (peakId: string) => {
    const cur = new Set(xrdParams.excluded_peak_ids);
    if (cur.has(peakId)) cur.delete(peakId);
    else cur.add(peakId);
    onChangeParams({ ...xrdParams, excluded_peak_ids: Array.from(cur) });
  };

  const savedCond = xrdResult.conditions || {};
  const hasUnsavedChanges =
    xrdParams.wavelength_angstrom !== savedCond.wavelength_angstrom ||
    xrdParams.prominence_rel !== savedCond.prominence_rel ||
    xrdParams.min_distance_deg !== savedCond.min_distance_deg ||
    xrdParams.match_tol_deg !== savedCond.match_tol_deg ||
    xrdParams.max_e_hull_ev !== (savedCond.max_e_hull_ev ?? 0.15) ||
    xrdParams.inst_fwhm_deg !== savedCond.inst_fwhm_deg ||
    xrdParams.scherrer_k !== savedCond.scherrer_k ||
    xrdParams.fit_profile !== savedCond.fit_profile ||
    xrdParams.use_element_filter !== savedCond.use_element_filter ||
    xrdParams.als_lam !== savedCond.als_lam ||
    JSON.stringify(xrdParams.excluded_peak_ids) !==
      JSON.stringify(savedCond.excluded_peak_ids || []);

  const mpSync = xrdResult.mp_sync_info || null;

  return (
    <div className="space-y-6">
      {/* Top 4 Key Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="1순위 상 후보 (라이브러리 내)"
          value={activeCand ? activeCand.formula : null}
          unit={activeCand ? `점수 ${activeCand.score}/100` : undefined}
          subtext={
            activeCand
              ? `${activeCand.name} · ${activeCand.spacegroup} (정답 확률 아님)`
              : xrdResult.phase_matching?.reason
          }
          status={xrdResult.phase_matching?.status}
          sourceKind="계산값"
          tooltipTerm="상대 매칭 점수 (Match Score)"
          tooltipDesc="기준 피크 재현율(50%), 실측 피크 설명 비율(30%), 상대강도 유사도(20%)의 가중합입니다. 제한된 기준 라이브러리 안에서의 부합도이며 정답 확률(%)이 아닙니다."
        />

        <MetricCard
          label="결정자 크기 추정 (Scherrer)"
          value={scherrer.mean_nm}
          unit={scherrer.mean_nm !== null ? "nm" : undefined}
          subtext={
            scherrer.mean_nm !== null
              ? `${scherrer.instrument_correction_label} · 유효 피크 ${scherrer.n_used_peaks}개 (K=${scherrer.k_factor})`
              : scherrer.reason
          }
          status={scherrer.status_badge || scherrer.status}
          sourceKind="계산값"
          tooltipTerm="결정자 크기 추정 (Scherrer Equation)"
          tooltipDesc="D = Kλ / (β cosθ)로 계산한 결맞음 회절 도메인 크기입니다. SEM으로 보는 2차 입자 외형 크기와 다를 수 있으며, 기기 선폭 미보정 시 하한 추정값이 됩니다."
        />

        <MetricCard
          label="검출된 유효 피크"
          value={activePeaks.length}
          unit={`개 (전체 ${peaks.length}개)`}
          subtext={`정량 프로파일: ${xrdResult.conditions?.fit_profile || "pseudo_voigt"} (비평활 원본 피팅)`}
          status={activePeaks.length > 0 ? "분석 완료" : "계산 불가"}
          sourceKind="계산값"
          tooltipTerm="검출/정량 분리 원칙"
          tooltipDesc="평활화(Savitzky–Golay)는 초기 피크 위치 탐색에만 사용하고, FWHM·면적 피팅은 선폭 왜곡을 막기 위해 비평활 배경보정 신호에서 수행합니다."
        />

        <MetricCard
          label="Williamson–Hall 미세변형 분리"
          value={wh.crystallite_size_nm ?? null}
          unit={wh.crystallite_size_nm ? "nm" : undefined}
          subtext={
            wh.status === "계산 불가" || !wh.enabled
              ? wh.reason
              : `ε = ${wh.microstrain ?? "제한됨"} · R² = ${wh.r2} (피크 ${wh.n_peaks}개)`
          }
          status={wh.enabled ? wh.status : "확인 필요"}
          sourceKind="계산값"
          tooltipTerm="Williamson–Hall (UDM)"
          tooltipDesc="동일 상에 귀속된 유효 피크들의 β cosθ 대 4 sinθ 선형 회귀로 크기 효과와 등방성 격자 미세변형률(ε)을 분리 추정합니다."
        />
      </div>

      {/* Prominent XRD Quick Recalibration & Element Filter Bar */}
      <Card className="p-4 sm:p-5 bg-[#F8FAFC] border-[#BFDBFE] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[14px] font-bold text-[#191F28]">
                XRD 피크 검출 · 상 매칭 · Materials Project 열역학 필터 및 재계산
              </span>
              <span className="px-2 py-0.5 rounded-full bg-[#ECFDF5] text-[#047857] text-[11px] font-bold border border-[#A7F3D0]">
                {mpSync?.mode === "live_mp_api"
                  ? `MP Live API 연동 (${mpSync.fetched_count}종)`
                  : "MP 열역학·물성 DB 연동됨"}
              </span>
              {hasUnsavedChanges && (
                <span className="px-2 py-0.5 rounded-full bg-[#EFF6FF] text-[#3182F6] text-[11px] font-bold border border-[#BFDBFE]">
                  변경 사항 있음
                </span>
              )}
              {xrdParams.excluded_peak_ids.length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-[#FEF3C7] text-[#D97706] text-[11px] font-bold">
                  제외 피크 {xrdParams.excluded_peak_ids.length}개
                </span>
              )}
            </div>
            <p className="text-[12px] text-[#6B7684] mt-0.5">
              파장·피크 민감도·기기 선폭·예상 원소(주기율표)를 조정하거나 차트에서 특정 피크를 클릭해 제외한 뒤 우측의 ‘적용하여 재계산’을 누르세요.
            </p>
          </div>
          <Button
            type="button"
            variant="primary"
            size="md"
            disabled={isBusy}
            onClick={onRerun}
          >
            <RefreshCw className={`w-4 h-4 ${isBusy ? "animate-spin" : ""}`} />
            {isBusy ? "재계산 중..." : "적용하여 재계산"}
          </Button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-12 gap-3 items-end pt-2 border-t border-[#E5E8EB]">
          <div className="sm:col-span-2">
            <label className="block text-[12px] font-medium text-[#6B7684] mb-1">파장 λ (Å)</label>
            <input
              type="number"
              step="0.0001"
              value={xrdParams.wavelength_angstrom}
              onChange={(e) =>
                onChangeParams({
                  ...xrdParams,
                  wavelength_angstrom: parseFloat(e.target.value) || 1.5406,
                })
              }
              className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] bg-white text-[13px] tabular-nums"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-[12px] font-medium text-[#6B7684] mb-1">
              피크 민감도 (Prom.)
            </label>
            <input
              type="number"
              step="0.005"
              value={xrdParams.prominence_rel}
              onChange={(e) =>
                onChangeParams({
                  ...xrdParams,
                  prominence_rel: parseFloat(e.target.value) || 0.025,
                })
              }
              className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] bg-white text-[13px] tabular-nums"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-[12px] font-medium text-[#6B7684] mb-1">
              매칭 허용오차 (°)
            </label>
            <input
              type="number"
              step="0.02"
              value={xrdParams.match_tol_deg}
              onChange={(e) =>
                onChangeParams({
                  ...xrdParams,
                  match_tol_deg: parseFloat(e.target.value) || 0.22,
                })
              }
              className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] bg-white text-[13px] tabular-nums"
            />
          </div>
          <div className="sm:col-span-2">
            <label
              className="block text-[12px] font-medium text-[#6B7684] mb-1"
              title="Materials Project Energy Above Hull (eV/atom) 상한 필터"
            >
              E_hull 상한 (eV/atom)
            </label>
            <input
              type="number"
              step="0.02"
              min="0"
              max="2.0"
              value={xrdParams.max_e_hull_ev ?? 0.15}
              onChange={(e) =>
                onChangeParams({
                  ...xrdParams,
                  max_e_hull_ev:
                    e.target.value.trim() === "" ? 0.15 : Math.max(0, parseFloat(e.target.value)),
                })
              }
              className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] bg-white text-[13px] tabular-nums"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-[12px] font-medium text-[#6B7684] mb-1">
              기기 선폭 보정 FWHM (°)
            </label>
            <input
              type="number"
              step="0.005"
              placeholder="미입력 시 미보정"
              value={xrdParams.inst_fwhm_deg ?? ""}
              onChange={(e) =>
                onChangeParams({
                  ...xrdParams,
                  inst_fwhm_deg: e.target.value.trim() === "" ? null : parseFloat(e.target.value),
                })
              }
              className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] bg-white text-[13px] tabular-nums"
            />
          </div>
          <div className="col-span-2 sm:col-span-2">
            <SwitchControl
              checked={xrdParams.use_element_filter}
              onCheckedChange={(val) => onChangeParams({ ...xrdParams, use_element_filter: val })}
              label="예상 원소 필터"
            />
          </div>
        </div>

        {onChangeExpectedElements && (
          <div className="pt-1">
            <PeriodicTablePicker
              selectedElements={expectedElements}
              onChange={onChangeExpectedElements}
              defaultExpanded={false}
              compact={true}
            />
          </div>
        )}
      </Card>

      {/* Desktop 2-column layout: Main Chart + Settings / Phase Candidates */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Main Interactive XRD Chart */}
        <Card className="xl:col-span-8 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[17px] font-bold text-[#191F28]">XRD 회절 패턴 및 기준 피크 비교</h3>
                <SourceTag kind="측정값" />
                <SourceTag kind="계산값" />
              </div>
              <p className="text-[12px] text-[#6B7684] mt-0.5">
                마우스 드래그로 2θ 구간을 확대하고, 피크 마커를 클릭하면 특정 불순물/기판 피크를 분석에서 제외할 수 있습니다.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant={showRawAndBg ? "secondary" : "outline"}
                onClick={() => setShowRawAndBg((v) => !v)}
              >
                {showRawAndBg ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                원본·배경 겹쳐보기
              </Button>
              <Button
                type="button"
                size="sm"
                variant={showSmoothedDetect ? "secondary" : "outline"}
                onClick={() => setShowSmoothedDetect((v) => !v)}
              >
                검출용 평활선
              </Button>
              <a
                href={api.downloadXrdChartPngUrl(runId, activeCand?.phase_id)}
                download={`matlens_${runId}_xrd_analysis.png`}
                className="inline-flex items-center gap-1.5 font-semibold transition-colors rounded-[10px] min-h-[38px] px-3 py-1.5 text-[12px] bg-[#EFF6FF] text-[#1D4ED8] hover:bg-[#DBEAFE] border border-[#BFDBFE] cursor-pointer"
                title="상후보, 각 피크 위치(2θ, hkl) 및 Bragg 기준선이 포함된 고해상도(300 DPI) 논문용 XRD 분석 이미지 다운로드"
              >
                <Download className="w-3.5 h-3.5 text-[#1D4ED8]" />
                XRD 이미지 다운로드 (PNG)
              </a>
            </div>
          </div>

          <PlotlyChart
            data={plotData}
            layout={plotLayout}
            height={470}
            onPointClick={(pt) => {
              const pid = pt?.customdata;
              if (typeof pid === "string" && pid.startsWith("P")) {
                togglePeakExclusion(pid);
              }
            }}
          />

          <div className="text-[12px] text-[#6B7684] bg-[#F7F8FA] p-3 rounded-[12px]">
            {xrdResult.conditions?.smoothing_separation_note}
          </div>
        </Card>

        {/* Right Column: Phase Candidates + Collapsible Advanced Settings */}
        <div className="xl:col-span-4 space-y-5">
          {/* Composition Guidance Card from Sample Description */}
          {xrdResult.phase_matching?.composition_guidance?.has_guidance && (
            <Card className="space-y-2.5 border-[#93C5FD] bg-gradient-to-br from-[#EFF6FF] to-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[14px] font-bold text-[#1D4ED8]">
                  <Sparkles className="w-4 h-4 text-[#2563EB]" />
                  시료 설명 조성 기반 피크 분석
                </div>
                <SourceTag kind="계산값" />
              </div>
              {xrdResult.phase_matching.composition_guidance.nominal_formula && (
                <div className="text-[12px] text-[#1E40AF]">
                  명목 목표 조성: <strong className="font-mono bg-white px-1.5 py-0.5 rounded border border-[#BFDBFE]">{xrdResult.phase_matching.composition_guidance.nominal_formula}</strong>
                </div>
              )}
              {xrdResult.phase_matching.composition_guidance.doping_notes?.length > 0 && (
                <div className="text-[11px] text-[#1E40AF] bg-white/90 p-2 rounded-[8px] border border-[#BFDBFE]">
                  • 특이사항: {xrdResult.phase_matching.composition_guidance.doping_notes.join(", ")}
                </div>
              )}
              <p className="text-[12px] text-[#333D4B] leading-relaxed">
                {xrdResult.phase_matching.composition_guidance.interpretation_guide}
              </p>
            </Card>
          )}

          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[16px] font-bold text-[#191F28]">기준 라이브러리 상 후보</h3>
              <SourceTag kind="계산값" />
            </div>
            <p className="text-[12px] text-[#6B7684] leading-relaxed">
              {xrdResult.phase_matching?.library_scope_notice}
            </p>

            {candidates.length === 0 ? (
              <div className="p-4 rounded-[12px] bg-[#F7F8FA] text-[13px] text-[#6B7684]">
                일치하는 상 후보가 없습니다. 예상 원소 필터를 해제하거나 허용 오차를 조정해보세요.
              </div>
            ) : (
              <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                {candidates.map((c: any, idx: number) => {
                  const isSel = idx === selectedCandIdx;
                  const tierColor =
                    c.stability_tier === "stable"
                      ? "bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]"
                      : c.stability_tier === "metastable"
                      ? "bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]"
                      : c.stability_tier === "unstable"
                      ? "bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]"
                      : "bg-[#F2F4F6] text-[#4E5968] border-[#E5E8EB]";
                  return (
                    <button
                      key={c.phase_id}
                      type="button"
                      onClick={() => setSelectedCandIdx(idx)}
                      className={`w-full text-left p-3.5 rounded-[14px] border transition-colors cursor-pointer ${
                        isSel
                          ? "border-[#3182F6] bg-[#EFF6FF]/60"
                          : "border-[#E5E8EB] hover:bg-[#F7F8FA]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[14px] font-bold text-[#191F28]">
                          {idx + 1}. {c.name}
                        </span>
                        <span className="text-[13px] font-bold text-[#3182F6] tabular-nums shrink-0">
                          {c.score}점
                        </span>
                      </div>

                      {/* Target Badge & Composition Note */}
                      {c.target_badge && (
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <span className="px-2 py-0.5 rounded-[6px] bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE] text-[11px] font-bold">
                            ★ {c.target_badge}
                          </span>
                        </div>
                      )}
                      {c.composition_note && (
                        <div className="text-[11px] text-[#1E40AF] mt-1 bg-[#F0F7FF] px-2.5 py-1 rounded-[6px] border border-[#BFDBFE]">
                          {c.composition_note}
                        </div>
                      )}

                      {/* Materials Project ID & Thermodynamic E_hull Badge */}
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        {c.mp_id && (
                          <span className="px-2 py-0.5 rounded-[6px] bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE] text-[11px] font-mono font-bold">
                            {c.mp_id}
                          </span>
                        )}
                        {c.stability_badge && (
                          <span
                            className={`px-2 py-0.5 rounded-[6px] border text-[11px] font-semibold ${tierColor}`}
                          >
                            {c.stability_badge}
                          </span>
                        )}
                        {c.formation_energy_ev !== null && c.formation_energy_ev !== undefined && (
                          <span className="text-[11px] text-[#6B7684] tabular-nums">
                            ΔH_f = {c.formation_energy_ev} eV/atom
                          </span>
                        )}
                      </div>

                      {/* Physical Properties: Density, Band Gap, Z_BSE */}
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-[#333D4B] mt-1.5 bg-white/80 px-2.5 py-1.5 rounded-[8px] border border-[#E5E8EB]/80 tabular-nums">
                        {c.density_g_cm3 !== null && c.density_g_cm3 !== undefined && (
                          <span>
                            <strong>ρ_theo:</strong> {c.density_g_cm3} g/cm³
                          </span>
                        )}
                        {c.electronic_label && (
                          <span>
                            <strong>전자구조:</strong> {c.electronic_label}
                          </span>
                        )}
                        {c.z_bse_eff !== null && c.z_bse_eff !== undefined && (
                          <span>
                            <strong>Z_BSE:</strong> {c.z_bse_eff}
                          </span>
                        )}
                      </div>

                      <div className="text-[12px] text-[#6B7684] mt-1.5">
                        ID: {c.phase_id} · {c.spacegroup} · Δ2θ 이동 {c.shift_deg >= 0 ? "+" : ""}
                        {c.shift_deg}° · 일치 피크 {c.matched_peaks?.length || 0}개 (미설명{" "}
                        {c.unexplained_peak_ids?.length || 0}개)
                      </div>
                      <div className="text-[11px] text-[#6B7684] mt-1 truncate" title={c.source}>
                        출처: {c.source}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="text-[11px] text-[#6B7684] pt-2 border-t border-[#E5E8EB] leading-relaxed">
              <strong>매칭 점수 산식:</strong> {xrdResult.phase_matching?.score_formula}
            </div>
          </Card>

          {/* Collapsible Advanced Settings */}
          <CollapsiblePanel
            title="XRD 고급 분석 설정"
            subtitle="ALS 배경, 피크 검출 민감도, 기기 선폭, 결정성 지표"
          >
            <div className="space-y-3 pt-2">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[12px] font-medium text-[#6B7684] mb-1">
                    ALS 배경 λ
                  </label>
                  <input
                    type="number"
                    step="10000"
                    value={xrdParams.als_lam}
                    onChange={(e) =>
                      onChangeParams({ ...xrdParams, als_lam: parseFloat(e.target.value) || 100000 })
                    }
                    className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] text-[13px] tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-[#6B7684] mb-1">
                    피크 Prominence 비율
                  </label>
                  <input
                    type="number"
                    step="0.005"
                    value={xrdParams.prominence_rel}
                    onChange={(e) =>
                      onChangeParams({
                        ...xrdParams,
                        prominence_rel: parseFloat(e.target.value) || 0.025,
                      })
                    }
                    className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] text-[13px] tabular-nums"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[12px] font-medium text-[#6B7684] mb-1">
                    최소 피크 간격 (°)
                  </label>
                  <input
                    type="number"
                    step="0.02"
                    value={xrdParams.min_distance_deg}
                    onChange={(e) =>
                      onChangeParams({
                        ...xrdParams,
                        min_distance_deg: parseFloat(e.target.value) || 0.14,
                      })
                    }
                    className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] text-[13px] tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-[#6B7684] mb-1">
                    피크 피팅 함수
                  </label>
                  <select
                    value={xrdParams.fit_profile}
                    onChange={(e) =>
                      onChangeParams({
                        ...xrdParams,
                        fit_profile: e.target.value as XRDParams["fit_profile"],
                      })
                    }
                    className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] text-[13px] bg-white"
                  >
                    <option value="pseudo_voigt">Pseudo-Voigt</option>
                    <option value="gaussian">Gaussian</option>
                    <option value="lorentzian">Lorentzian</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[12px] font-medium text-[#6B7684] mb-1">
                    Scherrer 형상 계수 K
                  </label>
                  <input
                    type="number"
                    step="0.02"
                    value={xrdParams.scherrer_k}
                    onChange={(e) =>
                      onChangeParams({ ...xrdParams, scherrer_k: parseFloat(e.target.value) || 0.9 })
                    }
                    className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] text-[13px] tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-[#6B7684] mb-1">
                    기기 선폭 FWHM (°)
                  </label>
                  <input
                    type="number"
                    step="0.005"
                    placeholder="미입력 시 미보정"
                    value={xrdParams.inst_fwhm_deg ?? ""}
                    onChange={(e) =>
                      onChangeParams({
                        ...xrdParams,
                        inst_fwhm_deg: e.target.value.trim() === "" ? null : parseFloat(e.target.value),
                      })
                    }
                    className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] text-[13px] tabular-nums"
                  />
                </div>
              </div>

              <SwitchControl
                checked={xrdParams.use_smoothing}
                onCheckedChange={(val) => onChangeParams({ ...xrdParams, use_smoothing: val })}
                label="검출 전용 Savitzky–Golay 평활화 사용"
                description="정량 FWHM 피팅에는 영향을 주지 않습니다."
              />

              <SwitchControl
                checked={xrdParams.use_element_filter}
                onCheckedChange={(val) => onChangeParams({ ...xrdParams, use_element_filter: val })}
                label="예상 원소로 기준 라이브러리 후보 필터링"
              />

              <div className="pt-2 border-t border-[#E5E8EB] space-y-2">
                <SwitchControl
                  checked={xrdParams.crystallinity.enabled}
                  onCheckedChange={(val) =>
                    onChangeParams({
                      ...xrdParams,
                      crystallinity: { ...xrdParams.crystallinity, enabled: val },
                    })
                  }
                  label="조건부 상대 결정성 지표 활성화"
                  description="적용 시료군이 정의된 경우에만 상대 비교 지표를 계산합니다."
                />
                {xrdParams.crystallinity.enabled && (
                  <input
                    type="text"
                    placeholder="적용 시료군 입력 (예: 비정질 실리카 담지 TiO2)"
                    value={xrdParams.crystallinity.sample_family}
                    onChange={(e) =>
                      onChangeParams({
                        ...xrdParams,
                        crystallinity: {
                          ...xrdParams.crystallinity,
                          sample_family: e.target.value,
                        },
                      })
                    }
                    className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] text-[13px]"
                  />
                )}
              </div>

              <Button
                type="button"
                variant="primary"
                className="w-full"
                disabled={isBusy}
                onClick={onRerun}
              >
                <RefreshCw className="w-4 h-4" />
                설정 변경 적용하여 재분석
              </Button>
            </div>
          </CollapsiblePanel>
        </div>
      </div>

      {/* Multi-phase Combination & Williamson-Hall Extension Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Multi-phase combination card */}
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[16px] font-bold text-[#191F28]">다상 후보 조합 잔차 비교</h3>
            <SourceTag kind="계산값" />
          </div>
          {xrdResult.phase_matching?.multiphase_comparison ? (
            <div className="space-y-3">
              <div className="text-[13px] text-[#4E5968] bg-[#F7F8FA] p-3 rounded-[12px]">
                단일상 기준({xrdResult.phase_matching.multiphase_comparison.single_phase_baseline.phase}): 패턴 잔차{" "}
                <strong className="tabular-nums">
                  R_pat = {xrdResult.phase_matching.multiphase_comparison.single_phase_baseline.residual_r_pat}
                </strong>{" "}
                · 미설명 피크 강도 비율{" "}
                <strong>
                  {xrdResult.phase_matching.multiphase_comparison.single_phase_baseline.unexplained_intensity_pct}%
                </strong>
              </div>
              <div className="space-y-2">
                {xrdResult.phase_matching.multiphase_comparison.combinations?.map(
                  (combo: any, idx: number) => (
                    <div
                      key={idx}
                      className="p-3 rounded-[12px] border border-[#E5E8EB] text-[13px] space-y-1"
                    >
                      <div className="font-semibold text-[#191F28] flex justify-between">
                        <span>{combo.phases.join(" + ")}</span>
                        <span className="text-[#16A34A] tabular-nums">
                          잔차 {combo.residual_reduction_pct}% 감소 (R_pat {combo.residual_r_pat})
                        </span>
                      </div>
                      <div className="text-[12px] text-[#6B7684]">
                        추가 설명된 피크:{" "}
                        {combo.newly_explained_peaks?.length
                          ? combo.newly_explained_peaks.join(", ")
                          : "없음"}{" "}
                        · 패턴 피팅 스케일 비율: {combo.pattern_scale_share_pct.join("% : ")}%
                      </div>
                    </div>
                  )
                )}
              </div>
              <div className="text-[12px] text-[#D97706] bg-[#FEF3C7]/60 p-3 rounded-[12px]">
                {xrdResult.phase_matching.multiphase_comparison.mass_fraction_disclaimer}
              </div>
            </div>
          ) : (
            <div className="text-[13px] text-[#6B7684] py-4">
              비교할 복수 결정상 후보가 충분하지 않거나 단일상으로 주요 피크가 모두 설명되었습니다.
            </div>
          )}
        </Card>

        {/* Williamson-Hall Regression Card */}
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[16px] font-bold text-[#191F28]">Williamson–Hall 플롯 (크기·미세변형 분리)</h3>
            <StatusBadge status={wh.status || "계산 불가"} />
          </div>
          {wh.points && wh.points.length >= 3 && wh.regression_line ? (
            <>
              <PlotlyChart
                height={230}
                data={[
                  {
                    x: wh.points.map((p: any) => p.x_4sin_theta),
                    y: wh.points.map((p: any) => p.y_beta_cos_theta),
                    text: wh.points.map((p: any) => `${p.peak_id} ${p.hkl || ""} (${p.two_theta}°)`),
                    type: "scatter",
                    mode: "markers",
                    name: `${wh.phase_name} 피크`,
                    marker: { color: "#3182F6", size: 9 },
                  },
                  {
                    x: wh.regression_line.x,
                    y: wh.regression_line.y,
                    type: "scatter",
                    mode: "lines",
                    name: `선형 회귀 (R²=${wh.r2})`,
                    line: { color: "#191F28", width: 1.5, dash: "dash" },
                  },
                ]}
                layout={{
                  margin: { l: 58, r: 16, t: 12, b: 42 },
                  xaxis: { title: { text: "4 sinθ" }, gridcolor: "#F2F4F6" },
                  yaxis: { title: { text: "β cosθ (rad)" }, gridcolor: "#F2F4F6" },
                  legend: { orientation: "h", y: 1.15 },
                }}
              />
              <div className="text-[12px] text-[#6B7684] space-y-1">
                <div>모델 가정: {wh.model_assumption}</div>
                {wh.limitations?.map((lim: string, i: number) => (
                  <div key={i} className="text-[#D97706] font-medium">
                    • {lim}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-[13px] text-[#6B7684] py-8 bg-[#F7F8FA] rounded-[14px] px-4">
              {wh.reason || "동일 상에 귀속된 비겹침 유효 피크가 부족하여 회귀를 수행하지 않았습니다."}
            </div>
          )}

          {cryst.enabled && (
            <div className="pt-3 border-t border-[#E5E8EB] text-[13px]">
              <div className="font-semibold text-[#191F28]">
                조건부 상대 결정성 지표:{" "}
                {cryst.index_pct !== null ? `${cryst.index_pct}% (${cryst.sample_family})` : "계산 불가"}
              </div>
              <div className="text-[12px] text-[#6B7684] mt-0.5">
                {cryst.disclaimer || cryst.reason}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Bottom Detailed Peak & Scherrer Basis Table */}
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-[16px] font-bold text-[#191F28]">
              피크별 정량 피팅 및 결정자 크기 산출 근거 ({peaks.length}개)
            </h3>
            <p className="text-[12px] text-[#6B7684] mt-0.5">
              부적합 피크(겹침, 낮은 SNR, 고각 &gt;65°, 피팅 실패)는 무리하게 계산하지 않고 제외 사유를 명시합니다.
            </p>
          </div>
          <a
            href={api.downloadXrdCsvUrl(runId)}
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#3182F6] hover:underline min-h-[44px] px-3"
          >
            <Download className="w-4 h-4" />
            피크 목록 CSV 다운로드
          </a>
        </div>

        {/* Scherrer Assumptions Disclosure */}
        {scherrer.assumptions?.length > 0 && (
          <div className="bg-[#F7F8FA] p-3.5 rounded-[14px] text-[12px] text-[#4E5968] space-y-1">
            <div className="font-semibold text-[#191F28] flex items-center gap-1.5">
              <Info className="w-4 h-4 text-[#3182F6]" />
              결정자 크기 추정(Scherrer) 적용 가정 공개
            </div>
            {scherrer.assumptions.map((a: string, idx: number) => (
              <div key={idx}>• {a}</div>
            ))}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[#E5E8EB] text-[#6B7684]">
                <th className="py-3 px-2 font-semibold">ID</th>
                <th className="py-3 px-2 font-semibold">2θ (°)</th>
                <th className="py-3 px-2 font-semibold hidden sm:table-cell">d (Å)</th>
                <th className="py-3 px-2 font-semibold">상대강도</th>
                <th className="py-3 px-2 font-semibold">FWHM (°)</th>
                <th className="py-3 px-2 font-semibold">결정자 추정</th>
                <th className="py-3 px-2 font-semibold hidden md:table-cell">귀속 상 / 상태 및 제외 사유</th>
                <th className="py-3 px-2 font-semibold text-right">조작</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E8EB] tabular-nums">
              {peaks.map((p) => {
                const sr = schMap[p.peak_id] || {};
                const isExcluded = xrdParams.excluded_peak_ids.includes(p.peak_id);
                const isExpanded = expandedPeakId === p.peak_id;
                return (
                  <React.Fragment key={p.peak_id}>
                    <tr className={isExcluded ? "bg-[#F7F8FA] opacity-60" : "hover:bg-[#F7F8FA]/60"}>
                      <td className="py-3 px-2 font-semibold text-[#191F28]">{p.peak_id}</td>
                      <td className="py-3 px-2">{p.two_theta}</td>
                      <td className="py-3 px-2 hidden sm:table-cell">{p.d_spacing_A}</td>
                      <td className="py-3 px-2">{p.rel_intensity_pct}%</td>
                      <td className="py-3 px-2">
                        {p.fwhm_deg !== null ? p.fwhm_deg : <span className="text-[#DC2626]">피팅 실패</span>}
                      </td>
                      <td className="py-3 px-2 font-semibold">
                        {sr.used && sr.crystallite_size_nm !== null ? (
                          `${sr.crystallite_size_nm} nm`
                        ) : (
                          <span className="text-[#6B7684] font-normal">제외됨</span>
                        )}
                      </td>
                      <td className="py-3 px-2 hidden md:table-cell text-[12px] text-[#6B7684]">
                        {p.composition_role && (
                          <div className="mb-0.5">
                            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE]">
                              {p.composition_role}
                            </span>
                          </div>
                        )}
                        {p.assigned_phase ? (
                          <span className="text-[#191F28] font-medium">
                            {p.assigned_phase} {p.assigned_hkl || ""} ·{" "}
                          </span>
                        ) : null}
                        {sr.exclusion_reason ? (
                          <span className="text-[#D97706]">{sr.exclusion_reason}</span>
                        ) : (
                          <span>{p.status_label}</span>
                        )}
                        {p.composition_explanation && (
                          <div className="text-[11px] text-[#475569] mt-0.5 line-clamp-1 hover:line-clamp-none cursor-help" title={p.composition_explanation}>
                            {p.composition_explanation}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => togglePeakExclusion(p.peak_id)}
                          className="text-[12px] font-semibold text-[#3182F6] hover:underline px-2 py-2 min-h-[44px] cursor-pointer"
                        >
                          {isExcluded ? "복원" : "제외"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setExpandedPeakId(isExpanded ? null : p.peak_id)}
                          className="md:hidden text-[12px] text-[#6B7684] px-1.5 py-2 min-h-[44px] cursor-pointer"
                          aria-label="상세 펼치기"
                        >
                          <ChevronRight
                            className={`w-4 h-4 inline transition-transform ${isExpanded ? "rotate-90" : ""}`}
                          />
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-[#F7F8FA] text-[12px] text-[#4E5968]">
                        <td colSpan={8} className="p-3 space-y-1">
                          <div>
                            면간격 d: {p.d_spacing_A} Å · 적분 면적: {p.area ?? "계산 불가"} · SNR: {p.snr} · R²:{" "}
                            {p.fit_r2 ?? "-"}
                          </div>
                          <div>
                            귀속 상: {p.assigned_phase || "미귀속"} {p.assigned_hkl || ""} · 상태:{" "}
                            {sr.exclusion_reason || p.status_label}
                          </div>
                          {p.composition_explanation && (
                            <div className="text-[#1D4ED8] bg-[#EFF6FF] p-2 rounded-[8px] border border-[#BFDBFE] mt-1">
                              <strong>시료 설명 기반 피크 해석:</strong> {p.composition_explanation}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
