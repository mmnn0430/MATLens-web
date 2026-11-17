import { useMemo, useState } from "react";
import {
  Microscope,
  Columns2,
  Columns3,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import type {
  SemBatchAnalysisResult,
  UniversalDataset,
} from "../../core/batch/types";
import { PlotlyChart } from "../PlotlyChart";
import { Card } from "../ui/primitives";

interface SemBatchComparisonViewProps {
  datasets: UniversalDataset<any, SemBatchAnalysisResult>[];
}

export function SemBatchComparisonView({ datasets }: SemBatchComparisonViewProps) {
  // Grid layout column selection: 2 columns or 3 columns
  const [gridCols, setGridCols] = useState<2 | 3>(2);
  // View mode for each card: "micrograph" | "histogram" | "both"
  const [cardDisplayMode, setCardDisplayMode] = useState<"both" | "image_only" | "hist_only">("both");

  const visibleDatasets = useMemo(
    () => datasets.filter((d) => d.visible && d.status === "success" && d.analysisResult),
    [datasets]
  );

  // -------------------------------------------------------------------
  // Scale Validation Algorithm (Check if scales match within ±5%)
  // -------------------------------------------------------------------
  const scaleCheck = useMemo(() => {
    if (visibleDatasets.length < 2) {
      return { isMatched: true, message: null, maxDevPct: 0 };
    }

    const scales = visibleDatasets.map((d) => d.analysisResult!.scale.pxPerUnit);
    const units = visibleDatasets.map((d) => d.analysisResult!.scale.unit);

    // If units differ (e.g. nm vs µm)
    const firstUnit = units[0];
    if (units.some((u) => u !== firstUnit)) {
      return {
        isMatched: false,
        message: "시편 간 스케일 단위(Unit)가 상이하여 통합 풀링(Pooled) 통계를 생성할 수 없습니다.",
        maxDevPct: 100,
      };
    }

    const minScale = Math.min(...scales);
    const maxScale = Math.max(...scales);
    const maxDevPct = minScale > 0 ? ((maxScale - minScale) / minScale) * 100 : 0;

    if (maxDevPct <= 5.0) {
      return {
        isMatched: true,
        message: `모든 시편의 스케일/배율 편차가 ${maxDevPct.toFixed(1)}% 이내(±5% 기준 충족)로 일치하여 신뢰성 있는 통합 풀링 통계가 산출되었습니다.`,
        maxDevPct,
      };
    } else {
      return {
        isMatched: false,
        message: `업로드된 시편 간 배율/스케일(nm/px) 편차가 ${maxDevPct.toFixed(1)}%로 허용치(5%)를 초과합니다. 측정 오차를 방지하기 위해 개별 비교 모드만 유지됩니다.`,
        maxDevPct,
      };
    }
  }, [visibleDatasets]);

  // -------------------------------------------------------------------
  // Pooled Statistics across all particles from matching specimens
  // -------------------------------------------------------------------
  const pooledStats = useMemo(() => {
    if (!scaleCheck.isMatched || visibleDatasets.length < 2) return null;

    const allObjects = visibleDatasets.flatMap((d) => d.analysisResult!.objects);
    if (allObjects.length === 0) return null;

    const diameters = allObjects.map((o) => o.equivalentDiameter).sort((a, b) => a - b);
    const n = diameters.length;
    const d10 = diameters[Math.floor(n * 0.1)] || 0;
    const d50 = diameters[Math.floor(n * 0.5)] || 0;
    const d90 = diameters[Math.floor(n * 0.9)] || 0;
    const mean = diameters.reduce((a, b) => a + b, 0) / n;
    const variance = diameters.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (n - 1);
    const stdDev = Math.sqrt(variance);

    // Cumulative distribution curve for Plotly
    const cumProb = diameters.map((_, i) => +(((i + 1) / n) * 100).toFixed(1));

    return {
      d10: +d10.toFixed(1),
      d50: +d50.toFixed(1),
      d90: +d90.toFixed(1),
      mean: +mean.toFixed(1),
      stdDev: +stdDev.toFixed(1),
      totalParticles: n,
      unit: visibleDatasets[0].analysisResult!.scale.unit,
      diameters,
      cumProb,
    };
  }, [visibleDatasets, scaleCheck]);

  // Cumulative Plotly Chart Trace
  const pooledPlot = useMemo(() => {
    if (!pooledStats) return { data: [], layout: {} };

    const data = [
      {
        x: pooledStats.diameters,
        y: pooledStats.cumProb,
        type: "scatter",
        mode: "lines",
        name: `통합 누적 입도 분포 (N=${pooledStats.totalParticles})`,
        line: { color: "#3182F6", width: 2.5 },
        hovertemplate: `입경: %{x:.1f} ${pooledStats.unit}<br>누적 분율: %{y:.1f}%<extra></extra>`,
      },
    ];

    const layout = {
      title: false,
      height: 280,
      margin: { l: 50, r: 20, t: 20, b: 45 },
      xaxis: {
        title: { text: `입자 직경 (${pooledStats.unit})`, font: { size: 12 } },
        gridcolor: "#F2F4F6",
      },
      yaxis: {
        title: { text: "누적 체적/개수 백분율 (%)", font: { size: 12 } },
        range: [0, 100],
        gridcolor: "#F2F4F6",
      },
    };

    return { data, layout };
  }, [pooledStats]);

  if (visibleDatasets.length === 0) {
    return (
      <Card className="py-12 text-center text-[#6B7684]">
        비교할 활성 SEM 이미지 데이터셋이 없습니다. 상단에서 이미지를 업로드해 주세요.
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* View Toolbar */}
      <Card className="p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Microscope className="w-5 h-5 text-[#3182F6]" />
          <span className="font-bold text-[15px] text-[#191F28]">
            SEM 다중 이미지 나란히 비교 (Side-by-Side View)
          </span>
          <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full bg-[#E5E8EB] text-[#4E5968]">
            {visibleDatasets.length}개 시편 표시 중
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Display Mode */}
          <div className="flex items-center p-0.5 rounded-[10px] bg-[#F2F4F6] border border-[#E5E8EB]">
            <button
              type="button"
              onClick={() => setCardDisplayMode("both")}
              className={`px-2.5 py-1 text-[12px] font-semibold rounded-[8px] transition-all ${
                cardDisplayMode === "both"
                  ? "bg-white text-[#191F28] shadow-xs font-bold"
                  : "text-[#6B7684] hover:text-[#191F28]"
              }`}
            >
              전체 (이미지+차트)
            </button>
            <button
              type="button"
              onClick={() => setCardDisplayMode("image_only")}
              className={`px-2.5 py-1 text-[12px] font-semibold rounded-[8px] transition-all ${
                cardDisplayMode === "image_only"
                  ? "bg-white text-[#191F28] shadow-xs font-bold"
                  : "text-[#6B7684] hover:text-[#191F28]"
              }`}
            >
              미세조직 중심
            </button>
            <button
              type="button"
              onClick={() => setCardDisplayMode("hist_only")}
              className={`px-2.5 py-1 text-[12px] font-semibold rounded-[8px] transition-all ${
                cardDisplayMode === "hist_only"
                  ? "bg-white text-[#191F28] shadow-xs font-bold"
                  : "text-[#6B7684] hover:text-[#191F28]"
              }`}
            >
              히스토그램 중심
            </button>
          </div>

          {/* Grid column selector */}
          <div className="flex items-center gap-1 bg-[#F2F4F6] p-0.5 rounded-[10px] border border-[#E5E8EB]">
            <button
              type="button"
              onClick={() => setGridCols(2)}
              title="2열 그리드"
              className={`p-1.5 rounded-[8px] transition-all ${
                gridCols === 2 ? "bg-white text-[#3182F6] shadow-xs" : "text-[#6B7684]"
              }`}
            >
              <Columns2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setGridCols(3)}
              title="3열 그리드"
              className={`p-1.5 rounded-[8px] transition-all ${
                gridCols === 3 ? "bg-white text-[#3182F6] shadow-xs" : "text-[#6B7684]"
              }`}
            >
              <Columns3 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </Card>

      {/* Scale Compatibility Alert Banner */}
      {visibleDatasets.length >= 2 && (
        <div
          className={`p-4 rounded-[16px] border flex items-start gap-3 transition-all ${
            scaleCheck.isMatched
              ? "bg-[#F0FDF4] border-[#BBF7D0] text-[#166534]"
              : "bg-[#FFFBEB] border-[#FDE68A] text-[#92400E]"
          }`}
        >
          {scaleCheck.isMatched ? (
            <CheckCircle2 className="w-5 h-5 text-[#16A34A] shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-[#D97706] shrink-0 mt-0.5" />
          )}
          <div className="space-y-0.5">
            <div className="font-bold text-[14px]">
              {scaleCheck.isMatched
                ? "스케일 일치 확인 완료 (조건부 풀링 통계 활성화)"
                : "스케일/배율 편차 감지 (통합 풀링 통계 비활성화)"}
            </div>
            <p className="text-[13px] leading-relaxed opacity-90">{scaleCheck.message}</p>
          </div>
        </div>
      )}

      {/* Pooled Statistics Panel (When scales match) */}
      {pooledStats && (
        <Card className="p-5 sm:p-6 bg-[#F8FAFC] border-2 border-[#3182F6]/30 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[16px] font-bold text-[#191F28] flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[#3182F6]" />
              전체 시편 통합 풀링 통계 (Pooled Particle Statistics)
            </h3>
            <span className="text-[12px] font-bold px-2.5 py-1 rounded-full bg-[#EBF4FF] text-[#2563EB]">
              총합 {pooledStats.totalParticles}개 입자 합산
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 bg-white rounded-[12px] border border-[#E2E8F0]">
              <div className="text-[11px] font-medium text-[#64748B]">통합 D10</div>
              <div className="text-[18px] font-bold text-[#1E293B]">
                {pooledStats.d10} <span className="text-[12px] font-normal">{pooledStats.unit}</span>
              </div>
            </div>
            <div className="p-3 bg-white rounded-[12px] border border-[#3182F6]/40 shadow-xs">
              <div className="text-[11px] font-bold text-[#2563EB]">통합 D50 (중앙값)</div>
              <div className="text-[18px] font-bold text-[#2563EB]">
                {pooledStats.d50} <span className="text-[12px] font-normal">{pooledStats.unit}</span>
              </div>
            </div>
            <div className="p-3 bg-white rounded-[12px] border border-[#E2E8F0]">
              <div className="text-[11px] font-medium text-[#64748B]">통합 D90</div>
              <div className="text-[18px] font-bold text-[#1E293B]">
                {pooledStats.d90} <span className="text-[12px] font-normal">{pooledStats.unit}</span>
              </div>
            </div>
            <div className="p-3 bg-white rounded-[12px] border border-[#E2E8F0]">
              <div className="text-[11px] font-medium text-[#64748B]">통합 평균 ± 표준편차</div>
              <div className="text-[18px] font-bold text-[#1E293B]">
                {pooledStats.mean} <span className="text-[12px] font-normal">± {pooledStats.stdDev}</span>
              </div>
            </div>
          </div>

          <div className="border border-[#E2E8F0] rounded-[14px] bg-white p-2">
            <PlotlyChart data={pooledPlot.data} layout={pooledPlot.layout} height={260} />
          </div>
        </Card>
      )}

      {/* Side-by-Side Responsive Grid */}
      <div
        className={`grid gap-6 ${
          gridCols === 2 ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
        }`}
      >
        {visibleDatasets.map((d) => {
          const res = d.analysisResult!;
          const st = res.stats;
          const sc = res.scale;
          const h = res.histogram;

          // Build local histogram trace
          const histPlot = {
            data: [
              {
                x: h.binCenters,
                y: h.counts,
                type: "bar",
                marker: { color: d.color },
                width: h.widths,
                hovertemplate: `입경: %{x} ${h.unit}<br>개수: %{y}개<extra></extra>`,
              },
            ],
            layout: {
              height: 190,
              margin: { l: 40, r: 15, t: 15, b: 35 },
              xaxis: { title: { text: `입경 (${h.unit})`, font: { size: 10 } } },
              yaxis: { title: { text: "빈도", font: { size: 10 } } },
            },
          };

          return (
            <Card key={d.id} className="p-5 space-y-4 border border-[#E5E8EB] shadow-sm flex flex-col justify-between">
              <div className="space-y-3">
                {/* Card Header */}
                <div className="flex items-center justify-between border-b border-[#F2F4F6] pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                    <div className="font-bold text-[15px] text-[#191F28]">{d.sampleName}</div>
                  </div>
                  <span className="text-[12px] font-bold px-2 py-0.5 rounded-md bg-[#EFF6FF] text-[#2563EB]">
                    {d.specimenOrCondition}
                  </span>
                </div>

                {/* Independent Scalebar Badge */}
                <div className="flex items-center justify-between text-[11px] text-[#6B7684] bg-[#F8F9FA] px-2.5 py-1 rounded-[8px]">
                  <span>스케일바: <b>{sc.realValue} {sc.unit}</b> ({sc.lengthPx} px)</span>
                  <span className="font-mono">{sc.pxPerUnit.toFixed(2)} px/{sc.unit}</span>
                </div>

                {/* Micrograph Visual (Side-by-side or image) */}
                {cardDisplayMode !== "hist_only" && (
                  <div className="relative rounded-[12px] overflow-hidden bg-black aspect-4/3 flex items-center justify-center border border-[#E5E8EB]">
                    <img
                      src={res.overlayUrl || res.imageUrl}
                      alt={d.sampleName}
                      className="w-full h-full object-contain"
                    />
                    <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/75 text-white text-[10px] font-mono">
                      {d.specimenOrCondition}
                    </div>
                  </div>
                )}

                {/* Metric Summary Bar */}
                <div className="grid grid-cols-4 gap-2 text-center text-[12px]">
                  <div className="p-1.5 rounded-lg bg-[#F8F9FA] border border-[#E5E8EB]">
                    <div className="text-[10px] text-[#6B7684]">D10</div>
                    <div className="font-bold font-mono text-[#191F28]">{st.d10} {sc.unit}</div>
                  </div>
                  <div className="p-1.5 rounded-lg bg-[#EFF6FF] border border-[#BFDBFE]">
                    <div className="text-[10px] text-[#2563EB] font-bold">D50</div>
                    <div className="font-bold font-mono text-[#2563EB]">{st.d50} {sc.unit}</div>
                  </div>
                  <div className="p-1.5 rounded-lg bg-[#F8F9FA] border border-[#E5E8EB]">
                    <div className="text-[10px] text-[#6B7684]">D90</div>
                    <div className="font-bold font-mono text-[#191F28]">{st.d90} {sc.unit}</div>
                  </div>
                  <div className="p-1.5 rounded-lg bg-[#F8F9FA] border border-[#E5E8EB]">
                    <div className="text-[10px] text-[#6B7684]">입자수 N</div>
                    <div className="font-bold font-mono text-[#191F28]">{st.count}개</div>
                  </div>
                </div>

                {/* Local Histogram */}
                {cardDisplayMode !== "image_only" && (
                  <div className="border border-[#E5E8EB] rounded-[10px] p-1 bg-white">
                    <PlotlyChart data={histPlot.data} layout={histPlot.layout} height={180} />
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
