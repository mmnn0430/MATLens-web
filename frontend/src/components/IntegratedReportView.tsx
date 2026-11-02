import { DownloadLink } from "./DownloadLink";
import { useEffect, useState } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import {
  FileText,
  Sparkles,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  History,
  FileSpreadsheet,
  FileJson,
  Image as ImageIcon,
  KeyRound,
} from "lucide-react";
import { api } from "../api";
import type { GeminiModelOption, ProjectDetail, RunDetail } from "../types";
import {
  Button,
  Card,
  CollapsiblePanel,
  MetricCard,
  SourceTag,
} from "./ui/primitives";

interface IntegratedReportViewProps {
  project: ProjectDetail;
  run: RunDetail;
  isRetryingAi: boolean;
  onRetryAi: (selectedModel?: string) => void;
  onSelectRun: (runId: string) => void;
}

function EvidenceChip({
  id,
  registry,
}: {
  id: string;
  registry: Record<string, any>;
}) {
  const entry = registry?.[id];
  if (!entry) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-[6px] text-[11px] font-mono bg-[#F2F4F6] text-[#6B7684]">
        {id}
      </span>
    );
  }
  return (
    <TooltipPrimitive.Provider delayDuration={120}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          <span className="inline-flex items-center px-2 py-0.5 rounded-[6px] text-[11px] font-mono font-medium bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE] cursor-help">
            {id}
          </span>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            sideOffset={5}
            className="z-50 max-w-[320px] rounded-[12px] bg-[#191F28] p-3 text-[11px] text-white shadow-xl space-y-1"
          >
            <div className="font-semibold text-[#90B8F8]">
              [{entry.source_type}] {entry.label}
            </div>
            <pre className="whitespace-pre-wrap break-words font-mono text-[10px] text-[#E5E8EB]">
              {JSON.stringify(entry.value, null, 2)}
            </pre>
            <TooltipPrimitive.Arrow className="fill-[#191F28]" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

export function IntegratedReportView({
  project,
  run,
  isRetryingAi,
  onRetryAi,
  onSelectRun,
}: IntegratedReportViewProps) {
  const rule = run.rule_summary || {};
  const registry = rule.evidence_registry || {};
  const xrd = run.xrd_result;
  const sem = run.sem_result;

  const isOutdatedAi = run.is_ai_outdated;
  const activeAi =
    run.ai_report && run.ai_report.status === "completed"
      ? run.ai_report
      : run.previous_outdated_ai_report || run.ai_report;

  const topPhase = xrd?.phase_matching?.candidates?.[0];
  const schMean = xrd?.scherrer?.mean_nm;
  const semStats = sem?.summary_stats;
  const grainInt = sem?.grain_intercept;

  const [selectedModel, setSelectedModel] = useState<string>("auto");
  const [modelOptions, setModelOptions] = useState<GeminiModelOption[]>([
    { id: "auto", label: "자동 선택 (가용 Gemini 버전 자동 탐색·폴백)" },
    { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash (빠르고 정확한 표준 멀티모달 · 권장)" },
    { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (초고속 1~2초 응답)" },
    { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite (경량 고속 멀티모달)" },
    { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash (최신 심층 추론 멀티모달)" },
    { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash (고정밀 멀티모달)" },
    { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash (균형형 멀티모달)" },
    { id: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview" },
    { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview (고정밀 심층 추론)" },
    { id: "gemini-flash-latest", label: "Gemini Flash Latest (최신 Flash 별칭)" },
    { id: "gemini-flash-lite-latest", label: "Gemini Flash-Lite Latest (최신 Lite 별칭)" },
    { id: "gemini-pro-latest", label: "Gemini Pro Latest (최신 Pro 별칭)" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash (구버전 호환 · 미지원 시 3.5 자동 전환)" },
  ]);
  const [apiConfigured, setApiConfigured] = useState<boolean>(false);
  const [showKeyForm, setShowKeyForm] = useState<boolean>(false);
  const [geminiKeyInput, setGeminiKeyInput] = useState<string>("");
  const [mpKeyInput, setMpKeyInput] = useState<string>("");
  const [savingKey, setSavingKey] = useState<boolean>(false);
  const [autoRetriedRunId, setAutoRetriedRunId] = useState<string | null>(null);

  useEffect(() => {
    api
      .getAiConfig()
      .then((cfg) => {
        setApiConfigured(cfg.gemini_api_configured);
        if (cfg.gemini_model) setSelectedModel(cfg.gemini_model);
        if (cfg.gemini_models && cfg.gemini_models.length > 0) {
          setModelOptions(cfg.gemini_models);
        }
        const errMsg = run.ai_report?.error_message || "";
        const failedDueToMissingKey =
          run.ai_report?.status === "failed" &&
          (errMsg.includes("GEMINI_API_KEY") || errMsg.includes("키가 아직 설정되지"));
        if (
          cfg.gemini_api_configured &&
          failedDueToMissingKey &&
          !isRetryingAi &&
          autoRetriedRunId !== run.id
        ) {
          setAutoRetriedRunId(run.id);
          onRetryAi(cfg.gemini_model || "auto");
        }
      })
      .catch(() => {});
  }, [run.id, activeAi?.status]);

  const handleSaveKeyAndRun = async (runImmediately: boolean) => {
    setSavingKey(true);
    try {
      const cfg = await api.saveAiConfig({
        gemini_api_key: geminiKeyInput.trim() || undefined,
        gemini_model: selectedModel,
        mp_api_key: mpKeyInput.trim() || undefined,
      });
      setApiConfigured(cfg.gemini_api_configured);
      if (cfg.gemini_models && cfg.gemini_models.length > 0) {
        setModelOptions(cfg.gemini_models);
      }
      setGeminiKeyInput("");
      setMpKeyInput("");
      setShowKeyForm(false);
      if (runImmediately) {
        onRetryAi(selectedModel);
      }
    } finally {
      setSavingKey(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top 4 Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="통합 교차 해석 상태"
          value={rule.cross_status || "단일 분석"}
          subtext={
            rule.cross_restriction_reason ||
            "동일 시료 XRD·SEM 데이터를 함께 비교할 수 있습니다."
          }
          status={rule.can_integrate ? "분석 완료" : "확인 필요"}
          sourceKind="사용자 입력"
        />

        <MetricCard
          label="XRD 대표 결과"
          value={topPhase ? topPhase.formula : xrd ? "후보 없음" : "미업로드"}
          unit={schMean ? `· ${schMean} nm` : topPhase?.mp_id ? `(${topPhase.mp_id})` : undefined}
          subtext={
            topPhase
              ? `${topPhase.name} (${topPhase.mp_id || topPhase.phase_id}, 점수 ${topPhase.score}/100, ${topPhase.stability_badge || ""})`
              : xrd?.reason || "XRD 파일 없음"
          }
          status={xrd ? xrd.status : "확인 필요"}
          sourceKind="계산값"
        />

        <MetricCard
          label="SEM 대표 결과"
          value={
            semStats
              ? semStats.d50
              : grainInt?.mean_intercept_length
              ? grainInt.mean_intercept_length
              : sem
              ? null
              : "미업로드"
          }
          unit={
            semStats
              ? `${semStats.unit} (D50, N=${semStats.sample_count_n})`
              : grainInt?.mean_intercept_length
              ? `${grainInt.unit} (선형교차)`
              : undefined
          }
          subtext={
            semStats
              ? `원형도 ${semStats.median_circularity} · 2D 이미지 관찰`
              : sem?.reason || "SEM 파일 없음"
          }
          status={sem ? sem.status : "확인 필요"}
          sourceKind="계산값"
        />

        <MetricCard
          label="AI 해석 상태"
          value={
            activeAi?.status === "completed"
              ? isOutdatedAi
                ? "이전 실행 결과"
                : "생성 완료"
              : activeAi?.status === "failed"
              ? "생성 실패"
              : "꺼짐 (규칙 요약)"
          }
          subtext={
            activeAi?.model_name
              ? `모델: ${activeAi.model_name}`
              : "API 키 없이도 규칙 기반 요약과 다운로드가 동작합니다."
          }
          status={
            activeAi?.status === "completed" && !isOutdatedAi
              ? "분석 완료"
              : activeAi?.status === "failed"
              ? "오류"
              : "확인 필요"
          }
          sourceKind="AI 해석"
        />
      </div>

      {/* Downloads Bar: "리포트 다운로드" */}
      <Card className="p-5 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 bg-white">
        <div>
          <div className="text-[16px] font-bold text-[#191F28]">리포트 및 정량 데이터 다운로드</div>
          <p className="text-[13px] text-[#6B7684] mt-0.5">
            한국어 글꼴과 차트가 포함된 PDF 리포트, 피크/객체 CSV, 전체 재현성 JSON을 내려받을 수 있습니다 (Run #{run.run_number}).
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <DownloadLink href={api.downloadPdfUrl(run.id)}>
            <Button type="button" variant="primary" size="md">
              <FileText className="w-4 h-4" />
              리포트 다운로드 (PDF)
            </Button>
          </DownloadLink>
          {xrd && (
            <DownloadLink
              href={api.downloadXrdChartPngUrl(run.id, topPhase?.phase_id)}
              download={`matlens_${run.id}_xrd_chart.png`}
              title="상 후보, 각 피크 위치(2θ, hkl) 및 Bragg 기준선이 포함된 고해상도(300 DPI) XRD 분석 차트 이미지 다운로드"
            >
              <Button type="button" variant="outline" size="md" className="border-[#BFDBFE] text-[#1D4ED8] bg-[#EFF6FF] hover:bg-[#DBEAFE]">
                <ImageIcon className="w-4 h-4 text-[#2563EB]" />
                XRD 분석 차트 이미지 (PNG)
              </Button>
            </DownloadLink>
          )}
          {xrd && (
            <DownloadLink href={api.downloadXrdCsvUrl(run.id)}>
              <Button type="button" variant="outline" size="md">
                <FileSpreadsheet className="w-4 h-4" />
                XRD 피크 CSV
              </Button>
            </DownloadLink>
          )}
          {sem && (
            <DownloadLink href={api.downloadSemCsvUrl(run.id)}>
              <Button type="button" variant="outline" size="md">
                <FileSpreadsheet className="w-4 h-4" />
                SEM 측정 CSV
              </Button>
            </DownloadLink>
          )}
          {run.has_overlay && (
            <DownloadLink href={api.downloadOverlayUrl(run.id)}>
              <Button type="button" variant="outline" size="md">
                <ImageIcon className="w-4 h-4" />
                오버레이 PNG
              </Button>
            </DownloadLink>
          )}
          <DownloadLink href={api.downloadJsonUrl(run.id)}>
            <Button type="button" variant="outline" size="md">
              <FileJson className="w-4 h-4" />
              전체 결과 JSON
            </Button>
          </DownloadLink>
        </div>
      </Card>

      {/* Checks Needed Banner: "이 결과는 추가 확인이 필요해요" */}
      {rule.checks_needed?.length > 0 && (
        <Card className="border-[#FDE68A] bg-[#FFFBEB] space-y-2">
          <div className="flex items-center gap-2 text-[#B45309] font-bold text-[15px]">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <span>이 결과는 추가 확인이 필요해요</span>
          </div>
          <ul className="space-y-1.5 text-[13px] text-[#92400E] pl-1">
            {rule.checks_needed.map((chk: string, idx: number) => (
              <li key={idx}>• {chk}</li>
            ))}
          </ul>
        </Card>
      )}

      {/* Deterministic Rule-Based Summary Card */}
      <Card className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-[18px] font-bold text-[#191F28]">규칙 기반 정량 요약</h3>
            <SourceTag kind="규칙 요약" />
            <SourceTag kind="계산값" />
          </div>
          <span className="text-[12px] text-[#6B7684]">
            외부 AI 연결 없이 분석 엔진 수치만으로 작성된 확정 요약
          </span>
        </div>

        <p className="text-[14px] text-[#191F28] leading-relaxed bg-[#F7F8FA] p-4 rounded-[14px]">
          {rule.overview}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="text-[14px] font-bold text-[#191F28]">XRD 관찰 요약</h4>
              {xrd && (
                <DownloadLink
                  href={api.downloadXrdChartPngUrl(run.id, topPhase?.phase_id)}
                  download={`matlens_${run.id}_xrd_chart.png`}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#1D4ED8] hover:text-[#1E40AF] hover:underline"
                  title="상후보·피크위치·Bragg선이 포함된 XRD 분석 고해상도 이미지 다운로드"
                >
                  <ImageIcon className="w-3.5 h-3.5 text-[#2563EB]" />
                  XRD 차트 이미지 받기
                </DownloadLink>
              )}
            </div>
            {rule.xrd_facts?.length ? (
              rule.xrd_facts.map((f: any, idx: number) => (
                <div key={idx} className="p-3.5 rounded-[14px] border border-[#E5E8EB] space-y-2 text-[13px] leading-relaxed">
                  <div>{f.text}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {f.evidence_ids?.map((eid: string) => (
                      <EvidenceChip key={eid} id={eid} registry={registry} />
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-[13px] text-[#6B7684]">XRD 관찰 항목이 없습니다.</div>
            )}
          </div>

          <div className="space-y-2.5">
            <h4 className="text-[14px] font-bold text-[#191F28]">SEM 미세구조 관찰 요약</h4>
            {rule.sem_facts?.length ? (
              rule.sem_facts.map((f: any, idx: number) => (
                <div key={idx} className="p-3.5 rounded-[14px] border border-[#E5E8EB] space-y-2 text-[13px] leading-relaxed">
                  <div>{f.text}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {f.evidence_ids?.map((eid: string) => (
                      <EvidenceChip key={eid} id={eid} registry={registry} />
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-[13px] text-[#6B7684]">SEM 관찰 항목이 없습니다.</div>
            )}
          </div>
        </div>

        {rule.cross_notes?.length > 0 && (
          <div className="space-y-2 pt-3 border-t border-[#E5E8EB]">
            <h4 className="text-[14px] font-bold text-[#191F28]">XRD × SEM 관계 검토</h4>
            {rule.cross_notes.map((cn: any, idx: number) => (
              <div key={idx} className="p-3.5 rounded-[14px] bg-[#EFF6FF]/50 border border-[#BFDBFE] space-y-2 text-[13px] leading-relaxed">
                <div>{cn.text}</div>
                <div className="flex flex-wrap gap-1.5">
                  {cn.evidence_ids?.map((eid: string) => (
                    <EvidenceChip key={eid} id={eid} registry={registry} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Materials Project Physical Properties & Phase Diagram Coexistence Summary */}
        {topPhase && (topPhase.mp_id || xrd?.phase_diagram_bse?.enabled) && (
          <div className="pt-3 border-t border-[#E5E8EB] space-y-2.5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h4 className="text-[14px] font-bold text-[#191F28]">
                Materials Project 열역학 · 기초 물성 및 SEM-BSE 교차 요약
              </h4>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0]">
                {topPhase.mp_id ? `주상 MP ID: ${topPhase.mp_id}` : "Materials Project 연동"}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px]">
              <div className="p-3 rounded-[12px] bg-[#F7F8FA] border border-[#E5E8EB]">
                <div className="text-[#6B7684]">열역학적 안정성 (E_hull)</div>
                <div className="font-bold text-[#191F28] mt-0.5">
                  {topPhase.e_hull_ev !== null && topPhase.e_hull_ev !== undefined
                    ? `${topPhase.e_hull_ev.toFixed(3)} eV/atom`
                    : "미상"}
                </div>
                <div className="text-[11px] text-[#047857]">{topPhase.stability_badge || ""}</div>
              </div>
              <div className="p-3 rounded-[12px] bg-[#F7F8FA] border border-[#E5E8EB]">
                <div className="text-[#6B7684]">이론 결정 밀도 (ρ_theo)</div>
                <div className="font-bold text-[#191F28] mt-0.5">
                  {topPhase.density_g_cm3 ? `${topPhase.density_g_cm3} g/cm³` : "-"}
                </div>
                <div className="text-[11px] text-[#6B7684]">공간군 {topPhase.spacegroup}</div>
              </div>
              <div className="p-3 rounded-[12px] bg-[#F7F8FA] border border-[#E5E8EB]">
                <div className="text-[#6B7684]">전자구조 / 밴드갭 (E_g)</div>
                <div className="font-bold text-[#191F28] mt-0.5">
                  {topPhase.electronic_label || "-"}
                </div>
                <div className="text-[11px] text-[#6B7684]">
                  ΔH_f = {topPhase.formation_energy_ev ?? "-"} eV/atom
                </div>
              </div>
              <div className="p-3 rounded-[12px] bg-[#F7F8FA] border border-[#E5E8EB]">
                <div className="text-[#6B7684]">Tie-Line 평형 공존 후보상</div>
                <div className="font-bold text-[#1D4ED8] mt-0.5">
                  {xrd?.phase_diagram_bse?.coexisting_equilibrium_neighbors?.length
                    ? xrd.phase_diagram_bse.coexisting_equilibrium_neighbors.join(", ")
                    : "단일 안정상"}
                </div>
                <div className="text-[11px] text-[#6B7684]">
                  주상 Z_BSE = {topPhase.z_bse_eff ?? "-"}
                </div>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Gemini AI Integrated Interpretation Card */}
      <Card className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Sparkles className="w-5 h-5 text-[#3182F6]" />
            <h3 className="text-[18px] font-bold text-[#191F28]">Gemini AI 통합 해석 및 가설</h3>
            <SourceTag kind="AI 해석" />
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${
                apiConfigured
                  ? "bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]"
                  : "bg-[#FEF3C7] text-[#B45309] border-[#FDE68A]"
              }`}
            >
              {apiConfigured ? "API 키 연결됨" : "API 키 미설정"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedModel}
              onChange={(e) => {
                const nextM = e.target.value;
                setSelectedModel(nextM);
                api.saveAiConfig({ gemini_model: nextM }).catch(() => {});
              }}
              aria-label="Gemini 모델 버전 선택"
              className="min-h-[38px] px-3 rounded-[10px] border border-[#E5E8EB] bg-white text-[12px] font-semibold text-[#191F28] focus:outline-none focus:border-[#3182F6]"
            >
              {modelOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowKeyForm((v) => !v)}
            >
              <KeyRound className="w-4 h-4" />
              API 키 설정
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={isRetryingAi}
              onClick={() => onRetryAi(selectedModel)}
            >
              <RefreshCw className={`w-4 h-4 ${isRetryingAi ? "animate-spin" : ""}`} />
              {isRetryingAi
                ? "AI 해석 생성 중..."
                : activeAi?.status === "completed" && !isOutdatedAi
                ? "선택 모델로 다시 생성"
                : "현재 실행 기준으로 AI 해석 생성"}
            </Button>
          </div>
        </div>

        {/* Inline API Key & Model Setup Panel (No .env file editing needed!) */}
        {(showKeyForm || !apiConfigured) && (
          <div className="rounded-[14px] bg-[#F8FAFC] border border-[#BFDBFE] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[13px] font-bold text-[#191F28]">
                Gemini API 키 및 모델 버전 직접 설정 (.env 편집 불필요)
              </div>
              <span className="text-[11px] text-[#6B7684]">
                입력된 키는 서버 내부에만 안전하게 적용되며 외부/클라이언트로 노출되지 않습니다.
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-5">
                <label className="block text-[12px] font-medium text-[#6B7684] mb-1">
                  Google Gemini API 키 (AIza...)
                </label>
                <input
                  type="password"
                  value={geminiKeyInput}
                  onChange={(e) => setGeminiKeyInput(e.target.value)}
                  placeholder={
                    apiConfigured
                      ? "새 Gemini API 키로 변경하려면 입력 (유지 시 비워두세요)"
                      : "여기에 Gemini API 키(AIza...)를 붙여넣으세요"
                  }
                  className="w-full min-h-[42px] px-3 rounded-[10px] border border-[#E5E8EB] bg-white text-[13px] font-mono"
                />
              </div>
              <div className="md:col-span-4">
                <label className="block text-[12px] font-medium text-[#6B7684] mb-1">
                  Materials Project API 키 (선택)
                </label>
                <input
                  type="password"
                  value={mpKeyInput}
                  onChange={(e) => setMpKeyInput(e.target.value)}
                  placeholder="선택 입력 (미입력 시 내장 MP DB 사용)"
                  className="w-full min-h-[42px] px-3 rounded-[10px] border border-[#E5E8EB] bg-white text-[13px] font-mono"
                />
              </div>
              <div className="md:col-span-3 flex gap-2">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  className="w-full"
                  disabled={savingKey || isRetryingAi}
                  onClick={() => handleSaveKeyAndRun(true)}
                >
                  {savingKey ? "저장 중..." : "저장 및 AI 생성"}
                </Button>
              </div>
            </div>
            <div className="text-[11px] text-[#6B7684]">
              • <strong>자동 버전 전환(Fallback):</strong> 선택한 버전(예: <code>gemini-2.5-flash</code>)이 할당량 초과이거나 신규 계정에서 비활성화된 경우,{" "}
              <code>gemini-3.5-flash → gemini-3.5-flash-lite → gemini-3.1-flash-lite → gemini-3.8-flash → gemini-flash-latest</code> 순서로 사용 가능한 버전을 자동으로 찾아 실행합니다.
            </div>
          </div>
        )}

        {/* Outdated AI Report Warning */}
        {isOutdatedAi && (
          <div className="rounded-[14px] bg-[#FEF3C7] border border-[#FDE68A] p-4 flex flex-wrap items-center justify-between gap-3 text-[#92400E]">
            <div className="text-[13px] font-medium">
              <strong>오래된 AI 리포트 알림:</strong> 아래 AI 해석은 분석 조건 변경 전 실행(Run ID:{" "}
              <code>{activeAi?.run_id}</code>)의 결과를 참조하고 있습니다. 현재 실행(Run #{run.run_number}) 수치로 업데이트하려면 우측 상단 버튼을 눌러주세요.
            </div>
          </div>
        )}

        {/* AI Failed / Missing Key State: "AI 해석을 생성하지 못했어요" */}
        {(!activeAi || activeAi.status === "failed" || activeAi.status === "disabled") && (
          <div className="rounded-[16px] bg-[#F7F8FA] border border-[#E5E8EB] p-6 text-center space-y-3">
            <div className="text-[16px] font-bold text-[#191F28]">
              {activeAi?.status === "disabled"
                ? "AI 해석을 끈 상태로 실행했습니다"
                : "AI 해석을 생성하지 못했어요"}
            </div>
            <p className="text-[13px] text-[#6B7684] max-w-xl mx-auto leading-relaxed">
              {activeAi?.error_message ||
                "서버 환경변수(GEMINI_API_KEY) 확인 후 재시도 버튼을 누르면 현재 수치 분석 결과를 그대로 참조해 통합 해석을 작성합니다. 위쪽의 규칙 기반 리포트와 수치 계산 결과는 정상 이용 가능합니다."}
            </p>
            <div>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={isRetryingAi}
                  onClick={() => onRetryAi(selectedModel)}
                >
                  <RefreshCw className={`w-4 h-4 ${isRetryingAi ? "animate-spin" : ""}`} />
                  재시도
                </Button>
            </div>
          </div>
        )}

        {/* Structured AI Output Sections */}
        {activeAi?.status === "completed" && activeAi.report && (
          <div className="space-y-5">
            {/* Audit Meta */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[#6B7684] bg-[#F7F8FA] px-4 py-2.5 rounded-[12px]">
              <div className="flex items-center gap-2 flex-wrap">
                <CheckCircle2 className="w-4 h-4 text-[#16A34A]" />
                <span>JSON 스키마 검증 완료</span>
                <span>·</span>
                <span>
                  근거 ID 인용 {activeAi.reference_check?.cited_evidence_count ?? 0}건
                </span>
              </div>
              <div>
                모델: <strong>{activeAi.model_name}</strong> · 프롬프트: {activeAi.prompt_version} ·{" "}
                {new Date(activeAi.created_at).toLocaleString("ko-KR")}
              </div>
            </div>

            {activeAi.reference_check?.warnings?.length > 0 && (
              <div className="rounded-[12px] bg-[#FEF3C7]/70 p-3 text-[12px] text-[#92400E] space-y-1">
                {activeAi.reference_check.warnings.map((w: string, i: number) => (
                  <div key={i}>• [검증 알림] {w}</div>
                ))}
              </div>
            )}

            {/* 1. 한눈에 보는 요약 */}
            <div className="space-y-1.5">
              <h4 className="text-[15px] font-bold text-[#191F28]">한눈에 보는 요약</h4>
              <p className="text-[14px] text-[#191F28] leading-relaxed bg-[#FFFBEB]/60 border border-[#FDE68A] p-4 rounded-[14px]">
                {activeAi.report.executive_summary}
              </p>
            </div>

            {/* 사용자 공정/시료 설명 반영 알림 바 */}
            {project.description && (
              <div className="rounded-[12px] bg-[#EFF6FF] border border-[#BFDBFE] p-3 text-[13px] text-[#1E40AF] flex flex-wrap items-center justify-between gap-2">
                <div>
                  <strong>🔬 입력된 공정 및 시료 이력 반영:</strong> “{project.description}”
                </div>
                <span className="text-[11px] text-[#3B82F6] font-medium">
                  SAMPLE-META 근거로 AI 가설 및 결정상 거동에 연계됨
                </span>
              </div>
            )}

            {/* 2 & 3. XRD / SEM 관찰된 사실 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <h4 className="text-[15px] font-bold text-[#191F28]">XRD에서 관찰된 사실</h4>
                {activeAi.report.xrd_observed_facts?.map((item: any, idx: number) => (
                  <div key={idx} className="p-3.5 rounded-[14px] border border-[#E5E8EB] space-y-2 text-[13px] leading-relaxed">
                    <div>{item.statement}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {item.evidence_ids?.map((eid: string) => (
                        <EvidenceChip key={eid} id={eid} registry={registry} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <h4 className="text-[15px] font-bold text-[#191F28]">SEM에서 관찰된 사실</h4>
                {activeAi.report.sem_observed_facts?.map((item: any, idx: number) => (
                  <div key={idx} className="p-3.5 rounded-[14px] border border-[#E5E8EB] space-y-2 text-[13px] leading-relaxed">
                    <div>{item.statement}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {item.evidence_ids?.map((eid: string) => (
                        <EvidenceChip key={eid} id={eid} registry={registry} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 4. 두 결과를 함께 해석한 가설 */}
            <div className="space-y-2">
              <h4 className="text-[15px] font-bold text-[#191F28]">두 결과를 함께 해석한 가설</h4>
              {activeAi.report.integrated_hypotheses?.length ? (
                activeAi.report.integrated_hypotheses.map((h: any, idx: number) => (
                  <div key={idx} className="p-4 rounded-[14px] bg-[#F8FAFC] border border-[#E5E8EB] space-y-2 text-[13px] leading-relaxed">
                    <div className="font-semibold text-[#191F28]">{h.hypothesis}</div>
                    <div className="text-[12px] text-[#6B7684]">
                      <strong>전제 및 대안 설명:</strong> {h.caveats}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {h.basis_ids?.map((eid: string) => (
                        <EvidenceChip key={eid} id={eid} registry={registry} />
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-[13px] text-[#6B7684] bg-[#F7F8FA] p-3.5 rounded-[12px]">
                  단일 장비 분석이거나 동일 시료 확인이 제한되어 통합 가설을 생략했습니다.
                </div>
              )}
            </div>

            {/* 5 & 6. 추가 확인 항목 & 다음 실험 제안 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <h4 className="text-[15px] font-bold text-[#191F28]">
                  불일치 또는 추가 확인이 필요한 항목
                </h4>
                {activeAi.report.discrepancies_and_checks?.map((dc: any, idx: number) => (
                  <div key={idx} className="p-3.5 rounded-[14px] border border-[#E5E8EB] space-y-1.5 text-[13px]">
                    <div className="font-semibold text-[#191F28]">{dc.item}</div>
                    <div className="text-[#6B7684] text-[12px] leading-relaxed">{dc.reason}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {dc.related_ids?.map((eid: string) => (
                        <EvidenceChip key={eid} id={eid} registry={registry} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <h4 className="text-[15px] font-bold text-[#191F28]">다음 실험 제안 및 목적</h4>
                {activeAi.report.next_experiments?.map((ex: any, idx: number) => (
                  <div key={idx} className="p-3.5 rounded-[14px] border border-[#E5E8EB] space-y-1 text-[13px]">
                    <div className="font-semibold text-[#3182F6]">{ex.experiment}</div>
                    <div className="text-[#4E5968] text-[12px] leading-relaxed">
                      <strong>목적:</strong> {ex.purpose}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 7. 분석 한계 */}
            <div className="space-y-1.5 pt-2 border-t border-[#E5E8EB]">
              <h4 className="text-[14px] font-bold text-[#6B7684]">분석 한계</h4>
              <ul className="text-[12px] text-[#6B7684] space-y-1">
                {activeAi.report.limitations?.map((lim: string, idx: number) => (
                  <li key={idx}>• {lim}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Card>

      {/* Reproducibility & Run History Switcher */}
      <CollapsiblePanel
        title={`분석 실행 이력 및 재현성 메타데이터 (현재 Run #${run.run_number})`}
        subtitle="파라미터 변경 시마다 별도 Run ID로 보존되며 이전 실행 결과를 언제든 다시 열 수 있습니다."
      >
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <div className="text-[13px] font-semibold text-[#191F28] flex items-center gap-1.5">
              <History className="w-4 h-4 text-[#3182F6]" />
              저장된 분석 실행 목록
            </div>
            <div className="flex flex-wrap gap-2">
              {project.runs.map((r) => (
                <Button
                  key={r.id}
                  type="button"
                  size="sm"
                  variant={r.id === run.id ? "primary" : "outline"}
                  onClick={() => onSelectRun(r.id)}
                >
                  Run #{r.run_number} ({r.status === "completed" ? "완료" : r.status}) ·{" "}
                  {new Date(r.created_at).toLocaleTimeString("ko-KR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[12px] text-[#4E5968] bg-[#F7F8FA] p-4 rounded-[14px]">
            <div className="space-y-1">
              <div className="font-semibold text-[#191F28]">원본 파일 SHA-256 해시</div>
              {Object.entries(run.file_hashes || {}).map(([name, h]) => (
                <div key={name} className="font-mono break-all">
                  {name}: {h}
                </div>
              ))}
              <div className="pt-1">
                <strong>기준 라이브러리 버전:</strong> {run.ref_library_version}
              </div>
            </div>
            <div className="space-y-1">
              <div className="font-semibold text-[#191F28]">알고리즘 및 수치 라이브러리 버전</div>
              <div className="font-mono text-[11px] leading-relaxed">
                {Object.entries(run.algo_versions || {})
                  .map(([k, v]) => `${k}=${v}`)
                  .join(", ")}
              </div>
            </div>
          </div>
        </div>
      </CollapsiblePanel>
    </div>
  );
}
