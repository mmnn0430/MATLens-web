import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Flame,
  Info,
  Layers,
  Loader2,
  MessageSquare,
  Microscope,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Thermometer,
  Trash2,
  Waves,
  Zap,
} from "lucide-react";
import { api } from "../api";
import { PlotlyChart } from "./PlotlyChart";
import type {
  IntegratedReportSnapshot,
  ProjectDetail,
  RunDetail,
  SavedAnalysisCounts,
  SavedAnalysisItem,
  ScopedAnalysisSelection,
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
    unitDesc: "특성 흡수 파수(cm⁻¹), 작용기 동정, 박막 두께",
  },
  DSC: {
    name: "DSC",
    label: "DSC (시차주사열량)",
    category: "상전이 · 용융 엔탈피",
    mode: "dsc",
    icon: Thermometer,
    accentColor: "border-orange-500 text-orange-600 bg-orange-50 dark:bg-orange-950/30",
    unitDesc: "유리전이(Tg), 결정화(Tc), 융점(Tm), 결정화도",
  },
  TGA: {
    name: "TGA",
    label: "TGA (열중량분석)",
    category: "열분해 · 고온 감량",
    mode: "tga",
    icon: FileSpreadsheet,
    accentColor: "border-indigo-500 text-indigo-600 bg-indigo-50 dark:bg-indigo-950/30",
    unitDesc: "5%/10% 감량온도(T5, T10), 단계별 감량률, 잔류물",
  },
};

const ALL_INSTRUMENTS = ["XRD", "SEM", "UTM", "Hall", "LFA", "FT-IR", "DSC", "TGA"];

export function IntegratedAnalysisView({
  activeProject: _activeProject,
  activeRun: _activeRun,
  onNavigateMode,
}: IntegratedAnalysisViewProps) {
  // ---------------------------------------------------------------------------
  // Step 1: Instrument Selection State (Default: EMPTY - no auto-selection)
  // ---------------------------------------------------------------------------
  const [selectedInstruments, setSelectedInstruments] = useState<string[]>([]);
  const [savedCounts, setSavedCounts] = useState<SavedAnalysisCounts>({});
  const [isCountsLoading, setIsCountsLoading] = useState<boolean>(true);

  // ---------------------------------------------------------------------------
  // Step 2: Saved Analysis Results Data & Filter State
  // ---------------------------------------------------------------------------
  const [savedItems, setSavedItems] = useState<SavedAnalysisItem[]>([]);
  const [isItemsLoading, setIsItemsLoading] = useState<boolean>(false);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filterSampleId, setFilterSampleId] = useState<string>("all");

  // ---------------------------------------------------------------------------
  // Step 3 & 4: Report Execution & Snapshot State
  // ---------------------------------------------------------------------------
  const [temperatureK, setTemperatureK] = useState<number>(300.0);
  const [userNotes, setUserNotes] = useState<string>("");
  const [customReportTitle, setCustomReportTitle] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Stored immutable report snapshot (initially NULL - never auto-load sample data!)
  const [reportSnapshot, setReportSnapshot] = useState<IntegratedReportSnapshot | null>(null);
  const [lastGeneratedSelectionKey, setLastGeneratedSelectionKey] = useState<string | null>(null);

  // Assistant Chat State (Strictly scoped)
  const [chatMessage, setChatMessage] = useState<string>("");
  const [chatHistory, setChatHistory] = useState<Array<{ sender: "user" | "assistant"; text: string }>>([]);
  const [isChatLoading, setIsChatLoading] = useState<boolean>(false);

  // Active chart tab in multi-curve visualization
  const [activeChartTab, setActiveChartTab] = useState<string>("XRD");

  // ---------------------------------------------------------------------------
  // 1. Initial Load: Counts & Saved Items
  // ---------------------------------------------------------------------------
  const refreshSavedData = useCallback(async () => {
    setIsCountsLoading(true);
    setIsItemsLoading(true);
    try {
      const countsResp = await api.getSavedAnalysesCounts();
      setSavedCounts(countsResp.counts || {});

      const itemsResp = await api.getSavedAnalyses();
      setSavedItems(itemsResp.items || []);
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

  // Restore session snapshot from URL (?session=...) if present
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const reportId = sp.get("session") || sp.get("report_id");
    if (reportId && !reportSnapshot) {
      api
        .getReportSnapshot(reportId)
        .then((snapshot) => {
          if (snapshot && snapshot.report_id) {
            setReportSnapshot(snapshot);
            setSelectedInstruments(snapshot.selected_instruments || []);
            const selIds = (snapshot.selected_items || []).map((s) => s.id);
            setSelectedItemIds(selIds);
            setLastGeneratedSelectionKey(selIds.slice().sort().join("|"));
          }
        })
        .catch(() => {});
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Step 1: Instrument Toggle Logic
  // ---------------------------------------------------------------------------
  const handleToggleInstrument = (inst: string) => {
    setSelectedInstruments((prev) => {
      const exists = prev.includes(inst);
      if (exists) {
        // Remove instrument and deselect all items belonging to it
        const next = prev.filter((i) => i !== inst);
        setSelectedItemIds((currSel) =>
          currSel.filter((id) => {
            const item = savedItems.find((it) => it.id === id);
            return item && item.instrument !== inst;
          })
        );
        return next;
      } else {
        return [...prev, inst];
      }
    });
  };

  // ---------------------------------------------------------------------------
  // Step 2: Item Selection Logic
  // ---------------------------------------------------------------------------
  const handleToggleItem = (itemId: string) => {
    const item = savedItems.find((it) => it.id === itemId);
    if (!item || item.status === "needs_analysis") return;

    setSelectedItemIds((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
    );
  };

  const handleResetSelection = () => {
    setSelectedItemIds([]);
  };

  // Filter items by selected instruments, search text, and sample dropdown
  const filteredItems = useMemo(() => {
    return savedItems.filter((it) => {
      if (!selectedInstruments.includes(it.instrument)) return false;
      if (filterSampleId !== "all" && it.sample_id !== filterSampleId) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = it.sample_name.toLowerCase().includes(q);
        const matchesFile = it.original_filename.toLowerCase().includes(q);
        const matchesSummary = (it.summary_text || "").toLowerCase().includes(q);
        if (!matchesName && !matchesFile && !matchesSummary) return false;
      }
      return true;
    });
  }, [savedItems, selectedInstruments, filterSampleId, searchQuery]);

  // Unique samples present in filtered saved items
  const availableSamples = useMemo(() => {
    const map = new Map<string, string>();
    savedItems.forEach((it) => {
      if (!map.has(it.sample_id)) {
        map.set(it.sample_id, it.sample_name);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [savedItems]);

  // Selected items objects
  const selectedItemsList = useMemo(() => {
    return savedItems.filter((it) => selectedItemIds.includes(it.id));
  }, [savedItems, selectedItemIds]);

  // Check instrument validation: every chosen instrument must have >= 1 completed item selected
  const validationStatus = useMemo(() => {
    if (selectedInstruments.length === 0) {
      return { valid: false, message: "분석에 사용할 기기를 1개 이상 선택해 주세요." };
    }
    const missingInsts = selectedInstruments.filter(
      (inst) => !selectedItemsList.some((it) => it.instrument === inst && it.status === "completed")
    );
    if (missingInsts.length > 0) {
      return {
        valid: false,
        message: `선택한 기기 [${missingInsts.join(", ")}]의 저장된 분석 결과를 최소 1개 이상 선택해야 합니다.`,
      };
    }
    return { valid: true, message: "" };
  }, [selectedInstruments, selectedItemsList]);

  // Sample Linkage Assessment
  const linkageAssessment = useMemo(() => {
    const distinctSampleIds = Array.from(new Set(selectedItemsList.map((it) => it.sample_id)));
    if (distinctSampleIds.length <= 1) {
      return {
        isSameSample: true,
        badgeText: "동일 시료 다각 연계 분석",
        colorClass: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-700",
        desc: "선택된 모든 데이터가 단일 시료에 속해 있어 결정구조–미세조직–물성 간의 교차 해석이 직접 가능합니다.",
      };
    } else {
      return {
        isSameSample: false,
        badgeText: "복수 시료 비교 분석 모드",
        colorClass: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-700",
        desc: "서로 다른 시료가 포함되어 있습니다. 시료 및 공정 조건 간의 정량적 물성 차이를 비교 분석합니다.",
      };
    }
  }, [selectedItemsList]);

  // Detect if user modified selection after report was generated
  const currentSelectionKey = useMemo(() => {
    return selectedItemIds.slice().sort().join("|");
  }, [selectedItemIds]);

  const isSelectionChangedAfterGeneration = Boolean(
    reportSnapshot && lastGeneratedSelectionKey && lastGeneratedSelectionKey !== currentSelectionKey
  );

  // ---------------------------------------------------------------------------
  // Step 4: Generate Scoped Integrated Report
  // ---------------------------------------------------------------------------
  const handleGenerateReport = async () => {
    if (!validationStatus.valid) return;

    setIsGenerating(true);
    setGenerationError(null);
    try {
      const selections: ScopedAnalysisSelection[] = selectedItemsList.map((it) => ({
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
      }));

      const payload = {
        title: customReportTitle.trim() || undefined,
        selected_items: selections,
        temperature_K: temperatureK,
        user_notes: userNotes.trim() || undefined,
        run_ai: true,
      };

      const result = await api.runIntegratedScopedAnalysis(payload);
      setReportSnapshot(result);
      setLastGeneratedSelectionKey(currentSelectionKey);

      // Set active chart tab to the first instrument present in curves
      const firstCurveInst = Object.keys(result.multi_curves || {})[0] || result.selected_instruments[0] || "XRD";
      setActiveChartTab(firstCurveInst);

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
  // Assistant Chat Logic
  // ---------------------------------------------------------------------------
  const handleSendChat = async () => {
    if (!chatMessage.trim() || !reportSnapshot || isChatLoading) return;

    const userText = chatMessage.trim();
    setChatMessage("");
    setChatHistory((prev) => [...prev, { sender: "user", text: userText }]);
    setIsChatLoading(true);

    try {
      const resp = await fetch("/api/v1/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userText,
          report_id: reportSnapshot.report_id,
          material_name: reportSnapshot.material_name,
          instrument: reportSnapshot.selected_instruments.join(" · "),
          calculated_properties: reportSnapshot.analysis_result?.key_metrics_table,
        }),
      });
      const data = await resp.json();
      const reply = data.reply || "답변을 가져오지 못했습니다.";
      setChatHistory((prev) => [...prev, { sender: "assistant", text: reply }]);
    } catch {
      setChatHistory((prev) => [
        ...prev,
        { sender: "assistant", text: "상담 처리 중 오류가 발생했습니다. 다시 시도해 주세요." },
      ]);
    } finally {
      setIsChatLoading(false);
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
                분석에 사용할 기기와 실제 저장된 결과만 엄격히 선별하여 왜곡 없는 다각 구조–물성 연계 리포트를 생성합니다.
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
      {/* STEP 1: 사용할 분석 기기 선택 (8개 기기 카드 체크박스) */}
      {/* ===================================================================== */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
              1
            </span>
            <h2 className="text-lg font-semibold text-foreground">분석에 사용할 기기 선택</h2>
            <span className="text-xs text-muted-foreground">
              (기본 미선택 상태 · 원하는 기기를 복수 선택하세요)
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
            const count = savedCounts[inst] || 0;
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
                      isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => {}} // handled by parent div onClick
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
                    className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${
                      count > 0
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {count}건 저장
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* 안내: 선택된 기기 중 저장된 결과가 0건인 기기 처리 */}
        {selectedInstruments.some((inst) => (savedCounts[inst] || 0) === 0) && (
          <div className="space-y-2">
            {selectedInstruments
              .filter((inst) => (savedCounts[inst] || 0) === 0)
              .map((inst) => {
                const meta = INSTRUMENT_METADATA[inst];
                return (
                  <div
                    key={inst}
                    className="flex items-center justify-between p-3 rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                      <span>
                        <strong>[{inst}]</strong> 선택됨 — 현재 저장된 분석 결과가 없습니다.
                      </span>
                    </div>
                    {onNavigateMode && (
                      <button
                        onClick={() => onNavigateMode(meta.mode)}
                        className="inline-flex items-center gap-1 px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg shadow-sm transition-colors"
                      >
                        {inst} 분석 화면으로 이동
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </section>

      {/* ===================================================================== */}
      {/* STEP 2: 선택한 기기의 저장된 분석 결과 선택 */}
      {/* ===================================================================== */}
      {selectedInstruments.length > 0 && (
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                2
              </span>
              <h2 className="text-lg font-semibold text-foreground">
                선택한 기기의 저장된 분석 결과 선택
              </h2>
              <span className="text-xs text-muted-foreground">
                (선택하지 않은 기기는 목록에 펼치지 않습니다)
              </span>
            </div>

            <div className="flex items-center gap-2">
              {selectedItemIds.length > 0 && (
                <button
                  onClick={handleResetSelection}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground underline px-2 py-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  선택 초기화 ({selectedItemIds.length}개)
                </button>
              )}
            </div>
          </div>

          {/* Search & Filter Toolbar */}
          <div className="flex flex-col sm:flex-row gap-3 p-3.5 rounded-xl border border-border bg-card">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="시료명, 시료 코드, 파일명, 요약 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div className="w-full sm:w-64">
              <select
                value={filterSampleId}
                onChange={(e) => setFilterSampleId(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="all">전체 시료 필터 (전체 보기)</option>
                {availableSamples.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.id})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Per-Instrument Accordion / Sections */}
          <div className="space-y-4">
            {selectedInstruments.map((inst) => {
              const meta = INSTRUMENT_METADATA[inst];
              const instItems = filteredItems.filter((it) => it.instrument === inst);
              const Icon = meta.icon;
              const selectedCount = instItems.filter((it) => selectedItemIds.includes(it.id)).length;

              return (
                <div
                  key={inst}
                  className="rounded-xl border border-border bg-card shadow-sm overflow-hidden"
                >
                  <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-b border-border">
                    <div className="flex items-center gap-2.5">
                      <Icon className="w-4 h-4 text-primary" />
                      <span className="font-semibold text-sm text-foreground">{inst} 분석 결과</span>
                      <span className="text-xs text-muted-foreground">({instItems.length}건 조회됨)</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          selectedCount > 0
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {selectedCount}개 선택됨
                      </span>
                    </div>
                  </div>

                  <div className="p-4">
                    {instItems.length === 0 ? (
                      <div className="text-center py-6 text-xs text-muted-foreground">
                        {searchQuery || filterSampleId !== "all"
                          ? "검색 조건에 맞는 결과가 없습니다."
                          : "저장된 분석 결과가 없습니다."}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {instItems.map((item) => {
                          const isItemSelected = selectedItemIds.includes(item.id);
                          const isCompleted = item.status === "completed";

                          return (
                            <div
                              key={item.id}
                              onClick={() => isCompleted && handleToggleItem(item.id)}
                              className={`p-3.5 rounded-lg border transition-all ${
                                !isCompleted
                                  ? "border-border/60 bg-muted/20 opacity-70 cursor-not-allowed"
                                  : isItemSelected
                                  ? "border-primary bg-primary/5 ring-1 ring-primary cursor-pointer"
                                  : "border-border hover:border-border/80 bg-background cursor-pointer"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={isItemSelected}
                                    disabled={!isCompleted}
                                    onChange={() => {}}
                                    className="w-4 h-4 rounded text-primary border-border focus:ring-primary pointer-events-none"
                                  />
                                  <div>
                                    <div className="font-semibold text-xs text-foreground flex items-center gap-1.5">
                                      <span>{item.sample_name}</span>
                                      <span className="text-[10px] font-normal text-muted-foreground">
                                        ({item.sample_id})
                                      </span>
                                    </div>
                                    <div className="text-[11px] text-muted-foreground truncate" title={item.original_filename}>
                                      📄 {item.original_filename}
                                    </div>
                                  </div>
                                </div>

                                <div className="text-right shrink-0">
                                  <span
                                    className={`inline-block text-[10px] px-2 py-0.5 rounded font-medium ${
                                      isCompleted
                                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                        : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                    }`}
                                  >
                                    {isCompleted ? "분석 완료" : "분석 필요"}
                                  </span>
                                  <div className="text-[10px] text-muted-foreground mt-0.5">
                                    {item.version_label}
                                  </div>
                                </div>
                              </div>

                              <div className="mt-2.5 pt-2 border-t border-border/40 text-[11px] text-muted-foreground line-clamp-2">
                                {item.summary_text || "분석 요약 정보가 없습니다."}
                              </div>

                              <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground/80">
                                <span>실행 시각: {new Date(item.created_at).toLocaleString("ko-KR")}</span>
                                {item.raw_curve_available && (
                                  <span className="text-primary font-medium">곡선 데이터 포함</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ===================================================================== */}
      {/* STEP 3: 선택 내용 확인 및 시료 연결성 검증 */}
      {/* ===================================================================== */}
      {selectedInstruments.length > 0 && (
        <section className="p-5 rounded-2xl border-2 border-primary/20 bg-card shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
              3
            </span>
            <h2 className="text-lg font-semibold text-foreground">선택 내용 및 시료 연결 확인</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Selection Summary */}
            <div className="p-3.5 rounded-xl border border-border bg-background space-y-2">
              <div className="text-xs font-semibold text-foreground">이번 리포트에 포함할 데이터 요약</div>
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <span>
                  선택된 기기: <strong className="text-foreground">{selectedInstruments.length}개</strong>
                </span>
                <span>•</span>
                <span>
                  선택된 분석 결과: <strong className="text-foreground">{selectedItemsList.length}건</strong>
                </span>
              </div>

              <div className="pt-2 border-t border-border/50 max-h-36 overflow-y-auto space-y-1">
                {selectedItemsList.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-2 text-center">
                    아직 선택된 분석 결과가 없습니다. 위 2단계에서 항목을 체크하세요.
                  </div>
                ) : (
                  selectedItemsList.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between text-[11px] text-muted-foreground"
                    >
                      <span className="truncate">
                        <strong>[{item.instrument}]</strong> {item.original_filename} ({item.sample_name})
                      </span>
                      <button
                        onClick={() => handleToggleItem(item.id)}
                        className="text-muted-foreground hover:text-destructive ml-2"
                        title="선택 해제"
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Specimen Linkage Badge */}
            <div className="p-3.5 rounded-xl border border-border bg-background space-y-2.5 flex flex-col justify-between">
              <div>
                <div className="text-xs font-semibold text-foreground">시료 간 연결 관계 검증</div>
                <div className="mt-2">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border ${linkageAssessment.colorClass}`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    {linkageAssessment.badgeText}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                  {linkageAssessment.desc}
                </p>
              </div>

              <div className="flex flex-col gap-2 pt-2 border-t border-border/50">
                <div className="flex items-center gap-3">
                  <label className="text-xs font-medium text-foreground shrink-0">
                    측정/해석 온도:
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      value={temperatureK}
                      onChange={(e) => setTemperatureK(Number(e.target.value) || 300)}
                      className="w-20 px-2 py-1 text-xs rounded border border-border bg-background text-foreground"
                    />
                    <span className="text-xs text-muted-foreground">K ({(temperatureK - 273.15).toFixed(1)} °C)</span>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-foreground">
                    리포트 제목 (선택):
                  </label>
                  <input
                    type="text"
                    placeholder="미입력 시 기본 제목 자동 생성"
                    value={customReportTitle}
                    onChange={(e) => setCustomReportTitle(e.target.value)}
                    className="w-full px-2.5 py-1 text-xs rounded border border-border bg-background text-foreground placeholder:text-muted-foreground/60"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-foreground">
                    연구자 메모 / 공정 조건 (AI 해석에 반영):
                  </label>
                  <input
                    type="text"
                    placeholder="예: Ti 5 at% 치환 도핑, SPS 소결 조건 등"
                    value={userNotes}
                    onChange={(e) => setUserNotes(e.target.value)}
                    className="w-full px-2.5 py-1 text-xs rounded border border-border bg-background text-foreground placeholder:text-muted-foreground/60"
                  />
                </div>
              </div>
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
                  <span>모든 선택 기기의 데이터가 준비되었습니다. 통합 리포트를 생성할 수 있습니다.</span>
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
                  선택 결과 엄격 분석 중...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  통합 리포트 생성
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
      {/* STEP 4: 생성된 통합 리포트 표시 (선택된 데이터만 엄격 반영) */}
      {/* ===================================================================== */}
      {reportSnapshot && (
        <section className="space-y-6 pt-6 border-t border-border">
          {/* Outdated Notice Banner */}
          {isSelectionChangedAfterGeneration && (
            <div className="p-4 rounded-xl border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md animate-pulse">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
                <div>
                  <div className="font-bold text-sm">선택 내용이 변경되었습니다.</div>
                  <div className="text-xs text-amber-800 dark:text-amber-300">
                    현재 보고 계신 리포트는 이전 선택 기준 스냅샷입니다. 변경된 항목을 반영하려면 리포트를 다시 생성해주세요.
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

          {/* Report Top Header & Scope Statement */}
          <div className="p-6 rounded-2xl border border-border bg-card shadow-sm space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <span className="text-xs font-bold text-primary tracking-wider uppercase">
                  MatLens Scientific Analysis Report
                </span>
                <h2 className="text-2xl font-extrabold text-foreground mt-1">
                  {reportSnapshot.title}
                </h2>
                <div className="text-xs text-muted-foreground mt-1.5 flex flex-wrap items-center gap-3">
                  <span>시료: <strong className="text-foreground">{reportSnapshot.material_name}</strong></span>
                  <span>•</span>
                  <span>생성 시각: {new Date(reportSnapshot.created_at).toLocaleString("ko-KR")}</span>
                  <span>•</span>
                  <span>스냅샷 ID: <code className="text-primary font-mono">{reportSnapshot.report_id}</code></span>
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
                선택된 데이터 범위 (Strict Scope Statement)
              </div>
              <p className="text-muted-foreground leading-relaxed">
                본 리포트는 연구자가 명시적으로 선택한 <strong>[{reportSnapshot.selected_instruments.join(", ")}]</strong>의{" "}
                <strong>{reportSnapshot.selected_items.length}개 분석 결과</strong>만을 엄격히 분석 대상으로 사용하였으며,
                선택되지 않은 다른 기기의 물성은 해석 및 계산 대상에서 완전히 제외되었습니다.
              </p>
            </div>
          </div>

          {/* 1. Multi-Curve Comparative Visualization */}
          {reportSnapshot.multi_curves && Object.keys(reportSnapshot.multi_curves).length > 0 && (
            <div className="p-6 rounded-2xl border border-border bg-card shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers className="w-5 h-5 text-primary" />
                  <h3 className="text-base font-bold text-foreground">다중 기기 측정 곡선 및 미세조직 시각화</h3>
                </div>

                {/* Tabs for curve instruments */}
                <div className="flex items-center gap-1 p-1 rounded-lg bg-muted">
                  {Object.keys(reportSnapshot.multi_curves).map((inst) => (
                    <button
                      key={inst}
                      onClick={() => setActiveChartTab(inst)}
                      className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
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

              {/* Chart Content */}
              <div className="pt-2">
                {activeChartTab === "XRD" && reportSnapshot.multi_curves["XRD"] && (
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
                      title: "XRD 회절 패턴 비교 (2θ vs Intensity)",
                      xaxis: { title: "2θ (degrees)" },
                      yaxis: { title: "회절 강도 (Counts)" },
                      legend: { orientation: "h", y: -0.2 },
                      margin: { t: 40, r: 20, l: 50, b: 60 },
                    }}
                    height={380}
                  />
                )}

                {activeChartTab === "UTM" && reportSnapshot.multi_curves["UTM"] && (
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
                      title: "UTM 응력-변형률 곡선 (Stress vs Strain)",
                      xaxis: { title: "공칭 변형률 (%)" },
                      yaxis: { title: "공칭 응력 (MPa)" },
                      legend: { orientation: "h", y: -0.2 },
                      margin: { t: 40, r: 20, l: 50, b: 60 },
                    }}
                    height={380}
                  />
                )}

                {activeChartTab === "Hall" && reportSnapshot.multi_curves["Hall"] && (
                  <PlotlyChart
                    data={reportSnapshot.multi_curves["Hall"].map((c) => ({
                      x: c.b_field,
                      y: c.hall_voltage,
                      name: c.label,
                      type: "scatter",
                      mode: "lines+markers",
                    }))}
                    layout={{
                      title: "Hall 전압-자기장 응답 (B vs V_H)",
                      xaxis: { title: "자기장 B (T)" },
                      yaxis: { title: "홀 전압 V_H (mV)" },
                      legend: { orientation: "h", y: -0.2 },
                      margin: { t: 40, r: 20, l: 50, b: 60 },
                    }}
                    height={380}
                  />
                )}

                {activeChartTab === "LFA" && reportSnapshot.multi_curves["LFA"] && (
                  <PlotlyChart
                    data={reportSnapshot.multi_curves["LFA"].map((c) => ({
                      x: c.time_s,
                      y: c.rear_temp,
                      name: c.label,
                      type: "scatter",
                      mode: "lines",
                    }))}
                    layout={{
                      title: "LFA 레이저 섬광 과도 온도 곡선 (Time vs Temperature)",
                      xaxis: { title: "시간 (s)" },
                      yaxis: { title: "후면 온도 상승 (°C / ΔT)" },
                      legend: { orientation: "h", y: -0.2 },
                      margin: { t: 40, r: 20, l: 50, b: 60 },
                    }}
                    height={380}
                  />
                )}

                {activeChartTab === "FT-IR" && reportSnapshot.multi_curves["FT-IR"] && (
                  <PlotlyChart
                    data={reportSnapshot.multi_curves["FT-IR"].map((c) => ({
                      x: c.wavenumber,
                      y: c.signal,
                      name: c.label,
                      type: "scatter",
                      mode: "lines",
                    }))}
                    layout={{
                      title: "FT-IR 적외선 분광 스펙트럼",
                      xaxis: { title: "파수 (cm⁻¹)", autorange: "reversed" },
                      yaxis: { title: "투과율 (%T) / 흡광도" },
                      legend: { orientation: "h", y: -0.2 },
                      margin: { t: 40, r: 20, l: 50, b: 60 },
                    }}
                    height={380}
                  />
                )}

                {activeChartTab === "DSC" && reportSnapshot.multi_curves["DSC"] && (
                  <PlotlyChart
                    data={reportSnapshot.multi_curves["DSC"].map((c) => ({
                      x: c.temperature,
                      y: c.heat_flow,
                      name: c.label,
                      type: "scatter",
                      mode: "lines",
                    }))}
                    layout={{
                      title: "DSC 열류량 곡선 (Heat Flow vs Temperature)",
                      xaxis: { title: "온도 (°C)" },
                      yaxis: { title: "열류 (mW 또는 W/g)" },
                      legend: { orientation: "h", y: -0.2 },
                      margin: { t: 40, r: 20, l: 50, b: 60 },
                    }}
                    height={380}
                  />
                )}

                {activeChartTab === "TGA" && reportSnapshot.multi_curves["TGA"] && (
                  <PlotlyChart
                    data={reportSnapshot.multi_curves["TGA"].map((c) => ({
                      x: c.temperature,
                      y: c.mass_percent,
                      name: c.label,
                      type: "scatter",
                      mode: "lines",
                    }))}
                    layout={{
                      title: "TGA 중량 감량 곡선 (Mass % vs Temperature)",
                      xaxis: { title: "온도 (°C)" },
                      yaxis: { title: "잔류 중량 (%)" },
                      legend: { orientation: "h", y: -0.2 },
                      margin: { t: 40, r: 20, l: 50, b: 60 },
                    }}
                    height={380}
                  />
                )}
              </div>
            </div>
          )}

          {/* 2. Key Quantitative Metrics Table */}
          {reportSnapshot.analysis_result?.key_metrics_table && (
            <div className="p-6 rounded-2xl border border-border bg-card shadow-sm space-y-4">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-primary" />
                <h3 className="text-base font-bold text-foreground">주요 정량 물성 지표 표</h3>
              </div>

              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border text-foreground font-semibold">
                      <th className="py-2.5 px-3">기기</th>
                      <th className="py-2.5 px-3">물성 지표명</th>
                      <th className="py-2.5 px-3">값</th>
                      <th className="py-2.5 px-3">단위</th>
                      <th className="py-2.5 px-3">측정/계산 조건</th>
                      <th className="py-2.5 px-3">구분</th>
                      <th className="py-2.5 px-3">데이터 출처</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {reportSnapshot.analysis_result.key_metrics_table.map((row, idx) => (
                      <tr key={idx} className="hover:bg-muted/20">
                        <td className="py-2 px-3 font-bold text-primary">{row.instrument}</td>
                        <td className="py-2 px-3 font-medium text-foreground">{row.metric_name}</td>
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
            </div>
          )}

          {/* 3. Cross-Instrument Correlations (Strictly Scoped) */}
          {reportSnapshot.analysis_result?.cross_correlations &&
            reportSnapshot.analysis_result.cross_correlations.length > 0 && (
              <div className="p-6 rounded-2xl border border-border bg-card shadow-sm space-y-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-primary" />
                  <h3 className="text-base font-bold text-foreground">선택 기기간 교차 상관성 분석</h3>
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

          {/* 4. AI Structured Scientific Interpretation */}
          {reportSnapshot.ai_interpretation && (
            <div className="p-6 rounded-2xl border border-border bg-card shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-primary" />
                  <h3 className="text-base font-bold text-foreground">AI 종합 학술 해석</h3>
                </div>
                <span className="text-xs text-muted-foreground">
                  엔진: <code className="text-primary">{reportSnapshot.ai_interpretation.ai_engine}</code>
                </span>
              </div>

              <div className="space-y-3 text-xs text-foreground leading-relaxed">
                <div className="p-4 rounded-xl bg-muted/30 border border-border">
                  <div className="font-bold text-sm mb-1.5 text-primary">종합 관찰 및 분석 결론</div>
                  <p className="whitespace-pre-line text-muted-foreground">
                    {reportSnapshot.ai_interpretation.analysis_summary}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-3.5 rounded-xl border border-border bg-background">
                    <div className="font-bold mb-1 text-emerald-600 dark:text-emerald-400">
                      수치 신뢰도 및 측정 품질
                    </div>
                    <p className="text-muted-foreground">
                      {reportSnapshot.ai_interpretation.data_quality_assessment}
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl border border-border bg-background">
                    <div className="font-bold mb-1 text-amber-600 dark:text-amber-400">
                      과학적 주의사항 및 범위 한계
                    </div>
                    <p className="text-muted-foreground">
                      {reportSnapshot.ai_interpretation.scientific_cautions}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 5. Interactive Assistant Chat (Strictly Scoped) */}
          <div className="p-6 rounded-2xl border border-border bg-card shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-primary" />
                <h3 className="text-base font-bold text-foreground">
                  리포트 한정 대화형 연구 어시스턴트
                </h3>
              </div>
              <span className="text-xs text-muted-foreground">
                (선택된 기기 및 수치 근거에 한정하여 질의응답)
              </span>
            </div>

            <div className="rounded-xl border border-border bg-background p-4 min-h-[140px] max-h-72 overflow-y-auto space-y-3">
              {chatHistory.length === 0 ? (
                <div className="text-xs text-muted-foreground py-6 text-center">
                  현재 생성된 리포트의 물성 수치나 상관성 가설에 대해 무엇이든 질문하세요.
                  <br />
                  <span className="text-[11px] opacity-75">
                    예: &quot;XRD 결정자 크기와 Hall 이동도 사이의 관계를 설명해줘&quot;
                  </span>
                </div>
              ) : (
                chatHistory.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex flex-col ${
                      msg.sender === "user" ? "items-end" : "items-start"
                    }`}
                  >
                    <div
                      className={`max-w-[85%] p-3 rounded-xl text-xs leading-relaxed ${
                        msg.sender === "user"
                          ? "bg-primary text-primary-foreground font-medium"
                          : "bg-muted text-foreground border border-border"
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="현재 리포트 내용에 대해 질문하세요..."
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendChat()}
                disabled={isChatLoading}
                className="flex-1 px-4 py-2 text-xs rounded-xl border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button
                onClick={handleSendChat}
                disabled={!chatMessage.trim() || isChatLoading}
                className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs rounded-xl shadow transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                {isChatLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                전송
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
