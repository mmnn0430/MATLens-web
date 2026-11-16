import { useCallback, useState } from "react";
import {
  Activity,
  AlertCircle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileSpreadsheet,
  FlaskConical,
  Layers,
  Play,
  RefreshCw,
  Sliders,
  Sparkles,
  Upload,
} from "lucide-react";
import { api } from "../api";
import { PlotlyChart } from "./PlotlyChart";
import { Button, Card, cn } from "./ui/primitives";

export type SpectroInstrument = "ftir" | "dsc" | "tga";

interface SpectroViewProps {
  initialInstrument?: SpectroInstrument;
}

export function SpectroView({ initialInstrument = "ftir" }: SpectroViewProps) {
  const [instrument, setInstrument] = useState<SpectroInstrument>(initialInstrument);

  // File & Parsing state
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<any | null>(null);
  const [analysisResult, setAnalysisResult] = useState<any | null>(null);
  const [aiReport, setAiReport] = useState<any | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sampleLoadedName, setSampleLoadedName] = useState<string>("");

  // Formula drawer state
  const [showFormulaDrawer, setShowFormulaDrawer] = useState(false);

  // Comparison store
  const [compareItems, setCompareItems] = useState<any[]>([]);
  const [compareTable, setCompareTable] = useState<any[]>([]);

  // ─────────────────────────────────────────────────────────────────────────
  // Instrument Conditions
  // ─────────────────────────────────────────────────────────────────────────
  // FT-IR conditions
  const [ftirSignalType, setFtirSignalType] = useState<"transmittance" | "absorbance">("transmittance");
  const [ftirRefractiveIndex, setFtirRefractiveIndex] = useState<string>("1.59");
  const [ftirFringeMinWn, setFtirFringeMinWn] = useState<string>("2400");
  const [ftirFringeMaxWn, setFtirFringeMaxWn] = useState<string>("2750");
  const [ftirProminence, setFtirProminence] = useState<string>("1.5");
  const [ftirUseSmoothing, setFtirUseSmoothing] = useState(false);
  const [ftirUseBaseline, setFtirUseBaseline] = useState(false);

  // DSC conditions
  const [dscSampleMassMg, setDscSampleMassMg] = useState<string>("8.50");
  const [dscHeatFlowUnit, setDscHeatFlowUnit] = useState<string>("mW");
  const [dscStdEnthalpy, setDscStdEnthalpy] = useState<string>("140.0");
  const [dscPolymerFraction, setDscPolymerFraction] = useState<string>("1.0");
  const [dscSelectedSegmentId, setDscSelectedSegmentId] = useState<string>("");

  // TGA conditions
  const [tgaInitialMassMg, setTgaInitialMassMg] = useState<string>("10.00");
  const [tgaGasSwitchTemp, setTgaGasSwitchTemp] = useState<string>("600.0");
  const [tgaInputIsPercent, setTgaInputIsPercent] = useState<boolean>(true);

  // User notes
  const [userNotes] = useState<string>("");

  // ─────────────────────────────────────────────────────────────────────────
  // Handlers
  // ─────────────────────────────────────────────────────────────────────────

  // Switch instrument
  const handleInstrumentChange = (newInst: SpectroInstrument) => {
    if (newInst === instrument) return;
    setInstrument(newInst);
    setFile(null);
    setParsedData(null);
    setAnalysisResult(null);
    setAiReport(null);
    setErrorMsg(null);
    setSampleLoadedName("");
  };

  // Load benchmark sample
  const handleLoadBenchmark = async () => {
    setIsParsing(true);
    setErrorMsg(null);
    setAnalysisResult(null);
    setAiReport(null);
    try {
      const sample = await api.getSpectroSample(instrument);
      setSampleLoadedName(sample.sample_name);

      // Create dummy File object from csv_content
      const blob = new Blob([sample.csv_content], { type: "text/csv" });
      const sampleFile = new File([blob], sample.filename, { type: "text/csv" });
      setFile(sampleFile);

      // Parse
      const parsed = await api.parseSpectroFile(instrument, sampleFile);
      setParsedData(parsed);

      // Apply recommended conditions
      const rec = sample.recommended_conditions || {};
      if (instrument === "ftir") {
        if (rec.refractive_index) setFtirRefractiveIndex(String(rec.refractive_index));
        if (rec.fringe_min_wn) setFtirFringeMinWn(String(rec.fringe_min_wn));
        if (rec.fringe_max_wn) setFtirFringeMaxWn(String(rec.fringe_max_wn));
        if (rec.min_prominence) setFtirProminence(String(rec.min_prominence));
      } else if (instrument === "dsc") {
        if (rec.sample_mass_mg) setDscSampleMassMg(String(rec.sample_mass_mg));
        if (rec.standard_melting_enthalpy_J_per_g) setDscStdEnthalpy(String(rec.standard_melting_enthalpy_J_per_g));
      } else if (instrument === "tga") {
        if (rec.initial_mass_mg) setTgaInitialMassMg(String(rec.initial_mass_mg));
        if (rec.gas_switch_temp_c) setTgaGasSwitchTemp(String(rec.gas_switch_temp_c));
      }

      // Auto run analysis
      await executeAnalysis(parsed, sample.filename, rec);
    } catch (err: any) {
      setErrorMsg(err?.message || "샘플 데이터를 불러오는데 실패했습니다.");
    } finally {
      setIsParsing(false);
    }
  };

  // Parse uploaded file
  const handleFileUpload = async (uploadedFile: File) => {
    setFile(uploadedFile);
    setIsParsing(true);
    setErrorMsg(null);
    setAnalysisResult(null);
    setAiReport(null);
    setSampleLoadedName("");
    try {
      const parsed = await api.parseSpectroFile(instrument, uploadedFile);
      setParsedData(parsed);
      await executeAnalysis(parsed, uploadedFile.name);
    } catch (err: any) {
      setErrorMsg(err?.message || "파일 파싱에 실패했습니다.");
    } finally {
      setIsParsing(false);
    }
  };

  // Run numerical calculation
  const executeAnalysis = useCallback(
    async (parsed?: any, filename?: string, condOverrides?: any) => {
      const p = parsed || parsedData;
      if (!p) return;

      setIsAnalyzing(true);
      setErrorMsg(null);
      try {
        let conditions: Record<string, any> = {};

        if (instrument === "ftir") {
          conditions = {
            signal_type: ftirSignalType,
            refractive_index: parseFloat(ftirRefractiveIndex) > 0 ? parseFloat(ftirRefractiveIndex) : null,
            fringe_min_wn: parseFloat(ftirFringeMinWn) || 2400.0,
            fringe_max_wn: parseFloat(ftirFringeMaxWn) || 2750.0,
            fringe_prominence: parseFloat(ftirProminence) || 1.5,
            use_smoothing: ftirUseSmoothing,
            use_baseline_correction: ftirUseBaseline,
            ...(condOverrides || {}),
          };
        } else if (instrument === "dsc") {
          conditions = {
            sample_mass_mg: parseFloat(dscSampleMassMg) > 0 ? parseFloat(dscSampleMassMg) : null,
            heat_flow_unit: dscHeatFlowUnit,
            standard_melting_enthalpy_J_per_g:
              parseFloat(dscStdEnthalpy) > 0 ? parseFloat(dscStdEnthalpy) : null,
            polymer_mass_fraction: parseFloat(dscPolymerFraction) || 1.0,
            selected_segment_id: dscSelectedSegmentId || undefined,
            ...(condOverrides || {}),
          };
        } else if (instrument === "tga") {
          conditions = {
            initial_mass_mg: parseFloat(tgaInitialMassMg) > 0 ? parseFloat(tgaInitialMassMg) : null,
            gas_switch_temp_c: parseFloat(tgaGasSwitchTemp) > 0 ? parseFloat(tgaGasSwitchTemp) : null,
            input_is_percent: tgaInputIsPercent,
            ...(condOverrides || {}),
          };
        }

        const res = await api.analyzeSpectro(instrument, {
          filename: filename || file?.name || `${instrument}_data.csv`,
          columns: p.columns,
          column_data: p.column_data,
          conditions,
          notes: userNotes,
        });

        setAnalysisResult(res.analysis);

        // If DSC has segments and none selected, auto-sync active segment
        if (instrument === "dsc" && res.analysis.active_segment && !dscSelectedSegmentId) {
          setDscSelectedSegmentId(res.analysis.active_segment.id);
        }
      } catch (err: any) {
        setErrorMsg(err?.message || "분석 계산 중 오류가 발생했습니다.");
      } finally {
        setIsAnalyzing(false);
      }
    },
    [
      instrument,
      parsedData,
      file,
      userNotes,
      ftirSignalType,
      ftirRefractiveIndex,
      ftirFringeMinWn,
      ftirFringeMaxWn,
      ftirProminence,
      ftirUseSmoothing,
      ftirUseBaseline,
      dscSampleMassMg,
      dscHeatFlowUnit,
      dscStdEnthalpy,
      dscPolymerFraction,
      dscSelectedSegmentId,
      tgaInitialMassMg,
      tgaGasSwitchTemp,
      tgaInputIsPercent,
    ]
  );

  // Request AI Interpretation
  const handleRequestAi = async () => {
    if (!analysisResult) return;
    setIsAiLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.interpretSpectroAi(instrument, {
        analysis_result: analysisResult,
        user_notes: userNotes,
      });
      setAiReport(res.report);
    } catch (err: any) {
      setErrorMsg(err?.message || "AI 해석 생성에 실패했습니다.");
    } finally {
      setIsAiLoading(false);
    }
  };

  // Add to Compare list
  const handleAddToCompare = () => {
    if (!analysisResult) return;
    const name = sampleLoadedName || file?.name || `${instrument}_sample_${compareItems.length + 1}`;
    const newItem = {
      sample_id: `sample_${Date.now()}`,
      sample_name: name,
      instrument,
      analysis_result: analysisResult,
      visible: true,
      y_offset: 0,
    };
    const nextList = [...compareItems, newItem];
    setCompareItems(nextList);
    api.compareSpectro(instrument, nextList).then((res) => {
      setCompareTable(res.comparison_table || []);
    });
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Chart Data Assembly (Plotly)
  // ─────────────────────────────────────────────────────────────────────────

  const renderPlotlyData = () => {
    if (!analysisResult) return { data: [], layout: {} };

    if (instrument === "ftir") {
      const wn = analysisResult.wavenumbers || [];
      const sig =
        ftirSignalType === "absorbance" ? analysisResult.absorbance || [] : analysisResult.transmittance_pct || [];
      const sigLabel = ftirSignalType === "absorbance" ? "흡광도 (A)" : "투과율 (%T)";

      const traces: any[] = [
        {
          x: wn,
          y: sig,
          type: "scatter",
          mode: "lines",
          name: sigLabel,
          line: { color: "#2563EB", width: 1.8 },
          hovertemplate: "%{x:.1f} cm⁻¹: %{y:.2f}<extra></extra>",
        },
      ];

      // Detected Peaks Scatter
      const peaks = analysisResult.peaks || [];
      if (peaks.length > 0) {
        const px = peaks.map((p: any) => p.wavenumber);
        const py = peaks.map((p: any) =>
          ftirSignalType === "absorbance" ? p.absorbance : p.transmittance_pct
        );
        const ptext = peaks.map((p: any) => {
          const fgs = (p.functional_groups || []).map((g: any) => g.name).join(", ");
          return `피크: ${p.wavenumber.toFixed(1)} cm⁻¹<br>${fgs ? `작용기: ${fgs}` : ""}`;
        });
        traces.push({
          x: px,
          y: py,
          type: "scatter",
          mode: "markers",
          name: `검출 피크 (${peaks.length}개)`,
          marker: { color: "#DC2626", size: 7, symbol: "circle" },
          text: ptext,
          hoverinfo: "text",
        });
      }

      // Interference Fringe Region Box
      const fringes = analysisResult.fringes || {};
      const fRange = fringes.nu_range_used;
      const shapes: any[] = [];
      if (fRange && fringes.status === "분석 완료") {
        shapes.push({
          type: "rect",
          xref: "x",
          yref: "paper",
          x0: fRange[0],
          x1: fRange[1],
          y0: 0,
          y1: 1,
          fillcolor: "#10B981",
          opacity: 0.1,
          line: { width: 1, color: "#059669", dash: "dot" },
        });
      }

      const layout = {
        title: {
          text: `FT-IR 적외선 분광 스펙트럼 — ${file?.name || "시료 스펙트럼"}`,
          font: { size: 14, color: "#191F28" },
        },
        xaxis: {
          title: "Wavenumber (cm⁻¹)",
          autorange: "reversed", // Standard FT-IR convention: 4000 down to 400
          gridcolor: "#F2F4F6",
        },
        yaxis: {
          title: sigLabel,
          gridcolor: "#F2F4F6",
        },
        shapes,
        legend: { orientation: "h", y: 1.12, x: 0 },
      };

      return { data: traces, layout };
    }

    if (instrument === "dsc") {
      const temp = analysisResult.temperature || [];
      const hf = analysisResult.heat_flow || [];
      const trans = analysisResult.transitions || {};
      const segName = analysisResult.active_segment?.name || "열분석 곡선";

      const traces: any[] = [
        {
          x: temp,
          y: hf,
          type: "scatter",
          mode: "lines",
          name: `Heat Flow (${analysisResult.heat_flow_unit || "W/g"})`,
          line: { color: "#2563EB", width: 2 },
          hovertemplate: "%{x:.1f}°C: %{y:.4f} W/g<extra></extra>",
        },
      ];

      // Annotations for Tm, Tc, Tg
      const annotations: any[] = [];
      const tm = trans.melting || {};
      if (tm.status === "검출 완료" && tm.tm_peak_c) {
        annotations.push({
          x: tm.tm_peak_c,
          y: hf[Math.min(hf.length - 1, Math.max(0, temp.findIndex((t: number) => t >= tm.tm_peak_c)))],
          text: `Tm ${tm.tm_peak_c.toFixed(1)}°C<br>(ΔHm ${tm.delta_h_m_J_per_g} J/g)`,
          showarrow: true,
          arrowhead: 2,
          arrowcolor: "#DC2626",
          font: { color: "#DC2626", size: 11 },
          bgcolor: "#FEF2F2",
          bordercolor: "#FECACA",
        });
      }

      const tc = trans.crystallization || {};
      if (tc.status === "검출 완료" && tc.tc_peak_c) {
        annotations.push({
          x: tc.tc_peak_c,
          y: hf[Math.min(hf.length - 1, Math.max(0, temp.findIndex((t: number) => t >= tc.tc_peak_c)))],
          text: `Tc ${tc.tc_peak_c.toFixed(1)}°C<br>(ΔHc ${tc.delta_h_c_J_per_g} J/g)`,
          showarrow: true,
          arrowhead: 2,
          arrowcolor: "#059669",
          font: { color: "#059669", size: 11 },
          bgcolor: "#ECFDF5",
          bordercolor: "#A7F3D0",
        });
      }

      const tg = trans.glass_transition || {};
      if (tg.status === "검출 완료" && tg.tg_midpoint_c) {
        annotations.push({
          x: tg.tg_midpoint_c,
          y: hf[Math.min(hf.length - 1, Math.max(0, temp.findIndex((t: number) => t >= tg.tg_midpoint_c)))],
          text: `Tg ${tg.tg_midpoint_c.toFixed(1)}°C`,
          showarrow: true,
          arrowhead: 2,
          arrowcolor: "#D97706",
          font: { color: "#D97706", size: 11 },
          bgcolor: "#FFFBEB",
          bordercolor: "#FDE68A",
        });
      }

      const layout = {
        title: {
          text: `DSC 열유속 곡선 — ${segName}`,
          font: { size: 14, color: "#191F28" },
        },
        xaxis: { title: "Temperature (°C)", gridcolor: "#F2F4F6" },
        yaxis: { title: `Heat Flow (${analysisResult.heat_flow_unit || "W/g"})`, gridcolor: "#F2F4F6" },
        annotations,
        legend: { orientation: "h", y: 1.12, x: 0 },
      };

      return { data: traces, layout };
    }

    if (instrument === "tga") {
      const temp = analysisResult.temperature || [];
      const massPct = analysisResult.mass_percent || [];
      const dtg = analysisResult.dtg_pct_per_c || [];
      const decomp = analysisResult.decomposition_characteristics || {};

      const traces: any[] = [
        {
          x: temp,
          y: massPct,
          type: "scatter",
          mode: "lines",
          name: "잔존 질량 (Weight %)",
          line: { color: "#2563EB", width: 2 },
          yaxis: "y",
          hovertemplate: "%{x:.1f}°C: %{y:.2f}%<extra></extra>",
        },
      ];

      // Secondary DTG derivative trace
      if (dtg.length > 0) {
        traces.push({
          x: temp,
          y: dtg,
          type: "scatter",
          mode: "lines",
          name: "DTG 분해속도 (-dW/dT, %/°C)",
          line: { color: "#DC2626", width: 1.5, dash: "dot" },
          yaxis: "y2",
          hovertemplate: "%{x:.1f}°C: %{y:.4f} %/°C<extra></extra>",
        });
      }

      const shapes: any[] = [];
      const atm = analysisResult.atmosphere_conditions || {};
      if (atm.gas_switch_temp_c) {
        shapes.push({
          type: "line",
          x0: atm.gas_switch_temp_c,
          x1: atm.gas_switch_temp_c,
          y0: 0,
          y1: 105,
          line: { color: "#059669", width: 1.5, dash: "dash" },
        });
      }

      const annotations: any[] = [];
      if (decomp.T5_c) {
        annotations.push({
          x: decomp.T5_c,
          y: 95.0,
          text: `T₅: ${decomp.T5_c.toFixed(1)}°C`,
          showarrow: true,
          arrowhead: 2,
          arrowcolor: "#D97706",
          font: { color: "#D97706", size: 10 },
        });
      }
      if (decomp.T10_c) {
        annotations.push({
          x: decomp.T10_c,
          y: 90.0,
          text: `T₁₀: ${decomp.T10_c.toFixed(1)}°C`,
          showarrow: true,
          arrowhead: 2,
          arrowcolor: "#DC2626",
          font: { color: "#DC2626", size: 10 },
        });
      }

      const layout = {
        title: {
          text: `TGA 열중량 및 DTG 분해속도 곡선`,
          font: { size: 14, color: "#191F28" },
        },
        xaxis: { title: "Temperature (°C)", gridcolor: "#F2F4F6" },
        yaxis: {
          title: "Residual Mass (Weight %)",
          range: [-2, 105],
          gridcolor: "#F2F4F6",
        },
        yaxis2: {
          title: "DTG Rate (%/°C)",
          overlaying: "y",
          side: "right",
          showgrid: false,
        },
        shapes,
        annotations,
        legend: { orientation: "h", y: 1.12, x: 0 },
      };

      return { data: traces, layout };
    }

    return { data: [], layout: {} };
  };

  const { data: chartData, layout: chartLayout } = renderPlotlyData();

  return (
    <div className="space-y-6">
      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 1. Header & Instrument Switcher                                     */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-[20px] border border-[#E5E8EB]">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-[10px] bg-[#6366F1] text-white flex items-center justify-center font-bold text-sm">
              <Activity className="w-4 h-4" />
            </span>
            <h1 className="text-[20px] font-bold text-[#191F28] tracking-tight">
              분광·열분석 독립 워크스페이스
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#EEF2FF] text-[#4F46E5] border border-[#C7D2FE]">
              FT-IR · DSC · TGA
            </span>
          </div>
          <p className="text-[13px] text-[#6B7684] mt-1">
            원시 분광·열분석 데이터(CSV, TXT, TSV, XLSX)의 순수 파이썬 수치 계산 및 과학적 보고서 생성
          </p>
        </div>

        {/* Instrument Tab Switcher */}
        <div className="flex items-center p-1 rounded-[12px] bg-[#F2F4F6] border border-[#E5E8EB] shrink-0">
          <button
            type="button"
            onClick={() => handleInstrumentChange("ftir")}
            className={cn(
              "px-3.5 py-1.5 rounded-[9px] text-[13px] font-semibold transition-all",
              instrument === "ftir"
                ? "bg-white text-[#4F46E5] shadow-sm font-bold"
                : "text-[#6B7684] hover:text-[#191F28]"
            )}
          >
            FT-IR 적외선 분광
          </button>
          <button
            type="button"
            onClick={() => handleInstrumentChange("dsc")}
            className={cn(
              "px-3.5 py-1.5 rounded-[9px] text-[13px] font-semibold transition-all",
              instrument === "dsc"
                ? "bg-white text-[#4F46E5] shadow-sm font-bold"
                : "text-[#6B7684] hover:text-[#191F28]"
            )}
          >
            DSC 시차주사열량
          </button>
          <button
            type="button"
            onClick={() => handleInstrumentChange("tga")}
            className={cn(
              "px-3.5 py-1.5 rounded-[9px] text-[13px] font-semibold transition-all",
              instrument === "tga"
                ? "bg-white text-[#4F46E5] shadow-sm font-bold"
                : "text-[#6B7684] hover:text-[#191F28]"
            )}
          >
            TGA 열중량 분석
          </button>
        </div>
      </div>

      {/* Error notification banner */}
      {errorMsg && (
        <div className="p-4 rounded-[14px] bg-[#FEF2F2] border border-[#FECACA] text-[#DC2626] text-[13px] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-[12px] font-bold underline ml-3"
          >
            닫기
          </button>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 2. Top Controls & File Upload Bar                                  */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Upload & Benchmark Loader */}
        <div className="lg:col-span-5 space-y-4">
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[14px] font-bold text-[#191F28] flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-[#4F46E5]" />
                원시 데이터 파일 입력
              </span>
              <button
                type="button"
                onClick={handleLoadBenchmark}
                disabled={isParsing || isAnalyzing}
                className="px-2.5 py-1 rounded-[8px] text-[12px] font-bold text-[#4F46E5] bg-[#EEF2FF] hover:bg-[#E0E7FF] border border-[#C7D2FE] transition-all flex items-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                표준 벤치마크 시료 불러오기
              </button>
            </div>

            {/* Drag & Drop File Upload Area */}
            <label className="block border-2 border-dashed border-[#D1D6DB] hover:border-[#4F46E5] bg-[#F8FAFC] rounded-[16px] p-6 text-center cursor-pointer transition-all">
              <input
                type="file"
                accept=".csv,.txt,.tsv,.xlsx"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileUpload(f);
                }}
              />
              <Upload className="w-7 h-7 mx-auto text-[#6B7684] mb-2" />
              <div className="text-[13px] font-bold text-[#191F28]">
                {file ? file.name : "CSV, TXT, TSV, XLSX 파일 업로드"}
              </div>
              <div className="text-[11px] text-[#8B95A1] mt-1">
                쉼표(,), 탭, 공백 구분자 및 UTF-8 / CP949 인코딩 자동 인식
              </div>
            </label>

            {/* Parsed File Meta Info */}
            {parsedData && (
              <div className="mt-3 p-3 rounded-[12px] bg-[#F2F4F6] text-[12px] space-y-1">
                <div className="flex justify-between text-[#4E5968]">
                  <span>인코딩 / 구분자:</span>
                  <span className="font-mono font-bold text-[#191F28]">
                    {parsedData.encoding} (구분: {JSON.stringify(parsedData.delimiter)})
                  </span>
                </div>
                <div className="flex justify-between text-[#4E5968]">
                  <span>수치 데이터 행 수:</span>
                  <span className="font-bold text-[#191F28]">
                    {parsedData.raw_row_count?.toLocaleString()} 행
                  </span>
                </div>
                <div className="flex justify-between text-[#4E5968]">
                  <span>인식된 열 목록:</span>
                  <span className="font-mono text-[#191F28] truncate max-w-[220px]">
                    {parsedData.columns?.map((c: any) => c.name).join(", ")}
                  </span>
                </div>
              </div>
            )}
          </Card>

          {/* Condition Parameters Card */}
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[14px] font-bold text-[#191F28] flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[#4F46E5]" />
                {instrument.toUpperCase()} 분석 조건 설정
              </span>
              <Button
                size="sm"
                variant="primary"
                onClick={() => executeAnalysis()}
                disabled={!parsedData || isAnalyzing}
                className="bg-[#4F46E5] hover:bg-[#4338CA]"
              >
                <Play className="w-3.5 h-3.5 mr-1" />
                분석 재계산
              </Button>
            </div>

            {/* Instrument-Specific Condition Inputs */}
            {instrument === "ftir" && (
              <div className="space-y-3 text-[13px]">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-[#4E5968] mb-1">
                      신호 종류 (Signal Type)
                    </label>
                    <select
                      value={ftirSignalType}
                      onChange={(e) => setFtirSignalType(e.target.value as any)}
                      className="w-full h-9 px-2.5 rounded-[8px] border border-[#E5E8EB] bg-white text-[12px]"
                    >
                      <option value="transmittance">투과율 (%T)</option>
                      <option value="absorbance">흡광도 (Absorbance)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#4E5968] mb-1">
                      고분자 굴절률 (Refractive Index n)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={ftirRefractiveIndex}
                      onChange={(e) => setFtirRefractiveIndex(e.target.value)}
                      placeholder="미입력 시 n·d만 산출"
                      className="w-full h-9 px-2.5 rounded-[8px] border border-[#E5E8EB] bg-white text-[12px]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-[#4E5968] mb-1">
                      간섭무늬 탐색 파수 (cm⁻¹)
                    </label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={ftirFringeMinWn}
                        onChange={(e) => setFtirFringeMinWn(e.target.value)}
                        className="w-full h-9 px-2 rounded-[8px] border border-[#E5E8EB] bg-white text-[11px]"
                      />
                      <span className="text-[#8B95A1]">~</span>
                      <input
                        type="number"
                        value={ftirFringeMaxWn}
                        onChange={(e) => setFtirFringeMaxWn(e.target.value)}
                        className="w-full h-9 px-2 rounded-[8px] border border-[#E5E8EB] bg-white text-[11px]"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#4E5968] mb-1">
                      간섭 극값 최소 돌출도 (Prominence)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={ftirProminence}
                      onChange={(e) => setFtirProminence(e.target.value)}
                      className="w-full h-9 px-2.5 rounded-[8px] border border-[#E5E8EB] bg-white text-[12px]"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-4 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer text-[12px] text-[#4E5968]">
                    <input
                      type="checkbox"
                      checked={ftirUseSmoothing}
                      onChange={(e) => setFtirUseSmoothing(e.target.checked)}
                      className="rounded"
                    />
                    <span>Savitzky-Golay 평활화</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-[12px] text-[#4E5968]">
                    <input
                      type="checkbox"
                      checked={ftirUseBaseline}
                      onChange={(e) => setFtirUseBaseline(e.target.checked)}
                      className="rounded"
                    />
                    <span>배경선(Baseline) 보정</span>
                  </label>
                </div>
              </div>
            )}

            {instrument === "dsc" && (
              <div className="space-y-3 text-[13px]">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-[#4E5968] mb-1">
                      시료 질량 (Sample Mass mg)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={dscSampleMassMg}
                      onChange={(e) => setDscSampleMassMg(e.target.value)}
                      className="w-full h-9 px-2.5 rounded-[8px] border border-[#E5E8EB] bg-white text-[12px]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#4E5968] mb-1">
                      열유속 입력 단위
                    </label>
                    <select
                      value={dscHeatFlowUnit}
                      onChange={(e) => setDscHeatFlowUnit(e.target.value)}
                      className="w-full h-9 px-2.5 rounded-[8px] border border-[#E5E8EB] bg-white text-[12px]"
                    >
                      <option value="mW">mW (밀리와트, 비정규화)</option>
                      <option value="W/g">W/g (= mW/mg, 질량 정규화됨)</option>
                      <option value="W">W (와트)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-[#4E5968] mb-1">
                      기준 100% 용융엔탈피 (ΔHm° J/g)
                    </label>
                    <input
                      type="number"
                      step="1.0"
                      value={dscStdEnthalpy}
                      onChange={(e) => setDscStdEnthalpy(e.target.value)}
                      placeholder="미입력 시 결정화도 보류"
                      className="w-full h-9 px-2.5 rounded-[8px] border border-[#E5E8EB] bg-white text-[12px]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#4E5968] mb-1">
                      고분자 질량분율 (w)
                    </label>
                    <input
                      type="number"
                      step="0.05"
                      max="1.0"
                      min="0.0"
                      value={dscPolymerFraction}
                      onChange={(e) => setDscPolymerFraction(e.target.value)}
                      className="w-full h-9 px-2.5 rounded-[8px] border border-[#E5E8EB] bg-white text-[12px]"
                    />
                  </div>
                </div>

                {/* Segment Selector */}
                {analysisResult?.segments && analysisResult.segments.length > 1 && (
                  <div>
                    <label className="block text-[11px] font-bold text-[#4E5968] mb-1">
                      분석할 가열/냉각 단계 선택
                    </label>
                    <select
                      value={dscSelectedSegmentId}
                      onChange={(e) => setDscSelectedSegmentId(e.target.value)}
                      className="w-full h-9 px-2.5 rounded-[8px] border border-[#E5E8EB] bg-white text-[12px] font-medium"
                    >
                      {analysisResult.segments.map((seg: any) => (
                        <option key={seg.id} value={seg.id}>
                          {seg.name} ({(seg.start_temp ?? seg.t_start_c ?? 0).toFixed?.(0) ?? seg.start_temp}°C → {(seg.end_temp ?? seg.t_end_c ?? 0).toFixed?.(0) ?? seg.end_temp}°C)
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {instrument === "tga" && (
              <div className="space-y-3 text-[13px]">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-[#4E5968] mb-1">
                      초기 시료 질량 (Initial Mass mg)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={tgaInitialMassMg}
                      onChange={(e) => setTgaInitialMassMg(e.target.value)}
                      className="w-full h-9 px-2.5 rounded-[8px] border border-[#E5E8EB] bg-white text-[12px]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#4E5968] mb-1">
                      분위기 전환 온도 (Gas Switch °C)
                    </label>
                    <input
                      type="number"
                      step="10"
                      value={tgaGasSwitchTemp}
                      onChange={(e) => setTgaGasSwitchTemp(e.target.value)}
                      placeholder="예: 600°C (N2 → Air)"
                      className="w-full h-9 px-2.5 rounded-[8px] border border-[#E5E8EB] bg-white text-[12px]"
                    />
                  </div>
                </div>

                <div>
                  <label className="flex items-center gap-2 cursor-pointer text-[12px] text-[#4E5968]">
                    <input
                      type="checkbox"
                      checked={tgaInputIsPercent}
                      onChange={(e) => setTgaInputIsPercent(e.target.checked)}
                      className="rounded"
                    />
                    <span>입력 데이터가 이미 잔존 백분율(Weight %) 단위임</span>
                  </label>
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* Right: Interactive Plotly Chart Panel */}
        <div className="lg:col-span-7">
          <Card className="p-5 h-full flex flex-col justify-between">
            <div className="flex items-center justify-between pb-2 border-b border-[#F2F4F6] mb-3">
              <span className="text-[14px] font-bold text-[#191F28] flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-[#4F46E5]" />
                인터랙티브 분석 차트 (Plotly)
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleAddToCompare}
                  disabled={!analysisResult}
                  className="text-[12px]"
                >
                  <Layers className="w-3.5 h-3.5 mr-1" />
                  비교 목록에 추가
                </Button>
              </div>
            </div>

            {analysisResult ? (
              <div className="flex-1 min-h-[380px]">
                <PlotlyChart data={chartData} layout={chartLayout} height={400} />
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-[#8B95A1] min-h-[380px]">
                <Activity className="w-12 h-12 stroke-[1.2] mb-3 text-[#D1D6DB]" />
                <div className="text-[14px] font-bold text-[#4E5968]">
                  분석할 {instrument.toUpperCase()} 데이터를 입력해주세요
                </div>
                <p className="text-[12px] mt-1">
                  상단의 "표준 벤치마크 시료 불러오기" 버튼을 누르거나 raw 파일을 업로드하세요.
                </p>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 3. KPI Metrics Summary Cards                                        */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {analysisResult && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {instrument === "ftir" && (
            <>
              <div className="p-4 rounded-[16px] bg-white border border-[#E5E8EB]">
                <div className="text-[11px] font-bold text-[#8B95A1]">검출된 주요 흡수 밴드</div>
                <div className="text-[22px] font-bold text-[#191F28] mt-1">
                  {analysisResult.peak_count || 0}
                  <span className="text-[13px] font-normal text-[#6B7684] ml-1">개</span>
                </div>
                <div className="text-[11px] text-[#059669] mt-1 font-medium">
                  {analysisResult.peaks?.[0]
                    ? `최대 흡수: ${analysisResult.peaks[0].wavenumber.toFixed(1)} cm⁻¹`
                    : "밴드 검출 완료"}
                </div>
              </div>

              <div className="p-4 rounded-[16px] bg-white border border-[#E5E8EB]">
                <div className="text-[11px] font-bold text-[#8B95A1]">간섭무늬 물리적 막 두께 (d)</div>
                <div className="text-[22px] font-bold text-[#4F46E5] mt-1">
                  {analysisResult.fringes?.physical_thickness_um !== null &&
                  analysisResult.fringes?.physical_thickness_um !== undefined
                    ? `${analysisResult.fringes.physical_thickness_um.toFixed(2)}`
                    : "확인 필요"}
                  <span className="text-[13px] font-normal text-[#6B7684] ml-1">μm</span>
                </div>
                <div className="text-[11px] text-[#4E5968] mt-1 truncate">
                  {analysisResult.fringes?.summary_text || "간섭무늬 계산 상태 확인"}
                </div>
              </div>

              <div className="p-4 rounded-[16px] bg-white border border-[#E5E8EB]">
                <div className="text-[11px] font-bold text-[#8B95A1]">광학적 두께 (n·d)</div>
                <div className="text-[22px] font-bold text-[#191F28] mt-1">
                  {analysisResult.fringes?.optical_thickness_um
                    ? `${analysisResult.fringes.optical_thickness_um.toFixed(2)}`
                    : "—"}
                  <span className="text-[13px] font-normal text-[#6B7684] ml-1">μm</span>
                </div>
                <div className="text-[11px] text-[#8B95A1] mt-1">
                  m={analysisResult.fringes?.m_interval_count || 0}개 유효 간섭 주기
                </div>
              </div>

              <div className="p-4 rounded-[16px] bg-white border border-[#E5E8EB]">
                <div className="text-[11px] font-bold text-[#8B95A1]">적용 굴절률 (Refractive Index)</div>
                <div className="text-[22px] font-bold text-[#191F28] mt-1">
                  {analysisResult.fringes?.refractive_index || "미입력"}
                </div>
                <div className="text-[11px] text-[#D97706] mt-1 font-medium">
                  {analysisResult.fringes?.refractive_index
                    ? "문헌 표준 굴절률 반영"
                    : "물리적 두께 확정 위해 n 입력 필요"}
                </div>
              </div>
            </>
          )}

          {instrument === "dsc" && (
            <>
              <div className="p-4 rounded-[16px] bg-white border border-[#E5E8EB]">
                <div className="text-[11px] font-bold text-[#8B95A1]">용융 피크 온도 (Tm)</div>
                <div className="text-[22px] font-bold text-[#DC2626] mt-1">
                  {analysisResult.transitions?.melting?.tm_peak_c
                    ? `${analysisResult.transitions.melting.tm_peak_c.toFixed(1)}`
                    : "미검출"}
                  <span className="text-[13px] font-normal text-[#6B7684] ml-1">°C</span>
                </div>
                <div className="text-[11px] text-[#4E5968] mt-1">
                  융해 엔탈피: {analysisResult.transitions?.melting?.delta_h_m_J_per_g || "—"} J/g
                </div>
              </div>

              <div className="p-4 rounded-[16px] bg-white border border-[#E5E8EB]">
                <div className="text-[11px] font-bold text-[#8B95A1]">결정화 피크 온도 (Tc)</div>
                <div className="text-[22px] font-bold text-[#059669] mt-1">
                  {analysisResult.transitions?.crystallization?.tc_peak_c
                    ? `${analysisResult.transitions.crystallization.tc_peak_c.toFixed(1)}`
                    : "미검출"}
                  <span className="text-[13px] font-normal text-[#6B7684] ml-1">°C</span>
                </div>
                <div className="text-[11px] text-[#4E5968] mt-1">
                  결정화 엔탈피: {analysisResult.transitions?.crystallization?.delta_h_c_J_per_g || "—"} J/g
                </div>
              </div>

              <div className="p-4 rounded-[16px] bg-white border border-[#E5E8EB]">
                <div className="text-[11px] font-bold text-[#8B95A1]">유리전이온도 (Tg)</div>
                <div className="text-[22px] font-bold text-[#D97706] mt-1">
                  {analysisResult.transitions?.glass_transition?.tg_midpoint_c
                    ? `${analysisResult.transitions.glass_transition.tg_midpoint_c.toFixed(1)}`
                    : "미검출"}
                  <span className="text-[13px] font-normal text-[#6B7684] ml-1">°C</span>
                </div>
                <div className="text-[11px] text-[#8B95A1] mt-1">1차 미분 변곡점 중간값</div>
              </div>

              <div className="p-4 rounded-[16px] bg-white border border-[#E5E8EB]">
                <div className="text-[11px] font-bold text-[#8B95A1]">조건부 결정화도 (Xc)</div>
                <div className="text-[22px] font-bold text-[#4F46E5] mt-1">
                  {analysisResult.transitions?.crystallinity?.crystallinity_pct !== null &&
                  analysisResult.transitions?.crystallinity?.crystallinity_pct !== undefined
                    ? `${analysisResult.transitions.crystallinity.crystallinity_pct.toFixed(1)}`
                    : "기준 필요"}
                  <span className="text-[13px] font-normal text-[#6B7684] ml-1">%</span>
                </div>
                <div className="text-[11px] text-[#4E5968] mt-1 truncate">
                  {analysisResult.transitions?.crystallinity?.standard_melting_enthalpy_J_per_g
                    ? `ΔHm°=${analysisResult.transitions.crystallinity.standard_melting_enthalpy_J_per_g} J/g 기준`
                    : "100% 결정 엔탈피 미입력"}
                </div>
              </div>
            </>
          )}

          {instrument === "tga" && (
            <>
              <div className="p-4 rounded-[16px] bg-white border border-[#E5E8EB]">
                <div className="text-[11px] font-bold text-[#8B95A1]">5% 초기 분해온도 (T₅)</div>
                <div className="text-[22px] font-bold text-[#D97706] mt-1">
                  {analysisResult.decomposition_characteristics?.T5_c
                    ? `${analysisResult.decomposition_characteristics.T5_c.toFixed(1)}`
                    : "—"}
                  <span className="text-[13px] font-normal text-[#6B7684] ml-1">°C</span>
                </div>
                <div className="text-[11px] text-[#8B95A1] mt-1">초기 열안정성 지표</div>
              </div>

              <div className="p-4 rounded-[16px] bg-white border border-[#E5E8EB]">
                <div className="text-[11px] font-bold text-[#8B95A1]">10% 분해온도 (T₁₀)</div>
                <div className="text-[22px] font-bold text-[#DC2626] mt-1">
                  {analysisResult.decomposition_characteristics?.T10_c
                    ? `${analysisResult.decomposition_characteristics.T10_c.toFixed(1)}`
                    : "—"}
                  <span className="text-[13px] font-normal text-[#6B7684] ml-1">°C</span>
                </div>
                <div className="text-[11px] text-[#8B95A1] mt-1">주 고분자 사슬 분해 개시</div>
              </div>

              <div className="p-4 rounded-[16px] bg-white border border-[#E5E8EB]">
                <div className="text-[11px] font-bold text-[#8B95A1]">다단계 감량 단계 수</div>
                <div className="text-[22px] font-bold text-[#4F46E5] mt-1">
                  {analysisResult.steps ? analysisResult.steps.length : 0}
                  <span className="text-[13px] font-normal text-[#6B7684] ml-1">개 구간</span>
                </div>
                <div className="text-[11px] text-[#4E5968] mt-1">
                  DTG 최대 분해점: {analysisResult.decomposition_characteristics?.dtg_peaks?.[0]?.temp_c || "—"}°C
                </div>
              </div>

              <div className="p-4 rounded-[16px] bg-white border border-[#E5E8EB]">
                <div className="text-[11px] font-bold text-[#8B95A1]">최종 불연 잔류물 (Residue / Ash)</div>
                <div className="text-[22px] font-bold text-[#191F28] mt-1">
                  {analysisResult.residual?.final_residual_pct
                    ? `${analysisResult.residual.final_residual_pct.toFixed(2)}`
                    : "—"}
                  <span className="text-[13px] font-normal text-[#6B7684] ml-1">%</span>
                </div>
                <div className="text-[11px] text-[#059669] mt-1">
                  {analysisResult.residual?.final_residual_mg
                    ? `잔존 질량: ${analysisResult.residual.final_residual_mg.toFixed(3)} mg`
                    : "무기 충전재 / 회분"}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 4. Formulas & Substituted Values Drawer ("사용한 값 보기")           */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {analysisResult && (
        <Card className="p-5">
          <button
            type="button"
            onClick={() => setShowFormulaDrawer(!showFormulaDrawer)}
            className="w-full flex items-center justify-between text-left"
          >
            <div className="flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-[#4F46E5]" />
              <span className="text-[14px] font-bold text-[#191F28]">
                사용한 계산식 및 대입값 투명성 검토
              </span>
              <span className="text-[11px] text-[#8B95A1]">
                (블랙박스 방지: 계산에 사용된 공식과 대입값 상세 확인)
              </span>
            </div>
            {showFormulaDrawer ? (
              <ChevronUp className="w-4 h-4 text-[#6B7684]" />
            ) : (
              <ChevronDown className="w-4 h-4 text-[#6B7684]" />
            )}
          </button>

          {showFormulaDrawer && (
            <div className="mt-4 pt-4 border-t border-[#F2F4F6] space-y-4 text-[13px]">
              {instrument === "ftir" && (
                <div className="space-y-3">
                  <div className="p-3.5 rounded-[12px] bg-[#F8FAFC] border border-[#E5E8EB]">
                    <div className="font-bold text-[#191F28] mb-1">
                      1. 흡광도 변환식 (Beer-Lambert Transmittance Conversion)
                    </div>
                    <div className="font-mono text-[#4F46E5] bg-white p-2 rounded border border-[#E5E8EB]">
                      A = -log₁₀(T) = -log₁₀(%T / 100)
                    </div>
                    <p className="text-[12px] text-[#6B7684] mt-1">
                      투과율 0% 이하의 노이즈는 음수 흡광도 오류 방지를 위해 유효 범위로 보존되며, 100% 초과 값은 품질 경고로 기록됩니다.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-[12px] bg-[#F8FAFC] border border-[#E5E8EB]">
                    <div className="font-bold text-[#191F28] mb-1">
                      2. Fabry-Perot 수직 입사 박막 두께 계산식
                    </div>
                    <div className="font-mono text-[#4F46E5] bg-white p-2 rounded border border-[#E5E8EB]">
                      d (μm) = [ m × 10⁴ ] / [ 2 · n · |ν₁ - ν₂| ]
                    </div>
                    <div className="mt-2 text-[12px] space-y-1 text-[#4E5968]">
                      <div>
                        • <strong>대입된 파수 범위:</strong> |ν₁ - ν₂| = {analysisResult.fringes?.delta_nu_total?.toFixed(1) || "—"} cm⁻¹
                      </div>
                      <div>
                        • <strong>간섭 주기 수 (m):</strong> k={analysisResult.fringes?.k_extrema_count || 0}개 극값 → m={analysisResult.fringes?.m_interval_count || 0}개 완전 주기
                      </div>
                      <div>
                        • <strong>대입된 굴절률 (n):</strong> {analysisResult.fringes?.refractive_index || "미입력 (광학적 두께만 산출)"}
                      </div>
                      <div>
                        • <strong>산출된 두께:</strong> d = {analysisResult.fringes?.physical_thickness_um?.toFixed(3) || "—"} μm (광학적 두께 n·d = {analysisResult.fringes?.optical_thickness_um?.toFixed(3) || "—"} μm)
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {instrument === "dsc" && (
                <div className="space-y-3">
                  <div className="p-3.5 rounded-[12px] bg-[#F8FAFC] border border-[#E5E8EB]">
                    <div className="font-bold text-[#191F28] mb-1">
                      1. 상전이 융해 엔탈피 적분식 (Numerical Baseline Enthalpy Integration)
                    </div>
                    <div className="font-mono text-[#4F46E5] bg-white p-2 rounded border border-[#E5E8EB]">
                      ΔH (J/g) = (1 / m) ∫ [ q(t) - q_baseline(t) ] dt
                    </div>
                    <p className="text-[12px] text-[#6B7684] mt-1">
                      시간(t) 축이 제공된 경우 직접 사다리꼴 수치 적분(W/g · s = J/g)을 수행하며, 온도 축만 제공된 경우 승온 속도(dT/dt)를 반영합니다.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-[12px] bg-[#F8FAFC] border border-[#E5E8EB]">
                    <div className="font-bold text-[#191F28] mb-1">
                      2. 조건부 결정화도 계산식 (Degree of Crystallinity Xc)
                    </div>
                    <div className="font-mono text-[#4F46E5] bg-white p-2 rounded border border-[#E5E8EB]">
                      Xc (%) = [ (ΔHm - ΔHcc) / (w · ΔHm°) ] × 100
                    </div>
                    <div className="mt-2 text-[12px] space-y-1 text-[#4E5968]">
                      <div>• <strong>측정된 용융 엔탈피 (ΔHm):</strong> {analysisResult.transitions?.melting?.delta_h_m_J_per_g || 0} J/g</div>
                      <div>• <strong>냉결정화 엔탈피 (ΔHcc):</strong> {analysisResult.transitions?.cold_crystallization?.delta_h_cc_J_per_g || 0} J/g</div>
                      <div>• <strong>100% 완전결정 표준 엔탈피 (ΔHm°):</strong> {analysisResult.transitions?.crystallinity?.standard_melting_enthalpy_J_per_g || "미입력"} J/g</div>
                      <div>• <strong>고분자 질량분율 (w):</strong> {analysisResult.transitions?.crystallinity?.polymer_mass_fraction || 1.0}</div>
                    </div>
                  </div>
                </div>
              )}

              {instrument === "tga" && (
                <div className="space-y-3">
                  <div className="p-3.5 rounded-[12px] bg-[#F8FAFC] border border-[#E5E8EB]">
                    <div className="font-bold text-[#191F28] mb-1">
                      1. 잔존 질량 백분율 및 DTG 분해 속도 미분식
                    </div>
                    <div className="font-mono text-[#4F46E5] bg-white p-2 rounded border border-[#E5E8EB]">
                      Weight % = [ m(T) / m₀ ] × 100, &nbsp;&nbsp;&nbsp; DTG = - d(Weight %)/dT
                    </div>
                    <p className="text-[12px] text-[#6B7684] mt-1">
                      Savitzky-Golay 다항식 미분을 통해 장비 노이즈에 의한 거짓 변곡점을 제거하고 주요 열분해 피크(DTG peak)를 정량화합니다.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 5. Rule-Based Summary & Grounded Gemini AI Card                     */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {analysisResult && (
        <Card className="p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#F2F4F6]">
            <div>
              <div className="text-[15px] font-bold text-[#191F28] flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#4F46E5]" />
                과학적 종합 분석 및 Gemini AI 해석
              </div>
              <p className="text-[12px] text-[#6B7684]">
                수치 근거 ID에 엄격히 바인딩되어 환각(Hallucination) 없이 검증된 관찰과 가설을 제공합니다.
              </p>
            </div>
            <Button
              size="sm"
              variant="primary"
              onClick={handleRequestAi}
              disabled={isAiLoading}
              className="bg-[#4F46E5] hover:bg-[#4338CA] shrink-0"
            >
              {isAiLoading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" />
                  AI 리포트 생성 중...
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 mr-1" />
                  Gemini AI 해석 생성
                </>
              )}
            </Button>
          </div>

          {/* AI or Rule-Based Interpretation View */}
          {aiReport ? (
            <div className="space-y-4 text-[13px]">
              {/* Executive Summary */}
              <div className="p-4 rounded-[14px] bg-[#EEF2FF] border border-[#C7D2FE]">
                <div className="font-bold text-[#3730A3] mb-1.5 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  핵심 분석 종합 요약
                </div>
                <p className="text-[#312E81] leading-relaxed whitespace-pre-line">
                  {aiReport.executive_summary}
                </p>
              </div>

              {/* Observed Facts with Evidence IDs */}
              {aiReport.observed_facts && aiReport.observed_facts.length > 0 && (
                <div>
                  <div className="text-[12px] font-bold text-[#4E5968] mb-2">
                    수치적으로 검증된 관찰 사실 (Observed Facts)
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {aiReport.observed_facts.map((fact: any, idx: number) => (
                      <div
                        key={idx}
                        className="p-3 rounded-[10px] bg-[#F8FAFC] border border-[#E5E8EB] flex items-start gap-2"
                      >
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-[#E2E8F0] text-[#334155] shrink-0">
                          {fact.evidence_id || `ID-${idx + 1}`}
                        </span>
                        <span className="text-[#191F28]">{fact.statement}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Physical Hypotheses */}
              {aiReport.physical_interpretations && aiReport.physical_interpretations.length > 0 && (
                <div>
                  <div className="text-[12px] font-bold text-[#4E5968] mb-2">
                    열적/분광학적 물성 해석 가설 (Physical Hypotheses)
                  </div>
                  <div className="space-y-2">
                    {aiReport.physical_interpretations.map((hypo: any, idx: number) => (
                      <div
                        key={idx}
                        className="p-3.5 rounded-[12px] bg-white border border-[#E5E8EB] space-y-1.5"
                      >
                        <div className="font-bold text-[#191F28] flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-[#EEF2FF] text-[#4F46E5] text-[11px] font-bold flex items-center justify-center">
                            {idx + 1}
                          </span>
                          <span>{hypo.hypothesis}</span>
                        </div>
                        {hypo.caveats && (
                          <div className="text-[11px] text-[#B45309] bg-[#FFFBEB] p-2 rounded-[8px] border border-[#FDE68A]">
                            <strong>주의 및 검토 한계:</strong> {hypo.caveats}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommended Next Experiments */}
              {aiReport.next_experiments && aiReport.next_experiments.length > 0 && (
                <div className="p-3.5 rounded-[12px] bg-[#F0FDF4] border border-[#BBF7D0]">
                  <div className="font-bold text-[#166534] mb-1.5 flex items-center gap-1.5">
                    <FlaskConical className="w-4 h-4" />
                    추천 후속 상호보완 분석
                  </div>
                  <ul className="list-disc list-inside space-y-1 text-[#14532D] text-[12px]">
                    {aiReport.next_experiments.map((exp: string, idx: number) => (
                      <li key={idx}>{exp}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 rounded-[12px] bg-[#F8FAFC] border border-[#E5E8EB] text-[13px] text-[#4E5968] flex items-center justify-between">
              <div>
                <strong>규칙 기반 기본 분석 완료:</strong> 수치 계산과 피크/전이온도 검출이 완료되었습니다.
                Gemini AI를 연동하여 심층 가설과 작용기/열분해 메커니즘을 종합 검토할 수 있습니다.
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRequestAi}
                className="shrink-0 ml-3"
              >
                AI 해석 시작
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 6. Download & Export Action Bar                                     */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {analysisResult && (
        <Card className="p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-[14px] font-bold text-[#191F28]">
              분석 결과 내보내기 (Export & Downloads)
            </div>
            <div className="text-[12px] text-[#6B7684]">
              한국어 인쇄용 PDF, 고해상도 차트 PNG, 전처리 수치 CSV, 전체 분석 JSON 지원
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              variant="outline"
              size="sm"
              disabled={isDownloading}
              onClick={() => {
                setIsDownloading(true);
                api
                  .downloadSpectroPdf(instrument, {
                    analysis_result: analysisResult,
                    filename: file?.name || `${instrument}_data.csv`,
                    ai_report: aiReport,
                    notes: userNotes,
                  })
                  .finally(() => setIsDownloading(false));
              }}
            >
              <Download className="w-3.5 h-3.5 mr-1 text-[#DC2626]" />
              한국어 PDF 리포트
            </Button>

            <Button
              variant="outline"
              size="sm"
              disabled={isDownloading}
              onClick={() => {
                setIsDownloading(true);
                api
                  .downloadSpectroChart(instrument, {
                    analysis_result: analysisResult,
                    filename: file?.name || `${instrument}_data.csv`,
                  })
                  .finally(() => setIsDownloading(false));
              }}
            >
              <Download className="w-3.5 h-3.5 mr-1 text-[#2563EB]" />
              차트 이미지 (PNG)
            </Button>

            <Button
              variant="outline"
              size="sm"
              disabled={isDownloading}
              onClick={() => {
                setIsDownloading(true);
                api
                  .downloadSpectroCsv(instrument, {
                    analysis_result: analysisResult,
                    filename: file?.name || `${instrument}_data.csv`,
                  })
                  .finally(() => setIsDownloading(false));
              }}
            >
              <Download className="w-3.5 h-3.5 mr-1 text-[#059669]" />
              변환 데이터 (CSV)
            </Button>

            <Button
              variant="outline"
              size="sm"
              disabled={isDownloading}
              onClick={() => {
                setIsDownloading(true);
                api
                  .downloadSpectroJson(instrument, {
                    analysis_result: analysisResult,
                    filename: file?.name || `${instrument}_data.csv`,
                    ai_report: aiReport,
                    notes: userNotes,
                  })
                  .finally(() => setIsDownloading(false));
              }}
            >
              <Download className="w-3.5 h-3.5 mr-1 text-[#4F46E5]" />
              결과 데이터 (JSON)
            </Button>
          </div>
        </Card>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 7. Multi-Sample Comparison Table (when populated)                   */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {compareItems.length > 0 && (
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[14px] font-bold text-[#191F28] flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#4F46E5]" />
              다중 시료 곡선 중첩 및 정량 비교표 ({compareItems.length}개 시료)
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCompareItems([]);
                setCompareTable([]);
              }}
              className="text-[12px] text-[#DC2626]"
            >
              비교 목록 초기화
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px] border-collapse">
              <thead>
                <tr className="border-b border-[#E5E8EB] text-[#6B7684] bg-[#F8FAFC]">
                  <th className="py-2.5 px-3">시료명</th>
                  {instrument === "ftir" && (
                    <>
                      <th className="py-2.5 px-3">피크 수</th>
                      <th className="py-2.5 px-3">주요 밴드 파수 (cm⁻¹)</th>
                      <th className="py-2.5 px-3">산출 막 두께 (μm)</th>
                    </>
                  )}
                  {instrument === "dsc" && (
                    <>
                      <th className="py-2.5 px-3">Tm (°C)</th>
                      <th className="py-2.5 px-3">ΔHm (J/g)</th>
                      <th className="py-2.5 px-3">Tc (°C)</th>
                      <th className="py-2.5 px-3">결정화도 Xc (%)</th>
                    </>
                  )}
                  {instrument === "tga" && (
                    <>
                      <th className="py-2.5 px-3">T₅ (°C)</th>
                      <th className="py-2.5 px-3">T₁₀ (°C)</th>
                      <th className="py-2.5 px-3">분해 단계 수</th>
                      <th className="py-2.5 px-3">최종 잔류물 (%)</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F2F4F6]">
                {compareTable.map((row: any, idx: number) => (
                  <tr key={idx} className="hover:bg-[#F8FAFC]">
                    <td className="py-2.5 px-3 font-semibold text-[#191F28]">
                      {row.sample_name}
                    </td>
                    {instrument === "ftir" && (
                      <>
                        <td className="py-2.5 px-3">{row.peak_count}개</td>
                        <td className="py-2.5 px-3 font-mono">
                          {row.top_peak_wavenumbers?.map((w: number) => w.toFixed(0)).join(", ") || "—"}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-[#4F46E5]">
                          {row.thickness_um ? `${row.thickness_um.toFixed(2)} μm` : "—"}
                        </td>
                      </>
                    )}
                    {instrument === "dsc" && (
                      <>
                        <td className="py-2.5 px-3 font-bold text-[#DC2626]">
                          {row.tm_peak_c ? `${row.tm_peak_c.toFixed(1)}°C` : "—"}
                        </td>
                        <td className="py-2.5 px-3">{row.delta_h_m_J_per_g || "—"}</td>
                        <td className="py-2.5 px-3 text-[#059669]">
                          {row.tc_peak_c ? `${row.tc_peak_c.toFixed(1)}°C` : "—"}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-[#4F46E5]">
                          {row.crystallinity_pct ? `${row.crystallinity_pct.toFixed(1)}%` : "—"}
                        </td>
                      </>
                    )}
                    {instrument === "tga" && (
                      <>
                        <td className="py-2.5 px-3 text-[#D97706]">
                          {row.T5_c ? `${row.T5_c.toFixed(1)}°C` : "—"}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-[#DC2626]">
                          {row.T10_c ? `${row.T10_c.toFixed(1)}°C` : "—"}
                        </td>
                        <td className="py-2.5 px-3">{row.steps_count}단계</td>
                        <td className="py-2.5 px-3 font-bold text-[#191F28]">
                          {row.final_residual_pct ? `${row.final_residual_pct.toFixed(2)}%` : "—"}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
