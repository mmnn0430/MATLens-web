import { DownloadLink } from "./DownloadLink";
import React, { useMemo, useState } from "react";
import { RefreshCw, Download, CheckCircle2, Eye, ChevronRight, Sparkles, MapPin } from "lucide-react";
import { api } from "../api";
import type { SEMParams } from "../types";
import { PlotlyChart } from "./PlotlyChart";
import { SemInteractiveCanvas } from "./SemInteractiveCanvas";
import {
  Button,
  Card,
  CollapsiblePanel,
  MetricCard,
  SourceTag,
  StatusBadge,
  SwitchControl,
} from "./ui/primitives";

interface SemViewProps {
  runId: string;
  semResult: any;
  xrdResult?: any;
  semParams: SEMParams;
  isBusy: boolean;
  onChangeParams: (next: SEMParams) => void;
  onRerun: () => void;
}

export function SemView({
  runId,
  semResult,
  xrdResult,
  semParams,
  isBusy,
  onChangeParams,
  onRerun,
}: SemViewProps) {
  const [showOverlay, setShowOverlay] = useState<boolean>(true);
  const [showGrainMarkers, setShowGrainMarkers] = useState<boolean>(true);
  const [selectedGrainId, setSelectedGrainId] = useState<string | null>(null);
  const [expandedObjId, setExpandedObjId] = useState<number | null>(null);
  const [isAiGrainRunning, setIsAiGrainRunning] = useState<boolean>(false);
  const [page, setPage] = useState<number>(0);

  if (!semResult) {
    return (
      <Card className="py-16 text-center space-y-2">
        <div className="text-[16px] font-bold text-[#191F28]">업로드된 SEM 이미지가 없습니다</div>
        <p className="text-[14px] text-[#6B7684]">
          상단 ‘시료·파일 설정’ 화면에서 SEM 이미지를 업로드하면 미세구조 분할 및 크기·형상 통계를 확인할 수 있습니다.
        </p>
      </Card>
    );
  }

  const isParticle = semResult.mode === "particle";
  const st = semResult.summary_stats;
  const gi = semResult.grain_intercept;
  const sc = semResult.scale || {};
  const unit = sc.display_unit || "px";
  const objects: any[] = semResult.objects || [];
  const pageSize = 25;
  const pagedObjects = objects.slice(page * pageSize, (page + 1) * pageSize);
  const pdbse = xrdResult?.phase_diagram_bse || null;

  const savedCond = semResult.conditions || {};
  const hasPendingEdits =
    semParams.scale_confirmed !== savedCond.scale_confirmed ||
    semParams.scale_real_value !== savedCond.scale_real_value ||
    semParams.scale_unit !== savedCond.scale_unit ||
    semParams.scale_length_px !== savedCond.scale_length_px ||
    semParams.segmentation_confirmed !== savedCond.segmentation_confirmed ||
    JSON.stringify(semParams.excluded_object_ids) !== JSON.stringify(savedCond.excluded_object_ids || []) ||
    JSON.stringify(semParams.added_intersections) !== JSON.stringify(savedCond.added_intersections || []) ||
    JSON.stringify(semParams.removed_intersection_ids) !== JSON.stringify(savedCond.removed_intersection_ids || []);

  // Build Histogram Plotly data
  const histData = useMemo(() => {
    const h = semResult.histogram;
    if (!h || !h.bin_edges || !h.counts) return null;
    const edges: number[] = h.bin_edges;
    const counts: number[] = h.counts;
    const centers = counts.map((_: number, i: number) => +((edges[i] + edges[i + 1]) / 2).toFixed(2));
    const widths = counts.map((_: number, i: number) => +((edges[i + 1] - edges[i]) * 0.88).toFixed(2));
    return { centers, widths, counts, unit: h.unit, n: h.sample_count_n };
  }, [semResult]);

  const imgSrc = showOverlay
    ? `${api.overlayUrl(runId)}?v=${runId}`
    : `${api.roiUrl(runId)}?v=${runId}`;

  return (
    <div className="space-y-6">
      {/* Top 4 Metric Cards */}
      {isParticle ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label="개수 기준 중앙 직경 (D50)"
            value={st ? st.d50 : null}
            unit={st ? `${st.unit} (N=${st.sample_count_n})` : undefined}
            subtext={
              st
                ? `D10 ${st.d10} · D90 ${st.d90} ${st.unit} (2D 투영 관찰)`
                : semResult.reason
            }
            status={semResult.status}
            sourceKind="계산값"
            tooltipTerm="개수 기준 D10 / D50 / D90"
            tooltipDesc="측정된 입자들을 작은 크기부터 나열했을 때 누적 개수의 10%, 50%(중앙값), 90%에 해당하는 등가원 직경입니다."
          />

          <MetricCard
            label="평균 직경 ± 표준편차"
            value={st ? `${st.mean_diameter} ± ${st.std_diameter}` : null}
            unit={st ? st.unit : undefined}
            subtext={
              st
                ? `표본 N=${st.sample_count_n}개 · 면적 가중 D50: ${st.area_weighted?.d50} ${st.unit}`
                : "유효 객체 없음"
            }
            status={sc.is_calibrated ? "분석 완료" : "확인 필요"}
            sourceKind="계산값"
            tooltipTerm="개수 기준 vs 면적 가중 분포"
            tooltipDesc="개수 기준 평균은 모든 입자에 동일한 가중치를 부여하고, 면적 가중 D50은 큰 입자가 차지하는 투영 면적 비중을 반영하므로 두 지표를 구분해 표시합니다."
          />

          <MetricCard
            label="원형도 · 종횡비 (중앙값)"
            value={st ? st.median_circularity : null}
            unit={st ? `종횡비 ${st.median_aspect_ratio}` : undefined}
            subtext={
              st
                ? `원형도 4πA/P² (평균 ${st.mean_circularity}) · N=${st.sample_count_n}`
                : "형상 계산 불가"
            }
            status={st ? "분석 완료" : "계산 불가"}
            sourceKind="계산값"
            tooltipTerm="원형도 (Circularity = 4πA / P²)"
            tooltipDesc="완전한 원일 때 1.0에 가깝고, 표면이 거칠거나 응집·신장된 형태일수록 0에 가까워집니다."
          />

          <MetricCard
            label="측정 표본 및 스케일 상태"
            value={semResult.n_valid_objects}
            unit={`개 (제외 ${semResult.n_excluded || 0}개)`}
            subtext={sc.reason}
            status={sc.is_calibrated && semResult.segmentation_confirmed ? "분석 완료" : "확인 필요"}
            sourceKind="사용자 입력"
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label="평균 선형교차 길이"
            value={gi?.mean_intercept_length ?? null}
            unit={gi?.mean_intercept_length ? gi.unit : undefined}
            subtext={gi ? "선형교차법 기반 추정 (비인증 연구 보조)" : semResult.reason}
            status={semResult.status}
            sourceKind="계산값"
            tooltipTerm="선형교차법 기반 추정"
            tooltipDesc="다방향 시험선의 총 길이를 결정립계 유효 교차 횟수로 나눈 평균 절편 길이입니다. 공식 표준 인증 성적서를 대체하지 않습니다."
          />
          <MetricCard
            label="유효 결정립계 교차 수"
            value={gi ? gi.effective_intersections : null}
            unit={gi ? "회" : undefined}
            subtext={
              gi
                ? `자동 ${gi.auto_intersections_count} · 수동추가 ${gi.manual_added_count} · 제외 ${gi.manual_removed_count}`
                : "경계 미확인"
            }
            status={gi && gi.effective_intersections >= 10 ? "분석 완료" : "확인 필요"}
            sourceKind="계산값"
          />
          <MetricCard
            label="총 시험선 길이"
            value={gi ? gi.total_line_length : null}
            unit={gi ? `${gi.unit} (${gi.n_test_lines}선)` : undefined}
            subtext="수평(0°) · 수직(90°) · 대각(±45°)"
            status={sc.is_calibrated ? "분석 완료" : "확인 필요"}
            sourceKind="계산값"
          />
          <MetricCard
            label="스케일 보정 상태"
            value={sc.is_calibrated ? `${sc.nm_per_px} nm/px` : "미확정 (px)"}
            subtext={sc.reason}
            status={sc.status}
            sourceKind="사용자 입력"
          />
        </div>
      )}

      {/* Quick Scale Recalibration & Segmentation Confirmation Bar */}
      <Card className="p-4 sm:p-5 bg-[#F8FAFC] border-[#BFDBFE] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[14px] font-bold text-[#191F28]">
                {isParticle ? "분리된 입자 경계와 스케일바 길이를 확인해주세요" : "결정립계 교차점과 스케일바 길이를 확인해주세요"}
              </span>
              {hasPendingEdits && (
                <span className="px-2 py-0.5 rounded-full bg-[#EFF6FF] text-[#3182F6] text-[11px] font-bold border border-[#BFDBFE]">
                  변경 사항 있음
                </span>
              )}
            </div>
            <p className="text-[12px] text-[#6B7684] mt-0.5">
              스케일 값·단위를 수정하거나 잘못 분리된 객체를 클릭해 제외한 뒤 ‘적용하여 재계산’을 누르면 실제 단위 통계가 새 실행으로 다시 계산됩니다.
            </p>
          </div>
          <Button type="button" variant="primary" size="md" disabled={isBusy} onClick={onRerun}>
            <RefreshCw className={`w-4 h-4 ${isBusy ? "animate-spin" : ""}`} />
            {isBusy ? "재계산 중..." : "적용하여 재계산"}
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end pt-2 border-t border-[#E5E8EB]">
          <div className="sm:col-span-2">
            <label className="block text-[12px] font-medium text-[#6B7684] mb-1">스케일바(px)</label>
            <input
              type="number"
              step="0.5"
              value={semParams.scale_length_px ?? ""}
              onChange={(e) =>
                onChangeParams({
                  ...semParams,
                  scale_length_px: e.target.value ? parseFloat(e.target.value) : null,
                })
              }
              className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] bg-white text-[13px] tabular-nums"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-[12px] font-medium text-[#6B7684] mb-1">실제 길이</label>
            <input
              type="number"
              step="any"
              value={semParams.scale_real_value ?? ""}
              placeholder="예: 500"
              onChange={(e) =>
                onChangeParams({
                  ...semParams,
                  scale_real_value: e.target.value ? parseFloat(e.target.value) : null,
                })
              }
              className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] bg-white text-[13px] tabular-nums"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-[12px] font-medium text-[#6B7684] mb-1">단위</label>
            <select
              value={semParams.scale_unit}
              onChange={(e) =>
                onChangeParams({
                  ...semParams,
                  scale_unit: e.target.value as "nm" | "µm" | "mm",
                })
              }
              className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] bg-white text-[13px]"
            >
              <option value="nm">nm</option>
              <option value="µm">µm</option>
              <option value="mm">mm</option>
            </select>
          </div>
          <div className="sm:col-span-3">
            <SwitchControl
              checked={semParams.scale_confirmed}
              onCheckedChange={(val) => onChangeParams({ ...semParams, scale_confirmed: val })}
              label="스케일 보정 확인"
            />
          </div>
          <div className="sm:col-span-3">
            {isParticle ? (
              <SwitchControl
                checked={semParams.segmentation_confirmed}
                onCheckedChange={(val) =>
                  onChangeParams({ ...semParams, segmentation_confirmed: val })
                }
                label="입자 분할 결과 확정"
              />
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={onRerun}
                disabled={isBusy}
              >
                <CheckCircle2 className="w-4 h-4" />
                교차점 재계산
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Main Content Grid: SEM Overlay Viewer + Histogram / Settings */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <Card className="xl:col-span-7 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[17px] font-bold text-[#191F28]">{semResult.mode_label}</h3>
                <SourceTag kind="계산값" />
              </div>
              <p className="text-[12px] text-[#6B7684] mt-0.5">{semResult.projection_notice}</p>
            </div>
            <div className="flex items-center gap-2">
              {semResult.grain_phase_map?.grains?.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant={showGrainMarkers ? "secondary" : "outline"}
                  onClick={() => setShowGrainMarkers((v) => !v)}
                  title="결정립별 추정 상(Phase) 마커 표시/숨김"
                >
                  <MapPin className="w-4 h-4 text-[#3182F6]" />
                  {showGrainMarkers ? "결정립 상 마커 ON" : "상 마커 OFF"}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant={showOverlay ? "secondary" : "outline"}
                onClick={() => setShowOverlay((v) => !v)}
              >
                <Eye className="w-4 h-4" />
                {showOverlay ? "분할 경계 표시 중" : "원본 ROI 보기"}
              </Button>
              <DownloadLink
                href={api.downloadOverlayUrl(runId)}
                className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#3182F6] hover:underline px-2.5 min-h-[44px]"
              >
                <Download className="w-4 h-4" />
                오버레이 저장
              </DownloadLink>
            </div>
          </div>

          <SemInteractiveCanvas
            imageUrl={imgSrc}
            mode={isParticle ? "result_particle" : "result_grain"}
            semParams={semParams}
            onChangeParams={onChangeParams}
            objects={objects}
            intersections={gi?.intersections || []}
            grains={semResult.grain_phase_map?.grains || []}
            selectedGrainId={selectedGrainId}
            onSelectGrain={(gid) => setSelectedGrainId((prev) => (prev === gid ? null : gid))}
            showGrainMarkers={showGrainMarkers}
          />
        </Card>

        <div className="xl:col-span-5 space-y-5">
          {/* Size Histogram Card */}
          {isParticle && (
            <Card className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-[16px] font-bold text-[#191F28]">
                    등가원 직경 분포 히스토그램
                  </h3>
                  <p className="text-[12px] text-[#6B7684]">
                    개수 기준 분포 · 표본 수 N = {histData?.n ?? 0} · 단위: {unit}
                  </p>
                </div>
                <SourceTag kind="계산값" />
              </div>

              {histData && st ? (
                <>
                  <PlotlyChart
                    height={270}
                    data={[
                      {
                        x: histData.centers,
                        y: histData.counts,
                        width: histData.widths,
                        type: "bar",
                        name: `입자 개수 (N=${histData.n})`,
                        marker: { color: "#3182F6" },
                      },
                    ]}
                    layout={{
                      margin: { l: 48, r: 16, t: 16, b: 44 },
                      xaxis: { title: { text: `등가원 직경 (${histData.unit})` }, gridcolor: "#F2F4F6" },
                      yaxis: { title: { text: "객체 수 (개)" }, gridcolor: "#F2F4F6" },
                      shapes: [
                        {
                          type: "line",
                          x0: st.d50,
                          x1: st.d50,
                          y0: 0,
                          y1: Math.max(...histData.counts),
                          line: { color: "#16A34A", width: 2, dash: "dash" },
                        },
                      ],
                    }}
                  />
                  <div className="text-[12px] text-[#4E5968] bg-[#F7F8FA] p-3 rounded-[12px] flex flex-wrap justify-between gap-2 tabular-nums">
                    <span>D10: <strong>{st.d10} {unit}</strong></span>
                    <span>D50(개수): <strong className="text-[#16A34A]">{st.d50} {unit}</strong></span>
                    <span>D90: <strong>{st.d90} {unit}</strong></span>
                    <span>D50(면적가중): <strong>{st.area_weighted?.d50} {unit}</strong></span>
                  </div>
                </>
              ) : (
                <div className="py-10 text-center text-[13px] text-[#6B7684] bg-[#F7F8FA] rounded-[14px]">
                  {semResult.reason || "표시할 입자 분포 데이터가 없습니다."}
                </div>
              )}
            </Card>
          )}

          {!isParticle && gi && (
            <Card className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[16px] font-bold text-[#191F28]">선형교차법 계수 기록</h3>
                <StatusBadge status={semResult.status} />
              </div>
              <div className="text-[13px] text-[#4E5968] space-y-2 leading-relaxed">
                <div>• <strong>표기 원칙:</strong> {gi.method_label}</div>
                <div>• <strong>계수 규칙:</strong> {gi.counting_rule}</div>
                <div>
                  • <strong>시험선 총 길이:</strong> {gi.total_line_length} {gi.unit} ({gi.total_line_length_px} px)
                </div>
                <div>
                  • <strong>유효 교차 수:</strong> {gi.effective_intersections}회 (경계 골격 밀도 {gi.boundary_skeleton_density})
                </div>
                {gi.quality_issues?.map((q: string, idx: number) => (
                  <div key={idx} className="text-[#D97706] font-medium">
                    • [품질 제한] {q}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Collapsible Advanced SEM Settings */}
          <CollapsiblePanel
            title="SEM 고급 분할 설정"
            subtitle="분석 모드(입자/결정립), 임계값, Watershed 민감도, 최소 크기"
          >
            <div className="space-y-3 pt-2">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={semParams.mode === "particle" ? "primary" : "outline"}
                  onClick={() => onChangeParams({ ...semParams, mode: "particle" })}
                >
                  A. 입자 분석
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={semParams.mode === "grain" ? "primary" : "outline"}
                  onClick={() => onChangeParams({ ...semParams, mode: "grain" })}
                >
                  B. 결정립 분석
                </Button>
              </div>

              {semParams.mode === "grain" && (
                <SwitchControl
                  checked={semParams.grain_boundary_confirmed}
                  onCheckedChange={(val) =>
                    onChangeParams({ ...semParams, grain_boundary_confirmed: val })
                  }
                  label="결정립계가 관찰되는 조직 이미지임을 확인"
                />
              )}

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[12px] font-medium text-[#6B7684] mb-1">
                    CLAHE 명암 대비
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={semParams.clahe_clip}
                    onChange={(e) =>
                      onChangeParams({
                        ...semParams,
                        clahe_clip: parseFloat(e.target.value) || 2.0,
                      })
                    }
                    className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] text-[13px] tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-[#6B7684] mb-1">
                    노이즈 제거 블러(px)
                  </label>
                  <input
                    type="number"
                    step="2"
                    min="0"
                    max="15"
                    value={semParams.gaussian_blur}
                    onChange={(e) =>
                      onChangeParams({
                        ...semParams,
                        gaussian_blur: Math.max(0, parseInt(e.target.value, 10) || 0),
                      })
                    }
                    className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] text-[13px] tabular-nums"
                  />
                </div>
              </div>

              {semParams.mode === "particle" ? (
                <>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[12px] font-medium text-[#6B7684] mb-1">
                        최소 객체 크기 (px²)
                      </label>
                      <input
                        type="number"
                        step="5"
                        value={semParams.min_size_px}
                        onChange={(e) =>
                          onChangeParams({
                            ...semParams,
                            min_size_px: Math.max(5, parseInt(e.target.value, 10) || 25),
                          })
                        }
                        className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] text-[13px] tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-[12px] font-medium text-[#6B7684] mb-1">
                        Watershed 분리 민감도 (0~1)
                      </label>
                      <input
                        type="number"
                        step="0.05"
                        min="0"
                        max="1"
                        value={semParams.split_sensitivity}
                        onChange={(e) =>
                          onChangeParams({
                            ...semParams,
                            split_sensitivity: Math.min(1, Math.max(0, parseFloat(e.target.value) || 0.55)),
                          })
                        }
                        className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] text-[13px] tabular-nums"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[12px] font-medium text-[#6B7684] mb-1">
                        이진화 방식
                      </label>
                      <select
                        value={semParams.threshold_mode}
                        onChange={(e) =>
                          onChangeParams({
                            ...semParams,
                            threshold_mode: e.target.value as "otsu" | "manual",
                          })
                        }
                        className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] text-[13px] bg-white"
                      >
                        <option value="otsu">자동 (Otsu)</option>
                        <option value="manual">수동 임계값</option>
                      </select>
                    </div>
                    {semParams.threshold_mode === "manual" && (
                      <div>
                        <label className="block text-[12px] font-medium text-[#6B7684] mb-1">
                          임계값 (1~254)
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="254"
                          value={semParams.manual_threshold}
                          onChange={(e) =>
                            onChangeParams({
                              ...semParams,
                              manual_threshold: parseInt(e.target.value, 10) || 128,
                            })
                          }
                          className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] text-[13px] tabular-nums"
                        />
                      </div>
                    )}
                  </div>

                  <SwitchControl
                    checked={semParams.invert_polarity}
                    onCheckedChange={(val) =>
                      onChangeParams({ ...semParams, invert_polarity: val })
                    }
                    label="명암 극성 반전 (밝은 배경 위 어두운 입자)"
                  />

                  <SwitchControl
                    checked={semParams.exclude_border}
                    onCheckedChange={(val) =>
                      onChangeParams({ ...semParams, exclude_border: val })
                    }
                    label="ROI 가장자리에 걸친 불완전 객체 제외"
                  />
                </>
              ) : (
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[12px] font-medium text-[#6B7684] mb-1">
                      적응형 블록 크기(px)
                    </label>
                    <input
                      type="number"
                      step="4"
                      value={semParams.grain_block_size}
                      onChange={(e) =>
                        onChangeParams({
                          ...semParams,
                          grain_block_size: Math.max(11, parseInt(e.target.value, 10) || 41),
                        })
                      }
                      className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] text-[13px] tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium text-[#6B7684] mb-1">
                      시험선 밀도
                    </label>
                    <input
                      type="number"
                      min="2"
                      max="16"
                      value={semParams.n_test_lines}
                      onChange={(e) =>
                        onChangeParams({
                          ...semParams,
                          n_test_lines: Math.max(2, parseInt(e.target.value, 10) || 6),
                        })
                      }
                      className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] text-[13px] tabular-nums"
                    />
                  </div>
                </div>
              )}

              <Button
                type="button"
                variant="primary"
                className="w-full"
                disabled={isBusy}
                onClick={onRerun}
              >
                <RefreshCw className="w-4 h-4" />
                설정 변경 적용하여 재분석
              </Button>
            </div>
          </CollapsiblePanel>
        </div>
      </div>

      {/* AI Grain-by-Grain Phase Identification Card */}
      {semResult.grain_phase_map?.enabled && (
        <Card className="space-y-4 border-[#BFDBFE] bg-gradient-to-br from-[#F8FAFC] via-white to-[#EFF6FF]/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <Sparkles className="w-5 h-5 text-[#3182F6]" />
                <h3 className="text-[17px] font-bold text-[#191F28]">
                  AI 결정립별 구성 물질·결정상(Phase) 분석
                </h3>
                <SourceTag kind="AI 해석" />
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0]">
                  SEM 명암 × XRD/MP 상평형 연동
                </span>
                {semResult.grain_phase_map.ai_model && (
                  <span className="text-[11px] text-[#6B7684]">
                    ({semResult.grain_phase_map.ai_model})
                  </span>
                )}
              </div>
              <p className="text-[12px] text-[#6B7684] mt-0.5">
                후방산란전자(BSE) 명암 대비(Z_BSE)와 XRD/Materials Project 상평형도(Tie-Line)를 결합하여 각 결정립(G1~G{semResult.grain_phase_map.grains?.length || 0})이 어떤 상 물질로 이루어져 있는지 AI로 판별합니다.
              </p>
            </div>

            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isAiGrainRunning || isBusy}
              onClick={async () => {
                setIsAiGrainRunning(true);
                try {
                  await fetch(`/api/runs/${runId}/grain-phase-ai`, { method: "POST" });
                  onRerun();
                } catch {
                  // ignore
                } finally {
                  setIsAiGrainRunning(false);
                }
              }}
            >
              <RefreshCw className={`w-4 h-4 ${isAiGrainRunning ? "animate-spin" : ""}`} />
              {isAiGrainRunning ? "AI 결정립 분석 중..." : "AI 결정립 해석 다시 실행"}
            </Button>
          </div>

          {/* AI Overall Summary Banner */}
          {semResult.grain_phase_map.ai_overall_summary && (
            <div className="p-4 rounded-[14px] bg-[#EFF6FF]/70 border border-[#BFDBFE] text-[13px] text-[#191F28] leading-relaxed">
              <div className="font-bold text-[#1D4ED8] mb-1 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4" />
                미세조직 내 결정립 상 분포 AI 종합 요약
              </div>
              <div>{semResult.grain_phase_map.ai_overall_summary}</div>
            </div>
          )}

          {/* 3 Zones Overview Cards (Matrix / Bright / Dark) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {(semResult.grain_phase_map.zones || []).map((z: any) => {
              const borderCol = z.zone === "matrix" ? "border-[#BFDBFE]" : z.zone === "bright" ? "border-[#FDE68A]" : "border-[#A7F3D0]";
              const bgCol = z.zone === "matrix" ? "bg-[#EFF6FF]/40" : z.zone === "bright" ? "bg-[#FFFBEB]/40" : "bg-[#ECFDF5]/40";
              const tagCol = z.zone === "matrix" ? "bg-[#3182F6] text-white" : z.zone === "bright" ? "bg-[#F59E0B] text-white" : "bg-[#10B981] text-white";
              return (
                <div key={z.zone} className={`p-3.5 rounded-[14px] border ${borderCol} ${bgCol} space-y-2`}>
                  <div className="flex items-center justify-between gap-1 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-[6px] text-[11px] font-bold ${tagCol}`}>
                      {z.zone.toUpperCase()}
                    </span>
                    <span className="text-[12px] font-semibold text-[#191F28] tabular-nums">
                      면적 분율 {z.area_pct}% (명암 {z.threshold_range})
                    </span>
                  </div>
                  <div>
                    <div className="text-[14px] font-bold text-[#191F28]">
                      {z.predicted_formula}
                      {z.z_bse_eff && <span className="text-[11px] text-[#6B7684] ml-1.5 font-normal">(Z_BSE={z.z_bse_eff})</span>}
                    </div>
                    <div className="text-[11px] text-[#6B7684]">{z.predicted_phase_name}</div>
                  </div>
                  <p className="text-[12px] text-[#4E5968] leading-relaxed pt-1 border-t border-black/5">
                    {z.reasoning}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Individual Grains Detailed Phase Table */}
          {semResult.grain_phase_map.grains?.length > 0 && (
            <div className="space-y-2.5 pt-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h4 className="text-[14px] font-bold text-[#191F28]">
                  개별 결정립(G1~G{semResult.grain_phase_map.grains.length})별 AI 상(Phase) 판별 결과
                </h4>
                <span className="text-[12px] text-[#6B7684]">
                  이미지 위 마커 또는 표의 행을 클릭하면 해당 결정립이 강조 표시됩니다
                </span>
              </div>

              <div className="bg-white rounded-[14px] border border-[#E5E8EB] overflow-x-auto">
                <table className="w-full text-left border-collapse text-[12px]">
                  <thead>
                    <tr className="border-b border-[#E5E8EB] text-[#6B7684] bg-[#F7F8FA]">
                      <th className="py-2.5 px-3 font-semibold w-16">결정립 ID</th>
                      <th className="py-2.5 px-2 font-semibold">추정 구성 물질(Phase)</th>
                      <th className="py-2.5 px-2 font-semibold">조직 내 역할</th>
                      <th className="py-2.5 px-2 font-semibold">등가 직경 / 면적</th>
                      <th className="py-2.5 px-2 font-semibold">평균 밝기 (대비)</th>
                      <th className="py-2.5 px-3 font-semibold">AI 상 판별 및 미세구조 설명</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E8EB] tabular-nums">
                    {semResult.grain_phase_map.grains.map((g: any) => {
                      const isSel = selectedGrainId === g.grain_id;
                      const col = g.color_hex || (g.zone === "matrix" ? "#3182F6" : g.zone === "bright" ? "#F59E0B" : "#10B981");
                      return (
                        <tr
                          key={g.grain_id}
                          onClick={() => setSelectedGrainId((prev) => (prev === g.grain_id ? null : g.grain_id))}
                          className={`cursor-pointer transition-colors ${
                            isSel ? "bg-[#EFF6FF] font-medium" : "hover:bg-[#F7F8FA]/70"
                          }`}
                        >
                          <td className="py-3 px-3">
                            <span
                              className="inline-flex items-center justify-center px-2 py-0.5 rounded-[6px] text-[11px] font-mono font-bold text-white"
                              style={{ backgroundColor: col }}
                            >
                              {g.grain_id}
                            </span>
                          </td>
                          <td className="py-3 px-2">
                            <div className="font-bold text-[#191F28] text-[13px]">
                              {g.predicted_formula}
                            </div>
                            <div className="text-[11px] text-[#6B7684]">
                              {g.predicted_phase_name}
                              {g.mp_id && <span className="ml-1 font-mono">({g.mp_id})</span>}
                            </div>
                          </td>
                          <td className="py-3 px-2">
                            <span className="text-[11px] font-semibold text-[#4E5968]">
                              {g.phase_role}
                            </span>
                          </td>
                          <td className="py-3 px-2 text-[#191F28]">
                            <div>{g.equiv_diameter} {g.unit}</div>
                            <div className="text-[11px] text-[#6B7684]">{g.area} {g.area_unit}</div>
                          </td>
                          <td className="py-3 px-2">
                            <div className="font-semibold text-[#191F28]">{g.mean_intensity}</div>
                            <div className={`text-[11px] ${g.contrast_delta_pct >= 0 ? "text-[#D97706]" : "text-[#16A34A]"}`}>
                              {g.contrast_delta_pct >= 0 ? `+${g.contrast_delta_pct}%` : `${g.contrast_delta_pct}%`}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-[12px] text-[#191F28] leading-relaxed max-w-md">
                            {g.ai_explanation}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* EDS Verification Guideline Tip */}
          {semResult.grain_phase_map.eds_verification_tip && (
            <div className="text-[12px] text-[#4E5968] bg-[#F7F8FA] p-3 rounded-[12px] border border-[#E5E8EB] leading-relaxed">
              <strong>💡 SEM-EDS 원소 정량 검증 권장사항:</strong> {semResult.grain_phase_map.eds_verification_tip}
            </div>
          )}
        </Card>
      )}

      {/* SEM-BSE (BED-C) Effective Atomic Number (Z_BSE) Contrast & Coexisting Phase Analysis */}
      {pdbse?.enabled && (pdbse.bse_table || []).length > 0 && (
        <Card className="space-y-4 border-[#BFDBFE] bg-gradient-to-br from-white to-[#F8FAFC]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-[17px] font-bold text-[#191F28]">
                  SEM 후방산란전자(BSE / BED-C) 명암 대비(Z_BSE) × 상평형 공존상 대조 분석 ({pdbse.chemsys})
                </h3>
                <SourceTag kind="계산값" />
              </div>
              <p className="text-[12px] text-[#6B7684] mt-0.5">
                후방산란전자(BSE/BED-C) 영상에서는 질량가중 유효 원자번호(Z_BSE = Σ w_i Z_i)가 큰 상일수록 밝게(Bright), 작은 상일수록 어둡게(Dark) 관찰됩니다.
              </p>
            </div>
            {pdbse.coexisting_equilibrium_neighbors?.length > 0 && (
              <div className="px-3 py-1.5 rounded-[12px] bg-[#EFF6FF] border border-[#BFDBFE] text-[12px] text-[#1D4ED8] font-semibold">
                주상({pdbse.primary_formula}) Tie-Line 평형 공존 후보상:{" "}
                <span className="font-bold">
                  {pdbse.coexisting_equilibrium_neighbors.join(", ")}
                </span>
              </div>
            )}
          </div>

          <div className="bg-white p-3.5 rounded-[14px] border border-[#E5E8EB] overflow-x-auto">
            <table className="w-full text-left border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-[#E5E8EB] text-[#6B7684]">
                  <th className="py-2 px-2 font-semibold">화학식 (MP ID)</th>
                  <th className="py-2 px-2 font-semibold">유효 원자번호 (Z_BSE)</th>
                  <th className="py-2 px-2 font-semibold">SEM-BSE (BED-C) 명암 예측 영역</th>
                  <th className="py-2 px-2 font-semibold">이론 밀도 ρ</th>
                  <th className="py-2 px-2 font-semibold">열역학 안정성 (E_hull)</th>
                  <th className="py-2 px-2 font-semibold">전자구조 (E_g)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E8EB] tabular-nums">
                {(pdbse.bse_table || []).map((row: any, i: number) => {
                  const isPrimary = row.formula === pdbse.primary_formula;
                  const isCoex = (pdbse.coexisting_equilibrium_neighbors || []).includes(
                    row.formula
                  );
                  return (
                    <tr
                      key={i}
                      className={
                        isPrimary ? "bg-[#EFF6FF]/70 font-medium" : "hover:bg-[#F7F8FA]/70"
                      }
                    >
                      <td className="py-2.5 px-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-[#191F28]">{row.formula}</span>
                          {row.mp_id && (
                            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#F2F4F6] text-[#4E5968]">
                              {row.mp_id}
                            </span>
                          )}
                          {isPrimary && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#3182F6] text-white font-bold">
                              1순위 주상
                            </span>
                          )}
                          {!isPrimary && isCoex && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0] font-semibold">
                              Tie-Line 공존
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-2 font-bold text-[#191F28] text-[13px]">
                        {row.z_bse_eff}
                      </td>
                      <td className="py-2.5 px-2">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-[6px] text-[11px] font-semibold ${
                            row.bse_zone?.startsWith("밝은")
                              ? "bg-[#FEF3C7] text-[#92400E]"
                              : row.bse_zone?.startsWith("어두운")
                              ? "bg-[#E5E7EB] text-[#1F2937]"
                              : "bg-[#EFF6FF] text-[#1E40AF]"
                          }`}
                        >
                          {row.bse_zone}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-[#191F28]">
                        {row.density_g_cm3 ? `${row.density_g_cm3} g/cm³` : "-"}
                      </td>
                      <td className="py-2.5 px-2 text-[#4E5968]">
                        {row.e_hull_ev !== null && row.e_hull_ev !== undefined
                          ? `${row.e_hull_ev.toFixed(3)} eV/atom`
                          : "-"}
                      </td>
                      <td className="py-2.5 px-2 text-[#4E5968]">
                        {row.electronic_label || "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Bottom Detailed Object Table (Particle Mode) */}
      {isParticle && objects.length > 0 && (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-[16px] font-bold text-[#191F28]">
                객체별 측정 상세 표 (전체 {objects.length}개 중 유효 {semResult.n_valid_objects}개)
              </h3>
              <p className="text-[12px] text-[#6B7684]">
                면적, 등가원 직경, 장축·단축, 종횡비, 원형도(4πA/P²) 측정값 (단위: {unit}, {sc.area_unit})
              </p>
            </div>
            <DownloadLink
              href={api.downloadSemCsvUrl(runId)}
              className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#3182F6] hover:underline min-h-[44px] px-3"
            >
              <Download className="w-4 h-4" />
              객체별 측정값 CSV 다운로드
            </DownloadLink>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-[#E5E8EB] text-[#6B7684]">
                  <th className="py-3 px-2 font-semibold">#ID</th>
                  <th className="py-3 px-2 font-semibold">등가원 직경 ({unit})</th>
                  <th className="py-3 px-2 font-semibold hidden sm:table-cell">면적 ({sc.area_unit})</th>
                  <th className="py-3 px-2 font-semibold hidden md:table-cell">장축 / 단축 ({unit})</th>
                  <th className="py-3 px-2 font-semibold">종횡비</th>
                  <th className="py-3 px-2 font-semibold">원형도</th>
                  <th className="py-3 px-2 font-semibold text-right">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E8EB] tabular-nums">
                {pagedObjects.map((o) => {
                  const isExcl = semParams.excluded_object_ids.includes(o.object_id);
                  const isExp = expandedObjId === o.object_id;
                  return (
                    <React.Fragment key={o.object_id}>
                      <tr className={isExcl ? "bg-[#F7F8FA] opacity-60" : "hover:bg-[#F7F8FA]/60"}>
                        <td className="py-2.5 px-2 font-semibold">#{o.object_id}</td>
                        <td className="py-2.5 px-2 font-semibold text-[#191F28]">{o.equiv_diameter}</td>
                        <td className="py-2.5 px-2 hidden sm:table-cell">{o.area}</td>
                        <td className="py-2.5 px-2 hidden md:table-cell">
                          {o.major_axis} / {o.minor_axis}
                        </td>
                        <td className="py-2.5 px-2">{o.aspect_ratio}</td>
                        <td className="py-2.5 px-2">{o.circularity}</td>
                        <td className="py-2 px-2 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => {
                              const cur = new Set(semParams.excluded_object_ids);
                              if (cur.has(o.object_id)) cur.delete(o.object_id);
                              else cur.add(o.object_id);
                              onChangeParams({ ...semParams, excluded_object_ids: Array.from(cur) });
                            }}
                            className="text-[12px] font-semibold text-[#3182F6] hover:underline px-2 py-2 min-h-[44px] cursor-pointer"
                          >
                            {isExcl ? "복원" : "제외"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setExpandedObjId(isExp ? null : o.object_id)}
                            className="md:hidden text-[12px] text-[#6B7684] px-1.5 py-2 min-h-[44px] cursor-pointer"
                          >
                            <ChevronRight
                              className={`w-4 h-4 inline transition-transform ${isExp ? "rotate-90" : ""}`}
                            />
                          </button>
                        </td>
                      </tr>
                      {isExp && (
                        <tr className="bg-[#F7F8FA] text-[12px] text-[#4E5968]">
                          <td colSpan={7} className="p-3">
                            면적: {o.area} {sc.area_unit} · 장축: {o.major_axis} {unit} · 단축: {o.minor_axis} {unit} · 중심좌표: ({o.centroid_x}, {o.centroid_y}) px
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {objects.length > pageSize && (
            <div className="flex items-center justify-between pt-2 text-[13px] text-[#6B7684]">
              <span>
                {page * pageSize + 1}–{Math.min((page + 1) * pageSize, objects.length)} / {objects.length}개
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  이전
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={(page + 1) * pageSize >= objects.length}
                  onClick={() => setPage((p) => p + 1)}
                >
                  다음
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
