import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Download,
  Edit3,
  FileSpreadsheet,
  FileText,
  Flame,
  HelpCircle,
  Info,
  Layers,
  Loader2,
  Maximize2,
  MessageSquare,
  Microscope,
  Play,
  RefreshCw,
  Send,
  Share2,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { api } from "../api";
import { PlotlyChart } from "./PlotlyChart";
import type {
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

function fmtNum(val: any, digits = 2, fallback = "-"): string {
  const n = typeof val === "number" ? val : Number(val);
  if (val === null || val === undefined || val === "" || !Number.isFinite(n)) {
    return fallback;
  }
  return n.toFixed(digits);
}

export function IntegratedAnalysisView({ activeProject, activeRun: _activeRun }: IntegratedAnalysisViewProps) {
  // =========================================================================
  // 1. Unified Specimen & Cross-Instrument State (XRD · SEM · UTM · Hall · LFA)
  // =========================================================================
  const [sampleId, setSampleId] = useState<string>("NbFeSb-SPS-01");
  const [materialName, setMaterialName] = useState<string>("NbFeSb half-Heusler");
  const [chemicalFormula, setChemicalFormula] = useState<string>("NbFeSb");
  const [dopant, setDopant] = useState<string>("Ti 5 at%");
  const [processCondition, setProcessCondition] = useState<string>("SPS 950 °C, 65 MPa, 10 min");
  const [tempK, setTempK] = useState<number>(300);
  const [isSampleDemoData, setIsSampleDemoData] = useState<boolean>(true);

  // XRD Structural Inputs
  const [hasXrd, setHasXrd] = useState<boolean>(true);
  const [primaryPhase, setPrimaryPhase] = useState<string>("NbFeSb (Half-Heusler)");
  const [spaceGroup, setSpaceGroup] = useState<string>("F-43m");
  const [crystalliteNm, setCrystalliteNm] = useState<number>(42.5);
  const [xrdSourceFile, setXrdSourceFile] = useState<string>("NbFeSb_SPS_xrd.csv (예시 데이터)");

  // SEM Microstructural Inputs
  const [hasSem, setHasSem] = useState<boolean>(true);
  const [grainSizeUm, setGrainSizeUm] = useState<number>(2.4);
  const [porosityPct, setPorosityPct] = useState<number>(1.2);
  const [semSourceFile, setSemSourceFile] = useState<string>("NbFeSb_SPS_FOV1_sem.png (예시 데이터)");

  // UTM Mechanical Inputs
  const [hasUtm, setHasUtm] = useState<boolean>(true);
  const [tensileStrengthMPa, setTensileStrengthMPa] = useState<number>(480.0);
  const [yieldStrengthMPa, setYieldStrengthMPa] = useState<number>(412.0);
  const [elasticModulusGPa, setElasticModulusGPa] = useState<number>(168.0);
  const [elongationPct, setElongationPct] = useState<number>(2.6);
  const [utmSourceFile, setUtmSourceFile] = useState<string>("benchmark_utm_tensile_sample.csv (예시 데이터)");

  // Hall Electrical Transport Inputs
  const [hasHall, setHasHall] = useState<boolean>(true);
  const [carrierConc, setCarrierConc] = useState<number>(4.2e20);
  const [hallMobility, setHallMobility] = useState<number>(22.0);
  const [elecCond, setElecCond] = useState<number>(1500.0);
  const [carrierType, setCarrierType] = useState<string>("p-type (Hole)");
  const [hallSourceFile, setHallSourceFile] = useState<string>("NbFeSb_Hall_300K.csv (예시 데이터)");

  // LFA Thermal Transport Inputs (Thermal conductivity requires density & Cp!)
  const [hasLfa, setHasLfa] = useState<boolean>(true);
  const [thermalDiff, setThermalDiff] = useState<number>(2.08);
  const [densityGcm3, setDensityGcm3] = useState<number | "">(8.25);
  const [cpJgK, setCpJgK] = useState<number | "">(0.28);
  const [lfaSourceFile, setLfaSourceFile] = useState<string>("NbFeSb_LFA_300K.csv (예시 데이터)");

  // Outdated result tracking: true whenever user edits inputs or toggles instruments after a run
  const [isResultOutdated, setIsResultOutdated] = useState<boolean>(false);
  const [showInputEditor, setShowInputEditor] = useState<boolean>(false);

  // Integrated Engine Output & Literature RAG State
  const [result, setResult] = useState<IntegratedAnalysisResult | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState<boolean>(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [litLoading, setLitLoading] = useState<boolean>(false);
  const [references, setReferences] = useState<LiteratureReference[]>([]);

  // =========================================================================
  // 2. Specimen / Series XRD & SEM Data State (Single Target or Optional Series)
  // =========================================================================
  const [sessionId, setSessionId] = useState<string | null>(() => readSessionIdFromUrl());
  const [baselineProjectId, setBaselineProjectId] = useState<string | null>(null);
  const [normMode, setNormMode] = useState<"max_100" | "raw">("max_100");
  const [offsetStep, setOffsetStep] = useState<number>(115);
  const [showRawAndBgOverlay, setShowRawAndBgOverlay] = useState<boolean>(false);
  const [twoThetaZoomWindow, setTwoThetaZoomWindow] = useState<[number, number] | null>(null);

  const [compLoading, setCompLoading] = useState<boolean>(false);
  const [compData, setCompData] = useState<any | null>(null);
  const [selectedPeakUid, setSelectedPeakUid] = useState<string | null>(null);
  const [highlightedSlotId] = useState<string | null>(null);
  const [semViewModeBySlot, setSemViewModeBySlot] = useState<Record<string, "raw" | "overlay">>({});
  const [semLoadErrorByFile, setSemLoadErrorByFile] = useState<Record<string, boolean>>({});
  const [semZoomModal, setSemZoomModal] = useState<{
    url: string;
    sampleName: string;
    fovLabel: string;
    filename: string;
    scaleSummary: string;
  } | null>(null);

  // Inline Metadata Editor State
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
  const xrdSectionRef = useRef<HTMLDetailsElement | null>(null);
  const semSectionRef = useRef<HTMLDetailsElement | null>(null);

  // Interactive Research Assistant State
  const [qaInput, setQaInput] = useState<string>("");
  const [qaLoading, setQaLoading] = useState<boolean>(false);
  const [qaHistory, setQaHistory] = useState<
    { sender: "user" | "ai"; text: string; category?: string; engine?: string }[]
  >([
    {
      sender: "ai",
      text: "안녕하세요! MatLens 대화형 연구 어시스턴트입니다. 현재 선택된 샘플의 결정구조(XRD), 기계적 강도(UTM), 전하 수송(Hall), 열전달(LFA) 및 미세조직(SEM) 연계 해석이나 후속 실험 설계에 대해 무엇이든 질문해 주세요.",
      category: "Grounded Research Assistant",
      engine: "MatLens 2.0 정밀 과학 지식 엔진",
    },
  ]);

  // =========================================================================
  // Pre-Run Input & Scientific Validation Checks
  // =========================================================================
  const preRunValidationWarnings = useMemo(() => {
    const warns: string[] = [];
    const activeCount = [hasXrd, hasSem, hasUtm, hasHall, hasLfa].filter(Boolean).length;
    if (activeCount === 0) {
      warns.push("선택된 측정 데이터가 없습니다. 최소 1개 이상의 측정 항목(XRD, SEM, UTM, Hall, LFA)을 선택해 주세요.");
    }
    if (hasLfa) {
      if (thermalDiff <= 0 || !Number.isFinite(thermalDiff)) {
        warns.push("LFA 열확산도(α)는 0보다 큰 유효 수치여야 합니다.");
      }
      if (densityGcm3 === "" || Number(densityGcm3) <= 0 || cpJgK === "" || Number(cpJgK) <= 0) {
        warns.push(
          "LFA 밀도(ρ) 또는 비열(Cp)이 입력되지 않았습니다. 열확산도(α)는 보고서에 표시되지만, 필수 값(ρ, Cp) 없이는 열전도도(κ = α·ρ·Cp) 및 Wiedemann–Franz 격자 열전도도를 임의로 계산하지 않습니다."
        );
      }
    }
    if (hasHall && elecCond <= 0) {
      warns.push("Hall 전기전도도(σ)가 0 이하이므로 전자 열전도도(κ_e) 계산이 제한됩니다.");
    }
    return warns;
  }, [hasXrd, hasSem, hasUtm, hasHall, hasLfa, thermalDiff, densityGcm3, cpJgK, elecCond]);

  // =========================================================================
  // Execute Holistic Cross-Instrument Analysis (XRD · SEM · UTM · Hall · LFA)
  // =========================================================================
  const executeIntegratedReport = useCallback(
    async (overrideParams?: {
      sId?: string;
      matName?: string;
      chemForm?: string;
      dop?: string;
      proc?: string;
      tK?: number;
      isDemo?: boolean;
      useXrd?: boolean;
      phase?: string;
      sg?: string;
      crystNm?: number;
      xrdSrc?: string;
      useSem?: boolean;
      gUm?: number;
      porPct?: number;
      semSrc?: string;
      useUtm?: boolean;
      uts?: number;
      ys?: number;
      eGpa?: number;
      elong?: number;
      utmSrc?: string;
      useHall?: boolean;
      nCm3?: number;
      mob?: number;
      sigma?: number;
      cType?: string;
      hallSrc?: string;
      useLfa?: boolean;
      alpha?: number;
      rho?: number | "";
      cp?: number | "";
      lfaSrc?: string;
    }) => {
      const effSampleId = overrideParams?.sId ?? sampleId;
      const effMatName = overrideParams?.matName ?? materialName;
      const effChemForm = overrideParams?.chemForm ?? chemicalFormula;
      const effDopant = overrideParams?.dop ?? dopant;
      const effProc = overrideParams?.proc ?? processCondition;
      const effTempK = overrideParams?.tK ?? tempK;
      const effIsDemo = overrideParams?.isDemo ?? isSampleDemoData;

      const effHasXrd = overrideParams?.useXrd ?? hasXrd;
      const effPhase = overrideParams?.phase ?? primaryPhase;
      const effSg = overrideParams?.sg ?? spaceGroup;
      const effCryst = overrideParams?.crystNm ?? crystalliteNm;
      const effXrdSrc = overrideParams?.xrdSrc ?? xrdSourceFile;

      const effHasSem = overrideParams?.useSem ?? hasSem;
      const effGrain = overrideParams?.gUm ?? grainSizeUm;
      const effPor = overrideParams?.porPct ?? porosityPct;
      const effSemSrc = overrideParams?.semSrc ?? semSourceFile;

      const effHasUtm = overrideParams?.useUtm ?? hasUtm;
      const effUts = overrideParams?.uts ?? tensileStrengthMPa;
      const effYs = overrideParams?.ys ?? yieldStrengthMPa;
      const effEGpa = overrideParams?.eGpa ?? elasticModulusGPa;
      const effElong = overrideParams?.elong ?? elongationPct;
      const effUtmSrc = overrideParams?.utmSrc ?? utmSourceFile;

      const effHasHall = overrideParams?.useHall ?? hasHall;
      const effNCm3 = overrideParams?.nCm3 ?? carrierConc;
      const effMob = overrideParams?.mob ?? hallMobility;
      const effSigma = overrideParams?.sigma ?? elecCond;
      const effCType = overrideParams?.cType ?? carrierType;
      const effHallSrc = overrideParams?.hallSrc ?? hallSourceFile;

      const effHasLfa = overrideParams?.useLfa ?? hasLfa;
      const effAlpha = overrideParams?.alpha ?? thermalDiff;
      const effRho = overrideParams?.rho !== undefined ? overrideParams.rho : densityGcm3;
      const effCp = overrideParams?.cp !== undefined ? overrideParams.cp : cpJgK;
      const effLfaSrc = overrideParams?.lfaSrc ?? lfaSourceFile;

      if (![effHasXrd, effHasSem, effHasUtm, effHasHall, effHasLfa].some(Boolean)) {
        setAnalysisError("최소 1개 이상의 측정 데이터 항목(XRD, SEM, UTM, Hall, LFA)을 선택해 주세요.");
        return;
      }

      setAnalysisLoading(true);
      setAnalysisError(null);
      try {
        const hasValidRhoCp =
          effRho !== "" && Number(effRho) > 0 && effCp !== "" && Number(effCp) > 0;
        const computedKappa = hasValidRhoCp
          ? Number((effAlpha * Number(effRho) * Number(effCp)).toFixed(3))
          : null;

        const resp = await api.runIntegratedAnalysis({
          sample_id: effSampleId,
          material_name: effMatName,
          temperature_K: effTempK,
          xrd_data: effHasXrd
            ? {
                sample_id: effSampleId,
                chemical_composition: effChemForm,
                process_condition: effProc,
                temperature_K: effTempK,
                primary_phase: effPhase,
                space_group: effSg,
                crystallite_size_nm: effCryst,
                source_file: effXrdSrc,
                is_sample_demo: effIsDemo,
              }
            : null,
          sem_data: effHasSem
            ? {
                sample_id: effSampleId,
                chemical_composition: effChemForm,
                process_condition: effProc,
                temperature_K: effTempK,
                grain_size_um: effGrain,
                porosity_pct: effPor,
                source_file: effSemSrc,
                is_sample_demo: effIsDemo,
              }
            : null,
          utm_data: effHasUtm
            ? {
                sample_id: effSampleId,
                chemical_composition: effChemForm,
                process_condition: effProc,
                temperature_K: effTempK,
                tensile_strength_MPa: effUts,
                yield_strength_MPa: effYs,
                elastic_modulus_GPa: effEGpa,
                elongation_pct: effElong,
                source_file: effUtmSrc,
                is_sample_demo: effIsDemo,
              }
            : null,
          hall_data: effHasHall
            ? {
                sample_id: effSampleId,
                chemical_composition: effChemForm,
                process_condition: effProc,
                temperature_K: effTempK,
                carrier_concentration_cm3: effNCm3,
                hall_mobility_cm2_Vs: effMob,
                electrical_conductivity_S_cm: effSigma,
                carrier_type: effCType,
                source_file: effHallSrc,
                is_sample_demo: effIsDemo,
              }
            : null,
          lfa_data: effHasLfa
            ? {
                sample_id: effSampleId,
                chemical_composition: effChemForm,
                process_condition: effProc,
                temperature_K: effTempK,
                thermal_diffusivity_mm2_s: effAlpha,
                thermal_conductivity_W_mK: computedKappa,
                density_g_cm3: effRho === "" ? null : Number(effRho),
                specific_heat_J_gK: effCp === "" ? null : Number(effCp),
                source_file: effLfaSrc,
                is_sample_demo: effIsDemo,
              }
            : null,
        });
        setResult(resp);
        setIsResultOutdated(false);

        setLitLoading(true);
        const litResp = await api.searchLiterature({
          material_name: effMatName,
          chemical_composition: effChemForm,
          dopant: effDopant,
          instrument: "XRD + SEM + UTM + Hall + LFA",
          temperature_C: Math.round(effTempK - 273.15),
          limit: 4,
        });
        setReferences(litResp.references || []);
        setLitLoading(false);
      } catch (err: any) {
        setAnalysisError(err?.message || "통합 리포트 생성 중 오류가 발생했습니다. 입력값을 확인한 후 다시 시도해 주세요.");
        setLitLoading(false);
      } finally {
        setAnalysisLoading(false);
      }
    },
    [
      sampleId,
      materialName,
      chemicalFormula,
      dopant,
      processCondition,
      tempK,
      isSampleDemoData,
      hasXrd,
      primaryPhase,
      spaceGroup,
      crystalliteNm,
      xrdSourceFile,
      hasSem,
      grainSizeUm,
      porosityPct,
      semSourceFile,
      hasUtm,
      tensileStrengthMPa,
      yieldStrengthMPa,
      elasticModulusGPa,
      elongationPct,
      utmSourceFile,
      hasHall,
      carrierConc,
      hallMobility,
      elecCond,
      carrierType,
      hallSourceFile,
      hasLfa,
      thermalDiff,
      densityGcm3,
      cpJgK,
      lfaSourceFile,
    ]
  );

  // =========================================================================
  // Load Specimen XRD & SEM Data (Single Specimen Default or Connected Series)
  // =========================================================================
  const loadSpecimensAndAnalyze = useCallback(
    async (
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
            question_type: "auto",
            baseline_project_id: nextBaselineId ?? null,
            auto_seed_if_empty: true,
          });
          baseIdToUse = candRes.baseline_project_id;
          // Single-target default: only require 1 specimen so comparison selection is NOT mandatory!
          if (baseIdToUse) {
            slotsToUse = [{ project_id: baseIdToUse }];
          } else if (candRes.recommended_project_ids?.length) {
            slotsToUse = [{ project_id: candRes.recommended_project_ids[0] }];
          } else {
            slotsToUse = [];
          }
        }

        const res = await api.analyzeComparison({
          session_id: sessionId,
          question_type: "auto",
          baseline_project_id: baseIdToUse ?? null,
          slots: slotsToUse || [],
          norm_mode: effNorm,
          offset_step: effOffset,
        });

        setCompData(res);
        setBaselineProjectId(res.baseline_project_id);
        if (res.session_id) {
          setSessionId(res.session_id);
          writeSessionIdToUrl(res.session_id);
        }
        setTwoThetaZoomWindow(null);

        // Sync first selected specimen's XRD & SEM metrics into the unified 5-instrument state
        const firstSlot = res.slots?.[0];
        if (firstSlot) {
          const xrdInfo = firstSlot.selected_xrd;
          const semInfo = firstSlot.selected_sem;
          const meta = firstSlot.experiment_meta || {};

          const nextSId = firstSlot.sample_name?.replace(/^\[.*?\]\s*/, "") || sampleId;
          const nextMat = meta.nominal_composition || meta.base_matrix || materialName;
          const nextForm = meta.base_matrix || chemicalFormula;
          const nextDop = meta.dopant_element
            ? `${meta.dopant_element} ${meta.dopant_amount ?? ""} ${meta.dopant_unit || ""}`.trim()
            : "무도핑 (0 at%)";
          const nextProc = `${meta.process_method || "열처리"} ${meta.process_temp_c ?? 500} °C, ${meta.process_time_h ?? 2} h (${meta.atmosphere || "Air"})`;
          const nextIsDemo = Boolean(firstSlot.is_synthetic_demo);

          const nextPhase = xrdInfo?.primary_phase
            ? `${xrdInfo.primary_phase.name} (${xrdInfo.primary_phase.formula})`
            : primaryPhase;
          const nextSg = xrdInfo?.primary_phase?.spacegroup || spaceGroup;
          const nextCryst = xrdInfo?.scherrer_mean_nm ?? crystalliteNm;
          const nextXrdSrc = xrdInfo?.original_filename || xrdSourceFile;

          const qm = semInfo?.quant_metrics;
          const nextGrain = qm?.d50
            ? qm.unit === "nm"
              ? Number((Number(qm.d50) / 1000).toFixed(3))
              : Number(qm.d50)
            : grainSizeUm;
          const nextSemSrc = semInfo?.original_filename || semSourceFile;

          setSampleId(nextSId);
          setMaterialName(nextMat);
          setChemicalFormula(nextForm);
          setDopant(nextDop);
          setProcessCondition(nextProc);
          setIsSampleDemoData(nextIsDemo);
          if (xrdInfo) {
            setPrimaryPhase(nextPhase);
            setSpaceGroup(nextSg);
            setCrystalliteNm(nextCryst);
            setXrdSourceFile(nextXrdSrc);
          }
          if (semInfo?.has_image) {
            setGrainSizeUm(nextGrain);
            setSemSourceFile(nextSemSrc);
          }

          await executeIntegratedReport({
            sId: nextSId,
            matName: nextMat,
            chemForm: nextForm,
            dop: nextDop,
            proc: nextProc,
            isDemo: nextIsDemo,
            phase: nextPhase,
            sg: nextSg,
            crystNm: nextCryst,
            xrdSrc: nextXrdSrc,
            gUm: nextGrain,
            semSrc: nextSemSrc,
          });
        } else {
          await executeIntegratedReport();
        }
      } catch (err: any) {
        console.error("Specimen load error:", err);
        await executeIntegratedReport();
      } finally {
        setCompLoading(false);
      }
    },
    [
      normMode,
      offsetStep,
      sessionId,
      sampleId,
      materialName,
      chemicalFormula,
      primaryPhase,
      spaceGroup,
      crystalliteNm,
      xrdSourceFile,
      grainSizeUm,
      semSourceFile,
      executeIntegratedReport,
    ]
  );

  // Sync measurements saved from XRD·SEM, UTM, Hall, and LFA tabs in localStorage
  const handleSyncFromOtherTabs = async () => {
    let updatedAny = false;
    let nextSId = sampleId;
    let nextMat = materialName;
    let nextForm = chemicalFormula;
    let nextIsDemo = false;

    let nextUseXrd = hasXrd;
    let nextCryst = crystalliteNm;
    let nextSg = spaceGroup;
    let nextXrdSrc = xrdSourceFile;

    let nextUseSem = hasSem;
    let nextGrain = grainSizeUm;
    let nextPor = porosityPct;
    let nextSemSrc = semSourceFile;

    let nextUseUtm = hasUtm;
    let nextUts = tensileStrengthMPa;
    let nextYs = yieldStrengthMPa;
    let nextEGpa = elasticModulusGPa;
    let nextElong = elongationPct;
    let nextUtmSrc = utmSourceFile;

    let nextUseHall = hasHall;
    let nextNCm3 = carrierConc;
    let nextMob = hallMobility;
    let nextSigma = elecCond;
    let nextCType = carrierType;
    let nextHallSrc = hallSourceFile;

    let nextUseLfa = hasLfa;
    let nextAlpha = thermalDiff;
    let nextRho: number | "" = densityGcm3;
    let nextCp: number | "" = cpJgK;
    let nextLfaSrc = lfaSourceFile;

    try {
      const rawXrd = localStorage.getItem("matlens_shared_xrd_data");
      if (rawXrd) {
        const d = JSON.parse(rawXrd);
        nextUseXrd = true;
        if (d.crystallite_size_nm) nextCryst = Number(d.crystallite_size_nm);
        if (d.space_group) nextSg = d.space_group;
        if (d.sample_id) nextSId = d.sample_id;
        if (d.formula) {
          nextForm = d.formula;
          nextMat = d.formula;
        }
        nextXrdSrc = "XRD 탭 측정 결과 연동";
        updatedAny = true;
      }
      const rawSem = localStorage.getItem("matlens_shared_sem_data");
      if (rawSem) {
        const d = JSON.parse(rawSem);
        nextUseSem = true;
        if (d.grain_size_um) nextGrain = Number(d.grain_size_um);
        if (d.porosity_pct !== undefined) nextPor = Number(d.porosity_pct);
        nextSemSrc = "SEM 탭 측정 결과 연동";
        updatedAny = true;
      }
      const rawUtm = localStorage.getItem("matlens_shared_utm_data");
      if (rawUtm) {
        const d = JSON.parse(rawUtm);
        nextUseUtm = true;
        if (d.tensile_strength_MPa != null) nextUts = Number(d.tensile_strength_MPa);
        if (d.yield_strength_MPa != null) nextYs = Number(d.yield_strength_MPa);
        if (d.elastic_modulus_GPa != null) nextEGpa = Number(d.elastic_modulus_GPa);
        if (d.elongation_pct != null) nextElong = Number(d.elongation_pct);
        if (d.source_file) nextUtmSrc = `${d.source_file} (UTM 탭 연동)`;
        updatedAny = true;
      }
      const rawHall = localStorage.getItem("matlens_shared_hall_data");
      if (rawHall) {
        const d = JSON.parse(rawHall);
        nextUseHall = true;
        if (d.carrier_concentration_cm3 != null) nextNCm3 = Number(d.carrier_concentration_cm3);
        if (d.hall_mobility_cm2_Vs != null) nextMob = Number(d.hall_mobility_cm2_Vs);
        if (d.electrical_conductivity_S_cm != null) nextSigma = Number(d.electrical_conductivity_S_cm);
        if (d.carrier_type) nextCType = d.carrier_type;
        nextHallSrc = `${d.sample_id || "Hall"} (Hall 탭 연동)`;
        updatedAny = true;
      }
      const rawLfa = localStorage.getItem("matlens_shared_lfa_data");
      if (rawLfa) {
        const d = JSON.parse(rawLfa);
        nextUseLfa = true;
        if (d.thermal_diffusivity_mm2_s != null) nextAlpha = Number(d.thermal_diffusivity_mm2_s);
        nextRho = d.density_g_cm3 != null ? Number(d.density_g_cm3) : "";
        nextCp = d.specific_heat_J_gK != null ? Number(d.specific_heat_J_gK) : "";
        nextLfaSrc = `${d.sample_id || "LFA"} (LFA 탭 연동)`;
        updatedAny = true;
      }
    } catch {
      // ignore parse errors
    }

    if (!updatedAny) {
      nextIsDemo = true;
    }

    setSampleId(nextSId);
    setMaterialName(nextMat);
    setChemicalFormula(nextForm);
    setIsSampleDemoData(nextIsDemo);

    setHasXrd(nextUseXrd);
    setCrystalliteNm(nextCryst);
    setSpaceGroup(nextSg);
    setXrdSourceFile(nextXrdSrc);

    setHasSem(nextUseSem);
    setGrainSizeUm(nextGrain);
    setPorosityPct(nextPor);
    setSemSourceFile(nextSemSrc);

    setHasUtm(nextUseUtm);
    setTensileStrengthMPa(nextUts);
    setYieldStrengthMPa(nextYs);
    setElasticModulusGPa(nextEGpa);
    setElongationPct(nextElong);
    setUtmSourceFile(nextUtmSrc);

    setHasHall(nextUseHall);
    setCarrierConc(nextNCm3);
    setHallMobility(nextMob);
    setElecCond(nextSigma);
    setCarrierType(nextCType);
    setHallSourceFile(nextHallSrc);

    setHasLfa(nextUseLfa);
    setThermalDiff(nextAlpha);
    setDensityGcm3(nextRho);
    setCpJgK(nextCp);
    setLfaSourceFile(nextLfaSrc);

    await executeIntegratedReport({
      sId: nextSId,
      matName: nextMat,
      chemForm: nextForm,
      isDemo: nextIsDemo,
      useXrd: nextUseXrd,
      crystNm: nextCryst,
      sg: nextSg,
      xrdSrc: nextXrdSrc,
      useSem: nextUseSem,
      gUm: nextGrain,
      porPct: nextPor,
      semSrc: nextSemSrc,
      useUtm: nextUseUtm,
      uts: nextUts,
      ys: nextYs,
      eGpa: nextEGpa,
      elong: nextElong,
      utmSrc: nextUtmSrc,
      useHall: nextUseHall,
      nCm3: nextNCm3,
      mob: nextMob,
      sigma: nextSigma,
      cType: nextCType,
      hallSrc: nextHallSrc,
      useLfa: nextUseLfa,
      alpha: nextAlpha,
      rho: nextRho,
      cp: nextCp,
      lfaSrc: nextLfaSrc,
    });
  };

  // Load 1 Unified Representative Benchmark Sample (Requirement 4)
  const handleLoadSingleRepresentativeSample = async () => {
    const repSample = {
      sId: "TiO2-500C (시편 A: 500°C, 2h, Air)",
      matName: "TiO2 (Anatase 나노결정 산화물)",
      chemForm: "TiO2",
      dop: "무도핑 (0 at%)",
      proc: "하소(Calcination) 500 °C, 2 h, Air",
      tK: 300,
      isDemo: true,
      useXrd: true,
      phase: "Anatase (TiO2)",
      sg: "I4_1/amd",
      crystNm: 21.3,
      xrdSrc: "TiO2_500C_2h_Air_xrd.csv (예시 데이터)",
      useSem: true,
      gUm: 0.038,
      porPct: 1.4,
      semSrc: "TiO2_500C_FOV_A1_50kX.png (예시 데이터)",
      useUtm: true,
      uts: 385.0,
      ys: 340.0,
      eGpa: 182.0,
      elong: 1.8,
      utmSrc: "TiO2_Ceramic_UTM_Test.csv (예시 데이터)",
      useHall: true,
      nCm3: 2.4e19,
      mob: 14.5,
      sigma: 55.8,
      cType: "n-type (Electron)",
      hallSrc: "TiO2_Hall_300K.csv (예시 데이터)",
      useLfa: true,
      alpha: 2.45,
      rho: 3.84 as number | "",
      cp: 0.69 as number | "",
      lfaSrc: "TiO2_LFA_300K.csv (예시 데이터)",
    };

    setSampleId(repSample.sId);
    setMaterialName(repSample.matName);
    setChemicalFormula(repSample.chemForm);
    setDopant(repSample.dop);
    setProcessCondition(repSample.proc);
    setTempK(repSample.tK);
    setIsSampleDemoData(true);

    setHasXrd(true);
    setPrimaryPhase(repSample.phase);
    setSpaceGroup(repSample.sg);
    setCrystalliteNm(repSample.crystNm);
    setXrdSourceFile(repSample.xrdSrc);

    setHasSem(true);
    setGrainSizeUm(repSample.gUm);
    setPorosityPct(repSample.porPct);
    setSemSourceFile(repSample.semSrc);

    setHasUtm(true);
    setTensileStrengthMPa(repSample.uts);
    setYieldStrengthMPa(repSample.ys);
    setElasticModulusGPa(repSample.eGpa);
    setElongationPct(repSample.elong);
    setUtmSourceFile(repSample.utmSrc);

    setHasHall(true);
    setCarrierConc(repSample.nCm3);
    setHallMobility(repSample.mob);
    setElecCond(repSample.sigma);
    setCarrierType(repSample.cType);
    setHallSourceFile(repSample.hallSrc);

    setHasLfa(true);
    setThermalDiff(repSample.alpha);
    setDensityGcm3(repSample.rho);
    setCpJgK(repSample.cp);
    setLfaSourceFile(repSample.lfaSrc);

    await loadSpecimensAndAnalyze(null, undefined);
    await executeIntegratedReport(repSample);
  };

  // Initial mount: restore existing session or initialize single representative sample
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
            setBaselineProjectId(restored.baseline_project_id);
            setSessionId(restored.session_id);
            if (restored.normalization_info?.mode) {
              setNormMode(restored.normalization_info.mode);
            }
            if (restored.normalization_info?.offset_step) {
              setOffsetStep(restored.normalization_info.offset_step);
            }
            setCompLoading(false);
            await executeIntegratedReport();
            return;
          }
        } catch {
          // If session expired or DB reset, fall through to fresh load
        }
      }
      if (mounted) {
        await loadSpecimensAndAnalyze(activeProject?.id || null);
      }
    };
    initSession();
    return () => {
      mounted = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // =========================================================================
  // Specimen Slot Manipulation Handlers (Single Target or Optional Series)
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
    await loadSpecimensAndAnalyze(baselineProjectId, next);
  };

  const handleRemoveSlot = async (index: number) => {
    const next = currentSlotsInput.filter((_: any, i: number) => i !== index);
    await loadSpecimensAndAnalyze(baselineProjectId, next);
  };

  const handleToggleCandidateInSlots = async (projectId: string) => {
    const existsIdx = currentSlotsInput.findIndex((s: any) => s.project_id === projectId);
    let next;
    if (existsIdx >= 0) {
      if (currentSlotsInput.length <= 1) return; // Keep at least 1 target specimen
      next = currentSlotsInput.filter((_: any, i: number) => i !== existsIdx);
    } else {
      next = [...currentSlotsInput, { project_id: projectId }];
    }
    await loadSpecimensAndAnalyze(baselineProjectId, next);
  };

  const handleSelectSemFov = async (slotIndex: number, newSemFileId: string) => {
    const next = currentSlotsInput.map((s: any, idx: number) =>
      idx === slotIndex ? { ...s, sem_file_id: newSemFileId, sem_run_id: null } : s
    );
    await loadSpecimensAndAnalyze(baselineProjectId, next);
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
        change_summary: `시편 실험 조건 메타데이터 보완 (${editingMetaForm.base_matrix}, ${editingMetaForm.process_temp_c ?? "-"} °C)`,
      });
      setEditingMetaProjectId(null);
      await loadSpecimensAndAnalyze(baselineProjectId, currentSlotsInput);
    } catch (err: any) {
      alert("메타데이터 저장 실패: " + (err.message || err));
    } finally {
      setSavingMeta(false);
    }
  };

  // =========================================================================
  // Build Interactive XRD Plotly Traces & Pie Chart
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

      traces.push({
        x: tr.two_theta,
        y: tr.stacked_intensity,
        type: "scatter",
        mode: "lines",
        name: tr.legend_label,
        line: { color: tr.color, width: 2.2 },
        hovertemplate: `<b>${tr.sample_name}</b><br>2θ: %{x:.3f}°<br>강도: %{y:.1f}<extra></extra>`,
      });

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
          textfont: { size: 10.5, family: "Pretendard, sans-serif", color: "#1E293B" },
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
        text:
          stackedList.length > 1
            ? "연결 시리즈 시편 세로 오프셋(Stacked) XRD 회절 패턴 비교"
            : `선택 시편(${sampleId}) XRD 회절 패턴 및 결정상 피크 매칭`,
        font: { size: 13.5, family: "Pretendard, sans-serif" },
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
              ? stackedList.length > 1
                ? `정규화 강도 (Max=100, 오프셋 +${offsetStep})`
                : "정규화 상대 강도 (Max=100%)"
              : "배경 보정 원시 강도 (Counts)",
        },
        gridcolor: "#F1F5F9",
      },
      legend: {
        orientation: "h" as const,
        y: -0.2,
        x: 0.5,
        xanchor: "center" as const,
        font: { size: 11, family: "Pretendard, sans-serif" },
      },
      shapes,
      margin: { t: 42, r: 20, b: 64, l: 56 },
      paper_bgcolor: "#FFFFFF",
      plot_bgcolor: "#FFFFFF",
      autosize: true,
    };

    return { plotlyTraces: traces, plotlyLayout: layout };
  }, [compData, normMode, offsetStep, sampleId, selectedPeakObj, selectedPeakUid, showRawAndBgOverlay, twoThetaZoomWindow]);

  const handleSendQa = async (queryText?: string) => {
    const q = (queryText || qaInput).trim();
    if (!q || qaLoading) return;
    setQaInput("");
    setQaHistory((prev) => [...prev, { sender: "user", text: q }]);
    setQaLoading(true);

    try {
      const resp = await api.chatAssistant({
        message: q,
        material_name: materialName,
        chemical_composition: chemicalFormula,
        instrument: (result?.instruments_included || []).join(" + ") || "XRD + SEM + UTM + Hall + LFA",
        calculated_properties: {
          sample_id: sampleId,
          process_condition: processCondition,
          temperature_K: tempK,
          key_metrics: result?.key_metrics_table || [],
          wiedemann_franz: result?.wiedemann_franz || null,
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
          marker: { colors: ["#2563EB", "#F59E0B"] },
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
      text: "Wiedemann–Franz 열전도도 분리 (κ = κ_e + κ_L)",
      font: { size: 13.5, family: "Pretendard, sans-serif" },
      y: 0.96,
    },
    legend: {
      orientation: "h" as const,
      y: -0.15,
      x: 0.5,
      xanchor: "center" as const,
      font: { size: 11.5, family: "Pretendard, sans-serif" },
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
  const replicateDeviations: any[] = compData?.replicate_deviations || [];

  const execSummaryItems = result?.executive_summary_items || [];
  const instAvailability = result?.instrument_availability || [];
  const keyMetrics = result?.key_metrics_table || [];
  const crossCorrelations = result?.cross_correlations || [];
  const limitsAndActions = result?.limitations_and_next_actions;
  const linkageInfo = result?.linkage_assessment;

  return (
    <div className="space-y-6 text-[#191F28]">
      {/* =====================================================================
          TOP CONTROL BAR: 현재 분석 대상 · 데이터 출처 · 액션 및 다운로드
         ===================================================================== */}
      <div className="bg-white rounded-[20px] p-5 sm:p-6 border border-[#E5E8EB] shadow-sm space-y-4">
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#EFF6FF] text-[#1D4ED8] text-[12px] font-bold border border-[#BFDBFE]">
                <Share2 className="w-3.5 h-3.5" />
                다종 측정 데이터(XRD · UTM · Hall · LFA · SEM) 통합 분석 리포트
              </span>
              <span
                className={`px-2.5 py-1 rounded-full text-[12px] font-bold border ${
                  isSampleDemoData
                    ? "bg-[#FEF3C7] text-[#B45309] border-[#FDE68A]"
                    : "bg-[#DCFCE7] text-[#15803D] border-[#BBF7D0]"
                }`}
              >
                {isSampleDemoData ? "🧪 예시/검증 데이터 사용 중" : "✓ 실제 측정 데이터 연동됨"}
              </span>
              <span className="px-2.5 py-1 rounded-full bg-[#F1F5F9] text-[#334155] text-[12px] font-semibold border border-[#CBD5E1]">
                {activeSlots.length <= 1 ? "단일 샘플 분석 (N=1)" : `연결 시리즈 분석 (시편 ${activeSlots.length}종)`}
              </span>
            </div>

            <h2 className="text-[20px] sm:text-[23px] font-bold text-[#191F28] leading-snug pt-0.5">
              분석 대상: {sampleId} <span className="text-[#2563EB] font-semibold">({materialName})</span>
            </h2>
            <p className="text-[13.5px] text-[#4E5968] leading-relaxed">
              공정 조건: <strong>{processCondition}</strong> · 측정 온도: <strong>{tempK} K ({Math.round(tempK - 273.15)} °C)</strong> ·
              활성 측정 항목:{" "}
              <strong className="text-[#1D4ED8]">
                {(result?.instruments_included || []).join(" · ") || "선택 필요"}
              </strong>
            </p>
          </div>

          {/* Primary Action & Export Buttons */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={analysisLoading || compLoading}
              onClick={() => executeIntegratedReport()}
              className="px-4 py-2.5 rounded-[12px] bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-[13px] font-bold transition flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
            >
              {analysisLoading || compLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              <span>{isResultOutdated ? "변경된 데이터로 리포트 갱신" : "통합 리포트 실행"}</span>
            </button>

            <button
              type="button"
              disabled={analysisLoading || compLoading}
              onClick={handleSyncFromOtherTabs}
              className="px-3.5 py-2.5 rounded-[12px] bg-[#EFF6FF] hover:bg-[#DBEAFE] text-[#1D4ED8] border border-[#BFDBFE] text-[12.5px] font-bold transition flex items-center gap-1.5 cursor-pointer"
              title="XRD·SEM, UTM, Hall, LFA 탭에서 최근 분석한 측정 데이터를 불러와 연결합니다"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>측정 탭 데이터 동기화</span>
            </button>

            <button
              type="button"
              disabled={analysisLoading || compLoading}
              onClick={handleLoadSingleRepresentativeSample}
              className="px-3.5 py-2.5 rounded-[12px] bg-[#F8FAFC] hover:bg-[#F1F5F9] text-[#334155] border border-[#CBD5E1] text-[12.5px] font-semibold transition flex items-center gap-1.5 cursor-pointer"
              title="단일 대표 검증 샘플(XRD·SEM·UTM·Hall·LFA 포함)로 전체 흐름을 즉시 확인합니다"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#D97706]" />
              <span>대표 검증 샘플(1종) 로드</span>
            </button>

            {sessionId && (
              <>
                <a
                  href={api.comparisonPdfUrl(sessionId)}
                  download
                  className="px-3.5 py-2.5 rounded-[12px] bg-[#1E293B] hover:bg-[#0F172A] text-white text-[12.5px] font-bold transition flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>PDF 보고서</span>
                </a>
                <a
                  href={api.comparisonPeaksCsvUrl(sessionId)}
                  download
                  className="px-3 py-2.5 rounded-[12px] bg-[#F0FDF4] hover:bg-[#DCFCE7] text-[#15803D] border border-[#BBF7D0] text-[12px] font-bold transition flex items-center gap-1"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>CSV</span>
                </a>
                <a
                  href={api.comparisonJsonUrl(sessionId)}
                  download
                  className="px-3 py-2.5 rounded-[12px] bg-[#F8FAFC] hover:bg-[#E2E8F0] text-[#334155] border border-[#CBD5E1] text-[12px] font-bold transition flex items-center gap-1"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>JSON</span>
                </a>
              </>
            )}
          </div>
        </div>

        {/* Status Banners: Loading / Error / Outdated Result / Pre-Run Validation */}
        {(analysisLoading || compLoading) && (
          <div className="p-3.5 rounded-[12px] bg-[#EFF6FF] border border-[#BFDBFE] text-[#1E40AF] text-[13px] flex items-center gap-2.5">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            <span>선택된 시편 및 측정 데이터를 기반으로 다종 기기 통합 리포트를 계산하고 있습니다...</span>
          </div>
        )}

        {analysisError && (
          <div className="p-4 rounded-[12px] bg-[#FEF2F2] border border-[#FECACA] text-[#DC2626] text-[13px] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{analysisError}</span>
            </div>
            <button
              type="button"
              onClick={() => executeIntegratedReport()}
              className="px-3 py-1 rounded-[8px] bg-[#DC2626] text-white text-[12px] font-bold shrink-0 cursor-pointer"
            >
              다시 시도
            </button>
          </div>
        )}

        {isResultOutdated && !analysisLoading && (
          <div className="p-3.5 rounded-[12px] bg-[#FFFBEB] border border-[#FDE68A] text-[#92400E] text-[13px] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-[#D97706] shrink-0" />
              <span>
                <strong>기존 결과 만료 안내:</strong> 측정 데이터 선택 또는 수치 입력값이 변경되어 현재 화면의 리포트가 이전 데이터 기준입니다.
              </span>
            </div>
            <button
              type="button"
              onClick={() => executeIntegratedReport()}
              className="px-3 py-1.5 rounded-[8px] bg-[#D97706] hover:bg-[#B45309] text-white text-[12px] font-bold cursor-pointer"
            >
              지금 리포트 갱신하기
            </button>
          </div>
        )}

        {preRunValidationWarnings.length > 0 && (
          <div className="p-3.5 rounded-[12px] bg-[#FEF3C7]/70 border border-[#FDE68A] text-[#92400E] text-[12.5px] space-y-1">
            <div className="font-bold flex items-center gap-1.5">
              <Info className="w-4 h-4 text-[#D97706]" />
              <span>입력 데이터 및 필수값 사전 확인 안내</span>
            </div>
            <ul className="list-disc pl-5 space-y-0.5 leading-relaxed">
              {preRunValidationWarnings.map((w, idx) => (
                <li key={idx}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* =====================================================================
          SECTION 1: 핵심 요약 (Key Findings & Cautions — 3~5 Concise Items)
         ===================================================================== */}
      <section className="bg-white rounded-[20px] p-5 sm:p-6 border border-[#E5E8EB] shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
          <div>
            <span className="text-[11px] font-bold text-[#2563EB] uppercase tracking-wider">
              SECTION 1 · EXECUTIVE SUMMARY
            </span>
            <h3 className="text-[18px] font-bold text-[#191F28] mt-0.5">
              1. 핵심 요약 (주요 결과 및 주의사항)
            </h3>
          </div>
          <span className="text-[12px] text-[#64748B] font-medium">
            핵심 결과 → 근거 → 해석 → 다음 행동 순서로 구성됨
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {execSummaryItems.map((item, idx) => {
            const isCaution = item.type === "caution";
            return (
              <div
                key={idx}
                className={`p-4 rounded-[14px] border flex items-start gap-3 ${
                  isCaution
                    ? "bg-[#FFFBEB] border-[#FDE68A] text-[#92400E]"
                    : "bg-[#F8FAFC] border-[#E2E8F0] text-[#1E293B]"
                }`}
              >
                {isCaution ? (
                  <AlertTriangle className="w-5 h-5 text-[#D97706] shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 text-[#2563EB] shrink-0 mt-0.5" />
                )}
                <div className="space-y-1 text-[14px] leading-relaxed">
                  <span
                    className={`inline-block text-[11.5px] font-bold px-2 py-0.5 rounded ${
                      isCaution ? "bg-[#FEF3C7] text-[#B45309]" : "bg-[#DBEAFE] text-[#1E40AF]"
                    }`}
                  >
                    {idx + 1}. {item.badge}
                  </span>
                  <p className="font-medium">{item.text}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* =====================================================================
          SECTION 2: 측정 데이터 현황 및 시료 연결 기준 (XRD · UTM · Hall · LFA · SEM)
         ===================================================================== */}
      <section className="bg-white rounded-[20px] p-5 sm:p-6 border border-[#E5E8EB] shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-[#E2E8F0] pb-3">
          <div>
            <span className="text-[11px] font-bold text-[#059669] uppercase tracking-wider">
              SECTION 2 · MEASUREMENT DATA STATUS & LINKAGE CRITERIA
            </span>
            <h3 className="text-[18px] font-bold text-[#191F28] mt-0.5">
              2. 측정 데이터 현황 및 시료 연결 기준 (XRD · UTM · Hall · LFA · SEM)
            </h3>
            <p className="text-[13px] text-[#64748B] mt-0.5">
              네 종류 이상의 데이터가 모두 없더라도 확보된 데이터 범위 내에서 리포트를 생성하며, 누락된 항목으로 인해 제한되는 해석을 명시합니다.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowInputEditor((v) => !v)}
            className="px-3.5 py-2 rounded-[10px] bg-[#F8FAFC] hover:bg-[#EFF6FF] text-[#1D4ED8] border border-[#CBD5E1] text-[12.5px] font-bold flex items-center gap-1.5 shrink-0 cursor-pointer"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>{showInputEditor ? "데이터/조건 입력창 접기" : "측정 항목 선택 및 수치 직접 수정"}</span>
          </button>
        </div>

        {/* Sample Linkage Criteria Banner */}
        {linkageInfo && (
          <div
            className={`p-4 rounded-[14px] border space-y-2 ${
              linkageInfo.linkage_mode === "unverified_mismatch"
                ? "bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]"
                : "bg-[#F0FDF4] border-[#BBF7D0] text-[#065F46]"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-bold text-[14px] flex items-center gap-2">
                <Layers className="w-4 h-4" />
                <span>데이터 연결 기준 검증: {linkageInfo.linkage_badge}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(linkageInfo.criteria_checked || []).map((c, idx) => (
                  <span
                    key={idx}
                    className="px-2.5 py-0.5 rounded-full bg-white/90 border border-[#A7F3D0] text-[#047857] text-[11.5px] font-semibold"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
            <p className="text-[13px] leading-relaxed">{linkageInfo.linkage_summary}</p>
          </div>
        )}

        {/* 5-Instrument Availability Cards (with quick checkbox toggle) */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3.5">
          {instAvailability.map((inst) => {
            const toggleMap: Record<string, { checked: boolean; set: (v: boolean) => void }> = {
              XRD: { checked: hasXrd, set: setHasXrd },
              UTM: { checked: hasUtm, set: setHasUtm },
              Hall: { checked: hasHall, set: setHasHall },
              LFA: { checked: hasLfa, set: setHasLfa },
              SEM: { checked: hasSem, set: setHasSem },
            };
            const ctrl = toggleMap[inst.instrument];

            return (
              <div
                key={inst.instrument}
                className={`p-4 rounded-[16px] border flex flex-col justify-between space-y-3 transition ${
                  inst.available
                    ? "bg-[#F8FAFC] border-[#CBD5E1]"
                    : "bg-[#FAFAFA] border-dashed border-[#CBD5E1] opacity-85"
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 font-bold text-[14px] text-[#0F172A] cursor-pointer">
                      {ctrl && (
                        <input
                          type="checkbox"
                          checked={ctrl.checked}
                          onChange={(e) => {
                            ctrl.set(e.target.checked);
                            setIsResultOutdated(true);
                          }}
                          className="w-4 h-4 accent-[#2563EB] cursor-pointer"
                        />
                      )}
                      <span>{inst.label}</span>
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                        inst.available
                          ? inst.status_badge.includes("부분")
                            ? "bg-[#FEF3C7] text-[#B45309]"
                            : "bg-[#DCFCE7] text-[#15803D]"
                          : "bg-[#E2E8F0] text-[#475569]"
                      }`}
                    >
                      {inst.status_badge}
                    </span>
                    {inst.available && (
                      <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded bg-white border border-[#CBD5E1] text-[#475569]">
                        {inst.data_source_badge}
                      </span>
                    )}
                  </div>

                  <p className="text-[12.5px] text-[#334155] leading-relaxed">{inst.summary}</p>
                </div>

                {inst.missing_impact && (
                  <div className="p-2.5 rounded-[10px] bg-[#FFFBEB] border border-[#FDE68A] text-[11.5px] text-[#92400E] leading-snug">
                    <strong>제한되는 해석:</strong> {inst.missing_impact}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Collapsible Editor for Specimen & Instrument Inputs */}
        {showInputEditor && (
          <div className="p-5 rounded-[16px] bg-[#F8FAFC] border border-[#CBD5E1] space-y-4">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-2.5">
              <h4 className="text-[14px] font-bold text-[#1E293B]">
                시료 연결 기준 및 장비별 측정값 직접 편집 (수정 후 ‘변경된 데이터로 리포트 갱신’ 클릭)
              </h4>
              <button
                type="button"
                onClick={() => executeIntegratedReport()}
                className="px-3.5 py-1.5 rounded-[8px] bg-[#2563EB] text-white text-[12px] font-bold cursor-pointer"
              >
                적용 및 리포트 갱신
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-[12.5px]">
              <div>
                <label className="font-bold text-[#334155] block mb-1">샘플 ID (Sample ID)</label>
                <input
                  type="text"
                  value={sampleId}
                  onChange={(e) => {
                    setSampleId(e.target.value);
                    setIsResultOutdated(true);
                  }}
                  className="w-full px-3 py-1.5 rounded-[8px] border border-[#CBD5E1] bg-white"
                />
              </div>
              <div>
                <label className="font-bold text-[#334155] block mb-1">재료명 / 조성</label>
                <input
                  type="text"
                  value={materialName}
                  onChange={(e) => {
                    setMaterialName(e.target.value);
                    setIsResultOutdated(true);
                  }}
                  className="w-full px-3 py-1.5 rounded-[8px] border border-[#CBD5E1] bg-white"
                />
              </div>
              <div>
                <label className="font-bold text-[#334155] block mb-1">화학식 (Formula)</label>
                <input
                  type="text"
                  value={chemicalFormula}
                  onChange={(e) => {
                    setChemicalFormula(e.target.value);
                    setIsResultOutdated(true);
                  }}
                  className="w-full px-3 py-1.5 rounded-[8px] border border-[#CBD5E1] bg-white"
                />
              </div>
              <div>
                <label className="font-bold text-[#334155] block mb-1">공정 조건</label>
                <input
                  type="text"
                  value={processCondition}
                  onChange={(e) => {
                    setProcessCondition(e.target.value);
                    setIsResultOutdated(true);
                  }}
                  className="w-full px-3 py-1.5 rounded-[8px] border border-[#CBD5E1] bg-white"
                />
              </div>
              <div>
                <label className="font-bold text-[#334155] block mb-1">측정 온도 T (K)</label>
                <input
                  type="number"
                  value={tempK}
                  onChange={(e) => {
                    setTempK(Number(e.target.value));
                    setIsResultOutdated(true);
                  }}
                  className="w-full px-3 py-1.5 rounded-[8px] border border-[#CBD5E1] bg-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-[#E2E8F0] text-[12px]">
              {/* XRD & SEM inputs */}
              <div className="p-3 rounded-[12px] bg-white border border-[#E2E8F0] space-y-2">
                <div className="font-bold text-[#1E40AF]">XRD · SEM 구조/미세조직</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[#64748B] block">결정자 크기 (nm)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={crystalliteNm}
                      onChange={(e) => {
                        setCrystalliteNm(Number(e.target.value));
                        setIsResultOutdated(true);
                      }}
                      className="w-full px-2 py-1 rounded border border-[#CBD5E1]"
                    />
                  </div>
                  <div>
                    <label className="text-[#64748B] block">공간군</label>
                    <input
                      type="text"
                      value={spaceGroup}
                      onChange={(e) => {
                        setSpaceGroup(e.target.value);
                        setIsResultOutdated(true);
                      }}
                      className="w-full px-2 py-1 rounded border border-[#CBD5E1]"
                    />
                  </div>
                  <div>
                    <label className="text-[#64748B] block">SEM 입경 (µm)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={grainSizeUm}
                      onChange={(e) => {
                        setGrainSizeUm(Number(e.target.value));
                        setIsResultOutdated(true);
                      }}
                      className="w-full px-2 py-1 rounded border border-[#CBD5E1]"
                    />
                  </div>
                  <div>
                    <label className="text-[#64748B] block">기공률 (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={porosityPct}
                      onChange={(e) => {
                        setPorosityPct(Number(e.target.value));
                        setIsResultOutdated(true);
                      }}
                      className="w-full px-2 py-1 rounded border border-[#CBD5E1]"
                    />
                  </div>
                </div>
              </div>

              {/* UTM inputs */}
              <div className="p-3 rounded-[12px] bg-white border border-[#E2E8F0] space-y-2">
                <div className="font-bold text-[#047857]">UTM 기계적 인장 특성</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[#64748B] block">인장강도 (MPa)</label>
                    <input
                      type="number"
                      value={tensileStrengthMPa}
                      onChange={(e) => {
                        setTensileStrengthMPa(Number(e.target.value));
                        setIsResultOutdated(true);
                      }}
                      className="w-full px-2 py-1 rounded border border-[#CBD5E1]"
                    />
                  </div>
                  <div>
                    <label className="text-[#64748B] block">항복강도 (MPa)</label>
                    <input
                      type="number"
                      value={yieldStrengthMPa}
                      onChange={(e) => {
                        setYieldStrengthMPa(Number(e.target.value));
                        setIsResultOutdated(true);
                      }}
                      className="w-full px-2 py-1 rounded border border-[#CBD5E1]"
                    />
                  </div>
                  <div>
                    <label className="text-[#64748B] block">탄성계수 E (GPa)</label>
                    <input
                      type="number"
                      value={elasticModulusGPa}
                      onChange={(e) => {
                        setElasticModulusGPa(Number(e.target.value));
                        setIsResultOutdated(true);
                      }}
                      className="w-full px-2 py-1 rounded border border-[#CBD5E1]"
                    />
                  </div>
                  <div>
                    <label className="text-[#64748B] block">연신율 (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={elongationPct}
                      onChange={(e) => {
                        setElongationPct(Number(e.target.value));
                        setIsResultOutdated(true);
                      }}
                      className="w-full px-2 py-1 rounded border border-[#CBD5E1]"
                    />
                  </div>
                </div>
              </div>

              {/* Hall inputs */}
              <div className="p-3 rounded-[12px] bg-white border border-[#E2E8F0] space-y-2">
                <div className="font-bold text-[#6D28D9]">Hall 전기적 수송 특성</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[#64748B] block">캐리어 농도 (cm⁻³)</label>
                    <input
                      type="number"
                      value={carrierConc}
                      onChange={(e) => {
                        setCarrierConc(Number(e.target.value));
                        setIsResultOutdated(true);
                      }}
                      className="w-full px-2 py-1 rounded border border-[#CBD5E1]"
                    />
                  </div>
                  <div>
                    <label className="text-[#64748B] block">이동도 (cm²/V·s)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={hallMobility}
                      onChange={(e) => {
                        setHallMobility(Number(e.target.value));
                        setIsResultOutdated(true);
                      }}
                      className="w-full px-2 py-1 rounded border border-[#CBD5E1]"
                    />
                  </div>
                  <div>
                    <label className="text-[#64748B] block">전기전도도 (S/cm)</label>
                    <input
                      type="number"
                      value={elecCond}
                      onChange={(e) => {
                        setElecCond(Number(e.target.value));
                        setIsResultOutdated(true);
                      }}
                      className="w-full px-2 py-1 rounded border border-[#CBD5E1]"
                    />
                  </div>
                  <div>
                    <label className="text-[#64748B] block">캐리어 유형</label>
                    <select
                      value={carrierType}
                      onChange={(e) => {
                        setCarrierType(e.target.value);
                        setIsResultOutdated(true);
                      }}
                      className="w-full px-1.5 py-1 rounded border border-[#CBD5E1] bg-white"
                    >
                      <option value="p-type (Hole)">p-type (Hole)</option>
                      <option value="n-type (Electron)">n-type (Electron)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* LFA inputs (with rho & Cp required check) */}
              <div className="p-3 rounded-[12px] bg-white border border-[#E2E8F0] space-y-2">
                <div className="font-bold text-[#B45309]">LFA 열적 특성 (κ 계산 시 ρ·Cp 필수)</div>
                <div className="grid grid-cols-3 gap-1.5">
                  <div>
                    <label className="text-[#64748B] block">열확산도 α</label>
                    <input
                      type="number"
                      step="0.01"
                      value={thermalDiff}
                      onChange={(e) => {
                        setThermalDiff(Number(e.target.value));
                        setIsResultOutdated(true);
                      }}
                      className="w-full px-2 py-1 rounded border border-[#CBD5E1]"
                    />
                  </div>
                  <div>
                    <label className="text-[#64748B] block">밀도 ρ (필수)</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="미입력"
                      value={densityGcm3}
                      onChange={(e) => {
                        setDensityGcm3(e.target.value === "" ? "" : Number(e.target.value));
                        setIsResultOutdated(true);
                      }}
                      className="w-full px-2 py-1 rounded border border-[#CBD5E1]"
                    />
                  </div>
                  <div>
                    <label className="text-[#64748B] block">비열 Cp (필수)</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="미입력"
                      value={cpJgK}
                      onChange={(e) => {
                        setCpJgK(e.target.value === "" ? "" : Number(e.target.value));
                        setIsResultOutdated(true);
                      }}
                      className="w-full px-2 py-1 rounded border border-[#CBD5E1]"
                    />
                  </div>
                </div>
                <div className="text-[11px] text-[#64748B]">
                  * 밀도(ρ) 또는 비열(Cp)을 비우면 열전도도(κ) 임의 계산이 중단됩니다.
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* =====================================================================
          SECTION 3: 주요 지표 (Key Metrics Table & Cards with Plain-Korean Glossary)
         ===================================================================== */}
      <section className="bg-white rounded-[20px] p-5 sm:p-6 border border-[#E5E8EB] shadow-sm space-y-4">
        <div className="border-b border-[#E2E8F0] pb-3">
          <span className="text-[11px] font-bold text-[#7C3AED] uppercase tracking-wider">
            SECTION 3 · KEY QUANTITATIVE METRICS & GLOSSARY
          </span>
          <h3 className="text-[18px] font-bold text-[#191F28] mt-0.5">
            3. 주요 지표 요약 (측정값 · 계산값 구분, 측정 조건, 출처 및 전문용어 해설)
          </h3>
        </div>

        <div className="overflow-x-auto rounded-[14px] border border-[#E2E8F0]">
          <table className="w-full text-left border-collapse text-[13.5px]">
            <thead className="bg-[#F8FAFC] text-[#475569] border-b border-[#E2E8F0]">
              <tr>
                <th className="py-3 px-3.5 font-bold whitespace-nowrap">장비</th>
                <th className="py-3 px-3.5 font-bold">주요 지표 및 전문용어 설명</th>
                <th className="py-3 px-3.5 font-bold whitespace-nowrap">구분</th>
                <th className="py-3 px-3.5 font-bold whitespace-nowrap">결과값 및 단위</th>
                <th className="py-3 px-3.5 font-bold">측정/계산 조건 및 원본 출처</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {keyMetrics.map((m, idx) => (
                <tr key={idx} className="hover:bg-[#F8FAFC] align-top">
                  <td className="py-3.5 px-3.5 whitespace-nowrap">
                    <span className="px-2.5 py-1 rounded-[8px] bg-[#EFF6FF] text-[#1D4ED8] font-bold text-[12px]">
                      {m.instrument}
                    </span>
                  </td>
                  <td className="py-3.5 px-3.5 space-y-1 max-w-md">
                    <div className="font-bold text-[#0F172A]">{m.metric_name}</div>
                    <div className="text-[12px] text-[#64748B] leading-relaxed flex items-start gap-1">
                      <HelpCircle className="w-3.5 h-3.5 text-[#94A3B8] shrink-0 mt-0.5" />
                      <span>{m.term_explanation}</span>
                    </div>
                  </td>
                  <td className="py-3.5 px-3.5 whitespace-nowrap">
                    <span
                      className={`text-[11.5px] font-bold px-2 py-0.5 rounded ${
                        m.category === "측정 사실"
                          ? "bg-[#DCFCE7] text-[#15803D]"
                          : "bg-[#EDE9FE] text-[#6D28D9]"
                      }`}
                    >
                      {m.category}
                    </span>
                  </td>
                  <td className="py-3.5 px-3.5 font-mono font-bold text-[15px] text-[#0F172A] whitespace-nowrap">
                    {m.value} <span className="text-[12.5px] font-sans font-normal text-[#475569]">{m.unit !== "-" ? m.unit : ""}</span>
                  </td>
                  <td className="py-3.5 px-3.5 text-[12.5px] text-[#334155] space-y-0.5">
                    <div>
                      <strong>조건:</strong> {m.condition}
                    </div>
                    <div className="text-[11.5px] text-[#64748B]">
                      <strong>출처:</strong> {m.source_label}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* =====================================================================
          SECTION 4: 통합 분석 (XRD · UTM · Hall · LFA · SEM Cross-Analysis)
         ===================================================================== */}
      <section className="bg-white rounded-[20px] p-5 sm:p-6 border border-[#E5E8EB] shadow-sm space-y-5">
        <div className="border-b border-[#E2E8F0] pb-3">
          <span className="text-[11px] font-bold text-[#1D4ED8] uppercase tracking-wider">
            SECTION 4 · CROSS-INSTRUMENT INTEGRATED INTERPRETATION
          </span>
          <h3 className="text-[18px] font-bold text-[#191F28] mt-0.5">
            4. 다종 측정 통합 분석 (결정구조 ↔ 기계적·전기적·열적 특성 연결 및 근거 구분)
          </h3>
          <p className="text-[13px] text-[#64748B] mt-0.5">
            각 해석마다 근거가 된 측정 항목과 조건을 표시하며, <strong>측정 사실 · 계산 결과 · 해석 가설</strong>을 엄격히 구분합니다.
          </p>
        </div>

        {/* Cross-Instrument Correlation Cards */}
        <div className="space-y-4">
          {crossCorrelations.map((corr) => (
            <div
              key={corr.id}
              className="p-5 rounded-[16px] border border-[#CBD5E1] bg-[#F8FAFC] space-y-3.5"
            >
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-[#E2E8F0] pb-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1">
                    {corr.instruments.map((inst) => (
                      <span
                        key={inst}
                        className="px-2 py-0.5 rounded bg-[#2563EB] text-white text-[11px] font-bold"
                      >
                        {inst}
                      </span>
                    ))}
                  </div>
                  <h4 className="text-[16px] font-bold text-[#0F172A]">{corr.title}</h4>
                </div>
                <span className="text-[12px] text-[#475569] bg-white px-2.5 py-1 rounded-full border border-[#E2E8F0]">
                  근거 조건: {corr.basis_condition}
                </span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 text-[13.5px] leading-relaxed">
                <div className="p-3.5 rounded-[12px] bg-white border border-[#BBF7D0] space-y-1.5">
                  <div className="text-[12px] font-bold text-[#15803D]">✓ 측정 사실 (Measured Facts)</div>
                  {corr.measured_facts.map((mf, i) => (
                    <p key={i} className="text-[#1E293B]">
                      {mf}
                    </p>
                  ))}
                </div>

                <div className="p-3.5 rounded-[12px] bg-white border border-[#DDD6FE] space-y-1.5">
                  <div className="text-[12px] font-bold text-[#6D28D9]">📐 계산 결과 (Calculated Results)</div>
                  {corr.calculated_results.map((cr, i) => (
                    <p key={i} className="text-[#1E293B]">
                      {cr}
                    </p>
                  ))}
                </div>

                <div className="p-3.5 rounded-[12px] bg-white border border-[#BFDBFE] space-y-1.5">
                  <div className="text-[12px] font-bold text-[#1D4ED8]">💡 해석 가설 (Interpretation Hypotheses)</div>
                  {corr.interpretation_hypotheses.map((ih, i) => (
                    <p key={i} className="text-[#1E293B]">
                      {ih}
                    </p>
                  ))}
                </div>
              </div>

              <div className="p-3 rounded-[10px] bg-[#FFFBEB] border border-[#FDE68A] text-[12.5px] text-[#92400E]">
                {corr.caution_note}
              </div>
            </div>
          ))}
        </div>

        {/* =====================================================================
            COLLAPSIBLE DETAIL 4.1: XRD 패턴 · 피크 · 이차상 및 시리즈 시편 선택/비교
           ===================================================================== */}
        <details
          ref={xrdSectionRef}
          className="rounded-[16px] border border-[#CBD5E1] bg-white overflow-hidden"
          open
        >
          <summary className="p-4 bg-[#F8FAFC] hover:bg-[#F1F5F9] cursor-pointer flex items-center justify-between font-bold text-[15px] text-[#0F172A]">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#2563EB]" />
              <span>
                상세 근거 4.1 — XRD 회절 패턴 · 피크 (hkl) · 결정상 검증 및 시리즈 시편 비교 (접기/펼치기)
              </span>
            </div>
            <ChevronDown className="w-4 h-4 text-[#64748B]" />
          </summary>

          <div className="p-5 space-y-5 border-t border-[#E2E8F0]">
            {/* Optional Multi-Specimen Series Selector inside Collapsible */}
            {candEval && (
              <div className="p-4 rounded-[14px] bg-[#F8FAFC] border border-[#E2E8F0] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-[13.5px] font-bold text-[#1E293B]">
                      분석 시편 선택 (단일 시편 분석 가능 · 동일 시리즈 시편 추가 시 중첩 비교 자동 수행)
                    </div>
                    <p className="text-[12px] text-[#64748B]">
                      비교 대상 선택은 필수가 아니며, 단일 샘플만 선택해도 리포트가 생성됩니다. 동일 모재 시리즈를 함께 체크하면 조건 차이와 XRD/SEM 변화를 나란히 비교합니다.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-[12px]">
                    <span className="font-bold text-[#334155]">기준 시편 변경:</span>
                    <select
                      value={baselineProjectId || ""}
                      onChange={(e) => loadSpecimensAndAnalyze(e.target.value, undefined)}
                      className="px-2.5 py-1.5 rounded-[8px] border border-[#CBD5E1] bg-white font-semibold"
                    >
                      {[...(candEval.eligible_candidates || []), ...(candEval.excluded_candidates || [])].map(
                        (c: any) => (
                          <option key={c.project_id} value={c.project_id}>
                            {c.sample_name} ({c.experiment_meta?.base_matrix || "모재 미기재"})
                          </option>
                        )
                      )}
                    </select>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {(candEval.eligible_candidates || []).map((cand: any) => {
                    const isSelected = currentSlotsInput.some((s: any) => s.project_id === cand.project_id);
                    return (
                      <label
                        key={cand.project_id}
                        className={`px-3 py-1.5 rounded-[10px] border text-[12px] font-semibold flex items-center gap-2 cursor-pointer transition ${
                          isSelected
                            ? "bg-[#EFF6FF] border-[#2563EB] text-[#1E40AF]"
                            : "bg-white border-[#CBD5E1] text-[#475569] hover:bg-[#F1F5F9]"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleCandidateInSlots(cand.project_id)}
                          className="accent-[#2563EB]"
                        />
                        <span>{cand.sample_name}</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            openMetadataEditor(cand);
                          }}
                          className="text-[11px] text-[#64748B] hover:text-[#0F172A] underline ml-1"
                        >
                          조건편집
                        </button>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Chart Controls */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[12.5px] text-[#92400E] bg-[#FFFBEB] px-3 py-1.5 rounded-[10px] border border-[#FDE68A]">
                <strong>정규화 안내:</strong> {compData?.normalization_info?.mode_label}. 정규화된 피크 높이만으로 질량분율(wt%)을 계산하지 마십시오.
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={normMode}
                  onChange={(e) => {
                    const nextM = e.target.value as "max_100" | "raw";
                    setNormMode(nextM);
                    loadSpecimensAndAnalyze(baselineProjectId, currentSlotsInput, nextM, offsetStep);
                  }}
                  className="px-2.5 py-1.5 rounded-[8px] border border-[#CBD5E1] bg-[#F8FAFC] text-[12px] font-semibold"
                >
                  <option value="max_100">배경보정 최대 피크 = 100</option>
                  <option value="raw">원시 강도 (Counts)</option>
                </select>
                <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] border border-[#CBD5E1] bg-[#F8FAFC] text-[12px] font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showRawAndBgOverlay}
                    onChange={(e) => setShowRawAndBgOverlay(e.target.checked)}
                  />
                  원자료·배경선 겹쳐 보기
                </label>
              </div>
            </div>

            {/* Interactive XRD Plotly Chart */}
            <div className="rounded-[14px] border border-[#CBD5E1] bg-white p-2">
              <PlotlyChart
                data={plotlyTraces}
                layout={plotlyLayout}
                config={{ responsive: true }}
                style={{ width: "100%", height: `${Math.max(380, activeSlots.length * 105 + 180)}px` }}
                onPointClick={(pt: any) => {
                  if (pt?.customdata) {
                    setSelectedPeakUid(String(pt.customdata));
                  }
                }}
              />
            </div>

            {/* Replicate Deviation Summary if multiple replicates selected */}
            {replicateDeviations.length > 0 && (
              <div className="p-3.5 rounded-[12px] bg-[#F0FDF4] border border-[#BBF7D0] text-[12.5px] space-y-1">
                <div className="font-bold text-[#065F46]">동일 조건 반복 시편 편차 요약</div>
                {replicateDeviations.map((rep: any, rIdx: number) => (
                  <div key={rIdx} className="text-[#047857]">
                    • {rep.condition_label} (N={rep.n_replicates}): Scherrer 크기 {rep.scherrer_mean_nm ?? "-"} ±{" "}
                    {rep.scherrer_std_nm ?? "-"} nm | 피크 이동 {rep.shift_mean_deg ?? "-"}° ± {rep.shift_std_deg ?? "-"}°
                  </div>
                ))}
              </div>
            )}

            {/* Reflection Evolution Table (shown when comparing 2+ specimens) */}
            {activeSlots.length >= 2 && reflectionEvolution.length > 0 && (
              <div className="space-y-2">
                <h5 className="text-[13.5px] font-bold text-[#1E293B]">
                  시편 간 대응 반사별 피크 이동(Δ2θ) · 선폭(FWHM) 비교 표 (‘측정 범위 밖’ vs ‘미검출’ 구분)
                </h5>
                <div className="overflow-x-auto rounded-[12px] border border-[#E2E8F0]">
                  <table className="w-full text-left border-collapse text-[12px]">
                    <thead className="bg-[#F8FAFC] text-[#475569] border-b border-[#E2E8F0]">
                      <tr>
                        <th className="py-2 px-3 font-bold">반사 마커 · 상 (hkl)</th>
                        <th className="py-2 px-3 font-bold">참조 2θ</th>
                        {activeSlots.map((sl: any) => (
                          <th key={sl.slot_id} className="py-2 px-3 font-bold">
                            [{sl.slot_index}] {sl.sample_name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {reflectionEvolution.map((row: any) => (
                        <tr key={row.reflection_id} className="hover:bg-[#F8FAFC]">
                          <td className="py-2 px-3 font-bold">
                            {row.marker_label} {row.phase} {row.hkl ? `(${row.hkl})` : "(미할당)"}
                          </td>
                          <td className="py-2 px-3 font-mono">
                            {row.ref_two_theta != null ? `${fmtNum(row.ref_two_theta, 2)}°` : `~${fmtNum(row.anchor_two_theta, 2)}°`}
                          </td>
                          {(row.per_specimen || []).map((ps: any) => (
                            <td key={ps.slot_id} className="py-2 px-3">
                              {ps.status === "detected" ? (
                                <span className="font-mono">
                                  <strong>{fmtNum(ps.two_theta, 2)}°</strong> (Δ={fmtNum(ps.delta_vs_baseline_deg ?? 0, 2)}°, FWHM={ps.fwhm_deg ?? "-"}°)
                                </span>
                              ) : (
                                <span className="text-[#64748B]">{ps.status_label}</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Detected Peaks Detail Table */}
            <details className="rounded-[12px] border border-[#E2E8F0] bg-[#F8FAFC] p-3">
              <summary className="text-[13px] font-bold text-[#334155] cursor-pointer">
                검출 피크 상세 수치 표 보기 (2θ, 면간격 d, 상대강도, FWHM, 상 귀속 — 총 {allPeaksTable.length}개 피크)
              </summary>
              <div className="mt-2.5 overflow-x-auto rounded-[10px] border border-[#CBD5E1] bg-white max-h-[300px] overflow-y-auto">
                <table className="w-full text-left border-collapse text-[12px]">
                  <thead className="bg-[#F1F5F9] text-[#475569] sticky top-0">
                    <tr>
                      <th className="py-2 px-2.5 font-bold">시편</th>
                      <th className="py-2 px-2.5 font-bold">피크</th>
                      <th className="py-2 px-2.5 font-bold">실측 2θ</th>
                      <th className="py-2 px-2.5 font-bold">참조 2θ (Δ2θ)</th>
                      <th className="py-2 px-2.5 font-bold">d (Å)</th>
                      <th className="py-2 px-2.5 font-bold">상대강도</th>
                      <th className="py-2 px-2.5 font-bold">FWHM</th>
                      <th className="py-2 px-2.5 font-bold">상 귀속 (hkl)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0]">
                    {allPeaksTable.map((pk: any) => (
                      <tr
                        key={pk.peak_uid}
                        onClick={() => setSelectedPeakUid(pk.peak_uid)}
                        className="hover:bg-[#F8FAFC] cursor-pointer"
                      >
                        <td className="py-1.5 px-2.5">[{pk.slot_index}] {pk.sample_name.replace("[검증시리즈] ", "")}</td>
                        <td className="py-1.5 px-2.5 font-mono">{pk.peak_id}</td>
                        <td className="py-1.5 px-2.5 font-mono font-bold">{fmtNum(pk.two_theta, 3)}°</td>
                        <td className="py-1.5 px-2.5 font-mono text-[#1D4ED8]">
                          {pk.ref_two_theta != null
                            ? `${fmtNum(pk.ref_two_theta, 3)}° (${
                                pk.delta_ref_deg != null
                                  ? `${pk.delta_ref_deg > 0 ? "+" : ""}${fmtNum(pk.delta_ref_deg, 3)}°`
                                  : fmtNum((pk.two_theta ?? 0) - pk.ref_two_theta, 3) + "°"
                              })`
                            : "-"}
                        </td>
                        <td className="py-1.5 px-2.5 font-mono">{pk.d_spacing_A ? `${pk.d_spacing_A} Å` : "-"}</td>
                        <td className="py-1.5 px-2.5 font-mono">{pk.rel_intensity_pct}%</td>
                        <td className="py-1.5 px-2.5 font-mono">{pk.fwhm_deg ?? "-"}°</td>
                        <td className="py-1.5 px-2.5 font-semibold text-[#1E40AF]">
                          {pk.marker_label} {pk.assigned_phase} {pk.assigned_hkl ? `(${pk.assigned_hkl})` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        </details>

        {/* =====================================================================
            COLLAPSIBLE DETAIL 4.2: SEM 미세조직 원본 이미지 및 시야(FOV) 비교
           ===================================================================== */}
        <details
          ref={semSectionRef}
          className="rounded-[16px] border border-[#CBD5E1] bg-white overflow-hidden"
          open
        >
          <summary className="p-4 bg-[#F8FAFC] hover:bg-[#F1F5F9] cursor-pointer flex items-center justify-between font-bold text-[15px] text-[#0F172A]">
            <div className="flex items-center gap-2">
              <Microscope className="w-4 h-4 text-[#059669]" />
              <span>
                상세 근거 4.2 — SEM 미세조직 원본 이미지 · 촬영 시야(FOV) 선택 및 치수 근거 (접기/펼치기)
              </span>
            </div>
            <ChevronDown className="w-4 h-4 text-[#64748B]" />
          </summary>

          <div className="p-5 space-y-4 border-t border-[#E2E8F0]">
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
                    className={`rounded-[16px] border p-4 flex flex-col justify-between space-y-3 ${
                      isHighlighted
                        ? "border-[#059669] ring-4 ring-[#A7F3D0] bg-[#ECFDF5]/30"
                        : "border-[#CBD5E1] bg-[#F8FAFC]"
                    }`}
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className="px-2 py-0.5 rounded text-white text-[11px] font-bold shrink-0"
                            style={{ backgroundColor: sl.color || "#059669" }}
                          >
                            #{sl.slot_index}
                          </span>
                          <span className="text-[14px] font-bold text-[#191F28] truncate">{sl.sample_name}</span>
                        </div>
                        {activeSlots.length > 1 && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              disabled={idx === 0 || compLoading}
                              onClick={() => handleMoveSlot(idx, -1)}
                              className="p-1 rounded border border-[#CBD5E1] bg-white disabled:opacity-40 cursor-pointer"
                              title="앞 순서로 이동"
                            >
                              <ArrowLeft className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === activeSlots.length - 1 || compLoading}
                              onClick={() => handleMoveSlot(idx, 1)}
                              className="p-1 rounded border border-[#CBD5E1] bg-white disabled:opacity-40 cursor-pointer"
                              title="뒤 순서로 이동"
                            >
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={compLoading}
                              onClick={() => handleRemoveSlot(idx)}
                              className="p-1 rounded border border-[#FECACA] bg-white text-[#DC2626] cursor-pointer"
                              title="비교에서 제외"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* FOV Switcher */}
                      {semFiles.length > 1 && (
                        <div className="flex items-center gap-1.5 bg-white p-2 rounded-[10px] border border-[#BFDBFE]">
                          <span className="text-[11px] font-bold text-[#1E40AF] shrink-0">촬영 시야 선택:</span>
                          <select
                            value={sem.file_id || ""}
                            onChange={(e) => handleSelectSemFov(idx, e.target.value)}
                            className="w-full text-[11.5px] font-bold text-[#0F172A] bg-transparent cursor-pointer"
                          >
                            {semFiles.map((sf: any) => (
                              <option key={sf.file_id} value={sf.file_id}>
                                {sf.fov_label} ({sf.original_filename})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {sem.has_image && activeImgUrl && !hasLoadError ? (
                        <div className="space-y-2">
                          <div className="relative w-full h-52 rounded-[12px] overflow-hidden bg-[#0F172A] border border-[#CBD5E1] flex items-center justify-center">
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
                                  className="px-2 py-1 rounded bg-black/75 text-white text-[10px] font-bold cursor-pointer"
                                >
                                  {viewMode === "raw" ? "분할 오버레이" : "원본 영상"}
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
                                className="p-1.5 rounded bg-black/75 text-white cursor-pointer"
                              >
                                <Maximize2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          <div className="p-2.5 rounded-[10px] bg-white border border-[#E2E8F0] text-[11.5px] text-[#334155] space-y-0.5">
                            <div>
                              <strong>원본 파일:</strong> <code>{sem.original_filename}</code> ({sem.fov_label})
                            </div>
                            <div>
                              <strong>스케일 상태:</strong> {sem.scale_summary}
                            </div>
                            {qm && (
                              <div>
                                <strong>SEM D50:</strong> {qm.d50} {qm.unit} (N={qm.sample_count_n}) |{" "}
                                <strong>XRD D:</strong>{" "}
                                {xrd?.scherrer_mean_nm != null ? `${fmtNum(xrd.scherrer_mean_nm, 1)} nm` : "-"}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="w-full h-52 rounded-[12px] border-2 border-dashed border-[#CBD5E1] bg-white p-4 flex flex-col items-center justify-center text-center space-y-1.5">
                          <AlertTriangle className="w-7 h-7 text-[#D97706]" />
                          <div className="text-[13px] font-bold text-[#1E293B]">업로드된 SEM 이미지 없음</div>
                          <p className="text-[11.5px] text-[#64748B]">
                            다른 시편이나 예시 이미지로 대체하지 않고 상태를 표시합니다.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </details>

        {/* =====================================================================
            COLLAPSIBLE DETAIL 4.3: Wiedemann-Franz 차트 및 학술 문헌 RAG 비교
           ===================================================================== */}
        <details className="rounded-[16px] border border-[#CBD5E1] bg-white overflow-hidden" open>
          <summary className="p-4 bg-[#F8FAFC] hover:bg-[#F1F5F9] cursor-pointer flex items-center justify-between font-bold text-[15px] text-[#0F172A]">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-[#F59E0B]" />
              <span>
                상세 근거 4.3 — Wiedemann–Franz 전자/격자 열전도 분리 차트 및 학술 문헌 RAG 근거 (접기/펼치기)
              </span>
            </div>
            <ChevronDown className="w-4 h-4 text-[#64748B]" />
          </summary>

          <div className="p-5 border-t border-[#E2E8F0]">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              <div className="lg:col-span-5 bg-[#F8FAFC] rounded-[14px] p-4 border border-[#E2E8F0] flex flex-col justify-center">
                {result?.wiedemann_franz ? (
                  <PlotlyChart
                    data={pieData}
                    layout={pieLayout}
                    config={{ responsive: true }}
                    style={{ width: "100%", height: "300px" }}
                  />
                ) : (
                  <div className="p-6 text-center space-y-2 text-[#64748B] text-[13px]">
                    <Zap className="w-8 h-8 text-[#D97706] mx-auto" />
                    <div className="font-bold text-[#1E293B]">Wiedemann–Franz 열전도 분리 대기 중</div>
                    <p className="text-[12px] leading-relaxed">
                      Hall 전기전도도(σ)와 LFA 열전도도(κ = α·ρ·Cp, 밀도 ρ 및 비열 Cp 필수)가 모두 확보된 경우에만 전자 열전도도(κ_e)와 격자 열전도도(κ_L)를 계산합니다.
                    </p>
                  </div>
                )}
              </div>

              <div className="lg:col-span-7 bg-[#F8FAFC] rounded-[14px] p-4 border border-[#E2E8F0] space-y-3">
                <div className="font-bold text-[14px] text-[#191F28]">
                  관련 학술 문헌 벤치마크 (Crossref / OpenAlex DOI 검증 완료)
                </div>
                {litLoading ? (
                  <div className="text-[13px] text-[#64748B]">학술 문헌 검색 중...</div>
                ) : references.length > 0 ? (
                  <div className="space-y-2">
                    {references.map((ref, idx) => (
                      <div
                        key={idx}
                        className="p-3 bg-white rounded-[10px] border border-[#E2E8F0] flex justify-between items-center gap-3 text-[12.5px]"
                      >
                        <div>
                          <strong className="text-[#0F172A] block leading-snug">{ref.title}</strong>
                          <span className="text-[11.5px] text-[#64748B]">
                            {ref.journal} ({ref.year}) · DOI: {ref.doi}
                          </span>
                        </div>
                        <a
                          href={`https://doi.org/${ref.doi}`}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2.5 py-1 rounded bg-[#EFF6FF] text-[#1D4ED8] text-[11.5px] font-bold shrink-0"
                        >
                          DOI 원문
                        </a>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[12.5px] text-[#64748B]">검색된 문헌이 없습니다.</div>
                )}
              </div>
            </div>
          </div>
        </details>
      </section>

      {/* =====================================================================
          SECTION 5: 한계 및 추가 실험 (Limitations & Recommended Next Actions)
         ===================================================================== */}
      <section className="bg-white rounded-[20px] p-5 sm:p-6 border border-[#E5E8EB] shadow-sm space-y-4">
        <div className="border-b border-[#E2E8F0] pb-3">
          <span className="text-[11px] font-bold text-[#DC2626] uppercase tracking-wider">
            SECTION 5 · LIMITATIONS & RECOMMENDED FOLLOW-UP EXPERIMENTS
          </span>
          <h3 className="text-[18px] font-bold text-[#191F28] mt-0.5">
            5. 해석의 한계 및 추가 실험 제안 (현재 데이터로 판단할 수 없는 내용과 다음 행동)
          </h3>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-[13.5px] leading-relaxed">
          <div className="p-4 rounded-[14px] bg-[#FEF2F2]/60 border border-[#FECACA] space-y-2">
            <div className="font-bold text-[#991B1B] flex items-center gap-2 text-[14.5px]">
              <AlertTriangle className="w-4 h-4 text-[#DC2626]" />
              <span>현재 데이터로 판단할 수 없는 내용 (해석의 한계)</span>
            </div>
            <ul className="list-disc pl-5 space-y-1.5 text-[#7F1D1D]">
              {(limitsAndActions?.cannot_determine_now || []).map((lim, idx) => (
                <li key={idx}>{lim}</li>
              ))}
            </ul>
          </div>

          <div className="p-4 rounded-[14px] bg-[#EFF6FF]/60 border border-[#BFDBFE] space-y-2">
            <div className="font-bold text-[#1E40AF] flex items-center gap-2 text-[14.5px]">
              <Sparkles className="w-4 h-4 text-[#2563EB]" />
              <span>추천 후속 검증 실험 및 다음 행동 (Next Actions)</span>
            </div>
            <ul className="list-disc pl-5 space-y-1.5 text-[#1E3A8A]">
              {(limitsAndActions?.recommended_next_steps || []).map((act, idx) => (
                <li key={idx}>{act}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* =====================================================================
          INLINE METADATA SUPPLEMENTATION MODAL
         ===================================================================== */}
      {editingMetaProjectId && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-[20px] max-w-xl w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
              <h3 className="text-[16px] font-bold text-[#191F28]">시편 실험 조건 메타데이터 보완</h3>
              <button
                type="button"
                onClick={() => setEditingMetaProjectId(null)}
                className="p-1 rounded hover:bg-[#F1F5F9] text-[#64748B] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[12.5px]">
              <div className="sm:col-span-2">
                <label className="font-bold text-[#334155] block mb-1">시편명</label>
                <input
                  type="text"
                  value={editingSampleName}
                  onChange={(e) => setEditingSampleName(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-[8px] border border-[#CBD5E1]"
                />
              </div>
              <div>
                <label className="font-bold text-[#334155] block mb-1">모재 (예: TiO2, NbFeSb)</label>
                <input
                  type="text"
                  value={editingMetaForm.base_matrix}
                  onChange={(e) => setEditingMetaForm({ ...editingMetaForm, base_matrix: e.target.value })}
                  className="w-full px-3 py-1.5 rounded-[8px] border border-[#CBD5E1]"
                />
              </div>
              <div>
                <label className="font-bold text-[#334155] block mb-1">명목 조성</label>
                <input
                  type="text"
                  value={editingMetaForm.nominal_composition}
                  onChange={(e) => setEditingMetaForm({ ...editingMetaForm, nominal_composition: e.target.value })}
                  className="w-full px-3 py-1.5 rounded-[8px] border border-[#CBD5E1]"
                />
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
                {savingMeta ? "저장 중..." : "저장 및 리포트 갱신"}
              </button>
            </div>
          </div>
        </div>
      )}

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
          INTERACTIVE GROUNDED RESEARCH ASSISTANT
         ===================================================================== */}
      <div className="bg-white rounded-[20px] p-5 sm:p-6 border border-[#E5E8EB] shadow-sm space-y-4">
        <div className="border-b border-[#F1F5F9] pb-3">
          <h3 className="text-[16px] font-bold text-[#191F28] flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-[#3182F6]" />
            근거 기반 대화형 연구 어시스턴트 (Vertex AI / Gemini + Materials Project DB)
          </h3>
          <p className="text-[12.5px] text-[#6B7684] mt-0.5">
            현재 분석된 XRD·UTM·Hall·LFA·SEM 주요 지표와 해석 가설을 바탕으로 후속 질문을 입력할 수 있습니다.
          </p>
        </div>

        <div className="bg-[#F8FAFC] rounded-[16px] p-4 border border-[#E2E8F0] max-h-[260px] overflow-y-auto space-y-3">
          {qaHistory.map((msg, i) => (
            <div key={i} className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-[14px] p-3.5 text-[13.5px] leading-relaxed ${
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
            placeholder="결정구조와 기계적 강도·전기전도도·열전도도 간의 관계나 추가 실험 방법에 대해 질문해 보세요..."
            className="flex-1 px-4 py-2.5 rounded-[12px] border border-[#CBD5E1] text-[13.5px]"
          />
          <button
            type="submit"
            disabled={qaLoading || !qaInput.trim()}
            className="px-5 py-2.5 rounded-[12px] bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-[13.5px] font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {qaLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            질문 전송
          </button>
        </form>
      </div>
    </div>
  );
}
