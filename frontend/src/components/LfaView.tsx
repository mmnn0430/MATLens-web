import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileText,
  Flame,
  FolderOpen,
  Info,
  Layers,
  RefreshCw,
  Share2,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { api } from "../api";
import { PlotlyChart } from "./PlotlyChart";
import { Button, Card } from "./ui/primitives";
import type {
  GroundingData,
  LfaAnalysisResult,
  ProjectDetail,
  ProjectListItem,
  SampleInstrumentRecord,
  ScientificInterpretation,
} from "../types";

export interface LfaBatchItem {
  id: string;
  name: string;
  rawText: string;
  file: File;
  status: "waiting" | "analyzing" | "completed" | "error";
  result?: LfaAnalysisResult;
  error?: string;
  measurementId?: string;
}

interface LfaViewProps {
  activeSample?: ProjectDetail | ProjectListItem | null;
  onRecordSaved?: () => void;
  onNavigateToIntegrated?: () => void;
}

export function LfaView({ activeSample, onRecordSaved, onNavigateToIntegrated }: LfaViewProps = {}) {
  const [sampleRecords, setSampleRecords] = useState<SampleInstrumentRecord[]>([]);
  const [activeMeasurementId, setActiveMeasurementId] = useState<string | null>(null);
  const [uploadedFilename, setUploadedFilename] = useState<string>("lfa_measurement.csv");
  const [rawText, setRawText] = useState<string>("");
  const [thicknessMm, setThicknessMm] = useState<number>(2.5);
  const [densityGCm3, setDensityGCm3] = useState<number | "">(2.6);
  const [specificHeatJGK, setSpecificHeatJGK] = useState<number | "">(0.82);
  const [isLitDensity, setIsLitDensity] = useState<boolean>(false);
  const [isLitCp, setIsLitCp] = useState<boolean>(false);
  const [sampleId, setSampleId] = useState<string>("Pyroceram-Standard");
  const [materialName, setMaterialName] = useState<string>("Pyroceram 9606");
  const [tempC, setTempC] = useState<number>(25);

  // Multi-file batch state & overlay toggles
  const [batchFiles, setBatchFiles] = useState<LfaBatchItem[]>([]);
  const [hiddenCurves, setHiddenCurves] = useState<Record<string, boolean>>({});
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);

  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [result, setResult] = useState<LfaAnalysisResult | null>(null);
  const [grounding, setGrounding] = useState<GroundingData | null>(null);
  const [aiReport, setAiReport] = useState<ScientificInterpretation | null>(null);

  const refreshSampleRecords = useCallback(() => {
    if (!activeSample?.id) {
      setSampleRecords([]);
      return;
    }
    api
      .listSampleRecords(activeSample.id, "lfa")
      .then((res) => setSampleRecords(res.records || []))
      .catch(() => setSampleRecords([]));
  }, [activeSample?.id]);

  useEffect(() => {
    refreshSampleRecords();
    if (activeSample) {
      setSampleId(activeSample.sample_code || activeSample.id);
      setMaterialName(activeSample.expected_formula || activeSample.sample_name);
    }
  }, [activeSample, refreshSampleRecords]);

  const loadBenchmarkSample = () => {
    // Benchmark Pyroceram 9606 standard (2.50 mm thickness, 2.60 g/cm^3, Cp = 0.82 J/g*K)
    const header = `# MatLens Benchmark Pyroceram 9606 Standard\n# Thickness: 2.50 mm | Density: 2.60 g/cm^3 | Cp: 0.82 J/(g*K)\nTime_s,RearTemperature_C\n`;
    const rows = [
      "-0.100,24.50", "-0.050,24.50", "0.000,24.51", "0.050,24.52", "0.100,24.55",
      "0.150,24.65", "0.200,24.80", "0.250,25.02", "0.300,25.30", "0.350,25.62",
      "0.400,25.95", "0.450,26.25", "0.500,26.54", "0.600,27.05", "0.700,27.42",
      "0.800,27.68", "0.900,27.85", "1.000,27.95", "1.200,28.00", "1.500,27.92"
    ];
    setRawText(header + rows.join("\n"));
    setActiveMeasurementId(null);
    setUploadedFilename("sample_pyroceram_9606.csv");
    setThicknessMm(2.5);
    setDensityGCm3(2.6);
    setSpecificHeatJGK(0.82);
    setIsLitDensity(false);
    setIsLitCp(false);
    setSampleId(activeSample?.sample_code || "Pyroceram-Standard");
    setMaterialName(activeSample?.expected_formula || "Pyroceram 9606 Standard");
    setTempC(25);
    setErrorMsg(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 1) {
      const file = files[0];
      setUploadedFilename(file.name);
      setActiveMeasurementId(null);
      const reader = new FileReader();
      reader.onload = (evt) => {
        const content = evt.target?.result as string;
        setRawText(content);
        setErrorMsg(null);
      };
      reader.readAsText(file);
    } else if (files.length > 1) {
      handleMultipleFiles(files);
    }
  };

  const handleMultipleFiles = async (files: File[]) => {
    if (!files || files.length === 0) return;
    setErrorMsg(null);
    setIsBatchProcessing(true);

    const effSampleId = activeSample?.sample_code || sampleId;
    const effMaterialName = activeSample?.expected_formula || materialName;

    const readAsText = (f: File): Promise<string> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (evt) => resolve((evt.target?.result as string) || "");
        reader.onerror = reject;
        reader.readAsText(f);
      });
    };

    const newItems: LfaBatchItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      try {
        const text = await readAsText(f);
        newItems.push({
          id: `lfa_batch_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`,
          name: f.name,
          rawText: text,
          file: f,
          status: "waiting",
        });
      } catch {
        // ignore read error
      }
    }

    setBatchFiles((prev) => [...prev, ...newItems]);

    // Process sequentially for clean failure isolation
    for (const item of newItems) {
      setBatchFiles((prev) =>
        prev.map((b) => (b.id === item.id ? { ...b, status: "analyzing" } : b))
      );
      try {
        const resp = await api.runLfaAnalysis({
          raw_text: item.rawText,
          thickness_mm: thicknessMm,
          density_g_cm3: densityGCm3 === "" ? null : Number(densityGCm3),
          specific_heat_J_gK: specificHeatJGK === "" ? null : Number(specificHeatJGK),
          is_literature_density: isLitDensity,
          is_literature_cp: isLitCp,
          sample_id: effSampleId,
          material_name: effMaterialName,
          measurement_temperature_C: tempC,
          include_ai_interpretation: false,
        });

        let measurementId: string | undefined;
        if (activeSample?.id) {
          const calc = resp.calculated_properties;
          const sumText = `α ${calc.thermal_diffusivity_mm2_s.toFixed(3)} mm²/s · κ ${
            calc.thermal_conductivity_W_mK != null ? calc.thermal_conductivity_W_mK.toFixed(2) : "-"
          } W/m·K (t₁/₂=${calc.half_rise_time_s.toFixed(3)}s)`;

          const saved = await api.saveSampleRecord(activeSample.id, {
            instrument_type: "lfa",
            original_filename: item.name,
            metadata: { temperature_C: tempC, thickness_mm: thicknessMm },
            raw_payload: {
              raw_text: item.rawText,
              thickness_mm: thicknessMm,
              density_g_cm3: densityGCm3,
              specific_heat_J_gK: specificHeatJGK,
              is_literature_density: isLitDensity,
              is_literature_cp: isLitCp,
              measurement_temperature_C: tempC,
              material_name: effMaterialName,
              sample_id: effSampleId,
            },
            parameters: { thicknessMm, densityGCm3, specificHeatJGK, tempC },
            results: resp,
            summary_text: sumText,
          });
          measurementId = saved?.measurement_id;
        }

        setBatchFiles((prev) =>
          prev.map((b) =>
            b.id === item.id
              ? { ...b, status: "completed", result: resp.calculated_properties, measurementId }
              : b
          )
        );

        // Populate detail view if none active
        setResult((curr) => {
          if (!curr) {
            setUploadedFilename(item.name);
            setRawText(item.rawText);
            setGrounding(resp.grounding);
            setAiReport(resp.ai_interpretation);
            if (measurementId) setActiveMeasurementId(measurementId);
            return resp.calculated_properties;
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

  const handleSelectBatchItem = (item: LfaBatchItem) => {
    if (item.result) {
      setUploadedFilename(item.name);
      setRawText(item.rawText);
      setResult(item.result);
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
      "열확산도_alpha(mm^2/s)",
      "열전도도_kappa(W/m*K)",
      "반상승시간_t1_2(s)",
      "최대온도상승_DeltaT(°C)",
      "열손실률(%)",
    ];
    const rows = completed.map((b) => [
      b.name,
      b.result?.thermal_diffusivity_mm2_s?.toFixed(4) ?? "",
      b.result?.thermal_conductivity_W_mK?.toFixed(2) ?? "",
      b.result?.half_rise_time_s?.toFixed(4) ?? "",
      b.result?.max_temp_rise_C?.toFixed(2) ?? "",
      b.result?.heat_loss_ratio ? `${(b.result.heat_loss_ratio * 100).toFixed(1)}%` : "0%",
    ]);
    const content = [
      headers.join(","),
      ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");
    const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lfa_comparison_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const completedBatchItems = useMemo(
    () => batchFiles.filter((b) => b.status === "completed" && b.result),
    [batchFiles]
  );

  const handleLoadRecord = (rec: SampleInstrumentRecord) => {
    setActiveMeasurementId(rec.id);
    setUploadedFilename(rec.original_filename);
    if (rec.raw_payload) {
      if (rec.raw_payload.raw_text) setRawText(rec.raw_payload.raw_text);
      if (rec.raw_payload.thickness_mm) setThicknessMm(rec.raw_payload.thickness_mm);
      if (rec.raw_payload.density_g_cm3 !== undefined) setDensityGCm3(rec.raw_payload.density_g_cm3);
      if (rec.raw_payload.specific_heat_J_gK !== undefined) setSpecificHeatJGK(rec.raw_payload.specific_heat_J_gK);
      if (rec.raw_payload.is_literature_density !== undefined) setIsLitDensity(rec.raw_payload.is_literature_density);
      if (rec.raw_payload.is_literature_cp !== undefined) setIsLitCp(rec.raw_payload.is_literature_cp);
      if (rec.raw_payload.sample_id) setSampleId(rec.raw_payload.sample_id);
      if (rec.raw_payload.material_name) setMaterialName(rec.raw_payload.material_name);
      if (rec.raw_payload.measurement_temperature_C !== undefined) setTempC(rec.raw_payload.measurement_temperature_C);
    }
    const latestAnalysis = rec.analyses?.[0];
    if (latestAnalysis?.results) {
      setResult(latestAnalysis.results.calculated_properties || null);
      setGrounding(latestAnalysis.results.grounding || null);
      setAiReport(latestAnalysis.results.ai_interpretation || null);
    }
  };

  const handleDeleteRecord = async (recId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!activeSample?.id) return;
    if (!window.confirm("이 LFA 측정 기록을 삭제하시겠습니까?")) return;
    try {
      await api.deleteSampleRecord(activeSample.id, recId);
      if (activeMeasurementId === recId) {
        setActiveMeasurementId(null);
      }
      refreshSampleRecords();
      onRecordSaved?.();
    } catch (err: any) {
      alert("삭제 실패: " + err.message);
    }
  };

  const executeAnalysis = async () => {
    if (!rawText.trim()) {
      setErrorMsg("LFA 측정 데이터(CSV/TXT)를 입력하거나 벤치마크 샘플을 로드하세요.");
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const effSampleId = activeSample?.sample_code || sampleId;
      const effMaterialName = activeSample?.expected_formula || materialName;

      const resp = await api.runLfaAnalysis({
        raw_text: rawText,
        thickness_mm: thicknessMm,
        density_g_cm3: densityGCm3 === "" ? null : Number(densityGCm3),
        specific_heat_J_gK: specificHeatJGK === "" ? null : Number(specificHeatJGK),
        is_literature_density: isLitDensity,
        is_literature_cp: isLitCp,
        sample_id: effSampleId,
        material_name: effMaterialName,
        measurement_temperature_C: tempC,
        include_ai_interpretation: true,
      });
      setResult(resp.calculated_properties);
      setGrounding(resp.grounding);
      setAiReport(resp.ai_interpretation);

      // Save to shared measurement storage for continuous cross-instrument integration
      try {
        localStorage.setItem(
          "matlens_shared_lfa_data",
          JSON.stringify({
            sample_id: effSampleId,
            material_name: effMaterialName,
            temperature_C: tempC,
            thermal_diffusivity_mm2_s: resp.calculated_properties.thermal_diffusivity_mm2_s,
            thermal_conductivity_W_mK: resp.calculated_properties.thermal_conductivity_W_mK,
            density_g_cm3: densityGCm3 === "" ? null : Number(densityGCm3),
            specific_heat_J_gK: specificHeatJGK === "" ? null : Number(specificHeatJGK),
            is_literature_density: isLitDensity,
            is_literature_cp: isLitCp,
            timestamp: new Date().toISOString(),
          })
        );
      } catch (e) {
        console.warn("Failed to persist LFA data to localStorage:", e);
      }

      if (activeSample?.id) {
        const calc = resp.calculated_properties;
        const sumText = `α ${calc.thermal_diffusivity_mm2_s.toFixed(3)} mm²/s · κ ${
          calc.thermal_conductivity_W_mK != null ? calc.thermal_conductivity_W_mK.toFixed(2) : "-"
        } W/m·K (t₁/₂=${calc.half_rise_time_s.toFixed(3)}s)`;
        const saved = await api.saveSampleRecord(activeSample.id, {
          measurement_id: activeMeasurementId,
          instrument_type: "lfa",
          original_filename: uploadedFilename || `lfa_${tempC}C.csv`,
          metadata: { temperature_C: tempC, thickness_mm: thicknessMm },
          raw_payload: {
            raw_text: rawText,
            thickness_mm: thicknessMm,
            density_g_cm3: densityGCm3 === "" ? null : Number(densityGCm3),
            specific_heat_J_gK: specificHeatJGK === "" ? null : Number(specificHeatJGK),
            is_literature_density: isLitDensity,
            is_literature_cp: isLitCp,
            sample_id: effSampleId,
            material_name: effMaterialName,
            measurement_temperature_C: tempC,
          },
          parameters: { thicknessMm, densityGCm3, specificHeatJGK, tempC },
          results: resp,
          summary_text: sumText,
        });
        if (saved?.measurement_id) {
          setActiveMeasurementId(saved.measurement_id);
        }
        refreshSampleRecords();
        onRecordSaved?.();
      }
    } catch (err: any) {
      setErrorMsg(err.message || "LFA 분석 실행에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  // Build Plotly figure data
  const plotData: any[] = [];
  if (result) {
    // 1. Raw transient curve
    plotData.push({
      x: result.time_series_s,
      y: result.temp_series_C,
      mode: "markers+lines",
      name: "후면 온도 응답 (Rear Temp)",
      marker: { color: "#3182F6", size: 6 },
      line: { color: "#93C5FD", width: 1.5 },
    });

    // 2. Parker Theoretical Curve
    if (result.fitted_time_s.length > 0) {
      plotData.push({
        x: result.fitted_time_s,
        y: result.fitted_temp_C,
        mode: "lines",
        name: "Parker 1D 이론 곡선",
        line: { color: "#EF4444", width: 2, dash: "dot" },
      });
    }

    // 3. Half-rise time point
    const tHalf = result.half_rise_time_s;
    const yHalf = result.baseline_temp_C + 0.5 * result.max_temp_rise_C;
    plotData.push({
      x: [tHalf],
      y: [yHalf],
      mode: "markers+text",
      name: `t₁/₂ = ${tHalf.toFixed(4)} s`,
      text: [`t₁/₂ (${tHalf.toFixed(3)}s)`],
      textposition: "bottom right",
      marker: { color: "#10B981", size: 10, symbol: "diamond" },
    });
  }

  const plotLayout = {
    title: {
      text: `${sampleId} — LFA Transient Thermogram & Parker Half-Rise Fit`,
      font: { size: 15, family: "Pretendard, sans-serif" },
    },
    xaxis: {
      title: "Time t (s)",
      showgrid: true,
      zeroline: true,
      zerolinecolor: "#CBD5E1",
      gridcolor: "#F1F5F9",
    },
    yaxis: {
      title: "Rear Surface Temperature T (°C)",
      showgrid: true,
      zeroline: true,
      zerolinecolor: "#CBD5E1",
      gridcolor: "#F1F5F9",
    },
    legend: { orientation: "h", y: -0.25 },
    margin: { t: 50, r: 30, b: 60, l: 60 },
    paper_bgcolor: "#FFFFFF",
    plot_bgcolor: "#FAFAFA",
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Title */}
      <div className="bg-white rounded-[20px] p-6 border border-[#E5E8EB] shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#FEF3C7] text-[#D97706] text-[12px] font-bold mb-2">
            <Flame className="w-3.5 h-3.5" />
            MatLens 2.0 Module
          </div>
          <h2 className="text-[22px] font-bold text-[#191F28]">LFA (Laser Flash Analysis) 열물성 정량 분석</h2>
          <p className="text-[14px] text-[#6B7684] mt-1">
            과도 온도 응답 곡선(Thermogram)에서 Parker 반상승 시간(t₁/₂)을 구하여 열확산도(α) 및 열전도도(κ = α·ρ·Cp)를 계산하고 학술 근거와 대조합니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={loadBenchmarkSample}
            className="px-4 py-2 rounded-[12px] bg-[#F2F4F6] hover:bg-[#E5E8EB] text-[#333D4B] text-[13px] font-semibold transition flex items-center gap-1.5 cursor-pointer"
          >
            <Activity className="w-4 h-4 text-[#D97706]" />
            벤치마크 Pyroceram 샘플 로드
          </button>
          <label className="px-4 py-2 rounded-[12px] bg-[#D97706] hover:bg-[#B45309] text-white text-[13px] font-bold transition flex items-center gap-1.5 cursor-pointer shadow-sm">
            <Upload className="w-4 h-4" />
            <span>{isBatchProcessing ? "파일 분석 중..." : "LFA 파일 복수 업로드"}</span>
            <input
              type="file"
              multiple
              accept=".csv,.txt,.dat"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* Active Sample Linked Measurements */}
      {activeSample && sampleRecords.length > 0 && (
        <div className="bg-white px-5 py-3.5 rounded-[16px] border border-[#E5E8EB] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-[#191F28]">
            <FolderOpen className="w-4 h-4 text-[#D97706]" />
            <span>
              선택 시료(<strong>{activeSample.sample_name}</strong> · ID: {activeSample.sample_code || activeSample.id})에 연결된 LFA 측정 기록 ({sampleRecords.length}건):
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
                      ? "bg-[#FEF3C7] border-[#D97706] text-[#B45309] font-bold"
                      : "bg-[#F8FAFC] hover:bg-[#FEF3C7]/50 border-[#E5E8EB] text-[#191F28]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleLoadRecord(rec)}
                    className="cursor-pointer"
                  >
                    📄 {rec.original_filename}
                    {latestAnalysis?.summary_text ? ` · ${latestAnalysis.summary_text}` : ""}
                  </button>
                  <button
                    type="button"
                    title="이 측정 기록 삭제"
                    onClick={(e) => handleDeleteRecord(rec.id, e)}
                    className="text-[#8B95A1] hover:text-[#DC2626] ml-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
            {activeMeasurementId && (
              <button
                type="button"
                onClick={() => {
                  setActiveMeasurementId(null);
                  setUploadedFilename("lfa_measurement.csv");
                }}
                className="px-2.5 py-1 rounded-[8px] bg-[#F2F4F6] text-[#4E5968] text-[11px] font-semibold hover:bg-[#E5E8EB] cursor-pointer"
              >
                + 새 파일로 추가하기
              </button>
            )}
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-[16px] bg-[#FEE2E2] border border-[#FECACA] p-4 text-[13px] text-[#DC2626] flex justify-between items-center">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} className="font-semibold underline cursor-pointer">
            닫기
          </button>
        </div>
      )}

      {/* Batch Files Queue / Active List */}
      {batchFiles.length > 0 && (
        <Card className="p-5 space-y-4 bg-white border border-[#E5E8EB]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F2F4F6] pb-3">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-[#D97706]" />
              <span className="font-bold text-[14px] text-[#191F28]">
                업로드된 LFA 측정 파일 목록 ({batchFiles.length}개)
              </span>
              <span className="text-[11px] text-[#6B7684]">
                완료 {completedBatchItems.length}개 · 분석 중 {batchFiles.filter((b) => b.status === "analyzing").length}개
              </span>
            </div>
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12px] font-bold text-[#D97706] bg-[#FEF3C7] hover:bg-[#FDE68A] border border-[#FCD34D] transition-colors cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              <span>추가 파일 업로드</span>
              <input
                type="file"
                multiple
                accept=".csv,.txt,.dat"
                className="hidden"
                onChange={handleFileUpload}
              />
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {batchFiles.map((b) => {
              const isSelected = uploadedFilename === b.name;
              return (
                <div
                  key={b.id}
                  className={`p-3.5 rounded-[12px] border transition-all flex flex-col justify-between gap-2.5 ${
                    isSelected
                      ? "bg-[#FEF3C7]/60 border-[#D97706] shadow-xs"
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
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#FEF3C7] text-[#B45309] flex items-center gap-1 shrink-0">
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
                      <div>열확산도 α: <strong className="text-[#D97706]">{b.result.thermal_diffusivity_mm2_s?.toFixed(3)} mm²/s</strong></div>
                      <div>열전도도 κ: <strong className="text-[#1D4ED8]">{b.result.thermal_conductivity_W_mK != null ? `${b.result.thermal_conductivity_W_mK.toFixed(2)} W/m·K` : "-"}</strong></div>
                      <div>t₁/₂: <strong className="text-[#059669]">{b.result.half_rise_time_s?.toFixed(4)} s</strong></div>
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
                          isSelected ? "text-[#D97706]" : "text-[#64748B] hover:text-[#191F28]"
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
        <Card className="p-5 space-y-5 border-2 border-[#FDE68A] bg-gradient-to-br from-white to-[#FFFBEB]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#FCD34D] pb-4">
            <div>
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-[#D97706]" />
                <h3 className="text-[17px] font-bold text-[#191F28]">
                  다중 LFA 과도 온도 곡선 중첩 및 열물성 정량 비교 ({completedBatchItems.length}개 파일)
                </h3>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#FEF3C7] text-[#B45309] border border-[#FDE68A]">
                  Parker 모델 수치 계산 완료
                </span>
              </div>
              <p className="text-[12px] text-[#6B7684] mt-1">
                각 측정 파일의 시간에 따른 후면 온도 상승 응답 곡선(Thermogram)을 중첩 비교하고 열확산도(α)와 열전도도(κ)를 대조합니다.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleDownloadComparisonCsv}
                className="text-[12px] font-bold text-[#B45309] border-[#FCD34D] hover:bg-[#FEF3C7]"
              >
                <Download className="w-3.5 h-3.5 mr-1 text-[#D97706]" />
                비교표 CSV 내보내기
              </Button>
            </div>
          </div>

          {/* Visibility toggle pills */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-semibold text-[#6B7684]">표시 곡선 선택:</span>
            {completedBatchItems.map((b, idx) => {
              const colors = ["#D97706", "#2563EB", "#10B981", "#EF4444", "#8B5CF6", "#06B6D4", "#EC4899", "#84CC16"];
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
                  const colors = ["#D97706", "#2563EB", "#10B981", "#EF4444", "#8B5CF6", "#06B6D4", "#EC4899", "#84CC16"];
                  const color = colors[idx % colors.length];
                  return {
                    x: b.result?.time_series_s || [],
                    y: b.result?.temp_series_C || [],
                    type: "scatter",
                    mode: "lines",
                    name: b.name,
                    line: { color, width: 2.2 },
                    hovertemplate: `<b>${b.name}</b><br>시간: %{x:.3f} s<br>온도: %{y:.2f} °C<extra></extra>`,
                  };
                })}
              layout={{
                title: { text: "다중 LFA 과도 온도 곡선 중첩 (Transient Thermogram Overlay)", font: { size: 14 } },
                xaxis: { title: "시간 Time t (s)", gridcolor: "#F1F5F9" },
                yaxis: { title: "후면 온도 Rear Temp T (°C)", gridcolor: "#F1F5F9" },
                hovermode: "closest",
                legend: { orientation: "h", y: -0.2 },
                margin: { l: 60, r: 20, t: 40, b: 60 },
                autosize: true,
              }}
              style={{ width: "100%", height: "400px" }}
            />
          </div>

          {/* Quantitative Comparison Table */}
          <div className="overflow-x-auto rounded-[12px] border border-[#E5E8EB] bg-white">
            <table className="w-full text-left text-[12px] border-collapse">
              <thead>
                <tr className="bg-[#F8FAFC] border-b border-[#E5E8EB] text-[#475569] font-bold">
                  <th className="py-2.5 px-3">파일명</th>
                  <th className="py-2.5 px-3">열확산도 α (mm²/s)</th>
                  <th className="py-2.5 px-3">열전도도 κ (W/m·K)</th>
                  <th className="py-2.5 px-3">반상승 시간 t₁/₂ (s)</th>
                  <th className="py-2.5 px-3">최대온도상승 ΔT (°C)</th>
                  <th className="py-2.5 px-3">열손실률</th>
                  <th className="py-2.5 px-3">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {completedBatchItems.map((b) => (
                  <tr key={b.id} className="hover:bg-[#F8FAFC]">
                    <td className="py-2.5 px-3 font-semibold text-[#191F28] flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-[#D97706]" />
                      <span>{b.name}</span>
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold text-[#D97706]">
                      {b.result?.thermal_diffusivity_mm2_s ? `${b.result.thermal_diffusivity_mm2_s.toFixed(3)} mm²/s` : "-"}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold text-[#1D4ED8]">
                      {b.result?.thermal_conductivity_W_mK != null ? `${b.result.thermal_conductivity_W_mK.toFixed(2)} W/m·K` : "Cp/밀도 필요"}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[#059669]">
                      {b.result?.half_rise_time_s ? `${b.result.half_rise_time_s.toFixed(4)} s` : "-"}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[#DC2626]">
                      {b.result?.max_temp_rise_C ? `${b.result.max_temp_rise_C.toFixed(2)} °C` : "-"}
                    </td>
                    <td className="py-2.5 px-3 text-[11px] text-[#475569]">
                      {b.result?.heat_loss_ratio ? (
                        <span className="text-[#D97706] font-semibold">{(b.result.heat_loss_ratio * 100).toFixed(1)}%</span>
                      ) : (
                        <span className="text-[#059669]">단열(Parker)</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <button
                        type="button"
                        onClick={() => handleSelectBatchItem(b)}
                        className="px-2 py-1 rounded-[6px] text-[11px] font-bold bg-[#FEF3C7] text-[#B45309] hover:bg-[#FDE68A] cursor-pointer"
                      >
                        상세 보기
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Input Configuration & File Area */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white rounded-[20px] p-6 border border-[#E5E8EB] shadow-sm space-y-4">
          <h3 className="text-[16px] font-bold text-[#191F28] flex items-center gap-2">
            <Upload className="w-4 h-4 text-[#D97706]" />
            측정 조건 및 물성치 입력
          </h3>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">
                공통 시료 ID (Sample ID)
              </label>
              <input
                type="text"
                value={activeSample ? activeSample.sample_code || activeSample.id : sampleId}
                readOnly={Boolean(activeSample)}
                onChange={(e) => setSampleId(e.target.value)}
                className={`w-full px-3 py-2 rounded-[10px] border border-[#E5E8EB] text-[13px] font-mono ${
                  activeSample ? "bg-[#F8FAFC] text-[#B45309] font-bold" : ""
                }`}
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">재료명 / 화학식</label>
              <input
                type="text"
                value={activeSample ? activeSample.expected_formula || activeSample.sample_name : materialName}
                onChange={(e) => setMaterialName(e.target.value)}
                className="w-full px-3 py-2 rounded-[10px] border border-[#E5E8EB] text-[13px]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">시편 두께 L (mm) *필수</label>
              <input
                type="number"
                step="0.01"
                value={thicknessMm}
                onChange={(e) => setThicknessMm(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-[10px] border border-[#E5E8EB] text-[13px] font-bold text-[#191F28]"
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">측정 온도 (°C)</label>
              <input
                type="number"
                value={tempC}
                onChange={(e) => setTempC(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-[10px] border border-[#E5E8EB] text-[13px]"
              />
            </div>
          </div>

          <div className="p-3 bg-[#FFFBEB] rounded-[12px] border border-[#FDE68A] space-y-2">
            <span className="text-[12px] font-bold text-[#92400E] block flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 text-[#D97706]" />
              열전도도(κ) 계산을 위한 보조 입력 (미입력 시 열확산도만 산출)
            </span>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-[#78350F] mb-1">밀도 ρ (g/cm³)</label>
                <input
                  type="number"
                  step="0.01"
                  value={densityGCm3}
                  onChange={(e) => setDensityGCm3(e.target.value === "" ? "" : Number(e.target.value))}
                  placeholder="미입력 시 보류"
                  className="w-full px-2.5 py-1.5 rounded-[8px] border border-[#FCD34D] bg-white text-[12px]"
                />
                <label className="flex items-center gap-1.5 mt-1 cursor-pointer text-[11px] text-[#92400E]">
                  <input
                    type="checkbox"
                    checked={isLitDensity}
                    onChange={(e) => setIsLitDensity(e.target.checked)}
                    className="rounded text-[#D97706]"
                  />
                  <span>문헌 추정값 (기공률 주의)</span>
                </label>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#78350F] mb-1">비열 Cp (J/g·K)</label>
                <input
                  type="number"
                  step="0.01"
                  value={specificHeatJGK}
                  onChange={(e) => setSpecificHeatJGK(e.target.value === "" ? "" : Number(e.target.value))}
                  placeholder="미입력 시 보류"
                  className="w-full px-2.5 py-1.5 rounded-[8px] border border-[#FCD34D] bg-white text-[12px]"
                />
                <label className="flex items-center gap-1.5 mt-1 cursor-pointer text-[11px] text-[#92400E]">
                  <input
                    type="checkbox"
                    checked={isLitCp}
                    onChange={(e) => setIsLitCp(e.target.checked)}
                    className="rounded text-[#D97706]"
                  />
                  <span>문헌 추정값 승인</span>
                </label>
              </div>
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-[12px] font-semibold text-[#4E5968]">원시 과도 온도(Time vs Rear Temp) 데이터</label>
              <label className="text-[12px] text-[#D97706] font-semibold cursor-pointer hover:underline">
                파일 찾기 (CSV/TXT · 복수 선택 가능)
                <input type="file" multiple accept=".csv,.txt,.dat" onChange={handleFileUpload} className="hidden" />
              </label>
            </div>
            <textarea
              rows={7}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder="Time_s,RearTemperature_C&#10;-0.1, 24.5&#10;0.45, 26.25..."
              className="w-full px-3 py-2 rounded-[10px] border border-[#E5E8EB] font-mono text-[12px] bg-[#F8FAFC]"
            />
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={executeAnalysis}
            className="w-full py-3 rounded-[12px] bg-[#D97706] hover:bg-[#B45309] text-white text-[14px] font-bold transition flex justify-center items-center gap-2 cursor-pointer shadow"
          >
            {loading ? "Parker 모델 피팅 및 근거 검증 중..." : "LFA 열물성 분석 및 AI 검증 실행"}
          </button>
        </div>

        {/* Graph and Summary Results */}
        <div className="lg:col-span-7 bg-white rounded-[20px] p-6 border border-[#E5E8EB] shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-[16px] font-bold text-[#191F28] mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-[#D97706]" />
                LFA 과도 응답 곡선 & 반상승점(t₁/₂) 검출
              </span>
              {result && (
                <span className="text-[12px] font-medium text-[#6B7684]">
                  반상승 시간 t₁/₂ = <strong className="text-[#191F28]">{result.half_rise_time_s.toFixed(4)} s</strong>
                </span>
              )}
            </h3>

            {result ? (
              <div className="rounded-[12px] border border-[#E5E8EB] overflow-hidden bg-white">
                <PlotlyChart data={plotData} layout={plotLayout} config={{ responsive: true }} style={{ width: "100%", height: "340px" }} />
              </div>
            ) : (
              <div className="h-[340px] rounded-[12px] bg-[#F8FAFC] border border-dashed border-[#CBD5E1] flex flex-col items-center justify-center text-[#94A3B8] text-[13px] gap-2">
                <Info className="w-6 h-6 text-[#94A3B8]" />
                왼쪽에서 LFA 과도 응답 데이터를 로드하고 분석을 실행하면 인터랙티브 온도 상승 그래프가 생성됩니다.
              </div>
            )}
          </div>

          {/* Quick Quantitative Table */}
          {result && (
            <div className="mt-4 space-y-2">
              {result.missing_inputs.length > 0 && (
                <div className="p-3 bg-[#FEF2F2] rounded-[10px] border border-[#FCA5A5] text-[12px] text-[#B91C1C] flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>
                    <strong>열전도도 계산 보류:</strong> {result.missing_inputs.join(", ")} 입력이 누락되었습니다. 열확산도(α)는 정상 계산되었습니다.
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#F8FAFC] p-3.5 rounded-[14px] border border-[#E2E8F0]">
                <div>
                  <span className="text-[11px] font-semibold text-[#64748B] block">열확산도 (α)</span>
                  <span className="text-[14px] font-bold text-[#D97706]">{result.thermal_diffusivity_mm2_s.toFixed(3)} mm²/s</span>
                </div>
                <div>
                  <span className="text-[11px] font-semibold text-[#64748B] block">열전도도 (κ)</span>
                  <span className="text-[14px] font-bold text-[#1E293B]">
                    {result.thermal_conductivity_W_mK !== null ? `${result.thermal_conductivity_W_mK.toFixed(2)} W/m·K` : "입력 보류"}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] font-semibold text-[#64748B] block">반상승 시간 (t₁/₂)</span>
                  <span className="text-[14px] font-bold text-[#1E293B]">{result.half_rise_time_s.toFixed(4)} s</span>
                </div>
                <div>
                  <span className="text-[11px] font-semibold text-[#64748B] block">최대 온도 상승 (ΔT)</span>
                  <span className="text-[14px] font-bold text-[#1E293B]">{result.max_temp_rise_C.toFixed(2)} °C</span>
                </div>
              </div>

              {/* Continuous Integration Flow Banner */}
              <div className="p-3.5 rounded-[12px] bg-[#FFFBEB] border border-[#FDE68A] flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#D97706] shrink-0" />
                  <span className="text-[12px] text-[#92400E] font-medium">
                    LFA 열물성 데이터가 <strong>'통합 리포트'</strong>에 자동 연계되었습니다. (열확산도: {result.thermal_diffusivity_mm2_s.toFixed(3)} mm²/s)
                  </span>
                </div>
                {onNavigateToIntegrated && (
                  <button
                    type="button"
                    onClick={onNavigateToIntegrated}
                    className="px-3 py-1 rounded-[8px] bg-[#D97706] hover:bg-[#B45309] text-white text-[11px] font-bold transition flex items-center gap-1 shrink-0 cursor-pointer shadow-sm"
                  >
                    <Share2 className="w-3 h-3" />
                    통합 리포트에서 교차 분석 →
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Grounding & Evidence Panel */}
      {grounding && (
        <div className="bg-white rounded-[20px] p-6 border border-[#E5E8EB] shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
            <h3 className="text-[16px] font-bold text-[#191F28] flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-[#D97706]" />
              학술 논문 기반 열물성 검증 (Thermal Transport Grounding)
            </h3>
            <span className="px-2.5 py-0.5 rounded-full text-[12px] font-semibold bg-[#DCFCE7] text-[#16A34A]">
              DOI 검증 완료
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {grounding.grounded_claims.map((claim, idx) => (
              <div key={idx} className="p-3.5 rounded-[12px] border border-[#E2E8F0] bg-[#FAFAFA] space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-[#FEF3C7] text-[#B45309]">
                    [{claim.category}]
                  </span>
                  {claim.doi && (
                    <a
                      href={`https://doi.org/${claim.doi}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] font-medium text-[#3182F6] hover:underline"
                    >
                      DOI: {claim.doi}
                    </a>
                  )}
                </div>
                <p className="text-[13px] text-[#1E293B] font-medium leading-relaxed">{claim.claim_text}</p>
                {claim.limitation_note && (
                  <span className="text-[11px] text-[#64748B] block italic">
                    * 한계 조건: {claim.limitation_note}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Structured 12-Section Vertex AI Scientific Report */}
      {aiReport && (
        <div className="bg-white rounded-[20px] p-6 border border-[#E5E8EB] shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
            <h3 className="text-[16px] font-bold text-[#191F28] flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[#8B5CF6]" />
              Vertex AI LFA 정밀 열전달 리포트
            </h3>
            <span className="text-[12px] text-[#6B7684] font-medium">{aiReport.ai_engine}</span>
          </div>

          <div className="space-y-4 text-[13px] text-[#334155] leading-relaxed">
            <div>
              <h4 className="font-bold text-[#0F172A] mb-1">1. 분석 요약 (Analysis Summary)</h4>
              <p className="bg-[#F8FAFC] p-3 rounded-[10px] border border-[#E2E8F0]">{aiReport.analysis_summary}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="font-bold text-[#0F172A] mb-1">5. 과도 응답 곡선 해석 (Thermogram Interpretation)</h4>
                <p className="bg-[#F8FAFC] p-3 rounded-[10px] border border-[#E2E8F0]">{aiReport.graph_interpretation}</p>
              </div>
              <div>
                <h4 className="font-bold text-[#0F172A] mb-1">8. 포논 열수송 메커니즘 (Phonon Scattering Discussion)</h4>
                <p className="bg-[#F8FAFC] p-3 rounded-[10px] border border-[#E2E8F0]">{aiReport.mechanism_discussion}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="font-bold text-[#0F172A] mb-1">9. 대체 가설 및 미세조직 영향 (Microstructure & Porosity)</h4>
                <p className="bg-[#F8FAFC] p-3 rounded-[10px] border border-[#E2E8F0]">{aiReport.alternative_explanations}</p>
              </div>
              <div>
                <h4 className="font-bold text-[#0F172A] mb-1">10. 한계 및 측정 불확도 (Limitations & Uncertainty)</h4>
                <p className="bg-[#F8FAFC] p-3 rounded-[10px] border border-[#E2E8F0]">{aiReport.limitations_and_uncertainty}</p>
              </div>
            </div>

            <div>
              <h4 className="font-bold text-[#0F172A] mb-1">11. 제안하는 추가 검증 실험 (Suggested Next Steps)</h4>
              <ul className="list-disc pl-5 space-y-1 bg-[#F8FAFC] p-3 rounded-[10px] border border-[#E2E8F0]">
                {aiReport.suggested_additional_experiments.map((exp, idx) => (
                  <li key={idx} className="font-medium">{exp}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
