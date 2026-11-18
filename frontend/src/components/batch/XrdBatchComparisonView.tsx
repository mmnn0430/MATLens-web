import { useMemo, useState } from "react";
import {
  Sliders,
  TrendingUp,
  BarChart2,
  Table,
} from "lucide-react";
import type {
  UniversalDataset,
  XrdBatchAnalysisResult,
  XrdPeakInfo,
} from "../../core/batch/types";
import { PlotlyChart } from "../PlotlyChart";
import { Card } from "../ui/primitives";

interface XrdBatchComparisonViewProps {
  datasets: UniversalDataset<any, XrdBatchAnalysisResult>[];
}

export function XrdBatchComparisonView({ datasets }: XrdBatchComparisonViewProps) {
  // Chart View Mode: "overlay" vs "waterfall"
  const [viewMode, setViewMode] = useState<"overlay" | "waterfall">("overlay");
  // Intensity Normalization (0~100%)
  const [isNormalized, setIsNormalized] = useState<boolean>(true);
  // Waterfall Vertical Offset Shift Slider (10% to 150%)
  const [waterfallOffsetPct, setWaterfallOffsetPct] = useState<number>(45);
  // Active Tab for bottom comparison panels: "peaks" | "phase_fraction" | "crystallite"
  const [activeBottomTab, setActiveBottomTab] = useState<"peaks" | "phase_fraction" | "crystallite">("peaks");

  const visibleDatasets = useMemo(
    () => datasets.filter((d) => d.visible && d.status === "success" && d.analysisResult),
    [datasets]
  );

  // 1. Build Plotly Traces for Multi-XRD Spectra (Overlay / Waterfall)
  const { plotData, plotLayout } = useMemo(() => {
    if (visibleDatasets.length === 0) {
      return { plotData: [], plotLayout: {} };
    }

    const traces: any[] = [];
    const maxGlobalIntensity = Math.max(
      ...visibleDatasets.map((d) => Math.max(...(d.analysisResult?.series.intensity || [1])))
    );

    visibleDatasets.forEach((d, idx) => {
      const res = d.analysisResult!;
      const tt = res.series.twoTheta;
      const baseIntensity = isNormalized
        ? res.series.normalizedIntensity
        : res.series.intensity;

      // Vertical offset in waterfall mode
      let yShift = 0;
      if (viewMode === "waterfall") {
        const offsetStep = isNormalized ? waterfallOffsetPct : (maxGlobalIntensity * (waterfallOffsetPct / 100));
        // Stack bottom to top
        yShift = idx * offsetStep;
      }

      const shiftedY = baseIntensity.map((y) => +(y + yShift).toFixed(2));

      traces.push({
        x: tt,
        y: shiftedY,
        type: "scatter",
        mode: "lines",
        name: `${d.sampleName} (${d.specimenOrCondition})`,
        line: { color: d.color, width: 2.0 },
        hoverinfo: "x+y+name",
        hovertemplate: `<b>${d.sampleName} [${d.specimenOrCondition}]</b><br>2θ: %{x:.2f}°<br>강도: %{y:.1f}${isNormalized ? "%" : " a.u."}<extra></extra>`,
      });
    });

    const layout = {
      title: false,
      height: 480,
      margin: { l: 65, r: 25, t: 25, b: 50 },
      xaxis: {
        title: { text: "회절각 2θ (도, Degree)", font: { size: 13, color: "#333D4B" } },
        showgrid: true,
        gridcolor: "#F2F4F6",
        zeroline: false,
      },
      yaxis: {
        title: {
          text: isNormalized
            ? viewMode === "waterfall"
              ? "정규화 강도 + 스택 오프셋 (Normalized Stacking %)"
              : "정규화 회절 강도 (Normalized Intensity %)"
            : viewMode === "waterfall"
            ? "회절 강도 + 수직 오프셋 (Stacked Intensity a.u.)"
            : "회절 강도 (Intensity a.u.)",
          font: { size: 13, color: "#333D4B" },
        },
        showgrid: true,
        gridcolor: "#F2F4F6",
        zeroline: false,
      },
      legend: {
        orientation: "h",
        x: 0,
        y: 1.14,
        font: { size: 12, color: "#333D4B" },
      },
      hovermode: "closest",
    };

    return { plotData: traces, plotLayout: layout };
  }, [visibleDatasets, viewMode, isNormalized, waterfallOffsetPct]);

  // 2. Peak Tracking Across Visible Datasets (Detect Shift Δ2θ relative to first dataset)
  const peakTrackingData = useMemo(() => {
    if (visibleDatasets.length === 0) return [];

    const baselineDataset = visibleDatasets[0];
    const basePeaks = baselineDataset.analysisResult?.peaks || [];

    // For top 4 major peaks in the baseline
    const trackedPeaks = basePeaks.slice(0, 4).map((baseP) => {
      const matchEntries = visibleDatasets.map((d) => {
        const peaks = d.analysisResult?.peaks || [];
        // Find closest peak within 1.0 degree
        let closest: XrdPeakInfo | null = null;
        let minDiff = Infinity;
        for (const p of peaks) {
          const diff = Math.abs(p.twoTheta - baseP.twoTheta);
          if (diff < minDiff && diff < 1.0) {
            minDiff = diff;
            closest = p;
          }
        }
        const shift = closest ? +(closest.twoTheta - baseP.twoTheta).toFixed(3) : 0;
        return {
          datasetId: d.id,
          sampleName: d.sampleName,
          condition: d.specimenOrCondition,
          color: d.color,
          peak: closest || baseP,
          shift,
        };
      });

      return {
        basePeakId: baseP.peakId,
        refTwoTheta: baseP.twoTheta,
        phaseName: baseP.phaseName || "주 피크",
        entries: matchEntries,
      };
    });

    return trackedPeaks;
  }, [visibleDatasets]);

  // 3. Phase Fraction Stacked Bar Chart Data
  const phaseBarChartData = useMemo(() => {
    if (visibleDatasets.length === 0) return { traces: [], layout: {} };

    // Collect all distinct phase names across datasets
    const phaseNamesSet = new Set<string>();
    visibleDatasets.forEach((d) => {
      (d.analysisResult?.phases || []).forEach((p) => phaseNamesSet.add(p.phaseName));
    });
    const phaseNames = Array.from(phaseNamesSet);

    // Color mapping for phases
    const phaseColors: Record<string, string> = {
      "Rutile (TiO2)": "#3182F6",
      "Anatase (TiO2)": "#10B981",
      "Brookite": "#F59E0B",
      "Silicon (Si)": "#8B5CF6",
    };

    const xLabels = visibleDatasets.map((d) => `${d.sampleName}\n(${d.specimenOrCondition})`);

    const traces = phaseNames.map((pName, pIdx) => {
      const yFractions = visibleDatasets.map((d) => {
        const ph = d.analysisResult?.phases?.find((p) => p.phaseName === pName);
        return ph ? ph.fractionPct : 0;
      });

      const fallbackColor = ["#3182F6", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899"][pIdx % 5];
      const color = phaseColors[pName] || fallbackColor;

      return {
        x: xLabels,
        y: yFractions,
        name: pName,
        type: "bar",
        marker: { color },
        hovertemplate: `<b>${pName}</b><br>상분율: %{y:.1f}%<extra></extra>`,
      };
    });

    const layout = {
      barmode: "stack",
      height: 340,
      margin: { l: 50, r: 25, t: 25, b: 55 },
      yaxis: {
        title: { text: "결정상 분율 (Phase Fraction %)", font: { size: 12, color: "#333D4B" } },
        range: [0, 100],
        gridcolor: "#F2F4F6",
      },
      legend: {
        orientation: "h",
        x: 0,
        y: 1.15,
        font: { size: 12 },
      },
    };

    return { traces, layout };
  }, [visibleDatasets]);

  if (visibleDatasets.length === 0) {
    return (
      <Card className="py-12 text-center text-[#6B7684]">
        비교할 활성 XRD 데이터셋이 없습니다. 상단에서 파일을 추가하거나 눈 아이콘을 활성화해 주세요.
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Chart Control Toolbar */}
      <Card className="p-4 sm:p-5">
        <div className="flex items-center justify-between flex-wrap gap-4">
          {/* Mode Switcher: Overlay vs Waterfall */}
          <div className="flex items-center gap-1 p-1 bg-[#F2F4F6] rounded-[12px] border border-[#E5E8EB]">
            <button
              type="button"
              onClick={() => setViewMode("overlay")}
              className={`px-3 py-1.5 rounded-[9px] text-[13px] font-semibold transition-all ${
                viewMode === "overlay"
                  ? "bg-white text-[#191F28] shadow-sm font-bold"
                  : "text-[#6B7684] hover:text-[#191F28]"
              }`}
            >
              중첩 모드 (Overlay View)
            </button>
            <button
              type="button"
              onClick={() => setViewMode("waterfall")}
              className={`px-3 py-1.5 rounded-[9px] text-[13px] font-semibold transition-all ${
                viewMode === "waterfall"
                  ? "bg-white text-[#191F28] shadow-sm font-bold"
                  : "text-[#6B7684] hover:text-[#191F28]"
              }`}
            >
              폭포수 모드 (Waterfall View)
            </button>
          </div>

          <div className="flex items-center gap-5 flex-wrap">
            {/* Normalization Toggle */}
            <label className="flex items-center gap-2 text-[13px] font-semibold text-[#333D4B] cursor-pointer">
              <input
                type="checkbox"
                checked={isNormalized}
                onChange={(e) => setIsNormalized(e.target.checked)}
                className="w-4 h-4 text-[#3182F6] rounded border-[#D1D6DB] focus:ring-0 cursor-pointer"
              />
              <span>강도 정규화 (Normalization 0~100%)</span>
            </label>

            {/* Waterfall Offset Slider (visible only in waterfall mode) */}
            {viewMode === "waterfall" && (
              <div className="flex items-center gap-2 bg-[#F9FAFB] px-3 py-1 rounded-[10px] border border-[#E5E8EB]">
                <span className="text-[12px] font-bold text-[#4E5968] flex items-center gap-1">
                  <Sliders className="w-3.5 h-3.5 text-[#3182F6]" />
                  수직 오프셋: {waterfallOffsetPct}%
                </span>
                <input
                  type="range"
                  min="15"
                  max="120"
                  step="5"
                  value={waterfallOffsetPct}
                  onChange={(e) => setWaterfallOffsetPct(Number(e.target.value))}
                  className="w-24 h-1.5 bg-[#E5E8EB] rounded-lg appearance-none cursor-pointer accent-[#3182F6]"
                />
              </div>
            )}
          </div>
        </div>

        {/* Main Multi-Spectrum Plotly Diffractogram */}
        <div className="mt-4 border border-[#E5E8EB] rounded-[16px] bg-white p-2">
          <PlotlyChart data={plotData} layout={plotLayout} height={500} />
        </div>
      </Card>

      {/* Analytical Tab Switcher */}
      <div className="flex items-center gap-2 border-b border-[#E5E8EB] pb-2">
        <button
          type="button"
          onClick={() => setActiveBottomTab("peaks")}
          className={`flex items-center gap-2 px-4 py-2 rounded-[10px] text-[14px] font-bold transition-all ${
            activeBottomTab === "peaks"
              ? "bg-[#3182F6] text-white shadow-sm"
              : "text-[#6B7684] hover:bg-[#F2F4F6] hover:text-[#191F28]"
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          다중 피크 추적 및 이동 비교 (Peak Tracking)
        </button>

        <button
          type="button"
          onClick={() => setActiveBottomTab("phase_fraction")}
          className={`flex items-center gap-2 px-4 py-2 rounded-[10px] text-[14px] font-bold transition-all ${
            activeBottomTab === "phase_fraction"
              ? "bg-[#3182F6] text-white shadow-sm"
              : "text-[#6B7684] hover:bg-[#F2F4F6] hover:text-[#191F28]"
          }`}
        >
          <BarChart2 className="w-4 h-4" />
          결정상 분율 변화 비교 (Phase Fraction %)
        </button>

        <button
          type="button"
          onClick={() => setActiveBottomTab("crystallite")}
          className={`flex items-center gap-2 px-4 py-2 rounded-[10px] text-[14px] font-bold transition-all ${
            activeBottomTab === "crystallite"
              ? "bg-[#3182F6] text-white shadow-sm"
              : "text-[#6B7684] hover:bg-[#F2F4F6] hover:text-[#191F28]"
          }`}
        >
          <Table className="w-4 h-4" />
          Scherrer 결정립 크기 & FWHM 통계표
        </button>
      </div>

      {/* Tab 1: Peak Tracking & Shift Analysis */}
      {activeBottomTab === "peaks" && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-[16px] font-bold text-[#191F28] flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-[#3182F6]" />
                시료 간 주 회절 피크 위치 이동(Peak Shift, Δ2θ) 및 격자 변형 분석
              </h3>
              <p className="text-[13px] text-[#6B7684] mt-0.5">
                기준 시편({visibleDatasets[0]?.sampleName} {visibleDatasets[0]?.specimenOrCondition}) 대비 회절각 이동량(Δ2θ)을 추적하여 고용체 도핑 또는 내부 잔류응력 상태를 진단합니다.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {peakTrackingData.map((tp, idx) => (
              <div key={idx} className="border border-[#E5E8EB] rounded-[14px] p-4 bg-[#F8F9FA] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[14px] text-[#191F28]">
                    {tp.phaseName} (기준 2θ = {tp.refTwoTheta.toFixed(2)}°)
                  </span>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-[#EFF6FF] text-[#2563EB]">
                    피크 #{idx + 1}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-[12px] text-left">
                    <thead className="text-[#6B7684] border-b border-[#E5E8EB]">
                      <tr>
                        <th className="py-1">시료/조건</th>
                        <th className="py-1 text-right">피크 위치(2θ)</th>
                        <th className="py-1 text-right">이동량(Δ2θ)</th>
                        <th className="py-1 text-right">FWHM</th>
                        <th className="py-1 text-right">결정립 크기</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E5E8EB]">
                      {tp.entries.map((ent, eIdx) => (
                        <tr key={eIdx}>
                          <td className="py-1.5 font-medium flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: ent.color }} />
                            {ent.sampleName} ({ent.condition})
                          </td>
                          <td className="py-1.5 text-right font-mono">{ent.peak.twoTheta.toFixed(3)}°</td>
                          <td className={`py-1.5 text-right font-mono font-bold ${
                            ent.shift > 0 ? "text-[#2563EB]" : ent.shift < 0 ? "text-[#E11D48]" : "text-[#6B7684]"
                          }`}>
                            {ent.shift > 0 ? `+${ent.shift.toFixed(3)}°` : `${ent.shift.toFixed(3)}°`}
                          </td>
                          <td className="py-1.5 text-right font-mono">{ent.peak.fwhm.toFixed(3)}°</td>
                          <td className="py-1.5 text-right font-mono">{ent.peak.crystalliteSizeNm.toFixed(1)} nm</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Tab 2: Phase Fraction Evolution (Stacked Bar Chart) */}
      {activeBottomTab === "phase_fraction" && (
        <Card className="p-6 space-y-4">
          <div>
            <h3 className="text-[16px] font-bold text-[#191F28] flex items-center gap-2">
              <BarChart2 className="w-5 h-5 text-[#3182F6]" />
              조건별 결정상(Phase) 분율 변화 (누적 막대 차트)
            </h3>
            <p className="text-[13px] text-[#6B7684] mt-0.5">
              열처리 온도 또는 합성 조건에 따른 결정상(Anatase, Rutile 등)의 상전이 거동 및 분율 변화를 정량적으로 비교합니다.
            </p>
          </div>

          <div className="border border-[#E5E8EB] rounded-[16px] p-2 bg-white">
            <PlotlyChart data={phaseBarChartData.traces} layout={phaseBarChartData.layout} height={340} />
          </div>
        </Card>
      )}

      {/* Tab 3: Scherrer Crystallite Size Summary Table */}
      {activeBottomTab === "crystallite" && (
        <Card className="p-6 space-y-4">
          <div>
            <h3 className="text-[16px] font-bold text-[#191F28] flex items-center gap-2">
              <Table className="w-5 h-5 text-[#3182F6]" />
              시료별 Scherrer 결정립 크기(Crystallite Size) 및 평균 통계표
            </h3>
            <p className="text-[13px] text-[#6B7684] mt-0.5">
              공식 D = (K·λ) / (β·cosθ) (Cu-Kα λ=0.15406 nm, Scherrer 상수 K=0.94) 기반 각 시편의 평균 결정자 크기를 산출합니다.
            </p>
          </div>

          <div className="overflow-x-auto border border-[#E5E8EB] rounded-[14px]">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-[#F8F9FA] border-b border-[#E5E8EB] text-[#4E5968] font-semibold">
                <tr>
                  <th className="py-2.5 px-3">시료명 (Sample)</th>
                  <th className="py-2.5 px-3">조건 (Condition)</th>
                  <th className="py-2.5 px-3 text-center">검출 피크 수</th>
                  <th className="py-2.5 px-3 text-right">주 피크 반치폭 (FWHM)</th>
                  <th className="py-2.5 px-3 text-right">평균 결정립 크기 (D)</th>
                  <th className="py-2.5 px-3">주요 구성 상 (Phases)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E8EB]">
                {visibleDatasets.map((d) => {
                  const res = d.analysisResult;
                  const mainPeak = res?.peaks?.[0];
                  return (
                    <tr key={d.id} className="hover:bg-[#F9FAFB]">
                      <td className="py-2.5 px-3 font-semibold text-[#191F28] flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: d.color }} />
                        {d.sampleName}
                      </td>
                      <td className="py-2.5 px-3 text-[#4E5968] font-medium">{d.specimenOrCondition}</td>
                      <td className="py-2.5 px-3 text-center font-mono">{res?.peaks?.length || 0}개</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-[#191F28]">
                        {mainPeak ? `${mainPeak.fwhm.toFixed(3)}°` : "-"}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-[#2563EB]">
                        {res?.meanCrystalliteSizeNm ? `${res.meanCrystalliteSizeNm.toFixed(1)} nm` : "-"}
                      </td>
                      <td className="py-2.5 px-3 text-[#4E5968]">
                        {(res?.phases || []).map((p) => `${p.phaseName} (${p.fractionPct.toFixed(0)}%)`).join(", ") || "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
