import { useEffect, useState } from "react";
import {
  Layers,
  Activity,
  Microscope,
  Flame,
  Binary,
  Radio,
} from "lucide-react";
import type { InstrumentType, UniversalDataset } from "../../core/batch/types";
import { getInstrumentAdapter } from "../../core/batch/adapters";
import { UniversalBatchUploader } from "./UniversalBatchUploader";
import { XrdBatchComparisonView } from "./XrdBatchComparisonView";
import { UtmBatchComparisonView } from "./UtmBatchComparisonView";
import { SemBatchComparisonView } from "./SemBatchComparisonView";
import { PlotlyChart } from "../PlotlyChart";
import { Card } from "../ui/primitives";

interface UniversalBatchPlatformViewProps {
  currentInstrument?: InstrumentType;
  onInstrumentChange?: (inst: InstrumentType) => void;
  onCountsChange?: (counts: Record<InstrumentType, number>) => void;
}

export function UniversalBatchPlatformView({
  currentInstrument,
  onInstrumentChange,
  onCountsChange,
}: UniversalBatchPlatformViewProps = {}) {
  const [internalInstrument, setInternalInstrument] = useState<InstrumentType>("XRD");
  const activeInstrument = currentInstrument ?? internalInstrument;

  const setActiveInstrument = (type: InstrumentType) => {
    setInternalInstrument(type);
    if (onInstrumentChange) {
      onInstrumentChange(type);
    }
  };

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

  // Notify parent of counts
  useEffect(() => {
    if (onCountsChange) {
      const counts: any = {};
      Object.keys(datasetsByInstrument).forEach((k) => {
        counts[k] = (datasetsByInstrument[k as InstrumentType] || []).length;
      });
      onCountsChange(counts);
    }
  }, [datasetsByInstrument, onCountsChange]);

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

  return (
    <div className="space-y-6">

      {/* UTM 모드 헤더 안내 */}
      {activeInstrument === "UTM" && (
        <div className="flex items-center justify-between pb-1">
          <div className="flex items-center gap-2 text-[#191F28] font-bold text-[16px]">
            <span className="w-2.5 h-2.5 rounded-full bg-[#10B981]"></span>
            <span>UTM 만능재료시험기 인장/압축 시험</span>
          </div>
          <span className="text-[12px] text-[#6B7684]">
            복수 시편 응력-변형률(Stress-Strain) 곡선 중첩 및 Mean ± SD 통계표 산출
          </span>
        </div>
      )}

      {/* DSC / TGA / FTIR 헤더 안내 */}
      {["DSC", "TGA", "FTIR"].includes(activeInstrument) && (
        <div className="flex items-center justify-between pb-1">
          <div className="flex items-center gap-2 text-[#191F28] font-bold text-[16px]">
            <span className="w-2.5 h-2.5 rounded-full bg-[#F59E0B]"></span>
            <span>
              {activeInstrument === "DSC" && "DSC 시차주사열량분석 (Differential Scanning Calorimetry)"}
              {activeInstrument === "TGA" && "TGA 열중량분석 (Thermogravimetric Analysis)"}
              {activeInstrument === "FTIR" && "FTIR 푸리에변환 적외선분광분석"}
            </span>
          </div>
          <span className="text-[12px] text-[#6B7684]">
            복수 열분석/분광 데이터(.csv, .txt) 일괄 비교 및 중첩 플롯
          </span>
        </div>
      )}

      {/* 공통 Universal Batch 업로더 (단일/복수 파일 모두 완벽 지원) */}
      <UniversalBatchUploader
        instrumentType={activeInstrument}
        datasets={activeDatasets}
        onDatasetsChange={handleDatasetsChange}
      />

      {/* 기기별 분석 및 비교 렌더러 */}
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

      {/* 열분석 / 분광학 확장 플롯 (DSC / TGA / FTIR) */}
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
