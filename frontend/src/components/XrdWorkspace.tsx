import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Eye,
  EyeOff,
  FileCode2,
  FileSpreadsheet,
  FolderOpen,
  Layers,
  Loader2,
  Play,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { api } from "../api";
import type {
  DesktopFileInfo,
  HealthInfo,
  ProjectDetail,
  RunDetail,
  XRDParams,
  XrdSeriesCurveItem,
} from "../types";
import { PeriodicTablePicker } from "./PeriodicTablePicker";
import { PlotlyChart } from "./PlotlyChart";
import { XrdView } from "./XrdView";
import { Button, Card, StatusBadge, SwitchControl, TermTooltip } from "./ui/primitives";

const OVERLAY_PALETTE = [
  "#2563EB",
  "#DC2626",
  "#059669",
  "#D97706",
  "#7C3AED",
  "#0891B2",
  "#DB2777",
  "#4F46E5",
];

interface XrdWorkspaceProps {
  health: HealthInfo | null;
  activeProject: ProjectDetail | null;
  activeRun: RunDetail | null;
  xrdParams: XRDParams;
  runAi: boolean;
  isBusy: boolean;
  isJobRunning: boolean;
  onChangeXrdParams: (next: XRDParams) => void;
  onChangeRunAi: (val: boolean) => void;
  onUpdateProjectMeta: (patch: Record<string, any>) => void;
  onUploadMultipleFiles: (role: "xrd" | "cif", files: File[]) => Promise<void>;
  onUploadFromDesktop: (role: "xrd" | "cif", filename: string) => void;
  onDeleteFile: (fileId: string) => Promise<void>;
  onStartXrdRun: (selectedXrdFileId?: string | null) => Promise<void>;
  onSelectRun: (runId: string) => Promise<void>;
  onLoadSample: (preset: "tio2_powder") => void;
  onOpenRegisterModal: () => void;
  onNavigateToSem: () => void;
  onNavigateToIntegrated: () => void;
}

export function XrdWorkspace({
  health,
  activeProject,
  activeRun,
  xrdParams,
  runAi,
  isBusy,
  isJobRunning,
  onChangeXrdParams,
  onChangeRunAi,
  onUpdateProjectMeta,
  onUploadMultipleFiles,
  onUploadFromDesktop,
  onDeleteFile,
  onStartXrdRun,
  onSelectRun,
  onLoadSample,
  onOpenRegisterModal,
  onNavigateToSem,
  onNavigateToIntegrated,
}: XrdWorkspaceProps) {
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [graphMode, setGraphMode] = useState<"individual" | "overlay">("individual");
  const [seriesCurves, setSeriesCurves] = useState<XrdSeriesCurveItem[]>([]);
  const [loadingSeries, setLoadingSeries] = useState(false);
  const [visibleFileIds, setVisibleFileIds] = useState<Record<string, boolean>>({});
  const [yOffsetStep, setYOffsetStep] = useState<number>(0);
  const [normOverlay, setNormOverlay] = useState<boolean>(false);
  const [dragActive, setDragActive] = useState(false);
  const [showSetupDrawer, setShowSetupDrawer] = useState(true);
  const [desktopFiles, setDesktopFiles] = useState<DesktopFileInfo[]>([]);
  const [formulaInput, setFormulaInput] = useState("");

  const xrdFiles = useMemo(
    () => (activeProject?.files || []).filter((f) => f.file_role === "xrd"),
    [activeProject?.files]
  );
  const xrdFilesKey = useMemo(
    () => xrdFiles.map((f) => `${f.id}:${f.sha256}`).join("|"),
    [xrdFiles]
  );
  const cifFiles = useMemo(
    () => (activeProject?.files || []).filter((f) => f.file_role === "cif"),
    [activeProject?.files]
  );

  useEffect(() => {
    setFormulaInput(activeProject?.expected_formula || "");
  }, [activeProject?.id, activeProject?.expected_formula]);

  useEffect(() => {
    api
      .listDesktopFiles()
      .then((res) => setDesktopFiles((res.files || []).filter((f) => f.role === "xrd")))
      .catch(() => setDesktopFiles([]));
  }, [activeProject?.id]);

  // Keep selectedFileId valid when project or xrdFiles change
  useEffect(() => {
    if (xrdFiles.length === 0) {
      setSelectedFileId(null);
      return;
    }
    if (!selectedFileId || !xrdFiles.some((f) => f.id === selectedFileId)) {
      const latestFile = xrdFiles[xrdFiles.length - 1];
      setSelectedFileId(latestFile.id);
    }
  }, [xrdFiles, selectedFileId]);

  const selectedXrdFile = useMemo(
    () => xrdFiles.find((f) => f.id === selectedFileId) || xrdFiles[xrdFiles.length - 1] || null,
    [xrdFiles, selectedFileId]
  );

  const selectedRawCurve = useMemo(
    () =>
      seriesCurves.find((c) => c.file_id === selectedXrdFile?.id) ||
      seriesCurves[seriesCurves.length - 1] ||
      null,
    [seriesCurves, selectedXrdFile?.id]
  );

  // Fetch multi-file XRD curves for Overlay Mode & quick preview
  const fetchXrdSeries = useCallback(() => {
    if (!activeProject?.id || xrdFiles.length === 0) {
      setSeriesCurves([]);
      return;
    }
    setLoadingSeries(true);
    api
      .getProjectXrdSeries(activeProject.id)
      .then((res) => {
        const list = res.series || [];
        setSeriesCurves(list);
        setVisibleFileIds((prev) => {
          const next = { ...prev };
          for (const item of list) {
            if (next[item.file_id] === undefined) {
              next[item.file_id] = true;
            }
          }
          return next;
        });
      })
      .catch(() => {})
      .finally(() => setLoadingSeries(false));
  }, [activeProject?.id, xrdFiles.length, xrdFilesKey]);

  useEffect(() => {
    fetchXrdSeries();
  }, [fetchXrdSeries, activeRun?.id, activeRun?.status]);

  // When user selects a specific XRD file in the list, load its associated run if completed
  const handleSelectXrdFile = async (fileId: string) => {
    setSelectedFileId(fileId);
    if (!activeProject) return;

    // Restore per-file XRD params if saved
    const savedFileParams = activeProject.current_conditions?.xrd_params_by_file?.[fileId];
    if (savedFileParams) {
      onChangeXrdParams({
        ...xrdParams,
        ...savedFileParams,
        crystallinity: {
          ...xrdParams.crystallinity,
          ...(savedFileParams.crystallinity || {}),
        },
      });
    }

    // Find latest completed run for this file
    const matchingRun = activeProject.runs.find(
      (r) => r.status === "completed" && r.xrd_file_id === fileId
    );
    if (matchingRun && matchingRun.id !== activeRun?.id) {
      await onSelectRun(matchingRun.id);
    }
  };

  // Build Plotly traces for Overlay Mode & Individual Raw Preview
  const overlayPlot = useMemo(() => {
    const activeCurves = seriesCurves.filter(
      (c) => visibleFileIds[c.file_id] !== false && c.two_theta.length > 0
    );
    const filenameCounts: Record<string, number> = {};
    for (const c of activeCurves) {
      filenameCounts[c.filename] = (filenameCounts[c.filename] || 0) + 1;
    }

    const traces = activeCurves.map((c, idx) => {
      const baseArr = normOverlay ? c.intensity_norm : c.intensity_raw;
      const offsetVal = idx * yOffsetStep;
      const yArr = offsetVal === 0 ? baseArr : baseArr.map((v) => v + offsetVal);
      const color = OVERLAY_PALETTE[c.order_index % OVERLAY_PALETTE.length];
      const hasDupName = (filenameCounts[c.filename] || 0) > 1;
      const traceName = `${hasDupName ? `[#${c.order_index + 1}] ` : ""}${c.filename}${
        c.primary_phase ? ` (${c.primary_phase})` : ""
      }`;
      const isRawExact = !normOverlay && offsetVal === 0;
      return {
        uid: c.file_id,
        x: c.two_theta,
        y: yArr,
        customdata: c.intensity_raw,
        type: "scatter",
        mode: "lines",
        name: traceName,
        line: { color, width: 1.9 },
        hovertemplate: isRawExact
          ? `<b>${c.filename}</b><br>2θ: %{x:.4f}°<br>원본 Intensity: %{customdata:.2f}<extra></extra>`
          : `<b>${c.filename}</b><br>2θ: %{x:.4f}°<br>원본 Intensity: %{customdata:.2f}<br>변환 표시값: %{y:.2f}<extra></extra>`,
      };
    });

    const isRawMode = !normOverlay && yOffsetStep === 0;
    const yAxisTitle = isRawMode
      ? "Intensity (원본 측정값 · counts / CPS)"
      : normOverlay
      ? `Normalized Intensity (Max=100${yOffsetStep > 0 ? `, Offset +${yOffsetStep}` : ""})`
      : `Raw Intensity (Offset +${yOffsetStep})`;

    const layout = {
      title: {
        text: `${activeProject?.sample_name || "시료"} — 다중 XRD 회절 패턴 중첩 비교 (${activeCurves.length}개 데이터셋 · ${
          isRawMode ? "원본 측정 수치" : "시각화 보조 변환 적용"
        })`,
        font: { size: 15, color: "#191F28" },
      },
      xaxis: {
        title: { text: "2θ (degree)" },
        gridcolor: "#F2F4F6",
        zeroline: false,
      },
      yaxis: {
        title: { text: yAxisTitle },
        gridcolor: "#F2F4F6",
        zeroline: false,
      },
      legend: { orientation: "h", y: 1.12, x: 0 },
      hovermode: "closest",
      margin: { t: 55, r: 25, b: 55, l: 70 },
      paper_bgcolor: "#FFFFFF",
      plot_bgcolor: "#FAFAFA",
    };

    return { traces, layout, isRawMode };
  }, [seriesCurves, visibleFileIds, normOverlay, yOffsetStep, activeProject?.sample_name]);

  // Individual Raw Preview Plot for newly uploaded file before full Run execution
  const individualPreviewPlot = useMemo(() => {
    if (!selectedRawCurve || selectedRawCurve.two_theta.length === 0) return null;
    const color = OVERLAY_PALETTE[selectedRawCurve.order_index % OVERLAY_PALETTE.length];
    const traces: any[] = [
      {
        uid: `preview-${selectedRawCurve.file_id}`,
        x: selectedRawCurve.two_theta,
        y: selectedRawCurve.intensity_raw,
        type: "scatter",
        mode: "lines",
        name: `${selectedRawCurve.filename} [원본 측정값]`,
        line: { color, width: 1.8 },
        hovertemplate: `<b>${selectedRawCurve.filename}</b><br>2θ: %{x:.4f}°<br>원본 Intensity: %{y:.2f}<extra></extra>`,
      },
    ];
    if (
      selectedRawCurve.max_two_theta_raw != null &&
      selectedRawCurve.max_intensity_raw != null
    ) {
      traces.push({
        x: [selectedRawCurve.max_two_theta_raw],
        y: [selectedRawCurve.max_intensity_raw],
        type: "scatter",
        mode: "markers",
        name: `최대 강도 피크 (${selectedRawCurve.max_two_theta_raw.toFixed(3)}°, I=${selectedRawCurve.max_intensity_raw.toFixed(1)})`,
        marker: { color: "#DC2626", size: 8, symbol: "circle" },
      });
    }
    const layout = {
      title: {
        text: `${selectedRawCurve.filename} — 원본 XRD 측정 데이터 그래프 (${selectedRawCurve.two_theta.length} points)`,
        font: { size: 14, color: "#191F28" },
      },
      xaxis: { title: { text: "2θ (degree)" }, gridcolor: "#F2F4F6", zeroline: false },
      yaxis: { title: { text: "Intensity (counts / 원본 단위)" }, gridcolor: "#F2F4F6", zeroline: false },
      legend: { orientation: "h", y: 1.12, x: 0 },
      hovermode: "closest",
      margin: { t: 50, r: 25, b: 50, l: 70 },
    };
    return { traces, layout };
  }, [selectedRawCurve]);

  // Check if activeRun matches the currently selected XRD file
  const activeRunMatchesSelectedFile = Boolean(
    activeRun &&
      activeRun.status === "completed" &&
      activeRun.xrd_result &&
      (!selectedFileId ||
        !activeRun.xrd_result.source_file_id ||
        activeRun.xrd_result.source_file_id === selectedFileId ||
        xrdFiles.length === 1)
  );

  if (!activeProject) {
    return (
      <Card className="p-8 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-[#EFF6FF] text-[#3182F6] flex items-center justify-center mx-auto">
          <Activity className="w-6 h-6" />
        </div>
        <div className="space-y-1.5 max-w-lg mx-auto">
          <h2 className="text-[20px] font-bold text-[#191F28]">
            XRD 회절 분석을 시작할 공통 시료를 선택하거나 홈 화면에서 등록해주세요
          </h2>
          <p className="text-[13px] text-[#6B7684] leading-relaxed">
            상단의 <strong>공통 분석 시료</strong> 선택창에서 기존 시료를 선택하거나, 홈 화면 통합 시료 관리에서 새 시료를 등록한 뒤 여러 개의 XRD 데이터 파일을 업로드하여 개별·중첩 분석을 수행할 수 있습니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
          <Button type="button" variant="primary" onClick={onOpenRegisterModal}>
            <FolderOpen className="w-4 h-4" />
            <span>홈 화면에서 시료 등록·관리</span>
          </Button>
          <Button type="button" variant="secondary" disabled={isBusy} onClick={() => onLoadSample("tio2_powder")}>
            <Sparkles className="w-4 h-4 text-[#3182F6]" />
            <span>검증용 TiO2 XRD 샘플 불러오기</span>
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Sample Composition, Periodic Table & Multi-File XRD Upload Panel */}
      <Card className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-[12px] bg-[#EFF6FF] text-[#3182F6] flex items-center justify-center">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-[18px] font-bold text-[#191F28]">
                  XRD 결정구조 및 다중 패턴 분석 — {activeProject.sample_name}
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[12px] font-bold bg-[#EFF6FF] text-[#3182F6]">
                  업로드 파일 {xrdFiles.length}개
                </span>
              </div>
              <p className="text-[12px] text-[#6B7684]">
                주기율표 원소 필터링, 다중 XRD 파일 동시 업로드, 개별 정량 피크·결정상 분석 및 다중 패턴 중첩(Overlay) 비교를 지원합니다.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setShowSetupDrawer((v) => !v)}
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span>{showSetupDrawer ? "데이터·원소·조건 설정 접기" : "데이터·원소·조건 설정 펼치기"}</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onNavigateToSem}
              className="border-[#15803D] text-[#15803D] hover:bg-[#F0FDF4]"
            >
              <span>SEM 미세조직 연계 분석 →</span>
            </Button>
          </div>
        </div>

        {showSetupDrawer && (
          <div className="space-y-5 pt-4 border-t border-[#E5E8EB]">
            {/* Composition & Periodic Table */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
              <div className="lg:col-span-4 space-y-2">
                <label className="block text-[13px] font-semibold text-[#191F28]">
                  재료 조성 · 화학식 (Chemical Composition)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={formulaInput}
                    onChange={(e) => setFormulaInput(e.target.value)}
                    placeholder="예: Nb0.8Ti0.2FeSb 또는 TiO2"
                    className="flex-1 min-h-[42px] px-3.5 rounded-[12px] border border-[#E5E8EB] text-[13px] focus:outline-none focus:border-[#3182F6]"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      onUpdateProjectMeta({
                        expected_formula: formulaInput.trim(),
                        change_summary: `조성 화학식 변경: ${formulaInput.trim() || "없음"}`,
                      })
                    }
                  >
                    적용
                  </Button>
                </div>
                <p className="text-[11px] text-[#6B7684]">
                  우측 주기율표에서 구성 원소를 선택하면 결정상 후보 매칭 시 해당 원소 조합을 우선 필터링합니다.
                </p>
              </div>

              <div className="lg:col-span-8">
                <PeriodicTablePicker
                  selectedElements={activeProject.expected_elements}
                  onChange={(nextElems) =>
                    onUpdateProjectMeta({
                      expected_elements: nextElems,
                      change_summary: `예상 원소 변경: ${nextElems.join(", ") || "없음"}`,
                    })
                  }
                  defaultExpanded={false}
                  compact={true}
                />
              </div>
            </div>

            {/* Multi-File XRD Drag & Drop Upload + File List */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Left: Multi-file Dropzone */}
              <div className="lg:col-span-5 space-y-3">
                <label
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragActive(false);
                    const dropped = Array.from(e.dataTransfer.files || []);
                    if (dropped.length > 0) {
                      onUploadMultipleFiles("xrd", dropped);
                    }
                  }}
                  className={`flex flex-col items-center justify-center border-2 border-dashed rounded-[16px] p-5 cursor-pointer transition-colors min-h-[130px] text-center ${
                    dragActive
                      ? "border-[#3182F6] bg-[#EFF6FF]"
                      : "border-[#E5E8EB] hover:border-[#3182F6] bg-[#F7F8FA]/60"
                  }`}
                >
                  <Upload className="w-6 h-6 text-[#3182F6] mb-2" />
                  <span className="text-[14px] font-bold text-[#191F28]">
                    XRD 데이터 파일 다중 업로드 (클릭 또는 끌어다 놓기)
                  </span>
                  <span className="text-[12px] text-[#6B7684] mt-1">
                    CSV, XLSX, TXT, XY, DAT, ASC 다중 선택 지원 · 기존 업로드 데이터 유지하며 추가 등록
                  </span>
                  <input
                    type="file"
                    multiple
                    accept=".csv,.txt,.xy,.dat,.xlsx,.xls,.asc"
                    className="hidden"
                    disabled={isBusy}
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      if (files.length > 0) {
                        onUploadMultipleFiles("xrd", files);
                      }
                      e.currentTarget.value = "";
                    }}
                  />
                </label>

                {desktopFiles.length > 0 && (
                  <div className="bg-[#F7F8FA] rounded-[12px] p-3 space-y-1.5 border border-[#E5E8EB]">
                    <div className="text-[12px] font-semibold text-[#191F28] flex items-center gap-1.5">
                      <FolderOpen className="w-3.5 h-3.5 text-[#3182F6]" />
                      바탕화면 XRD 파일 빠른 추가
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {desktopFiles.map((df) => (
                        <button
                          key={df.filename}
                          type="button"
                          disabled={isBusy}
                          onClick={() => onUploadFromDesktop("xrd", df.filename)}
                          className="px-2.5 py-1 rounded-[8px] text-[11px] font-medium bg-white border border-[#E5E8EB] hover:border-[#3182F6] text-[#191F28] cursor-pointer"
                        >
                          📄 {df.filename}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Custom CIF Upload */}
                <div className="flex items-center justify-between px-3 py-2 rounded-[12px] bg-[#F7F8FA] border border-[#E5E8EB]">
                  <span className="text-[12px] text-[#6B7684]">
                    사용자 기준 결정구조 CIF ({cifFiles.length}개 등록됨)
                  </span>
                  <label className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#3182F6] hover:underline cursor-pointer">
                    <FileCode2 className="w-4 h-4" />
                    <span>CIF 파일 추가</span>
                    <input
                      type="file"
                      multiple
                      accept=".cif"
                      className="hidden"
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        if (files.length > 0) onUploadMultipleFiles("cif", files);
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>
              </div>

              {/* Right: Uploaded XRD File List & Measurement Conditions */}
              <div className="lg:col-span-7 space-y-4">
                <div className="rounded-[16px] border border-[#E5E8EB] bg-[#F8FAFC] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[13px] font-bold text-[#191F28] flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4 text-[#3182F6]" />
                      <span>업로드된 XRD 측정 파일 목록 ({xrdFiles.length}개)</span>
                    </div>
                    {xrdFiles.length > 1 && (
                      <span className="text-[11px] text-[#6B7684]">
                        파일을 클릭하여 개별 분석하거나 중첩 그래프 모드에서 비교하세요
                      </span>
                    )}
                  </div>

                  {xrdFiles.length === 0 ? (
                    <div className="py-8 text-center text-[13px] text-[#6B7684] bg-white rounded-[12px] border border-[#E5E8EB]">
                      아직 이 시료에 업로드된 XRD 데이터 파일이 없습니다. 왼쪽 영역에 파일을 올려주세요.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[240px] overflow-y-auto pr-1">
                      {xrdFiles.map((xf, idx) => {
                        const isSelected = selectedXrdFile?.id === xf.id;
                        const fileRun = activeProject.runs.find(
                          (r) =>
                            r.status === "completed" &&
                            (r.xrd_file_id === xf.id || (xrdFiles.length === 1 && r.xrd_summary))
                        );
                        const color = OVERLAY_PALETTE[idx % OVERLAY_PALETTE.length];
                        return (
                          <div
                            key={xf.id}
                            onClick={() => handleSelectXrdFile(xf.id)}
                            className={`flex flex-wrap items-center justify-between gap-2 p-3 rounded-[12px] border transition-all cursor-pointer ${
                              isSelected
                                ? "bg-white border-[#3182F6] ring-2 ring-[#3182F6]/15"
                                : "bg-white/80 border-[#E5E8EB] hover:border-[#90B8F8]"
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              <span
                                className="w-3 h-3 rounded-full shrink-0"
                                style={{ backgroundColor: color }}
                              />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-[13px] font-bold text-[#191F28] truncate">
                                    {xf.original_filename}
                                  </span>
                                  {isSelected && (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#EFF6FF] text-[#3182F6]">
                                      선택됨
                                    </span>
                                  )}
                                  {fileRun ? (
                                    <StatusBadge status="분석 완료" />
                                  ) : (
                                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#F2F4F6] text-[#6B7684]">
                                      분석 대기
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-[#6B7684] mt-0.5">
                                  {xf.inspection?.n_points
                                    ? `${xf.inspection.n_points} points (${xf.inspection.two_theta_min}°–${xf.inspection.two_theta_max}°)`
                                    : `${(xf.size_bytes / 1024).toFixed(1)} KB`}
                                  {fileRun?.xrd_summary?.primary_phase
                                    ? ` · 주상: ${fileRun.xrd_summary.primary_phase} · 피크 ${fileRun.xrd_summary.peak_count}개`
                                    : ""}
                                </div>
                              </div>
                            </div>

                            <div
                              className="flex items-center gap-1.5 shrink-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Button
                                type="button"
                                size="sm"
                                variant={isSelected ? "primary" : "outline"}
                                disabled={isBusy || isJobRunning}
                                onClick={async () => {
                                  setSelectedFileId(xf.id);
                                  setGraphMode("individual");
                                  await onStartXrdRun(xf.id);
                                }}
                                className="min-h-[36px] px-3 text-[12px]"
                              >
                                <Play className="w-3.5 h-3.5" />
                                <span>{fileRun ? "재분석" : "분석 실행"}</span>
                              </Button>
                              <button
                                type="button"
                                aria-label={`${xf.original_filename} 삭제`}
                                title="이 XRD 파일 삭제"
                                disabled={isBusy || isJobRunning}
                                onClick={() => onDeleteFile(xf.id)}
                                className="p-2 rounded-[8px] text-[#8B95A1] hover:text-[#DC2626] hover:bg-[#FEE2E2]/60 cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Selected File Measurement Condition Controls */}
                {selectedXrdFile && selectedXrdFile.inspection && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-[14px] bg-[#F7F8FA] border border-[#E5E8EB]">
                    <div>
                      <label className="block text-[11px] font-semibold text-[#6B7684] mb-1">
                        X선 소스 파장 프리셋
                      </label>
                      <select
                        value={xrdParams.xray_source}
                        onChange={(e) => {
                          const src = e.target.value;
                          const wl = health?.xray_presets?.[src] ?? xrdParams.wavelength_angstrom;
                          onChangeXrdParams({ ...xrdParams, xray_source: src, wavelength_angstrom: wl });
                        }}
                        className="w-full min-h-[38px] px-2.5 rounded-[10px] border border-[#E5E8EB] text-[12px] bg-white"
                      >
                        {Object.entries(health?.xray_presets || { "Cu Kα (1.5406 Å)": 1.5406 }).map(
                          ([label, wl]) => (
                            <option key={label} value={label}>
                              {label} ({wl} Å)
                            </option>
                          )
                        )}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-[#6B7684] mb-1">
                        기기 선폭 보정 FWHM (°)
                        <TermTooltip
                          term="기기 선폭 보정"
                          description="표준시료로 측정한 장비 고유 선폭입니다. 비워두면 미보정 추정값으로 표시됩니다."
                        />
                      </label>
                      <input
                        type="number"
                        step="0.005"
                        placeholder="미입력 시 미보정 (예: 0.08)"
                        value={xrdParams.inst_fwhm_deg ?? ""}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          onChangeXrdParams({
                            ...xrdParams,
                            inst_fwhm_deg: raw === "" ? null : Math.max(0, parseFloat(raw)),
                          });
                        }}
                        className="w-full min-h-[38px] px-2.5 rounded-[10px] border border-[#E5E8EB] bg-white text-[12px] tabular-nums"
                      />
                    </div>

                    <div className="flex flex-col justify-end">
                      <SwitchControl
                        checked={runAi}
                        onCheckedChange={onChangeRunAi}
                        label="Gemini AI 해석 포함"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Running Progress Card */}
      {isJobRunning && activeRun && (
        <div className="rounded-[20px] bg-white border border-[#BFDBFE] p-8 text-center space-y-4">
          <Loader2 className="w-8 h-8 text-[#3182F6] animate-spin mx-auto" />
          <div className="text-[18px] font-bold text-[#191F28]">
            XRD 수치 엔진이 데이터를 계산하고 있습니다 (Run #{activeRun.run_number})
          </div>
          <p className="text-[14px] text-[#6B7684]">{activeRun.stage_message}</p>
        </div>
      )}

      {/* 2. Graph Mode Toggle: ① 개별 그래프 모드 vs ② 중첩 그래프 모드 (Overlay Mode) */}
      {xrdFiles.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-[18px] border border-[#E5E8EB]">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold text-[#191F28] mr-1">XRD 시각화 모드:</span>
            <div className="inline-flex p-1 rounded-[12px] bg-[#F2F4F6] border border-[#E5E8EB] gap-1">
              <button
                type="button"
                onClick={() => setGraphMode("individual")}
                className={`px-3.5 py-1.5 rounded-[9px] text-[13px] font-semibold transition-all cursor-pointer ${
                  graphMode === "individual"
                    ? "bg-[#3182F6] text-white shadow-xs font-bold"
                    : "text-[#6B7684] hover:text-[#191F28]"
                }`}
              >
                ① 개별 그래프 및 정밀 분석 모드
              </button>
              <button
                type="button"
                onClick={() => setGraphMode("overlay")}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[9px] text-[13px] font-semibold transition-all cursor-pointer ${
                  graphMode === "overlay"
                    ? "bg-[#3182F6] text-white shadow-xs font-bold"
                    : "text-[#6B7684] hover:text-[#191F28]"
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>② 중첩 그래프 모드 (Overlay · {xrdFiles.length}개)</span>
              </button>
            </div>
          </div>

          {graphMode === "individual" && selectedXrdFile && (
            <div className="flex items-center gap-2 text-[13px]">
              <span className="text-[#6B7684]">현재 선택 파일:</span>
              <strong className="text-[#191F28]">{selectedXrdFile.original_filename}</strong>
              <Button
                type="button"
                size="sm"
                variant="primary"
                disabled={isBusy || isJobRunning}
                onClick={() => onStartXrdRun(selectedXrdFile.id)}
              >
                <Play className="w-3.5 h-3.5" />
                <span>선택 파일 정밀 분석 실행</span>
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Mode ②: Multi-XRD Overlay Mode */}
      {xrdFiles.length > 0 && graphMode === "overlay" && (
        <Card className="space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-[#E5E8EB]">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-[17px] font-bold text-[#191F28] flex items-center gap-2">
                  <Layers className="w-5 h-5 text-[#3182F6]" />
                  다중 XRD 회절 패턴 중첩 비교 (Overlay Mode)
                </h3>
                {overlayPlot.isRawMode ? (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0]">
                    원본 측정 데이터 표시 중 (보간·정규화·평활화 미적용)
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#FEF3C7] text-[#B45309] border border-[#FDE68A]">
                    시각화 변환 적용됨 ({normOverlay ? "최대강도 100 정규화" : "원본 강도"}
                    {yOffsetStep > 0 ? ` · Y-Offset +${yOffsetStep}` : ""}) — 원본 데이터와 구분
                  </span>
                )}
              </div>
              <p className="text-[12px] text-[#6B7684] mt-0.5">
                동일한 2θ 축 위에서 업로드된 모든 XRD 데이터를 보간·평활화 없이 중첩 표시합니다. 마우스를 올리면 각 지점의 정확한 원본 측정값(2θ, Raw Intensity)을 확인할 수 있습니다.
              </p>
            </div>

            {/* Overlay Controls: Y-Offset Slider & Normalization Toggle */}
            <div className="flex flex-wrap items-center gap-4 bg-[#F7F8FA] px-4 py-2.5 rounded-[14px] border border-[#E5E8EB]">
              <div className="flex items-center gap-2">
                <label className="text-[12px] font-semibold text-[#191F28] whitespace-nowrap">
                  Y축 Offset 간격: <strong className="text-[#3182F6] tabular-nums">{yOffsetStep}</strong>
                </label>
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={10}
                  value={yOffsetStep}
                  onChange={(e) => setYOffsetStep(Number(e.target.value))}
                  className="w-28 accent-[#3182F6] cursor-pointer"
                />
              </div>

              <label className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#191F28] cursor-pointer">
                <input
                  type="checkbox"
                  checked={normOverlay}
                  onChange={(e) => setNormOverlay(e.target.checked)}
                  className="rounded accent-[#3182F6]"
                />
                <span>최대강도 100 정규화 (보조 비교용)</span>
              </label>

              {!overlayPlot.isRawMode && (
                <button
                  type="button"
                  onClick={() => {
                    setNormOverlay(false);
                    setYOffsetStep(0);
                  }}
                  className="px-2.5 py-1 rounded-[8px] text-[11px] font-bold bg-white border border-[#BFDBFE] text-[#3182F6] hover:bg-[#EFF6FF] cursor-pointer"
                >
                  원본 측정 수치로 복원
                </button>
              )}
            </div>
          </div>

          {/* Per-file Show/Hide Toggle Pills */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-semibold text-[#6B7684] mr-1">파일별 표시/숨기기:</span>
            {seriesCurves.map((c) => {
              const visible = visibleFileIds[c.file_id] !== false;
              const color = OVERLAY_PALETTE[c.order_index % OVERLAY_PALETTE.length];
              return (
                <button
                  key={c.file_id}
                  type="button"
                  onClick={() =>
                    setVisibleFileIds((prev) => ({
                      ...prev,
                      [c.file_id]: !visible,
                    }))
                  }
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-[10px] text-[12px] font-semibold border transition-all cursor-pointer ${
                    visible
                      ? "bg-white border-[#D1D6DB] text-[#191F28] shadow-2xs"
                      : "bg-[#F2F4F6] border-[#E5E8EB] text-[#8B95A1] opacity-60"
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span>{c.filename}</span>
                  {visible ? (
                    <Eye className="w-3.5 h-3.5 text-[#3182F6]" />
                  ) : (
                    <EyeOff className="w-3.5 h-3.5 text-[#8B95A1]" />
                  )}
                </button>
              );
            })}
          </div>

          {loadingSeries ? (
            <div className="py-16 text-center text-[13px] text-[#6B7684]">
              <Loader2 className="w-6 h-6 text-[#3182F6] animate-spin mx-auto mb-2" />
              다중 XRD 곡선 데이터를 불러오는 중입니다...
            </div>
          ) : (
            <div className="rounded-[16px] border border-[#E5E8EB] p-3 bg-white">
              <PlotlyChart data={overlayPlot.traces} layout={overlayPlot.layout} height={460} />
            </div>
          )}

          {/* File-by-File Peak & Quantitative Accuracy Verification Table */}
          {seriesCurves.length > 0 && (
            <div className="overflow-x-auto pt-2">
              <table className="w-full text-left text-[13px] border-collapse">
                <thead>
                  <tr className="border-b border-[#E5E8EB] bg-[#F7F8FA] text-[#6B7684]">
                    <th className="py-2.5 px-3">파일명</th>
                    <th className="py-2.5 px-3">데이터 점 수</th>
                    <th className="py-2.5 px-3">2θ 측정 범위</th>
                    <th className="py-2.5 px-3">원본 주피크 위치 (2θ_max)</th>
                    <th className="py-2.5 px-3">원본 최대 강도 (I_max)</th>
                    <th className="py-2.5 px-3">1순위 동정 결정상</th>
                    <th className="py-2.5 px-3">Scherrer 결정자 크기</th>
                    <th className="py-2.5 px-3 text-right">개별 분석</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F2F4F6]">
                  {seriesCurves.map((c) => {
                    const color = OVERLAY_PALETTE[c.order_index % OVERLAY_PALETTE.length];
                    return (
                      <tr key={c.file_id} className="hover:bg-[#F8FAFC]">
                        <td className="py-2.5 px-3 font-bold text-[#191F28]">
                          <span className="inline-flex items-center gap-2">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: color }}
                            />
                            <span>{c.filename}</span>
                          </span>
                        </td>
                        <td className="py-2.5 px-3 tabular-nums text-[#4E5968]">
                          {c.two_theta.length.toLocaleString()} pts
                        </td>
                        <td className="py-2.5 px-3 tabular-nums text-[#4E5968]">
                          {c.two_theta.length > 0
                            ? `${c.two_theta[0].toFixed(2)}° – ${c.two_theta[c.two_theta.length - 1].toFixed(2)}°`
                            : "-"}
                        </td>
                        <td className="py-2.5 px-3 tabular-nums font-semibold text-[#191F28]">
                          {c.max_two_theta_raw != null ? `${c.max_two_theta_raw.toFixed(4)}°` : "-"}
                        </td>
                        <td className="py-2.5 px-3 tabular-nums font-semibold text-[#191F28]">
                          {c.max_intensity_raw != null ? c.max_intensity_raw.toFixed(2) : "-"}
                        </td>
                        <td className="py-2.5 px-3 font-medium text-[#1D4ED8]">
                          {c.primary_phase
                            ? `${c.primary_phase} (${c.primary_formula || ""})`
                            : "정밀 분석 시 동정"}
                        </td>
                        <td className="py-2.5 px-3 tabular-nums">
                          {c.scherrer_mean_nm != null ? `${Number(c.scherrer_mean_nm).toFixed(1)} nm` : "-"}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              await handleSelectXrdFile(c.file_id);
                              setGraphMode("individual");
                              if (!c.latest_run_id) {
                                await onStartXrdRun(c.file_id);
                              }
                            }}
                            className="min-h-[34px] px-3 text-[12px]"
                          >
                            {c.latest_run_id ? "개별 결과 보기" : "정밀 분석 실행"}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Mode ①: Individual Graph & Full XrdView Analysis */}
      {xrdFiles.length > 0 && graphMode === "individual" && (
        <>
          {activeRunMatchesSelectedFile && activeRun ? (
            <XrdView
              runId={activeRun.id}
              xrdResult={activeRun.xrd_result}
              xrdParams={xrdParams}
              expectedElements={activeProject.expected_elements}
              isBusy={isBusy || isJobRunning}
              onChangeParams={onChangeXrdParams}
              onChangeExpectedElements={(nextElems) =>
                onUpdateProjectMeta({
                  expected_elements: nextElems,
                  change_summary: `예상 원소 변경: ${nextElems.join(", ") || "없음"}`,
                })
              }
              onRerun={() => onStartXrdRun(selectedXrdFile?.id)}
              onNavigateToIntegrated={onNavigateToIntegrated}
            />
          ) : (
            <Card className="p-6 sm:p-8 space-y-5">
              {individualPreviewPlot && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[15px] font-bold text-[#191F28]">
                      원본 XRD 측정 데이터 그래프 — {selectedXrdFile?.original_filename}
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0]">
                      원본 측정값 (2θ: {selectedRawCurve?.two_theta[0]?.toFixed(2)}°–
                      {selectedRawCurve?.two_theta[selectedRawCurve.two_theta.length - 1]?.toFixed(2)}° · 주피크{" "}
                      {selectedRawCurve?.max_two_theta_raw?.toFixed(3)}°, I_max=
                      {selectedRawCurve?.max_intensity_raw?.toFixed(2)})
                    </span>
                  </div>
                  <div className="rounded-[16px] border border-[#E5E8EB] p-3 bg-white">
                    <PlotlyChart
                      data={individualPreviewPlot.traces}
                      layout={individualPreviewPlot.layout}
                      height={380}
                    />
                  </div>
                </div>
              )}

              <div className="text-center space-y-3 pt-2">
                <CheckCircle2 className="w-9 h-9 text-[#3182F6] mx-auto" />
                <div className="space-y-1">
                  <h3 className="text-[17px] font-bold text-[#191F28]">
                    선택된 파일({selectedXrdFile?.original_filename})의 정밀 XRD 분석을 실행할 준비가 되었습니다
                  </h3>
                  <p className="text-[13px] text-[#6B7684]">
                    아래 버튼을 누르면 배경 보정(ALS), 비평활 피크 프로파일 피팅, 결정상 동정 및 Scherrer/Williamson–Hall 결정자 크기 계산을 수행합니다.
                  </p>
                </div>
                <div>
                  <Button
                    type="button"
                    variant="primary"
                    size="lg"
                    disabled={isBusy || isJobRunning}
                    onClick={() => onStartXrdRun(selectedXrdFile?.id)}
                  >
                    <Play className="w-4 h-4" />
                    <span>{selectedXrdFile?.original_filename} 정밀 XRD 분석 시작</span>
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
