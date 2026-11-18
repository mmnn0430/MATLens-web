import { useMemo, useState } from "react";
import {
  Activity,
  Table,
  CheckCircle2,
  Eye,
  EyeOff,
  Info,
} from "lucide-react";
import type {
  UniversalDataset,
  UtmBatchAnalysisResult,
} from "../../core/batch/types";
import { UtmCanvasPlotter } from "./UtmCanvasPlotter";
import { Card } from "../ui/primitives";

interface UtmBatchComparisonViewProps {
  datasets: UniversalDataset<any, UtmBatchAnalysisResult>[];
  onToggleVisible: (id: string) => void;
}

export function UtmBatchComparisonView({
  datasets,
  onToggleVisible,
}: UtmBatchComparisonViewProps) {
  const [chartMode, setChartMode] = useState<"stress_strain" | "load_disp">("stress_strain");
  const [showMeanCurve, setShowMeanCurve] = useState<boolean>(true);
  const [showStdDevBand, setShowStdDevBand] = useState<boolean>(true);

  const visibleDatasets = useMemo(
    () => datasets.filter((d) => d.visible && d.status === "success" && d.analysisResult),
    [datasets]
  );

  // Compute Summary Statistics (Mean, Std Dev, CV%) across visible specimens
  const summaryStats = useMemo(() => {
    if (visibleDatasets.length === 0) return null;

    const metricsList = visibleDatasets.map((d) => d.analysisResult!.metrics);
    const n = metricsList.length;

    const computeCol = (getter: (m: typeof metricsList[0]) => number) => {
      const vals = metricsList.map(getter).filter((v) => !isNaN(v) && v > 0);
      if (vals.length === 0) return { mean: 0, std: 0, cv: 0, count: 0 };
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const variance =
        vals.length > 1
          ? vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (vals.length - 1)
          : 0;
      const std = Math.sqrt(variance);
      const cv = mean > 0 ? (std / mean) * 100 : 0;
      return {
        mean: +mean.toFixed(2),
        std: +std.toFixed(2),
        cv: +cv.toFixed(2),
        count: vals.length,
      };
    };

    return {
      uts: computeCol((m) => m.utsMpa),
      yieldStrength: computeCol((m) => m.yieldStrengthMpa),
      elasticModulus: computeCol((m) => m.elasticModulusGpa),
      elongation: computeCol((m) => m.elongationPct),
      totalSpecimens: n,
    };
  }, [visibleDatasets]);

  if (datasets.length === 0) {
    return (
      <Card className="py-12 text-center text-[#6B7684]">
        업로드된 UTM 시험 데이터가 없습니다. 상단에서 인장시험 파일을 업로드해 주세요.
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Interactive 2D Canvas Plotter Card */}
      <Card className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <h3 className="text-[16px] font-bold text-[#191F28] flex items-center gap-2">
              <Activity className="w-5 h-5 text-[#3182F6]" />
              다중 곡선 중첩 플로터 (Multi-Specimen Canvas 2D)
            </h3>
            <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full bg-[#E5E8EB] text-[#4E5968]">
              {visibleDatasets.length}개 시편 렌더링 중
            </span>
          </div>

          {/* Controls: Chart Mode Switcher & Overlays */}
          <div className="flex items-center gap-4 flex-wrap">
            {/* Chart mode */}
            <div className="flex items-center p-0.5 rounded-[10px] bg-[#F2F4F6] border border-[#E5E8EB]">
              <button
                type="button"
                onClick={() => setChartMode("stress_strain")}
                className={`px-3 py-1 rounded-[8px] text-[12px] font-semibold transition-all ${
                  chartMode === "stress_strain"
                    ? "bg-white text-[#191F28] shadow-xs font-bold"
                    : "text-[#6B7684] hover:text-[#191F28]"
                }`}
              >
                응력-변형률 (S-S)
              </button>
              <button
                type="button"
                onClick={() => setChartMode("load_disp")}
                className={`px-3 py-1 rounded-[8px] text-[12px] font-semibold transition-all ${
                  chartMode === "load_disp"
                    ? "bg-white text-[#191F28] shadow-xs font-bold"
                    : "text-[#6B7684] hover:text-[#191F28]"
                }`}
              >
                하중-변위 (Load-Disp)
              </button>
            </div>

            {/* Overlays */}
            <label className="flex items-center gap-1.5 text-[12px] font-semibold text-[#333D4B] cursor-pointer">
              <input
                type="checkbox"
                checked={showMeanCurve}
                onChange={(e) => setShowMeanCurve(e.target.checked)}
                className="w-3.5 h-3.5 text-[#3182F6] rounded border-[#D1D6DB] focus:ring-0 cursor-pointer"
              />
              <span>대표 평균 곡선 (Mean)</span>
            </label>

            <label className="flex items-center gap-1.5 text-[12px] font-semibold text-[#333D4B] cursor-pointer">
              <input
                type="checkbox"
                checked={showStdDevBand}
                onChange={(e) => setShowStdDevBand(e.target.checked)}
                className="w-3.5 h-3.5 text-[#3182F6] rounded border-[#D1D6DB] focus:ring-0 cursor-pointer"
              />
              <span>±1σ 음영 밴드 (Std Dev)</span>
            </label>
          </div>
        </div>

        {/* Canvas Plotter */}
        <div className="border border-[#E5E8EB] rounded-[16px] bg-white p-2">
          <UtmCanvasPlotter
            datasets={datasets}
            chartMode={chartMode}
            showMeanCurve={showMeanCurve}
            showStdDevBand={showStdDevBand}
            onToggleVisible={onToggleVisible}
            height={460}
          />
        </div>

        {/* Interactive Legend with Eye Toggle */}
        <div className="flex items-center flex-wrap gap-2 pt-2 border-t border-[#F2F4F6]">
          <span className="text-[12px] font-bold text-[#6B7684] mr-1">범례 (클릭하여 개별 토글):</span>
          {datasets.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => onToggleVisible(d.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[10px] text-[12px] font-semibold transition-all border ${
                d.visible
                  ? "bg-white border-[#D1D6DB] text-[#191F28] shadow-xs"
                  : "bg-[#F2F4F6] border-transparent text-[#8B95A1] opacity-60"
              }`}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: d.visible ? d.color : "#9CA3AF" }}
              />
              <span className="truncate max-w-[140px]">
                {d.sampleName} ({d.specimenOrCondition})
              </span>
              {d.visible ? (
                <Eye className="w-3.5 h-3.5 text-[#3182F6] ml-0.5" />
              ) : (
                <EyeOff className="w-3.5 h-3.5 text-[#9CA3AF] ml-0.5" />
              )}
            </button>
          ))}
          {showMeanCurve && visibleDatasets.length >= 2 && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-[10px] text-[12px] font-bold bg-[#1E293B] text-white">
              <span className="w-3 h-0.5 bg-white inline-block border-t border-dashed" />
              대표 평균 곡선 (Mean)
            </span>
          )}
        </div>
      </Card>

      {/* Summary Statistics Table */}
      <Card className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[16px] font-bold text-[#191F28] flex items-center gap-2">
              <Table className="w-5 h-5 text-[#3182F6]" />
              반복 시험 집계 통계표 (Summary Statistics)
            </h3>
            <p className="text-[13px] text-[#6B7684] mt-0.5">
              동일 시료의 반복 측정 시편별 핵심 인장 물성값 및 전체 시편의 평균(Mean), 표준편차(±1σ), 변동계수(CV%)를 자동으로 산출합니다.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto border border-[#E5E8EB] rounded-[14px]">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-[#F8F9FA] border-b border-[#E5E8EB] text-[#4E5968] font-semibold">
              <tr>
                <th className="py-2.5 px-3">시료명 (Sample)</th>
                <th className="py-2.5 px-3">시편 번호 (Condition)</th>
                <th className="py-2.5 px-3 text-right">최대인장강도 UTS (MPa)</th>
                <th className="py-2.5 px-3 text-right">0.2% 항복강도 (MPa)</th>
                <th className="py-2.5 px-3 text-right">탄성계수 E (GPa)</th>
                <th className="py-2.5 px-3 text-right">파단연신율 (%)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E8EB]">
              {visibleDatasets.map((d) => {
                const m = d.analysisResult?.metrics;
                return (
                  <tr key={d.id} className="hover:bg-[#F9FAFB] transition-colors">
                    <td className="py-2.5 px-3 font-semibold text-[#191F28] flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: d.color }} />
                      {d.sampleName}
                    </td>
                    <td className="py-2.5 px-3 text-[#4E5968] font-medium">{d.specimenOrCondition}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-[#191F28]">
                      {m?.utsMpa ? m.utsMpa.toFixed(2) : "-"}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-[#333D4B]">
                      {m?.yieldStrengthMpa ? m.yieldStrengthMpa.toFixed(2) : "-"}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-[#333D4B]">
                      {m?.elasticModulusGpa ? m.elasticModulusGpa.toFixed(2) : "-"}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-[#333D4B]">
                      {m?.elongationPct ? `${m.elongationPct.toFixed(2)}%` : "-"}
                    </td>
                  </tr>
                );
              })}

              {/* Bottom Aggregated Summary Rows */}
              {summaryStats && summaryStats.totalSpecimens >= 2 && (
                <>
                  {/* Mean Row */}
                  <tr className="bg-[#F0F7FF] font-bold text-[#191F28] border-t-2 border-[#3182F6]">
                    <td className="py-2.5 px-3 text-[#2563EB] flex items-center gap-1.5" colSpan={2}>
                      <CheckCircle2 className="w-4 h-4 text-[#2563EB]" />
                      평균값 (Mean, N={summaryStats.totalSpecimens})
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-[#2563EB]">
                      {summaryStats.uts.mean.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-[#2563EB]">
                      {summaryStats.yieldStrength.mean.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-[#2563EB]">
                      {summaryStats.elasticModulus.mean.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-[#2563EB]">
                      {summaryStats.elongation.mean.toFixed(2)}%
                    </td>
                  </tr>

                  {/* Std Dev Row */}
                  <tr className="bg-[#F8FAFC] font-semibold text-[#475569]">
                    <td className="py-2 px-3" colSpan={2}>
                      표준편차 (Std Dev, ±1σ)
                    </td>
                    <td className="py-2 px-3 text-right font-mono">
                      ±{summaryStats.uts.std.toFixed(2)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono">
                      ±{summaryStats.yieldStrength.std.toFixed(2)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono">
                      ±{summaryStats.elasticModulus.std.toFixed(2)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono">
                      ±{summaryStats.elongation.std.toFixed(2)}%
                    </td>
                  </tr>

                  {/* CV% Row */}
                  <tr className="bg-[#FFFBEB] font-bold text-[#92400E]">
                    <td className="py-2 px-3 flex items-center gap-1.5" colSpan={2}>
                      <Info className="w-3.5 h-3.5 text-[#D97706]" />
                      변동계수 (CV% = σ/μ × 100)
                    </td>
                    <td className="py-2 px-3 text-right font-mono">
                      <span className={`px-2 py-0.5 rounded-md text-[11px] ${
                        summaryStats.uts.cv <= 5
                          ? "bg-[#DCFCE7] text-[#16A34A]"
                          : summaryStats.uts.cv <= 10
                          ? "bg-[#FEF3C7] text-[#D97706]"
                          : "bg-[#FEE2E2] text-[#DC2626]"
                      }`}>
                        {summaryStats.uts.cv.toFixed(2)}%
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right font-mono">
                      <span className={`px-2 py-0.5 rounded-md text-[11px] ${
                        summaryStats.yieldStrength.cv <= 5
                          ? "bg-[#DCFCE7] text-[#16A34A]"
                          : "bg-[#FEF3C7] text-[#D97706]"
                      }`}>
                        {summaryStats.yieldStrength.cv.toFixed(2)}%
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right font-mono">
                      <span className="px-2 py-0.5 rounded-md text-[11px] bg-[#FEF3C7] text-[#D97706]">
                        {summaryStats.elasticModulus.cv.toFixed(2)}%
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right font-mono">
                      <span className="px-2 py-0.5 rounded-md text-[11px] bg-[#FEF3C7] text-[#D97706]">
                        {summaryStats.elongation.cv.toFixed(2)}%
                      </span>
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
