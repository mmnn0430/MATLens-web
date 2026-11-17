import { useEffect, useState } from "react";
import {
  Layers,
  Activity,
  Microscope,
  Flame,
  Binary,
  Radio,
  Sparkles,
} from "lucide-react";
import type { InstrumentType, UniversalDataset } from "../../core/batch/types";
import { getInstrumentAdapter } from "../../core/batch/adapters";
import { UniversalBatchUploader } from "./UniversalBatchUploader";
import { XrdBatchComparisonView } from "./XrdBatchComparisonView";
import { UtmBatchComparisonView } from "./UtmBatchComparisonView";
import { SemBatchComparisonView } from "./SemBatchComparisonView";
import { PlotlyChart } from "../PlotlyChart";
import { Card } from "../ui/primitives";

export function UniversalBatchPlatformView() {
  const [activeInstrument, setActiveInstrument] = useState<InstrumentType>("XRD");
  // Per-instrument datasets storage
  const [datasetsByInstrument, setDatasetsByInstrument] = useState<
    Record<InstrumentType, UniversalDataset[]>
  >({
    XRD: [],
    UTM: [],
    SEM: [],
    DSC: [],
    TGA: [],
    FTIR: [],
    LFA: [],
    GENERIC: [],
  });

  const activeDatasets = datasetsByInstrument[activeInstrument] || [];

  const handleDatasetsChange = (next: UniversalDataset[]) => {
    setDatasetsByInstrument((prev) => ({
      ...prev,
      [activeInstrument]: next,
    }));
  };

  const handleToggleVisible = (id: string) => {
    handleDatasetsChange(
      activeDatasets.map((d) => (d.id === id ? { ...d, visible: !d.visible } : d))
    );
  };

  // Pre-load default XRD samples on first mount if empty
  useEffect(() => {
    const adapter = getInstrumentAdapter("XRD");
    if (adapter.createSampleDatasets && datasetsByInstrument.XRD.length === 0) {
      adapter.createSampleDatasets().then((samples) => {
        setDatasetsByInstrument((prev) => ({
          ...prev,
          XRD: samples,
        }));
      });
    }
  }, []);

  const instrumentButtons: {
    type: InstrumentType;
    label: string;
    sub: string;
    icon: React.ReactNode;
    color: string;
  }[] = [
    {
      type: "XRD",
      label: "XRD 다중 회절 스펙트럼",
      sub: "중첩/폭포수 뷰, Δ2θ 피크 이동, 상분율(%)",
      icon: <Layers className="w-4 h-4" />,
      color: "#3182F6",
    },
    {
      type: "UTM",
      label: "UTM 인장시험 곡선",
      sub: "2D Canvas 중첩, 멀티 툴팁, Mean ± SD 통계표",
      icon: <Activity className="w-4 h-4" />,
      color: "#10B981",
    },
    {
      type: "SEM",
      label: "SEM 미세조직 이미지",
      sub: "나란히 비교, D10/D50/D90, 조건부 풀링 통계",
      icon: <Microscope className="w-4 h-4" />,
      color: "#8B5CF6",
    },
    {
      type: "DSC",
      label: "DSC 열분석 (확장)",
      sub: "유리전이/융해 엔탈피 피크 비교",
      icon: <Flame className="w-4 h-4" />,
      color: "#F59E0B",
    },
    {
      type: "TGA",
      label: "TGA 열중량분석 (확장)",
      sub: "온도별 질량 감량 곡선 비교",
      icon: <Binary className="w-4 h-4" />,
      color: "#EC4899",
    },
    {
      type: "FTIR",
      label: "FTIR 적외선분광 (확장)",
      sub: "작용기 흡수 피크 위치 비교",
      icon: <Radio className="w-4 h-4" />,
      color: "#06B6D4",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="rounded-[20px] bg-gradient-to-r from-[#1E293B] via-[#0F172A] to-[#1E3A8A] text-white p-6 sm:p-8 shadow-md">
        <div className="max-w-4xl space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-bold bg-[#3182F6]/30 text-[#93C5FD] border border-[#3182F6]/40">
            <Sparkles className="w-3.5 h-3.5" />
            Universal Batch Architecture 2.0
          </div>
          <h1 className="text-[22px] sm:text-[26px] font-extrabold tracking-tight">
            복수 데이터 일괄 분석 및 비교 플랫폼 (Batch Comparison Platform)
          </h1>
          <p className="text-[14px] text-[#94A3B8] leading-relaxed">
            단일 기기 분석을 넘어, 열처리 조건 · 시편 위치 · 반복 시험에 따른 복수 측정 데이터를 단일 화면에서
            중첩 및 정량 비교합니다. 플러그인 어댑터 패턴으로 XRD, UTM, SEM은 물론 DSC, TGA, FTIR 등 차세대 기기까지
            유연하게 수용합니다.
          </p>
        </div>

        {/* Instrument Mode Selector Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5 mt-6">
          {instrumentButtons.map((btn) => {
            const isActive = activeInstrument === btn.type;
            const count = (datasetsByInstrument[btn.type] || []).length;
            return (
              <button
                key={btn.type}
                type="button"
                onClick={() => setActiveInstrument(btn.type)}
                className={`p-3.5 rounded-[14px] text-left transition-all cursor-pointer flex flex-col justify-between border ${
                  isActive
                    ? "bg-white text-[#191F28] shadow-lg border-white scale-[1.02]"
                    : "bg-white/10 text-white/90 border-white/10 hover:bg-white/15"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span
                      className="p-1.5 rounded-lg inline-flex"
                      style={{
                        backgroundColor: isActive ? `${btn.color}20` : "rgba(255,255,255,0.15)",
                        color: isActive ? btn.color : "#FFFFFF",
                      }}
                    >
                      {btn.icon}
                    </span>
                    {count > 0 && (
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                          isActive ? "bg-[#3182F6] text-white" : "bg-white/20 text-white"
                        }`}
                      >
                        {count}개
                      </span>
                    )}
                  </div>
                  <div className="font-bold text-[13px]">{btn.label}</div>
                </div>
                <div
                  className={`text-[11px] mt-1.5 line-clamp-1 ${
                    isActive ? "text-[#6B7684]" : "text-white/60"
                  }`}
                >
                  {btn.sub}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Common Universal Batch Uploader */}
      <UniversalBatchUploader
        instrumentType={activeInstrument}
        datasets={activeDatasets}
        onDatasetsChange={handleDatasetsChange}
      />

      {/* Comparison Engine Renderers */}
      {activeInstrument === "XRD" && (
        <XrdBatchComparisonView datasets={activeDatasets} />
      )}

      {activeInstrument === "UTM" && (
        <UtmBatchComparisonView
          datasets={activeDatasets}
          onToggleVisible={handleToggleVisible}
        />
      )}

      {activeInstrument === "SEM" && (
        <SemBatchComparisonView datasets={activeDatasets} />
      )}

      {/* Generic Thermal/Spectroscopy Plotter (DSC / TGA / FTIR) */}
      {["DSC", "TGA", "FTIR", "LFA", "GENERIC"].includes(activeInstrument) && (
        <GenericBatchComparisonView
          instrumentType={activeInstrument}
          datasets={activeDatasets}
        />
      )}
    </div>
  );
}

/**
 * Generic comparison view for DSC / TGA / FTIR
 */
function GenericBatchComparisonView({
  instrumentType,
  datasets,
}: {
  instrumentType: InstrumentType;
  datasets: UniversalDataset[];
}) {
  const visibleDatasets = datasets.filter((d) => d.visible && d.analysisResult?.xValues);

  if (visibleDatasets.length === 0) {
    return (
      <Card className="py-12 text-center text-[#6B7684]">
        비교할 활성 {instrumentType} 데이터가 없습니다. 상단에서 파일을 추가하거나 샘플을 불러와 주세요.
      </Card>
    );
  }

  const firstRes = visibleDatasets[0]?.analysisResult;
  const traces = visibleDatasets.map((d) => {
    const res = d.analysisResult;
    return {
      x: res.xValues,
      y: res.yValues,
      type: "scatter",
      mode: "lines",
      name: `${d.sampleName} (${d.specimenOrCondition})`,
      line: { color: d.color, width: 2 },
      hovertemplate: `X: %{x} ${res.xUnit}<br>Y: %{y} ${res.yUnit}<extra></extra>`,
    };
  });

  const layout = {
    height: 440,
    margin: { l: 60, r: 25, t: 25, b: 50 },
    xaxis: { title: { text: `${firstRes.xLabel} (${firstRes.xUnit})` }, gridcolor: "#F2F4F6" },
    yaxis: { title: { text: `${firstRes.yLabel} (${firstRes.yUnit})` }, gridcolor: "#F2F4F6" },
    legend: { orientation: "h", x: 0, y: 1.12 },
  };

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[16px] font-bold text-[#191F28] flex items-center gap-2">
          <Flame className="w-5 h-5 text-[#3182F6]" />
          {instrumentType} 다중 곡선 중첩 플롯
        </h3>
        <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full bg-[#E5E8EB] text-[#4E5968]">
          {visibleDatasets.length}개 곡선
        </span>
      </div>

      <div className="border border-[#E5E8EB] rounded-[14px] bg-white p-2">
        <PlotlyChart data={traces} layout={layout} height={440} />
      </div>
    </Card>
  );
}
