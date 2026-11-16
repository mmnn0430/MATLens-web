import React, { useState } from "react";
import {
  BookOpen,
  ExternalLink,
  FileCheck,
  AlertTriangle,
  Info,
  ShieldAlert,
  ChevronDown,
  ChevronRight,
  FileText,
} from "lucide-react";
import type {
  LiteraturePaper,
  LiteratureValidationItem,
  ReliabilityStatus,
} from "../types";
import { Card } from "./ui/primitives";

interface LiteratureValidationPanelProps {
  papers: LiteraturePaper[];
  validations: LiteratureValidationItem[];
  materialName: string;
  instrumentType: string;
  isLoading?: boolean;
}

function getStatusBadge(status: ReliabilityStatus) {
  switch (status) {
    case "Supported":
      return (
        <span className="px-2.5 py-1 rounded-full bg-[#ECFDF5] text-[#047857] text-[11px] font-bold">
          검증 일치 (Supported)
        </span>
      );
    case "Partially Supported":
      return (
        <span className="px-2.5 py-1 rounded-full bg-[#FFFBEB] text-[#B45309] text-[11px] font-bold">
          부분 일치 (Partially Supported)
        </span>
      );
    case "Insufficient Evidence":
      return (
        <span className="px-2.5 py-1 rounded-full bg-[#F3F4F6] text-[#4B5563] text-[11px] font-bold">
          근거 부족 (Insufficient Evidence)
        </span>
      );
    case "Conflicting Evidence":
      return (
        <span className="px-2.5 py-1 rounded-full bg-[#FEF2F2] text-[#B91C1C] text-[11px] font-bold">
          근거 상충 (Conflicting Evidence)
        </span>
      );
    case "Not Comparable":
      return (
        <span className="px-2.5 py-1 rounded-full bg-[#FEF2F2] text-[#DC2626] text-[11px] font-bold">
          직접 비교 불가 (Not Comparable)
        </span>
      );
    default:
      return (
        <span className="px-2 py-0.5 rounded-full bg-[#F3F4F6] text-[#6B7684] text-[11px] font-medium">
          {status}
        </span>
      );
  }
}

export const LiteratureValidationPanel: React.FC<LiteratureValidationPanelProps> = ({
  papers,
  validations,
  materialName,
  instrumentType,
  isLoading = false,
}) => {
  const [expandedPaperId, setExpandedPaperId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <Card className="p-6 bg-white border border-[#E5E8EB] rounded-[16px] shadow-sm">
        <div className="flex items-center gap-3 text-[#4E5968]">
          <BookOpen className="w-5 h-5 text-[#3182F6] animate-pulse" />
          <span className="text-[14px] font-medium">
            OpenAlex 및 공인 학술 레퍼런스 데이터베이스에서 "{materialName}" 관련 논문을 자동 검색·대조 중입니다...
          </span>
        </div>
      </Card>
    );
  }

  if (!papers || papers.length === 0) {
    return (
      <Card className="p-6 bg-[#F9FAFB] border border-[#E5E8EB] rounded-[16px]">
        <div className="flex items-center gap-3 text-[#6B7684]">
          <Info className="w-5 h-5 text-[#8B95A1]" />
          <div>
            <p className="text-[14px] font-semibold text-[#333D4B]">
              검색된 공인 학술 문헌이 없습니다.
            </p>
            <p className="text-[12px] text-[#8B95A1] mt-0.5">
              시료 화학식 또는 예상 원소를 설정하면 보다 정확한 학술 논문 자동 매칭이 이루어집니다.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#E5E8EB] pb-3">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-[#3182F6]" />
          <h3 className="text-[16px] font-bold text-[#191F28]">
            학술 문헌 근거 패널 (Literature Grounding Panel)
          </h3>
          <span className="px-2 py-0.5 rounded-full bg-[#E8F3FF] text-[#1B64DA] text-[11px] font-semibold">
            {papers.length}편 확인됨
          </span>
        </div>
        <div className="text-[12px] text-[#6B7684]">
          대상: <strong className="text-[#333D4B]">{materialName}</strong> ({instrumentType})
        </div>
      </div>

      <div className="space-y-3">
        {validations.map((val, idx) => {
          const p = val.paper;
          const isExpanded = expandedPaperId === p.paper_id;
          const compat = val.compatibility;

          return (
            <Card
              key={p.paper_id || idx}
              className="p-4 sm:p-5 bg-white border border-[#E5E8EB] hover:border-[#3182F6]/50 rounded-[14px] transition-all shadow-sm"
            >
              {/* Paper Header */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {getStatusBadge(val.comparison_status)}
                    <span className="px-2 py-0.5 rounded-[6px] text-[11px] font-medium bg-[#F2F4F6] text-[#4E5968]">
                      적합도 {Math.round(val.relevance_score * 100)}%
                    </span>
                    {p.access_level === "full_text" ? (
                      <span className="px-2 py-0.5 rounded-[6px] text-[11px] font-medium bg-[#E8F3FF] text-[#1B64DA] inline-flex items-center gap-1">
                        <FileCheck className="w-3 h-3" /> Full Text
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-[6px] text-[11px] font-medium bg-[#F9FAFB] text-[#8B95A1] border border-[#E5E8EB]">
                        Abstract Only
                      </span>
                    )}
                    {p.open_access_status && p.open_access_status !== "closed" && (
                      <span className="px-2 py-0.5 rounded-[6px] text-[11px] font-medium bg-[#ECFDF5] text-[#059669]">
                        Open Access ({p.open_access_status})
                      </span>
                    )}
                  </div>

                  <h4 className="text-[15px] font-bold text-[#191F28] leading-snug pt-1">
                    {p.title}
                  </h4>

                  <p className="text-[12px] text-[#6B7684]">
                    {p.authors.slice(0, 4).join(", ")}
                    {p.authors.length > 4 ? ` 외 ${p.authors.length - 4}명` : ""}
                    {p.publication_year ? ` (${p.publication_year})` : ""} ·{" "}
                    <span className="italic">{p.journal || "학술지 미상"}</span>
                    {p.citation_count !== null && (
                      <span className="ml-1 text-[#8B95A1]">· 피인용 {p.citation_count}회</span>
                    )}
                  </p>
                </div>

                {/* External DOI Link */}
                {p.doi && (
                  <a
                    href={p.landing_page_url || `https://doi.org/${p.doi}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#3182F6] hover:text-[#1B64DA] hover:underline whitespace-nowrap self-start"
                  >
                    DOI: {p.doi}
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>

              {/* Condition Compatibility Alert if Warning exists */}
              {!compat.direct_comparison_allowed && compat.direct_comparison_warning && (
                <div className="mt-3 p-3 bg-[#FEF2F2] border border-[#FCA5A5] rounded-[10px] text-[12px] text-[#991B1B] flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-[#DC2626]" />
                  <div>
                    <strong className="font-bold">정량 직접 비교 제한: </strong>
                    {compat.direct_comparison_warning}
                  </div>
                </div>
              )}

              {compat.direct_comparison_allowed && compat.condition_mismatches.length > 0 && (
                <div className="mt-3 p-2.5 bg-[#FFFBEB] border border-[#FDE68A] rounded-[10px] text-[12px] text-[#92400E] flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-[#D97706]" />
                  <div>{compat.direct_comparison_warning}</div>
                </div>
              )}

              {/* Expand/Collapse Evidence Details */}
              <div className="mt-3 pt-2 border-t border-[#F2F4F6] flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setExpandedPaperId(isExpanded ? null : p.paper_id)}
                  className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#4E5968] hover:text-[#191F28] cursor-pointer"
                >
                  {isExpanded ? (
                    <>
                      <ChevronDown className="w-4 h-4 text-[#8B95A1]" /> 상세 근거 및 발췌문 접기
                    </>
                  ) : (
                    <>
                      <ChevronRight className="w-4 h-4 text-[#8B95A1]" /> 추출된 학술 근거 (
                      {val.evidence_items.length}건) 보기
                    </>
                  )}
                </button>

                {p.pdf_url && (
                  <a
                    href={p.pdf_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#059669] hover:underline"
                  >
                    <FileText className="w-3.5 h-3.5" /> 원문 PDF 열람
                  </a>
                )}
              </div>

              {/* Expanded Evidence Table & Quotes */}
              {isExpanded && (
                <div className="mt-3 p-3.5 bg-[#F9FAFB] rounded-[10px] space-y-3 text-[12px] border border-[#E5E8EB]">
                  {p.abstract && (
                    <div>
                      <span className="font-bold text-[#333D4B] block mb-1">초록 요약 (Abstract):</span>
                      <p className="text-[#4E5968] leading-relaxed italic bg-white p-2.5 rounded-[8px] border border-[#E5E8EB]">
                        "{p.abstract}"
                      </p>
                    </div>
                  )}

                  <div>
                    <span className="font-bold text-[#333D4B] block mb-1.5">
                      공인 추출 물성 데이터 (Verified Evidence):
                    </span>
                    {val.evidence_items.length === 0 ? (
                      <p className="text-[#8B95A1]">확인된 정량 Table/Figure 수치가 없습니다 (초록 정성 분석 참조).</p>
                    ) : (
                      <div className="space-y-2">
                        {val.evidence_items.map((evItem, evIdx) => {
                          const ev = evItem.evidence;
                          return (
                            <div
                              key={evIdx}
                              className="p-2.5 bg-white rounded-[8px] border border-[#E5E8EB] space-y-1"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-[#191F28]">{ev.property}</span>
                                {ev.value !== null ? (
                                  <span className="font-mono font-bold text-[#3182F6]">
                                    {ev.value} {ev.unit}
                                  </span>
                                ) : (
                                  <span className="text-[#8B95A1] text-[11px]">수치 미상 (텍스트 서술)</span>
                                )}
                              </div>
                              {ev.quoted_text && (
                                <p className="text-[#4E5968] text-[11px] leading-relaxed italic">
                                  "{ev.quoted_text}"
                                </p>
                              )}
                              <div className="text-[10px] text-[#8B95A1] flex items-center gap-2 pt-0.5">
                                <span>출처: {ev.source_table || ev.source_figure || `p.${ev.source_page || "원문"}`}</span>
                                <span>· 방식: {ev.extraction_method}</span>
                                <span className="text-[#059669]">· 검증상태: {ev.verification_status}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
};
