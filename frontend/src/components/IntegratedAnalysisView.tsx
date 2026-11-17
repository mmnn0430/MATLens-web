import { useState } from "react";
import {
  Activity,
  Cpu,
  Flame,
  Layers,
  Share2,
  Sparkles,
} from "lucide-react";
import { api } from "../api";
import { PlotlyChart } from "./PlotlyChart";
import type { IntegratedAnalysisResult } from "../types";

export function IntegratedAnalysisView() {
  const [sampleId, setSampleId] = useState<string>("NbFeSb-SPS-01");
  const [materialName, setMaterialName] = useState<string>("NbFeSb half-Heusler");
  const [tempK, setTempK] = useState<number>(300);

  // Technique dataset inputs
  const [hasXrd, setHasXrd] = useState<boolean>(true);
  const [crystalliteNm, setCrystalliteNm] = useState<number>(42.5);

  const [hasSem, setHasSem] = useState<boolean>(true);
  const [grainSizeUm, setGrainSizeUm] = useState<number>(2.4);
  const [porosityPct, setPorosityPct] = useState<number>(1.2);

  const [hasHall, setHasHall] = useState<boolean>(true);
  const [carrierConc, setCarrierConc] = useState<number>(4.2e20);
  const [hallMobility, setHallMobility] = useState<number>(22.0);
  const [elecCond, setElecCond] = useState<number>(1500.0);

  const [hasLfa, setHasLfa] = useState<boolean>(true);
  const [thermalDiff, setThermalDiff] = useState<number>(2.1);
  const [thermalCond, setThermalCond] = useState<number>(4.8);

  const [hasUtm, setHasUtm] = useState<boolean>(false);
  const youngsModulus = 180;

  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<IntegratedAnalysisResult | null>(null);

  const loadDemoScenario = () => {
    setSampleId("NbFeSb-SPS-01");
    setMaterialName("NbFeSb half-Heusler (SPS Sintered)");
    setTempK(300);
    setHasXrd(true);
    setCrystalliteNm(42.5);
    setHasSem(true);
    setGrainSizeUm(2.4);
    setPorosityPct(1.2);
    setHasHall(true);
    setCarrierConc(4.2e20);
    setHallMobility(22.0);
    setElecCond(1500.0);
    setHasLfa(true);
    setThermalDiff(2.1);
    setThermalCond(4.8);
    setHasUtm(false);
  };

  const executeIntegration = async () => {
    setLoading(true);
    try {
      const resp = await api.runIntegratedAnalysis({
        sample_id: sampleId,
        material_name: materialName,
        temperature_K: tempK,
        xrd_data: hasXrd ? { crystallite_size_nm: crystalliteNm, space_group: "F-43m" } : null,
        sem_data: hasSem ? { grain_size_um: grainSizeUm, porosity_pct: porosityPct } : null,
        hall_data: hasHall
          ? {
              carrier_concentration_cm3: carrierConc,
              hall_mobility_cm2_Vs: hallMobility,
              electrical_conductivity_S_cm: elecCond,
            }
          : null,
        lfa_data: hasLfa ? { thermal_diffusivity_mm2_s: thermalDiff, thermal_conductivity_W_mK: thermalCond } : null,
        utm_data: hasUtm ? { youngs_modulus_GPa: youngsModulus } : null,
      });
      setResult(resp);
    } catch (err: any) {
      alert("통합 분석 실행 오류: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Pie chart data for Wiedemann-Franz Law breakdown
  const pieData = result?.wiedemann_franz
    ? [
        {
          values: [
            result.wiedemann_franz.lattice_thermal_conductivity_W_mK,
            result.wiedemann_franz.electronic_thermal_conductivity_W_mK,
          ],
          labels: ["격자 포논 열전도 (κ_L)", "전하 캐리어 전자 열전도 (κ_e)"],
          type: "pie",
          marker: { colors: ["#3B82F6", "#F59E0B"] },
          hoverinfo: "label+percent+value",
          textinfo: "label+percent",
        },
      ]
    : [];

  const pieLayout = {
    title: {
      text: "Wiedemann–Franz Law 열전도 메커니즘 분리 (κ = κ_e + κ_L)",
      font: { size: 14, family: "Pretendard, sans-serif" },
    },
    margin: { t: 40, r: 20, b: 20, l: 20 },
    paper_bgcolor: "#FFFFFF",
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white rounded-[20px] p-6 border border-[#E5E8EB] shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#EDE9FE] text-[#7C3AED] text-[12px] font-bold mb-2">
            <Share2 className="w-3.5 h-3.5" />
            MatLens 2.0 Core Feature
          </div>
          <h2 className="text-[22px] font-bold text-[#191F28]">Cross-Instrument 다종 기기 통합 연계 분석</h2>
          <p className="text-[14px] text-[#6B7684] mt-1">
            XRD(결정상) · SEM(미세조직) · Hall(전하 수송) · LFA(열 수송) 데이터를 시료 ID 기준으로 연결하여 Wiedemann–Franz 분리 및 물성 상관관계를 분석합니다.
          </p>
        </div>
        <div>
          <button
            type="button"
            onClick={loadDemoScenario}
            className="px-4 py-2 rounded-[12px] bg-[#F2F4F6] hover:bg-[#E5E8EB] text-[#333D4B] text-[13px] font-semibold transition flex items-center gap-1.5 cursor-pointer"
          >
            <Activity className="w-4 h-4 text-[#7C3AED]" />
            NbFeSb 전주기 예시 로드
          </button>
        </div>
      </div>

      {/* Dataset Association Panel */}
      <div className="bg-white rounded-[20px] p-6 border border-[#E5E8EB] shadow-sm space-y-4">
        <h3 className="text-[16px] font-bold text-[#191F28] flex items-center gap-2">
          <Layers className="w-4 h-4 text-[#7C3AED]" />
          분석기기 데이터셋 연계 설정
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">시료 ID (Sample ID)</label>
            <input
              type="text"
              value={sampleId}
              onChange={(e) => setSampleId(e.target.value)}
              className="w-full px-3 py-2 rounded-[10px] border border-[#E5E8EB] text-[13px] font-bold"
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
          <div>
            <label className="block text-[12px] font-semibold text-[#4E5968] mb-1">평가 온도 T (K)</label>
            <input
              type="number"
              value={tempK}
              onChange={(e) => setTempK(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-[10px] border border-[#E5E8EB] text-[13px]"
            />
          </div>
        </div>

        {/* Instrument Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
          {/* XRD */}
          <div className={`p-4 rounded-[14px] border ${hasXrd ? "border-[#3182F6] bg-[#F8FAFC]" : "border-[#E5E8EB] bg-[#FAFAFA] opacity-60"}`}>
            <label className="flex items-center gap-2 cursor-pointer font-bold text-[13px] text-[#191F28] mb-2">
              <input type="checkbox" checked={hasXrd} onChange={(e) => setHasXrd(e.target.checked)} />
              <span>XRD 결정구조 데이터</span>
            </label>
            <div className="space-y-1.5 text-[12px]">
              <span className="text-[#64748B] block">Scherrer 결정립경:</span>
              <input
                type="number"
                disabled={!hasXrd}
                value={crystalliteNm}
                onChange={(e) => setCrystalliteNm(Number(e.target.value))}
                className="w-full px-2 py-1 rounded-[6px] border border-[#CBD5E1] bg-white text-[12px]"
              />
              <span className="text-[11px] text-[#94A3B8]">단위: nm</span>
            </div>
          </div>

          {/* SEM */}
          <div className={`p-4 rounded-[14px] border ${hasSem ? "border-[#3182F6] bg-[#F8FAFC]" : "border-[#E5E8EB] bg-[#FAFAFA] opacity-60"}`}>
            <label className="flex items-center gap-2 cursor-pointer font-bold text-[13px] text-[#191F28] mb-2">
              <input type="checkbox" checked={hasSem} onChange={(e) => setHasSem(e.target.checked)} />
              <span>SEM 미세조직 데이터</span>
            </label>
            <div className="space-y-1.5 text-[12px]">
              <span className="text-[#64748B] block">평균 입경 (Grain Size):</span>
              <input
                type="number"
                step="0.1"
                disabled={!hasSem}
                value={grainSizeUm}
                onChange={(e) => setGrainSizeUm(Number(e.target.value))}
                className="w-full px-2 py-1 rounded-[6px] border border-[#CBD5E1] bg-white text-[12px]"
              />
              <span className="text-[11px] text-[#94A3B8]">단위: µm (기공률 {porosityPct}%)</span>
            </div>
          </div>

          {/* Hall */}
          <div className={`p-4 rounded-[14px] border ${hasHall ? "border-[#3182F6] bg-[#F8FAFC]" : "border-[#E5E8EB] bg-[#FAFAFA] opacity-60"}`}>
            <label className="flex items-center gap-2 cursor-pointer font-bold text-[13px] text-[#191F28] mb-2">
              <input type="checkbox" checked={hasHall} onChange={(e) => setHasHall(e.target.checked)} />
              <span>Hall 전하수송 데이터</span>
            </label>
            <div className="space-y-1.5 text-[12px]">
              <span className="text-[#64748B] block">전기 전도도 (σ, S/cm):</span>
              <input
                type="number"
                disabled={!hasHall}
                value={elecCond}
                onChange={(e) => setElecCond(Number(e.target.value))}
                className="w-full px-2 py-1 rounded-[6px] border border-[#CBD5E1] bg-white text-[12px]"
              />
              <span className="text-[11px] text-[#94A3B8]">이동도: {hallMobility} cm²/Vs</span>
            </div>
          </div>

          {/* LFA */}
          <div className={`p-4 rounded-[14px] border ${hasLfa ? "border-[#3182F6] bg-[#F8FAFC]" : "border-[#E5E8EB] bg-[#FAFAFA] opacity-60"}`}>
            <label className="flex items-center gap-2 cursor-pointer font-bold text-[13px] text-[#191F28] mb-2">
              <input type="checkbox" checked={hasLfa} onChange={(e) => setHasLfa(e.target.checked)} />
              <span>LFA 열물성 데이터</span>
            </label>
            <div className="space-y-1.5 text-[12px]">
              <span className="text-[#64748B] block">열전도도 (κ, W/m·K):</span>
              <input
                type="number"
                step="0.1"
                disabled={!hasLfa}
                value={thermalCond}
                onChange={(e) => setThermalCond(Number(e.target.value))}
                className="w-full px-2 py-1 rounded-[6px] border border-[#CBD5E1] bg-white text-[12px]"
              />
              <span className="text-[11px] text-[#94A3B8]">열확산도: {thermalDiff} mm²/s</span>
            </div>
          </div>
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={executeIntegration}
          className="w-full py-3 rounded-[12px] bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-[14px] font-bold transition flex justify-center items-center gap-2 cursor-pointer shadow"
        >
          {loading ? "기기 간 물리 모델 연계 분석 중..." : "다종 기기 통합 연계 분석 실행"}
        </button>
      </div>

      {/* Synthesis-to-Properties Chain */}
      {result && (
        <div className="bg-white rounded-[20px] p-6 border border-[#E5E8EB] shadow-sm space-y-4">
          <h3 className="text-[16px] font-bold text-[#191F28] flex items-center gap-2">
            <Cpu className="w-5 h-5 text-[#7C3AED]" />
            재료 전주기 흐름 (Synthesis → Structure → Transport → Mechanics)
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            {result.synthesis_to_properties_chain.map((st, idx) => (
              <div key={idx} className="p-3.5 rounded-[12px] border border-[#E2E8F0] bg-[#F8FAFC] flex flex-col justify-between">
                <div>
                  <span className="text-[12px] font-bold text-[#7C3AED] block">{st.stage}</span>
                  <p className="text-[12px] text-[#334155] mt-1 font-medium">{st.description}</p>
                </div>
                <span className="text-[11px] font-semibold text-[#64748B] mt-2 block border-t border-[#E2E8F0] pt-1">
                  데이터: {st.data_source}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Wiedemann-Franz Law & Correlations Results */}
      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Pie Chart of Wiedemann-Franz */}
          {result.wiedemann_franz && (
            <div className="lg:col-span-5 bg-white rounded-[20px] p-6 border border-[#E5E8EB] shadow-sm flex flex-col justify-between">
              <div>
                <h4 className="text-[15px] font-bold text-[#191F28] mb-2 flex items-center gap-2">
                  <Flame className="w-4 h-4 text-[#F59E0B]" />
                  Wiedemann–Franz Law 열수송 분리
                </h4>
                <div className="rounded-[12px] border border-[#E5E8EB] overflow-hidden">
                  <PlotlyChart data={pieData} layout={pieLayout} config={{ responsive: true }} style={{ width: "100%", height: "260px" }} />
                </div>
              </div>

              <div className="mt-4 p-3.5 bg-[#F8FAFC] rounded-[12px] border border-[#E2E8F0] space-y-1 text-[12px]">
                <div className="flex justify-between">
                  <span className="text-[#64748B]">전체 열전도도 (κ_total):</span>
                  <strong className="text-[#1E293B]">{result.wiedemann_franz.total_thermal_conductivity_W_mK} W/m·K</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#64748B]">포논 격자 열전도도 (κ_L):</span>
                  <strong className="text-[#3B82F6]">
                    {result.wiedemann_franz.lattice_thermal_conductivity_W_mK} W/m·K ({result.wiedemann_franz.lattice_fraction_pct}%)
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#64748B]">전자 열전도도 (κ_e):</span>
                  <strong className="text-[#F59E0B]">
                    {result.wiedemann_franz.electronic_thermal_conductivity_W_mK} W/m·K ({result.wiedemann_franz.electronic_fraction_pct}%)
                  </strong>
                </div>
              </div>
            </div>
          )}

          {/* Cross-Instrument Correlations */}
          <div className="lg:col-span-7 bg-white rounded-[20px] p-6 border border-[#E5E8EB] shadow-sm space-y-4">
            <h4 className="text-[15px] font-bold text-[#191F28] flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#7C3AED]" />
              물리적 상관관계 및 메커니즘 고찰
            </h4>

            {result.xrd_sem_correlation && (
              <div className="p-3.5 rounded-[12px] bg-[#F8FAFC] border border-[#E2E8F0] space-y-1">
                <span className="text-[12px] font-bold text-[#2563EB] block">XRD + SEM: 결정립경(Crystallite) vs 입경(Grain)</span>
                <p className="text-[12px] text-[#334155] leading-relaxed">{result.xrd_sem_correlation.interpretation}</p>
                <span className="text-[11px] text-[#64748B] block italic">{result.xrd_sem_correlation.conceptual_distinction}</span>
              </div>
            )}

            {result.sem_hall_correlation && (
              <div className="p-3.5 rounded-[12px] bg-[#F8FAFC] border border-[#E2E8F0] space-y-1">
                <span className="text-[12px] font-bold text-[#7C3AED] block">SEM + Hall: 결정립계 전하 산란 (Petritz 가설)</span>
                <p className="text-[12px] text-[#334155] leading-relaxed">{result.sem_hall_correlation.scattering_hypothesis}</p>
                <span className="text-[11px] text-[#64748B] block italic">검증 방안: {result.sem_hall_correlation.test_recommendation}</span>
              </div>
            )}

            {result.sem_lfa_correlation && (
              <div className="p-3.5 rounded-[12px] bg-[#F8FAFC] border border-[#E2E8F0] space-y-1">
                <span className="text-[12px] font-bold text-[#D97706] block">SEM + LFA: 기공률 및 계면 포논 산란 (Maxwell-Eucken)</span>
                <p className="text-[12px] text-[#334155] leading-relaxed">{result.sem_lfa_correlation.interpretation}</p>
                <span className="text-[11px] text-[#64748B] block italic">모델: {result.sem_lfa_correlation.model}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
