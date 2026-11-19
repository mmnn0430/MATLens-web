import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  FolderOpen,
  Image as ImageIcon,
  Layers,
  Loader2,
  Microscope,
  Play,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { api, DEFAULT_SEM_PARAMS } from "../api";
import type {
  DesktopFileInfo,
  ProjectDetail,
  RunDetail,
  SEMParams,
} from "../types";
import { SemInteractiveCanvas } from "./SemInteractiveCanvas";
import { SemView } from "./SemView";
import { Button, Card, StatusBadge, SwitchControl } from "./ui/primitives";

interface SemWorkspaceProps {
  activeProject: ProjectDetail | null;
  activeRun: RunDetail | null;
  semParams: SEMParams;
  runAi: boolean;
  isBusy: boolean;
  isJobRunning: boolean;
  onChangeSemParams: (next: SEMParams) => void;
  onChangeRunAi: (val: boolean) => void;
  onUploadMultipleFiles: (role: "sem", files: File[]) => Promise<void>;
  onUploadFromDesktop: (role: "sem", filename: string) => void;
  onDeleteFile: (fileId: string) => Promise<void>;
  onStartSemRun: (selectedSemFileId?: string | null, overrideParams?: SEMParams) => Promise<void>;
  onSelectRun: (runId: string) => Promise<void>;
  onLoadSample: (preset: "sintered_grains" | "tio2_powder") => void;
  onOpenRegisterModal: () => void;
  onNavigateToXrd: () => void;
  onNavigateToIntegrated: () => void;
}

export function SemWorkspace({
  activeProject,
  activeRun,
  semParams,
  runAi,
  isBusy,
  isJobRunning,
  onChangeSemParams,
  onChangeRunAi,
  onUploadMultipleFiles,
  onUploadFromDesktop,
  onDeleteFile,
  onStartSemRun,
  onSelectRun,
  onLoadSample,
  onOpenRegisterModal,
  onNavigateToXrd,
  onNavigateToIntegrated,
}: SemWorkspaceProps) {
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [paramsByFileId, setParamsByFileId] = useState<Record<string, SEMParams>>({});
  const [dragActive, setDragActive] = useState(false);
  const [showUploadAndCalib, setShowUploadAndCalib] = useState(true);
  const [desktopFiles, setDesktopFiles] = useState<DesktopFileInfo[]>([]);

  const semFiles = useMemo(
    () => (activeProject?.files || []).filter((f) => f.file_role === "sem"),
    [activeProject?.files]
  );

  useEffect(() => {
    api
      .listDesktopFiles()
      .then((res) => setDesktopFiles((res.files || []).filter((f) => f.role === "sem")))
      .catch(() => setDesktopFiles([]));
  }, [activeProject?.id]);

  // Hydrate per-image SEMParams from project's sem_params_by_file + inspection
  useEffect(() => {
    if (!activeProject) {
      setParamsByFileId({});
      setSelectedFileId(null);
      return;
    }
    const savedMap = activeProject.current_conditions?.sem_params_by_file || {};
    setParamsByFileId((prev) => {
      const next: Record<string, SEMParams> = {};
      for (const f of semFiles) {
        if (prev[f.id]) {
          next[f.id] = prev[f.id];
          continue;
        }
        const saved = savedMap[f.id] || {};
        const insp = f.inspection || {};
        const sb = insp.primary_scalebar;
        next[f.id] = {
          ...DEFAULT_SEM_PARAMS,
          ...(semFiles.length === 1 ? activeProject.current_conditions?.sem_params || {} : {}),
          ...saved,
          roi: saved.roi || insp.suggested_roi || null,
          scale_x0: saved.scale_x0 ?? sb?.x0 ?? null,
          scale_y0: saved.scale_y0 ?? sb?.y0 ?? null,
          scale_x1: saved.scale_x1 ?? sb?.x1 ?? null,
          scale_y1: saved.scale_y1 ?? sb?.y1 ?? null,
          scale_length_px: saved.scale_length_px ?? sb?.length_px ?? null,
        };
      }
      return next;
    });
  }, [activeProject, semFiles]);

  // Keep selectedFileId valid
  useEffect(() => {
    if (semFiles.length === 0) {
      setSelectedFileId(null);
      return;
    }
    if (!selectedFileId || !semFiles.some((f) => f.id === selectedFileId)) {
      const latest = semFiles[semFiles.length - 1];
      setSelectedFileId(latest.id);
    }
  }, [semFiles, selectedFileId]);

  const selectedSemFile = useMemo(
    () => semFiles.find((f) => f.id === selectedFileId) || semFiles[semFiles.length - 1] || null,
    [semFiles, selectedFileId]
  );

  const currentImageParams: SEMParams = useMemo(() => {
    if (selectedSemFile && paramsByFileId[selectedSemFile.id]) {
      return paramsByFileId[selectedSemFile.id];
    }
    return semParams;
  }, [selectedSemFile, paramsByFileId, semParams]);

  const handleUpdateCurrentImageParams = (next: SEMParams) => {
    onChangeSemParams(next);
    if (selectedSemFile) {
      setParamsByFileId((prev) => ({
        ...prev,
        [selectedSemFile.id]: next,
      }));
    }
  };

  // Switch active SEM image and load its independent run result
  const handleSelectSemImage = async (fileId: string) => {
    setSelectedFileId(fileId);
    const imgParams = paramsByFileId[fileId];
    if (imgParams) {
      onChangeSemParams(imgParams);
    }
    if (!activeProject) return;
    const matchingRun = activeProject.runs.find(
      (r) =>
        r.status === "completed" &&
        (r.sem_file_id === fileId || (semFiles.length === 1 && r.sem_summary))
    );
    if (matchingRun && matchingRun.id !== activeRun?.id) {
      await onSelectRun(matchingRun.id);
    }
  };

  // Check if activeRun belongs to the currently selected SEM image
  const activeRunMatchesSelectedImage = Boolean(
    activeRun &&
      activeRun.status === "completed" &&
      activeRun.sem_result &&
      selectedSemFile &&
      (activeRun.sem_result.source_file_id === selectedSemFile.id ||
        (!activeRun.sem_result.source_file_id && semFiles.length === 1))
  );

  // Build comparison table rows across all uploaded SEM images of this sample
  const comparisonRows = useMemo(() => {
    if (!activeProject) return [];
    return semFiles.map((f, idx) => {
      const matchedRun = activeProject.runs.find(
        (r) =>
          r.status === "completed" &&
          (r.sem_file_id === f.id || (semFiles.length === 1 && r.sem_summary))
      );
      const sum = matchedRun?.sem_summary || null;
      const fovLabel = f.inspection?.fov_label || `Image ${String(idx + 1).padStart(2, "0")}`;
      return {
        file: f,
        fovLabel,
        runId: matchedRun?.id || null,
        runNumber: matchedRun?.run_number || null,
        summary: sum,
      };
    });
  }, [activeProject, semFiles]);

  if (!activeProject) {
    return (
      <Card className="p-8 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-[#F0FDF4] text-[#15803D] flex items-center justify-center mx-auto">
          <Microscope className="w-6 h-6" />
        </div>
        <div className="space-y-1.5 max-w-lg mx-auto">
          <h2 className="text-[20px] font-bold text-[#191F28]">
            SEM 미세조직 분석을 시작할 공통 시료를 선택하거나 홈 화면에서 등록해주세요
          </h2>
          <p className="text-[13px] text-[#6B7684] leading-relaxed">
            상단의 <strong>공통 분석 시료</strong> 선택창에서 시료를 선택한 뒤, 여러 배율(예: 1,000×, 5,000×, 10,000×)의 SEM 이미지를 동시에 업로드하여 이미지별 독립 스케일 보정 및 정량 분석을 수행할 수 있습니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
          <Button type="button" variant="primary" onClick={onOpenRegisterModal}>
            <FolderOpen className="w-4 h-4" />
            <span>홈 화면에서 시료 등록·관리</span>
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={isBusy}
            onClick={() => onLoadSample("sintered_grains")}
          >
            <Sparkles className="w-4 h-4 text-[#15803D]" />
            <span>소결 결정립 SEM 샘플 불러오기</span>
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Multi-Image SEM Upload, Thumbnail Gallery & Per-Image Scale Calibration */}
      <Card className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-[12px] bg-[#F0FDF4] text-[#15803D] flex items-center justify-center">
              <Microscope className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-[18px] font-bold text-[#191F28]">
                  SEM 미세구조 및 다중 이미지 분석 — {activeProject.sample_name}
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[12px] font-bold bg-[#F0FDF4] text-[#15803D]">
                  업로드 이미지 {semFiles.length}장
                </span>
              </div>
              <p className="text-[12px] text-[#6B7684]">
                다중 SEM 이미지 동시 업로드, 썸네일 미리보기, 이미지별 독립 Scale Calibration 및 입자·결정립 정량 비교를 지원합니다.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setShowUploadAndCalib((v) => !v)}
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span>{showUploadAndCalib ? "이미지 목록·스케일 보정 접기" : "이미지 목록·스케일 보정 펼치기"}</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onNavigateToXrd}
              className="border-[#3182F6] text-[#3182F6] hover:bg-[#EFF6FF]"
            >
              <span>XRD 결정구조 연계 분석 →</span>
            </Button>
          </div>
        </div>

        {showUploadAndCalib && (
          <div className="space-y-5 pt-4 border-t border-[#E5E8EB]">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Left: Multi-Image Dropzone + Thumbnail List */}
              <div className="lg:col-span-5 space-y-4">
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
                      onUploadMultipleFiles("sem", dropped);
                    }
                  }}
                  className={`flex flex-col items-center justify-center border-2 border-dashed rounded-[16px] p-5 cursor-pointer transition-colors min-h-[120px] text-center ${
                    dragActive
                      ? "border-[#15803D] bg-[#F0FDF4]"
                      : "border-[#E5E8EB] hover:border-[#15803D] bg-[#F7F8FA]/60"
                  }`}
                >
                  <Upload className="w-6 h-6 text-[#15803D] mb-1.5" />
                  <span className="text-[14px] font-bold text-[#191F28]">
                    SEM 이미지 다중 업로드 (클릭 또는 끌어다 놓기)
                  </span>
                  <span className="text-[12px] text-[#6B7684] mt-0.5">
                    TIF, TIFF, PNG, JPG, JPEG, BMP 다중 선택 지원 · 기존 이미지 유지하며 추가 등록
                  </span>
                  <input
                    type="file"
                    multiple
                    accept=".jpg,.jpeg,.png,.tif,.tiff,.bmp,.webp"
                    className="hidden"
                    disabled={isBusy}
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      if (files.length > 0) {
                        onUploadMultipleFiles("sem", files);
                      }
                      e.currentTarget.value = "";
                    }}
                  />
                </label>

                {desktopFiles.length > 0 && (
                  <div className="bg-[#F7F8FA] rounded-[12px] p-3 space-y-1.5 border border-[#E5E8EB]">
                    <div className="text-[12px] font-semibold text-[#191F28] flex items-center gap-1.5">
                      <FolderOpen className="w-3.5 h-3.5 text-[#15803D]" />
                      바탕화면 SEM 이미지 빠른 추가
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {desktopFiles.map((df) => (
                        <button
                          key={df.filename}
                          type="button"
                          disabled={isBusy}
                          onClick={() => onUploadFromDesktop("sem", df.filename)}
                          className="px-2.5 py-1 rounded-[8px] text-[11px] font-medium bg-white border border-[#E5E8EB] hover:border-[#15803D] text-[#191F28] cursor-pointer"
                        >
                          🖼️ {df.filename}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Thumbnail Gallery List */}
                <div className="rounded-[16px] border border-[#E5E8EB] bg-[#F8FAFC] p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-bold text-[#191F28] flex items-center gap-1.5">
                      <ImageIcon className="w-4 h-4 text-[#15803D]" />
                      업로드된 SEM 이미지 목록 ({semFiles.length}장)
                    </span>
                    <span className="text-[11px] text-[#6B7684]">이미지를 선택하여 개별 보정·분석</span>
                  </div>

                  {semFiles.length === 0 ? (
                    <div className="py-8 text-center text-[13px] text-[#6B7684] bg-white rounded-[12px] border border-[#E5E8EB]">
                      아직 업로드된 SEM 이미지가 없습니다. 위 업로드 영역에 이미지를 올려주세요.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                      {semFiles.map((sf, idx) => {
                        const isSelected = selectedSemFile?.id === sf.id;
                        const fileParams = paramsByFileId[sf.id];
                        const fileRun = activeProject.runs.find(
                          (r) =>
                            r.status === "completed" &&
                            (r.sem_file_id === sf.id || (semFiles.length === 1 && r.sem_summary))
                        );
                        return (
                          <div
                            key={sf.id}
                            onClick={() => handleSelectSemImage(sf.id)}
                            className={`flex items-center justify-between gap-3 p-2.5 rounded-[12px] border transition-all cursor-pointer ${
                              isSelected
                                ? "bg-white border-[#15803D] ring-2 ring-[#15803D]/15"
                                : "bg-white/80 border-[#E5E8EB] hover:border-[#86EFAC]"
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              {/* Thumbnail Preview */}
                              <div className="w-14 h-14 rounded-[10px] overflow-hidden bg-[#191F28] border border-[#E5E8EB] shrink-0">
                                <img
                                  src={api.rawFileUrl(activeProject.id, sf.id)}
                                  alt={sf.original_filename}
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                />
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-[11px] font-bold text-[#15803D] bg-[#F0FDF4] px-1.5 py-0.5 rounded">
                                    #{String(idx + 1).padStart(2, "0")}
                                  </span>
                                  <span className="text-[13px] font-bold text-[#191F28] truncate">
                                    {sf.original_filename}
                                  </span>
                                </div>
                                <div className="text-[11px] text-[#6B7684] mt-0.5">
                                  {sf.inspection?.width_px} × {sf.inspection?.height_px} px ·{" "}
                                  {fileParams?.scale_confirmed && fileParams?.scale_real_value
                                    ? `스케일: ${fileParams.scale_real_value} ${fileParams.scale_unit}`
                                    : "스케일 미확정"}
                                </div>
                                <div className="mt-1 flex items-center gap-1.5">
                                  {fileRun ? (
                                    <StatusBadge status="분석 완료" />
                                  ) : (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FEF3C7] text-[#D97706]">
                                      분석 대기
                                    </span>
                                  )}
                                  {fileRun?.sem_summary?.d50 != null && (
                                    <span className="text-[11px] font-semibold text-[#191F28] tabular-nums">
                                      D50: {Number(fileRun.sem_summary.d50).toFixed(2)}{" "}
                                      {fileRun.sem_summary.unit}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div
                              className="flex flex-col items-end gap-1 shrink-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Button
                                type="button"
                                size="sm"
                                variant={isSelected ? "primary" : "outline"}
                                disabled={isBusy || isJobRunning}
                                onClick={async () => {
                                  await handleSelectSemImage(sf.id);
                                  await onStartSemRun(sf.id, paramsByFileId[sf.id] || currentImageParams);
                                }}
                                className="min-h-[34px] px-2.5 text-[11px]"
                              >
                                <Play className="w-3 h-3" />
                                <span>{fileRun ? "재분석" : "분석"}</span>
                              </Button>
                              <button
                                type="button"
                                aria-label={`${sf.original_filename} 삭제`}
                                title="이 SEM 이미지 삭제"
                                disabled={isBusy || isJobRunning}
                                onClick={() => onDeleteFile(sf.id)}
                                className="p-1.5 rounded-[8px] text-[#8B95A1] hover:text-[#DC2626] hover:bg-[#FEE2E2]/60 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Right: Selected Image Interactive ROI & Independent Scale Bar Calibration */}
              <div className="lg:col-span-7 space-y-4">
                {selectedSemFile && selectedSemFile.inspection ? (
                  <div className="rounded-[16px] border border-[#E5E8EB] bg-white p-4 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-[14px] font-bold text-[#191F28]">
                          선택 이미지 독립 스케일(Scale Calibration) 및 ROI 설정 —{" "}
                          <span className="text-[#15803D]">{selectedSemFile.original_filename}</span>
                        </span>
                        <p className="text-[12px] text-[#6B7684]">
                          각 SEM 이미지는 배율이 다를 수 있으므로 이미지별로 스케일바 실제 길이를 독립적으로 적용합니다.
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="primary"
                        disabled={isBusy || isJobRunning}
                        onClick={() => onStartSemRun(selectedSemFile.id, currentImageParams)}
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>이 이미지 정량 분석 실행</span>
                      </Button>
                    </div>

                    <SemInteractiveCanvas
                      imageUrl={api.rawFileUrl(activeProject.id, selectedSemFile.id)}
                      mode="setup"
                      semParams={currentImageParams}
                      onChangeParams={handleUpdateCurrentImageParams}
                    />

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-[#E5E8EB]">
                      <div>
                        <label className="block text-[12px] font-medium text-[#6B7684] mb-1">
                          분석 모드 선택
                        </label>
                        <select
                          value={currentImageParams.mode}
                          onChange={(e) =>
                            handleUpdateCurrentImageParams({
                              ...currentImageParams,
                              mode: e.target.value as "particle" | "grain",
                            })
                          }
                          className="w-full min-h-[40px] px-3 rounded-[10px] border border-[#E5E8EB] text-[13px] bg-white"
                        >
                          <option value="particle">나노입자·분말 분할 (Watershed)</option>
                          <option value="grain">소결 결정립계 선형교차법 (Intercept)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[12px] font-medium text-[#6B7684] mb-1">
                          스케일바 실제 길이 숫자
                        </label>
                        <input
                          type="number"
                          step="any"
                          placeholder="예: 500 또는 10"
                          value={currentImageParams.scale_real_value ?? ""}
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            const val = raw === "" ? null : parseFloat(raw);
                            handleUpdateCurrentImageParams({
                              ...currentImageParams,
                              scale_real_value: val,
                              scale_confirmed: Boolean(
                                val && val > 0 && (currentImageParams.scale_length_px ?? 0) > 0
                              ),
                            });
                          }}
                          className="w-full min-h-[40px] px-3 rounded-[10px] border border-[#E5E8EB] text-[13px] tabular-nums"
                        />
                      </div>

                      <div>
                        <label className="block text-[12px] font-medium text-[#6B7684] mb-1">
                          단위
                        </label>
                        <select
                          value={currentImageParams.scale_unit}
                          onChange={(e) =>
                            handleUpdateCurrentImageParams({
                              ...currentImageParams,
                              scale_unit: e.target.value as "nm" | "µm" | "mm",
                            })
                          }
                          className="w-full min-h-[40px] px-3 rounded-[10px] border border-[#E5E8EB] text-[13px] bg-white"
                        >
                          <option value="nm">nm (나노미터)</option>
                          <option value="µm">µm (마이크로미터)</option>
                          <option value="mm">mm (밀리미터)</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                      <SwitchControl
                        checked={currentImageParams.scale_confirmed}
                        onCheckedChange={(val) =>
                          handleUpdateCurrentImageParams({
                            ...currentImageParams,
                            scale_confirmed: val,
                          })
                        }
                        label="이 이미지의 스케일바 보정 확인됨"
                      />
                      <SwitchControl
                        checked={runAi}
                        onCheckedChange={onChangeRunAi}
                        label="Gemini AI 미세조직 해석 포함"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="h-full min-h-[260px] rounded-[16px] border border-[#E5E8EB] bg-[#F7F8FA] flex flex-col items-center justify-center p-8 text-center text-[#6B7684]">
                    <ImageIcon className="w-10 h-10 text-[#D1D6DB] mb-2" />
                    <div className="text-[14px] font-semibold text-[#191F28]">
                      왼쪽에서 SEM 이미지를 업로드하거나 선택해주세요
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* 2. Multi-Image SEM Quantitative Comparison Table */}
      {semFiles.length > 1 && (
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[16px] font-bold text-[#191F28] flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#15803D]" />
              다중 SEM 이미지 정량 분석 결과 비교 ({semFiles.length}장)
            </h3>
            <span className="text-[12px] text-[#6B7684]">
              동일 시료({activeProject.sample_name})에 연결된 이미지별 독립 분석 결과
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px] border-collapse">
              <thead>
                <tr className="border-b border-[#E5E8EB] bg-[#F7F8FA] text-[#6B7684]">
                  <th className="py-2.5 px-3">이미지 파일명</th>
                  <th className="py-2.5 px-3">분석 모드</th>
                  <th className="py-2.5 px-3">스케일 단위</th>
                  <th className="py-2.5 px-3">검출 수 (N)</th>
                  <th className="py-2.5 px-3">평균 크기</th>
                  <th className="py-2.5 px-3">중앙값 D50 (D10–D90)</th>
                  <th className="py-2.5 px-3">공극률 (%)</th>
                  <th className="py-2.5 px-3 text-right">상태 · 열기</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F2F4F6]">
                {comparisonRows.map(({ file, runId, summary }) => {
                  const isCurrent = selectedSemFile?.id === file.id;
                  const unit = summary?.unit || paramsByFileId[file.id]?.scale_unit || "µm";
                  return (
                    <tr
                      key={file.id}
                      onClick={() => handleSelectSemImage(file.id)}
                      className={`hover:bg-[#F8FAFC] cursor-pointer ${
                        isCurrent ? "bg-[#F0FDF4]/60 font-medium" : ""
                      }`}
                    >
                      <td className="py-2.5 px-3 font-bold text-[#191F28]">
                        {file.original_filename}
                      </td>
                      <td className="py-2.5 px-3 text-[#4E5968]">
                        {summary?.mode === "grain" ? "결정립 선형교차" : "입자 분할"}
                      </td>
                      <td className="py-2.5 px-3 tabular-nums">
                        {summary?.scale_confirmed ? `${unit} (보정됨)` : "px (미보정)"}
                      </td>
                      <td className="py-2.5 px-3 tabular-nums">
                        {summary?.count != null ? `${summary.count}개` : "-"}
                      </td>
                      <td className="py-2.5 px-3 tabular-nums font-semibold text-[#191F28]">
                        {summary?.mean_size != null
                          ? `${Number(summary.mean_size).toFixed(2)} ${unit}`
                          : "-"}
                      </td>
                      <td className="py-2.5 px-3 tabular-nums text-[#15803D] font-bold">
                        {summary?.d50 != null
                          ? `${Number(summary.d50).toFixed(2)} ${unit} (${Number(summary.d10 ?? 0).toFixed(1)}–${Number(summary.d90 ?? 0).toFixed(1)})`
                          : "-"}
                      </td>
                      <td className="py-2.5 px-3 tabular-nums">
                        {summary?.porosity_pct != null
                          ? `${Number(summary.porosity_pct).toFixed(2)}%`
                          : "-"}
                      </td>
                      <td className="py-2.5 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <Button
                          type="button"
                          size="sm"
                          variant={isCurrent ? "primary" : "outline"}
                          disabled={isBusy || isJobRunning}
                          onClick={async () => {
                            await handleSelectSemImage(file.id);
                            if (!runId) {
                              await onStartSemRun(file.id, paramsByFileId[file.id]);
                            }
                          }}
                          className="min-h-[34px] px-3 text-[12px]"
                        >
                          {runId ? "결과 보기" : "분석 실행"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Running Progress Card */}
      {isJobRunning && activeRun && (
        <div className="rounded-[20px] bg-white border border-[#BFDBFE] p-8 text-center space-y-4">
          <Loader2 className="w-8 h-8 text-[#3182F6] animate-spin mx-auto" />
          <div className="text-[18px] font-bold text-[#191F28]">
            SEM 영상 처리 및 미세조직 정량 엔진이 계산 중입니다 (Run #{activeRun.run_number})
          </div>
          <p className="text-[14px] text-[#6B7684]">{activeRun.stage_message || "영역 분할 및 입도 통계 계산 중..."}</p>
          <div className="max-w-md mx-auto w-full bg-[#F2F4F6] h-2.5 rounded-full overflow-hidden">
            <div
              className="bg-[#15803D] h-full transition-all duration-300"
              style={{ width: `${Math.max(10, Math.min(100, activeRun.progress_pct || 35))}%` }}
            />
          </div>
          <div className="text-[12px] font-semibold text-[#15803D] tabular-nums">
            진행률: {Math.max(10, Math.min(100, activeRun.progress_pct || 35))}% (분석 중 중복 실행 방지됨)
          </div>
        </div>
      )}

      {/* Failed Run Retry Card */}
      {!isJobRunning && activeRun?.status === "failed" && selectedSemFile && (
        <div className="rounded-[20px] bg-[#FEF2F2] border border-[#FECACA] p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-[16px] font-bold text-[#DC2626]">
              SEM 이미지 분석 실행 중 오류가 발생했습니다 (Run #{activeRun.run_number})
            </div>
            <p className="text-[13px] text-[#991B1B]">
              {activeRun.error_message || "이미지 처리 또는 API 요청에 실패했습니다. 설정 확인 후 재시도해주세요."}
            </p>
          </div>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={isBusy || isJobRunning}
            onClick={() => onStartSemRun(selectedSemFile.id, currentImageParams)}
          >
            <Play className="w-4 h-4" />
            <span>분석 다시 시도 (Retry)</span>
          </Button>
        </div>
      )}

      {/* 3. Selected Image Full SemView Analysis Result */}
      {selectedSemFile && (
        <>
          {activeRunMatchesSelectedImage && activeRun ? (
            <SemView
              runId={activeRun.id}
              semResult={activeRun.sem_result}
              xrdResult={activeRun.xrd_result}
              semParams={currentImageParams}
              isBusy={isBusy || isJobRunning}
              onChangeParams={handleUpdateCurrentImageParams}
              onRerun={() => onStartSemRun(selectedSemFile.id, currentImageParams)}
              onNavigateToIntegrated={onNavigateToIntegrated}
            />
          ) : (
            <Card className="p-8 text-center space-y-4">
              <CheckCircle2 className="w-10 h-10 text-[#15803D] mx-auto" />
              <div className="space-y-1">
                <h3 className="text-[17px] font-bold text-[#191F28]">
                  선택된 이미지({selectedSemFile.original_filename})의 정량 SEM 분석을 실행할 준비가 되었습니다
                </h3>
                <p className="text-[13px] text-[#6B7684]">
                  위 설정 패널에서 스케일바 실제 길이를 확인한 뒤 아래 버튼을 누르면 이 이미지에 대한 독립적인 미세조직 정량 분석을 수행합니다.
                </p>
              </div>
              <div>
                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  disabled={isBusy || isJobRunning}
                  onClick={() => onStartSemRun(selectedSemFile.id, currentImageParams)}
                >
                  <Play className="w-4 h-4" />
                  <span>{selectedSemFile.original_filename} SEM 정량 분석 시작</span>
                </Button>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
