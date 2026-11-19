import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Upload,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  Info,
  Sliders,
  Play,
  Activity,
  ArrowRight,
  Trash2,
  Layers,
  FileText,
  Eye,
  EyeOff,
  RefreshCw,
} from "lucide-react";
import { api } from "../api";
import type {
  ProjectDetail,
  ProjectListItem,
  SampleInstrumentRecord,
  UTMAnalysisResult,
  UTMParsedData,
} from "../types";
import { Button, Card } from "./ui/primitives";
import { PlotlyChart } from "./PlotlyChart";

export interface UtmBatchItem {
  id: string;
  name: string;
  file: File;
  status: "waiting" | "analyzing" | "completed" | "error";
  parsed?: UTMParsedData;
  result?: UTMAnalysisResult;
  error?: string;
  measurementId?: string;
}

interface UtmViewProps {
  activeSample?: ProjectDetail | ProjectListItem | null;
  onRecordSaved?: () => void;
  onNavigateToIntegrated?: () => void;
}

export function UtmView({ activeSample, onRecordSaved, onNavigateToIntegrated }: UtmViewProps = {}) {
  const [, setFile] = useState<File | null>(null);
  const [sampleRecords, setSampleRecords] = useState<SampleInstrumentRecord[]>([]);
  const [activeMeasurementId, setActiveMeasurementId] = useState<string | null>(null);
  const [parsedData, setParsedData] = useState<UTMParsedData | null>(null);
  const [analysisResult, setAnalysisResult] = useState<UTMAnalysisResult | null>(null);
  const [analyzedRequest, setAnalyzedRequest] = useState<Parameters<typeof api.analyzeUtm>[0] | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Multi-file batch state & overlay toggles
  const [batchFiles, setBatchFiles] = useState<UtmBatchItem[]>([]);
  const [hiddenCurves, setHiddenCurves] = useState<Record<string, boolean>>({});
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);

  // Analysis Parameters
  const [analysisName, setAnalysisName] = useState("UTM 인장시험 분석");
  const [notes, setNotes] = useState("");
  const [startIndex, setStartIndex] = useState<number>(0);
  const [endIndex, setEndIndex] = useState<number>(0);

  // Optional specimen dimensions
  const [useSpecimenDim, setUseSpecimenDim] = useState(false);
  const [specimenA0, setSpecimenA0] = useState<string>("");
  const [specimenL0, setSpecimenL0] = useState<string>("");

  // Elastic modulus settings
  const [elasticStartPct, setElasticStartPct] = useState<string>("0.05");
  const [elasticEndPct, setElasticEndPct] = useState<string>("0.30");
  const [calcOffsetYield, setCalcOffsetYield] = useState(true);

  // Active chart tab
  const [chartTab, setChartTab] = useState<"stress_strain" | "load_disp" | "time_load">("stress_strain");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const refreshSampleRecords = useCallback(() => {
    if (!activeSample?.id) {
      setSampleRecords([]);
      return;
    }
    api
      .listSampleRecords(activeSample.id, "utm")
      .then((res) => setSampleRecords(res.records || []))
      .catch(() => setSampleRecords([]));
  }, [activeSample?.id]);

  useEffect(() => {
    refreshSampleRecords();
  }, [refreshSampleRecords]);

  // Handle file drop / select
  const handleFileChange = async (selectedFile: File) => {
    setFile(selectedFile);
    setActiveMeasurementId(null);
    setErrorMsg(null);
    setIsParsing(true);
    setAnalysisResult(null);
    setParsedData(null);
    setAnalyzedRequest(null);
    try {
      const parsed = await api.parseUtm(selectedFile);
      setParsedData(parsed);
      setStartIndex(0);
      setEndIndex(parsed.row_count);
      const defaultName = activeSample?.sample_name
        ? `${activeSample.sample_name} — ${selectedFile.name}`
        : selectedFile.name.replace(/\.[^/.]+$/, "") + " 인장시험 분석";
      setAnalysisName(defaultName);

      // Auto run first analysis
      const request = {
        parsed_data: parsed,
        start_index: 0,
        end_index: parsed.row_count,
        specimen_area_A0: useSpecimenDim && Number(specimenA0) > 0 ? Number(specimenA0) : undefined,
        specimen_gauge_L0: useSpecimenDim && Number(specimenL0) > 0 ? Number(specimenL0) : undefined,
        elastic_start_strain_pct: Number.isNaN(parseFloat(elasticStartPct)) ? undefined : parseFloat(elasticStartPct),
        elastic_end_strain_pct: Number.isNaN(parseFloat(elasticEndPct)) ? undefined : parseFloat(elasticEndPct),
        analysis_name: defaultName,
        calc_offset_yield: calcOffsetYield,
      };
      const res = await api.analyzeUtm(request);
      setAnalyzedRequest(request);
      setAnalysisResult(res);
      try {
        localStorage.setItem(
          "matlens_shared_utm_data",
          JSON.stringify({
            sample_id: activeSample?.sample_name || selectedFile.name.replace(/\.[^/.]+$/, ""),
            chemical_composition: activeSample?.expected_formula || "",
            source_file: selectedFile.name,
            tensile_strength_MPa: res.peak_stress?.stress_MPa ?? null,
            yield_strength_MPa: res.offset_yield?.is_valid ? res.offset_yield.yield_stress_MPa : null,
            elastic_modulus_GPa: res.elastic_modulus?.is_valid ? res.elastic_modulus.E_GPa : null,
            elongation_pct: res.peak_stress?.strain_pct ?? null,
            is_sample_demo: selectedFile.name.includes("benchmark") || selectedFile.name.includes("sample"),
            timestamp: new Date().toISOString(),
          })
        );
      } catch {
        // ignore storage error
      }

      if (activeSample?.id) {
        const uts = res.peak_stress?.stress_MPa ?? "-";
        const eMod = res.elastic_modulus?.is_valid ? res.elastic_modulus.E_GPa : "-";
        const saved = await api.saveSampleRecord(activeSample.id, {
          instrument_type: "utm",
          original_filename: selectedFile.name,
          metadata: { row_count: parsed.row_count, encoding: parsed.encoding },
          raw_payload: { parsed_data: parsed, request },
          parameters: {
            start_index: 0,
            end_index: parsed.row_count,
            elastic_start_strain_pct: request.elastic_start_strain_pct,
            elastic_end_strain_pct: request.elastic_end_strain_pct,
          },
          results: res,
          summary_text: `UTS ${uts} MPa · E ${eMod} GPa`,
        });
        if (saved?.measurement_id) {
          setActiveMeasurementId(saved.measurement_id);
        }
        refreshSampleRecords();
        onRecordSaved?.();
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "파일 파싱에 실패했습니다.");
    } finally {
      setIsParsing(false);
    }
  };

  // Multi-file batch upload handler
  const handleMultipleFiles = async (files: File[]) => {
    if (!files || files.length === 0) return;
    setErrorMsg(null);
    setIsBatchProcessing(true);

    const newItems: UtmBatchItem[] = files.map((f, i) => ({
      id: `batch_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`,
      name: f.name,
      file: f,
      status: "waiting",
    }));

    setBatchFiles((prev) => [...prev, ...newItems]);

    // Analyze each file independently (failure isolation)
    for (const item of newItems) {
      setBatchFiles((prev) =>
        prev.map((b) => (b.id === item.id ? { ...b, status: "analyzing" } : b))
      );
      try {
        const parsed = await api.parseUtm(item.file);
        const defaultName = activeSample?.sample_name
          ? `${activeSample.sample_name} — ${item.file.name}`
          : item.file.name.replace(/\.[^/.]+$/, "");
        const request = {
          parsed_data: parsed,
          start_index: 0,
          end_index: parsed.row_count,
          elastic_start_strain_pct: 0.05,
          elastic_end_strain_pct: 0.30,
          analysis_name: defaultName,
          calc_offset_yield: true,
        };
        const res = await api.analyzeUtm(request);

        let measurementId: string | undefined;
        if (activeSample?.id) {
          const uts = res.peak_stress?.stress_MPa ?? "-";
          const eMod = res.elastic_modulus?.is_valid ? res.elastic_modulus.E_GPa : "-";
          const saved = await api.saveSampleRecord(activeSample.id, {
            instrument_type: "utm",
            original_filename: item.file.name,
            metadata: { row_count: parsed.row_count, encoding: parsed.encoding },
            raw_payload: { parsed_data: parsed, request },
            parameters: {
              start_index: 0,
              end_index: parsed.row_count,
              elastic_start_strain_pct: 0.05,
              elastic_end_strain_pct: 0.30,
            },
            results: res,
            summary_text: `UTS ${uts} MPa · E ${eMod} GPa`,
          });
          measurementId = saved?.measurement_id;
        }

        setBatchFiles((prev) =>
          prev.map((b) =>
            b.id === item.id
              ? { ...b, status: "completed", parsed, result: res, measurementId }
              : b
          )
        );

        // Populate detail view if none active
        setParsedData((curr) => {
          if (!curr) {
            setFile(item.file);
            setStartIndex(0);
            setEndIndex(parsed.row_count);
            setAnalysisName(defaultName);
            setAnalyzedRequest(request);
            setAnalysisResult(res);
            if (measurementId) setActiveMeasurementId(measurementId);
            return parsed;
          }
          return curr;
        });
      } catch (err: any) {
        setBatchFiles((prev) =>
          prev.map((b) =>
            b.id === item.id
              ? { ...b, status: "error", error: err?.message || "분석 실패" }
              : b
          )
        );
      }
    }

    setIsBatchProcessing(false);
    refreshSampleRecords();
    onRecordSaved?.();
  };

  const handleSelectBatchItem = (item: UtmBatchItem) => {
    if (item.parsed && item.result) {
      setFile(item.file);
      setParsedData(item.parsed);
      setStartIndex(0);
      setEndIndex(item.parsed.row_count);
      const defaultName = activeSample?.sample_name
        ? `${activeSample.sample_name} — ${item.file.name}`
        : item.file.name.replace(/\.[^/.]+$/, "");
      setAnalysisName(defaultName);
      setAnalysisResult(item.result);
      if (item.measurementId) setActiveMeasurementId(item.measurementId);
    }
  };

  const handleRemoveBatchItem = (id: string) => {
    setBatchFiles((prev) => prev.filter((b) => b.id !== id));
  };

  const handleDownloadComparisonCsv = () => {
    const completed = batchFiles.filter((b) => b.status === "completed" && b.result);
    if (completed.length === 0) return;
    const headers = [
      "파일명",
      "최대인장강도_UTS(MPa)",
      "0.2%오프셋항복강도(MPa)",
      "탄성계수_E(GPa)",
      "파단연신율(%)",
      "음수하중검출여부",
    ];
    const rows = completed.map((b) => [
      b.name,
      b.result?.peak_stress?.stress_MPa ?? "",
      b.result?.offset_yield?.is_valid ? b.result.offset_yield.yield_stress_MPa : "",
      b.result?.elastic_modulus?.is_valid ? b.result.elastic_modulus.E_GPa : "",
      b.result?.peak_stress?.strain_pct ?? "",
      b.result?.negative_load_summary?.first_serial ? "음수하중검출" : "정상",
    ]);
    const content = [
      headers.join(","),
      ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");
    const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `utm_comparison_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const completedBatchItems = useMemo(
    () => batchFiles.filter((b) => b.status === "completed" && b.result),
    [batchFiles]
  );

  const comparisonStats = useMemo(() => {
    if (completedBatchItems.length < 2) return null;
    const utsList = completedBatchItems
      .map((b) => b.result?.peak_stress?.stress_MPa)
      .filter((v): v is number => typeof v === "number");
    const yldList = completedBatchItems
      .map((b) => (b.result?.offset_yield?.is_valid ? b.result.offset_yield.yield_stress_MPa : null))
      .filter((v): v is number => typeof v === "number");
    const eList = completedBatchItems
      .map((b) => (b.result?.elastic_modulus?.is_valid ? b.result.elastic_modulus.E_GPa : null))
      .filter((v): v is number => typeof v === "number");
    const elList = completedBatchItems
      .map((b) => b.result?.peak_stress?.strain_pct)
      .filter((v): v is number => typeof v === "number");

    const statsOf = (arr: number[]) => {
      if (arr.length === 0) return null;
      const min = Math.min(...arr);
      const max = Math.max(...arr);
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
      const diff = max - min;
      const deltaPct = avg > 0 ? (diff / avg) * 100 : 0;
      return { min, max, avg, diff, deltaPct };
    };

    return {
      uts: statsOf(utsList),
      yield: statsOf(yldList),
      eMod: statsOf(eList),
      elong: statsOf(elList),
    };
  }, [completedBatchItems]);

  // Re-run analysis with current parameters
  const runAnalysis = useCallback(async () => {
    if (!parsedData) return;
    setIsAnalyzing(true);
    setErrorMsg(null);
    try {
      const a0 = useSpecimenDim && parseFloat(specimenA0) > 0 ? parseFloat(specimenA0) : undefined;
      const l0 = useSpecimenDim && parseFloat(specimenL0) > 0 ? parseFloat(specimenL0) : undefined;
      const e_start = parseFloat(elasticStartPct);
      const e_end = parseFloat(elasticEndPct);

      const request = {
        parsed_data: parsedData,
        start_index: startIndex,
        end_index: endIndex,
        specimen_area_A0: a0,
        specimen_gauge_L0: l0,
        elastic_start_strain_pct: isNaN(e_start) ? undefined : e_start,
        elastic_end_strain_pct: isNaN(e_end) ? undefined : e_end,
        calc_offset_yield: calcOffsetYield,
        analysis_name: analysisName,
        notes: notes,
      };
      const res = await api.analyzeUtm(request);
      setAnalyzedRequest(request);
      setAnalysisResult(res);
      try {
        localStorage.setItem(
          "matlens_shared_utm_data",
          JSON.stringify({
            sample_id: activeSample?.sample_name || analysisName || parsedData.filename || "UTM-Sample",
            chemical_composition: activeSample?.expected_formula || "",
            source_file: parsedData.filename || "UTM 데이터",
            tensile_strength_MPa: res.peak_stress?.stress_MPa ?? null,
            yield_strength_MPa: res.offset_yield?.is_valid ? res.offset_yield.yield_stress_MPa : null,
            elastic_modulus_GPa: res.elastic_modulus?.is_valid ? res.elastic_modulus.E_GPa : null,
            elongation_pct: res.peak_stress?.strain_pct ?? null,
            is_sample_demo: Boolean(parsedData.filename?.includes("benchmark") || parsedData.filename?.includes("sample")),
            timestamp: new Date().toISOString(),
          })
        );
      } catch {
        // ignore storage error
      }

      if (activeSample?.id) {
        const uts = res.peak_stress?.stress_MPa ?? "-";
        const eMod = res.elastic_modulus?.is_valid ? res.elastic_modulus.E_GPa : "-";
        const saved = await api.saveSampleRecord(activeSample.id, {
          measurement_id: activeMeasurementId,
          instrument_type: "utm",
          original_filename: parsedData.filename || "utm_data.csv",
          metadata: { row_count: parsedData.row_count, encoding: parsedData.encoding },
          raw_payload: { parsed_data: parsedData, request },
          parameters: {
            start_index: startIndex,
            end_index: endIndex,
            specimen_area_A0: a0,
            specimen_gauge_L0: l0,
            elastic_start_strain_pct: request.elastic_start_strain_pct,
            elastic_end_strain_pct: request.elastic_end_strain_pct,
          },
          results: res,
          summary_text: `UTS ${uts} MPa · E ${eMod} GPa`,
        });
        if (saved?.measurement_id) {
          setActiveMeasurementId(saved.measurement_id);
        }
        refreshSampleRecords();
        onRecordSaved?.();
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "분석 계산에 실패했습니다.");
    } finally {
      setIsAnalyzing(false);
    }
  }, [
    parsedData,
    startIndex,
    endIndex,
    useSpecimenDim,
    specimenA0,
    specimenL0,
    elasticStartPct,
    elasticEndPct,
    calcOffsetYield,
    analysisName,
    notes,
    activeSample?.id,
    activeSample?.sample_name,
    activeSample?.expected_formula,
    activeMeasurementId,
    refreshSampleRecords,
    onRecordSaved,
  ]);

  // Export the parameters that produced the visible result, including dimensions
  // and regression bounds. Unsaved form edits must not silently change exports.
  const downloadResult = async (download: (payload: any) => Promise<void>) => {
    if (!analyzedRequest) return;
    setIsDownloading(true);
    setErrorMsg(null);
    try {
      await download({ ...analyzedRequest, analysis_name: analysisName, notes });
    } catch (err: any) {
      setErrorMsg(err?.message || "다운로드에 실패했습니다.");
    } finally {
      setIsDownloading(false);
    }
  };

  // Trim negative loads preset
  const handleExcludeNegativeLoads = () => {
    if (!analysisResult || !analysisResult.negative_load_summary.first_serial) return;
    // Find index of first negative load
    const firstNegIdx = analysisResult.curves.load_raw.findIndex((v) => v < 0);
    if (firstNegIdx > 0) {
      setEndIndex(startIndex + firstNegIdx);
    }
  };

  // Render Canvas Chart
  useEffect(() => {
    if (!analysisResult || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    // Padding for axes
    const padL = 65;
    const padR = 25;
    const padT = 30;
    const padB = 45;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    let xData: number[] = [];
    let yData: number[] = [];
    let xLabel = "";
    let yLabel = "";
    let plotColor = "#2563EB";

    const curves = analysisResult.curves;

    if (chartTab === "stress_strain") {
      xData = curves.strain_pct;
      yData = curves.stress_MPa;
      xLabel = "변형률 Strain (%)";
      yLabel = "응력 Stress (MPa)";
      plotColor = "#2563EB";
    } else if (chartTab === "load_disp") {
      xData = curves.disp_raw;
      yData = curves.load_N;
      xLabel = "변위 Displacement (mm)";
      yLabel = "하중 Load (N)";
      plotColor = "#0284C7";
    } else {
      xData = curves.time;
      yData = curves.load_N;
      xLabel = "시간 Time (sec)";
      yLabel = "하중 Load (N)";
      plotColor = "#7C3AED";
    }

    if (xData.length === 0 || yData.length === 0) return;

    let minX = Math.min(...xData);
    let maxX = Math.max(...xData);
    let minY = Math.min(...yData);
    let maxY = Math.max(...yData);

    // Min bounds adjustment
    if (minX > 0) minX = 0;
    if (minY > 0 && chartTab !== "time_load") minY = 0;
    if (maxX === minX) maxX += 1;
    if (maxY === minY) maxY += 1;

    const toX = (val: number) => padL + ((val - minX) / (maxX - minX)) * plotW;
    const toY = (val: number) => padT + (1 - (val - minY) / (maxY - minY)) * plotH;

    // Grid lines & Axis ticks
    ctx.strokeStyle = "#E2E8F0";
    ctx.lineWidth = 1;
    ctx.font = "11px Pretendard, sans-serif";
    ctx.fillStyle = "#64748B";

    // Horizontal grid
    const nY = 5;
    for (let i = 0; i <= nY; i++) {
      const yVal = minY + (i / nY) * (maxY - minY);
      const py = toY(yVal);
      ctx.beginPath();
      ctx.moveTo(padL, py);
      ctx.lineTo(padL + plotW, py);
      ctx.stroke();
      ctx.textAlign = "right";
      ctx.fillText(yVal.toFixed(1), padL - 8, py + 4);
    }

    // Zero horizontal line if cross
    if (minY < 0 && maxY > 0) {
      const zeroY = toY(0);
      ctx.strokeStyle = "#94A3B8";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(padL, zeroY);
      ctx.lineTo(padL + plotW, zeroY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Vertical grid
    const nX = 6;
    for (let i = 0; i <= nX; i++) {
      const xVal = minX + (i / nX) * (maxX - minX);
      const px = toX(xVal);
      ctx.strokeStyle = "#E2E8F0";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, padT);
      ctx.lineTo(px, padT + plotH);
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.fillText(xVal.toFixed(1), px, padT + plotH + 18);
    }

    // Draw main curve
    ctx.strokeStyle = plotColor;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (let i = 0; i < xData.length; i++) {
      const px = toX(xData[i]);
      const py = toY(yData[i]);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Highlight Peak Stress if stress_strain
    if (chartTab === "stress_strain" && analysisResult.peak_stress) {
      const ps = analysisResult.peak_stress;
      if (ps.strain_pct !== null) {
        const px = toX(ps.strain_pct);
        const py = toY(ps.stress_MPa);

        ctx.fillStyle = "#DC2626";
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#1E293B";
        ctx.font = "bold 11px Pretendard, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(`최대응력 ${ps.stress_MPa} MPa (No. ${ps.serial_number})`, px + 8, py - 4);
      }
    }

    // Highlight 0.2% Offset Yield if stress_strain
    if (chartTab === "stress_strain" && analysisResult.offset_yield?.is_valid) {
      const oy = analysisResult.offset_yield;
      if (oy.yield_strain_pct && oy.yield_stress_MPa) {
        const px = toX(oy.yield_strain_pct);
        const py = toY(oy.yield_stress_MPa);

        ctx.fillStyle = "#059669";
        ctx.beginPath();
        ctx.arc(px, py, 4.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#059669";
        ctx.font = "bold 11px Pretendard, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(`0.2% 내력 ${oy.yield_stress_MPa} MPa`, px + 8, py + 12);
      }
    }

    // Axis Labels
    ctx.fillStyle = "#1E293B";
    ctx.font = "bold 12px Pretendard, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(xLabel, padL + plotW / 2, padT + plotH + 36);

    ctx.save();
    ctx.translate(18, padT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();
  }, [analysisResult, chartTab]);

  return (
    <div className="space-y-6">
      {/* Top Banner / Introduction */}
      <div className="bg-white rounded-[20px] p-6 sm:p-8 border border-[#E5E8EB] shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#EFF6FF] text-[#3182F6] text-[12px] font-semibold">
              <Activity className="w-3.5 h-3.5" />
              UTM 인장시험 Raw Data 독립 수치 분석 엔진
            </div>
            <h1 className="text-[24px] sm:text-[28px] font-bold tracking-tight text-[#191F28]">
              UTM 인장시험 데이터 정량 분석
            </h1>
            <p className="text-[14px] text-[#6B7684] leading-relaxed max-w-3xl">
              만능재료시험기(UTM)의 Raw 텍스트/CSV 데이터를 직접 파싱하여 단위 표준화(kgf/mm² → MPa, kgf → N),
              인장강도(최대응력), 탄성계수(선형 회귀 E), 0.2% 오프셋 내력, 음수 하중 구간을 Python 수치 엔진으로 정밀 계산합니다.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                const csvContent = [
                  "No,Time,Load,Displacement,Strain,Stress",
                  "int,sec,N,mm,%,MPa",
                  "1,0.0,0.0,0.000,0.00,0.0",
                  "2,0.5,1470.0,0.025,0.05,42.0",
                  "3,1.0,2940.0,0.050,0.10,84.0",
                  "4,1.5,5880.0,0.100,0.20,168.0",
                  "5,2.0,8820.0,0.150,0.30,252.0",
                  "6,2.5,11200.0,0.200,0.40,320.0",
                  "7,3.0,12775.0,0.250,0.50,365.0",
                  "8,4.0,14350.0,0.400,0.80,410.0",
                  "9,5.0,15575.0,0.650,1.30,445.0",
                  "10,6.0,16275.0,0.950,1.90,465.0",
                  "11,7.0,16800.0,1.300,2.60,480.0",
                  "12,8.0,16450.0,1.600,3.20,470.0",
                ].join("\n");
                const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
                const sampleFile = new File([blob], "benchmark_utm_tensile_sample.csv", { type: "text/csv" });
                handleFileChange(sampleFile);
              }}
              className="px-3.5 py-2.5 rounded-[12px] bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#334155] font-semibold text-[13px] transition-colors cursor-pointer"
            >
              대표 벤치마크 인장 샘플 로드
            </button>
            <label className="flex items-center gap-2 px-4 py-2.5 rounded-[12px] bg-[#3182F6] text-white font-semibold text-[14px] cursor-pointer hover:bg-[#2563EB] transition-colors shadow-sm">
              <Upload className="w-4 h-4" />
              <span>{isBatchProcessing || isParsing ? "파일 분석 중..." : "UTM 파일 복수 업로드"}</span>
              <input
                type="file"
                multiple
                accept=".txt,.csv,.tsv,.dat"
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  if (files.length === 1) {
                    handleFileChange(files[0]);
                  } else if (files.length > 1) {
                    handleMultipleFiles(files);
                  }
                }}
              />
            </label>
            {onNavigateToIntegrated && (
              <button
                type="button"
                onClick={onNavigateToIntegrated}
                className="px-3.5 py-2.5 rounded-[12px] bg-[#EEF2FF] hover:bg-[#E0E7FF] text-[#4338CA] border border-[#C7D2FE] font-bold text-[13px] transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <span>통합 리포트에서 교차 분석</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Saved UTM Records for Active Sample */}
      {activeSample && sampleRecords.length > 0 && (
        <div className="bg-white px-5 py-3.5 rounded-[16px] border border-[#E5E8EB] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-[#191F28]">
            <Clock className="w-4 h-4 text-[#3182F6]" />
            <span>
              선택 시료(<strong>{activeSample.sample_name}</strong> · ID: {activeSample.sample_code || activeSample.id})에 연결된 UTM 측정 파일 ({sampleRecords.length}건):
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {sampleRecords.map((rec) => {
              const latestAnalysis = rec.analyses?.[0];
              const isCurrent = activeMeasurementId === rec.id;
              return (
                <div
                  key={rec.id}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-[12px] font-medium border transition-colors ${
                    isCurrent
                      ? "bg-[#EFF6FF] border-[#3182F6] text-[#1D4ED8] font-bold"
                      : "bg-[#F8FAFC] hover:bg-[#EFF6FF]/60 border-[#E5E8EB] text-[#191F28]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActiveMeasurementId(rec.id);
                      if (rec.raw_payload?.parsed_data) {
                        setParsedData(rec.raw_payload.parsed_data);
                        setStartIndex(rec.raw_payload.request?.start_index ?? 0);
                        setEndIndex(rec.raw_payload.request?.end_index ?? rec.raw_payload.parsed_data.row_count);
                      }
                      if (rec.raw_payload?.request) {
                        setAnalyzedRequest(rec.raw_payload.request);
                      }
                      if (latestAnalysis?.results) {
                        setAnalysisResult(latestAnalysis.results as unknown as UTMAnalysisResult);
                      }
                      setAnalysisName(`${activeSample.sample_name} — ${rec.original_filename}`);
                    }}
                    className="cursor-pointer"
                  >
                    📄 {rec.original_filename}
                    {latestAnalysis?.summary_text ? ` · ${latestAnalysis.summary_text}` : ""}
                  </button>
                  <button
                    type="button"
                    title="이 측정 기록 삭제"
                    onClick={async () => {
                      await api.deleteSampleRecord(activeSample.id, rec.id);
                      if (activeMeasurementId === rec.id) {
                        setActiveMeasurementId(null);
                      }
                      refreshSampleRecords();
                      onRecordSaved?.();
                    }}
                    className="text-[#8B95A1] hover:text-[#DC2626] ml-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Error Banner */}
      {errorMsg && (
        <div className="rounded-[16px] bg-[#FEE2E2] border border-[#FECACA] p-4 text-[13px] text-[#DC2626] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-[12px] font-semibold underline px-2 cursor-pointer"
          >
            닫기
          </button>
        </div>
      )}

      {/* File Drop Area if no data parsed */}
      {!parsedData && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const files = Array.from(e.dataTransfer.files || []);
            if (files.length === 1) {
              handleFileChange(files[0]);
            } else if (files.length > 1) {
              handleMultipleFiles(files);
            }
          }}
          className="border-2 border-dashed border-[#D1D5DB] rounded-[24px] p-12 text-center bg-white/60 hover:bg-white hover:border-[#3182F6] transition-all cursor-pointer"
          onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.multiple = true;
            input.accept = ".txt,.csv,.tsv,.dat";
            input.onchange = (e: any) => {
              const files = Array.from((e.target?.files || []) as FileList) as File[];
              if (files.length === 1) {
                handleFileChange(files[0]);
              } else if (files.length > 1) {
                handleMultipleFiles(files);
              }
            };
            input.click();
          }}
        >
          <div className="w-14 h-14 rounded-full bg-[#EFF6FF] text-[#3182F6] flex items-center justify-center mx-auto mb-4">
            <Upload className="w-7 h-7" />
          </div>
          <div className="text-[17px] font-bold text-[#191F28] mb-1">
            UTM Raw Data 파일(TXT, CSV, TSV)을 이곳에 끌어다 놓으세요 (복수 파일 지원)
          </div>
          <p className="text-[13px] text-[#8B95A1] max-w-md mx-auto mb-4">
            여러 파일을 한 번에 선택하여 개별 분석하고 다중 응력-변형률 곡선 중첩 및 지표 비교표를 바로 생성할 수 있습니다.
          </p>
          <Button variant="outline" size="sm">
            컴퓨터에서 복수 파일 선택
          </Button>
        </div>
      )}

      {/* Batch Files Queue / Active List */}
      {batchFiles.length > 0 && (
        <Card className="p-5 space-y-4 bg-white border border-[#E5E8EB]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F2F4F6] pb-3">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-[#3182F6]" />
              <span className="font-bold text-[14px] text-[#191F28]">
                업로드된 UTM 측정 파일 목록 ({batchFiles.length}개)
              </span>
              <span className="text-[11px] text-[#6B7684]">
                완료 {completedBatchItems.length}개 · 분석 중 {batchFiles.filter((b) => b.status === "analyzing").length}개
              </span>
            </div>
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12px] font-bold text-[#3182F6] bg-[#EFF6FF] hover:bg-[#DBEAFE] border border-[#BFDBFE] transition-colors cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              <span>추가 파일 업로드</span>
              <input
                type="file"
                multiple
                accept=".txt,.csv,.tsv,.dat"
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  if (files.length > 0) handleMultipleFiles(files);
                }}
              />
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {batchFiles.map((b) => {
              const isSelected = parsedData?.filename === b.name || parsedData?.filename === b.file.name;
              return (
                <div
                  key={b.id}
                  className={`p-3.5 rounded-[12px] border transition-all flex flex-col justify-between gap-2.5 ${
                    isSelected
                      ? "bg-[#EFF6FF]/60 border-[#3182F6] shadow-xs"
                      : "bg-[#F8FAFC] border-[#E5E8EB] hover:border-[#CBD5E1]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold text-[#191F28] truncate" title={b.name}>
                        {b.name}
                      </div>
                      <div className="text-[11px] text-[#6B7684] mt-0.5">
                        크기: {(b.file.size / 1024).toFixed(1)} KB
                      </div>
                    </div>
                    {b.status === "completed" && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#DCFCE7] text-[#15803D] shrink-0">
                        분석 완료
                      </span>
                    )}
                    {b.status === "analyzing" && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#DBEAFE] text-[#1D4ED8] flex items-center gap-1 shrink-0">
                        <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                        분석 중
                      </span>
                    )}
                    {b.status === "waiting" && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#F1F5F9] text-[#64748B] shrink-0">
                        대기
                      </span>
                    )}
                    {b.status === "error" && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#FEE2E2] text-[#DC2626] shrink-0">
                        오류
                      </span>
                    )}
                  </div>

                  {b.status === "completed" && b.result && (
                    <div className="text-[11px] font-mono text-[#334155] bg-white p-2 rounded-[8px] border border-[#E2E8F0] space-y-0.5">
                      <div>UTS: <strong className="text-[#1D4ED8]">{b.result.peak_stress?.stress_MPa ?? "-"} MPa</strong></div>
                      <div>E: <strong className="text-[#7C3AED]">{b.result.elastic_modulus?.is_valid ? `${b.result.elastic_modulus.E_GPa} GPa` : "-"}</strong></div>
                    </div>
                  )}

                  {b.status === "error" && (
                    <div className="text-[11px] text-[#DC2626] bg-[#FEF2F2] p-2 rounded border border-[#FECACA]">
                      {b.error || "분석 오류 발생"}
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1 border-t border-[#E5E8EB]">
                    {b.status === "completed" ? (
                      <button
                        type="button"
                        onClick={() => handleSelectBatchItem(b)}
                        className={`text-[11px] font-bold cursor-pointer ${
                          isSelected ? "text-[#3182F6]" : "text-[#64748B] hover:text-[#191F28]"
                        }`}
                      >
                        {isSelected ? "현재 상세 검토 중" : "상세 검토 선택"}
                      </button>
                    ) : (
                      <span className="text-[11px] text-[#94A3B8]">—</span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemoveBatchItem(b.id)}
                      className="text-[#94A3B8] hover:text-[#DC2626] text-[11px] cursor-pointer"
                      title="목록에서 제거"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Multi-Curve Overlay & Comparison View (when 2 or more files completed) */}
      {completedBatchItems.length >= 2 && (
        <Card className="p-5 space-y-5 border-2 border-[#BFDBFE] bg-gradient-to-br from-white to-[#F8FAFC]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E5E8EB] pb-4">
            <div>
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-[#3182F6]" />
                <h3 className="text-[17px] font-bold text-[#191F28]">
                  다중 UTM 인장시험 곡선 중첩 및 정량 비교 ({completedBatchItems.length}개 파일)
                </h3>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE]">
                  독립 수치 계산 완료
                </span>
              </div>
              <p className="text-[12px] text-[#6B7684] mt-1">
                각 측정 파일은 독립적으로 파싱·계산되어 배열 왜곡 없이 동일 축 상에서 정밀 비교됩니다.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleDownloadComparisonCsv}
                className="text-[12px] font-bold text-[#1D4ED8] border-[#BFDBFE] hover:bg-[#EFF6FF]"
              >
                <Download className="w-3.5 h-3.5 mr-1 text-[#3182F6]" />
                비교표 CSV 내보내기
              </Button>
            </div>
          </div>

          {/* Visibility toggle pills */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-semibold text-[#6B7684]">표시 곡선 선택:</span>
            {completedBatchItems.map((b, idx) => {
              const colors = ["#2563EB", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#06B6D4", "#EC4899", "#84CC16"];
              const color = colors[idx % colors.length];
              const isHidden = hiddenCurves[b.id];
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setHiddenCurves((prev) => ({ ...prev, [b.id]: !prev[b.id] }))}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-semibold border transition-all cursor-pointer ${
                    isHidden
                      ? "bg-[#F8FAFC] border-[#E2E8F0] text-[#94A3B8] line-through"
                      : "bg-white border-[#CBD5E1] text-[#191F28] shadow-xs"
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: isHidden ? "#CBD5E1" : color }}
                  />
                  <span>{b.name}</span>
                  {isHidden ? <EyeOff className="w-3 h-3 text-[#94A3B8]" /> : <Eye className="w-3 h-3 text-[#64748B]" />}
                </button>
              );
            })}
          </div>

          {/* Plotly Multi-Curve Overlay */}
          <div className="w-full bg-white rounded-[14px] border border-[#E5E8EB] p-3 shadow-xs">
            <PlotlyChart
              data={completedBatchItems
                .filter((b) => !hiddenCurves[b.id])
                .map((b, idx) => {
                  const colors = ["#2563EB", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#06B6D4", "#EC4899", "#84CC16"];
                  const color = colors[idx % colors.length];
                  return {
                    x: b.result?.curves.strain_pct || [],
                    y: b.result?.curves.stress_MPa || [],
                    type: "scatter",
                    mode: "lines",
                    name: b.name,
                    line: { color, width: 2.2 },
                    hovertemplate: `<b>${b.name}</b><br>변형률: %{x:.2f}%<br>응력: %{y:.1f} MPa<extra></extra>`,
                  };
                })}
              layout={{
                title: { text: "다중 UTM 응력-변형률 곡선 중첩 (Stress-Strain Overlay)", font: { size: 14 } },
                xaxis: { title: "변형률 Strain (%)", gridcolor: "#F1F5F9" },
                yaxis: { title: "응력 Stress (MPa)", gridcolor: "#F1F5F9" },
                hovermode: "closest",
                legend: { orientation: "h", y: -0.2 },
                margin: { l: 60, r: 20, t: 40, b: 60 },
                autosize: true,
              }}
              style={{ width: "100%", height: "420px" }}
            />
          </div>

          {/* Quantitative Comparison Table */}
          <div className="overflow-x-auto rounded-[12px] border border-[#E5E8EB] bg-white">
            <table className="w-full text-left text-[12px] border-collapse">
              <thead>
                <tr className="bg-[#F8FAFC] border-b border-[#E5E8EB] text-[#475569] font-bold">
                  <th className="py-2.5 px-3">파일명</th>
                  <th className="py-2.5 px-3">최대 인장강도 UTS (MPa)</th>
                  <th className="py-2.5 px-3">0.2% 오프셋 항복강도 (MPa)</th>
                  <th className="py-2.5 px-3">탄성계수 E (GPa)</th>
                  <th className="py-2.5 px-3">파단 연신율 (%)</th>
                  <th className="py-2.5 px-3">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {completedBatchItems.map((b) => (
                  <tr key={b.id} className="hover:bg-[#F8FAFC]">
                    <td className="py-2.5 px-3 font-semibold text-[#191F28] flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-[#3182F6]" />
                      <span>{b.name}</span>
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold text-[#1D4ED8]">
                      {b.result?.peak_stress?.stress_MPa !== undefined ? `${b.result.peak_stress.stress_MPa} MPa` : "-"}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[#059669]">
                      {b.result?.offset_yield?.is_valid ? `${b.result.offset_yield.yield_stress_MPa} MPa` : "미검출"}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[#7C3AED]">
                      {b.result?.elastic_modulus?.is_valid ? `${b.result.elastic_modulus.E_GPa} GPa` : "-"}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[#D97706]">
                      {b.result?.peak_stress?.strain_pct !== undefined ? `${b.result.peak_stress.strain_pct}%` : "-"}
                    </td>
                    <td className="py-2.5 px-3">
                      <button
                        type="button"
                        onClick={() => handleSelectBatchItem(b)}
                        className="px-2 py-1 rounded-[6px] text-[11px] font-bold bg-[#EFF6FF] text-[#1D4ED8] hover:bg-[#DBEAFE] cursor-pointer"
                      >
                        상세 보기
                      </button>
                    </td>
                  </tr>
                ))}
                {comparisonStats && (
                  <tr className="bg-[#EFF6FF]/60 font-bold text-[#1D4ED8] border-t-2 border-[#BFDBFE]">
                    <td className="py-2.5 px-3">최대 편차 (Δ = Max - Min)</td>
                    <td className="py-2.5 px-3 font-mono">
                      {comparisonStats.uts ? `Δ ${comparisonStats.uts.diff.toFixed(1)} MPa (${comparisonStats.uts.deltaPct.toFixed(1)}%)` : "-"}
                    </td>
                    <td className="py-2.5 px-3 font-mono">
                      {comparisonStats.yield ? `Δ ${comparisonStats.yield.diff.toFixed(1)} MPa (${comparisonStats.yield.deltaPct.toFixed(1)}%)` : "-"}
                    </td>
                    <td className="py-2.5 px-3 font-mono">
                      {comparisonStats.eMod ? `Δ ${comparisonStats.eMod.diff.toFixed(2)} GPa (${comparisonStats.eMod.deltaPct.toFixed(1)}%)` : "-"}
                    </td>
                    <td className="py-2.5 px-3 font-mono">
                      {comparisonStats.elong ? `Δ ${comparisonStats.elong.diff.toFixed(2)}% (${comparisonStats.elong.deltaPct.toFixed(1)}%)` : "-"}
                    </td>
                    <td className="py-2.5 px-3 text-[#64748B] text-[11px]">요약 통계</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Parsed File Data Overview & Controls */}
      {parsedData && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Settings & Mapping */}
          <div className="lg:col-span-4 space-y-6">
            <Card className="p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-[#F2F4F6] pb-3">
                <div className="font-bold text-[15px] text-[#191F28] flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-[#3182F6]" />
                  <span>파일 정보 및 열 구조</span>
                </div>
                <span className="text-[12px] font-mono px-2 py-0.5 rounded bg-[#F1F5F9] text-[#475569]">
                  {parsedData.encoding}
                </span>
              </div>

              <div className="space-y-2 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-[#64748B]">파일명</span>
                  <span className="font-semibold text-[#1E293B] truncate max-w-[200px]">
                    {parsedData.filename}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#64748B]">데이터 행 수</span>
                  <span className="font-semibold text-[#1E293B]">
                    {parsedData.row_count.toLocaleString()} 행
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#64748B]">열 개수</span>
                  <span className="font-semibold text-[#1E293B]">{parsedData.headers.length} 열</span>
                </div>
              </div>

              {/* Column Mapping Table */}
              <div className="space-y-2 pt-2">
                <div className="text-[12px] font-bold text-[#475569]">인식된 열 및 단위 매핑</div>
                <div className="max-h-[160px] overflow-y-auto rounded-[10px] border border-[#E2E8F0] text-[12px]">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-[#F8FAFC] text-[#64748B] sticky top-0 border-b border-[#E2E8F0]">
                      <tr>
                        <th className="p-2">열 이름</th>
                        <th className="p-2">단위</th>
                        <th className="p-2">역할 매핑</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F1F5F9]">
                      {parsedData.headers.map((h, i) => (
                        <tr key={i} className="hover:bg-[#F8FAFC]">
                          <td className="p-2 font-mono font-semibold text-[#1E293B]">{h}</td>
                          <td className="p-2 text-[#64748B]">{parsedData.units[i] || "-"}</td>
                          <td className="p-2 text-[#2563EB] font-semibold">
                            {Object.entries(parsedData.col_mapping).find(([_, v]) => v === h)?.[0] || "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Analysis Meta Inputs */}
              <div className="space-y-3 pt-2 border-t border-[#F2F4F6]">
                <div>
                  <label className="block text-[12px] font-semibold text-[#191F28] mb-1">분석명</label>
                  <input
                    type="text"
                    value={analysisName}
                    onChange={(e) => setAnalysisName(e.target.value)}
                    className="w-full h-9 px-3 rounded-[8px] border border-[#E5E8EB] text-[13px]"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-[#191F28] mb-1">
                    연구 메모 (시편 조건, 시험 규격 등)
                  </label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="예: 실온(23°C), 인장속도 5 mm/min, ASTM D638 규격"
                    className="w-full p-2.5 rounded-[8px] border border-[#E5E8EB] text-[12px]"
                  />
                </div>
              </div>
            </Card>

            {/* Analysis Range & Calculation Controls */}
            <Card className="p-5 space-y-4">
              <div className="font-bold text-[15px] text-[#191F28] flex items-center justify-between border-b border-[#F2F4F6] pb-3">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-[#3182F6]" />
                  <span>분석 구간 및 수치 조건</span>
                </div>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={runAnalysis}
                  disabled={isAnalyzing}
                  className="h-8"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>{isAnalyzing ? "계산 중..." : "재계산"}</span>
                </Button>
              </div>

              {/* Range Slider / Inputs */}
              <div className="space-y-3">
                <div className="flex justify-between items-center text-[13px]">
                  <span className="font-semibold text-[#1E293B]">분석 구간 설정 (행 범위)</span>
                  <span className="text-[#3182F6] font-mono font-bold">
                    {startIndex + 1} ~ {endIndex} 행 (총 {endIndex - startIndex}행)
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-[#64748B] mb-0.5">시작 행</label>
                    <input
                      type="number"
                      min={0}
                      max={endIndex - 1}
                      value={startIndex + 1}
                      onChange={(e) => setStartIndex(Math.max(0, parseInt(e.target.value) - 1 || 0))}
                      className="w-full h-8 px-2.5 rounded-[8px] border border-[#E5E8EB] text-[12px] font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#64748B] mb-0.5">종료 행</label>
                    <input
                      type="number"
                      min={startIndex + 1}
                      max={parsedData.row_count}
                      value={endIndex}
                      onChange={(e) =>
                        setEndIndex(
                          Math.min(parsedData.row_count, Math.max(startIndex + 1, parseInt(e.target.value) || parsedData.row_count))
                        )
                      }
                      className="w-full h-8 px-2.5 rounded-[8px] border border-[#E5E8EB] text-[12px] font-mono"
                    />
                  </div>
                </div>

                {/* Preset button for negative loads */}
                {analysisResult?.negative_load_summary.count ? (
                  <button
                    type="button"
                    onClick={handleExcludeNegativeLoads}
                    className="w-full py-1.5 px-3 rounded-[8px] bg-[#FEF2F2] border border-[#FECACA] text-[#DC2626] text-[11px] font-semibold hover:bg-[#FEE2E2] transition-colors text-left flex items-center justify-between"
                  >
                    <span>⚠️ 음수 하중 33행 제외 구간으로 자동 맞춤</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                ) : null}
              </div>

              {/* Elastic Modulus Range Inputs */}
              <div className="space-y-2 pt-3 border-t border-[#F2F4F6]">
                <div className="text-[13px] font-semibold text-[#1E293B]">
                  탄성계수(E) 회귀 구간 (변형률 %)
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-[#64748B]">시작 변형률 (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={elasticStartPct}
                      onChange={(e) => setElasticStartPct(e.target.value)}
                      className="w-full h-8 px-2 rounded-[8px] border border-[#E5E8EB] text-[12px] font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#64748B]">종료 변형률 (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={elasticEndPct}
                      onChange={(e) => setElasticEndPct(e.target.value)}
                      className="w-full h-8 px-2 rounded-[8px] border border-[#E5E8EB] text-[12px] font-mono"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="chk_offset"
                    checked={calcOffsetYield}
                    onChange={(e) => setCalcOffsetYield(e.target.checked)}
                    className="rounded text-[#3182F6]"
                  />
                  <label htmlFor="chk_offset" className="text-[12px] text-[#334155] cursor-pointer">
                    0.2% 오프셋 내력(Rp0.2) 동시 계산
                  </label>
                </div>
              </div>

              {/* Optional Specimen Dimensions */}
              <div className="space-y-2 pt-3 border-t border-[#F2F4F6]">
                <div className="flex items-center justify-between">
                  <label className="text-[13px] font-semibold text-[#1E293B] cursor-pointer flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={useSpecimenDim}
                      onChange={(e) => setUseSpecimenDim(e.target.checked)}
                      className="rounded text-[#3182F6]"
                    />
                    <span>하중·변위 기반 응력 재계산 (선택)</span>
                  </label>
                </div>
                {useSpecimenDim && (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <label className="block text-[11px] text-[#64748B]">초기 단면적 A0 (mm²)</label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="예: 35.0"
                        value={specimenA0}
                        onChange={(e) => setSpecimenA0(e.target.value)}
                        className="w-full h-8 px-2 rounded-[8px] border border-[#E5E8EB] text-[12px] font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#64748B]">표점거리 L0 (mm)</label>
                      <input
                        type="number"
                        step="0.1"
                        placeholder="예: 50.0"
                        value={specimenL0}
                        onChange={(e) => setSpecimenL0(e.target.value)}
                        className="w-full h-8 px-2 rounded-[8px] border border-[#E5E8EB] text-[12px] font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* Right Column: Graphs & Metrics */}
          <div className="lg:col-span-8 space-y-6">
            {/* Primary Indicators Grid */}
            {analysisResult && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card className="p-4 bg-gradient-to-br from-white to-[#EFF6FF] border-[#BFDBFE]">
                  <div className="text-[12px] font-semibold text-[#3B82F6] flex items-center justify-between">
                    <span>최대 응력 (인장강도)</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#DBEAFE] text-[#1E40AF]">
                      {analysisResult.peak_stress?.source || "파일 제공값"}
                    </span>
                  </div>
                  <div className="text-[22px] font-bold text-[#1E3A8A] mt-1 font-mono">
                    {analysisResult.peak_stress?.stress_MPa} <span className="text-[13px] font-normal">MPa</span>
                  </div>
                  <div className="text-[11px] text-[#64748B] mt-1">
                    원본: {analysisResult.peak_stress?.stress_raw} {analysisResult.peak_stress?.stress_raw_unit}
                  </div>
                  <div className="text-[11px] text-[#2563EB] font-medium">
                    No. {analysisResult.peak_stress?.serial_number} (변형률 {analysisResult.peak_stress?.strain_pct}%)
                  </div>
                </Card>

                <Card className="p-4 bg-white">
                  <div className="text-[12px] font-semibold text-[#64748B]">최대 하중</div>
                  <div className="text-[22px] font-bold text-[#1E293B] mt-1 font-mono">
                    {analysisResult.peak_load?.load_N} <span className="text-[13px] font-normal">N</span>
                  </div>
                  <div className="text-[11px] text-[#64748B] mt-1">
                    원본: {analysisResult.peak_load?.load_raw} {analysisResult.peak_load?.load_raw_unit}
                  </div>
                  <div className="text-[11px] text-[#64748B]">
                    No. {analysisResult.peak_load?.serial_number}
                  </div>
                </Card>

                <Card className="p-4 bg-white">
                  <div className="text-[12px] font-semibold text-[#64748B]">탄성계수 (E)</div>
                  <div className="text-[22px] font-bold text-[#1E293B] mt-1 font-mono">
                    {analysisResult.elastic_modulus?.is_valid
                      ? `${analysisResult.elastic_modulus.E_GPa}`
                      : "제한됨"}
                    <span className="text-[13px] font-normal">
                      {analysisResult.elastic_modulus?.is_valid ? " GPa" : ""}
                    </span>
                  </div>
                  <div className="text-[11px] text-[#64748B] mt-1">
                    {analysisResult.elastic_modulus?.is_valid
                      ? `R² = ${analysisResult.elastic_modulus.r_squared} (${analysisResult.elastic_modulus.point_count}점)`
                      : analysisResult.elastic_modulus?.reason || "구간 재설정 필요"}
                  </div>
                  <div className="text-[11px] text-[#64748B]">
                    구간: {analysisResult.elastic_modulus?.strain_start_pct}% ~{" "}
                    {analysisResult.elastic_modulus?.strain_end_pct}%
                  </div>
                </Card>

                <Card className="p-4 bg-white">
                  <div className="text-[12px] font-semibold text-[#64748B]">0.2% 오프셋 내력</div>
                  <div className="text-[22px] font-bold text-[#1E293B] mt-1 font-mono">
                    {analysisResult.offset_yield?.is_valid
                      ? `${analysisResult.offset_yield.yield_stress_MPa}`
                      : "제한됨"}
                    <span className="text-[13px] font-normal">
                      {analysisResult.offset_yield?.is_valid ? " MPa" : ""}
                    </span>
                  </div>
                  <div className="text-[11px] text-[#64748B] mt-1">
                    {analysisResult.offset_yield?.is_valid
                      ? `변형률 ${analysisResult.offset_yield.yield_strain_pct}% (No. ${analysisResult.offset_yield.serial_number})`
                      : "유효 교점 미확보"}
                  </div>
                  <div className="text-[11px] text-[#059669] font-medium">
                    {analysisResult.offset_yield?.method || "0.2% 오프셋"}
                  </div>
                </Card>
              </div>
            )}

            {/* Warnings and Notes Banners */}
            {analysisResult?.negative_load_summary.count ? (
              <div className="p-3.5 rounded-[14px] bg-[#FFFBEB] border border-[#FDE68A] flex items-start gap-3 text-[#B45309] text-[12px]">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">음수 하중 구간 감지 ({analysisResult.negative_load_summary.count}건)</div>
                  <div className="mt-0.5 leading-relaxed text-[#92400E]">
                    일련번호 No. {analysisResult.negative_load_summary.first_serial} ~{" "}
                    {analysisResult.negative_load_summary.last_serial} 행에서 하중이 음수(&lt; 0)로
                    기록되었습니다. 이는 시험 후반부 시편 파단 또는 크로스헤드 정지 시의 로드셀 영점
                    드리프트일 수 있습니다. 좌측 슬라이더에서 종료 행을 조정하여 제외할 수 있습니다.
                  </div>
                </div>
              </div>
            ) : null}

            {parsedData?.headers.some((h) => h.includes("진응력") || h.includes("진변형")) && (
              <div className="p-3 rounded-[12px] bg-[#F8FAFC] border border-[#E2E8F0] flex items-start gap-2.5 text-[#475569] text-[12px]">
                <Info className="w-4 h-4 text-[#3182F6] shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <strong>진응력·진변형률 열 안내:</strong> 원본 파일에 포함된 진응력·진변형률 값은
                  로드셀/신율계 원시 측정값이 아닌 장비 소프트웨어의 자체 환산값입니다. 산출 가정이
                  확인되지 않았으므로 기본 분석에는 공칭 응력–변형률을 우선 사용하며, 원본 데이터는
                  보존됩니다.
                </div>
              </div>
            )}

            {/* Interactive Graph Card */}
            <Card className="p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F2F4F6] pb-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setChartTab("stress_strain")}
                    className={`px-3 py-1.5 rounded-[8px] text-[13px] font-semibold transition-colors ${
                      chartTab === "stress_strain"
                        ? "bg-[#3182F6] text-white"
                        : "bg-[#F1F5F9] text-[#64748B] hover:bg-[#E2E8F0]"
                    }`}
                  >
                    응력 – 변형률 곡선
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartTab("load_disp")}
                    className={`px-3 py-1.5 rounded-[8px] text-[13px] font-semibold transition-colors ${
                      chartTab === "load_disp"
                        ? "bg-[#3182F6] text-white"
                        : "bg-[#F1F5F9] text-[#64748B] hover:bg-[#E2E8F0]"
                    }`}
                  >
                    하중 – 변위 곡선
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartTab("time_load")}
                    className={`px-3 py-1.5 rounded-[8px] text-[13px] font-semibold transition-colors ${
                      chartTab === "time_load"
                        ? "bg-[#3182F6] text-white"
                        : "bg-[#F1F5F9] text-[#64748B] hover:bg-[#E2E8F0]"
                    }`}
                  >
                    시간 – 하중 곡선
                  </button>
                </div>

                <div className="text-[12px] text-[#64748B]">
                  기준: {chartTab === "stress_strain" ? "공칭 변형률(%) · 공칭 응력(MPa)" : chartTab === "load_disp" ? "변위(mm) · 하중(N)" : "시간(sec) · 하중(N)"}
                </div>
              </div>

              {/* Canvas Plot Container */}
              <div className="w-full h-[360px] bg-[#FAFAFA] rounded-[12px] p-2 relative">
                <canvas ref={canvasRef} className="w-full h-full" />
              </div>
            </Card>

            {/* Rule-Based Numerical Summary Card */}
            {analysisResult && (
              <Card className="p-5 space-y-3 bg-[#F8FAFC]">
                <div className="font-bold text-[14px] text-[#191F28] flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#16A34A]" />
                  <span>규칙 기반 정량 분석 요약 리포트</span>
                </div>
                <div className="text-[13px] leading-relaxed text-[#334155] whitespace-pre-line font-sans">
                  {analysisResult.summary_text}
                </div>
              </Card>
            )}

            {/* Standalone Download Action Bar */}
            {analysisResult && (
              <div className="p-4 rounded-[16px] bg-white border border-[#E5E8EB] flex flex-wrap items-center justify-between gap-3 shadow-sm">
                <div className="text-[13px] font-bold text-[#191F28] flex items-center gap-2">
                  <Download className="w-4 h-4 text-[#3182F6]" />
                  <span>UTM 전용 결과 다운로드</span>
                  <span className="text-[12px] font-normal text-[#6B7684]">마지막 계산 결과 기준 · 조건 변경 후 재계산해주세요.</span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isDownloading || isAnalyzing || isParsing || !analyzedRequest}
                    onClick={() => downloadResult(api.downloadUtmChart)}
                  >
                    <span>그래프 PNG</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isDownloading || isAnalyzing || isParsing || !analyzedRequest}
                    onClick={() => downloadResult(api.downloadUtmCsv)}
                  >
                    <span>변환 데이터 CSV</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isDownloading || isAnalyzing || isParsing || !analyzedRequest}
                    onClick={() => downloadResult(api.downloadUtmJson)}
                  >
                    <span>결과 JSON</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={isDownloading || isAnalyzing || isParsing || !analyzedRequest}
                    onClick={() => downloadResult(api.downloadUtmPdf)}
                  >
                    <span>UTM 리포트 PDF</span>
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
