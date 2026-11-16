import React from "react";
import {
  FileCheck2,
  BookMarked,
  Lightbulb,
  AlertTriangle,
  Compass,
  ShieldCheck,
  CheckCircle,
  HelpCircle,
  XCircle,
} from "lucide-react";
import type { LiteratureValidationReport, ReliabilityStatus } from "../types";
import { Card } from "./ui/primitives";

interface ScientificInterpretationPanelProps {
  report: LiteratureValidationReport;
}

function getReliabilityBadge(status: ReliabilityStatus) {
  switch (status) {
    case "Supported":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#ECFDF5] text-[#047857] text-[12px] font-bold">
          <CheckCircle className="w-3.5 h-3.5" /> 검증 일치 (Supported)
        </span>
      );
    case "Partially Supported":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#FFFBEB] text-[#B45309] text-[12px] font-bold">
          <AlertTriangle className="w-3.5 h-3.5" /> 부분 일치 (Partially Supported)
        </span>
      );
    case "Insufficient Evidence":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#F3F4F6] text-[#4B5563] text-[12px] font-bold">
          <HelpCircle className="w-3.5 h-3.5" /> 근거 부족 (Insufficient Evidence)
        </span>
      );
    case "Conflicting Evidence":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#FEF2F2] text-[#B91C1C] text-[12px] font-bold">
          <XCircle className="w-3.5 h-3.5" /> 근거 상충 (Conflicting Evidence)
        </span>
      );
    case "Not Comparable":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#FEF2F2] text-[#DC2626] text-[12px] font-bold">
          <XCircle className="w-3.5 h-3.5" /> 직접 비교 불가 (Not Comparable)
        </span>
      );
    default:
      return null;
  }
}

export const ScientificInterpretationPanel: React.FC<ScientificInterpretationPanelProps> = ({ report }) => {
  const { reliability } = report;

  return (
    <div className="space-y-6">
      {/* Dual Reliability Assessment Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 1. Analytical Reliability */}
        <Card className="p-5 bg-white border border-[#E5E8EB] rounded-[16px] shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-[#F2F4F6] pb-2.5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-[#3182F6]" />
              <h4 className="text-[14px] font-bold text-[#191F28]">
                측정 및 계산 신뢰도 (Analytical Reliability)
              </h4>
            </div>
            {getReliabilityBadge(reliability.analytical.status)}
          </div>
          <div className="text-[12px] space-y-1.5 text-[#4E5968]">
            <div className="flex justify-between">
              <span className="text-[#8B95A1]">측정 보정(스케일/파장):</span>
              <span className="font-semibold text-[#191F28]">
                {reliability.analytical.calibration_availability ? "확인 완료" : "미확인(주의)"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#8B95A1]">신호 품질:</span>
              <span className="font-semibold text-[#191F28]">{reliability.analytical.data_quality_label}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#8B95A1]">피팅 잔차 / 결정계수:</span>
              <span className="font-semibold font-mono text-[#191F28]">
                {reliability.analytical.fitting_residual_label}
              </span>
            </div>
          </div>
          {reliability.analytical.details.length > 0 && (
            <ul className="text-[11px] text-[#6B7684] space-y-0.5 pt-1 border-t border-[#F2F4F6] list-disc list-inside">
              {reliability.analytical.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
        </Card>

        {/* 2. Interpretation Reliability */}
        <Card className="p-5 bg-white border border-[#E5E8EB] rounded-[16px] shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-[#F2F4F6] pb-2.5">
            <div className="flex items-center gap-2">
              <BookMarked className="w-5 h-5 text-[#3182F6]" />
              <h4 className="text-[14px] font-bold text-[#191F28]">
                학술 해석 신뢰도 (Interpretation Reliability)
              </h4>
            </div>
            {getReliabilityBadge(reliability.interpretation.status)}
          </div>
          <div className="text-[12px] space-y-1.5 text-[#4E5968]">
            <div className="flex justify-between">
              <span className="text-[#8B95A1]">문헌 근거 추적성:</span>
              <span className="font-semibold text-[#191F28]">
                {reliability.interpretation.evidence_traceability}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#8B95A1]">실험 조건 부합성:</span>
              <span className="font-semibold text-[#191F28]">
                {reliability.interpretation.condition_compatibility_label}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#8B95A1]">선행연구 일치 수준:</span>
              <span className="font-semibold text-[#191F28]">
                {reliability.interpretation.literature_agreement}
              </span>
            </div>
          </div>
          {reliability.interpretation.details.length > 0 && (
            <ul className="text-[11px] text-[#6B7684] space-y-0.5 pt-1 border-t border-[#F2F4F6] list-disc list-inside">
              {reliability.interpretation.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* 3 Scientific Tiers (Section 7 standard) */}
      <div className="space-y-4">
        {/* Tier A: Verified Measurement Findings */}
        <Card className="p-5 bg-white border border-[#E5E8EB] rounded-[16px] space-y-3">
          <div className="flex items-center gap-2 text-[#191F28]">
            <FileCheck2 className="w-5 h-5 text-[#059669]" />
            <h4 className="text-[15px] font-bold">A. 검증된 실측 결과 (Verified Measurement Findings)</h4>
            <span className="text-[11px] text-[#8B95A1]">* 사용자 측정 데이터 및 알고리즘으로 직접 계산·확인된 사실</span>
          </div>
          <ul className="space-y-2 text-[13px] text-[#333D4B]">
            {report.findings_verified.map((finding, idx) => (
              <li key={idx} className="flex items-start gap-2.5 p-2 rounded-[8px] bg-[#F9FAFB] border border-[#F2F4F6]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#059669] mt-2 shrink-0" />
                <span className="leading-relaxed">{finding}</span>
              </li>
            ))}
          </ul>
        </Card>

        {/* Tier B: Literature-Supported Findings */}
        <Card className="p-5 bg-white border border-[#E5E8EB] rounded-[16px] space-y-3">
          <div className="flex items-center gap-2 text-[#191F28]">
            <BookMarked className="w-5 h-5 text-[#3182F6]" />
            <h4 className="text-[15px] font-bold">B. 학술 문헌 근거 및 비교 (Literature-Supported Findings)</h4>
            <span className="text-[11px] text-[#8B95A1]">* 실제 공인 논문에서 확인된 수치 및 실험적 선행연구 비교</span>
          </div>
          <ul className="space-y-2 text-[13px] text-[#333D4B]">
            {report.findings_literature.map((finding, idx) => (
              <li key={idx} className="flex items-start gap-2.5 p-2 rounded-[8px] bg-[#F9FAFB] border border-[#F2F4F6]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#3182F6] mt-2 shrink-0" />
                <span className="leading-relaxed">{finding}</span>
              </li>
            ))}
          </ul>
        </Card>

        {/* Tier C: Hypotheses, Limitations & Recommended Experiments */}
        <Card className="p-5 bg-white border border-[#E5E8EB] rounded-[16px] space-y-4">
          <div className="flex items-center gap-2 text-[#191F28]">
            <Lightbulb className="w-5 h-5 text-[#D97706]" />
            <h4 className="text-[15px] font-bold">C. 과학적 해석 가설 및 한계 (Hypotheses & Limitations)</h4>
            <span className="text-[11px] text-[#8B95A1]">* 종합 해석에 따른 가능한 메커니즘 가설 및 측정 불확도</span>
          </div>
          <ul className="space-y-2 text-[13px] text-[#333D4B]">
            {report.hypotheses_and_limitations.map((hyp, idx) => (
              <li key={idx} className="flex items-start gap-2.5 p-2 rounded-[8px] bg-[#FFFBEB] border border-[#FEF3C7] text-[#92400E]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#D97706] mt-2 shrink-0" />
                <span className="leading-relaxed">{hyp}</span>
              </li>
            ))}
          </ul>

          {/* Recommended Next Experiments */}
          {report.recommended_experiments.length > 0 && (
            <div className="pt-2 border-t border-[#F2F4F6]">
              <div className="flex items-center gap-2 mb-2 text-[#191F28] font-bold text-[13px]">
                <Compass className="w-4 h-4 text-[#3182F6]" />
                <span>추가 검증 권장 실험 (Recommended Verification Experiments):</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {report.recommended_experiments.map((exp, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-[8px] text-[12px] text-[#334155] flex items-center gap-2"
                  >
                    <span className="px-1.5 py-0.5 rounded bg-[#E2E8F0] text-[10px] font-bold">
                      EX-{idx + 1}
                    </span>
                    <span>{exp}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Disclaimers */}
      <div className="p-4 bg-[#F9FAFB] rounded-[12px] border border-[#E5E8EB] text-[11px] text-[#8B95A1] space-y-1">
        <strong className="text-[#6B7684] block font-semibold">학술적 검증 고지 사항 (Scientific Disclaimer):</strong>
        {report.disclaimers.map((d, i) => (
          <p key={i}>• {d}</p>
        ))}
      </div>
    </div>
  );
};
