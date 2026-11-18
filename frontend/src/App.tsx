import React, { useState } from "react";
import { Layers } from "lucide-react";
import { UniversalBatchPlatformView } from "./components/batch/UniversalBatchPlatformView";
import type { InstrumentType } from "./core/batch/types";

export default function App() {
  const [currentInstrument, setCurrentInstrument] = useState<InstrumentType>("XRD");
  const [fileCounts, setFileCounts] = useState<Record<InstrumentType, number>>({
    XRD: 0,
    UTM: 0,
    SEM: 0,
    DSC: 0,
    TGA: 0,
    FTIR: 0,
    LFA: 0,
    GENERIC: 0,
  });

  const handleTabChange = (inst: InstrumentType) => {
    setCurrentInstrument(inst);
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#F7F8FA]">
      {/* Navigation Header – 기기별 개별 탭으로 깔끔하게 분리된 상단 헤더 */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-[#E5E8EB]">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* Logo */}
            <div className="flex items-center gap-2.5 shrink-0">
              <span className="w-8 h-8 rounded-[10px] bg-[#3182F6] text-white flex items-center justify-center shadow-sm">
                <Layers className="w-4 h-4" />
              </span>
              <span className="font-bold text-[19px] tracking-tight text-[#191F28]">
                MatLens
              </span>
            </div>

            {/* 개별 분리된 상단 기기 탭 바 (XRD, SEM 각각 독립 탭으로 분리) */}
            <div className="flex items-center p-1 rounded-[12px] bg-[#F2F4F6] border border-[#E5E8EB] ml-1 sm:ml-2 overflow-x-auto no-scrollbar">
              {/* 1. XRD 회절 분석 */}
              <button
                type="button"
                onClick={() => handleTabChange("XRD")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[13px] transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  currentInstrument === "XRD"
                    ? "bg-white text-[#191F28] shadow-sm font-bold"
                    : "text-[#6B7684] hover:text-[#191F28] font-semibold"
                }`}
              >
                <span>XRD 분석</span>
                {fileCounts.XRD > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-[#3182F6] text-white">
                    {fileCounts.XRD}
                  </span>
                )}
              </button>

              {/* 2. SEM 미세조직 분석 (독립 분리) */}
              <button
                type="button"
                onClick={() => handleTabChange("SEM")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[13px] transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  currentInstrument === "SEM"
                    ? "bg-white text-[#191F28] shadow-sm font-bold"
                    : "text-[#6B7684] hover:text-[#191F28] font-semibold"
                }`}
              >
                <span>SEM 분석</span>
                {fileCounts.SEM > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-[#8B5CF6] text-white">
                    {fileCounts.SEM}
                  </span>
                )}
              </button>

              {/* 3. UTM 인장시험 */}
              <button
                type="button"
                onClick={() => handleTabChange("UTM")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[13px] transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  currentInstrument === "UTM"
                    ? "bg-white text-[#191F28] shadow-sm font-bold"
                    : "text-[#6B7684] hover:text-[#191F28] font-semibold"
                }`}
              >
                <span>UTM 인장시험</span>
                {fileCounts.UTM > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-[#10B981] text-white">
                    {fileCounts.UTM}
                  </span>
                )}
              </button>

              {/* 4. DSC 열분석 */}
              <button
                type="button"
                onClick={() => handleTabChange("DSC")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[13px] transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  currentInstrument === "DSC"
                    ? "bg-white text-[#191F28] shadow-sm font-bold"
                    : "text-[#6B7684] hover:text-[#191F28] font-semibold"
                }`}
              >
                <span>DSC 열분석</span>
                {fileCounts.DSC > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-[#F59E0B] text-white">
                    {fileCounts.DSC}
                  </span>
                )}
              </button>

              {/* 5. TGA 열중량분석 */}
              <button
                type="button"
                onClick={() => handleTabChange("TGA")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[13px] transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  currentInstrument === "TGA"
                    ? "bg-white text-[#191F28] shadow-sm font-bold"
                    : "text-[#6B7684] hover:text-[#191F28] font-semibold"
                }`}
              >
                <span>TGA 열중량분석</span>
                {fileCounts.TGA > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-[#EC4899] text-white">
                    {fileCounts.TGA}
                  </span>
                )}
              </button>

              {/* 6. FTIR 적외선분광 */}
              <button
                type="button"
                onClick={() => handleTabChange("FTIR")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[13px] transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  currentInstrument === "FTIR"
                    ? "bg-white text-[#191F28] shadow-sm font-bold"
                    : "text-[#6B7684] hover:text-[#191F28] font-semibold"
                }`}
              >
                <span>FTIR 적외선분광</span>
                {fileCounts.FTIR > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-[#06B6D4] text-white">
                    {fileCounts.FTIR}
                  </span>
                )}
              </button>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2 shrink-0">
            <span className="text-[12px] text-[#6B7684] bg-[#F2F4F6] px-2.5 py-1 rounded-full font-medium">
              단일 및 복수 데이터 통합 분석
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-8 py-6 sm:py-8">
        <UniversalBatchPlatformView
          currentInstrument={currentInstrument}
          onInstrumentChange={setCurrentInstrument}
          onCountsChange={setFileCounts}
        />
      </main>
    </div>
  );
}
