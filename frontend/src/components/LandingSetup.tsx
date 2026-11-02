import React, { useEffect, useState } from "react";
import {
  Upload,
  Sparkles,
  FileSpreadsheet,
  Image as ImageIcon,
  ShieldCheck,
  Trash2,
  Play,
  FolderOpen,
  FileCode2,
  AlertCircle,
  Activity,
} from "lucide-react";
import { api } from "../api";
import type {
  DesktopFileInfo,
  HealthInfo,
  ProjectDetail,
  ProjectListItem,
  SEMParams,
  XRDParams,
} from "../types";
import { SemInteractiveCanvas } from "./SemInteractiveCanvas";
import { PeriodicTablePicker } from "./PeriodicTablePicker";
import {
  Button,
  Card,
  SourceTag,
  StatusBadge,
  SwitchControl,
  TermTooltip,
} from "./ui/primitives";

interface LandingSetupProps {
  health: HealthInfo | null;
  projects: ProjectListItem[];
  activeProject: ProjectDetail | null;
  xrdParams: XRDParams;
  semParams: SEMParams;
  runAi: boolean;
  isBusy: boolean;
  errorMsg: string | null;
  onClearError: () => void;
  onSelectProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onCreateProject: (data: {
    sample_name: string;
    description: string;
    expected_elements: string[];
    expected_formula: string;
    is_same_sample: boolean;
  }) => void;
  onQuickImportFiles: (files: FileList) => void;
  onLoadSample: (preset: "tio2_powder" | "sintered_grains" | "desktop_nbfesb") => void;
  onUpdateProjectMeta: (patch: Record<string, any>) => void;
  onUploadFile: (role: "xrd" | "sem" | "cif", file: File) => void;
  onUploadFromDesktop: (role: "xrd" | "sem" | "cif", filename: string) => void;
  onChangeXrdParams: (next: XRDParams) => void;
  onChangeSemParams: (next: SEMParams) => void;
  onChangeRunAi: (val: boolean) => void;
  onStartRun: () => void;
  onNavigateToUtm?: () => void;
}

export function LandingSetup({
  health,
  projects,
  activeProject,
  xrdParams,
  semParams,
  runAi,
  isBusy,
  errorMsg,
  onClearError,
  onSelectProject,
  onDeleteProject,
  onCreateProject,
  onQuickImportFiles,
  onLoadSample,
  onUpdateProjectMeta,
  onUploadFile,
  onUploadFromDesktop,
  onChangeXrdParams,
  onChangeSemParams,
  onChangeRunAi,
  onStartRun,
  onNavigateToUtm,
}: LandingSetupProps) {
  const [sampleName, setSampleName] = useState("");
  const [description, setDescription] = useState("");
  const [expectedFormula, setExpectedFormula] = useState("");
  const [selectedElems, setSelectedElems] = useState<string[]>([]);
  const [isSameSample, setIsSameSample] = useState(true);
  const [desktopFiles, setDesktopFiles] = useState<DesktopFileInfo[]>([]);
  const [dragRole, setDragRole] = useState<"xrd" | "sem" | null>(null);
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [descInput, setDescInput] = useState("");

  useEffect(() => {
    if (activeProject) {
      setDescInput(activeProject.description || "");
    }
  }, [activeProject?.id, activeProject?.description]);

  useEffect(() => {
    api
      .listDesktopFiles()
      .then((res) => setDesktopFiles(res.files || []))
      .catch(() => setDesktopFiles([]));
  }, [activeProject?.id]);

  const desktopXrdFiles = desktopFiles.filter((f) => f.role === "xrd");
  const desktopSemFiles = desktopFiles.filter((f) => f.role === "sem");

  const xrdFile = activeProject?.files.find((f) => f.file_role === "xrd") || null;
  const semFile = activeProject?.files.find((f) => f.file_role === "sem") || null;
  const cifFiles = activeProject?.files.filter((f) => f.file_role === "cif") || [];

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sampleName.trim()) return;
    onCreateProject({
      sample_name: sampleName.trim(),
      description: description.trim(),
      expected_elements: selectedElems,
      expected_formula: expectedFormula.trim(),
      is_same_sample: isSameSample,
    });
  };

  return (
    <div className="w-full max-w-[1540px] mx-auto space-y-6 pb-28 sm:pb-12">
      {/* Error Alert Banner */}
      {errorMsg && (
        <div className="rounded-[16px] bg-[#FEE2E2] border border-[#FECACA] p-4 flex items-start justify-between gap-3 text-[#DC2626]">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <div className="text-[14px] font-semibold">입력 또는 실행 조건을 확인해주세요</div>
              <div className="text-[13px] mt-0.5 leading-relaxed">{errorMsg}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClearError}
            className="text-[12px] font-semibold underline shrink-0 min-h-[44px] px-2 cursor-pointer"
          >
            닫기
          </button>
        </div>
      )}

      {/* Hero / Start Card when no project selected */}
      {!activeProject && (
        <>
          <Card className="p-6 sm:p-8">
            <div className="max-w-2xl space-y-3">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#EFF6FF] text-[#3182F6] text-[12px] font-semibold">
                재료 연구용 XRD · SEM 통합 분석 보조
              </div>
              <h1 className="text-[26px] sm:text-[32px] font-bold tracking-tight text-[#191F28] leading-snug">
                XRD와 SEM, 함께 보면 더 명확해집니다.
              </h1>
              <p className="text-[15px] text-[#6B7684] leading-relaxed">
                회절 패턴의 결정상·결정자 크기 추정값과 전자현미경 미세구조 통계를 Python 수치 엔진으로 정량 계산하고,
                측정값·계산값·AI 해석 가설을 엄격히 구분해 한 화면에서 검토합니다.
              </p>
            </div>

            <div className="mt-6 pt-6 border-t border-[#E5E8EB] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold text-[#191F28]">
                    처음 오셨나요? 검증용 샘플 데이터로 전체 과정을 바로 체험해보세요
                  </span>
                  <SourceTag kind="샘플" />
                </div>
                <p className="text-[13px] text-[#6B7684] mt-0.5">
                  출처와 생성 조건이 문서화된 합성 TiO2 나노분말(XRD+SEM) 및 소결 세라믹 결정립(SEM) 데이터입니다.
                </p>
              </div>
              <div className="flex flex-wrap gap-2.5 shrink-0">
                <label className="inline-flex items-center justify-center gap-2 font-semibold transition-colors rounded-[12px] min-h-[44px] px-4 py-2.5 text-[14px] bg-[#3182F6] text-white hover:bg-[#1B64DA] cursor-pointer">
                  <FolderOpen className="w-4 h-4" />
                  <span>파일 불러오기</span>
                  <input
                    type="file"
                    multiple
                    accept=".csv,.txt,.xy,.dat,.asc,.xlsx,.png,.jpg,.jpeg,.tif,.tiff,.bmp,.cif"
                    className="hidden"
                    disabled={isBusy}
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        onQuickImportFiles(e.target.files);
                        e.target.value = "";
                      }
                    }}
                  />
                </label>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isBusy}
                  onClick={() => onLoadSample("tio2_powder")}
                >
                  <Sparkles className="w-4 h-4" />
                  샘플 분석 시작 (TiO2 분말)
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isBusy}
                  onClick={() => onLoadSample("sintered_grains")}
                >
                  소결 결정립 샘플
                </Button>
                {onNavigateToUtm && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isBusy}
                    onClick={onNavigateToUtm}
                    className="border-[#3182F6] text-[#3182F6] hover:bg-[#EFF6FF]"
                  >
                    <Activity className="w-4 h-4" />
                    <span>UTM 데이터 분석</span>
                  </Button>
                )}
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Step 1: Register New Sample */}
            <Card className="lg:col-span-8 space-y-4">
              <div>
                <h2 className="text-[18px] font-bold text-[#191F28]">새 시료 등록하기</h2>
                <p className="text-[13px] text-[#6B7684] mt-0.5">
                  시료 정보를 먼저 등록한 뒤 XRD CSV 또는 SEM 이미지를 업로드합니다.
                </p>
              </div>
              <form onSubmit={handleCreateSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[13px] font-semibold text-[#191F28] mb-1.5">
                      시료명 <span className="text-[#DC2626]">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={sampleName}
                      onChange={(e) => setSampleName(e.target.value)}
                      placeholder="예: Sample-01 또는 TiO2-500C-2h"
                      className="w-full min-h-[44px] px-3.5 rounded-[12px] border border-[#E5E8EB] text-[14px] focus:outline-none focus:border-[#3182F6]"
                    />
                  </div>
                  <div>
                    <label className="block text-[13px] font-semibold text-[#191F28] mb-1.5">
                      예상 조성 또는 화학식 (선택)
                    </label>
                    <input
                      type="text"
                      value={expectedFormula}
                      onChange={(e) => setExpectedFormula(e.target.value)}
                      placeholder="예: TiO2 또는 Al2O3"
                      className="w-full min-h-[44px] px-3.5 rounded-[12px] border border-[#E5E8EB] text-[14px] focus:outline-none focus:border-[#3182F6]"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[13px] font-semibold text-[#191F28] mb-1.5">
                    예상 원소 선택 (선택 · 주기율표에서 원소 클릭)
                  </label>
                  <PeriodicTablePicker
                    selectedElements={selectedElems}
                    onChange={setSelectedElems}
                    defaultExpanded={true}
                    compact={true}
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-semibold text-[#191F28] mb-1.5">
                    시료 설명 및 열처리·합성 이력 (선택)
                  </label>
                  <textarea
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="예: 졸-겔 합성 후 대기 중 500°C에서 2시간 하소한 백색 분말"
                    className="w-full p-3.5 rounded-[12px] border border-[#E5E8EB] text-[14px] focus:outline-none focus:border-[#3182F6]"
                  />
                </div>
                <SwitchControl
                  checked={isSameSample}
                  onCheckedChange={setIsSameSample}
                  label="업로드할 XRD와 SEM 파일이 동일한 시료입니다"
                  description="동일 시료임이 확인되지 않으면 두 결과를 결합한 통합 해석이 자동으로 제한됩니다."
                />
                <Button type="submit" variant="primary" size="lg" className="w-full" disabled={isBusy || !sampleName.trim()}>
                  시료 등록 후 파일 올리기
                </Button>
              </form>
            </Card>

            {/* Saved Projects List */}
            <Card className="lg:col-span-4 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[18px] font-bold text-[#191F28]">저장된 시료 목록</h2>
                <span className="text-[12px] text-[#6B7684]">{projects.length}개</span>
              </div>
              {projects.length === 0 ? (
                <div className="py-12 text-center text-[14px] text-[#6B7684] bg-[#F7F8FA] rounded-[14px]">
                  아직 등록된 시료가 없습니다.
                  <br />
                  왼쪽에서 시료를 등록하거나 샘플 분석을 눌러보세요.
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                  {projects.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between gap-2 p-3.5 rounded-[14px] border border-[#E5E8EB] hover:border-[#3182F6] transition-colors bg-[#F7F8FA]/50"
                    >
                      <button
                        type="button"
                        onClick={() => onSelectProject(p.id)}
                        className="flex-1 text-left min-h-[44px] cursor-pointer"
                      >
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[14px] font-semibold text-[#191F28]">{p.sample_name}</span>
                          {p.is_sample_demo && <SourceTag kind="샘플" />}
                        </div>
                        <div className="text-[12px] text-[#6B7684] mt-0.5">
                          파일: {p.file_roles.length ? p.file_roles.join(", ").toUpperCase() : "없음"} · 실행 {p.run_count}회
                        </div>
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`${p.sample_name} 삭제`}
                        onClick={() => onDeleteProject(p.id)}
                      >
                        <Trash2 className="w-4 h-4 text-[#DC2626]" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      {/* Active Project Setup & File Upload View */}
      {activeProject && (
        <>
          {/* Sample Info Summary & Same-Sample Switch */}
          <Card className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex-1 min-w-[280px]">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-[20px] font-bold text-[#191F28]">{activeProject.sample_name}</h2>
                  {activeProject.is_sample_demo && <SourceTag kind="샘플" />}
                  <SourceTag kind="사용자 입력" />
                  <button
                    type="button"
                    onClick={() => {
                      setDescInput(activeProject.description || "");
                      setIsEditingDesc((v) => !v);
                    }}
                    className="text-[12px] font-medium text-[#3182F6] hover:underline px-2 py-0.5 rounded-[6px] hover:bg-[#EFF6FF] transition-colors ml-1 cursor-pointer"
                  >
                    {isEditingDesc ? "닫기" : "시료 설명·공정 방법 편집"}
                  </button>
                </div>

                {!isEditingDesc ? (
                  <p className="text-[13px] text-[#6B7684] mt-1.5 leading-relaxed bg-[#F7F8FA] p-3 rounded-[10px] border border-[#E5E8EB]">
                    {activeProject.description ? (
                      activeProject.description
                    ) : (
                      <span className="text-[#8B95A1] italic">
                        시료 설명 및 공정 방법이 아직 입력되지 않았습니다. 우측 상단의 ‘시료 설명·공정 방법 편집’ 버튼을 눌러 합성/열처리 이력을 적어주시면 AI가 공정-조직-결정상 간의 상관관계를 심층 분석합니다.
                      </span>
                    )}
                  </p>
                ) : (
                  <div className="mt-2 space-y-2 p-3.5 rounded-[12px] bg-[#EFF6FF]/40 border border-[#BFDBFE]">
                    <div className="flex items-center justify-between">
                      <label className="text-[12px] font-bold text-[#1D4ED8]">
                        시료 설명 및 합성·공정·열처리 방법 입력
                      </label>
                      <span className="text-[11px] text-[#6B7684]">
                        작성 내용은 AI 해석 가설 및 결정상 분석에 실시간 반영됩니다
                      </span>
                    </div>
                    <textarea
                      rows={3}
                      value={descInput}
                      onChange={(e) => setDescInput(e.target.value)}
                      placeholder="예: Nb-Fe-Sb 원료 분말을 아크 멜팅(Arc melting)으로 합성 후, 800°C에서 7일간 열처리(진공 석영관 어닐링)하여 소결한 시료. 1100°C 소결 시 NbFeSb 하프호이슬러 주상 형성 기대."
                      className="w-full p-2.5 rounded-[10px] border border-[#BFDBFE] bg-white text-[13px] focus:outline-none focus:border-[#3182F6]"
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setIsEditingDesc(false)}
                      >
                        취소
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          onUpdateProjectMeta({
                            description: descInput.trim(),
                            change_summary: `시료 설명 및 공정 이력 수정: ${descInput.trim().slice(0, 30)}...`,
                          });
                          setIsEditingDesc(false);
                        }}
                      >
                        설명 저장 및 AI 반영
                      </Button>
                    </div>
                  </div>
                )}
              </div>
              <div className="text-[12px] text-[#6B7684] bg-[#F7F8FA] px-3 py-2 rounded-[12px]">
                예상 원소:{" "}
                <strong className="text-[#191F28]">
                  {activeProject.expected_elements.length
                    ? activeProject.expected_elements.join(", ")
                    : "전체 (필터 없음)"}
                </strong>
              </div>
            </div>

            <div className="space-y-3 pt-2 border-t border-[#E5E8EB]">
              <PeriodicTablePicker
                selectedElements={activeProject.expected_elements}
                onChange={(nextElems) =>
                  onUpdateProjectMeta({
                    expected_elements: nextElems,
                    change_summary: `예상 원소 변경: ${nextElems.join(", ") || "없음"}`,
                  })
                }
                defaultExpanded={false}
              />
              <div className="flex items-center pt-1">
                <SwitchControl
                  checked={activeProject.is_same_sample}
                  onCheckedChange={(val) =>
                    onUpdateProjectMeta({
                      is_same_sample: val,
                      change_summary: `동일 시료 확인 변경: ${val ? "예" : "아니오"}`,
                    })
                  }
                  label="XRD·SEM 동일 시료 확인"
                  description="체크 해제 시 개별 분석 결과만 표시하고 통합 해석을 제한합니다."
                />
              </div>
            </div>
          </Card>

          {/* Upload Cards: "분석할 파일을 올려주세요" */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* XRD Upload Card */}
            <Card className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-[12px] bg-[#EFF6FF] text-[#3182F6] flex items-center justify-center">
                    <FileSpreadsheet className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-[16px] font-bold text-[#191F28]">XRD 회절 데이터</h3>
                    <p className="text-[12px] text-[#6B7684]">
                      CSV, XLSX(엑셀), TXT, XY (최대 {health?.max_upload_mb ?? 25} MB)
                    </p>
                  </div>
                </div>
                {xrdFile ? <StatusBadge status="분석 완료" /> : <span className="text-[12px] text-[#6B7684]">선택 업로드</span>}
              </div>

              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragRole("xrd");
                }}
                onDragLeave={() => setDragRole(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragRole(null);
                  const f = e.dataTransfer.files?.[0];
                  if (f) onUploadFile("xrd", f);
                }}
                className={`flex flex-col items-center justify-center border-2 border-dashed rounded-[16px] p-5 cursor-pointer transition-colors min-h-[110px] ${
                  dragRole === "xrd"
                    ? "border-[#3182F6] bg-[#EFF6FF]"
                    : "border-[#E5E8EB] hover:border-[#3182F6] bg-[#F7F8FA]/60"
                }`}
              >
                <Upload className="w-5 h-5 text-[#3182F6] mb-1.5" />
                <span className="text-[14px] font-semibold text-[#191F28]">
                  {xrdFile ? xrdFile.original_filename : "분석할 파일을 올려주세요 (XRD CSV / XLSX)"}
                </span>
                <span className="text-[12px] text-[#6B7684] mt-0.5">
                  클릭하여 파일 선택 또는 바탕화면에서 끌어다 놓기 · 원본 데이터 보존
                </span>
                <input
                  type="file"
                  accept=".csv,.txt,.xy,.dat,.xlsx,.xls,.asc"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onUploadFile("xrd", f);
                    e.currentTarget.value = "";
                  }}
                />
              </label>

              {desktopXrdFiles.length > 0 && (
                <div className="bg-[#F7F8FA] rounded-[12px] p-3 space-y-2 border border-[#E5E8EB]">
                  <div className="text-[12px] font-semibold text-[#191F28] flex items-center gap-1.5">
                    <FolderOpen className="w-3.5 h-3.5 text-[#3182F6]" />
                    바탕화면에서 감지된 XRD 파일 바로 선택
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {desktopXrdFiles.map((df) => (
                      <button
                        key={df.filename}
                        type="button"
                        disabled={isBusy}
                        onClick={() => onUploadFromDesktop("xrd", df.filename)}
                        className="px-2.5 py-1.5 rounded-[10px] text-[12px] font-medium bg-white border border-[#E5E8EB] hover:border-[#3182F6] text-[#191F28] cursor-pointer transition-colors"
                      >
                        📄 {df.filename}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Optional Custom CIF upload */}
              <div className="flex items-center justify-between pt-2 border-t border-[#E5E8EB]">
                <div className="text-[12px] text-[#6B7684]">
                  사용자 기준 CIF 추가 ({cifFiles.length}개 등록됨)
                </div>
                <label className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#3182F6] hover:underline cursor-pointer min-h-[44px] px-2">
                  <FileCode2 className="w-4 h-4" />
                  CIF 업로드
                  <input
                    type="file"
                    accept=".cif"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onUploadFile("cif", f);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>

              {/* XRD Inspection & Condition Confirmation */}
              {xrdFile && xrdFile.inspection && (
                <div className="space-y-3 pt-3 border-t border-[#E5E8EB]">
                  <div className="text-[13px] font-semibold text-[#191F28]">XRD 열 매핑 및 측정 조건 확인</div>
                  <div className="text-[12px] text-[#6B7684] bg-[#F7F8FA] p-3 rounded-[12px] space-y-1">
                    <div>
                      구분자: <strong>{xrdFile.inspection.delimiter}</strong> · 데이터 점:{" "}
                      <strong className="tabular-nums">{xrdFile.inspection.n_points}개</strong> (
                      {xrdFile.inspection.two_theta_min}°–{xrdFile.inspection.two_theta_max}°)
                    </div>
                    <div>간격 처리: {xrdFile.inspection.non_uniform_handling}</div>
                    {xrdFile.inspection.warnings?.map((w: string, idx: number) => (
                      <div key={idx} className="text-[#D97706] font-medium">
                        • {w}
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[12px] font-medium text-[#6B7684] mb-1">2θ 각도 열</label>
                      <select
                        value={Number(xrdParams.col_two_theta ?? xrdFile.inspection.selected_col_two_theta)}
                        onChange={(e) =>
                          onChangeXrdParams({ ...xrdParams, col_two_theta: Number(e.target.value) })
                        }
                        className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] text-[13px] bg-white"
                      >
                        {xrdFile.inspection.columns?.map((col: any) => (
                          <option key={col.index} value={col.index}>
                            {col.name} (예: {col.preview.join(", ")})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[12px] font-medium text-[#6B7684] mb-1">강도(Intensity) 열</label>
                      <select
                        value={Number(xrdParams.col_intensity ?? xrdFile.inspection.selected_col_intensity)}
                        onChange={(e) =>
                          onChangeXrdParams({ ...xrdParams, col_intensity: Number(e.target.value) })
                        }
                        className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] text-[13px] bg-white"
                      >
                        {xrdFile.inspection.columns?.map((col: any) => (
                          <option key={col.index} value={col.index}>
                            {col.name} (예: {col.preview.join(", ")})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[12px] font-medium text-[#6B7684] mb-1">X선 소스 프리셋</label>
                      <select
                        value={xrdParams.xray_source}
                        onChange={(e) => {
                          const src = e.target.value;
                          const wl = health?.xray_presets?.[src] ?? xrdParams.wavelength_angstrom;
                          onChangeXrdParams({ ...xrdParams, xray_source: src, wavelength_angstrom: wl });
                        }}
                        className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] text-[13px] bg-white"
                      >
                        {Object.entries(health?.xray_presets || { "Cu Kα (1.5406 Å)": 1.5406 }).map(
                          ([label, wl]) => (
                            <option key={label} value={label}>
                              {label} ({wl} Å)
                            </option>
                          )
                        )}
                        <option value="사용자 직접 입력">사용자 직접 입력</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[12px] font-medium text-[#6B7684] mb-1">
                        파장 λ (Å)
                        <TermTooltip
                          term="X선 파장 λ"
                          description="브래그 법칙(2d sinθ = λ)과 Scherrer 식에 사용되는 입사 X선 파장입니다. Cu Kα 기본값은 1.5406 Å입니다."
                        />
                      </label>
                      <input
                        type="number"
                        step="0.0001"
                        value={xrdParams.wavelength_angstrom}
                        onChange={(e) =>
                          onChangeXrdParams({
                            ...xrdParams,
                            xray_source: "사용자 직접 입력",
                            wavelength_angstrom: parseFloat(e.target.value) || 1.5406,
                          })
                        }
                        className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] text-[13px] tabular-nums"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[12px] font-medium text-[#6B7684] mb-1">
                        기기 선폭 보정 FWHM (° · 선택)
                        <TermTooltip
                          term="기기 선폭 보정 (Instrumental Broadening)"
                          description="LaB6, Si 등 표준시료로 측정한 장비 고유 선폭입니다. 비워두면 '기기 선폭 미보정 추정값'으로 투명하게 표시됩니다."
                        />
                      </label>
                      <input
                        type="number"
                        step="0.005"
                        placeholder="미입력 시 미보정 표기 (예: 0.08)"
                        value={xrdParams.inst_fwhm_deg ?? ""}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          onChangeXrdParams({
                            ...xrdParams,
                            inst_fwhm_deg: raw === "" ? null : Math.max(0, parseFloat(raw)),
                          });
                        }}
                        className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] text-[13px] tabular-nums"
                      />
                    </div>
                    <div className="flex items-end">
                      <SwitchControl
                        checked={xrdParams.wavelength_confirmed}
                        onCheckedChange={(val) =>
                          onChangeXrdParams({ ...xrdParams, wavelength_confirmed: val })
                        }
                        label="파장·각도 범위 확인됨"
                      />
                    </div>
                  </div>
                </div>
              )}
            </Card>

            {/* SEM Upload Card */}
            <Card className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-[12px] bg-[#EFF6FF] text-[#3182F6] flex items-center justify-center">
                    <ImageIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-[16px] font-bold text-[#191F28]">SEM 미세구조 이미지</h3>
                    <p className="text-[12px] text-[#6B7684]">TIF, TIFF, JPG, JPEG, PNG, BMP (원본 해상도 유지)</p>
                  </div>
                </div>
                {semFile ? (
                  <StatusBadge status={semParams.scale_confirmed ? "분석 완료" : "확인 필요"} />
                ) : (
                  <span className="text-[12px] text-[#6B7684]">선택 업로드</span>
                )}
              </div>

              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragRole("sem");
                }}
                onDragLeave={() => setDragRole(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragRole(null);
                  const f = e.dataTransfer.files?.[0];
                  if (f) onUploadFile("sem", f);
                }}
                className={`flex flex-col items-center justify-center border-2 border-dashed rounded-[16px] p-5 cursor-pointer transition-colors min-h-[110px] ${
                  dragRole === "sem"
                    ? "border-[#3182F6] bg-[#EFF6FF]"
                    : "border-[#E5E8EB] hover:border-[#3182F6] bg-[#F7F8FA]/60"
                }`}
              >
                <Upload className="w-5 h-5 text-[#3182F6] mb-1.5" />
                <span className="text-[14px] font-semibold text-[#191F28]">
                  {semFile ? semFile.original_filename : "분석할 파일을 올려주세요 (SEM TIF / PNG / JPG)"}
                </span>
                <span className="text-[12px] text-[#6B7684] mt-0.5">
                  클릭하여 파일 선택 또는 바탕화면에서 끌어다 놓기 · 정보 바 및 스케일바 자동 탐지
                </span>
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.tif,.tiff,.bmp,.webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onUploadFile("sem", f);
                    e.currentTarget.value = "";
                  }}
                />
              </label>

              {desktopSemFiles.length > 0 && (
                <div className="bg-[#F7F8FA] rounded-[12px] p-3 space-y-2 border border-[#E5E8EB]">
                  <div className="text-[12px] font-semibold text-[#191F28] flex items-center gap-1.5">
                    <FolderOpen className="w-3.5 h-3.5 text-[#3182F6]" />
                    바탕화면에서 감지된 SEM 이미지 바로 선택
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {desktopSemFiles.map((df) => (
                      <button
                        key={df.filename}
                        type="button"
                        disabled={isBusy}
                        onClick={() => onUploadFromDesktop("sem", df.filename)}
                        className="px-2.5 py-1.5 rounded-[10px] text-[12px] font-medium bg-white border border-[#E5E8EB] hover:border-[#3182F6] text-[#191F28] cursor-pointer transition-colors"
                      >
                        🖼️ {df.filename}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {semFile && semFile.inspection && (
                <div className="space-y-3 pt-3 border-t border-[#E5E8EB]">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-semibold text-[#191F28]">
                      스케일바 길이를 확인해주세요
                    </span>
                    <span className="text-[12px] text-[#6B7684] tabular-nums">
                      {semFile.inspection.width_px} × {semFile.inspection.height_px} px
                    </span>
                  </div>

                  <div className="text-[12px] text-[#6B7684] bg-[#F7F8FA] p-3 rounded-[12px] space-y-1">
                    {semFile.inspection.notes?.map((n: string, i: number) => (
                      <div key={i}>• {n}</div>
                    ))}
                  </div>

                  {/* Mode selector: Particle vs Grain */}
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={semParams.mode === "particle" ? "primary" : "outline"}
                      onClick={() => onChangeSemParams({ ...semParams, mode: "particle" })}
                    >
                      A. 입자 분석 (분말·나노입자)
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={semParams.mode === "grain" ? "primary" : "outline"}
                      onClick={() => onChangeSemParams({ ...semParams, mode: "grain" })}
                    >
                      B. 결정립 분석 (경계 교차법)
                    </Button>
                  </div>

                  {semParams.mode === "grain" && (
                    <div className="p-3 rounded-[12px] bg-[#FEF3C7]/60 border border-[#FDE68A]">
                      <SwitchControl
                        checked={semParams.grain_boundary_confirmed}
                        onCheckedChange={(val) =>
                          onChangeSemParams({ ...semParams, grain_boundary_confirmed: val })
                        }
                        label="이미지에 식각/열처리된 결정립계(grain boundary)가 관찰됨을 확인합니다"
                        description="입자 분할 결과를 자동으로 결정립으로 간주하지 않습니다."
                      />
                    </div>
                  )}

                  {/* Scale bar numeric input */}
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[12px] font-medium text-[#6B7684] mb-1">스케일바(px)</label>
                      <input
                        type="number"
                        step="0.5"
                        value={semParams.scale_length_px ?? ""}
                        placeholder="픽셀 길이"
                        onChange={(e) =>
                          onChangeSemParams({
                            ...semParams,
                            scale_length_px: e.target.value ? parseFloat(e.target.value) : null,
                          })
                        }
                        className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] text-[13px] tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-[12px] font-medium text-[#6B7684] mb-1">실제 길이</label>
                      <input
                        type="number"
                        step="any"
                        value={semParams.scale_real_value ?? ""}
                        placeholder="예: 500 또는 1"
                        onChange={(e) =>
                          onChangeSemParams({
                            ...semParams,
                            scale_real_value: e.target.value ? parseFloat(e.target.value) : null,
                          })
                        }
                        className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] text-[13px] tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-[12px] font-medium text-[#6B7684] mb-1">단위</label>
                      <select
                        value={semParams.scale_unit}
                        onChange={(e) =>
                          onChangeSemParams({
                            ...semParams,
                            scale_unit: e.target.value as "nm" | "µm" | "mm",
                          })
                        }
                        className="w-full min-h-[44px] px-3 rounded-[12px] border border-[#E5E8EB] text-[13px] bg-white"
                      >
                        <option value="nm">nm</option>
                        <option value="µm">µm</option>
                        <option value="mm">mm</option>
                      </select>
                    </div>
                  </div>

                  <SwitchControl
                    checked={semParams.scale_confirmed}
                    onCheckedChange={(val) =>
                      onChangeSemParams({ ...semParams, scale_confirmed: val })
                    }
                    label="스케일바 실제 길이와 단위를 확인했습니다"
                    description="체크하지 않으면 임의 단위를 가정하지 않고 모든 길이를 px 단위로만 표시합니다."
                  />
                </div>
              )}
            </Card>
          </div>

          {/* Interactive SEM Scalebar & ROI Visual Confirmation */}
          {semFile && (
            <Card className="space-y-3">
              <div>
                <h3 className="text-[16px] font-bold text-[#191F28]">
                  SEM 분석 영역(ROI) 및 스케일바 위치 직접 지정
                </h3>
                <p className="text-[13px] text-[#6B7684]">
                  초록색 선은 현재 지정된 스케일바 양 끝점, 파란색 사각형은 정보 바가 제외된 분석 영역(ROI)입니다.
                </p>
              </div>
              <SemInteractiveCanvas
                imageUrl={api.rawFileUrl(activeProject.id, semFile.id)}
                mode="setup"
                semParams={semParams}
                onChangeParams={onChangeSemParams}
                detectedDatabarY={semFile.inspection?.detected_databar_y}
              />
            </Card>
          )}

          {/* External AI Data Scope Disclosure & Run Bar */}
          <Card className="space-y-4 border-[#BFDBFE] bg-[#F8FAFC]">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-[#3182F6] shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1">
                <div className="text-[14px] font-bold text-[#191F28]">
                  외부 AI(Google Gemini) 전송 데이터 범위 안내
                </div>
                <p className="text-[13px] text-[#6B7684] leading-relaxed">
                  AI 해석을 켜고 실행하면 <strong>검증된 수치 요약(피크·상 후보·크기 통계)</strong>,{" "}
                  <strong>시료 설명</strong>, 그리고 <strong>정보 바가 제거된 SEM ROI 및 분할 오버레이 이미지</strong>만
                  Google Gemini API({health?.gemini_model || "환경변수 모델"})로 전송됩니다.
                  {!health?.gemini_api_configured && (
                    <span className="text-[#D97706] font-medium">
                      {" "}
                      (현재 서버에 GEMINI_API_KEY가 설정되어 있지 않아 수치 계산 및 규칙 기반 리포트만 동작합니다.)
                    </span>
                  )}
                </p>
              </div>
            </div>

            <div className="pt-2 border-t border-[#E5E8EB]">
              <SwitchControl
                checked={runAi}
                onCheckedChange={onChangeRunAi}
                label="Gemini AI 통합 해석 함께 실행하기"
                description="끄더라도 Python 수치 분석, 차트, 규칙 기반 요약, PDF/CSV 다운로드는 모두 정상 동작합니다."
              />
            </div>
          </Card>

          {/* Responsive Sticky Bottom Action Bar on Mobile / Clean Inline Action on Desktop */}
          <div className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-[#E5E8EB] p-3 sm:static sm:bg-transparent sm:border-0 sm:p-0">
            <div className="w-full max-w-[1540px] mx-auto flex items-center justify-between gap-3">
              <div className="hidden sm:flex items-center gap-2 text-[13px] text-[#6B7684]">
                <FolderOpen className="w-4 h-4" />
                <span>
                  준비된 파일: {[xrdFile && "XRD", semFile && "SEM"].filter(Boolean).join(" + ") || "없음"}
                </span>
              </div>
              <Button
                type="button"
                variant="primary"
                size="lg"
                className="w-full sm:w-auto sm:min-w-[240px]"
                disabled={isBusy || (!xrdFile && !semFile)}
                onClick={onStartRun}
              >
                <Play className="w-4 h-4" />
                {isBusy ? "분석 실행 중..." : "분석 실행"}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
