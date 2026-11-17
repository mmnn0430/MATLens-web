import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  Edit3,
  FileSpreadsheet,
  FileText,
  Flame,
  Image as ImageIcon,
  Link2,
  Loader2,
  Maximize2,
  MessageSquare,
  Microscope,
  RefreshCw,
  Send,
  Share2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../api";
import { PlotlyChart } from "./PlotlyChart";
import type {
  ComparisonQuestionType,
  ExperimentMeta,
  IntegratedAnalysisResult,
  LiteratureReference,
  ProjectDetail,
  RunDetail,
} from "../types";

interface IntegratedAnalysisViewProps {
  activeProject?: ProjectDetail | null;
  activeRun?: RunDetail | null;
}

const QUESTION_CARDS: Array<{
  id: ComparisonQuestionType;
  title: string;
  criteria: string;
  displayFocus: string;
  badge: string;
}> = [
  {
    id: "process_variation",
    title: "같은 조성에서 공정이 바뀌면 무엇이 달라지는가?",
    criteria: "명목 조성·도펀트·함량이 같은 시편에서 열처리 온도, 유지 시간, 분위기 등 선택한 공정 변수를 비교",
    displayFocus: "각 시편의 공정값과 함께 달라진 조건 및 복수 변수 동시 변경(교란) 경고",
    badge: "실험 질문 1 · 공정 변수 비교",
  },
  {
    id: "dopant_type",
    title: "같은 모재에서 도펀트 종류가 바뀌면 무엇이 달라지는가?",
    criteria: "같은 모재와 가능한 한 같은 공정·동등한 함량 기준에서 도펀트 종류를 비교 (무도핑 대조군 포함)",
    displayFocus: "모재, 도펀트 종류, 함량과 단위, 무도핑 대조군 포함 여부",
    badge: "실험 질문 2 · 도펀트 종류 비교",
  },
  {
    id: "dopant_amount",
    title: "같은 모재에서 함량이 바뀌면 무엇이 달라지는가?",
    criteria: "같은 모재·도펀트(또는 첨가 성분)·공정에서 함량별 시편을 구성",
    displayFocus: "함량 오름차순의 변화 추세, 단위 호환성 검증 및 반복 시편 간 편차",
    badge: "실험 질문 3 · 도펀트 함량 시리즈",
  },
];

function readSessionIdFromUrl(): string | null {
  const sp = new URLSearchParams(window.location.search);
  return sp.get("session") || localStorage.getItem("matlens_active_comparison_session_id");
}

function writeSessionIdToUrl(sessionId: string | null) {
  if (!sessionId) return;
  try {
    localStorage.setItem("matlens_active_comparison_session_id", sessionId);
    const sp = new URLSearchParams(window.location.search);
    sp.set("mode", "integrated");
    sp.set("session", sessionId);
    window.history.replaceState(null, "", `?${sp.toString()}`);
  } catch {
    // ignore URL history error
  }
}

export function IntegratedAnalysisView({ activeProject, activeRun: _activeRun }: IntegratedAnalysisViewProps) {
  // =========================================================================
  // 1. Multi-Specimen Comparison & XRD-SEM Cross-Analysis State
  // =========================================================================
  const [questionType, setQuestionType] = useState<ComparisonQuestionType>("process_variation");
  const [baselineProjectId, setBaselineProjectId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(() => readSessionIdFromUrl());
  const [normMode, setNormMode] = useState<"max_100" | "raw">("max_100");
  const [offsetStep, setOffsetStep] = useState<number>(115);
  const [showRawAndBgOverlay, setShowRawAndBgOverlay] = useState<boolean>(false);
  const [twoThetaZoomWindow, setTwoThetaZoomWindow] = useState<[number, number] | null>(null);

  const [compLoading, setCompLoading] = useState<boolean>(false);
  const [compData, setCompData] = useState<any | null>(null);
  const [selectedPeakUid, setSelectedPeakUid] = useState<string | null>(null);
  const [highlightedSlotId, setHighlightedSlotId] = useState<string | null>(null);
  const [semViewModeBySlot, setSemViewModeBySlot] = useState<Record<string, "raw" | "overlay">>({});
  const [semLoadErrorByFile, setSemLoadErrorByFile] = useState<Record<string, boolean>>({});
  const [semZoomModal, setSemZoomModal] = useState<{
    url: string;
    sampleName: string;
    fovLabel: string;
    filename: string;
    scaleSummary: string;
  } | null>(null);

  // Inline Metadata Editor State (for supplementing missing/unconfirmed specimen metadata)
  const [editingMetaProjectId, setEditingMetaProjectId] = useState<string | null>(null);
  const [editingSampleName, setEditingSampleName] = useState<string>("");
  const [editingMetaForm, setEditingMetaForm] = useState<ExperimentMeta>({
    base_matrix: "",
    nominal_composition: "",
    dopant_element: "",
    dopant_amount: null,
    dopant_unit: "at%",
    process_temp_c: null,
    process_time_h: null,
    atmosphere: "Air",
    process_method: "하소(Calcination)",
    replicate_id: "",
  });
  const [savingMeta, setSavingMeta] = useState<boolean>(false);

  // Section refs for clickable evidence links
  const xrdSectionRef = useRef<HTMLDivElement | null>(null);
  const semSectionRef = useRef<HTMLDivElement | null>(null);

  // =========================================================================
  // 2. Transport (Hall / LFA) & Literature RAG / Research Assistant State
  // =========================================================================
  const [showTransportSection, setShowTransportSection] = useState<boolean>(false);
  const [sampleId] = useState<string>("NbFeSb-SPS-01");
  const [materialName] = useState<string>("NbFeSb half-Heusler");
  const [chemicalFormula] = useState<string>("NbFeSb");
  const [dopant] = useState<string>("Ti (5 at%)");
  const [tempK] = useState<number>(300);

  const [hasXrd] = useState<boolean>(true);
  const [crystalliteNm] = useState<number>(42.5);
  const [spaceGroup] = useState<string>("F-43m");

  const [hasSem] = useState<boolean>(true);
  const [grainSizeUm] = useState<number>(2.4);
  const [porosityPct] = useState<number>(1.2);

  const [hasHall] = useState<boolean>(true);
  const [carrierConc] = useState<number>(4.2e20);
  const [hallMobility] = useState<number>(22.0);
  const [elecCond] = useState<number>(1500.0);
  const [carrierType] = useState<string>("p-type (Hole)");

  const [hasLfa] = useState<boolean>(true);
  const [thermalDiff] = useState<number>(2.1);
  const [thermalCond] = useState<number>(4.8);
  const [densityGcm3] = useState<number>(8.25);
  const [cpJgK] = useState<number>(0.28);

  const [result, setResult] = useState<IntegratedAnalysisResult | null>(null);
  const [litLoading, setLitLoading] = useState<boolean>(false);
  const [references, setReferences] = useState<LiteratureReference[]>([]);

  const [qaInput, setQaInput] = useState<string>("");
  const [qaLoading, setQaLoading] = useState<boolean>(false);
  const [qaHistory, setQaHistory] = useState<
    { sender: "user" | "ai"; text: string; category?: string; engine?: string }[]
  >([
    {
      sender: "ai",
      text: "안녕하세요! MatLens 대화형 연구 어시스턴트입니다. 현재 선택된 실험 질문에 따른 시편 간 XRD 피크 이동(Δ2θ), 이차상 판정 근거, SEM 미세조직 변화 및 물리적 수송 메커니즘에 대해 무엇이든 질문해 주세요.",
      category: "Grounded Research Assistant",
      engine: "MatLens 2.0 정밀 과학 지식 엔진",
    },
  ]);

  // =========================================================================
  // Load or Initialize Comparison Session
  // =========================================================================
  const loadQuestionAndAnalyze = useCallback(
    async (
      nextQuestion: ComparisonQuestionType,
      nextBaselineId?: string | null,
      customSlots?: Array<{
        project_id: string;
        xrd_run_id?: string | null;
        sem_file_id?: string | null;
        sem_run_id?: string | null;
      }>,
      nextNormMode?: "max_100" | "raw",
      nextOffsetStep?: number
    ) => {
      setCompLoading(true);
      try {
        const effNorm = nextNormMode ?? normMode;
        const effOffset = nextOffsetStep ?? offsetStep;

        let slotsToUse = customSlots;
        let baseIdToUse = nextBaselineId;

        if (!slotsToUse) {
          const candRes = await api.evaluateComparisonCandidates({
            question_type: nextQuestion,
            baseline_project_id: nextBaselineId ?? null,
            auto_seed_if_empty: true,
          });
          baseIdToUse = candRes.baseline_project_id;
          slotsToUse = (candRes.recommended_project_ids || []).map((pid: string) => ({
            project_id: pid,
          }));
        }

        const res = await api.analyzeComparison({
          session_id: sessionId,
          question_type: nextQuestion,
          baseline_project_id: baseIdToUse ?? null,
          slots: slotsToUse || [],
          norm_mode: effNorm,
          offset_step: effOffset,
        });

        setCompData(res);
        setQuestionType(res.question?.id || nextQuestion);
        setBaselineProjectId(res.baseline_project_id);
        if (res.session_id) {
          setSessionId(res.session_id);
          writeSessionIdToUrl(res.session_id);
        }
        setTwoThetaZoomWindow(null);
      } catch (err: any) {
        console.error("Comparison analysis error:", err);
      } finally {
        setCompLoading(false);
      }
    },
    [normMode, offsetStep, sessionId]
  );

  // Initial mount: restore existing session_id if present (preserving B->A & A2 across page refresh!), else evaluate default question
  useEffect(() => {
    let mounted = true;
    const initSession = async () => {
      const existingSid = readSessionIdFromUrl();
      if (existingSid) {
        setCompLoading(true);
        try {
          const restored = await api.getComparisonSession(existingSid);
          if (mounted && restored && restored.slots && restored.slots.length > 0) {
            setCompData(restored);
            setQuestionType(restored.question?.id || "process_variation");
            setBaselineProjectId(restored.baseline_project_id);
            setSessionId(restored.session_id);
            if (restored.normalization_info?.mode) {
              setNormMode(restored.normalization_info.mode);
            }
            if (restored.normalization_info?.offset_step) {
              setOffsetStep(restored.normalization_info.offset_step);
            }
            setCompLoading(false);
            return;
          }
        } catch {
          // If session expired or DB reset, fall through to fresh load
        }
      }
      if (mounted) {
        await loadQuestionAndAnalyze("process_variation", activeProject?.id || null);
      }
    };
    initSession();
    return () => {
      mounted = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // =========================================================================
  // Slot Manipulation Handlers (Reorder A<->B, Change FOV A1<->A2, Add/Remove)
  // =========================================================================
  const currentSlotsInput = useMemo(() => {
    if (!compData?.slots) return [];
    return compData.slots.map((s: any) => ({
      project_id: s.project_id,
      xrd_run_id: s.selected_xrd?.run_id || null,
      sem_file_id: s.selected_sem?.file_id || null,
      sem_run_id: s.selected_sem?.run_id || null,
    }));
  }, [compData]);

  const handleMoveSlot = async (index: number, direction: -1 | 1) => {
    const next = [...currentSlotsInput];
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= next.length) return;
    const temp = next[index];
    next[index] = next[targetIdx];
    next[targetIdx] = temp;
    await loadQuestionAndAnalyze(questionType, baselineProjectId, next);
  };

  const handleRemoveSlot = async (index: number) => {
    const next = currentSlotsInput.filter((_: any, i: number) => i !== index);
    await loadQuestionAndAnalyze(questionType, baselineProjectId, next);
  };

  const handleToggleCandidateInSlots = async (projectId: string) => {
    const existsIdx = currentSlotsInput.findIndex((s: any) => s.project_id === projectId);
    let next;
    if (existsIdx >= 0) {
      next = currentSlotsInput.filter((_: any, i: number) => i !== existsIdx);
    } else {
      next = [...currentSlotsInput, { project_id: projectId }];
    }
    await loadQuestionAndAnalyze(questionType, baselineProjectId, next);
  };

  const handleSelectSemFov = async (slotIndex: number, newSemFileId: string) => {
    const next = currentSlotsInput.map((s: any, idx: number) =>
      idx === slotIndex ? { ...s, sem_file_id: newSemFileId, sem_run_id: null } : s
    );
    await loadQuestionAndAnalyze(questionType, baselineProjectId, next);
  };

  const handleSelectXrdRun = async (slotIndex: number, newXrdRunId: string) => {
    const next = currentSlotsInput.map((s: any, idx: number) =>
      idx === slotIndex ? { ...s, xrd_run_id: newXrdRunId } : s
    );
    await loadQuestionAndAnalyze(questionType, baselineProjectId, next);
  };

  const handleReseedVerificationSeries = async () => {
    setCompLoading(true);
    try {
      await api.seedComparisonSeries(true);
      await loadQuestionAndAnalyze(questionType, null, undefined);
    } finally {
      setCompLoading(false);
    }
  };

  const openMetadataEditor = (cand: any) => {
    const m = cand.experiment_meta || {};
    setEditingMetaProjectId(cand.project_id);
    setEditingSampleName(cand.sample_name || "");
    setEditingMetaForm({
      base_matrix: m.base_matrix || "",
      nominal_composition: m.nominal_composition || "",
      dopant_element: m.dopant_element || "",
      dopant_amount: m.dopant_amount !== undefined ? m.dopant_amount : null,
      dopant_unit: m.dopant_unit || "at%",
      process_temp_c: m.process_temp_c !== undefined ? m.process_temp_c : null,
      process_time_h: m.process_time_h !== undefined ? m.process_time_h : null,
      atmosphere: m.atmosphere || "Air",
      process_method: m.process_method || "",
      replicate_id: m.replicate_id || "",
      is_synthetic_demo: Boolean(m.is_synthetic_demo),
    });
  };

  const handleSaveMetadata = async () => {
    if (!editingMetaProjectId) return;
    setSavingMeta(true);
    try {
      await api.updateProject(editingMetaProjectId, {
        sample_name: editingSampleName,
        experiment_meta: editingMetaForm,
        change_summary: `비교 분석 실험 조건 메타데이터 보완 (${editingMetaForm.base_matrix}, ${editingMetaForm.process_temp_c ?? "-"} °C)`,
      });
      setEditingMetaProjectId(null);
      await loadQuestionAndAnalyze(questionType, baselineProjectId, currentSlotsInput);
    } catch (err: any) {
      alert("메타데이터 저장 실패: " + (err.message || err));
    } finally {
      setSavingMeta(false);
    }
  };

  // =========================================================================
  // Build Interactive Stacked XRD Plotly Traces & Annotations
  // =========================================================================
  const selectedPeakObj = useMemo(() => {
    if (!selectedPeakUid || !compData?.all_peaks_table) return null;
    return compData.all_peaks_table.find((p: any) => p.peak_uid === selectedPeakUid) || null;
  }, [compData, selectedPeakUid]);

  const { plotlyTraces, plotlyLayout } = useMemo(() => {
    const traces: any[] = [];
    const stackedList = compData?.stacked_traces || [];

    for (const tr of stackedList) {
      if (showRawAndBgOverlay) {
        traces.push({
          x: tr.two_theta,
          y: tr.stacked_raw_intensity,
          type: "scatter",
          mode: "lines",
          name: `${tr.sample_name} (원시 강도)`,
          line: { color: "#94A3B8", width: 1, dash: "dot" },
          hoverinfo: "skip",
          showlegend: false,
        });
        traces.push({
          x: tr.two_theta,
          y: tr.stacked_background,
          type: "scatter",
          mode: "lines",
          name: `${tr.sample_name} (배경선)`,
          line: { color: "#CBD5E1", width: 1, dash: "dash" },
          hoverinfo: "skip",
          showlegend: false,
        });
      }

      // Main specimen diffraction curve
      traces.push({
        x: tr.two_theta,
        y: tr.stacked_intensity,
        type: "scatter",
        mode: "lines",
        name: tr.legend_label,
        line: { color: tr.color, width: 2.1 },
        hovertemplate: `<b>${tr.sample_name}</b><br>2θ: %{x:.3f}°<br>적층 강도: %{y:.1f}<extra></extra>`,
      });

      // Group peaks by phase role for distinct marker symbols
      const pks: any[] = tr.peaks || [];
      if (pks.length > 0) {
        const markerSymbols = pks.map((pk) => pk.marker_symbol || "circle");
        const markerColors = pks.map((pk) => {
          if (pk.peak_uid === selectedPeakUid) return "#DC2626";
          if (pk.marker_symbol === "circle") return tr.color;
          if (pk.marker_symbol === "diamond") return "#DC2626";
          if (pk.marker_symbol === "triangle-up") return "#D97706";
          return "#64748B";
        });
        const markerSizes = pks.map((pk) => (pk.peak_uid === selectedPeakUid ? 13 : 8.5));

        // Only attach (hkl) text on chart to top reflections that have verified reference (hkl)
        const textLabels = pks.map((pk) => {
          if (!pk.assigned_hkl) return "";
          if ((pk.rel_intensity_pct || 0) < 12 && pk.marker_symbol === "circle" && pk.peak_uid !== selectedPeakUid) {
            return "";
          }
          return `${pk.marker_label} ${pk.assigned_hkl}`;
        });

        traces.push({
          x: pks.map((pk) => pk.two_theta),
          y: pks.map((pk) => pk.y_on_stacked_curve + (normMode === "max_100" ? 5.5 : 35)),
          type: "scatter",
          mode: "markers+text",
          name: `${tr.sample_name} 검출 피크`,
          text: textLabels,
          textposition: "top center",
          textfont: { size: 10, family: "Pretendard, sans-serif", color: "#1E293B" },
          marker: {
            symbol: markerSymbols,
            size: markerSizes,
            color: markerColors,
            line: { width: 1, color: "#FFFFFF" },
          },
          customdata: pks.map((pk) => pk.peak_uid),
          hovertemplate: pks.map(
            (pk) =>
              `<b>[${pk.slot_index}] ${pk.sample_name} — ${pk.peak_id}</b><br>` +
              `실측 2θ: ${pk.two_theta}° (참조: ${pk.ref_two_theta ?? "미정합"}°, Δ2θ: ${pk.delta_ref_deg !== null ? pk.delta_ref_deg + "°" : "-"})<br>` +
              `상 귀속: ${pk.assigned_phase} ${pk.assigned_hkl ? "(" + pk.assigned_hkl + ")" : ""}<br>` +
              `상대강도: ${pk.rel_intensity_pct}% | FWHM: ${pk.fwhm_deg ?? "-"}° | 면적: ${pk.area ?? "-"}<br>` +
              `피팅상태: ${pk.fit_quality_badge}<extra></extra>`
          ),
          showlegend: false,
        });
      }
    }

    const shapes: any[] = [];
    if (selectedPeakObj) {
      shapes.push({
        type: "line",
        x0: selectedPeakObj.two_theta,
        x1: selectedPeakObj.two_theta,
        y0: 0,
        y1: 1,
        yref: "paper",
        line: { color: "#DC2626", width: 1.5, dash: "dash" },
      });
    }

    const layout: any = {
      title: {
        text: compData?.report_title || "다종 시편 Stacked XRD 회절 패턴 비교",
        font: { size: 13, family: "Pretendard, sans-serif" },
        y: 0.97,
      },
      xaxis: {
        title: { text: "회절각 2θ (degrees)" },
        range: twoThetaZoomWindow || undefined,
        gridcolor: "#F1F5F9",
      },
      yaxis: {
        title: {
          text:
            normMode === "max_100"
              ? `정규화 강도 (Max=100, 세로 오프셋 +${offsetStep})`
              : "배경 보정 원시 강도 (Counts + Offset)",
        },
        gridcolor: "#F1F5F9",
      },
      legend: {
        orientation: "h" as const,
        y: -0.2,
        x: 0.5,
        xanchor: "center" as const,
        font: { size: 10.5, family: "Pretendard, sans-serif" },
      },
      shapes,
      margin: { t: 42, r: 20, b: 64, l: 56 },
      paper_bgcolor: "#FFFFFF",
      plot_bgcolor: "#FFFFFF",
      autosize: true,
    };

    return { plotlyTraces: traces, plotlyLayout: layout };
  }, [compData, normMode, offsetStep, selectedPeakObj, selectedPeakUid, showRawAndBgOverlay, twoThetaZoomWindow]);

  // Evidence Link Jump Handlers
  const handleJumpToXrdEvidence = (link: {
    slot_id?: string;
    peak_uid?: string | null;
    two_theta_window?: [number, number];
  }) => {
    if (link.peak_uid) {
      setSelectedPeakUid(link.peak_uid);
    }
    if (link.two_theta_window && link.two_theta_window.length === 2) {
      setTwoThetaZoomWindow(link.two_theta_window);
    }
    xrdSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleJumpToSemEvidence = (link: { slot_id?: string }) => {
    if (link.slot_id) {
      setHighlightedSlotId(link.slot_id);
      window.setTimeout(() => setHighlightedSlotId(null), 3500);
    }
    semSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // =========================================================================
  // Transport / Literature RAG / Assistant Handlers
  // =========================================================================
  const executeTransportIntegration = async () => {
    try {
      const resp = await api.runIntegratedAnalysis({
        sample_id: sampleId,
        material_name: materialName,
        temperature_K: tempK,
        xrd_data: hasXrd ? { crystallite_size_nm: crystalliteNm, space_group: spaceGroup } : null,
        sem_data: hasSem ? { grain_size_um: grainSizeUm, porosity_pct: porosityPct } : null,
        hall_data: hasHall
          ? {
              carrier_concentration_cm3: carrierConc,
              hall_mobility_cm2_Vs: hallMobility,
              electrical_conductivity_S_cm: elecCond,
              carrier_type: carrierType,
            }
          : null,
        lfa_data: hasLfa
          ? {
              thermal_diffusivity_mm2_s: thermalDiff,
              thermal_conductivity_W_mK: thermalCond,
              density_g_cm3: densityGcm3,
              specific_heat_J_gK: cpJgK,
            }
          : null,
        utm_data: null,
      });
      setResult(resp);

      setLitLoading(true);
      const litResp = await api.searchLiterature({
        material_name: materialName,
        chemical_composition: chemicalFormula,
        dopant: dopant,
        instrument: "XRD + SEM + Hall + LFA",
        temperature_C: Math.round(tempK - 273.15),
        limit: 4,
      });
      setReferences(litResp.references || []);
      setLitLoading(false);
    } catch {
      setLitLoading(false);
    }
  };

  const handleSendQa = async (queryText?: string) => {
    const q = (queryText || qaInput).trim();
    if (!q || qaLoading) return;
    setQaInput("");
    setQaHistory((prev) => [...prev, { sender: "user", text: q }]);
    setQaLoading(true);

    try {
      const firstSlot = compData?.slots?.[0];
      const activeMat = firstSlot?.experiment_meta?.base_matrix || materialName;
      const activeForm = firstSlot?.experiment_meta?.nominal_composition || chemicalFormula;

      const resp = await api.chatAssistant({
        message: q,
        material_name: activeMat,
        chemical_composition: activeForm,
        instrument: "Multi-Specimen XRD + SEM Comparison & Transport",
        calculated_properties: {
          experimental_question: compData?.question?.question,
          compared_specimens: (compData?.slots || []).map((s: any) => ({
            sample_name: s.sample_name,
            conditions: s.condition_comparison?.summary_sentence,
            primary_phase: s.selected_xrd?.primary_phase?.name,
            scherrer_nm: s.selected_xrd?.scherrer_mean_nm,
            sem_fov: s.selected_sem?.fov_label,
            sem_d50: s.selected_sem?.quant_metrics?.d50,
            sem_unit: s.selected_sem?.quant_metrics?.unit,
          })),
        },
        references: references,
      });

      setQaHistory((prev) => [
        ...prev,
        {
          sender: "ai",
          text: resp.reply,
          category: resp.category || "Grounded Research Assistant",
          engine: resp.engine || "Vertex AI / Gemini + Materials Project DB",
        },
      ]);
    } catch (err: any) {
      setQaHistory((prev) => [
        ...prev,
        {
          sender: "ai",
          text: `[오류 안내] 응답 생성 중 문제가 발생했습니다: ${err.message || err}`,
          category: "System Error",
        },
      ]);
    } finally {
      setQaLoading(false);
    }
  };

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
          textinfo: "percent",
          textposition: "inside",
          insidetextfont: { color: "#FFFFFF", size: 14, family: "Pretendard, sans-serif" },
          hole: 0.38,
        },
      ]
    : [];

  const pieLayout = {
    title: {
      text: "Wiedemann–Franz Law 열전도 분리 (κ = κ_e + κ_L)",
      font: { size: 13, family: "Pretendard, sans-serif" },
      y: 0.96,
    },
    legend: {
      orientation: "h" as const,
      y: -0.15,
      x: 0.5,
      xanchor: "center" as const,
      font: { size: 11, family: "Pretendard, sans-serif" },
    },
    margin: { t: 36, r: 16, b: 36, l: 16 },
    paper_bgcolor: "#FFFFFF",
    plot_bgcolor: "#FFFFFF",
    autosize: true,
  };

  const candEval = compData?.candidate_evaluation;
  const activeSlots: any[] = compData?.slots || [];
  const reflectionEvolution: any[] = compData?.reflection_evolution || [];
  const allPeaksTable: any[] = compData?.all_peaks_table || [];
  const crossCards: any[] = compData?.cross_analysis_cards || [];
  const replicateDeviations: any[] = compData?.replicate_deviations || [];

  return (
    <div className="space-y-6">
      {/* =====================================================================
          HEADER & SYNCHRONIZED MULTI-FORMAT EXPORT BAR
         ===================================================================== */}
      <div className="bg-white rounded-[20px] p-6 border border-[#E5E8EB] shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#EFF6FF] text-[#1D4ED8] text-[12px] font-bold mb-2 border border-[#BFDBFE]">
              <Share2 className="w-3.5 h-3.5" />
              실험 질문 기반 다종 시편 비교 분석 & XRD-SEM 교차 검증 리포트
            </div>
            <h2 className="text-[20px] sm:text-[22px] font-bold text-[#191F28]">
              {compData?.report_title || "실험 조건 변화에 따른 결정상(XRD) 및 미세조직(SEM) 통합 비교 리포트"}
            </h2>
            <p className="text-[13px] text-[#4E5968] mt-1">
              비교 질문과 통제 조건 → 시편별 측정자료(XRD·SEM 시야) 매핑 → 세로 오프셋 XRD 중첩 그래프 및 피크·이차상 표 → 동일 순서의 SEM 병렬 원본 → 4단계 교차 해석 순서로 검증합니다.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={compLoading}
              onClick={handleReseedVerificationSeries}
              className="px-3 py-2 rounded-[10px] bg-[#F8FAFC] hover:bg-[#F1F5F9] text-[#334155] border border-[#CBD5E1] text-[12px] font-semibold transition flex items-center gap-1.5 cursor-pointer"
              title="열처리 시리즈(A/B/C), 도핑 시리즈(D1/D2/D3/D4), 무관 재료(Si) 검증 데이터를 초기화·재생성합니다"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${compLoading ? "animate-spin" : ""}`} />
              검증 시편 시리즈 초기화
            </button>

            {sessionId && (
              <>
                <a
                  href={api.comparisonXrdPngUrl(sessionId)}
                  download
                  className="px-3 py-2 rounded-[10px] bg-[#EFF6FF] hover:bg-[#DBEAFE] text-[#1D4ED8] border border-[#BFDBFE] text-[12px] font-bold transition flex items-center gap-1.5"
                  title="현재 시편 순서와 (hkl)·상 마커가 반영된 300 DPI 중첩 XRD 차트 PNG 다운로드"
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  XRD 중첩 차트 (PNG)
                </a>
                <a
                  href={api.comparisonPeaksCsvUrl(sessionId)}
                  download
                  className="px-3 py-2 rounded-[10px] bg-[#F0FDF4] hover:bg-[#DCFCE7] text-[#15803D] border border-[#BBF7D0] text-[12px] font-bold transition flex items-center gap-1.5"
                  title="현재 비교 시편 순서의 검출 피크·면간격·반가폭·상 귀속 CSV 다운로드"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  비교 피크 표 (CSV)
                </a>
                <a
                  href={api.comparisonJsonUrl(sessionId)}
                  download
                  className="px-3 py-2 rounded-[10px] bg-[#F8FAFC] hover:bg-[#E2E8F0] text-[#334155] border border-[#CBD5E1] text-[12px] font-bold transition flex items-center gap-1.5"
                  title="시편 순서, 선택된 SEM 시야(SHA-256), XRD 피크 및 교차 해석 전체 JSON 번들 다운로드"
                >
                  <FileText className="w-3.5 h-3.5" />
                  결과 번들 (JSON)
                </a>
                <a
                  href={api.comparisonPdfUrl(sessionId)}
                  download
                  className="px-4 py-2 rounded-[10px] bg-[#1E40AF] hover:bg-[#1D4ED8] text-white text-[12px] font-bold transition flex items-center gap-1.5 shadow-sm"
                  title="현재 시편 순서 및 대표 SEM 원본 이미지가 반영된 통합 비교 리포트 PDF 다운로드"
                >
                  <Download className="w-3.5 h-3.5" />
                  통합 비교 리포트 (PDF)
                </a>
              </>
            )}
          </div>
        </div>
      </div>

      {/* =====================================================================
          STAGE 1: 실험 질문 선택 및 통제·변경·교란 조건 검증
         ===================================================================== */}
      <div className="bg-white rounded-[20px] p-6 border border-[#E5E8EB] shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-[#E2E8F0] pb-3">
          <div>
            <span className="text-[11px] font-bold text-[#2563EB] uppercase tracking-wider">STEP 1 · EXPERIMENTAL QUESTION & CONTROLLED CONDITIONS</span>
            <h3 className="text-[17px] font-bold text-[#191F28] mt-0.5">
              1. 실험 질문 선택 및 시편 비교군 구성 기준 검증
            </h3>
          </div>
          <span className="text-[12px] text-[#64748B] font-medium bg-[#F8FAFC] px-3 py-1 rounded-full border border-[#E2E8F0]">
            정렬 규칙: <strong className="text-[#1E293B]">{candEval?.sorting_rule_description || "실험 질문 기준 자동 정렬"}</strong>
          </span>
        </div>

        {/* 3 Experimental Question Selection Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
          {QUESTION_CARDS.map((q) => {
            const active = questionType === q.id;
            return (
              <button
                key={q.id}
                type="button"
                onClick={() => loadQuestionAndAnalyze(q.id, null, undefined)}
                className={`text-left p-4 rounded-[16px] border transition-all cursor-pointer flex flex-col justify-between ${
                  active
                    ? "border-[#2563EB] bg-[#EFF6FF]/70 ring-2 ring-[#BFDBFE] shadow-sm"
                    : "border-[#E2E8F0] bg-[#F8FAFC] hover:bg-white hover:border-[#CBD5E1]"
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                        active ? "bg-[#2563EB] text-white" : "bg-[#E2E8F0] text-[#475569]"
                      }`}
                    >
                      {q.badge}
                    </span>
                    {active && <CheckCircle2 className="w-4 h-4 text-[#2563EB]" />}
                  </div>
                  <div className="text-[14px] font-bold text-[#191F28] leading-snug pt-1">{q.title}</div>
                  <p className="text-[12px] text-[#475569] leading-relaxed">{q.criteria}</p>
                </div>
                <div className="mt-3 pt-2 border-t border-[#E2E8F0] text-[11px] text-[#1E40AF] font-medium">
                  <strong>표시 항목:</strong> {q.displayFocus}
                </div>
              </button>
            );
          })}
        </div>

        {/* Baseline Specimen Selector & Candidate Comparison Table */}
        {candEval && (
          <div className="space-y-4 pt-2">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-[#F8FAFC] p-3.5 rounded-[14px] border border-[#E2E8F0]">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-[13px] font-bold text-[#1E293B]">기준 시편 (Baseline Control):</span>
                <select
                  value={baselineProjectId || ""}
                  onChange={(e) => loadQuestionAndAnalyze(questionType, e.target.value, undefined)}
                  className="px-3 py-1.5 rounded-[10px] border border-[#CBD5E1] bg-white text-[13px] font-semibold text-[#0F172A]"
                >
                  {[...(candEval.eligible_candidates || []), ...(candEval.excluded_candidates || [])].map((c: any) => (
                    <option key={c.project_id} value={c.project_id}>
                      {c.sample_name} ({c.experiment_meta?.base_matrix || "모재 미기재"})
                    </option>
                  ))}
                </select>
              </div>
              <div className="text-[12px] text-[#475569]">
                비교 가능 후보 <strong className="text-[#1D4ED8]">{candEval.eligible_candidates?.length || 0}종</strong> ·
                조건 불일치/무관 제외 <strong className="text-[#DC2626]">{candEval.excluded_candidates?.length || 0}종</strong>
              </div>
            </div>

            {/* Empty Comparison State Warning if <= 1 eligible */}
            {candEval.empty_state_reason && (
              <div className="p-4 rounded-[14px] bg-[#FEF3C7] border border-[#FDE68A] text-[#92400E] text-[13px] flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-[#D97706]" />
                <div className="space-y-1">
                  <div className="font-bold">적합한 비교 후보가 부족합니다 (빈 비교 상태 안내)</div>
                  <p>{candEval.empty_state_reason}</p>
                </div>
              </div>
            )}

            {/* Eligible Candidates Condition Verification Table */}
            <div className="overflow-x-auto rounded-[14px] border border-[#E2E8F0]">
              <table className="w-full text-left border-collapse text-[12px]">
                <thead className="bg-[#F8FAFC] text-[#475569] border-b border-[#E2E8F0]">
                  <tr>
                    <th className="py-2.5 px-3 font-bold">비교 포함</th>
                    <th className="py-2.5 px-3 font-bold">시편명 및 데이터 구분</th>
                    <th className="py-2.5 px-3 font-bold">모재 · 명목조성 · 도펀트 · 공정</th>
                    <th className="py-2.5 px-3 font-bold">같은 조건 (통제 변수)</th>
                    <th className="py-2.5 px-3 font-bold">바뀐 조건 (실험 변수)</th>
                    <th className="py-2.5 px-3 font-bold">다중 변수 교란 / 확인 필요 조건</th>
                    <th className="py-2.5 px-3 font-bold text-right">메타데이터 보완</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {(candEval.eligible_candidates || []).map((cand: any) => {
                    const isSelected = currentSlotsInput.some((s: any) => s.project_id === cand.project_id);
                    const m: ExperimentMeta = cand.experiment_meta || {};
                    const ev = cand.comparison_eval || {};
                    const warnings: string[] = [
                      ...(ev.confounded_warnings || []),
                      ...(ev.needs_check_conditions || []),
                    ];
                    return (
                      <tr
                        key={cand.project_id}
                        className={isSelected ? "bg-[#EFF6FF]/40" : "bg-white hover:bg-[#F8FAFC]"}
                      >
                        <td className="py-2.5 px-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleCandidateInSlots(cand.project_id)}
                            className="w-4 h-4 accent-[#2563EB] cursor-pointer"
                          />
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-[#191F28]">{cand.sample_name}</div>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                cand.is_synthetic_demo
                                  ? "bg-[#FEF3C7] text-[#B45309]"
                                  : "bg-[#DCFCE7] text-[#15803D]"
                              }`}
                            >
                              {cand.is_synthetic_demo ? "합성/예시 시편" : "실제 업로드 시편"}
                            </span>
                            {cand.is_Baseline && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#1E40AF] text-white">
                                기준 시편
                              </span>
                            )}
                            {m.replicate_id && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#F1F5F9] text-[#475569]">
                                {m.replicate_id}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-[#334155]">
                          <div>
                            <strong>모재:</strong> {m.base_matrix || "미기재"} ({m.nominal_composition || "-"})
                          </div>
                          <div>
                            <strong>도펀트:</strong>{" "}
                            {m.dopant_element
                              ? `${m.dopant_element} ${m.dopant_amount ?? "?"} ${m.dopant_unit || ""}`
                              : "무도핑 (0)"}
                          </div>
                          <div>
                            <strong>공정:</strong> {m.process_method || "-"} ·{" "}
                            {m.process_temp_c !== null ? `${m.process_temp_c} °C` : "온도 미기재"} ·{" "}
                            {m.process_time_h !== null ? `${m.process_time_h} h` : "시간 미기재"} ·{" "}
                            {m.atmosphere || "분위기 미기재"}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex flex-wrap gap-1">
                            {(ev.same_conditions || []).map((sc: string, i: number) => (
                              <span
                                key={i}
                                className="px-2 py-0.5 rounded bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0] text-[11px]"
                              >
                                {sc}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex flex-wrap gap-1">
                            {(ev.changed_conditions || []).map((cc: string, i: number) => (
                              <span
                                key={i}
                                className="px-2 py-0.5 rounded bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE] text-[11px] font-semibold"
                              >
                                {cc}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          {warnings.length > 0 ? (
                            <div className="space-y-1">
                              {warnings.map((w: string, i: number) => (
                                <div
                                  key={i}
                                  className="p-1.5 rounded bg-[#FEF3C7] border border-[#FDE68A] text-[#92400E] text-[11px] leading-snug"
                                >
                                  ⚠️ {w}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[#059669] font-semibold text-[11px]">✓ 단일 변수 통제 확인됨</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => openMetadataEditor(cand)}
                            className="px-2.5 py-1 rounded-[8px] border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#334155] text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Edit3 className="w-3 h-3" />
                            조건 편집
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Excluded Unrelated / Mismatched Specimens Accordion */}
            {(candEval.excluded_candidates || []).length > 0 && (
              <details className="rounded-[12px] border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-[12px]">
                <summary className="font-bold text-[#475569] cursor-pointer">
                  기본 비교 후보에서 제외된 시편 ({candEval.excluded_candidates.length}종) — 무관한 모재 또는 실험 질문 조건 불일치 사유 보기
                </summary>
                <div className="mt-2.5 space-y-1.5 pt-2 border-t border-[#E2E8F0]">
                  {candEval.excluded_candidates.map((ex: any) => (
                    <div
                      key={ex.project_id}
                      className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 p-2 rounded bg-white border border-[#E2E8F0]"
                    >
                      <div>
                        <strong className="text-[#1E293B]">{ex.sample_name}</strong>{" "}
                        <span className="text-[#DC2626] font-medium ml-1">
                          — {ex.comparison_eval?.exclusion_reason}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => openMetadataEditor(ex)}
                        className="px-2 py-1 rounded border border-[#CBD5E1] text-[11px] text-[#475569] hover:bg-[#F1F5F9] shrink-0 cursor-pointer"
                      >
                        메타데이터 확인/보완
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </div>

      {/* =====================================================================
          INLINE METADATA SUPPLEMENTATION MODAL
         ===================================================================== */}
      {editingMetaProjectId && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-[20px] max-w-xl w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
              <h3 className="text-[16px] font-bold text-[#191F28]">
                시편 실험 설계 메타데이터 확인 및 보완
              </h3>
              <button
                type="button"
                onClick={() => setEditingMetaProjectId(null)}
                className="p-1 rounded hover:bg-[#F1F5F9] text-[#64748B] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[12px]">
              <div className="sm:col-span-2">
                <label className="font-bold text-[#334155] block mb-1">시편명 (Sample Name)</label>
                <input
                  type="text"
                  value={editingSampleName}
                  onChange={(e) => setEditingSampleName(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-[8px] border border-[#CBD5E1]"
                />
              </div>
              <div>
                <label className="font-bold text-[#334155] block mb-1">모재 (Base Matrix, 예: TiO2, NbFeSb)</label>
                <input
                  type="text"
                  value={editingMetaForm.base_matrix}
                  onChange={(e) => setEditingMetaForm({ ...editingMetaForm, base_matrix: e.target.value })}
                  className="w-full px-3 py-1.5 rounded-[8px] border border-[#CBD5E1]"
                />
              </div>
              <div>
                <label className="font-bold text-[#334155] block mb-1">명목 조성 (Nominal Composition)</label>
                <input
                  type="text"
                  value={editingMetaForm.nominal_composition}
                  onChange={(e) => setEditingMetaForm({ ...editingMetaForm, nominal_composition: e.target.value })}
                  className="w-full px-3 py-1.5 rounded-[8px] border border-[#CBD5E1]"
                />
              </div>
              <div>
                <label className="font-bold text-[#334155] block mb-1">도펀트 원소 (무도핑 시 비움)</label>
                <input
                  type="text"
                  placeholder="예: Nb, Fe, Ti"
                  value={editingMetaForm.dopant_element}
                  onChange={(e) => setEditingMetaForm({ ...editingMetaForm, dopant_element: e.target.value })}
                  className="w-full px-3 py-1.5 rounded-[8px] border border-[#CBD5E1]"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-[#334155] block mb-1">도펀트 함량</label>
                  <input
                    type="number"
                    step="0.1"
                    value={editingMetaForm.dopant_amount ?? ""}
                    onChange={(e) =>
                      setEditingMetaForm({
                        ...editingMetaForm,
                        dopant_amount: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    className="w-full px-2.5 py-1.5 rounded-[8px] border border-[#CBD5E1]"
                  />
                </div>
                <div>
                  <label className="font-bold text-[#334155] block mb-1">함량 단위</label>
                  <select
                    value={editingMetaForm.dopant_unit}
                    onChange={(e) => setEditingMetaForm({ ...editingMetaForm, dopant_unit: e.target.value })}
                    className="w-full px-2 py-1.5 rounded-[8px] border border-[#CBD5E1] bg-white"
                  >
                    <option value="at%">at%</option>
                    <option value="wt%">wt%</option>
                    <option value="mol%">mol%</option>
                    <option value="stoich_x">화학량론 x</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="font-bold text-[#334155] block mb-1">열처리/소결 온도 (°C)</label>
                <input
                  type="number"
                  value={editingMetaForm.process_temp_c ?? ""}
                  onChange={(e) =>
                    setEditingMetaForm({
                      ...editingMetaForm,
                      process_temp_c: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  className="w-full px-3 py-1.5 rounded-[8px] border border-[#CBD5E1]"
                />
              </div>
              <div>
                <label className="font-bold text-[#334155] block mb-1">유지 시간 (h)</label>
                <input
                  type="number"
                  step="0.5"
                  value={editingMetaForm.process_time_h ?? ""}
                  onChange={(e) =>
                    setEditingMetaForm({
                      ...editingMetaForm,
                      process_time_h: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  className="w-full px-3 py-1.5 rounded-[8px] border border-[#CBD5E1]"
                />
              </div>
              <div>
                <label className="font-bold text-[#334155] block mb-1">분위기 (Atmosphere)</label>
                <input
                  type="text"
                  placeholder="Air, Ar, Vacuum 등"
                  value={editingMetaForm.atmosphere}
                  onChange={(e) => setEditingMetaForm({ ...editingMetaForm, atmosphere: e.target.value })}
                  className="w-full px-3 py-1.5 rounded-[8px] border border-[#CBD5E1]"
                />
              </div>
              <div>
                <label className="font-bold text-[#334155] block mb-1">공정 방법 / 반복시편 ID</label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="하소, SPS 등"
                    value={editingMetaForm.process_method}
                    onChange={(e) => setEditingMetaForm({ ...editingMetaForm, process_method: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded-[8px] border border-[#CBD5E1]"
                  />
                  <input
                    type="text"
                    placeholder="Rep-1"
                    value={editingMetaForm.replicate_id}
                    onChange={(e) => setEditingMetaForm({ ...editingMetaForm, replicate_id: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded-[8px] border border-[#CBD5E1]"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-[#E2E8F0]">
              <button
                type="button"
                onClick={() => setEditingMetaProjectId(null)}
                className="px-4 py-2 rounded-[10px] border border-[#CBD5E1] text-[12px] font-semibold text-[#475569] cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                disabled={savingMeta}
                onClick={handleSaveMetadata}
                className="px-4 py-2 rounded-[10px] bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-[12px] font-bold cursor-pointer"
              >
                {savingMeta ? "저장 중..." : "저장 및 비교군 재평가"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          STAGE 2: 시편별 측정자료 매핑 (순서 재정렬 A<->B 및 대표 SEM 시야 A1/A2 선택)
         ===================================================================== */}
      <div className="bg-white rounded-[20px] p-6 border border-[#E5E8EB] shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-[#E2E8F0] pb-3">
          <div>
            <span className="text-[11px] font-bold text-[#7C3AED] uppercase tracking-wider">STEP 2 · SPECIMEN-TO-MEASUREMENT & FOV BINDING</span>
            <h3 className="text-[17px] font-bold text-[#191F28] mt-0.5">
              2. 비교 열(Column) 순서 재정렬 및 시편별 XRD 측정 · SEM 대표 시야(FOV) 지정
            </h3>
          </div>
          <span className="text-[12px] text-[#64748B]">
            순서 변경(A↔B) 및 대표 시야(A1↔A2) 변경 시 그래프·SEM 카드·새로고침·내보내기(PDF/PNG/CSV/JSON)에 즉시 동기화됩니다.
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {activeSlots.map((sl: any, idx: number) => {
            const xrdInfo = sl.selected_xrd;
            const semInfo = sl.selected_sem || {};
            const semFiles: any[] = sl.available_sem_files || [];
            const xrdRuns: any[] = sl.available_xrd_runs || [];
            return (
              <div
                key={sl.slot_id}
                className="p-4 rounded-[16px] border border-[#CBD5E1] bg-[#F8FAFC] flex flex-col justify-between space-y-3"
              >
                <div className="space-y-2">
                  {/* Reorder & Slot Header */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-6 h-6 rounded-full text-white text-[12px] font-bold flex items-center justify-center shrink-0"
                        style={{ backgroundColor: sl.color || "#1D4ED8" }}
                      >
                        {sl.slot_index}
                      </span>
                      <span className="text-[14px] font-bold text-[#191F28] truncate" title={sl.sample_name}>
                        {sl.sample_name}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={idx === 0 || compLoading}
                        onClick={() => handleMoveSlot(idx, -1)}
                        className="p-1.5 rounded-[8px] border border-[#CBD5E1] bg-white hover:bg-[#EFF6FF] disabled:opacity-40 cursor-pointer"
                        title="앞 순서로 이동"
                      >
                        <ArrowLeft className="w-3.5 h-3.5 text-[#1E293B]" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === activeSlots.length - 1 || compLoading}
                        onClick={() => handleMoveSlot(idx, 1)}
                        className="p-1.5 rounded-[8px] border border-[#CBD5E1] bg-white hover:bg-[#EFF6FF] disabled:opacity-40 cursor-pointer"
                        title="뒤 순서로 이동"
                      >
                        <ArrowRight className="w-3.5 h-3.5 text-[#1E293B]" />
                      </button>
                      {activeSlots.length > 1 && (
                        <button
                          type="button"
                          disabled={compLoading}
                          onClick={() => handleRemoveSlot(idx)}
                          className="p-1.5 rounded-[8px] border border-[#FECACA] bg-white hover:bg-[#FEF2F2] text-[#DC2626] cursor-pointer"
                          title="비교 열에서 제외"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="text-[11px] text-[#475569] bg-white px-2.5 py-1.5 rounded-[8px] border border-[#E2E8F0]">
                    <strong>조건 요약:</strong> {sl.condition_comparison?.summary_sentence}
                  </div>

                  {/* XRD Measurement Selector */}
                  <div className="p-2.5 rounded-[10px] bg-white border border-[#E2E8F0] space-y-1 text-[12px]">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#1E40AF] flex items-center gap-1">
                        <Activity className="w-3.5 h-3.5" />
                        선택된 XRD 측정
                      </span>
                      {xrdRuns.length > 1 && (
                        <select
                          value={xrdInfo?.run_id || ""}
                          onChange={(e) => handleSelectXrdRun(idx, e.target.value)}
                          className="text-[11px] border border-[#CBD5E1] rounded px-1.5 py-0.5 bg-[#F8FAFC]"
                        >
                          {xrdRuns.map((r: any) => (
                            <option key={r.run_id} value={r.run_id}>
                              Run #{r.run_number}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    {xrdInfo ? (
                      <div className="text-[11px] text-[#334155] space-y-0.5">
                        <div>
                          파일: <strong>{xrdInfo.original_filename}</strong> (Run #{xrdInfo.run_number})
                        </div>
                        <div>
                          조건: {xrdInfo.xray_source} · 범위 {xrdInfo.two_theta_min.toFixed(1)}°~{xrdInfo.two_theta_max.toFixed(1)}°
                        </div>
                      </div>
                    ) : (
                      <div className="text-[11px] text-[#DC2626]">업로드된 XRD 측정 없음</div>
                    )}
                  </div>

                  {/* SEM Representative Image / FOV Selector */}
                  <div className="p-2.5 rounded-[10px] bg-white border border-[#E2E8F0] space-y-1.5 text-[12px]">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#047857] flex items-center gap-1">
                        <Microscope className="w-3.5 h-3.5" />
                        대표 SEM 이미지 / 촬영 시야 선택
                      </span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#ECFDF5] text-[#047857]">
                        보유 시야 {semFiles.length}장
                      </span>
                    </div>

                    {semFiles.length > 0 ? (
                      <>
                        <select
                          value={semInfo.file_id || ""}
                          onChange={(e) => handleSelectSemFov(idx, e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-[8px] border border-[#93C5FD] bg-[#EFF6FF]/40 text-[12px] font-bold text-[#1E293B] cursor-pointer"
                        >
                          {semFiles.map((sf: any) => (
                            <option key={sf.file_id} value={sf.file_id}>
                              {sf.fov_label} — {sf.original_filename}
                            </option>
                          ))}
                        </select>
                        <div className="text-[11px] text-[#475569] space-y-0.5">
                          <div>
                            원본파일: <code className="font-mono text-[#0F172A]">{semInfo.original_filename}</code> (ID: {semInfo.file_id})
                          </div>
                          <div>
                            모드/배율: <strong>{semInfo.imaging_mode}</strong> · {semInfo.magnification} · SHA: {(semInfo.sha256 || "").slice(0, 10)}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="text-[11px] text-[#B45309] bg-[#FEF3C7] p-2 rounded-[8px]">
                        이 시편에 업로드된 SEM 이미지가 없습니다 (대체 이미지 미사용).
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* =====================================================================
          STAGE 3: XRD 세로 오프셋 중첩 그래프 & 피크·(hkl)·이차상 근거·시편 간 변화 표
         ===================================================================== */}
      <div ref={xrdSectionRef} className="bg-white rounded-[20px] p-6 border border-[#E5E8EB] shadow-sm space-y-5">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 border-b border-[#E2E8F0] pb-3">
          <div>
            <span className="text-[11px] font-bold text-[#1D4ED8] uppercase tracking-wider">
              STEP 3 · STACKED XRD DIFFRACTOGRAMS & PHASE / REFLECTION EVIDENCE
            </span>
            <h3 className="text-[17px] font-bold text-[#191F28] mt-0.5">
              3. XRD 세로 오프셋 중첩 그래프 및 피크 · (hkl) · 이차상 후보 검증
            </h3>
            <p className="text-[12px] text-[#64748B] mt-0.5">
              참조 반사와 대응되는 주요 피크에만 (hkl)을 표기하며, 마커(● 주상 / ◆ 다중반사 이차상 후보 / △ 단일 약피크 보류 / ? 미할당)를 클릭하면 아래 피크 표와 함께 강조됩니다.
            </p>
          </div>

          {/* Normalization, Offset & Raw Overlay Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={normMode}
              onChange={(e) => {
                const nextM = e.target.value as "max_100" | "raw";
                setNormMode(nextM);
                loadQuestionAndAnalyze(questionType, baselineProjectId, currentSlotsInput, nextM, offsetStep);
              }}
              className="px-3 py-1.5 rounded-[10px] border border-[#CBD5E1] bg-[#F8FAFC] text-[12px] font-semibold text-[#1E293B]"
            >
              <option value="max_100">정규화: 배경보정 최대 피크 = 100</option>
              <option value="raw">원시 강도: 배경보정 Counts (비정규화)</option>
            </select>

            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] border border-[#CBD5E1] bg-[#F8FAFC] text-[12px]">
              <span className="font-semibold text-[#475569]">오프셋:</span>
              <input
                type="number"
                step="15"
                min="0"
                max="500"
                value={offsetStep}
                onChange={(e) => {
                  const val = Math.max(0, Number(e.target.value));
                  setOffsetStep(val);
                }}
                onBlur={() => loadQuestionAndAnalyze(questionType, baselineProjectId, currentSlotsInput, normMode, offsetStep)}
                className="w-16 px-1.5 py-0.5 rounded border border-[#CBD5E1] bg-white text-center font-bold"
              />
            </div>

            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] border border-[#CBD5E1] bg-[#F8FAFC] text-[12px] font-semibold text-[#334155] cursor-pointer">
              <input
                type="checkbox"
                checked={showRawAndBgOverlay}
                onChange={(e) => setShowRawAndBgOverlay(e.target.checked)}
              />
              원자료(Raw)·배경선 겹쳐 보기
            </label>

            {twoThetaZoomWindow && (
              <button
                type="button"
                onClick={() => setTwoThetaZoomWindow(null)}
                className="px-2.5 py-1.5 rounded-[10px] bg-[#EFF6FF] text-[#1D4ED8] text-[12px] font-bold cursor-pointer"
              >
                전체 2θ 범위 복원
              </button>
            )}
          </div>
        </div>

        {/* Normalization & No-Mass-Fraction Scientific Disclaimer */}
        <div className="p-3 rounded-[12px] bg-[#FFFBEB] border border-[#FDE68A] text-[12px] text-[#92400E] flex items-center justify-between gap-2 flex-wrap">
          <span>
            <strong>정규화 및 오프셋 기준:</strong> {compData?.normalization_info?.mode_label} (세로 오프셋 간격: {offsetStep}).{" "}
            {compData?.normalization_info?.mass_fraction_warning}
          </span>
          <span className="text-[11px] font-bold bg-white px-2 py-0.5 rounded border border-[#FDE68A]">
            마커 범례: ● 주상 | ◆ 이차상 후보(다중반사) | △ 단일 약피크(미확정) | ? 미할당 피크
          </span>
        </div>

        {/* Main Interactive Stacked XRD Chart */}
        <div className="rounded-[16px] border border-[#CBD5E1] bg-white p-2 shadow-sm">
          <PlotlyChart
            data={plotlyTraces}
            layout={plotlyLayout}
            config={{ responsive: true }}
            style={{ width: "100%", height: `${Math.max(420, activeSlots.length * 115 + 180)}px` }}
            onPointClick={(pt: any) => {
              if (pt?.customdata) {
                setSelectedPeakUid(String(pt.customdata));
              }
            }}
          />
        </div>

        {/* Selected Peak Highlight Banner */}
        {selectedPeakObj && (
          <div className="p-4 rounded-[14px] bg-[#EFF6FF] border-2 border-[#2563EB] space-y-2 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-[14px] font-bold text-[#1E3A8A] flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#2563EB]" />
                선택된 피크 정밀 대조: [{selectedPeakObj.slot_index}] {selectedPeakObj.sample_name} — {selectedPeakObj.peak_id}
              </div>
              <button
                type="button"
                onClick={() => setSelectedPeakUid(null)}
                className="text-[12px] text-[#475569] hover:text-[#0F172A] font-semibold cursor-pointer"
              >
                선택 해제 ✕
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 text-[12px]">
              <div className="bg-white p-2.5 rounded-[10px] border border-[#BFDBFE]">
                <span className="text-[#64748B] block text-[11px]">실측 위치 2θ</span>
                <strong className="text-[#0F172A] text-[13px]">{selectedPeakObj.two_theta}°</strong>
              </div>
              <div className="bg-white p-2.5 rounded-[10px] border border-[#BFDBFE]">
                <span className="text-[#64748B] block text-[11px]">참조 위치 / Δ2θ</span>
                <strong className="text-[#1D4ED8] text-[13px]">
                  {selectedPeakObj.ref_two_theta ? `${selectedPeakObj.ref_two_theta}° (${selectedPeakObj.delta_ref_deg > 0 ? "+" : ""}${selectedPeakObj.delta_ref_deg}°)` : "미정합"}
                </strong>
              </div>
              <div className="bg-white p-2.5 rounded-[10px] border border-[#BFDBFE]">
                <span className="text-[#64748B] block text-[11px]">면간격 d / FWHM</span>
                <strong className="text-[#0F172A] text-[13px]">
                  {selectedPeakObj.d_spacing_A ? `${selectedPeakObj.d_spacing_A} Å` : "-"} / {selectedPeakObj.fwhm_deg ?? "-"}°
                </strong>
              </div>
              <div className="bg-white p-2.5 rounded-[10px] border border-[#BFDBFE]">
                <span className="text-[#64748B] block text-[11px]">적분 면적 / 상대강도</span>
                <strong className="text-[#0F172A] text-[13px]">
                  {selectedPeakObj.area ?? "-"} ({selectedPeakObj.rel_intensity_pct}%)
                </strong>
              </div>
              <div className="bg-white p-2.5 rounded-[10px] border border-[#BFDBFE] sm:col-span-2">
                <span className="text-[#64748B] block text-[11px]">상 후보 및 밀러 지수 (hkl)</span>
                <strong className="text-[#1E40AF] text-[13px]">
                  {selectedPeakObj.marker_label} {selectedPeakObj.assigned_phase}{" "}
                  {selectedPeakObj.assigned_hkl ? `(${selectedPeakObj.assigned_hkl})` : "(밀러 지수 미부여)"}
                </strong>
                <span className="block text-[10px] text-[#64748B]">
                  참조: {selectedPeakObj.reference_source} ({selectedPeakObj.reference_id})
                </span>
              </div>
              <div className="bg-white p-2.5 rounded-[10px] border border-[#BFDBFE]">
                <span className="text-[#64748B] block text-[11px]">중첩 · 피팅 안정성</span>
                <strong
                  className={`text-[12px] ${
                    selectedPeakObj.is_overlapping || selectedPeakObj.fit_quality_badge !== "정상 피팅"
                      ? "text-[#D97706]"
                      : "text-[#059669]"
                  }`}
                >
                  {selectedPeakObj.fit_quality_badge}
                </strong>
              </div>
            </div>
          </div>
        )}

        {/* Replicate Deviation Summary (for Dopant Amount / Replicate Series) */}
        {replicateDeviations.length > 0 && (
          <div className="p-4 rounded-[14px] bg-[#F0FDF4] border border-[#BBF7D0] space-y-2">
            <h4 className="text-[13px] font-bold text-[#065F46]">
              📊 동일 함량·조건 반복 시편 간 편차 (Replicate Reproducibility Summary)
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[12px]">
              {replicateDeviations.map((rep: any, rIdx: number) => (
                <div key={rIdx} className="p-3 bg-white rounded-[10px] border border-[#A7F3D0] space-y-1">
                  <div className="font-bold text-[#047857]">
                    조건: {rep.condition_label} (반복 시편 N={rep.n_replicates}: {rep.specimen_names.join(", ")})
                  </div>
                  <div className="text-[#334155]">
                    • 주상 피크 위치 이동 평균±표준편차:{" "}
                    <strong>
                      {rep.shift_mean_deg !== null ? `${rep.shift_mean_deg > 0 ? "+" : ""}${rep.shift_mean_deg}° ± ${rep.shift_std_deg}°` : "-"}
                    </strong>
                  </div>
                  <div className="text-[#334155]">
                    • XRD Scherrer 결정자 크기 평균±표준편차:{" "}
                    <strong>
                      {rep.scherrer_mean_nm !== null ? `${rep.scherrer_mean_nm} ± ${rep.scherrer_std_nm} nm` : "-"}
                    </strong>
                  </div>
                  <div className="text-[#334155]">
                    • SEM D50 입자 크기 평균±표준편차:{" "}
                    <strong>
                      {rep.sem_d50_mean !== null ? `${rep.sem_d50_mean} ± ${rep.sem_d50_std} nm` : "해당 없음"}
                    </strong>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sub-Table 3.1: Cross-Specimen Reflection Evolution Table (Δ2θ, ΔFWHM, Out of Range vs Not Detected) */}
        <div className="space-y-2">
          <h4 className="text-[14px] font-bold text-[#1E293B]">
            3.1 시편 간 대응 반사별 피크 이동(Δ2θ) · 선폭(FWHM) 변화 및 출현 여부 비교 표
          </h4>
          <p className="text-[12px] text-[#64748B]">
            각 반사가 시편의 측정 각도 구간 밖인 경우 <strong>‘측정 범위 밖’</strong>으로, 측정 범위 안이나 피크가 검출되지 않은 경우 <strong>‘미검출 (측정 범위 내)’</strong>로 엄격히 구분합니다.
          </p>
          <div className="overflow-x-auto rounded-[12px] border border-[#E2E8F0]">
            <table className="w-full text-left border-collapse text-[12px]">
              <thead className="bg-[#F8FAFC] text-[#475569] border-b border-[#E2E8F0]">
                <tr>
                  <th className="py-2.5 px-3 font-bold">반사 마커 · 귀속 상 (hkl)</th>
                  <th className="py-2.5 px-3 font-bold">참조 2θ</th>
                  {activeSlots.map((sl: any) => (
                    <th key={sl.slot_id} className="py-2.5 px-3 font-bold">
                      [{sl.slot_index}] {sl.sample_name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {reflectionEvolution.map((row: any) => (
                  <tr key={row.reflection_id} className="hover:bg-[#F8FAFC]">
                    <td className="py-2.5 px-3 font-bold text-[#1E293B]">
                      {row.marker_label} {row.phase}{" "}
                      {row.hkl ? <span className="text-[#1D4ED8]">({row.hkl})</span> : <span className="text-[#64748B]">(미할당)</span>}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[#475569]">
                      {row.ref_two_theta ? `${row.ref_two_theta.toFixed(2)}°` : `~${row.anchor_two_theta.toFixed(2)}°`}
                    </td>
                    {(row.per_specimen || []).map((ps: any) => {
                      if (ps.status === "detected") {
                        const isSel = ps.peak_uid === selectedPeakUid;
                        return (
                          <td
                            key={ps.slot_id}
                            onClick={() => setSelectedPeakUid(ps.peak_uid)}
                            className={`py-2.5 px-3 cursor-pointer transition ${
                              isSel ? "bg-[#DBEAFE] font-bold" : "hover:bg-[#EFF6FF]"
                            }`}
                          >
                            <div className="font-mono text-[#0F172A]">
                              <strong>{ps.two_theta.toFixed(2)}°</strong>{" "}
                              <span className="text-[#1D4ED8] text-[11px]">
                                (Δ={ps.delta_vs_baseline_deg > 0 ? "+" : ""}
                                {ps.delta_vs_baseline_deg.toFixed(2)}°)
                              </span>
                            </div>
                            <div className="text-[11px] text-[#475569]">
                              FWHM: {ps.fwhm_deg ?? "-"}° · I: {ps.rel_intensity_pct}%
                            </div>
                            {ps.fit_quality_badge !== "정상 피팅" && (
                              <span className="inline-block mt-0.5 text-[10px] px-1.5 py-0.2 rounded bg-[#FEF3C7] text-[#B45309]">
                                {ps.fit_quality_badge}
                              </span>
                            )}
                          </td>
                        );
                      }
                      if (ps.status === "out_of_range") {
                        return (
                          <td key={ps.slot_id} className="py-2.5 px-3 bg-[#F1F5F9] text-[#64748B] italic">
                            <span className="px-2 py-0.5 rounded bg-[#E2E8F0] text-[#475569] text-[11px] font-semibold not-italic">
                              {ps.status_label}
                            </span>
                          </td>
                        );
                      }
                      return (
                        <td key={ps.slot_id} className="py-2.5 px-3 text-[#94A3B8]">
                          {ps.status_label}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Sub-Table 3.2: Primary & Secondary Phase Candidate Verification Table */}
        <div className="space-y-2">
          <h4 className="text-[14px] font-bold text-[#1E293B]">
            3.2 시편별 주상 및 이차상 후보 검증 근거 표 (참조 출처 · 다중 반사 정합 · 예상 강반사 누락 · 주상 중첩 검토)
          </h4>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {activeSlots.map((sl: any) => {
              const xrd = sl.selected_xrd;
              if (!xrd) return null;
              const prim = xrd.primary_phase;
              const secs: any[] = xrd.secondary_phase_evaluations || [];
              return (
                <div key={sl.slot_id} className="p-3.5 rounded-[14px] border border-[#E2E8F0] bg-[#F8FAFC] space-y-2 text-[12px]">
                  <div className="font-bold text-[#191F28] flex items-center justify-between">
                    <span>
                      [{sl.slot_index}] {sl.sample_name}
                    </span>
                    <span className="text-[11px] font-mono text-[#475569]">
                      λ = {xrd.wavelength_A} Å · 범위 {xrd.two_theta_min.toFixed(1)}°~{xrd.two_theta_max.toFixed(1)}°
                    </span>
                  </div>

                  {prim ? (
                    <div className="p-2.5 rounded-[10px] bg-white border border-[#BFDBFE] space-y-0.5">
                      <div className="font-bold text-[#1E40AF]">
                        ● 주상 (Primary): {prim.name} ({prim.formula}) [{prim.spacegroup}]
                      </div>
                      <div className="text-[11px] text-[#475569]">
                        참조 출처: {prim.source} (ID: <code>{prim.reference_id}</code>) · 평균 피크 이동 Δ2θ = {prim.shift_deg > 0 ? "+" : ""}
                        {prim.shift_deg}° · Scherrer D = {xrd.scherrer_mean_nm ? `${xrd.scherrer_mean_nm} nm` : "계산 불가"}
                      </div>
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-[10px] bg-[#FEF3C7] text-[#92400E]">
                      주상 후보 정합 미확정 (참조 패턴 부재 또는 신호 부족)
                    </div>
                  )}

                  {secs.length > 0 ? (
                    <div className="space-y-1.5">
                      {secs.slice(0, 2).map((sec: any, sIdx: number) => (
                        <div key={sIdx} className="p-2.5 rounded-[10px] bg-white border border-[#E2E8F0] space-y-1">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <strong className="text-[#0F172A]">
                              이차상 후보 검토: {sec.name} ({sec.formula}) [{sec.spacegroup}]
                            </strong>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                sec.verdict_code === "supported_multi_reflection"
                                  ? "bg-[#DCFCE7] text-[#15803D]"
                                  : "bg-[#FEF3C7] text-[#B45309]"
                              }`}
                            >
                              {sec.verdict_badge}
                            </span>
                          </div>
                          <div className="text-[11px] text-[#64748B]">
                            출처: {sec.source} (ID: <code>{sec.mp_id || sec.phase_id}</code>, λ={sec.wavelength_A} Å)
                          </div>
                          <p className="text-[11px] text-[#334155] leading-relaxed">{sec.scientific_rationale}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-[#64748B] pl-1">
                      주상으로 모든 주요 피크가 설명되며, 유의미한 이차상 후보가 검출되지 않았습니다.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Sub-Table 3.3: All Detected Peaks Table */}
        <details className="rounded-[14px] border border-[#E2E8F0] bg-[#F8FAFC] p-3.5" open>
          <summary className="text-[14px] font-bold text-[#1E293B] cursor-pointer">
            3.3 전체 검출 피크 상세 표 (위치 2θ · 적분 면적 · 상대 강도 · FWHM · d-spacing · 상 귀속 및 피팅 안정성) — 총 {allPeaksTable.length}개 피크
          </summary>
          <div className="mt-3 overflow-x-auto rounded-[10px] border border-[#CBD5E1] bg-white max-h-[360px] overflow-y-auto">
            <table className="w-full text-left border-collapse text-[12px]">
              <thead className="bg-[#F1F5F9] text-[#475569] sticky top-0">
                <tr>
                  <th className="py-2 px-2.5 font-bold">시편</th>
                  <th className="py-2 px-2.5 font-bold">피크 ID</th>
                  <th className="py-2 px-2.5 font-bold">실측 2θ (°)</th>
                  <th className="py-2 px-2.5 font-bold">참조 2θ / Δ2θ</th>
                  <th className="py-2 px-2.5 font-bold">d-spacing (Å)</th>
                  <th className="py-2 px-2.5 font-bold">상대 강도 (%)</th>
                  <th className="py-2 px-2.5 font-bold">적분 면적</th>
                  <th className="py-2 px-2.5 font-bold">FWHM (°)</th>
                  <th className="py-2 px-2.5 font-bold">상 귀속 및 (hkl)</th>
                  <th className="py-2 px-2.5 font-bold">피팅 안정성 / 중첩</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {allPeaksTable.map((pk: any) => {
                  const isSel = pk.peak_uid === selectedPeakUid;
                  return (
                    <tr
                      key={pk.peak_uid}
                      onClick={() => setSelectedPeakUid(pk.peak_uid)}
                      className={`cursor-pointer transition ${
                        isSel ? "bg-[#DBEAFE] font-bold" : "hover:bg-[#F8FAFC]"
                      }`}
                    >
                      <td className="py-2 px-2.5">
                        [{pk.slot_index}] {pk.sample_name.replace("[검증시리즈] ", "")}
                      </td>
                      <td className="py-2 px-2.5 font-mono">{pk.peak_id}</td>
                      <td className="py-2 px-2.5 font-mono font-bold text-[#0F172A]">{pk.two_theta.toFixed(3)}°</td>
                      <td className="py-2 px-2.5 font-mono text-[#1D4ED8]">
                        {pk.ref_two_theta ? `${pk.ref_two_theta.toFixed(3)}° (${pk.delta_ref_deg > 0 ? "+" : ""}${pk.delta_ref_deg.toFixed(3)}°)` : "-"}
                      </td>
                      <td className="py-2 px-2.5 font-mono">{pk.d_spacing_A ? `${pk.d_spacing_A} Å` : "-"}</td>
                      <td className="py-2 px-2.5 font-mono">{pk.rel_intensity_pct}%</td>
                      <td className="py-2 px-2.5 font-mono">{pk.area ?? "-"}</td>
                      <td className="py-2 px-2.5 font-mono">{pk.fwhm_deg ?? "-"}°</td>
                      <td className="py-2 px-2.5">
                        <span className="font-semibold text-[#1E40AF]">
                          {pk.marker_label} {pk.assigned_phase} {pk.assigned_hkl ? `(${pk.assigned_hkl})` : ""}
                        </span>
                      </td>
                      <td className="py-2 px-2.5">
                        <span
                          className={`text-[11px] px-1.5 py-0.5 rounded font-semibold ${
                            pk.fit_quality_badge === "정상 피팅"
                              ? "bg-[#ECFDF5] text-[#047857]"
                              : "bg-[#FEF3C7] text-[#B45309]"
                          }`}
                        >
                          {pk.fit_quality_badge}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      </div>

      {/* =====================================================================
          STAGE 4: 같은 순서의 SEM 병렬 이미지 및 시야(FOV) 비교 (대체 이미지 금지 원칙)
         ===================================================================== */}
      <div ref={semSectionRef} className="bg-white rounded-[20px] p-6 border border-[#E5E8EB] shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-[#E2E8F0] pb-3">
          <div>
            <span className="text-[11px] font-bold text-[#059669] uppercase tracking-wider">
              STEP 4 · PARALLEL SEM MICROSTRUCTURE COMPARISON (SYNCHRONIZED ORDER)
            </span>
            <h3 className="text-[17px] font-bold text-[#191F28] mt-0.5">
              4. XRD 비교 순서와 동기화된 SEM 병렬 원본 이미지 및 정량·정성 비교
            </h3>
            <p className="text-[12px] text-[#64748B] mt-0.5">
              각 시편의 실제 원본에서 생성된 이미지만 표시하며, 이미지가 없거나 로딩에 실패할 경우 다른 시편이나 예시 이미지로 채우지 않고 상태를 명시합니다.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {activeSlots.map((sl: any, idx: number) => {
            const sem = sl.selected_sem || {};
            const xrd = sl.selected_xrd;
            const semFiles: any[] = sl.available_sem_files || [];
            const viewMode = semViewModeBySlot[sl.slot_id] || "raw";
            const activeImgUrl =
              viewMode === "overlay" && sem.overlay_image_url ? sem.overlay_image_url : sem.raw_image_url;
            const fileErrKey = `${sl.project_id}_${sem.file_id}_${viewMode}`;
            const hasLoadError = Boolean(semLoadErrorByFile[fileErrKey]);
            const isHighlighted = highlightedSlotId === sl.slot_id;
            const qm = sem.quant_metrics;

            return (
              <div
                key={sl.slot_id}
                className={`rounded-[18px] border p-4 flex flex-col justify-between space-y-3.5 transition-all ${
                  isHighlighted
                    ? "border-[#059669] ring-4 ring-[#A7F3D0] bg-[#ECFDF5]/30"
                    : "border-[#CBD5E1] bg-[#F8FAFC]"
                }`}
              >
                <div className="space-y-3">
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span
                          className="px-2 py-0.5 rounded text-white text-[11px] font-bold"
                          style={{ backgroundColor: sl.color || "#059669" }}
                        >
                          열 #{sl.slot_index}
                        </span>
                        <span className="text-[14px] font-bold text-[#191F28]">{sl.sample_name}</span>
                      </div>
                      <div className="text-[11px] text-[#475569] mt-0.5">
                        {sl.condition_comparison?.summary_sentence}
                      </div>
                    </div>
                  </div>

                  {/* Multi-FOV Switcher directly on SEM card */}
                  {semFiles.length > 1 && (
                    <div className="flex items-center gap-1.5 bg-white p-2 rounded-[10px] border border-[#BFDBFE]">
                      <span className="text-[11px] font-bold text-[#1E40AF] shrink-0">대표 시야 전환:</span>
                      <select
                        value={sem.file_id || ""}
                        onChange={(e) => handleSelectSemFov(idx, e.target.value)}
                        className="w-full text-[11px] font-bold text-[#0F172A] bg-transparent cursor-pointer"
                      >
                        {semFiles.map((sf: any) => (
                          <option key={sf.file_id} value={sf.file_id}>
                            {sf.fov_label} ({sf.original_filename})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Image Container OR Explicit Status Box (NO fallback image!) */}
                  {sem.has_image && activeImgUrl && !hasLoadError ? (
                    <div className="space-y-2">
                      <div className="relative w-full h-56 rounded-[12px] overflow-hidden bg-[#0F172A] border border-[#CBD5E1] flex items-center justify-center">
                        <img
                          key={activeImgUrl}
                          src={activeImgUrl}
                          alt={`${sl.sample_name} - ${sem.fov_label}`}
                          className="w-full h-full object-contain"
                          onError={() =>
                            setSemLoadErrorByFile((prev) => ({
                              ...prev,
                              [fileErrKey]: true,
                            }))
                          }
                        />
                        <div className="absolute top-2 left-2 flex items-center gap-1">
                          <span className="px-2 py-0.5 rounded bg-black/75 text-white text-[10px] font-bold">
                            {sem.imaging_mode} · {sem.magnification}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-black/75 text-[#A7F3D0] text-[10px] font-mono">
                            {sem.fov_label}
                          </span>
                        </div>

                        <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                          {sem.overlay_image_url && (
                            <button
                              type="button"
                              onClick={() =>
                                setSemViewModeBySlot((prev) => ({
                                  ...prev,
                                  [sl.slot_id]: viewMode === "raw" ? "overlay" : "raw",
                                }))
                              }
                              className="px-2 py-1 rounded bg-black/75 hover:bg-black text-white text-[10px] font-bold cursor-pointer"
                            >
                              {viewMode === "raw" ? "분할 오버레이 보기" : "원본 영상 보기"}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setSemZoomModal({
                                url: activeImgUrl,
                                sampleName: sl.sample_name,
                                fovLabel: sem.fov_label,
                                filename: sem.original_filename,
                                scaleSummary: sem.scale_summary,
                              })
                            }
                            className="p-1.5 rounded bg-black/75 hover:bg-black text-white cursor-pointer"
                            title="원본 확대 보기"
                          >
                            <Maximize2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Verifiable File & Scale Caption */}
                      <div className="p-2.5 rounded-[10px] bg-white border border-[#E2E8F0] text-[11px] text-[#334155] space-y-0.5">
                        <div className="flex justify-between">
                          <span className="text-[#64748B]">원본 파일명:</span>
                          <strong className="font-mono text-[#0F172A]">{sem.original_filename}</strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#64748B]">선택 시야 / 식별자:</span>
                          <strong>
                            {sem.fov_label} (SHA: {(sem.sha256 || "").slice(0, 8)})
                          </strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#64748B]">스케일 상태:</span>
                          <strong className={sem.scale_calibrated ? "text-[#059669]" : "text-[#D97706]"}>
                            {sem.scale_summary}
                          </strong>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="w-full h-56 rounded-[12px] border-2 border-dashed border-[#CBD5E1] bg-white p-5 flex flex-col items-center justify-center text-center space-y-2">
                      <AlertTriangle className="w-8 h-8 text-[#D97706]" />
                      <div className="text-[13px] font-bold text-[#1E293B]">
                        {hasLoadError ? "SEM 원본 이미지 로딩 실패" : "업로드된 SEM 이미지 없음"}
                      </div>
                      <p className="text-[11px] text-[#64748B] leading-relaxed max-w-xs">
                        {hasLoadError
                          ? `파일(${sem.original_filename})을 불러오지 못했습니다. 다른 시편이나 예시 이미지로 대체하지 않고 상태를 표시합니다.`
                          : sem.status_message}
                      </p>
                    </div>
                  )}

                  {/* Strictly Separated Quantitative Metrics: SEM Particle/Grain Size vs XRD Crystallite Size */}
                  <div className="p-3 rounded-[12px] bg-white border border-[#E2E8F0] space-y-2 text-[12px]">
                    <div className="font-bold text-[#1E293B] border-b border-[#F1F5F9] pb-1">
                      정량 치수 비교 (SEM 입자 크기 vs XRD 결정자 크기 별개 관리)
                    </div>

                    {qm ? (
                      <div className="space-y-1 text-[11px] text-[#334155]">
                        <div className="flex justify-between">
                          <span className="text-[#047857] font-bold">SEM 실측 중앙 크기 (D50):</span>
                          <strong className="text-[#0F172A]">
                            {qm.d50} {qm.unit} (D10: {qm.d10} · D90: {qm.d90} {qm.unit})
                          </strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#64748B]">SEM 평균 ± 표준편차:</span>
                          <strong>
                            {qm.mean} ± {qm.std} {qm.unit}
                          </strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#64748B]">측정 근거 (시야 수 / 대상 수 / 파일):</span>
                          <strong>
                            시야 {qm.fov_count}개 · N={qm.sample_count_n}개 · {qm.used_image_filename}
                          </strong>
                        </div>
                      </div>
                    ) : (
                      <div className="text-[11px] text-[#B45309] bg-[#FFFBEB] p-2 rounded-[8px]">
                        <strong>SEM 크기 미산출:</strong>{" "}
                        {sem.has_image
                          ? "스케일 보정 또는 분할 품질이 확정되지 않아 근거 없는 크기 수치를 생성하지 않습니다."
                          : "SEM 이미지가 없어 정량 치수를 산출하지 않습니다."}
                      </div>
                    )}

                    <div className="pt-1.5 border-t border-[#F1F5F9] flex justify-between text-[11px]">
                      <span className="text-[#1D4ED8] font-bold">XRD Scherrer 결정자 크기 (별개 항목):</span>
                      <strong className="text-[#1E40AF]">
                        {xrd?.scherrer_mean_nm ? `${xrd.scherrer_mean_nm.toFixed(1)} nm (간섭 산란 도메인)` : "미산출"}
                      </strong>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* =====================================================================
          STAGE 5: XRD 단서 기반 동일 시편 SEM 4단계 교차 해석 (근거 링크 포함)
         ===================================================================== */}
      <div className="bg-white rounded-[20px] p-6 border border-[#E5E8EB] shadow-sm space-y-5">
        <div className="border-b border-[#E2E8F0] pb-3">
          <span className="text-[11px] font-bold text-[#7C3AED] uppercase tracking-wider">
            STEP 5 · 4-STAGE XRD-TO-SEM CROSS-INSTRUMENT INTERPRETATION & EVIDENCE LINKS
          </span>
          <h3 className="text-[17px] font-bold text-[#191F28] mt-0.5">
            5. XRD 단서를 이용한 동일 시편 SEM 4단계 정교화 해석 (관찰 사실 · 가능한 해석 · 추가 확인 구분)
          </h3>
          <p className="text-[12px] text-[#64748B] mt-0.5">
            XRD에서 얻은 단서 → 같은 시편의 SEM에서 확인할 특징 → 실제 관찰 → 해석의 한계 순서로 구성하며, 각 해석에서 해당 XRD 피크 구간과 SEM 원본 시야로 즉시 이동할 수 있습니다.
          </p>
        </div>

        <div className="space-y-4">
          {crossCards.map((card: any) => (
            <div
              key={card.slot_id}
              className="p-5 rounded-[16px] border border-[#CBD5E1] bg-[#F8FAFC] space-y-4"
            >
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-[#E2E8F0] pb-2.5">
                <div>
                  <span className="text-[15px] font-bold text-[#0F172A]">
                    [{card.slot_index}] {card.sample_name}
                  </span>
                  <span className="text-[12px] text-[#475569] ml-2">({card.condition_summary})</span>
                </div>

                {/* Clickable Evidence Links */}
                <div className="flex flex-wrap items-center gap-2">
                  {card.evidence_links?.xrd_link && (
                    <button
                      type="button"
                      onClick={() => handleJumpToXrdEvidence(card.evidence_links.xrd_link)}
                      className="px-2.5 py-1 rounded-[8px] bg-[#EFF6FF] hover:bg-[#DBEAFE] text-[#1D4ED8] border border-[#BFDBFE] text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Link2 className="w-3 h-3" />
                      {card.evidence_links.xrd_link.label}
                    </button>
                  )}
                  {card.evidence_links?.sem_link && (
                    <button
                      type="button"
                      onClick={() => handleJumpToSemEvidence(card.evidence_links.sem_link)}
                      className="px-2.5 py-1 rounded-[8px] bg-[#ECFDF5] hover:bg-[#D1FAE5] text-[#047857] border border-[#A7F3D0] text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Link2 className="w-3 h-3" />
                      {card.evidence_links.sem_link.label}
                    </button>
                  )}
                </div>
              </div>

              {/* 4-Step Flow Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-[12px]">
                <div className="p-3.5 rounded-[12px] bg-white border border-[#BFDBFE] space-y-1">
                  <span className="text-[11px] font-bold text-[#1D4ED8] block">① XRD에서 얻은 단서</span>
                  <p className="text-[#1E293B] leading-relaxed">{card.step1_xrd_clue}</p>
                </div>
                <div className="p-3.5 rounded-[12px] bg-white border border-[#DDD6FE] space-y-1">
                  <span className="text-[11px] font-bold text-[#6D28D9] block">② 같은 시편 SEM에서 확인할 특징</span>
                  <p className="text-[#1E293B] leading-relaxed">{card.step2_sem_target}</p>
                </div>
                <div className="p-3.5 rounded-[12px] bg-white border border-[#A7F3D0] space-y-1">
                  <span className="text-[11px] font-bold text-[#047857] block">③ 실제 SEM 관찰 결과</span>
                  <p className="text-[#1E293B] leading-relaxed">{card.step3_actual_observation}</p>
                </div>
                <div className="p-3.5 rounded-[12px] bg-white border border-[#FDE68A] space-y-1">
                  <span className="text-[11px] font-bold text-[#B45309] block">④ 해석의 한계 (체적 vs 국소 시야)</span>
                  <p className="text-[#475569] leading-relaxed">{card.step4_limitations}</p>
                </div>
              </div>

              {/* Strictly Separated Fact / Interpretation / Verification Badges */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 text-[12px]">
                <div className="p-3 rounded-[10px] bg-[#ECFDF5] border border-[#A7F3D0] space-y-1">
                  <strong className="text-[#065F46] block">✓ 확보된 관찰 사실 (Observed Facts)</strong>
                  <ul className="list-disc pl-4 space-y-0.5 text-[#064E3B] text-[11px]">
                    {(card.observed_facts || []).map((f: string, i: number) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </div>
                <div className="p-3 rounded-[10px] bg-[#EFF6FF] border border-[#BFDBFE] space-y-1">
                  <strong className="text-[#1E40AF] block">💡 가능한 해석 (Possible Interpretations)</strong>
                  <ul className="list-disc pl-4 space-y-0.5 text-[#1E3A8A] text-[11px]">
                    {(card.possible_interpretations || []).map((ip: string, i: number) => (
                      <li key={i}>{ip}</li>
                    ))}
                  </ul>
                </div>
                <div className="p-3 rounded-[10px] bg-[#FFFBEB] border border-[#FDE68A] space-y-1">
                  <strong className="text-[#92400E] block">🔬 추가 확인 방법 (Verification Methods)</strong>
                  <ul className="list-disc pl-4 space-y-0.5 text-[#78350F] text-[11px]">
                    {(card.verification_methods || []).map((vm: string, i: number) => (
                      <li key={i}>{vm}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* =====================================================================
          SEM HIGH-RES ZOOM MODAL
         ===================================================================== */}
      {semZoomModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-white rounded-[20px] max-w-3xl w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
              <div>
                <h3 className="text-[16px] font-bold text-[#191F28]">
                  {semZoomModal.sampleName} — {semZoomModal.fovLabel}
                </h3>
                <p className="text-[12px] text-[#64748B]">
                  원본 파일명: {semZoomModal.filename} · {semZoomModal.scaleSummary}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSemZoomModal(null)}
                className="p-1.5 rounded-full hover:bg-[#F1F5F9] text-[#64748B] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="rounded-[12px] overflow-hidden border border-[#CBD5E1] bg-[#0F172A] flex items-center justify-center max-h-[65vh] p-2">
              <img
                src={semZoomModal.url}
                alt={semZoomModal.fovLabel}
                className="max-w-full max-h-[60vh] object-contain"
              />
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          OPTIONAL: HALL / LFA TRANSPORT & LITERATURE RAG / ASSISTANT SECTION
         ===================================================================== */}
      <div className="bg-white rounded-[20px] p-6 border border-[#E5E8EB] shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flame className="w-5 h-5 text-[#F59E0B]" />
            <h3 className="text-[16px] font-bold text-[#191F28]">
              추가 물성(Hall 전하수송 · LFA 열수송) Wiedemann–Franz 분리 및 학술 문헌 RAG
            </h3>
          </div>
          <button
            type="button"
            onClick={() => {
              const next = !showTransportSection;
              setShowTransportSection(next);
              if (next && !result) {
                executeTransportIntegration();
              }
            }}
            className="px-3.5 py-1.5 rounded-[10px] bg-[#F8FAFC] hover:bg-[#EFF6FF] text-[#1D4ED8] border border-[#CBD5E1] text-[12px] font-bold cursor-pointer"
          >
            {showTransportSection ? "전하·열수송 패널 접기" : "Hall · LFA 수송 물성 및 문헌 RAG 열기"}
          </button>
        </div>

        {showTransportSection && (
          <div className="space-y-6 pt-3 border-t border-[#E2E8F0]">
            {result?.wiedemann_franz && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-5 bg-[#F8FAFC] rounded-[16px] p-4 border border-[#E2E8F0]">
                  <PlotlyChart
                    data={pieData}
                    layout={pieLayout}
                    config={{ responsive: true }}
                    style={{ width: "100%", height: "320px" }}
                  />
                </div>
                <div className="lg:col-span-7 bg-[#F8FAFC] rounded-[16px] p-4 border border-[#E2E8F0] space-y-3 text-[12px]">
                  <h4 className="text-[14px] font-bold text-[#191F28]">
                    Wiedemann–Franz 전자/격자 열전도 분리 및 문헌 근거
                  </h4>
                  <p className="text-[#334155]">
                    전체 열전도도 {result.wiedemann_franz.total_thermal_conductivity_W_mK} W/m·K 중 격자 포논 기여분(κ_L)은{" "}
                    <strong>
                      {result.wiedemann_franz.lattice_thermal_conductivity_W_mK} W/m·K ({result.wiedemann_franz.lattice_fraction_pct}%)
                    </strong>
                    , 전자 기여분(κ_e)은{" "}
                    <strong>
                      {result.wiedemann_franz.electronic_thermal_conductivity_W_mK} W/m·K ({result.wiedemann_franz.electronic_fraction_pct}%)
                    </strong>
                    입니다.
                  </p>
                  {litLoading ? (
                    <div className="text-[#64748B]">문헌 검색 중...</div>
                  ) : (
                    <div className="space-y-2">
                      {references.map((ref, idx) => (
                        <div key={idx} className="p-2.5 bg-white rounded-[10px] border border-[#E2E8F0] flex justify-between items-center gap-2">
                          <div>
                            <strong className="text-[#0F172A] block">{ref.title}</strong>
                            <span className="text-[11px] text-[#64748B]">
                              {ref.journal} ({ref.year}) · DOI: {ref.doi}
                            </span>
                          </div>
                          <a
                            href={`https://doi.org/${ref.doi}`}
                            target="_blank"
                            rel="noreferrer"
                            className="px-2.5 py-1 rounded bg-[#EFF6FF] text-[#1D4ED8] text-[11px] font-bold shrink-0"
                          >
                            DOI 원문
                          </a>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* =====================================================================
          INTERACTIVE GROUNDED RESEARCH ASSISTANT
         ===================================================================== */}
      <div className="bg-white rounded-[20px] p-6 border border-[#E5E8EB] shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-[#F1F5F9] pb-3">
          <div>
            <h3 className="text-[16px] font-bold text-[#191F28] flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-[#3182F6]" />
              근거 기반 대화형 연구 어시스턴트 (Vertex AI / Gemini + Materials Project DB)
            </h3>
            <p className="text-[12px] text-[#6B7684] mt-0.5">
              현재 비교 중인 시편들의 실험 조건, XRD 피크 이동, 이차상 판정 및 SEM 관찰 결과를 바탕으로 질문에 답변합니다.
            </p>
          </div>
        </div>

        <div className="bg-[#F8FAFC] rounded-[16px] p-4 border border-[#E2E8F0] max-h-[280px] overflow-y-auto space-y-3">
          {qaHistory.map((msg, i) => (
            <div key={i} className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-[14px] p-3.5 text-[13px] leading-relaxed ${
                  msg.sender === "user"
                    ? "bg-[#3182F6] text-white font-medium"
                    : "bg-white border border-[#E2E8F0] text-[#1E293B] shadow-sm"
                }`}
              >
                {msg.sender === "ai" && (
                  <div className="flex items-center justify-between gap-2 mb-1 pb-1 border-b border-[#F1F5F9] text-[11px]">
                    <span className="font-bold text-[#2563EB]">{msg.category}</span>
                    {msg.engine && <span className="text-[#64748B]">{msg.engine}</span>}
                  </div>
                )}
                <div className="whitespace-pre-line">{msg.text}</div>
              </div>
            </div>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendQa();
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={qaInput}
            onChange={(e) => setQaInput(e.target.value)}
            placeholder="시편 간 XRD 피크 이동 원인, 이차상 판정 기준, SEM 관찰 한계 등에 대해 질문해 보세요..."
            className="flex-1 px-4 py-2.5 rounded-[12px] border border-[#CBD5E1] text-[13px]"
          />
          <button
            type="submit"
            disabled={qaLoading || !qaInput.trim()}
            className="px-5 py-2.5 rounded-[12px] bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-[13px] font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {qaLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            질문 전송
          </button>
        </form>
      </div>
    </div>
  );
}
