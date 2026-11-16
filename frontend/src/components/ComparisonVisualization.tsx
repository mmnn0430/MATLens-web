import React from "react";
import { ArrowUpDown, AlertCircle, CheckCircle2, ShieldAlert } from "lucide-react";
import type { ComparisonMetricItem } from "../types";
import { Card } from "./ui/primitives";

interface ComparisonVisualizationProps {
  comparisons: ComparisonMetricItem[];
}

export const ComparisonVisualization: React.FC<ComparisonVisualizationProps> = ({ comparisons }) => {
  if (!comparisons || comparisons.length === 0) {
    return null;
  }

  const comparableItems = comparisons.filter((c) => c.comparable && c.measured_value !== null && c.literature_value !== null);
  const nonComparableItems = comparisons.filter((c) => !c.comparable);

  return (
    <Card className="p-5 bg-white border border-[#E5E8EB] rounded-[16px] shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-[#E5E8EB] pb-3">
        <div className="flex items-center gap-2">
          <ArrowUpDown className="w-5 h-5 text-[#3182F6]" />
          <h4 className="text-[15px] font-bold text-[#191F28]">
            정량 실측치 vs 문헌값 편차 비교 (Quantitative Benchmark)
          </h4>
        </div>
        <span className="text-[11px] text-[#6B7684]">
          * 동일/보정 조건 하에서만 정량 대조가 허용됩니다.
        </span>
      </div>

      {/* Non-comparable alert banners */}
      {nonComparableItems.length > 0 && (
        <div className="space-y-2">
          {nonComparableItems.map((item, idx) => (
            <div
              key={idx}
              className="p-3 bg-[#FEF2F2] border border-[#FCA5A5] rounded-[10px] text-[12px] text-[#991B1B] flex items-start gap-2"
            >
              <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-[#DC2626]" />
              <div>
                <strong>[{item.property_name}] 직접 비교 제한: </strong>
                {item.reason_if_not_comparable || "필수 측정 조건 불일치로 인해 정량 대조가 금지되었습니다."}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Comparable Data Table & Visual Bars */}
      {comparableItems.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px] border-collapse">
            <thead>
              <tr className="border-b border-[#E5E8EB] text-[#6B7684] text-[11px] font-semibold bg-[#F9FAFB]">
                <th className="py-2.5 px-3">검증 물성 항목</th>
                <th className="py-2.5 px-3">사용자 실측값</th>
                <th className="py-2.5 px-3">학술 문헌 보고값</th>
                <th className="py-2.5 px-3">절대 편차</th>
                <th className="py-2.5 px-3">상대 편차 (%)</th>
                <th className="py-2.5 px-3">일치성 판정</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F2F4F6]">
              {comparableItems.map((item, idx) => {
                const relDev = item.relative_deviation_pct ?? 0;
                let statusBadge = (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#059669]">
                    <CheckCircle2 className="w-3.5 h-3.5" /> 우수 일치 (&lt; 2%)
                  </span>
                );
                if (relDev >= 10) {
                  statusBadge = (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#DC2626]">
                      <AlertCircle className="w-3.5 h-3.5" /> 유의미한 편차 (&gt; 10%)
                    </span>
                  );
                } else if (relDev >= 2) {
                  statusBadge = (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#D97706]">
                      <AlertCircle className="w-3.5 h-3.5" /> 양호 (2~10%)
                    </span>
                  );
                }

                return (
                  <tr key={idx} className="hover:bg-[#F9FAFB] transition-colors">
                    <td className="py-3 px-3 font-semibold text-[#191F28]">{item.property_name}</td>
                    <td className="py-3 px-3 font-mono font-bold text-[#3182F6]">
                      {item.measured_value} {item.unit}
                    </td>
                    <td className="py-3 px-3 font-mono text-[#4E5968]">
                      {item.literature_value} {item.unit}
                    </td>
                    <td className="py-3 px-3 font-mono text-[#4E5968]">
                      {item.absolute_deviation !== null ? `${item.absolute_deviation} ${item.unit}` : "-"}
                    </td>
                    <td className="py-3 px-3 font-mono font-bold">
                      <div className="flex items-center gap-2">
                        <span>{item.relative_deviation_pct !== null ? `${item.relative_deviation_pct}%` : "-"}</span>
                        {/* Progress bar visual indicator */}
                        {item.relative_deviation_pct !== null && (
                          <div className="w-16 h-2 bg-[#E5E8EB] rounded-full overflow-hidden">
                            <div
                              className={`h-full ${
                                relDev < 2
                                  ? "bg-[#059669]"
                                  : relDev < 10
                                  ? "bg-[#F59E0B]"
                                  : "bg-[#DC2626]"
                              }`}
                              style={{ width: `${Math.min(100, relDev * 5)}%` }}
                            />
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3">{statusBadge}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-[12px] text-[#8B95A1] py-2 text-center">
          직접 수치 비교가 허용된 항목이 없습니다 (조건 불일치 또는 정성 분석 단계).
        </div>
      )}
    </Card>
  );
};
