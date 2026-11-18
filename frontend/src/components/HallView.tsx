import { useState } from "react";
import {
  Activity,
  BookOpen,
  CheckCircle2,
  Info,
  Share2,
  Sparkles,
  Upload,
  Zap,
} from "lucide-react";
import { api } from "../api";
import { PlotlyChart } from "./PlotlyChart";
import type { GroundingData, HallAnalysisResult, ScientificInterpretation } from "../types";

interface HallViewProps {
  onNavigateToIntegrated?: () => void;
}

export function HallView({ onNavigateToIntegrated }: HallViewProps = {}) {
  const [rawText, setRawText] = useState<string>("");
  const [thicknessUm, setThicknessUm] = useState<number>(500);
  const [currentMa, setCurrentMa] = useState<number>(10);
  const [sheetResist, setSheetResist] = useState<number>(9.05);
  const [sampleId, setSampleId] = useState<string>("Si-Wafer-Bench");
  const [materialName, setMaterialName] = useState<string>("Silicon (n-type)");
  const [dopant, setDopant] = useState<string>("Phosphorus (P)");
  const [tempC, setTempC] = useState<number>(25);
  const [doAntisym, setDoAntisym] = useState<boolean>(true);

  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [result, setResult] = useState<HallAnalysisResult | null>(null);
  const [grounding, setGrounding] = useState<GroundingData | null>(null);
  const [aiReport, setAiReport] = useState<ScientificInterpretation | null>(null);

  const loadBenchmarkSample = () => {
    // Benchmark n-type silicon wafer (500 um thickness, 10 mA, 9.05 Ohm/sq)
    const benchmarkData = `# MatLens Benchmark n-type Silicon Wafer
# Geometry: Van der Pauw | Thickness: 500 um | Current: 10.0 mA | Sheet Res: 9.05 Ohm/sq
MagneticField_T,TransverseVoltage_mV
-1.00,13.1342
-0.90,11.8007
-0.80,10.5404
-0.70,9.2620
-0.60,8.0025
-0.50,6.7119
-0.40,5.4370
-0.30,4.2239
-0.20,2.8909
-0.10,1.7217
0.00,0.4659
0.10,-0.8148
0.20,-2.0361
0.30,-3.3069
0.40,-4.5520
0.50,-5.7328
0.60,-6.9909
0.70,-8.1699
0.80,-9.3814
0.90,-10.6670
1.00,-11.9039`;
    setRawText(benchmarkData);
    setThicknessUm(500);
    setCurrentMa(10);
    setSheetResist(9.05);
    setSampleId("Si-Wafer-Bench");
    setMaterialName("Silicon (n-type)");
    setDopant("Phosphorus (P)");
    setTempC(25);
    setErrorMsg(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result as string;
      setRawText(content);
      setErrorMsg(null);
    };
    reader.readAsText(file);
  };

  const executeAnalysis = async () => {
    if (!rawText.trim()) {
      setErrorMsg("Hall 측정 데이터(CSV/TXT)를 입력하거나 벤치마크 샘플을 로드하세요.");
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const resp = await api.runHallAnalysis({
        raw_text: rawText,
        thickness_um: thicknessUm,
        current_mA: currentMa,
        sheet_resistance_Ohm_sq: sheetResist,
        sample_id: sampleId,
        material_name: materialName,
        dopant: dopant,
        measurement_temperature_C: tempC,
        do_antisymmetrization: doAntisym,
        include_ai_interpretation: true,
      });
      setResult(resp.calculated_properties);
      setGrounding(resp.grounding);
      setAiReport(resp.ai_interpretation);

      // Save to shared measurement storage for continuous cross-instrument integration
      try {
        localStorage.setItem(
          "matlens_shared_hall_data",
          JSON.stringify({
            sample_id: sampleId,
            material_name: materialName,
            dopant: dopant,
            temperature_C: tempC,
            carrier_concentration_cm3: resp.calculated_properties.carrier_concentration_cm3,
            hall_mobility_cm2_Vs: resp.calculated_properties.hall_mobility_cm2_Vs,
            electrical_conductivity_S_cm: resp.calculated_properties.electrical_conductivity_S_cm,
            carrier_type: resp.calculated_properties.carrier_type,
            resistivity_Ohm_cm: resp.calculated_properties.resistivity_Ohm_cm,
            timestamp: new Date().toISOString(),
          })
        );
      } catch (e) {
        console.warn("Failed to persist Hall data to localStorage:", e);
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Hall 분석 실행에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  // Build Plotly figure data
  const plotData: any[] = [];
  if (result) {
    // 1. Raw measurements
    plotData.push({
      x: result.raw_b_field,
      y: result.raw_v_hall,
      mode: "markers",
      name: "실측 Hall 전압 (V_raw)",
      marker: { color: "#94A3B8", size: 6, symbol: "circle-open" },
    });

    // 2. Antisymmetrized curve
    if (result.antisym_b_field.length > 0) {
      plotData.push({
        x: result.antisym_b_field,
        y: result.antisym_v_hall,
        mode: "markers",
        name: "비대칭화 전압 (V_anti)",
        marker: { color: "#3182F6", size: 8, symbol: "circle" },
      });
    }

    // 3. Linear regression line
    if (result.fitted_v_hall.length > 0) {
      plotData.push({
        x: result.antisym_b_field,
        y: result.fitted_v_hall,
        mode: "lines",
        name: `선형 피팅 (R² = ${result.r_squared.toFixed(4)})`,
        line: { color: "#2563EB", width: 2, dash: "solid" },
      });
    }
  }

  const plotLayout = {
    title: {
      text: `${sampleId} — Hall Voltage vs Magnetic Field`,
      font: { size: 15, family: "Pretendard, sans-serif" },
    },
    xaxis: {
      title: "Magnetic Field B (T)",
      showgrid: true,
      zeroline: true,
      zerolinecolor: "#CBD5E1",
      gridcolor: "#F1F5F9",
    },
    yaxis: {
      title: "Hall Voltage V_H (mV)",
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
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#EBF4FF] text-[#3182F6] text-[12px] font-bold mb-2">
            <Zap className="w-3.5 h-3.5" />
            MatLens 2.0 Module
          </div>
          <h2 className="text-[22px] font-bold text-[#191F28]">Hall Effect Measurement 정량 분석 모듈</h2>
          <p className="text-[14px] text-[#6B7684] mt-1">
            원시 전압 데이터로부터 ±B 비대칭화(Antisymmetrization), 캐리어 농도(n_H), 이동도(µ_H), 전도도(σ)를 결정론적으로 계산하고 학술 논문 근거를 검증합니다.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={loadBenchmarkSample}
            className="px-4 py-2 rounded-[12px] bg-[#F2F4F6] hover:bg-[#E5E8EB] text-[#333D4B] text-[13px] font-semibold transition flex items-center gap-1.5 cursor-pointer"
          >
            <Activity className="w-4 h-4 text-[#3182F6]" />
            벤치마크 n-Si 샘플 로드
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-[16px] bg-[#FEE2E2] border border-[#FECACA] p-4 text-[13px] text-[#DC2626] flex justify-between items-center">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} className="font-semibold underline cursor-pointer">
            닫기
          </button>
        </div>
      )}

      {/* Input Configuration & File Area */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white rounded-[20px] p-6 border border-[#E5E8EB] shadow-sm space-y-4">
          <h3 className="text-[16px] font-bold text-[#191F28] flex items-center gap-2">
            <Upload className="w-4 h-4 text-[#3182F6]" />
            측정 조건 및 데이터 입력
          </h3>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">시료 ID (Sample ID)</label>
              <input
                type="text"
                value={sampleId}
                onChange={(e) => setSampleId(e.target.value)}
                className="w-full px-3 py-2 rounded-[10px] border border-[#E5E8EB] text-[13px]"
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">재료명 (Material Name)</label>
              <input
                type="text"
                value={materialName}
                onChange={(e) => setMaterialName(e.target.value)}
                className="w-full px-3 py-2 rounded-[10px] border border-[#E5E8EB] text-[13px]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">도펀트 (Dopant)</label>
              <input
                type="text"
                value={dopant}
                onChange={(e) => setDopant(e.target.value)}
                className="w-full px-3 py-2 rounded-[10px] border border-[#E5E8EB] text-[13px]"
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

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">두께 (Thickness, µm)</label>
              <input
                type="number"
                value={thicknessUm}
                onChange={(e) => setThicknessUm(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-[10px] border border-[#E5E8EB] text-[13px]"
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">인가 전류 (Current, mA)</label>
              <input
                type="number"
                value={currentMa}
                onChange={(e) => setCurrentMa(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-[10px] border border-[#E5E8EB] text-[13px]"
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">면저항 (R_sheet, Ω/sq)</label>
              <input
                type="number"
                value={sheetResist}
                onChange={(e) => setSheetResist(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-[10px] border border-[#E5E8EB] text-[13px]"
              />
            </div>
          </div>

          <div className="pt-2">
            <label className="flex items-center gap-2 cursor-pointer text-[13px] font-medium text-[#333D4B]">
              <input
                type="checkbox"
                checked={doAntisym}
                onChange={(e) => setDoAntisym(e.target.checked)}
                className="rounded border-[#CBD5E1] text-[#3182F6] focus:ring-[#3182F6]"
              />
              <span>±B 비대칭화 적용 (V_longitudinal 오프셋 전압 제거)</span>
            </label>
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-[12px] font-semibold text-[#4E5968]">원시 데이터 (B vs V_H) 입력 또는 파일 업로드</label>
              <label className="text-[12px] text-[#3182F6] font-semibold cursor-pointer hover:underline">
                파일 찾기 (CSV/TXT)
                <input type="file" accept=".csv,.txt,.dat" onChange={handleFileUpload} className="hidden" />
              </label>
            </div>
            <textarea
              rows={8}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder="MagneticField_T,TransverseVoltage_mV&#10;-1.0, 13.13&#10;1.0, -11.90..."
              className="w-full px-3 py-2 rounded-[10px] border border-[#E5E8EB] font-mono text-[12px] bg-[#F8FAFC]"
            />
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={executeAnalysis}
            className="w-full py-3 rounded-[12px] bg-[#3182F6] hover:bg-[#1B64DA] text-white text-[14px] font-bold transition flex justify-center items-center gap-2 cursor-pointer shadow"
          >
            {loading ? "계산 및 학술 근거 검증 중..." : "Hall 정량 분석 및 AI 검증 실행"}
          </button>
        </div>

        {/* Graph and Summary Results */}
        <div className="lg:col-span-7 bg-white rounded-[20px] p-6 border border-[#E5E8EB] shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-[16px] font-bold text-[#191F28] mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-[#3182F6]" />
                Hall Voltage 곡선 & 선형 회귀 분석
              </span>
              {result && (
                <span className="text-[12px] font-medium text-[#6B7684]">
                  선형 결정계수 R² = <strong className="text-[#191F28]">{result.r_squared.toFixed(5)}</strong>
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
                왼쪽에서 데이터를 로드하고 분석을 실행하면 인터랙티브 그래프가 생성됩니다.
              </div>
            )}
          </div>

          {/* Quick Quantitative Table */}
          {result && (
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#F8FAFC] p-3.5 rounded-[14px] border border-[#E2E8F0]">
              <div>
                <span className="text-[11px] font-semibold text-[#64748B] block">캐리어 타입</span>
                <span className="text-[14px] font-bold text-[#2563EB]">{result.carrier_type.split(" ")[0]}</span>
              </div>
              <div>
                <span className="text-[11px] font-semibold text-[#64748B] block">벌크 농도 (n_H)</span>
                <span className="text-[14px] font-bold text-[#1E293B]">{result.carrier_concentration_cm3.toExponential(2)} cm⁻³</span>
              </div>
              <div>
                <span className="text-[11px] font-semibold text-[#64748B] block">Hall 이동도 (µ_H)</span>
                <span className="text-[14px] font-bold text-[#1E293B]">
                  {result.hall_mobility_cm2_Vs ? `${result.hall_mobility_cm2_Vs.toFixed(1)} cm²/Vs` : "저항값 필요"}
                </span>
              </div>
              <div>
                <span className="text-[11px] font-semibold text-[#64748B] block">전기 전도도 (σ)</span>
                <span className="text-[14px] font-bold text-[#1E293B]">
                  {result.electrical_conductivity_S_cm ? `${result.electrical_conductivity_S_cm.toFixed(2)} S/cm` : "저항값 필요"}
                </span>
              </div>
            </div>
          )}

          {/* Continuous Integration Flow Banner */}
          {result && (
            <div className="mt-4 p-3.5 rounded-[12px] bg-[#EFF6FF] border border-[#BFDBFE] flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#2563EB] shrink-0" />
                <span className="text-[12px] text-[#1E40AF] font-medium">
                  Hall 측정 데이터가 <strong>'통합 리포트'</strong>에 자동 연계되었습니다. (농도: {result.carrier_concentration_cm3.toExponential(2)} cm⁻³)
                </span>
              </div>
              {onNavigateToIntegrated && (
                <button
                  type="button"
                  onClick={onNavigateToIntegrated}
                  className="px-3 py-1 rounded-[8px] bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-[11px] font-bold transition flex items-center gap-1 shrink-0 cursor-pointer shadow-sm"
                >
                  <Share2 className="w-3 h-3" />
                  통합 리포트에서 교차 분석 →
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Scientific Literature Grounding & Claims Panel */}
      {grounding && (
        <div className="bg-white rounded-[20px] p-6 border border-[#E5E8EB] shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
            <h3 className="text-[16px] font-bold text-[#191F28] flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-[#3182F6]" />
              학술 논문 기반 과학적 근거 검증 (Scientific Grounding)
            </h3>
            <span className="px-2.5 py-0.5 rounded-full text-[12px] font-semibold bg-[#DCFCE7] text-[#16A34A]">
              7-Step Protocol 검증 완료
            </span>
          </div>

          {/* Categorized Claims */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {grounding.grounded_claims.map((claim, idx) => {
              let badgeColor = "bg-[#F1F5F9] text-[#475569]";
              if (claim.category === "Measured Fact") badgeColor = "bg-[#E0F2FE] text-[#0369A1]";
              else if (claim.category === "Calculated Result") badgeColor = "bg-[#EEF2FF] text-[#4338CA]";
              else if (claim.category === "Literature-Supported") badgeColor = "bg-[#DCFCE7] text-[#15803D]";
              else if (claim.category === "Hypothesis") badgeColor = "bg-[#FEF3C7] text-[#B45309]";
              else if (claim.category === "Insufficient Evidence") badgeColor = "bg-[#FEE2E2] text-[#B91C1C]";

              return (
                <div key={idx} className="p-3.5 rounded-[12px] border border-[#E2E8F0] bg-[#FAFAFA] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${badgeColor}`}>
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
                      * 한계 및 검증 조건: {claim.limitation_note}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Verified Literature References */}
          {grounding.verified_references.length > 0 && (
            <div className="mt-4 pt-4 border-t border-[#F1F5F9]">
              <h4 className="text-[13px] font-bold text-[#475569] mb-2">검증된 학술 인용 문헌</h4>
              <div className="space-y-2">
                {grounding.verified_references.map((ref, idx) => (
                  <div key={idx} className="text-[12px] text-[#334155] p-2.5 rounded-[10px] bg-[#F8FAFC] border border-[#E2E8F0] flex justify-between items-center">
                    <div>
                      <strong className="text-[#0F172A]">{ref.title}</strong> — {ref.journal} ({ref.year})
                      <span className="text-[#64748B] block mt-0.5">
                        저자: {ref.authors.slice(0, 3).join(", ")} | 적합성: {ref.category_label || "참고 문헌"}
                      </span>
                    </div>
                    <a
                      href={`https://doi.org/${ref.doi}`}
                      target="_blank"
                      rel="noreferrer"
                      className="px-2.5 py-1 rounded-[8px] bg-white border border-[#CBD5E1] text-[#2563EB] hover:bg-[#F1F5F9] font-medium text-[11px]"
                    >
                      원문 링크
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Structured 12-Section Vertex AI Scientific Report */}
      {aiReport && (
        <div className="bg-white rounded-[20px] p-6 border border-[#E5E8EB] shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
            <h3 className="text-[16px] font-bold text-[#191F28] flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[#8B5CF6]" />
              Vertex AI 정밀 과학 리포트 (Structured 12-Section Report)
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
                <h4 className="font-bold text-[#0F172A] mb-1">3. 데이터 신뢰도 (Data Quality Assessment)</h4>
                <p className="bg-[#F8FAFC] p-3 rounded-[10px] border border-[#E2E8F0]">{aiReport.data_quality_assessment}</p>
              </div>
              <div>
                <h4 className="font-bold text-[#0F172A] mb-1">5. 그래프 해석 (Graph Interpretation)</h4>
                <p className="bg-[#F8FAFC] p-3 rounded-[10px] border border-[#E2E8F0]">{aiReport.graph_interpretation}</p>
              </div>
            </div>

            <div>
              <h4 className="font-bold text-[#0F172A] mb-1">7. 문헌 비교 (Literature Comparison)</h4>
              <p className="bg-[#F8FAFC] p-3 rounded-[10px] border border-[#E2E8F0]">{aiReport.literature_comparison}</p>
            </div>

            <div>
              <h4 className="font-bold text-[#0F172A] mb-1">8. 수송 메커니즘 고찰 (Mechanism Discussion)</h4>
              <p className="bg-[#F8FAFC] p-3 rounded-[10px] border border-[#E2E8F0]">{aiReport.mechanism_discussion}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="font-bold text-[#0F172A] mb-1">9. 대체 가설 (Alternative Explanations)</h4>
                <p className="bg-[#F8FAFC] p-3 rounded-[10px] border border-[#E2E8F0]">{aiReport.alternative_explanations}</p>
              </div>
              <div>
                <h4 className="font-bold text-[#0F172A] mb-1">10. 한계 및 불확도 (Limitations & Uncertainty)</h4>
                <p className="bg-[#F8FAFC] p-3 rounded-[10px] border border-[#E2E8F0]">{aiReport.limitations_and_uncertainty}</p>
              </div>
            </div>

            <div>
              <h4 className="font-bold text-[#0F172A] mb-1">11. 제안하는 추가 검증 실험 (Suggested Additional Experiments)</h4>
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
