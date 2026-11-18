import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Clock,
  Database,
  Edit3,
  FileSpreadsheet,
  Filter,
  Flame,
  FolderOpen,
  FolderPlus,
  Layers,
  Loader2,
  Microscope,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import type { HealthInfo, ProjectListItem } from "../types";
import type { ServiceMode } from "../App";
import { Button, Card, SourceTag, StatusBadge } from "./ui/primitives";

export type InstrumentFilter =
  | "ALL"
  | "XRD"
  | "SEM"
  | "UTM"
  | "HALL"
  | "LFA"
  | "FTIR"
  | "DSC"
  | "TGA";

interface LocalSavedRecord {
  id: string;
  name: string;
  instrument: "UTM" | "HALL" | "LFA" | "FTIR" | "DSC" | "TGA";
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
  project?: ProjectListItem;
  projectId?: string;
  name: string;
  sampleCode?: string;
  processingMethod?: string;
  description: string;
  instruments: Array<"XRD" | "SEM" | "CIF" | "UTM" | "HALL" | "LFA" | "FTIR" | "DSC" | "TGA">;
  instrumentCounts: Record<string, number>;
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
    targetMode?: ServiceMode
  ) => void;
  onDeleteProject: (projectId: string) => void;
  onNavigateMode: (mode: ServiceMode) => void;
  onLoadSample: (preset: "tio2_powder" | "sintered_grains") => void;
  onOpenRegisterModal: () => void;
  onOpenEditSampleModal: (sample: ProjectListItem) => void;
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
    // ignore
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
    // ignore
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
    // ignore
  }

  for (const spec of ["ftir", "dsc", "tga"] as const) {
    try {
      const rawSpec = localStorage.getItem(`matlens_shared_${spec}_data`);
      if (rawSpec) {
        const d = JSON.parse(rawSpec);
        if (d && (d.sample_id || d.source_file)) {
          const instUp = spec.toUpperCase() as "FTIR" | "DSC" | "TGA";
          items.push({
            id: `local-${spec}-latest`,
            name: d.sample_id || d.source_file || `${instUp} 분석 데이터`,
            instrument: instUp,
            materialOrFormula: d.material_name || `${instUp} 측정 시편`,
            updatedAt: d.timestamp || new Date().toISOString(),
            statusLabel: "분석 완료",
            summaryText: `파일: ${d.source_file || "-"}`,
            isSampleDemo: false,
            targetMode: spec,
          });
        }
      }
    } catch {
      // ignore
    }
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

function InstrumentBadge({
  type,
  count,
}: {
  type: "XRD" | "SEM" | "CIF" | "UTM" | "HALL" | "LFA" | "FTIR" | "DSC" | "TGA";
  count?: number;
}) {
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
    FTIR: {
      bg: "bg-[#EEF2FF] text-[#4F46E5] border-[#C7D2FE]",
      icon: <Activity className="w-3.5 h-3.5" />,
      label: "FT-IR",
    },
    DSC: {
      bg: "bg-[#FDF2F8] text-[#DB2777] border-[#FBCFE8]",
      icon: <Flame className="w-3.5 h-3.5" />,
      label: "DSC",
    },
    TGA: {
      bg: "bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]",
      icon: <Flame className="w-3.5 h-3.5" />,
      label: "TGA",
    },
  };

  const cfg = styles[type] || styles.XRD;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[12px] font-semibold border whitespace-nowrap ${cfg.bg}`}
    >
      {cfg.icon}
      <span>
        {cfg.label}
        {count && count > 1 ? ` ${count}` : ""}
      </span>
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
  onOpenRegisterModal,
  onOpenEditSampleModal,
}: HomeDashboardProps) {
  const [instrumentFilter, setInstrumentFilter] = useState<InstrumentFilter>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortOrder, setSortOrder] = useState<"latest" | "oldest" | "name">("latest");
  const [localRecords, setLocalRecords] = useState<LocalSavedRecord[]>(() =>
    readLocalSavedRecords()
  );
  const [expandedSampleId, setExpandedSampleId] = useState<string | null>(null);
  const [confirmDeleteSample, setConfirmDeleteSample] = useState<ProjectListItem | null>(null);

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
      const rolesUpper = (p.file_roles || []).map((r) => r.toUpperCase().replace("-", ""));
      const counts = p.instrument_counts || {};
      const insts: Array<"XRD" | "SEM" | "CIF" | "UTM" | "HALL" | "LFA" | "FTIR" | "DSC" | "TGA"> = [];

      for (const k of ["XRD", "SEM", "CIF", "UTM", "HALL", "LFA", "FTIR", "DSC", "TGA"] as const) {
        if (rolesUpper.includes(k) || (counts[k] && counts[k] > 0)) {
          insts.push(k);
        }
      }
      if (insts.length === 0) {
        insts.push("XRD", "SEM");
      }

      const formulaOrMat =
        p.expected_formula?.trim() ||
        p.experiment_meta?.nominal_composition?.trim() ||
        p.experiment_meta?.base_matrix?.trim() ||
        (p.expected_elements?.length ? p.expected_elements.join("-") : "") ||
        "미지정";

      const totalFiles =
        Object.values(counts).reduce((a, b) => a + Number(b || 0), 0) ||
        (p.file_roles || []).length;
      const hasRuns = p.run_count > 0;
      const hasFiles = totalFiles > 0;
      const statusBadge = hasRuns ? "분석 완료" : hasFiles ? "분석 대기" : "시료 등록됨";
      const statusDetail = hasRuns
        ? `측정 ${totalFiles}건 · 분석 ${p.run_count}회`
        : hasFiles
        ? `측정 데이터 ${totalFiles}건 등록`
        : "모든 기기에서 선택 가능";

      const defaultTarget: ServiceMode = insts.includes("XRD")
        ? "xrd"
        : insts.includes("SEM")
        ? "sem"
        : insts.includes("UTM")
        ? "utm"
        : insts.includes("HALL")
        ? "hall"
        : insts.includes("LFA")
        ? "lfa"
        : insts.includes("FTIR")
        ? "ftir"
        : insts.includes("DSC")
        ? "dsc"
        : insts.includes("TGA")
        ? "tga"
        : "xrd";

      return {
        uid: `proj-${p.id}`,
        sourceType: "project",
        project: p,
        projectId: p.id,
        name: p.sample_name,
        sampleCode: p.sample_code,
        processingMethod: p.processing_method,
        description:
          p.description ||
          p.processing_method ||
          (p.file_roles.length
            ? `연결된 분석기기: ${insts.join(", ")}`
            : "시료 등록 완료 · 분석기기 탭에서 측정 데이터를 연결하세요"),
        instruments: insts,
        instrumentCounts: counts,
        materialOrFormula: formulaOrMat,
        updatedAt: p.updated_at,
        statusBadge,
        statusDetail,
        isSampleDemo: Boolean(p.is_sample_demo),
        runCount: p.run_count,
        targetMode: defaultTarget,
      };
    });

    const sessionItems: UnifiedSavedItem[] = localRecords.map((rec) => ({
      uid: rec.id,
      sourceType: "local_session",
      name: rec.name,
      description: rec.summaryText,
      instruments: [rec.instrument],
      instrumentCounts: { [rec.instrument]: 1 },
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
      FTIR: 0,
      DSC: 0,
      TGA: 0,
    };
    for (const item of unifiedItems) {
      if (item.instruments.includes("XRD")) counts.XRD += 1;
      if (item.instruments.includes("SEM")) counts.SEM += 1;
      if (item.instruments.includes("UTM")) counts.UTM += 1;
      if (item.instruments.includes("HALL")) counts.HALL += 1;
      if (item.instruments.includes("LFA")) counts.LFA += 1;
      if (item.instruments.includes("FTIR")) counts.FTIR += 1;
      if (item.instruments.includes("DSC")) counts.DSC += 1;
      if (item.instruments.includes("TGA")) counts.TGA += 1;
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
        item.sampleCode || "",
        item.processingMethod || "",
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

  const handleSelectItem = (item: UnifiedSavedItem, preferredMode?: ServiceMode) => {
    if (item.sourceType === "project" && item.projectId) {
      const modeToOpen: ServiceMode =
        preferredMode ||
        (instrumentFilter === "SEM" && item.instruments.includes("SEM")
          ? "sem"
          : instrumentFilter === "UTM"
          ? "utm"
          : instrumentFilter === "HALL"
          ? "hall"
          : instrumentFilter === "LFA"
          ? "lfa"
          : instrumentFilter === "FTIR"
          ? "ftir"
          : instrumentFilter === "DSC"
          ? "dsc"
          : instrumentFilter === "TGA"
          ? "tga"
          : item.targetMode);
      onOpenProject(item.projectId, modeToOpen);
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
              시료를 먼저 등록한 뒤 XRD, SEM, UTM, Hall, LFA, FT-IR, DSC, TGA 등 모든 분석기기에서 동일한 시료를 선택하여 다중 측정 데이터와 분석 이력을 체계적으로 통합 관리합니다.
            </p>
          </div>

          {/* Summary Stat Pills & '시료 등록하기' Primary Action */}
          <div className="flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end justify-between gap-3 shrink-0">
            <div className="grid grid-cols-3 gap-2.5 bg-[#F7F8FA] p-3 rounded-[16px] border border-[#E5E8EB]">
              <div className="px-3 py-1.5 text-center">
                <div className="text-[11px] font-medium text-[#6B7684]">등록 시료·데이터</div>
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
                  {health?.ref_phase_count ?? 39}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={isBusy}
                onClick={onOpenRegisterModal}
              >
                <FolderPlus className="w-4 h-4" />
                <span>시료 등록하기</span>
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
        <div className="mt-6 pt-5 border-t border-[#E5E8EB] grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-9 gap-2">
          {(
            [
              { mode: "xrd" as ServiceMode, title: "XRD", sub: "결정구조·회절", color: "text-[#3182F6] bg-[#EFF6FF]" },
              { mode: "sem" as ServiceMode, title: "SEM", sub: "미세조직·입도", color: "text-[#15803D] bg-[#F0FDF4]" },
              { mode: "utm" as ServiceMode, title: "UTM", sub: "인장·기계물성", color: "text-[#3182F6] bg-[#EFF6FF]" },
              { mode: "hall" as ServiceMode, title: "Hall", sub: "전하수송·이동도", color: "text-[#2563EB] bg-[#EEF2FF]" },
              { mode: "lfa" as ServiceMode, title: "LFA", sub: "열확산·열전도", color: "text-[#D97706] bg-[#FEF3C7]" },
              { mode: "ftir" as ServiceMode, title: "FT-IR", sub: "적외선 분광", color: "text-[#4F46E5] bg-[#EEF2FF]" },
              { mode: "dsc" as ServiceMode, title: "DSC", sub: "시차주사열량", color: "text-[#DB2777] bg-[#FDF2F8]" },
              { mode: "tga" as ServiceMode, title: "TGA", sub: "열중량·분해", color: "text-[#059669] bg-[#ECFDF5]" },
              { mode: "integrated" as ServiceMode, title: "통합 리포트", sub: "다종 기기 연계", color: "text-[#7C3AED] bg-[#F5F3FF]" },
            ]
          ).map((card) => (
            <button
              key={card.mode}
              type="button"
              onClick={() => onNavigateMode(card.mode)}
              className="flex items-center justify-between gap-1.5 p-2.5 rounded-[12px] border border-[#E5E8EB] bg-white hover:border-[#3182F6] hover:shadow-2xs transition-all text-left cursor-pointer group"
            >
              <div className="min-w-0">
                <div className="text-[13px] font-bold text-[#191F28] group-hover:text-[#3182F6] truncate">
                  {card.title}
                </div>
                <div className="text-[11px] text-[#6B7684] truncate">{card.sub}</div>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-[#8B95A1] group-hover:text-[#3182F6] shrink-0" />
            </button>
          ))}
        </div>
      </Card>

      {/* 2. Saved Samples & Analysis Data Section */}
      <Card className="p-6 sm:p-8 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-[#3182F6]" />
              <h2 className="text-[20px] font-bold text-[#191F28]">등록된 시료 및 저장된 분석 데이터</h2>
              <span className="px-2.5 py-0.5 rounded-full text-[12px] font-bold bg-[#EFF6FF] text-[#3182F6]">
                {filteredItems.length}건
              </span>
            </div>
            <p className="text-[13px] text-[#6B7684] mt-1">
              등록된 시료와 분석 데이터를 기기별로 필터링하거나 시료명·조성·파일명으로 검색하여 확인·수정하고, 원하는 분석기기 화면으로 바로 이동합니다.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={isBusy}
              onClick={onOpenRegisterModal}
            >
              <FolderPlus className="w-4 h-4" />
              <span>시료 등록하기</span>
            </Button>
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
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 pt-2 border-t border-[#E5E8EB]">
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
                { id: "FTIR", label: "FT-IR" },
                { id: "DSC", label: "DSC" },
                { id: "TGA", label: "TGA" },
              ] as Array<{ id: InstrumentFilter; label: string }>
            ).map((tab) => {
              const active = instrumentFilter === tab.id;
              const cnt = countsByInstrument[tab.id];
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setInstrumentFilter(tab.id)}
                  className={`inline-flex items-center gap-1.5 min-h-[36px] px-2.5 py-1 rounded-[10px] text-[12px] font-semibold transition-all cursor-pointer ${
                    active
                      ? "bg-[#3182F6] text-white shadow-xs"
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
                placeholder="시료명, 시료코드, 재료명(조성) 검색..."
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
              <option value="name">시료·데이터 이름순 (가나다)</option>
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
              등록된 시료 및 분석 데이터를 불러오는 중입니다...
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
                아직 등록된 시료나 저장된 분석 데이터가 없습니다
              </h3>
              <p className="text-[13px] text-[#6B7684] leading-relaxed">
                <strong>시료 등록하기</strong> 버튼을 눌러 새 시료를 등록하거나, 검증용 샘플 데이터를 불러와 MatLens의 분석 파이프라인을 확인해보세요.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={isBusy}
                onClick={onOpenRegisterModal}
              >
                <FolderPlus className="w-4 h-4" />
                <span>시료 등록하기</span>
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
              조건에 일치하는 시료 또는 분석 데이터가 없습니다
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
              <div className="col-span-3">시료 · 분석 데이터 이름</div>
              <div className="col-span-2">분석 기기 종류</div>
              <div className="col-span-2">재료명 · 조성</div>
              <div className="col-span-2">분석 · 수정 날짜</div>
              <div className="col-span-3 text-right">분석 상태 및 이동</div>
            </div>

            {filteredItems.map((item) => {
              const isExpanded = expandedSampleId === item.uid;
              return (
                <div
                  key={item.uid}
                  className="rounded-[16px] border border-[#E5E8EB] bg-white hover:border-[#3182F6] hover:shadow-xs transition-all overflow-hidden"
                >
                  <div
                    onClick={() => handleSelectItem(item)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleSelectItem(item);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    className="group grid grid-cols-1 lg:grid-cols-12 gap-3 lg:gap-4 items-center p-4 cursor-pointer"
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
                        <InstrumentBadge
                          key={inst}
                          type={inst}
                          count={item.instrumentCounts?.[inst]}
                        />
                      ))}
                    </div>

                    {/* 3. Material Name / Composition */}
                    <div className="lg:col-span-2 min-w-0">
                      <div className="text-[11px] text-[#8B95A1] lg:hidden">재료명 · 조성</div>
                      <div className="text-[13px] font-semibold text-[#191F28] truncate">
                        {item.materialOrFormula}
                      </div>
                      {item.processingMethod && (
                        <div className="text-[11px] text-[#6B7684] truncate">
                          {item.processingMethod}
                        </div>
                      )}
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
                      className="lg:col-span-3 flex items-center justify-between lg:justify-end gap-2 whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex flex-col items-start lg:items-end gap-0.5 shrink-0 whitespace-nowrap">
                        <StatusBadge status={item.statusBadge} className="whitespace-nowrap shrink-0" />
                        <span className="text-[11px] text-[#6B7684] whitespace-nowrap">
                          {item.statusDetail}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {item.sourceType === "project" && item.project && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedSampleId((prev) => (prev === item.uid ? null : item.uid))
                              }
                              title="시료 상세 정보 및 기기별 분석 데이터 확인"
                              className="hidden xl:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[10px] text-[12px] font-semibold border border-[#E5E8EB] bg-[#F7F8FA] hover:border-[#3182F6] hover:text-[#3182F6] text-[#4E5968] cursor-pointer transition-colors whitespace-nowrap"
                            >
                              {isExpanded ? "상세 닫기" : "시료 상세"}
                            </button>

                            <button
                              type="button"
                              onClick={() => onOpenEditSampleModal(item.project!)}
                              title="시료 정보 수정"
                              className="p-2 rounded-[10px] text-[#6B7684] hover:text-[#3182F6] hover:bg-[#EFF6FF] transition-colors cursor-pointer shrink-0"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                          </>
                        )}

                        <button
                          type="button"
                          onClick={() => handleSelectItem(item)}
                          className="inline-flex items-center gap-1 px-3 py-2 rounded-[10px] text-[12px] font-semibold bg-[#EFF6FF] text-[#3182F6] hover:bg-[#3182F6] hover:text-white transition-colors cursor-pointer whitespace-nowrap"
                        >
                          <span>열기</span>
                          <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                        </button>

                        {item.sourceType === "project" && item.project && (
                          <button
                            type="button"
                            aria-label={`${item.name} 삭제`}
                            title="저장된 시료 삭제"
                            onClick={() => setConfirmDeleteSample(item.project!)}
                            className="p-2 rounded-[10px] text-[#8B95A1] hover:text-[#DC2626] hover:bg-[#FEE2E2]/60 transition-colors cursor-pointer shrink-0"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expanded Sample Detail & Instrument Data Matrix */}
                  {isExpanded && item.sourceType === "project" && item.project && (
                    <div className="px-5 py-4 bg-[#F8FAFC] border-t border-[#E5E8EB] space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[12px]">
                        <div className="p-3 rounded-[12px] bg-white border border-[#E5E8EB]">
                          <div className="text-[#8B95A1] font-semibold">시료 코드 (Sample ID)</div>
                          <div className="font-mono font-bold text-[#191F28] mt-0.5">
                            {item.project.sample_code || item.project.id}
                          </div>
                        </div>
                        <div className="p-3 rounded-[12px] bg-white border border-[#E5E8EB]">
                          <div className="text-[#8B95A1] font-semibold">제조 및 공정 방법</div>
                          <div className="font-semibold text-[#191F28] mt-0.5">
                            {item.project.processing_method || "미입력"}
                          </div>
                        </div>
                        <div className="p-3 rounded-[12px] bg-white border border-[#E5E8EB]">
                          <div className="text-[#8B95A1] font-semibold">측정 · 실험 메모</div>
                          <div className="font-medium text-[#191F28] mt-0.5">
                            {item.project.experiment_memo || item.project.description || "미입력"}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="text-[12px] font-bold text-[#191F28]">
                          시료 기반 기기별 등록 데이터 현황 및 분석 화면 바로가기
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                          {(
                            [
                              { key: "XRD", label: "XRD", mode: "xrd" as ServiceMode },
                              { key: "SEM", label: "SEM", mode: "sem" as ServiceMode },
                              { key: "UTM", label: "UTM", mode: "utm" as ServiceMode },
                              { key: "HALL", label: "Hall", mode: "hall" as ServiceMode },
                              { key: "LFA", label: "LFA", mode: "lfa" as ServiceMode },
                              { key: "FTIR", label: "FT-IR", mode: "ftir" as ServiceMode },
                              { key: "DSC", label: "DSC", mode: "dsc" as ServiceMode },
                              { key: "TGA", label: "TGA", mode: "tga" as ServiceMode },
                            ]
                          ).map((inst) => {
                            const cnt = item.instrumentCounts?.[inst.key] || 0;
                            return (
                              <button
                                key={inst.key}
                                type="button"
                                onClick={() => onOpenProject(item.project!.id, inst.mode)}
                                className={`p-2.5 rounded-[10px] border text-left transition-all cursor-pointer ${
                                  cnt > 0
                                    ? "bg-white border-[#BFDBFE] hover:border-[#3182F6]"
                                    : "bg-white/60 border-[#E5E8EB] hover:border-[#90B8F8]"
                                }`}
                              >
                                <div className="text-[12px] font-bold text-[#191F28]">{inst.label}</div>
                                <div
                                  className={`text-[11px] mt-0.5 font-semibold ${
                                    cnt > 0 ? "text-[#3182F6]" : "text-[#8B95A1]"
                                  }`}
                                >
                                  등록 데이터: {cnt}개
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Safe Sample Deletion Confirmation Modal */}
      {confirmDeleteSample && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-[20px] bg-white border border-[#E5E8EB] p-6 shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-[#FEE2E2] text-[#DC2626] flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-[17px] font-bold text-[#191F28]">
                  시료 삭제 확인 및 연결 데이터 보호 안내
                </h3>
                <p className="text-[13px] text-[#4E5968] mt-1 leading-relaxed">
                  <strong>{confirmDeleteSample.sample_name}</strong> 시료에는 현재{" "}
                  <strong>분석 실행 {confirmDeleteSample.run_count}회</strong> 및 연결된 측정 데이터가 포함되어 있습니다.
                  시료를 삭제하면 연결된 측정 파일과 분석 이력도 함께 제거됩니다. 정말 삭제하시겠습니까?
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmDeleteSample(null)}
              >
                취소 (데이터 보존)
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => {
                  const id = confirmDeleteSample.id;
                  setConfirmDeleteSample(null);
                  onDeleteProject(id);
                }}
              >
                <Trash2 className="w-4 h-4" />
                <span>시료 및 연결 데이터 삭제</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
