import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Clock,
  Database,
  FileSpreadsheet,
  Filter,
  Flame,
  FolderOpen,
  Layers,
  Loader2,
  Microscope,
  RefreshCw,
  Search,
  Share2,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import type { HealthInfo, ProjectListItem } from "../types";
import type { ServiceMode } from "../App";
import { Button, Card, SourceTag, StatusBadge } from "./ui/primitives";

export type InstrumentFilter = "ALL" | "XRD" | "SEM" | "UTM" | "HALL" | "LFA";

interface LocalSavedRecord {
  id: string;
  name: string;
  instrument: "UTM" | "HALL" | "LFA";
  materialOrFormula: string;
  updatedAt: string;
  statusLabel: string;
  summaryText: string;
  isSampleDemo: boolean;
  targetMode: ServiceMode;
}

interface UnifiedSavedItem {
  uid: string;
  sourceType: "project" | "local_session";
  projectId?: string;
  name: string;
  description: string;
  instruments: Array<"XRD" | "SEM" | "CIF" | "UTM" | "HALL" | "LFA">;
  materialOrFormula: string;
  updatedAt: string;
  statusBadge: string;
  statusDetail: string;
  isSampleDemo: boolean;
  runCount: number;
  targetMode: ServiceMode;
}

interface HomeDashboardProps {
  health: HealthInfo | null;
  projects: ProjectListItem[];
  projectsLoading: boolean;
  projectsError: string | null;
  isBusy: boolean;
  onRefreshProjects: () => void;
  onOpenProject: (
    projectId: string,
    preferredTab?: "xrd" | "sem",
    preferredView?: "setup" | "results"
  ) => void;
  onDeleteProject: (projectId: string) => void;
  onNavigateMode: (mode: ServiceMode, resetProject?: boolean) => void;
  onLoadSample: (preset: "tio2_powder" | "sintered_grains") => void;
}

function readLocalSavedRecords(): LocalSavedRecord[] {
  const items: LocalSavedRecord[] = [];

  try {
    const rawUtm = localStorage.getItem("matlens_shared_utm_data");
    if (rawUtm) {
      const d = JSON.parse(rawUtm);
      if (d && (d.sample_id || d.source_file)) {
        const metrics: string[] = [];
        if (d.tensile_strength_MPa != null) {
          metrics.push(`UTS ${Number(d.tensile_strength_MPa).toFixed(1)} MPa`);
        }
        if (d.yield_strength_MPa != null) {
          metrics.push(`YS ${Number(d.yield_strength_MPa).toFixed(1)} MPa`);
        }
        if (d.elastic_modulus_GPa != null) {
          metrics.push(`E ${Number(d.elastic_modulus_GPa).toFixed(1)} GPa`);
        }
        items.push({
          id: "local-utm-latest",
          name: d.sample_id || d.source_file || "UTM 인장시험 데이터",
          instrument: "UTM",
          materialOrFormula: d.chemical_composition || d.material_name || "기계적 인장 시편",
          updatedAt: d.timestamp || new Date().toISOString(),
          statusLabel: "분석 완료",
          summaryText:
            metrics.length > 0
              ? `파일: ${d.source_file || "-"} · ${metrics.join(" · ")}`
              : `파일: ${d.source_file || "UTM 측정 파일"}`,
          isSampleDemo: Boolean(d.is_sample_demo),
          targetMode: "utm",
        });
      }
    }
  } catch {
    // ignore invalid local storage JSON
  }

  try {
    const rawHall = localStorage.getItem("matlens_shared_hall_data");
    if (rawHall) {
      const d = JSON.parse(rawHall);
      if (d && (d.sample_id || d.material_name)) {
        const metrics: string[] = [];
        if (d.carrier_type) metrics.push(String(d.carrier_type));
        if (d.electrical_conductivity_S_cm != null) {
          metrics.push(`σ ${Number(d.electrical_conductivity_S_cm).toFixed(1)} S/cm`);
        }
        if (d.hall_mobility_cm2_Vs != null) {
          metrics.push(`μ ${Number(d.hall_mobility_cm2_Vs).toFixed(2)} cm²/V·s`);
        }
        items.push({
          id: "local-hall-latest",
          name: d.sample_id || "Hall 측정 데이터",
          instrument: "HALL",
          materialOrFormula:
            [d.material_name, d.dopant].filter(Boolean).join(" · ") || "전하수송 측정 시편",
          updatedAt: d.timestamp || new Date().toISOString(),
          statusLabel: "분석 완료",
          summaryText:
            metrics.length > 0
              ? `Hall 전하수송 분석 · ${metrics.join(" · ")}`
              : "Hall 효과 측정 및 전하수송 정량 분석 데이터",
          isSampleDemo: Boolean(String(d.sample_id || "").includes("Bench")),
          targetMode: "hall",
        });
      }
    }
  } catch {
    // ignore invalid local storage JSON
  }

  try {
    const rawLfa = localStorage.getItem("matlens_shared_lfa_data");
    if (rawLfa) {
      const d = JSON.parse(rawLfa);
      if (d && (d.sample_id || d.material_name)) {
        const metrics: string[] = [];
        if (d.thermal_diffusivity_mm2_s != null) {
          metrics.push(`α ${Number(d.thermal_diffusivity_mm2_s).toFixed(3)} mm²/s`);
        }
        if (d.thermal_conductivity_W_mK != null) {
          metrics.push(`κ ${Number(d.thermal_conductivity_W_mK).toFixed(2)} W/m·K`);
        }
        items.push({
          id: "local-lfa-latest",
          name: d.sample_id || "LFA 열물성 데이터",
          instrument: "LFA",
          materialOrFormula: d.material_name || "열물성 측정 시편",
          updatedAt: d.timestamp || new Date().toISOString(),
          statusLabel: "분석 완료",
          summaryText:
            metrics.length > 0
              ? `LFA 열물성 분석 · ${metrics.join(" · ")}`
              : "Parker 반상승 시간 기반 열확산도·열전도도 분석 데이터",
          isSampleDemo: Boolean(String(d.sample_id || "").includes("Standard")),
          targetMode: "lfa",
        });
      }
    }
  } catch {
    // ignore invalid local storage JSON
  }

  return items;
}

function formatDateTime(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function InstrumentBadge({ type }: { type: "XRD" | "SEM" | "CIF" | "UTM" | "HALL" | "LFA" }) {
  const styles: Record<string, { bg: string; icon: React.ReactNode; label: string }> = {
    XRD: {
      bg: "bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]",
      icon: <Activity className="w-3.5 h-3.5" />,
      label: "XRD",
    },
    SEM: {
      bg: "bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0]",
      icon: <Microscope className="w-3.5 h-3.5" />,
      label: "SEM",
    },
    CIF: {
      bg: "bg-[#F5F3FF] text-[#6D28D9] border-[#DDD6FE]",
      icon: <FileSpreadsheet className="w-3.5 h-3.5" />,
      label: "CIF",
    },
    UTM: {
      bg: "bg-[#EFF6FF] text-[#3182F6] border-[#BFDBFE]",
      icon: <Activity className="w-3.5 h-3.5" />,
      label: "UTM",
    },
    HALL: {
      bg: "bg-[#EEF2FF] text-[#2563EB] border-[#C7D2FE]",
      icon: <Zap className="w-3.5 h-3.5" />,
      label: "Hall",
    },
    LFA: {
      bg: "bg-[#FEF3C7] text-[#D97706] border-[#FDE68A]",
      icon: <Flame className="w-3.5 h-3.5" />,
      label: "LFA",
    },
  };

  const cfg = styles[type] || styles.XRD;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[12px] font-semibold border ${cfg.bg}`}
    >
      {cfg.icon}
      <span>{cfg.label}</span>
    </span>
  );
}

export function HomeDashboard({
  health,
  projects,
  projectsLoading,
  projectsError,
  isBusy,
  onRefreshProjects,
  onOpenProject,
  onDeleteProject,
  onNavigateMode,
  onLoadSample,
}: HomeDashboardProps) {
  const [instrumentFilter, setInstrumentFilter] = useState<InstrumentFilter>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortOrder, setSortOrder] = useState<"latest" | "oldest" | "name">("latest");
  const [localRecords, setLocalRecords] = useState<LocalSavedRecord[]>(() =>
    readLocalSavedRecords()
  );

  useEffect(() => {
    setLocalRecords(readLocalSavedRecords());
  }, [projects]);

  const handleRefreshAll = () => {
    setLocalRecords(readLocalSavedRecords());
    onRefreshProjects();
  };

  // Build unified saved items from backend projects + browser session records
  const unifiedItems = useMemo<UnifiedSavedItem[]>(() => {
    const projectItems: UnifiedSavedItem[] = projects.map((p) => {
      const rolesUpper = (p.file_roles || []).map((r) => r.toUpperCase());
      const insts: Array<"XRD" | "SEM" | "CIF" | "UTM" | "HALL" | "LFA"> = [];
      if (rolesUpper.includes("XRD")) insts.push("XRD");
      if (rolesUpper.includes("SEM")) insts.push("SEM");
      if (rolesUpper.includes("CIF")) insts.push("CIF");
      if (insts.length === 0) {
        insts.push("XRD", "SEM");
      }

      const formulaOrMat =
        p.expected_formula?.trim() ||
        p.experiment_meta?.nominal_composition?.trim() ||
        p.experiment_meta?.base_matrix?.trim() ||
        (p.expected_elements?.length ? p.expected_elements.join("-") : "") ||
        "미지정";

      const hasRuns = p.run_count > 0;
      const hasFiles = (p.file_roles || []).length > 0;
      const statusBadge = hasRuns ? "분석 완료" : hasFiles ? "분석 대기" : "파일 대기";
      const statusDetail = hasRuns
        ? `실행 ${p.run_count}회 완료`
        : hasFiles
        ? `업로드 파일 ${p.file_roles.length}종 · 실행 전`
        : "시료 등록됨 (파일 업로드 필요)";

      return {
        uid: `proj-${p.id}`,
        sourceType: "project",
        projectId: p.id,
        name: p.sample_name,
        description:
          p.description ||
          (p.file_roles.length
            ? `등록된 측정 역할: ${p.file_roles.join(", ").toUpperCase()}`
            : "업로드된 파일 없음"),
        instruments: insts,
        materialOrFormula: formulaOrMat,
        updatedAt: p.updated_at,
        statusBadge,
        statusDetail,
        isSampleDemo: Boolean(p.is_sample_demo),
        runCount: p.run_count,
        targetMode: "matlens",
      };
    });

    const sessionItems: UnifiedSavedItem[] = localRecords.map((rec) => ({
      uid: rec.id,
      sourceType: "local_session",
      name: rec.name,
      description: rec.summaryText,
      instruments: [rec.instrument],
      materialOrFormula: rec.materialOrFormula,
      updatedAt: rec.updatedAt,
      statusBadge: rec.statusLabel,
      statusDetail: "현재 브라우저 분석 기록",
      isSampleDemo: rec.isSampleDemo,
      runCount: 1,
      targetMode: rec.targetMode,
    }));

    return [...projectItems, ...sessionItems];
  }, [projects, localRecords]);

  // Counts per instrument for filter pills
  const countsByInstrument = useMemo(() => {
    const counts: Record<InstrumentFilter, number> = {
      ALL: unifiedItems.length,
      XRD: 0,
      SEM: 0,
      UTM: 0,
      HALL: 0,
      LFA: 0,
    };
    for (const item of unifiedItems) {
      if (item.instruments.includes("XRD")) counts.XRD += 1;
      if (item.instruments.includes("SEM")) counts.SEM += 1;
      if (item.instruments.includes("UTM")) counts.UTM += 1;
      if (item.instruments.includes("HALL")) counts.HALL += 1;
      if (item.instruments.includes("LFA")) counts.LFA += 1;
    }
    return counts;
  }, [unifiedItems]);

  // Filtered and sorted items
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = unifiedItems.filter((item) => {
      if (instrumentFilter !== "ALL") {
        if (!item.instruments.includes(instrumentFilter)) {
          return false;
        }
      }
      if (!q) return true;
      const haystack = [
        item.name,
        item.materialOrFormula,
        item.description,
        item.instruments.join(" "),
        item.statusBadge,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });

    return list.sort((a, b) => {
      if (sortOrder === "name") {
        return a.name.localeCompare(b.name, "ko");
      }
      const tA = new Date(a.updatedAt).getTime() || 0;
      const tB = new Date(b.updatedAt).getTime() || 0;
      return sortOrder === "latest" ? tB - tA : tA - tB;
    });
  }, [unifiedItems, instrumentFilter, searchQuery, sortOrder]);

  const handleSelectItem = (item: UnifiedSavedItem, preferredTab?: "xrd" | "sem") => {
    if (item.sourceType === "project" && item.projectId) {
      const defaultTab: "xrd" | "sem" | undefined =
        preferredTab ||
        (instrumentFilter === "SEM" && item.instruments.includes("SEM")
          ? "sem"
          : item.instruments.includes("XRD")
          ? "xrd"
          : item.instruments.includes("SEM")
          ? "sem"
          : undefined);
      onOpenProject(item.projectId, defaultTab);
    } else {
      onNavigateMode(item.targetMode);
    }
  };

  return (
    <div className="w-full max-w-[1540px] mx-auto space-y-6 pb-20 sm:pb-12">
      {/* 1. Top Hero / Welcome Section */}
      <Card className="p-6 sm:p-8 bg-gradient-to-br from-white via-white to-[#EFF6FF]/60">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-3 max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#EFF6FF] border border-[#BFDBFE] text-[#3182F6] text-[12px] font-semibold">
              <Layers className="w-3.5 h-3.5" />
              <span>MatLens Research Workspace</span>
            </div>
            <h1 className="text-[28px] sm:text-[34px] font-bold tracking-tight text-[#191F28] leading-tight">
              Welcome to MatLens
            </h1>
            <p className="text-[15px] sm:text-[16px] font-medium text-[#4E5968] leading-relaxed">
              Materials Characterization &amp; AI-Powered Analysis Platform
            </p>
            <p className="text-[13px] sm:text-[14px] text-[#6B7684] leading-relaxed">
              XRD 결정구조, SEM 미세조직, UTM 기계적 물성, Hall 전하수송, LFA 열물성 데이터를 정량 계산하고
              저장된 시료 분석 기록을 한눈에 관리·연계합니다.
            </p>
          </div>

          {/* Summary Stat Pills & Quick Start */}
          <div className="flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end justify-between gap-3 shrink-0">
            <div className="grid grid-cols-3 gap-2.5 bg-[#F7F8FA] p-3 rounded-[16px] border border-[#E5E8EB]">
              <div className="px-3 py-1.5 text-center">
                <div className="text-[11px] font-medium text-[#6B7684]">저장된 데이터</div>
                <div className="text-[20px] font-bold text-[#191F28] tabular-nums">
                  {unifiedItems.length}
                </div>
              </div>
              <div className="px-3 py-1.5 text-center border-x border-[#E5E8EB]">
                <div className="text-[11px] font-medium text-[#6B7684]">분석 완료</div>
                <div className="text-[20px] font-bold text-[#16A34A] tabular-nums">
                  {unifiedItems.filter((i) => i.statusBadge === "분석 완료").length}
                </div>
              </div>
              <div className="px-3 py-1.5 text-center">
                <div className="text-[11px] font-medium text-[#6B7684]">참조 결정상 DB</div>
                <div className="text-[20px] font-bold text-[#3182F6] tabular-nums">
                  {health?.ref_phase_count ?? 18}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={isBusy}
                onClick={() => onNavigateMode("matlens", true)}
              >
                <FolderOpen className="w-4 h-4" />
                <span>새 XRD·SEM 분석 시작</span>
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={isBusy}
                onClick={() => onLoadSample("tio2_powder")}
              >
                <Sparkles className="w-4 h-4 text-[#3182F6]" />
                <span>TiO2 샘플 체험</span>
              </Button>
            </div>
          </div>
        </div>

        {/* Instrument Quick Launch Bar */}
        <div className="mt-6 pt-5 border-t border-[#E5E8EB] grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          <button
            type="button"
            onClick={() => onNavigateMode("matlens")}
            className="flex items-center justify-between gap-2 p-3 rounded-[14px] border border-[#E5E8EB] bg-white hover:border-[#3182F6] hover:bg-[#EFF6FF]/40 transition-all text-left cursor-pointer group"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-8 h-8 rounded-[10px] bg-[#EFF6FF] text-[#3182F6] flex items-center justify-center shrink-0">
                <Activity className="w-4 h-4" />
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-bold text-[#191F28] truncate">XRD · SEM</div>
                <div className="text-[11px] text-[#6B7684] truncate">결정구조·미세조직</div>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-[#8B95A1] group-hover:text-[#3182F6] shrink-0 transition-colors" />
          </button>

          <button
            type="button"
            onClick={() => onNavigateMode("utm")}
            className="flex items-center justify-between gap-2 p-3 rounded-[14px] border border-[#E5E8EB] bg-white hover:border-[#3182F6] hover:bg-[#EFF6FF]/40 transition-all text-left cursor-pointer group"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-8 h-8 rounded-[10px] bg-[#EFF6FF] text-[#3182F6] flex items-center justify-center shrink-0">
                <Activity className="w-4 h-4" />
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-bold text-[#191F28] truncate">UTM</div>
                <div className="text-[11px] text-[#6B7684] truncate">인장·기계적 물성</div>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-[#8B95A1] group-hover:text-[#3182F6] shrink-0 transition-colors" />
          </button>

          <button
            type="button"
            onClick={() => onNavigateMode("hall")}
            className="flex items-center justify-between gap-2 p-3 rounded-[14px] border border-[#E5E8EB] bg-white hover:border-[#2563EB] hover:bg-[#EEF2FF]/50 transition-all text-left cursor-pointer group"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-8 h-8 rounded-[10px] bg-[#EEF2FF] text-[#2563EB] flex items-center justify-center shrink-0">
                <Zap className="w-4 h-4" />
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-bold text-[#191F28] truncate">Hall</div>
                <div className="text-[11px] text-[#6B7684] truncate">전하수송·이동도</div>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-[#8B95A1] group-hover:text-[#2563EB] shrink-0 transition-colors" />
          </button>

          <button
            type="button"
            onClick={() => onNavigateMode("lfa")}
            className="flex items-center justify-between gap-2 p-3 rounded-[14px] border border-[#E5E8EB] bg-white hover:border-[#D97706] hover:bg-[#FEF3C7]/40 transition-all text-left cursor-pointer group"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-8 h-8 rounded-[10px] bg-[#FEF3C7] text-[#D97706] flex items-center justify-center shrink-0">
                <Flame className="w-4 h-4" />
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-bold text-[#191F28] truncate">LFA</div>
                <div className="text-[11px] text-[#6B7684] truncate">열확산도·열전도도</div>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-[#8B95A1] group-hover:text-[#D97706] shrink-0 transition-colors" />
          </button>

          <button
            type="button"
            onClick={() => onNavigateMode("integrated")}
            className="flex items-center justify-between gap-2 p-3 rounded-[14px] border border-[#E5E8EB] bg-white hover:border-[#7C3AED] hover:bg-[#F5F3FF]/50 transition-all text-left cursor-pointer group col-span-2 sm:col-span-1"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-8 h-8 rounded-[10px] bg-[#F5F3FF] text-[#7C3AED] flex items-center justify-center shrink-0">
                <Share2 className="w-4 h-4" />
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-bold text-[#191F28] truncate">통합 리포트</div>
                <div className="text-[11px] text-[#6B7684] truncate">다종 기기 교차 해석</div>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-[#8B95A1] group-hover:text-[#7C3AED] shrink-0 transition-colors" />
          </button>
        </div>
      </Card>

      {/* 2. Saved Analysis Data Section */}
      <Card className="p-6 sm:p-8 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-[#3182F6]" />
              <h2 className="text-[20px] font-bold text-[#191F28]">저장된 분석 데이터</h2>
              <span className="px-2.5 py-0.5 rounded-full text-[12px] font-bold bg-[#EFF6FF] text-[#3182F6]">
                {filteredItems.length}건
              </span>
            </div>
            <p className="text-[13px] text-[#6B7684] mt-1">
              저장된 시료 및 분석 데이터를 기기별로 필터링하거나 재료명·파일명으로 검색하여 해당 분석 화면으로 바로 이동합니다.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={projectsLoading || isBusy}
              onClick={handleRefreshAll}
            >
              <RefreshCw className={`w-4 h-4 ${projectsLoading ? "animate-spin" : ""}`} />
              <span>목록 새로고침</span>
            </Button>
          </div>
        </div>

        {/* Filter Bar: Instrument Tabs + Search Input + Sort Select */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-2 border-t border-[#E5E8EB]">
          {/* Instrument Filter Pills */}
          <div
            role="group"
            aria-label="분석 기기별 필터"
            className="flex items-center flex-wrap gap-1.5"
          >
            <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#6B7684] mr-1">
              <Filter className="w-3.5 h-3.5" />
              기기 필터:
            </span>
            {(
              [
                { id: "ALL", label: "전체" },
                { id: "XRD", label: "XRD" },
                { id: "SEM", label: "SEM" },
                { id: "UTM", label: "UTM" },
                { id: "HALL", label: "Hall" },
                { id: "LFA", label: "LFA" },
              ] as Array<{ id: InstrumentFilter; label: string }>
            ).map((tab) => {
              const active = instrumentFilter === tab.id;
              const cnt = countsByInstrument[tab.id];
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setInstrumentFilter(tab.id)}
                  className={`inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-[10px] text-[13px] font-semibold transition-all cursor-pointer ${
                    active
                      ? "bg-[#3182F6] text-white shadow-sm"
                      : "bg-[#F2F4F6] text-[#4E5968] hover:bg-[#E5E8EB] hover:text-[#191F28]"
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[11px] tabular-nums ${
                      active ? "bg-white/20 text-white" : "bg-white text-[#6B7684]"
                    }`}
                  >
                    {cnt}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Search & Sort Controls */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <div className="relative flex-1 sm:w-[280px]">
              <Search className="w-4 h-4 text-[#8B95A1] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="시료·파일명 또는 재료명(조성) 검색..."
                aria-label="시료·파일명 또는 재료명 검색"
                className="w-full min-h-[40px] pl-9 pr-8 rounded-[12px] border border-[#E5E8EB] bg-[#F7F8FA] focus:bg-white text-[13px] text-[#191F28] focus:outline-none focus:border-[#3182F6]"
              />
              {searchQuery && (
                <button
                  type="button"
                  aria-label="검색어 지우기"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8B95A1] hover:text-[#191F28] p-1 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as "latest" | "oldest" | "name")}
              aria-label="정렬 기준"
              className="min-h-[40px] px-3 rounded-[12px] border border-[#E5E8EB] bg-white text-[13px] font-medium text-[#191F28] focus:outline-none focus:border-[#3182F6]"
            >
              <option value="latest">최근 저장된 데이터순</option>
              <option value="oldest">오래된 데이터순</option>
              <option value="name">데이터 이름순 (가나다)</option>
            </select>
          </div>
        </div>

        {/* Error State */}
        {projectsError && (
          <div className="rounded-[16px] bg-[#FEE2E2] border border-[#FECACA] p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-[#DC2626]">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <div className="text-[14px] font-semibold">저장 데이터 조회 중 오류가 발생했습니다</div>
                <div className="text-[13px] mt-0.5">{projectsError}</div>
              </div>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={handleRefreshAll}>
              다시 시도
            </Button>
          </div>
        )}

        {/* Loading State */}
        {projectsLoading && unifiedItems.length === 0 ? (
          <div className="py-16 text-center space-y-3 bg-[#F7F8FA] rounded-[16px] border border-[#E5E8EB]">
            <Loader2 className="w-8 h-8 text-[#3182F6] animate-spin mx-auto" />
            <div className="text-[15px] font-semibold text-[#191F28]">
              저장된 분석 데이터를 불러오는 중입니다...
            </div>
            <p className="text-[13px] text-[#6B7684]">잠시만 기다려주세요.</p>
          </div>
        ) : unifiedItems.length === 0 ? (
          /* Empty State when no data exists at all */
          <div className="py-16 px-4 text-center space-y-4 bg-[#F7F8FA] rounded-[16px] border border-dashed border-[#D1D6DB]">
            <div className="w-12 h-12 rounded-full bg-[#EFF6FF] text-[#3182F6] flex items-center justify-center mx-auto">
              <FolderOpen className="w-6 h-6" />
            </div>
            <div className="space-y-1 max-w-md mx-auto">
              <h3 className="text-[16px] font-bold text-[#191F28]">
                아직 저장된 분석 데이터가 없습니다
              </h3>
              <p className="text-[13px] text-[#6B7684] leading-relaxed">
                새로운 시료 데이터를 업로드하여 분석을 시작하거나, 검증용 샘플 데이터를 불러와 MatLens의 분석 파이프라인을 확인해보세요.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={isBusy}
                onClick={() => onNavigateMode("matlens", true)}
              >
                <FolderOpen className="w-4 h-4" />
                <span>XRD·SEM 시료 등록 및 파일 업로드</span>
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={isBusy}
                onClick={() => onLoadSample("tio2_powder")}
              >
                <Sparkles className="w-4 h-4 text-[#3182F6]" />
                <span>샘플 데이터 불러오기 (TiO2)</span>
              </Button>
            </div>
          </div>
        ) : filteredItems.length === 0 ? (
          /* Empty State when filter/search has no matches */
          <div className="py-14 px-4 text-center space-y-3 bg-[#F7F8FA] rounded-[16px] border border-[#E5E8EB]">
            <div className="text-[15px] font-bold text-[#191F28]">
              조건에 일치하는 분석 데이터가 없습니다
            </div>
            <p className="text-[13px] text-[#6B7684]">
              선택한 기기 필터({instrumentFilter}) 또는 검색어(“{searchQuery}”)와 일치하는 항목을 찾지 못했습니다.
            </p>
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setInstrumentFilter("ALL");
                  setSearchQuery("");
                }}
              >
                필터 및 검색 초기화
              </Button>
            </div>
          </div>
        ) : (
          /* Saved Data Table / Responsive Card List */
          <div className="space-y-3">
            {/* Desktop Column Header */}
            <div className="hidden lg:grid lg:grid-cols-12 gap-4 px-4 py-2.5 text-[12px] font-semibold text-[#6B7684] bg-[#F7F8FA] rounded-[12px] border border-[#E5E8EB]">
              <div className="col-span-3">분석 데이터 이름</div>
              <div className="col-span-2">분석 기기 종류</div>
              <div className="col-span-2">재료명 · 조성</div>
              <div className="col-span-2">분석 · 수정 날짜</div>
              <div className="col-span-3 text-right">분석 상태 및 이동</div>
            </div>

            {filteredItems.map((item) => (
              <div
                key={item.uid}
                onClick={() => handleSelectItem(item)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleSelectItem(item);
                  }
                }}
                role="button"
                tabIndex={0}
                className="group grid grid-cols-1 lg:grid-cols-12 gap-3 lg:gap-4 items-center p-4 rounded-[16px] border border-[#E5E8EB] bg-white hover:border-[#3182F6] hover:shadow-sm focus-visible:outline-2 focus-visible:outline-[#3182F6] transition-all cursor-pointer"
              >
                {/* 1. Data Name & Description */}
                <div className="lg:col-span-3 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[15px] font-bold text-[#191F28] group-hover:text-[#3182F6] transition-colors truncate">
                      {item.name}
                    </span>
                    {item.isSampleDemo && <SourceTag kind="샘플" />}
                  </div>
                  <p className="text-[12px] text-[#6B7684] line-clamp-1">{item.description}</p>
                </div>

                {/* 2. Instrument Types */}
                <div className="lg:col-span-2 flex items-center flex-wrap gap-1.5">
                  {item.instruments.map((inst) => (
                    <InstrumentBadge key={inst} type={inst} />
                  ))}
                </div>

                {/* 3. Material Name / Composition */}
                <div className="lg:col-span-2 min-w-0">
                  <div className="text-[11px] text-[#8B95A1] lg:hidden">재료명 · 조성</div>
                  <div className="text-[13px] font-semibold text-[#191F28] truncate">
                    {item.materialOrFormula}
                  </div>
                </div>

                {/* 4. Date */}
                <div className="lg:col-span-2 min-w-0">
                  <div className="inline-flex items-center gap-1.5 text-[12px] text-[#6B7684] tabular-nums whitespace-nowrap">
                    <Clock className="w-3.5 h-3.5 text-[#8B95A1] shrink-0" />
                    <span>{formatDateTime(item.updatedAt)}</span>
                  </div>
                </div>

                {/* 5. Status & Action Buttons */}
                <div
                  className="lg:col-span-3 flex items-center justify-between lg:justify-end gap-2.5 whitespace-nowrap"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex flex-col items-start lg:items-end gap-0.5 shrink-0 whitespace-nowrap">
                    <StatusBadge status={item.statusBadge} className="whitespace-nowrap shrink-0" />
                    <span className="text-[11px] text-[#6B7684] whitespace-nowrap">{item.statusDetail}</span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {item.sourceType === "project" &&
                      item.projectId &&
                      item.runCount > 0 &&
                      item.instruments.includes("XRD") &&
                      item.instruments.includes("SEM") && (
                        <button
                          type="button"
                          onClick={() => onOpenProject(item.projectId!, "sem")}
                          title="SEM 분석 결과 탭으로 바로 이동"
                          className="hidden xl:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[10px] text-[12px] font-semibold border border-[#E5E8EB] bg-[#F7F8FA] hover:border-[#3182F6] hover:text-[#3182F6] text-[#4E5968] cursor-pointer transition-colors whitespace-nowrap"
                        >
                          SEM
                        </button>
                      )}

                    <button
                      type="button"
                      onClick={() => handleSelectItem(item)}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-[10px] text-[12px] font-semibold bg-[#EFF6FF] text-[#3182F6] hover:bg-[#3182F6] hover:text-white transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <span>열기</span>
                      <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                    </button>

                    {item.sourceType === "project" && item.projectId && (
                      <button
                        type="button"
                        aria-label={`${item.name} 삭제`}
                        title="저장된 시료 삭제"
                        onClick={() => onDeleteProject(item.projectId!)}
                        className="p-2 rounded-[10px] text-[#8B95A1] hover:text-[#DC2626] hover:bg-[#FEE2E2]/60 transition-colors cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
