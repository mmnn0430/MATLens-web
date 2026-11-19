import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Flame,
  HelpCircle,
  Info,
  Layers,
  Loader2,
  Maximize2,
  Microscope,
  RefreshCw,
  Sparkles,
  Thermometer,
  Waves,
  X,
  Zap,
} from "lucide-react";
import { api } from "../api";
import { PlotlyChart } from "./PlotlyChart";
import type {
  IntegratedReportSnapshot,
  ProjectDetail,
  RunDetail,
  SavedAnalysisItem,
  ScopedAnalysisSelection,
  SemVisualizationItem,
  ServiceMode,
} from "../types";

interface IntegratedAnalysisViewProps {
  activeProject?: ProjectDetail | null;
  activeRun?: RunDetail | null;
  onNavigateMode?: (mode: ServiceMode) => void;
}

const INSTRUMENT_METADATA: Record<
  string,
  {
    name: string;
    label: string;
    category: string;
    mode: ServiceMode;
    icon: React.ComponentType<{ className?: string }>;
    accentColor: string;
    unitDesc: string;
  }
> = {
  XRD: {
    name: "XRD",
    label: "XRD (X선 회절)",
    category: "결정 구조 · 상 동정",
    mode: "xrd",
    icon: Layers,
    accentColor: "border-blue-500 text-blue-600 bg-blue-50 dark:bg-blue-950/30",
    unitDesc: "결정상, 격자상수, Scherrer 결정자 크기(nm)",
  },
  SEM: {
    name: "SEM",
    label: "SEM (전자현미경)",
    category: "미세조직 · 입자 형상",
    mode: "sem",
    icon: Microscope,
    accentColor: "border-emerald-500 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30",
    unitDesc: "2D 평균 결정립/입경(µm), 면적 기공률(%)",
  },
  UTM: {
    name: "UTM",
    label: "UTM (만능재료시험)",
    category: "기계적 강도 · 연신율",
    mode: "utm",
    icon: Activity,
    accentColor: "border-amber-500 text-amber-600 bg-amber-50 dark:bg-amber-950/30",
    unitDesc: "인장강도(UTS), 0.2% 항복강도, 탄성계수(E), 연신율(%)",
  },
  Hall: {
    name: "Hall",
    label: "Hall Effect (홀 효과)",
    category: "전기적 수송 특성",
    mode: "hall",
    icon: Zap,
    accentColor: "border-purple-500 text-purple-600 bg-purple-50 dark:bg-purple-950/30",
    unitDesc: "캐리어 농도(n), 홀 이동도(µ_H), 전기전도도(σ)",
  },
  LFA: {
    name: "LFA",
    label: "LFA (레이저 섬광)",
    category: "열확산도 · 열전도 특성",
    mode: "lfa",
    icon: Flame,
    accentColor: "border-rose-500 text-rose-600 bg-rose-50 dark:bg-rose-950/30",
    unitDesc: "열확산도(α), 총 열전도도(κ), 포논/전자 분리",
  },
  "FT-IR": {
    name: "FT-IR",
    label: "FT-IR (적외선 분광)",
    category: "분자 결합 · 작용기",
    mode: "ftir",
    icon: Waves,
    accentColor: "border-cyan-500 text-cyan-600 bg-cyan-50 dark:bg-cyan-950/30",
    unitDesc: "특성 흡수 파수(cm⁻¹), 작용기 동정, 피크 위치",
  },
  DSC: {
    name: "DSC",
    label: "DSC (시차주사열량)",
    category: "상전이 · 용융 엔탈피",
    mode: "dsc",
    icon: Thermometer,
    accentColor: "border-orange-500 text-orange-600 bg-orange-50 dark:bg-orange-950/30",
    unitDesc: "유리전이(Tg), 결정화(Tc), 융점(Tm), 엔탈피 변화(ΔH)",
  },
  TGA: {
    name: "TGA",
    label: "TGA (열중량분석)",
    category: "열분해 · 고온 감량",
    mode: "tga",
    icon: FileSpreadsheet,
    accentColor: "border-indigo-500 text-indigo-600 bg-indigo-50 dark:bg-indigo-950/30",
    unitDesc: "열분해 개시온도(Tonset), 5%/10% 감량온도, 잔류율(%)",
  },
};

const ALL_INSTRUMENTS = ["XRD", "SEM", "UTM", "Hall", "LFA", "FT-IR", "DSC", "TGA"];

// Visualization Explanations (Popups)
const VISUALIZATION_EXPLANATIONS: Record<
  string,
  {
    title: string;
    description: string;
    keyObservations: string;
    scientificMeaning: string;
    precautions: string;
  }
> = {
  XRD: {
    title: "XRD 회절 패턴 (X-ray Diffraction Pattern)",
    description:
      "시편에 X선을 조사하여 특정 결정 격자면(hkl)에서 브래그 반사(Bragg Reflection) 조건(2d sinθ = nλ)을 만족할 때 발생하는 회절 강도를 측정한 데이터입니다.",
    keyObservations:
      "회절 각도(2θ)에 따른 피크 위치, 피크의 상대 강도비(Relative Intensity), 피크 폭(FWHM)을 관찰합니다.",
    scientificMeaning:
      "피크 위치로부터 단위 격자 상수(a, b, c)를 도출하고 표준 PDF/CIF 카드와 대조하여 결정상을 식별합니다. 피크 반가폭은 Scherrer 식에 의해 결맞음 결정자 크기(Crystallite size)와 격자 변형률을 반영합니다.",
    precautions:
      "미세 분말 시편의 우선 배향(Preferred Orientation)이나 장치 오차로 인한 피크 이동 가능성을 점검해야 하며, 결정자 크기는 SEM의 겉보기 입경과 물리적으로 다릅니다.",
  },
  SEM: {
    title: "SEM 미세조직 영상 및 입도 분포 (Scanning Electron Micrograph)",
    description:
      "가속 전자빔을 시편 표면에 주사하여 방출되는 이차전자(SE) 또는 후방산란전자(BSE)를 검출하여 시편 표면/단면의 고배율 미세조직을 2차원 영상화한 결과입니다.",
    keyObservations:
      "결정립계(Grain boundary)의 형태, 입자의 평균 크기 및 균일도, 소결 기공(Pore)의 면적 분포, 이차상의 편석 여부를 관찰합니다.",
    scientificMeaning:
      "결정립 크기(Grain size)는 Hall-Petch 관계에 따라 기계적 항복강도에 직접 영향을 미치며, 전하 및 열 수송 캐리어의 계면 산란을 유발합니다. 기공률은 유효 단면적을 감소시킵니다.",
    precautions:
      "2차원 단면에서 측정된 선형/면적 치수는 3차원 입체 입경과 차이가 있을 수 있으며, 절단선법(Intercept method) 및 스케일 보정 정확도를 함께 확인해야 합니다.",
  },
  UTM: {
    title: "UTM 응력-변형률 곡선 (Stress-Strain Curve)",
    description:
      "만능재료시험기(UTM)를 통해 규격 인장 시편에 단축 하중을 가하면서 늘어난 변형량(Strain)과 가해진 하중(Stress)을 실시간 측정한 곡선입니다.",
    keyObservations:
      "초기 선형 탄성 구간의 기울기, 영구 변형이 시작되는 0.2% 오프셋 항복점, 최대 인장 응력점(UTS), 최종 파단 연신율(Elongation at Break)을 확인합니다.",
    scientificMeaning:
      "탄성계수는 재료 원자 결합의 고유 강성을 나타내며, 항복강도는 소성 전위 이동의 저항력을 반영합니다. 곡선 아래 면적(인성, Toughness)은 충격 흡수 에너지를 의미합니다.",
    precautions:
      "공칭 응력(Engineering Stress)과 진응력(True Stress)의 차이, 시편 게이지 치수 공차, 하중 속도(Strain rate)에 따른 물성 변화를 감안하여 해석해야 합니다.",
  },
  Hall: {
    title: "Hall 효과 자기장 응답 곡선 (B vs V_H Curve)",
    description:
      "전류가 흐르는 시편에 수직 자기장(B)을 인가할 때 로렌츠 힘에 의해 전하 캐리어가 편향되어 발생하는 기전력(Hall 전압, V_H)을 측정한 특성 곡선입니다.",
    keyObservations:
      "인가 자기장 변화에 따른 홀 전압의 선형성(R² > 0.98 여부), 기울기의 부호(양/음), 0T에서의 오프셋 전압을 점검합니다.",
    scientificMeaning:
      "기울기(홀 계수, R_H)로부터 주 전하 캐리어의 유형(p형: 양의 기울기, n형: 음의 기울기)과 단위 부피당 캐리어 농도(n = 1/eR_H), 면저항 결합을 통한 홀 이동도(µ_H)를 정량 결정합니다.",
    precautions:
      "접촉 저항의 비대칭성으로 인한 오프셋 전압 제거(자계 반전 측정 필수), 다중 캐리어 전도가 일어나는 좁은 밴드갭 반도체에서의 단일 캐리어 가정 한계를 고려해야 합니다.",
  },
  LFA: {
    title: "LFA 레이저 섬광 과도 온도 곡선 (Transient Temperature Response)",
    description:
      "평판 시편 전면에 짧은 레이저 펄스를 조사하고, 반대편 후면의 비접촉 적외선 온도 상승 곡선(Time vs ΔT)을 고속 계측한 데이터입니다.",
    keyObservations:
      "후면 온도가 최고 온도 상승치(ΔT_max)의 50%에 도달하는 반상승 시간(Half-rise time, t_1/2), 펄스 조사 직후의 베이스라인 안정성을 관찰합니다.",
    scientificMeaning:
      "Parker 반상승 시간 모델(α = 0.1388 · L² / t_1/2)을 통해 열확산도(α)를 결정합니다. 시편 밀도(ρ) 및 비열(Cp)과 결합하여 정상상태 총 열전도도(κ = α·ρ·Cp)를 산출합니다.",
    precautions:
      "시편 두께 측정의 정밀도(오차의 제곱에 비례), 고온 복사 열손실 및 레이저 펄스 유한 시간 효과에 대한 이론 모델 보정 여부를 점검해야 합니다.",
  },
  "FT-IR": {
    title: "FT-IR 적외선 흡수 분광 스펙트럼 (Infrared Absorption Spectrum)",
    description:
      "시편에 적외선을 통과시킬 때 분자 고유의 진동 및 회전 준위 전이에 의해 흡수되는 파수별 투과율(%T) 또는 흡광도(Absorbance)를 측정한 스펙트럼입니다.",
    keyObservations:
      "400 ~ 4000 cm⁻¹ 범위에서 관찰되는 특성 흡수 밴드의 위치(파수), 피크 형태(단일/다중), 흡수 세기를 관찰합니다.",
    scientificMeaning:
      "특정 화학 결합(O-H, C-H, 금속-산소 배위 결합 등)의 신축 및 굽힘 진동 모드를 확인하여 유기 작용기 및 무기 결정 격자의 배위 구조를 동정합니다.",
    precautions:
      "대기 중 수증기(H₂O) 및 이산화탄소(CO₂) 배경 흡수 피크의 보정 여부, 분말 시편의 산란 효과(ATR 접촉 불량)에 따른 기저선 왜곡을 주의해야 합니다.",
  },
  DSC: {
    title: "DSC 열류량 곡선 (Differential Scanning Calorimetry Heat Flow)",
    description:
      "시편과 기준 물질의 온도를 제어하면서 상변화나 반응에 의해 출입하는 열류량(Heat Flow, mW 또는 W/g)을 온도의 함수로 기록한 열분석 곡선입니다.",
    keyObservations:
      "기저선의 계단형 이동(유리전이 Tg), 발열 피크(결정화 Tc), 흡열 피크(용융 Tm), 피크의 개시 온도(Tonset) 및 면적을 관찰합니다.",
    scientificMeaning:
      "열역학적 상전이 온도와 상변화 과정에서의 흡열/발열 엔탈피(ΔH)를 산출하여 재료의 결정화도(Degree of Crystallinity) 및 상안정성을 정량화합니다.",
    precautions:
      "승온 속도(Heating rate)에 따른 피크 이동 효과, 시편 팬 뚜껑의 열전도 접촉 불량 및 산화 분위기 영향에 유의해야 합니다.",
  },
  TGA: {
    title: "TGA 중량 감량 곡선 (Thermogravimetric Mass Loss Curve)",
    description:
      "제어된 가스 분위기에서 온도를 연속적으로 상승시키며 시편의 정밀 질량 변화율(Mass %)을 측정한 열중량 분석 곡선입니다.",
    keyObservations:
      "열분해가 급격히 시작되는 접선 교점 개시온도(Tonset), 5%/10% 감량 도달 온도(T5, T10), 최종 최고 온도에서의 고체 잔류율(Residue %)을 확인합니다.",
    scientificMeaning:
      "시편의 고온 열안정성 상한, 휘발성 첨가제/수분의 증발 단계, 산화 또는 열분해 반응 차수를 정량적으로 파악할 수 있습니다.",
    precautions:
      "시편의 초기 질량, 가열로 내 불활성 가스(N₂/Ar) 유량, 부력 효과(Buoyancy effect)로 인한 기저선 보정을 확인해야 합니다.",
  },
};

export function IntegratedAnalysisView({
  activeProject: _activeProject,
  activeRun: _activeRun,
  onNavigateMode,
}: IntegratedAnalysisViewProps) {
  // ---------------------------------------------------------------------------
  // Data State
  // ---------------------------------------------------------------------------
  const [isCountsLoading, setIsCountsLoading] = useState<boolean>(true);
  const [allSavedItems, setAllSavedItems] = useState<SavedAnalysisItem[]>([]);
  const [isItemsLoading, setIsItemsLoading] = useState<boolean>(false);

  // ---------------------------------------------------------------------------
  // Workflow Step States (Strict 5 Steps)
  // ---------------------------------------------------------------------------
  // STEP 1: Selected Sample ID
  const [selectedSampleId, setSelectedSampleId] = useState<string>("");

  // STEP 2: Selected Instruments
  const [selectedInstruments, setSelectedInstruments] = useState<string[]>([]);

  // STEP 4: Configuration Parameters
  const [temperatureK, setTemperatureK] = useState<number>(300.0);
  const [userNotes, setUserNotes] = useState<string>("");
  const [customReportTitle, setCustomReportTitle] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // STEP 5: Report Snapshot
  const [reportSnapshot, setReportSnapshot] = useState<IntegratedReportSnapshot | null>(null);
  const [lastGeneratedSampleId, setLastGeneratedSampleId] = useState<string>("");
  const [lastGeneratedInstruments, setLastGeneratedInstruments] = useState<string[]>([]);

  // UI Interactive States
  const [activeChartTab, setActiveChartTab] = useState<string>("ALL");
  const [semViewMode, setSemViewMode] = useState<"overlay" | "roi" | "raw">("overlay");
  const [explanationModalKey, setExplanationModalKey] = useState<string | null>(null);
  const [zoomedImageSrc, setZoomedImageSrc] = useState<{ src: string; title: string } | null>(null);
  const [zoomedChartInst, setZoomedChartInst] = useState<string | null>(null);
  const [activeTocSection, setActiveTocSection] = useState<string>("dashboard");

  // ---------------------------------------------------------------------------
  // 1. Initial Load: Counts & Saved Items
  // ---------------------------------------------------------------------------
  const refreshSavedData = useCallback(async () => {
    setIsCountsLoading(true);
    setIsItemsLoading(true);
    try {

      const itemsResp = await api.getSavedAnalyses({ latest_only: false });
      setAllSavedItems(itemsResp.items || []);
    } catch (err: any) {
      console.error("Failed to load saved analyses:", err);
    } finally {
      setIsCountsLoading(false);
      setIsItemsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSavedData();
  }, [refreshSavedData]);

  // Restore snapshot from URL (?session=...) if present
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const reportId = sp.get("session") || sp.get("report_id");
    if (reportId && !reportSnapshot) {
      api
        .getReportSnapshot(reportId)
        .then((snapshot) => {
          if (snapshot && snapshot.report_id) {
            setReportSnapshot(snapshot);
            setSelectedSampleId(snapshot.sample_id);
            setSelectedInstruments(snapshot.selected_instruments || []);
            setLastGeneratedSampleId(snapshot.sample_id);
            setLastGeneratedInstruments(snapshot.selected_instruments || []);
          }
        })
        .catch(() => {});
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Step 1: Available Samples & Selection Logic
  // ---------------------------------------------------------------------------
  const availableSamples = useMemo(() => {
    const map = new Map<string, { id: string; name: string; completedCount: number }>();
    allSavedItems.forEach((it) => {
      const entry = map.get(it.sample_id) || {
        id: it.sample_id,
        name: it.sample_name,
        completedCount: 0,
      };
      if (it.status === "completed") {
        entry.completedCount += 1;
      }
      map.set(it.sample_id, entry);
    });
    return Array.from(map.values()).sort((a, b) => b.completedCount - a.completedCount);
  }, [allSavedItems]);

  // Auto-select first sample if not selected and available
  useEffect(() => {
    if (!selectedSampleId && availableSamples.length > 0) {
      setSelectedSampleId(availableSamples[0].id);
    }
  }, [availableSamples, selectedSampleId]);

  const handleSelectSample = (sampleId: string) => {
    if (sampleId !== selectedSampleId) {
      setSelectedSampleId(sampleId);
      // Reset selected instruments and snapshot when switching samples to prevent data mixture
      setSelectedInstruments([]);
      setReportSnapshot(null);
      setGenerationError(null);
    }
  };

  const selectedSampleInfo = useMemo(() => {
    return availableSamples.find((s) => s.id === selectedSampleId);
  }, [availableSamples, selectedSampleId]);

  // ---------------------------------------------------------------------------
  // Step 2 & 3: Latest Completed Run per Instrument for the Selected Sample
  // (Strict Rule: Exactly 1 latest completed run per sample + instrument)
  // ---------------------------------------------------------------------------
  const latestRunsByInstrument = useMemo(() => {
    if (!selectedSampleId) return {};

    const map: Record<string, SavedAnalysisItem> = {};
    const sampleItems = allSavedItems.filter(
      (it) => it.sample_id === selectedSampleId && it.status === "completed"
    );

    sampleItems.forEach((item) => {
      const inst = item.instrument;
      if (!map[inst]) {
        map[inst] = item;
      } else {
        const curRun = item.run_number || 1;
        const prevRun = map[inst].run_number || 1;
        if (curRun > prevRun || (curRun === prevRun && item.created_at > map[inst].created_at)) {
          map[inst] = item;
        }
      }
    });

    return map;
  }, [allSavedItems, selectedSampleId]);

  // Handle instrument toggle
  const handleToggleInstrument = (inst: string) => {
    setSelectedInstruments((prev) =>
      prev.includes(inst) ? prev.filter((i) => i !== inst) : [...prev, inst]
    );
  };

  // Validation Check: Selected instruments must all have valid latest completed runs
  const validationStatus = useMemo(() => {
    if (!selectedSampleId) {
      return { valid: false, message: "먼저 분석할 시료를 선택해 주세요." };
    }
    if (selectedInstruments.length === 0) {
      return { valid: false, message: "분석에 포함할 기기를 1개 이상 선택해 주세요." };
    }

    const missingInsts = selectedInstruments.filter((inst) => !latestRunsByInstrument[inst]);
    if (missingInsts.length > 0) {
      return {
        valid: false,
        message: `선택한 기기 [${missingInsts.join(", ")}]에 유효한 분석 완료 Run이 없습니다. 해당 기기 분석을 먼저 완료하거나 선택을 해제하세요.`,
      };
    }

    return { valid: true, message: "" };
  }, [selectedSampleId, selectedInstruments, latestRunsByInstrument]);

  // Detect Outdated Report (user changed sample or instruments after generation)
  const isSelectionChangedAfterGeneration = Boolean(
    reportSnapshot &&
      (lastGeneratedSampleId !== selectedSampleId ||
        selectedInstruments.slice().sort().join("|") !== lastGeneratedInstruments.slice().sort().join("|"))
  );

  // ---------------------------------------------------------------------------
  // Step 4: Generate Scoped Integrated Report
  // ---------------------------------------------------------------------------
  const handleGenerateReport = async () => {
    if (!validationStatus.valid) return;

    setIsGenerating(true);
    setGenerationError(null);
    try {
      // Build selected items using strictly the latest completed run per chosen instrument
      const selections: ScopedAnalysisSelection[] = selectedInstruments.map((inst) => {
        const it = latestRunsByInstrument[inst];
        return {
          id: it.id,
          instrument: it.instrument,
          sample_id: it.sample_id,
          sample_name: it.sample_name,
          file_id: it.file_id,
          measurement_id: it.measurement_id,
          analysis_id: it.analysis_id,
          run_id: it.run_id,
          original_filename: it.original_filename,
          run_number: it.run_number || 1,
        };
      });

      const payload = {
        title: customReportTitle.trim() || undefined,
        selected_items: selections,
        temperature_K: temperatureK,
        user_notes: userNotes.trim() || undefined,
        run_ai: true,
      };

      const result = await api.runIntegratedScopedAnalysis(payload);
      setReportSnapshot(result);
      setLastGeneratedSampleId(selectedSampleId);
      setLastGeneratedInstruments([...selectedInstruments]);

      // Set active chart tab to "ALL"
      setActiveChartTab("ALL");

      // Save report id to URL
      if (result.report_id) {
        const sp = new URLSearchParams(window.location.search);
        sp.set("mode", "integrated");
        sp.set("session", result.report_id);
        window.history.replaceState(null, "", `?${sp.toString()}`);
      }
    } catch (err: any) {
      setGenerationError(err?.message || "통합 리포트 생성 중 오류가 발생했습니다.");
    } finally {
      setIsGenerating(false);
    }
  };

  // ---------------------------------------------------------------------------
  // PDF Export
  // ---------------------------------------------------------------------------
  const handleDownloadPdf = async () => {
    if (!reportSnapshot) return;
    try {
      const resp = await fetch("/api/v1/reports/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report_id: reportSnapshot.report_id,
          sample_id: reportSnapshot.sample_id,
          material_name: reportSnapshot.material_name,
        }),
      });
      const blob = await resp.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `MatLens_Report_${reportSnapshot.sample_id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err: any) {
      alert(`PDF 다운로드 실패: ${err.message}`);
    }
  };

  // Scroll to section helper
  const scrollToSection = (id: string) => {
    setActiveTocSection(id);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // SEM visualization data extraction
  const semVisList: SemVisualizationItem[] = useMemo(() => {
    if (!reportSnapshot) return [];
    if (reportSnapshot.sem_visualizations && reportSnapshot.sem_visualizations.length > 0) {
      return reportSnapshot.sem_visualizations;
    }
    const curvesSem = reportSnapshot.multi_curves?.["SEM"] || [];
    return curvesSem as SemVisualizationItem[];
  }, [reportSnapshot]);

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-8 space-y-10">
      {/* ===================================================================== */}
      {/* Top Header */}
      {/* ===================================================================== */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
              <Layers className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                선택 기반 정밀 통합 분석 리포트
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                선택한 시료의 최신 분석 Run 결과와 실제 학술 논문 RAG에 근거한 무왜곡 과학 연구 보고서를 생성합니다.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={refreshSavedData}
            disabled={isCountsLoading || isItemsLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-card hover:bg-muted text-foreground transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isCountsLoading ? "animate-spin" : ""}`} />
            데이터 새로고침
          </button>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* STEP 1: 시료 선택 (Sample Selection) */}
      {/* ===================================================================== */}
      <section className="p-5 rounded-2xl border border-border bg-card shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
              1
            </span>
            <h2 className="text-base font-semibold text-foreground">분석할 시료 선택</h2>
            <span className="text-xs text-muted-foreground">
              (동일 시료의 분석 데이터만 엄격히 연결하여 교차 해석합니다)
            </span>
          </div>

          <div className="text-xs text-muted-foreground">
            등록된 시료: <strong className="text-foreground">{availableSamples.length}개</strong>
          </div>
        </div>

        {availableSamples.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground border border-dashed rounded-xl bg-muted/20">
            저장된 시료 분석 데이터가 없습니다. 먼저 XRD, SEM 등 개별 분석기기 탭에서 분석을 진행해 주세요.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {availableSamples.map((s) => {
              const isSelected = s.id === selectedSampleId;
              return (
                <div
                  key={s.id}
                  onClick={() => handleSelectSample(s.id)}
                  className={`p-3.5 rounded-xl border-2 cursor-pointer transition-all ${
                    isSelected
                      ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary"
                      : "border-border hover:border-border/80 bg-background"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-bold text-sm text-foreground">{s.name}</div>
                      <div className="text-[11px] text-muted-foreground font-mono mt-0.5">{s.id}</div>
                    </div>
                    {isSelected && <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />}
                  </div>

                  <div className="mt-3 pt-2 border-t border-border/50 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">완료된 기기 분석</span>
                    <span className="font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                      {s.completedCount}건
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ===================================================================== */}
      {/* STEP 2: 분석 기기 선택 (8개 기기 카드) */}
      {/* ===================================================================== */}
      {selectedSampleId && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                2
              </span>
              <h2 className="text-base font-semibold text-foreground">
                통합 분석에 포함할 기기 선택
              </h2>
              <span className="text-xs text-muted-foreground">
                (선택하지 않은 기기의 측정 결과는 AI 분석 및 리포트에서 완전 제외됩니다)
              </span>
            </div>

            <div className="text-xs text-muted-foreground">
              선택된 기기: <strong className="text-foreground">{selectedInstruments.length}</strong> / 8개
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            {ALL_INSTRUMENTS.map((inst) => {
              const meta = INSTRUMENT_METADATA[inst];
              const isSelected = selectedInstruments.includes(inst);
              const latestRun = latestRunsByInstrument[inst];
              const hasRun = Boolean(latestRun);
              const Icon = meta.icon;

              return (
                <div
                  key={inst}
                  onClick={() => handleToggleInstrument(inst)}
                  className={`relative flex flex-col justify-between p-3.5 rounded-xl border-2 transition-all cursor-pointer select-none ${
                    isSelected
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border hover:border-border/80 bg-card hover:bg-muted/40"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {}}
                      className="w-4 h-4 rounded text-primary border-border focus:ring-primary pointer-events-none"
                    />
                  </div>

                  <div className="mt-3">
                    <div className="text-sm font-bold text-foreground">{inst}</div>
                    <div className="text-[11px] text-muted-foreground truncate" title={meta.category}>
                      {meta.category}
                    </div>
                  </div>

                  <div className="mt-2.5 pt-2 border-t border-border/50 flex items-center justify-between">
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        hasRun
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {hasRun ? `Run #${latestRun.run_number || 1} 완료` : "데이터 없음"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ===================================================================== */}
      {/* STEP 3: 각 기기별 최신 Run 결과 확인 (Strict 1:1 Mapping) */}
      {/* ===================================================================== */}
      {selectedInstruments.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                3
              </span>
              <h2 className="text-base font-semibold text-foreground">
                선택 기기별 최신 분석 Run 결과 확인
              </h2>
              <span className="text-xs text-muted-foreground">
                (동일 시료·기기 기준 가장 마지막에 정상 완료된 Run 결과 1개만 단독 반영됩니다)
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {selectedInstruments.map((inst) => {
              const meta = INSTRUMENT_METADATA[inst];
              const Icon = meta.icon;
              const runItem = latestRunsByInstrument[inst];

              if (!runItem) {
                return (
                  <div
                    key={inst}
                    className="p-4 rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20 text-xs flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 font-bold text-amber-900 dark:text-amber-200">
                          <Icon className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                          <span>{inst}</span>
                        </div>
                        <span className="px-2 py-0.5 rounded bg-amber-200 text-amber-900 font-semibold text-[10px]">
                          데이터 없음
                        </span>
                      </div>
                      <p className="mt-2 text-amber-800 dark:text-amber-300 leading-relaxed">
                        현재 시료({selectedSampleInfo?.name})에서 완료된 {inst} 분석 결과가 없습니다.
                      </p>
                    </div>

                    {onNavigateMode && (
                      <button
                        onClick={() => onNavigateMode(meta.mode)}
                        className="mt-3 inline-flex items-center justify-center gap-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg shadow-sm transition-colors"
                      >
                        {inst} 분석 화면으로 이동
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              }

              return (
                <div
                  key={inst}
                  className="p-4 rounded-xl border border-border bg-card shadow-sm flex flex-col justify-between space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                        <Icon className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-bold text-xs text-foreground flex items-center gap-1.5">
                          <span>{inst}</span>
                          <span className="text-[10px] text-muted-foreground">
                            (Run #{runItem.run_number || 1})
                          </span>
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate max-w-[200px]" title={runItem.original_filename}>
                          📄 {runItem.original_filename}
                        </div>
                      </div>
                    </div>

                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                      최신 완료 Run
                    </span>
                  </div>

                  <div className="pt-2 border-t border-border/40 text-xs text-muted-foreground line-clamp-2">
                    {runItem.summary_text || "분석 완료 데이터"}
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-muted-foreground/80 pt-1">
                    <span>완료 시각: {new Date(runItem.created_at).toLocaleString("ko-KR")}</span>
                    {runItem.raw_curve_available && (
                      <span className="text-primary font-medium">시각화 데이터 준비됨</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ===================================================================== */}
      {/* STEP 4: 조건 설정 및 통합 분석 실행 */}
      {/* ===================================================================== */}
      {selectedInstruments.length > 0 && (
        <section className="p-5 rounded-2xl border-2 border-primary/20 bg-card shadow-sm space-y-4">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
              4
            </span>
            <h2 className="text-base font-semibold text-foreground">
              통합 분석 조건 설정 및 리포트 실행
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-foreground">
                측정/해석 온도 (Temperature):
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={temperatureK}
                  onChange={(e) => setTemperatureK(Number(e.target.value) || 300)}
                  className="w-28 px-3 py-1.5 text-xs rounded-lg border border-border bg-background text-foreground"
                />
                <span className="text-xs text-muted-foreground">
                  K ({(temperatureK - 273.15).toFixed(1)} °C)
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-foreground">
                리포트 제목 (선택):
              </label>
              <input
                type="text"
                placeholder="미입력 시 기본 제목 자동 생성"
                value={customReportTitle}
                onChange={(e) => setCustomReportTitle(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground/60"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-foreground">
                연구자 메모 / 공정 조건 (AI 해석에 반영):
              </label>
              <input
                type="text"
                placeholder="예: Ti 5 at% 치환 소결, 열처리 800°C 2h"
                value={userNotes}
                onChange={(e) => setUserNotes(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground/60"
              />
            </div>
          </div>

          {/* Validation Notice & Generate Button */}
          <div className="pt-3 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-3">
            <div>
              {!validationStatus.valid ? (
                <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{validationStatus.message}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>
                    선택한 {selectedInstruments.length}개 기기의 최신 Run 데이터가 확인되었습니다. 통합 리포트를 생성할 수 있습니다.
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={handleGenerateReport}
              disabled={!validationStatus.valid || isGenerating}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm bg-primary hover:bg-primary/90 text-primary-foreground shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  최신 Run 및 실제 논문 RAG 분석 중...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  통합 분석 리포트 생성
                </>
              )}
            </button>
          </div>

          {generationError && (
            <div className="p-3 rounded-lg border border-destructive/40 bg-destructive/10 text-destructive text-xs">
              {generationError}
            </div>
          )}
        </section>
      )}

      {/* ===================================================================== */}
      {/* STEP 5: 통합 리포트 확인 대시보드 */}
      {/* ===================================================================== */}
      {reportSnapshot && (
        <section className="space-y-8 pt-4">
          {/* Outdated Notice Banner */}
          {isSelectionChangedAfterGeneration && (
            <div className="p-4 rounded-xl border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md animate-pulse">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
                <div>
                  <div className="font-bold text-sm">시료 또는 기기 선택이 변경되었습니다.</div>
                  <div className="text-xs text-amber-800 dark:text-amber-300">
                    현재 보고 계신 리포트는 이전 기준 스냅샷입니다. 변경된 최신 상태를 반영하려면 다시 생성해 주세요.
                  </div>
                </div>
              </div>

              <button
                onClick={handleGenerateReport}
                disabled={!validationStatus.valid || isGenerating}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow transition-colors shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                지금 다시 생성
              </button>
            </div>
          )}

          {/* Report Top Header */}
          <div className="p-6 rounded-2xl border border-border bg-card shadow-sm space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <span className="text-xs font-bold text-primary tracking-wider uppercase">
                  MatLens Integrated Materials Report
                </span>
                <h2 className="text-2xl font-extrabold text-foreground mt-1">
                  {reportSnapshot.title}
                </h2>
                <div className="text-xs text-muted-foreground mt-1.5 flex flex-wrap items-center gap-3">
                  <span>
                    시료: <strong className="text-foreground">{reportSnapshot.material_name}</strong>
                  </span>
                  <span>•</span>
                  <span>생성 시각: {new Date(reportSnapshot.created_at).toLocaleString("ko-KR")}</span>
                  <span>•</span>
                  <span>
                    포함된 기기:{" "}
                    <strong className="text-foreground">
                      {reportSnapshot.selected_instruments.join(" · ")}
                    </strong>
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownloadPdf}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 shadow transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  PDF 리포트 다운로드
                </button>
              </div>
            </div>

            {/* Scope Statement Banner */}
            <div className="p-3.5 rounded-xl border border-primary/20 bg-primary/5 text-xs text-foreground space-y-1">
              <div className="font-bold text-primary flex items-center gap-1.5">
                <Info className="w-4 h-4" />
                선택된 데이터 격리 범위 (Strict Scope Statement)
              </div>
              <p className="text-muted-foreground leading-relaxed">
                본 리포트는 연구자가 명시적으로 선택한 <strong>[{reportSnapshot.selected_instruments.join(", ")}]</strong>의{" "}
                <strong>최신 정상 완료 Run 결과</strong>만을 단독 분석 대상으로 사용하였으며, 선택되지 않은 다른 기기의 측정값은 임의 추정 없이 해석 및 계산에서 완전 배제되었습니다.
              </p>
            </div>

            {/* Table of Contents Navigation Bar */}
            <div className="pt-2 border-t border-border/60 flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-muted-foreground mr-1">리포트 목차:</span>
              <button
                onClick={() => scrollToSection("sec-visualization")}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  activeTocSection === "dashboard"
                    ? "bg-primary/10 text-primary font-bold"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                1. 다중 기기 시각화
              </button>
              <button
                onClick={() => scrollToSection("sec-key-metrics")}
                className="px-2.5 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                2. 주요 정량 물성 지표
              </button>
              <button
                onClick={() => scrollToSection("sec-correlations")}
                className="px-2.5 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                3. 기기간 교차 상관성
              </button>
              <button
                onClick={() => scrollToSection("sec-ai-report")}
                className="px-2.5 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                4. AI 학술 연구 보고서 (A~F)
              </button>
              <button
                onClick={() => scrollToSection("sec-references")}
                className="px-2.5 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                5. 참고 문헌 (References)
              </button>
            </div>
          </div>

          {/* ================================================================= */}
          {/* 1. Scientific Visualization Dashboard */}
          {/* ================================================================= */}
          <div id="sec-visualization" className="p-6 rounded-2xl border border-border bg-card shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <Layers className="w-5 h-5 text-primary" />
                  <h3 className="text-lg font-bold text-foreground">
                    다중 기기 측정 곡선 및 미세조직 시각화 대시보드
                  </h3>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  선택한 분석기기에서 실제 계측된 모든 곡선 프로파일 및 전자현미경 미세조직 영상을 통합 제공합니다.
                </p>
              </div>

              {/* Filter Tabs */}
              <div className="flex items-center gap-1 p-1 rounded-xl bg-muted overflow-x-auto">
                <button
                  onClick={() => setActiveChartTab("ALL")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all shrink-0 ${
                    activeChartTab === "ALL"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  전체 보기 (All Results)
                </button>
                {reportSnapshot.selected_instruments.map((inst) => (
                  <button
                    key={inst}
                    onClick={() => setActiveChartTab(inst)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all shrink-0 ${
                      activeChartTab === inst
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {inst}
                  </button>
                ))}
              </div>
            </div>

            {/* Visualizations Grid / Content */}
            <div className="space-y-6">
              {/* ----------------- SEM Section ----------------- */}
              {(activeChartTab === "ALL" || activeChartTab === "SEM") &&
                reportSnapshot.selected_instruments.includes("SEM") && (
                  <div className="p-5 rounded-xl border border-border bg-background space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Microscope className="w-5 h-5 text-emerald-600" />
                        <div>
                          <h4 className="font-bold text-sm text-foreground">
                            SEM 전자현미경 미세조직 및 입도 분포 시각화
                          </h4>
                          <span className="text-[11px] text-muted-foreground">
                            실제 분석 런에서 생성된 2D 표면 분할 오버레이 및 입경 통계 히스토그램
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setExplanationModalKey("SEM")}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-border bg-card hover:bg-muted text-foreground transition-colors"
                        >
                          <HelpCircle className="w-3.5 h-3.5 text-primary" />
                          해설 보기
                        </button>
                      </div>
                    </div>

                    {semVisList.length === 0 ? (
                      <div className="p-8 text-center text-xs text-muted-foreground border border-dashed rounded-xl">
                        SEM 분석 데이터가 없습니다.
                      </div>
                    ) : (
                      semVisList.map((semItem, idx) => {
                        const currentImgUrl =
                          semViewMode === "overlay"
                            ? semItem.overlay_url || semItem.raw_image_url
                            : semViewMode === "roi"
                            ? semItem.roi_url || semItem.raw_image_url
                            : semItem.raw_image_url;

                        const stats = semItem.summary_stats || {};
                        const hist = semItem.histogram;

                        return (
                          <div key={idx} className="space-y-4">
                            {/* SEM Image & Histogram Grid */}
                            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                              {/* Left: Image Viewer */}
                              <div className="lg:col-span-7 space-y-2.5">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5 p-1 rounded-lg bg-muted text-xs">
                                    <button
                                      onClick={() => setSemViewMode("overlay")}
                                      className={`px-2.5 py-1 rounded font-medium transition-all ${
                                        semViewMode === "overlay"
                                          ? "bg-background text-foreground shadow-sm"
                                          : "text-muted-foreground hover:text-foreground"
                                      }`}
                                    >
                                      분할 오버레이
                                    </button>
                                    <button
                                      onClick={() => setSemViewMode("roi")}
                                      className={`px-2.5 py-1 rounded font-medium transition-all ${
                                        semViewMode === "roi"
                                          ? "bg-background text-foreground shadow-sm"
                                          : "text-muted-foreground hover:text-foreground"
                                      }`}
                                    >
                                      분석 ROI
                                    </button>
                                    <button
                                      onClick={() => setSemViewMode("raw")}
                                      className={`px-2.5 py-1 rounded font-medium transition-all ${
                                        semViewMode === "raw"
                                          ? "bg-background text-foreground shadow-sm"
                                          : "text-muted-foreground hover:text-foreground"
                                      }`}
                                    >
                                      원본 이미지
                                    </button>
                                  </div>

                                  {currentImgUrl && (
                                    <button
                                      onClick={() =>
                                        setZoomedImageSrc({
                                          src: currentImgUrl,
                                          title: `${semItem.label} (${semViewMode.toUpperCase()})`,
                                        })
                                      }
                                      className="flex items-center gap-1 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground rounded border border-border bg-card"
                                    >
                                      <Maximize2 className="w-3.5 h-3.5" />
                                      확대 보기
                                    </button>
                                  )}
                                </div>

                                <div className="relative aspect-video rounded-xl border border-border overflow-hidden bg-black/5 dark:bg-black/30 flex items-center justify-center min-h-[260px]">
                                  {currentImgUrl ? (
                                    <img
                                      src={currentImgUrl}
                                      alt="SEM Microstructure"
                                      className="w-full h-full object-contain cursor-pointer"
                                      onClick={() =>
                                        setZoomedImageSrc({
                                          src: currentImgUrl,
                                          title: `${semItem.label} (${semViewMode.toUpperCase()})`,
                                        })
                                      }
                                      onError={(e) => {
                                        (e.target as HTMLElement).style.display = "none";
                                      }}
                                    />
                                  ) : (
                                    <div className="text-xs text-muted-foreground flex flex-col items-center gap-2">
                                      <AlertCircle className="w-6 h-6 text-amber-500" />
                                      <span>SEM 이미지를 불러올 수 없습니다.</span>
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Right: Particle/Grain Histogram & Summary */}
                              <div className="lg:col-span-5 space-y-3">
                                <div className="text-xs font-semibold text-foreground">
                                  입도 분포 히스토그램 (Grain/Particle Size Distribution)
                                </div>

                                {hist && hist.bin_edges && hist.counts ? (
                                  <div className="rounded-xl border border-border p-2 bg-card">
                                    <PlotlyChart
                                      data={[
                                        {
                                          x: hist.bin_edges.slice(0, -1).map((b, i) => (b + hist.bin_edges[i + 1]) / 2),
                                          y: hist.counts,
                                          type: "bar",
                                          marker: { color: "#10b981" },
                                          name: "개수 빈도",
                                        },
                                      ]}
                                      layout={{
                                        title: "크기별 빈도수 분포",
                                        xaxis: { title: `직경 (${hist.unit || "µm"})` },
                                        yaxis: { title: "개수 (Counts)" },
                                        margin: { t: 30, r: 15, l: 40, b: 40 },
                                      }}
                                      height={220}
                                    />
                                  </div>
                                ) : (
                                  <div className="p-8 text-center text-xs text-muted-foreground border border-dashed rounded-xl">
                                    입도 분포 히스토그램 데이터가 없습니다.
                                  </div>
                                )}

                                {/* Key Metrics Quick Chips */}
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                  <div className="p-2.5 rounded-lg border border-border bg-card">
                                    <span className="text-[10px] text-muted-foreground block">평균 직경 (Mean)</span>
                                    <span className="font-bold text-foreground">
                                      {stats.mean_diameter ? `${stats.mean_diameter} µm` : "-"}
                                    </span>
                                  </div>
                                  <div className="p-2.5 rounded-lg border border-border bg-card">
                                    <span className="text-[10px] text-muted-foreground block">면적 기공률 (Porosity)</span>
                                    <span className="font-bold text-foreground">
                                      {stats.porosity_pct !== undefined ? `${stats.porosity_pct}%` : "-"}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

              {/* ----------------- XRD Section ----------------- */}
              {(activeChartTab === "ALL" || activeChartTab === "XRD") &&
                reportSnapshot.selected_instruments.includes("XRD") &&
                reportSnapshot.multi_curves?.["XRD"] && (
                  <div className="p-5 rounded-xl border border-border bg-background space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Layers className="w-5 h-5 text-blue-600" />
                        <div>
                          <h4 className="font-bold text-sm text-foreground">
                            XRD 회절 패턴 비교 (2θ vs Intensity)
                          </h4>
                          <span className="text-[11px] text-muted-foreground">
                            결정 구조 상 동정 및 회절 피크 프로파일
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setExplanationModalKey("XRD")}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-border bg-card hover:bg-muted text-foreground transition-colors"
                        >
                          <HelpCircle className="w-3.5 h-3.5 text-primary" />
                          해설 보기
                        </button>
                        <button
                          onClick={() => setZoomedChartInst("XRD")}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground rounded border border-border bg-card"
                        >
                          <Maximize2 className="w-3.5 h-3.5" />
                          확대
                        </button>
                      </div>
                    </div>

                    <div className="rounded-xl border border-border p-2 bg-card">
                      <PlotlyChart
                        data={reportSnapshot.multi_curves["XRD"].map((c) => ({
                          x: c.two_theta,
                          y: c.intensity,
                          name: c.label,
                          type: "scatter",
                          mode: "lines",
                          line: { width: 1.8 },
                        }))}
                        layout={{
                          xaxis: { title: "2θ (degrees)" },
                          yaxis: { title: "회절 강도 (Counts)" },
                          legend: { orientation: "h", y: -0.2 },
                          margin: { t: 20, r: 20, l: 50, b: 50 },
                        }}
                        height={340}
                      />
                    </div>
                  </div>
                )}

              {/* ----------------- UTM Section ----------------- */}
              {(activeChartTab === "ALL" || activeChartTab === "UTM") &&
                reportSnapshot.selected_instruments.includes("UTM") &&
                reportSnapshot.multi_curves?.["UTM"] && (
                  <div className="p-5 rounded-xl border border-border bg-background space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Activity className="w-5 h-5 text-amber-600" />
                        <div>
                          <h4 className="font-bold text-sm text-foreground">
                            UTM 응력-변형률 곡선 (Stress vs Strain)
                          </h4>
                          <span className="text-[11px] text-muted-foreground">
                            단축 인장 거동, 탄성 계수 및 인장강도 특성
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setExplanationModalKey("UTM")}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-border bg-card hover:bg-muted text-foreground transition-colors"
                        >
                          <HelpCircle className="w-3.5 h-3.5 text-primary" />
                          해설 보기
                        </button>
                        <button
                          onClick={() => setZoomedChartInst("UTM")}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground rounded border border-border bg-card"
                        >
                          <Maximize2 className="w-3.5 h-3.5" />
                          확대
                        </button>
                      </div>
                    </div>

                    <div className="rounded-xl border border-border p-2 bg-card">
                      <PlotlyChart
                        data={reportSnapshot.multi_curves["UTM"].map((c) => ({
                          x: c.strain,
                          y: c.stress,
                          name: c.label,
                          type: "scatter",
                          mode: "lines",
                          line: { width: 2.0 },
                        }))}
                        layout={{
                          xaxis: { title: "공칭 변형률 (%)" },
                          yaxis: { title: "공칭 응력 (MPa)" },
                          legend: { orientation: "h", y: -0.2 },
                          margin: { t: 20, r: 20, l: 50, b: 50 },
                        }}
                        height={340}
                      />
                    </div>
                  </div>
                )}

              {/* ----------------- Hall Section ----------------- */}
              {(activeChartTab === "ALL" || activeChartTab === "Hall") &&
                reportSnapshot.selected_instruments.includes("Hall") &&
                reportSnapshot.multi_curves?.["Hall"] && (
                  <div className="p-5 rounded-xl border border-border bg-background space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Zap className="w-5 h-5 text-purple-600" />
                        <div>
                          <h4 className="font-bold text-sm text-foreground">
                            Hall 자기장-전압 응답 (B vs V_H)
                          </h4>
                          <span className="text-[11px] text-muted-foreground">
                            전하 수송 캐리어 농도 및 홀 이동도 특성 곡선
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setExplanationModalKey("Hall")}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-border bg-card hover:bg-muted text-foreground transition-colors"
                        >
                          <HelpCircle className="w-3.5 h-3.5 text-primary" />
                          해설 보기
                        </button>
                        <button
                          onClick={() => setZoomedChartInst("Hall")}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground rounded border border-border bg-card"
                        >
                          <Maximize2 className="w-3.5 h-3.5" />
                          확대
                        </button>
                      </div>
                    </div>

                    <div className="rounded-xl border border-border p-2 bg-card">
                      <PlotlyChart
                        data={reportSnapshot.multi_curves["Hall"].map((c) => ({
                          x: c.b_field,
                          y: c.hall_voltage,
                          name: c.label,
                          type: "scatter",
                          mode: "lines+markers",
                        }))}
                        layout={{
                          xaxis: { title: "자기장 B (T)" },
                          yaxis: { title: "홀 전압 V_H (mV)" },
                          legend: { orientation: "h", y: -0.2 },
                          margin: { t: 20, r: 20, l: 50, b: 50 },
                        }}
                        height={340}
                      />
                    </div>
                  </div>
                )}

              {/* ----------------- LFA Section ----------------- */}
              {(activeChartTab === "ALL" || activeChartTab === "LFA") &&
                reportSnapshot.selected_instruments.includes("LFA") &&
                reportSnapshot.multi_curves?.["LFA"] && (
                  <div className="p-5 rounded-xl border border-border bg-background space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Flame className="w-5 h-5 text-rose-600" />
                        <div>
                          <h4 className="font-bold text-sm text-foreground">
                            LFA 레이저 섬광 과도 온도 곡선 (Time vs Temperature)
                          </h4>
                          <span className="text-[11px] text-muted-foreground">
                            Parker 모델 기반 열확산도 측정 프로파일
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setExplanationModalKey("LFA")}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-border bg-card hover:bg-muted text-foreground transition-colors"
                        >
                          <HelpCircle className="w-3.5 h-3.5 text-primary" />
                          해설 보기
                        </button>
                        <button
                          onClick={() => setZoomedChartInst("LFA")}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground rounded border border-border bg-card"
                        >
                          <Maximize2 className="w-3.5 h-3.5" />
                          확대
                        </button>
                      </div>
                    </div>

                    <div className="rounded-xl border border-border p-2 bg-card">
                      <PlotlyChart
                        data={reportSnapshot.multi_curves["LFA"].map((c) => ({
                          x: c.time_s,
                          y: c.rear_temp,
                          name: c.label,
                          type: "scatter",
                          mode: "lines",
                        }))}
                        layout={{
                          xaxis: { title: "시간 (s)" },
                          yaxis: { title: "후면 온도 상승 (°C / ΔT)" },
                          legend: { orientation: "h", y: -0.2 },
                          margin: { t: 20, r: 20, l: 50, b: 50 },
                        }}
                        height={340}
                      />
                    </div>
                  </div>
                )}

              {/* ----------------- FT-IR Section ----------------- */}
              {(activeChartTab === "ALL" || activeChartTab === "FT-IR") &&
                reportSnapshot.selected_instruments.includes("FT-IR") &&
                reportSnapshot.multi_curves?.["FT-IR"] && (
                  <div className="p-5 rounded-xl border border-border bg-background space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Waves className="w-5 h-5 text-cyan-600" />
                        <div>
                          <h4 className="font-bold text-sm text-foreground">
                            FT-IR 적외선 분광 스펙트럼
                          </h4>
                          <span className="text-[11px] text-muted-foreground">
                            분자 결합 고유 진동 흡수 피크 동정
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setExplanationModalKey("FT-IR")}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-border bg-card hover:bg-muted text-foreground transition-colors"
                        >
                          <HelpCircle className="w-3.5 h-3.5 text-primary" />
                          해설 보기
                        </button>
                        <button
                          onClick={() => setZoomedChartInst("FT-IR")}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground rounded border border-border bg-card"
                        >
                          <Maximize2 className="w-3.5 h-3.5" />
                          확대
                        </button>
                      </div>
                    </div>

                    <div className="rounded-xl border border-border p-2 bg-card">
                      <PlotlyChart
                        data={reportSnapshot.multi_curves["FT-IR"].map((c) => ({
                          x: c.wavenumber,
                          y: c.signal,
                          name: c.label,
                          type: "scatter",
                          mode: "lines",
                        }))}
                        layout={{
                          xaxis: { title: "파수 (cm⁻¹)", autorange: "reversed" },
                          yaxis: { title: "투과율 (%T) / 흡광도" },
                          legend: { orientation: "h", y: -0.2 },
                          margin: { t: 20, r: 20, l: 50, b: 50 },
                        }}
                        height={340}
                      />
                    </div>
                  </div>
                )}

              {/* ----------------- DSC Section ----------------- */}
              {(activeChartTab === "ALL" || activeChartTab === "DSC") &&
                reportSnapshot.selected_instruments.includes("DSC") &&
                reportSnapshot.multi_curves?.["DSC"] && (
                  <div className="p-5 rounded-xl border border-border bg-background space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Thermometer className="w-5 h-5 text-orange-600" />
                        <div>
                          <h4 className="font-bold text-sm text-foreground">
                            DSC 열류량 곡선 (Heat Flow vs Temperature)
                          </h4>
                          <span className="text-[11px] text-muted-foreground">
                            유리전이(Tg), 결정화(Tc), 용융(Tm) 상전이 엔탈피 분석
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setExplanationModalKey("DSC")}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-border bg-card hover:bg-muted text-foreground transition-colors"
                        >
                          <HelpCircle className="w-3.5 h-3.5 text-primary" />
                          해설 보기
                        </button>
                        <button
                          onClick={() => setZoomedChartInst("DSC")}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground rounded border border-border bg-card"
                        >
                          <Maximize2 className="w-3.5 h-3.5" />
                          확대
                        </button>
                      </div>
                    </div>

                    <div className="rounded-xl border border-border p-2 bg-card">
                      <PlotlyChart
                        data={reportSnapshot.multi_curves["DSC"].map((c) => ({
                          x: c.temperature,
                          y: c.heat_flow,
                          name: c.label,
                          type: "scatter",
                          mode: "lines",
                        }))}
                        layout={{
                          xaxis: { title: "온도 (°C)" },
                          yaxis: { title: "열류 (mW 또는 W/g)" },
                          legend: { orientation: "h", y: -0.2 },
                          margin: { t: 20, r: 20, l: 50, b: 50 },
                        }}
                        height={340}
                      />
                    </div>
                  </div>
                )}

              {/* ----------------- TGA Section ----------------- */}
              {(activeChartTab === "ALL" || activeChartTab === "TGA") &&
                reportSnapshot.selected_instruments.includes("TGA") &&
                reportSnapshot.multi_curves?.["TGA"] && (
                  <div className="p-5 rounded-xl border border-border bg-background space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="w-5 h-5 text-indigo-600" />
                        <div>
                          <h4 className="font-bold text-sm text-foreground">
                            TGA 중량 감량 곡선 (Mass % vs Temperature)
                          </h4>
                          <span className="text-[11px] text-muted-foreground">
                            열분해 개시 온도 및 고온 잔류 질량 감량 거동
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setExplanationModalKey("TGA")}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-border bg-card hover:bg-muted text-foreground transition-colors"
                        >
                          <HelpCircle className="w-3.5 h-3.5 text-primary" />
                          해설 보기
                        </button>
                        <button
                          onClick={() => setZoomedChartInst("TGA")}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground rounded border border-border bg-card"
                        >
                          <Maximize2 className="w-3.5 h-3.5" />
                          확대
                        </button>
                      </div>
                    </div>

                    <div className="rounded-xl border border-border p-2 bg-card">
                      <PlotlyChart
                        data={reportSnapshot.multi_curves["TGA"].map((c) => ({
                          x: c.temperature,
                          y: c.mass_percent,
                          name: c.label,
                          type: "scatter",
                          mode: "lines",
                        }))}
                        layout={{
                          xaxis: { title: "온도 (°C)" },
                          yaxis: { title: "잔류 중량 (%)" },
                          legend: { orientation: "h", y: -0.2 },
                          margin: { t: 20, r: 20, l: 50, b: 50 },
                        }}
                        height={340}
                      />
                    </div>
                  </div>
                )}
            </div>
          </div>

          {/* ================================================================= */}
          {/* 2. Key Quantitative Metrics Table */}
          {/* ================================================================= */}
          <div id="sec-key-metrics" className="p-6 rounded-2xl border border-border bg-card shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-primary" />
                <h3 className="text-base font-bold text-foreground">
                  주요 정량 물성 지표 표 (Key Quantitative Metrics Table)
                </h3>
              </div>
              <span className="text-xs text-muted-foreground">
                (선택 기기별 실제 계산 및 검증된 물성치만을 출력합니다)
              </span>
            </div>

            {reportSnapshot.analysis_result?.key_metrics_table &&
            reportSnapshot.analysis_result.key_metrics_table.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border text-foreground font-semibold">
                      <th className="py-2.5 px-3">분석기기</th>
                      <th className="py-2.5 px-3">정량 물성 지표명</th>
                      <th className="py-2.5 px-3">정량 수치</th>
                      <th className="py-2.5 px-3">단위</th>
                      <th className="py-2.5 px-3">측정 / 계산 조건</th>
                      <th className="py-2.5 px-3">데이터 구분</th>
                      <th className="py-2.5 px-3">데이터 출처</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {reportSnapshot.analysis_result.key_metrics_table.map((row, idx) => (
                      <tr key={idx} className="hover:bg-muted/20">
                        <td className="py-2 px-3 font-bold text-primary">{row.instrument}</td>
                        <td className="py-2 px-3 font-medium text-foreground">
                          <div>{row.metric_name}</div>
                          {row.term_explanation && (
                            <div className="text-[10px] text-muted-foreground/80 font-normal mt-0.5">
                              {row.term_explanation}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-3 font-mono font-bold text-foreground">{row.value}</td>
                        <td className="py-2 px-3 text-muted-foreground">{row.unit}</td>
                        <td className="py-2 px-3 text-muted-foreground">{row.condition}</td>
                        <td className="py-2 px-3">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              row.category === "측정 사실"
                                ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                                : "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300"
                            }`}
                          >
                            {row.category}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-muted-foreground truncate max-w-xs" title={row.source_label}>
                          {row.source_label}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-muted-foreground border border-dashed rounded-xl">
                정량 물성 지표가 없습니다.
              </div>
            )}
          </div>

          {/* ================================================================= */}
          {/* 3. Cross-Instrument Correlations */}
          {/* ================================================================= */}
          {reportSnapshot.analysis_result?.cross_correlations &&
            reportSnapshot.analysis_result.cross_correlations.length > 0 && (
              <div id="sec-correlations" className="p-6 rounded-2xl border border-border bg-card shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-primary" />
                    <h3 className="text-base font-bold text-foreground">
                      다중 기기간 교차 상관성 분석 (Cross-Technique Correlation)
                    </h3>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    결정구조 – 미세조직 – 물성 연계 해석
                  </span>
                </div>

                <div className="space-y-4">
                  {reportSnapshot.analysis_result.cross_correlations.map((corr) => (
                    <div
                      key={corr.id}
                      className="p-4 rounded-xl border border-border bg-background space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-bold text-sm text-foreground">{corr.title}</div>
                        <div className="flex items-center gap-1.5">
                          {corr.instruments.map((inst) => (
                            <span
                              key={inst}
                              className="px-2 py-0.5 rounded text-[10px] font-bold bg-primary/10 text-primary"
                            >
                              {inst}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                        <div className="p-2.5 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/40">
                          <div className="font-semibold text-blue-800 dark:text-blue-300 mb-1">
                            [측정 사실]
                          </div>
                          <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                            {corr.measured_facts.map((fact, fIdx) => (
                              <li key={fIdx}>{fact}</li>
                            ))}
                          </ul>
                        </div>

                        <div className="p-2.5 rounded-lg bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/40">
                          <div className="font-semibold text-purple-800 dark:text-purple-300 mb-1">
                            [계산 결과]
                          </div>
                          <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                            {corr.calculated_results.map((calc, cIdx) => (
                              <li key={cIdx}>{calc}</li>
                            ))}
                          </ul>
                        </div>

                        <div className="p-2.5 rounded-lg bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40">
                          <div className="font-semibold text-emerald-800 dark:text-emerald-300 mb-1">
                            [해석 가설]
                          </div>
                          <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                            {corr.interpretation_hypotheses.map((hyp, hIdx) => (
                              <li key={hIdx}>{hyp}</li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      {corr.caution_note && (
                        <div className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 p-2 rounded border border-amber-200 dark:border-amber-900/40">
                          {corr.caution_note}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

          {/* ================================================================= */}
          {/* 4. AI Structured Scientific Report (A ~ F Sections) */}
          {/* ================================================================= */}
          {reportSnapshot.ai_interpretation && (
            <div id="sec-ai-report" className="p-6 rounded-2xl border border-border bg-card shadow-sm space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-primary" />
                  <div>
                    <h3 className="text-lg font-bold text-foreground">
                      AI 학술 연구 보고서 (Scientific Integrated Analysis)
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      실측 데이터와 공인 선행 논문(RAG)을 기반으로 구조화된 전문가 리포트
                    </span>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">
                  분석 엔진: <code className="text-primary font-mono">{reportSnapshot.ai_interpretation.ai_engine}</code>
                </span>
              </div>

              {/* Section A: Executive Summary */}
              <div className="p-4 rounded-xl bg-primary/5 border border-primary/20 space-y-2">
                <div className="font-bold text-sm text-primary flex items-center gap-1.5">
                  <span>A. Executive Summary (연구 요약)</span>
                </div>
                <p className="text-xs text-foreground leading-relaxed whitespace-pre-line">
                  {reportSnapshot.ai_interpretation.executive_summary ||
                    reportSnapshot.ai_interpretation.analysis_summary}
                </p>
              </div>

              {/* Section B: Sample Information */}
              {reportSnapshot.ai_interpretation.sample_information && (
                <div className="p-4 rounded-xl border border-border bg-background space-y-2.5">
                  <div className="font-bold text-sm text-foreground">
                    B. Sample Information (시료 및 공정 제원)
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <div className="p-2 rounded-lg bg-muted/30">
                      <span className="text-muted-foreground block text-[10px]">시료명</span>
                      <span className="font-bold text-foreground">
                        {reportSnapshot.ai_interpretation.sample_information.sample_name}
                      </span>
                    </div>
                    <div className="p-2 rounded-lg bg-muted/30">
                      <span className="text-muted-foreground block text-[10px]">화학 조성 / 구조</span>
                      <span className="font-bold text-foreground">
                        {reportSnapshot.ai_interpretation.sample_information.chemical_formula}
                      </span>
                    </div>
                    <div className="p-2 rounded-lg bg-muted/30">
                      <span className="text-muted-foreground block text-[10px]">공정 조건</span>
                      <span className="font-bold text-foreground truncate" title={reportSnapshot.ai_interpretation.sample_information.processing_conditions}>
                        {reportSnapshot.ai_interpretation.sample_information.processing_conditions}
                      </span>
                    </div>
                    <div className="p-2 rounded-lg bg-muted/30">
                      <span className="text-muted-foreground block text-[10px]">반영된 분석 기기</span>
                      <span className="font-bold text-primary">
                        {reportSnapshot.selected_instruments.join(", ")}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Section C: Individual Measurement Interpretation */}
              {reportSnapshot.ai_interpretation.individual_interpretations &&
                reportSnapshot.ai_interpretation.individual_interpretations.length > 0 && (
                  <div className="space-y-3">
                    <div className="font-bold text-sm text-foreground">
                      C. Individual Measurement Interpretation (선택 기기별 정밀 해석)
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                      {reportSnapshot.ai_interpretation.individual_interpretations.map((ind, iIdx) => (
                        <div
                          key={iIdx}
                          className="p-4 rounded-xl border border-border bg-background space-y-2 text-xs"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-primary text-sm">[{ind.instrument}]</span>
                            <span className="text-[10px] text-muted-foreground">정량 측정 결과</span>
                          </div>
                          <div className="text-foreground font-medium">{ind.core_results}</div>
                          <div className="text-muted-foreground">
                            <strong>주요 수치:</strong> {ind.quantitative_values}
                          </div>
                          <div className="text-muted-foreground">
                            <strong>물리학적 의미:</strong> {ind.physical_meaning}
                          </div>
                          <div className="text-[11px] text-emerald-700 dark:text-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20 p-2 rounded">
                            <strong>선행 연구 대조:</strong> {ind.literature_comparison}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              {/* Section D: Cross-Technique Correlation Analysis */}
              {reportSnapshot.ai_interpretation.cross_technique_correlations &&
                reportSnapshot.ai_interpretation.cross_technique_correlations.length > 0 && (
                  <div className="space-y-3">
                    <div className="font-bold text-sm text-foreground">
                      D. Cross-Technique Correlation Analysis (구조–미세조직–물성 상관성)
                    </div>
                    <div className="space-y-2.5">
                      {reportSnapshot.ai_interpretation.cross_technique_correlations.map((ct, cIdx) => (
                        <div
                          key={cIdx}
                          className="p-3.5 rounded-xl border border-border bg-background text-xs space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-foreground">{ct.pair_title}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-primary/10 text-primary font-semibold">
                              {ct.instruments.join(" + ")}
                            </span>
                          </div>
                          <p className="text-muted-foreground leading-relaxed">
                            {ct.structural_property_relationship}
                          </p>
                          <div className="flex flex-col sm:flex-row gap-2 pt-1 text-[11px]">
                            <span className="text-blue-700 dark:text-blue-300">
                              <strong>[실측 근거]</strong> {ct.proven_facts}
                            </span>
                            <span className="text-amber-700 dark:text-amber-300">
                              <strong>[검증 가설]</strong> {ct.working_hypothesis}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              {/* Section E: Literature-Based Discussion */}
              {reportSnapshot.ai_interpretation.literature_discussion && (
                <div className="p-4 rounded-xl border border-border bg-background space-y-2 text-xs">
                  <div className="font-bold text-sm text-foreground flex items-center gap-1.5">
                    <BookOpen className="w-4 h-4 text-primary" />
                    <span>E. Literature-Based Discussion (학술 선행연구 대조 고찰)</span>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    {reportSnapshot.ai_interpretation.literature_discussion.key_findings}
                  </p>
                  <div className="p-3 rounded-lg bg-muted/30 space-y-1 text-[11px]">
                    <div>
                      <strong>측정치 대조:</strong>{" "}
                      {reportSnapshot.ai_interpretation.literature_discussion.comparison_with_measurements}
                    </div>
                    <div>
                      <strong>물리적 메커니즘:</strong>{" "}
                      {reportSnapshot.ai_interpretation.literature_discussion.mechanistic_insights}
                    </div>
                    <div className="text-amber-700 dark:text-amber-300">
                      <strong>문헌 적용 주의점:</strong>{" "}
                      {reportSnapshot.ai_interpretation.literature_discussion.literature_applicability_limits}
                    </div>
                  </div>
                </div>
              )}

              {/* Section F: Limitations and Future Work */}
              {reportSnapshot.ai_interpretation.limitations_and_future_work && (
                <div className="p-4 rounded-xl border border-border bg-background space-y-2 text-xs">
                  <div className="font-bold text-sm text-foreground">
                    F. Limitations & Future Work (분석 한계점 및 후속 연구 제안)
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    {reportSnapshot.ai_interpretation.limitations_and_future_work.unresolved_aspects}
                  </p>
                  <div className="pt-1.5">
                    <div className="font-semibold text-foreground mb-1">권장 후속 실험:</div>
                    <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                      {reportSnapshot.ai_interpretation.limitations_and_future_work.suggested_next_experiments.map(
                        (exp, eIdx) => (
                          <li key={eIdx}>{exp}</li>
                        )
                      )}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ================================================================= */}
          {/* 5. References Section (실제 검색·검증된 문헌 목록) */}
          {/* ================================================================= */}
          <div id="sec-references" className="p-6 rounded-2xl border border-border bg-card shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-primary" />
                <h3 className="text-base font-bold text-foreground">
                  G. References (실제 학술 문헌 근거)
                </h3>
              </div>
              <span className="text-xs text-muted-foreground">
                (OpenAlex, Crossref, Curated DB에서 실제 검증된 문헌만 등재)
              </span>
            </div>

            {reportSnapshot.references && reportSnapshot.references.length > 0 ? (
              <div className="space-y-3">
                {reportSnapshot.references.map((ref, rIdx) => (
                  <div
                    key={rIdx}
                    className="p-3.5 rounded-xl border border-border bg-background text-xs space-y-1"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-foreground">
                        [{rIdx + 1}] {ref.title}
                      </div>
                      {ref.doi && (
                        <a
                          href={ref.oa_url || `https://doi.org/${ref.doi}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline font-mono shrink-0"
                        >
                          DOI: {ref.doi}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>

                    <div className="text-[11px] text-muted-foreground">
                      저자: {(ref.authors || []).join(", ") || "연구진"} • 출판: {ref.journal || "학술지"} ({ref.year || "연도 미상"})
                    </div>

                    {ref.key_claims && ref.key_claims.length > 0 && (
                      <div className="text-[11px] text-muted-foreground/90 pt-1">
                        <strong>주요 실측 보고치:</strong> {ref.key_claims.join("; ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-muted-foreground border border-dashed rounded-xl">
                본 시료 조건에 직접 매칭되는 Open Access 문헌이 확인되지 않았습니다. 일반 과학적 법칙에 기반하여 분석되었습니다.
              </div>
            )}
          </div>
        </section>
      )}

      {/* ===================================================================== */}
      {/* Explanation Modal Popup */}
      {/* ===================================================================== */}
      {explanationModalKey && VISUALIZATION_EXPLANATIONS[explanationModalKey] && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-primary" />
                <h3 className="text-base font-bold text-foreground">
                  {VISUALIZATION_EXPLANATIONS[explanationModalKey].title} 해설
                </h3>
              </div>
              <button
                onClick={() => setExplanationModalKey(null)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs text-foreground leading-relaxed max-h-[70vh] overflow-y-auto">
              <div className="space-y-1">
                <div className="font-bold text-primary">1. 그래프 / 이미지 설명</div>
                <p className="text-muted-foreground">
                  {VISUALIZATION_EXPLANATIONS[explanationModalKey].description}
                </p>
              </div>

              <div className="space-y-1">
                <div className="font-bold text-primary">2. 핵심 관찰 결과</div>
                <p className="text-muted-foreground">
                  {VISUALIZATION_EXPLANATIONS[explanationModalKey].keyObservations}
                </p>
              </div>

              <div className="space-y-1">
                <div className="font-bold text-primary">3. 과학적 의미 (재료학적 해석)</div>
                <p className="text-muted-foreground">
                  {VISUALIZATION_EXPLANATIONS[explanationModalKey].scientificMeaning}
                </p>
              </div>

              <div className="space-y-1">
                <div className="font-bold text-amber-600 dark:text-amber-400">
                  4. 분석 시 주의사항
                </div>
                <p className="text-muted-foreground">
                  {VISUALIZATION_EXPLANATIONS[explanationModalKey].precautions}
                </p>
              </div>
            </div>

            <div className="pt-3 border-t border-border flex justify-end">
              <button
                onClick={() => setExplanationModalKey(null)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* Zoomed Image Modal */}
      {/* ===================================================================== */}
      {zoomedImageSrc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="relative max-w-5xl w-full rounded-2xl overflow-hidden bg-card border border-border shadow-2xl flex flex-col">
            <div className="flex items-center justify-between p-3.5 border-b border-border bg-card">
              <span className="font-bold text-xs text-foreground">{zoomedImageSrc.title}</span>
              <button
                onClick={() => setZoomedImageSrc(null)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 flex items-center justify-center max-h-[80vh] overflow-auto bg-black/10">
              <img
                src={zoomedImageSrc.src}
                alt={zoomedImageSrc.title}
                className="max-h-[75vh] w-auto object-contain rounded-lg shadow-sm"
              />
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* Zoomed Chart Modal */}
      {/* ===================================================================== */}
      {zoomedChartInst && reportSnapshot && reportSnapshot.multi_curves?.[zoomedChartInst] && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="relative max-w-5xl w-full rounded-2xl overflow-hidden bg-card border border-border shadow-2xl flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border bg-card">
              <span className="font-bold text-sm text-foreground">
                {zoomedChartInst} 측정 곡선 확대 보기
              </span>
              <button
                onClick={() => setZoomedChartInst(null)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 bg-background">
              {zoomedChartInst === "XRD" && (
                <PlotlyChart
                  data={reportSnapshot.multi_curves["XRD"].map((c) => ({
                    x: c.two_theta,
                    y: c.intensity,
                    name: c.label,
                    type: "scatter",
                    mode: "lines",
                    line: { width: 2.2 },
                  }))}
                  layout={{
                    xaxis: { title: "2θ (degrees)" },
                    yaxis: { title: "회절 강도 (Counts)" },
                    margin: { t: 30, r: 20, l: 60, b: 60 },
                  }}
                  height={550}
                />
              )}
              {zoomedChartInst === "UTM" && (
                <PlotlyChart
                  data={reportSnapshot.multi_curves["UTM"].map((c) => ({
                    x: c.strain,
                    y: c.stress,
                    name: c.label,
                    type: "scatter",
                    mode: "lines",
                    line: { width: 2.2 },
                  }))}
                  layout={{
                    xaxis: { title: "공칭 변형률 (%)" },
                    yaxis: { title: "공칭 응력 (MPa)" },
                    margin: { t: 30, r: 20, l: 60, b: 60 },
                  }}
                  height={550}
                />
              )}
              {zoomedChartInst === "Hall" && (
                <PlotlyChart
                  data={reportSnapshot.multi_curves["Hall"].map((c) => ({
                    x: c.b_field,
                    y: c.hall_voltage,
                    name: c.label,
                    type: "scatter",
                    mode: "lines+markers",
                  }))}
                  layout={{
                    xaxis: { title: "자기장 B (T)" },
                    yaxis: { title: "홀 전압 V_H (mV)" },
                    margin: { t: 30, r: 20, l: 60, b: 60 },
                  }}
                  height={550}
                />
              )}
              {zoomedChartInst === "LFA" && (
                <PlotlyChart
                  data={reportSnapshot.multi_curves["LFA"].map((c) => ({
                    x: c.time_s,
                    y: c.rear_temp,
                    name: c.label,
                    type: "scatter",
                    mode: "lines",
                  }))}
                  layout={{
                    xaxis: { title: "시간 (s)" },
                    yaxis: { title: "후면 온도 상승 (°C / ΔT)" },
                    margin: { t: 30, r: 20, l: 60, b: 60 },
                  }}
                  height={550}
                />
              )}
              {zoomedChartInst === "FT-IR" && (
                <PlotlyChart
                  data={reportSnapshot.multi_curves["FT-IR"].map((c) => ({
                    x: c.wavenumber,
                    y: c.signal,
                    name: c.label,
                    type: "scatter",
                    mode: "lines",
                  }))}
                  layout={{
                    xaxis: { title: "파수 (cm⁻¹)", autorange: "reversed" },
                    yaxis: { title: "투과율 (%T) / 흡광도" },
                    margin: { t: 30, r: 20, l: 60, b: 60 },
                  }}
                  height={550}
                />
              )}
              {zoomedChartInst === "DSC" && (
                <PlotlyChart
                  data={reportSnapshot.multi_curves["DSC"].map((c) => ({
                    x: c.temperature,
                    y: c.heat_flow,
                    name: c.label,
                    type: "scatter",
                    mode: "lines",
                  }))}
                  layout={{
                    xaxis: { title: "온도 (°C)" },
                    yaxis: { title: "열류 (mW 또는 W/g)" },
                    margin: { t: 30, r: 20, l: 60, b: 60 },
                  }}
                  height={550}
                />
              )}
              {zoomedChartInst === "TGA" && (
                <PlotlyChart
                  data={reportSnapshot.multi_curves["TGA"].map((c) => ({
                    x: c.temperature,
                    y: c.mass_percent,
                    name: c.label,
                    type: "scatter",
                    mode: "lines",
                  }))}
                  layout={{
                    xaxis: { title: "온도 (°C)" },
                    yaxis: { title: "잔류 중량 (%)" },
                    margin: { t: 30, r: 20, l: 60, b: 60 },
                  }}
                  height={550}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
