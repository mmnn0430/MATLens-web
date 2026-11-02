import { useCallback, useEffect, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import {
  Layers,
  SlidersHorizontal,
  ArrowLeft,
  Loader2,
  FileBarChart2,
  Microscope,
  Activity,
  KeyRound,
} from "lucide-react";
import { api, DEFAULT_SEM_PARAMS, DEFAULT_XRD_PARAMS } from "./api";
import type {
  HealthInfo,
  ProjectDetail,
  ProjectListItem,
  RunDetail,
  SEMParams,
  XRDParams,
} from "./types";
import { LandingSetup } from "./components/LandingSetup";
import { XrdView } from "./components/XrdView";
import { SemView } from "./components/SemView";
import { IntegratedReportView } from "./components/IntegratedReportView";
import { UtmView } from "./components/UtmView";
import { Button, SourceTag } from "./components/ui/primitives";

function readUrlState() {
  const sp = new URLSearchParams(window.location.search);
  return {
    mode: (sp.get("mode") as "matlens" | "utm") || "matlens",
    projectId: sp.get("project"),
    runId: sp.get("run"),
    view: (sp.get("view") as "setup" | "results") || null,
    tab: (sp.get("tab") as "xrd" | "sem" | "report") || "report",
  };
}

function writeUrlState(next: {
  mode?: "matlens" | "utm";
  projectId?: string | null;
  runId?: string | null;
  view?: "setup" | "results";
  tab?: "xrd" | "sem" | "report";
}) {
  const sp = new URLSearchParams();
  if (next.mode && next.mode !== "matlens") sp.set("mode", next.mode);
  if (next.projectId) sp.set("project", next.projectId);
  if (next.runId) sp.set("run", next.runId);
  if (next.view) sp.set("view", next.view);
  if (next.tab) sp.set("tab", next.tab);
  const qs = sp.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}

export default function App() {
  const [serviceMode, setServiceMode] = useState<"matlens" | "utm">("matlens");
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectDetail | null>(null);
  const [activeRun, setActiveRun] = useState<RunDetail | null>(null);

  const [xrdParams, setXrdParams] = useState<XRDParams>(DEFAULT_XRD_PARAMS);
  const [semParams, setSemParams] = useState<SEMParams>(DEFAULT_SEM_PARAMS);
  const [runAi, setRunAi] = useState<boolean>(true);

  const [viewMode, setViewMode] = useState<"setup" | "results">("setup");
  const [activeTab, setActiveTab] = useState<"xrd" | "sem" | "report">("report");
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [isRetryingAi, setIsRetryingAi] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showGlobalApiPanel, setShowGlobalApiPanel] = useState<boolean>(false);
  const [globalGeminiKey, setGlobalGeminiKey] = useState<string>("");
  const [globalGeminiModel, setGlobalGeminiModel] = useState<string>("auto");
  const [globalMpKey, setGlobalMpKey] = useState<string>("");
  const [savingGlobalApi, setSavingGlobalApi] = useState<boolean>(false);

  const hydrateParamsFromProject = useCallback((proj: ProjectDetail) => {
    const cond = proj.current_conditions || {};
    setXrdParams({
      ...DEFAULT_XRD_PARAMS,
      ...(cond.xrd_params || {}),
      crystallinity: {
        ...DEFAULT_XRD_PARAMS.crystallinity,
        ...(cond.xrd_params?.crystallinity || {}),
      },
    });
    setSemParams({
      ...DEFAULT_SEM_PARAMS,
      ...(cond.sem_params || {}),
    });
  }, []);

  const refreshProjectsList = useCallback(async () => {
    try {
      const list = await api.listProjects();
      setProjects(list);
    } catch {
      // ignore initial list error
    }
  }, []);

  const openProject = useCallback(
    async (
      projectId: string,
      preferredRunId?: string | null,
      preferredView?: "setup" | "results",
      isInitialUrlLoad?: boolean
    ) => {
      setIsBusy(true);
      setErrorMsg(null);
      try {
        const proj = await api.getProject(projectId);
        setActiveProject(proj);
        hydrateParamsFromProject(proj);

        const targetRunId = preferredRunId || proj.latest_run_id;
        if (targetRunId) {
          const r = await api.getRun(targetRunId);
          setActiveRun(r);
          const nextView = preferredView || (r.status === "completed" || r.status === "running" ? "results" : "setup");
          setViewMode(nextView);
          const defaultTab =
            r.xrd_result && r.sem_result
              ? "report"
              : r.xrd_result
              ? "xrd"
              : r.sem_result
              ? "sem"
              : "report";
          setActiveTab(defaultTab);
          writeUrlState({ projectId: proj.id, runId: r.id, view: nextView, tab: defaultTab });
        } else {
          setActiveRun(null);
          setViewMode("setup");
          writeUrlState({ projectId: proj.id, view: "setup" });
        }
      } catch (err: any) {
        if (isInitialUrlLoad) {
          // URL 링크로 들어왔으나 프로젝트가 존재하지 않거나 만료된 경우
          // 경고 에러 배너를 띄우지 않고 깔끔하게 URL을 정리하고 기본 홈으로 진입
          writeUrlState({});
          setActiveProject(null);
          setActiveRun(null);
          setErrorMsg(null);
        } else {
          setErrorMsg(err?.message || "프로젝트를 불러오지 못했습니다.");
        }
      } finally {
        setIsBusy(false);
      }
    },
    [hydrateParamsFromProject]
  );

  // Initial load + restore URL state on browser refresh
  useEffect(() => {
    const urlState = readUrlState();
    api
      .getHealth()
      .then((h) => {
        setHealth(h);
        if (h.gemini_model) setGlobalGeminiModel(h.gemini_model);
        if (!h.gemini_api_configured) {
          setRunAi(false);
        }
      })
      .catch(() => {});
    refreshProjectsList();

    if (urlState.mode === "utm") {
      setServiceMode("utm");
    } else if (urlState.projectId) {
      if (urlState.tab) setActiveTab(urlState.tab);
      openProject(urlState.projectId, urlState.runId, urlState.view || undefined, true);
    }
  }, [openProject, refreshProjectsList]);

  // Poll running job until completed or failed
  useEffect(() => {
    if (!activeRun || (activeRun.status !== "queued" && activeRun.status !== "running")) {
      return;
    }
    const timer = window.setInterval(async () => {
      try {
        const updated = await api.getRun(activeRun.id);
        setActiveRun(updated);
        if (updated.status === "completed" || updated.status === "failed") {
          window.clearInterval(timer);
          setIsBusy(false);
          if (activeProject) {
            const p = await api.getProject(activeProject.id);
            setActiveProject(p);
            refreshProjectsList();
          }
          if (updated.status === "completed") {
            setViewMode("results");
            const nextTab =
              updated.xrd_result && updated.sem_result
                ? "report"
                : updated.xrd_result
                ? "xrd"
                : "sem";
            setActiveTab((prev) => prev || nextTab);
            writeUrlState({
              projectId: updated.project_id,
              runId: updated.id,
              view: "results",
              tab: nextTab,
            });
          } else if (updated.error_message) {
            setErrorMsg(updated.error_message);
          }
        }
      } catch {
        // retry on next tick
      }
    }, 900);
    return () => window.clearInterval(timer);
  }, [activeRun, activeProject, refreshProjectsList]);

  const handleCreateProject = async (payload: {
    sample_name: string;
    description: string;
    expected_elements: string[];
    expected_formula: string;
    is_same_sample: boolean;
  }) => {
    setIsBusy(true);
    setErrorMsg(null);
    try {
      const proj = await api.createProject(payload);
      setActiveProject(proj);
      setActiveRun(null);
      hydrateParamsFromProject(proj);
      setViewMode("setup");
      writeUrlState({ projectId: proj.id, view: "setup" });
      refreshProjectsList();
    } catch (err: any) {
      setErrorMsg(err?.message || "시료 등록에 실패했습니다.");
    } finally {
      setIsBusy(false);
    }
  };

  const handleQuickImportFiles = async (files: FileList) => {
    if (!files || files.length === 0) return;
    setIsBusy(true);
    setErrorMsg(null);
    try {
      const fileArr = Array.from(files);
      const firstStem = fileArr[0].name.replace(/\.[^/.]+$/, "");
      let proj = await api.createProject({
        sample_name: firstStem || "불러온 시료",
        description: `업로드 파일: ${fileArr.map((f) => f.name).join(", ")}`,
        expected_elements: [],
        expected_formula: "",
        is_same_sample: true,
      });

      for (const f of fileArr) {
        const ext = f.name.split(".").pop()?.toLowerCase() || "";
        let role: "xrd" | "sem" | "cif" | null = null;
        if (["csv", "txt", "xy", "dat", "asc", "xlsx"].includes(ext)) {
          role = "xrd";
        } else if (["png", "jpg", "jpeg", "tif", "tiff", "bmp"].includes(ext)) {
          role = "sem";
        } else if (ext === "cif") {
          role = "cif";
        }
        if (role) {
          proj = await api.uploadFile(proj.id, role, f);
        }
      }

      setActiveProject(proj);
      setActiveRun(null);
      hydrateParamsFromProject(proj);
      setViewMode("setup");
      writeUrlState({ projectId: proj.id, view: "setup" });
      refreshProjectsList();
    } catch (err: any) {
      setErrorMsg(err?.message || "파일 불러오기에 실패했습니다.");
    } finally {
      setIsBusy(false);
    }
  };

  const handleLoadSample = async (preset: "tio2_powder" | "sintered_grains" | "desktop_nbfesb") => {
    setIsBusy(true);
    setErrorMsg(null);
    try {
      const proj = await api.createSampleDemo(preset);
      setActiveProject(proj);
      const nextXrd: XRDParams = {
        ...DEFAULT_XRD_PARAMS,
        ...(proj.current_conditions?.xrd_params || {}),
        crystallinity: {
          ...DEFAULT_XRD_PARAMS.crystallinity,
          ...(proj.current_conditions?.xrd_params?.crystallinity || {}),
        },
      };
      const nextSem: SEMParams = {
        ...DEFAULT_SEM_PARAMS,
        ...(proj.current_conditions?.sem_params || {}),
      };
      setXrdParams(nextXrd);
      setSemParams(nextSem);
      refreshProjectsList();

      if (preset === "desktop_nbfesb") {
        // Open in setup view first so user can inspect the uploaded Desktop files & conditions before or while running
        setViewMode("setup");
        writeUrlState({ projectId: proj.id, view: "setup" });
        setIsBusy(false);
        return;
      }

      // Immediately start initial sample analysis so user experiences the full pipeline in one click
      const started = await api.startRun(proj.id, {
        xrd_params: nextXrd,
        sem_params: nextSem,
        run_ai_interpretation: Boolean(health?.gemini_api_configured && runAi),
      });
      const r = await api.getRun(started.run_id);
      setActiveRun(r);
      setViewMode("results");
      writeUrlState({ projectId: proj.id, runId: r.id, view: "results", tab: "report" });
    } catch (err: any) {
      setErrorMsg(err?.message || "샘플 프로젝트 생성에 실패했습니다.");
      setIsBusy(false);
    }
  };

  const handleUploadFile = async (role: "xrd" | "sem" | "cif", file: File) => {
    if (!activeProject) return;
    setIsBusy(true);
    setErrorMsg(null);
    try {
      const proj = await api.uploadFile(activeProject.id, role, file);
      setActiveProject(proj);
      hydrateParamsFromProject(proj);
      refreshProjectsList();
    } catch (err: any) {
      setErrorMsg(err?.message || "파일 업로드 중 오류가 발생했습니다.");
    } finally {
      setIsBusy(false);
    }
  };

  const handleUploadFromDesktop = async (role: "xrd" | "sem" | "cif", filename: string) => {
    if (!activeProject) return;
    setIsBusy(true);
    setErrorMsg(null);
    try {
      const proj = await api.uploadFromDesktop(activeProject.id, role, filename);
      setActiveProject(proj);
      hydrateParamsFromProject(proj);
      refreshProjectsList();
    } catch (err: any) {
      setErrorMsg(err?.message || "바탕화면 파일 업로드 중 오류가 발생했습니다.");
    } finally {
      setIsBusy(false);
    }
  };

  const handleUpdateProjectMeta = async (patch: Record<string, any>) => {
    if (!activeProject) return;
    try {
      const proj = await api.updateProject(activeProject.id, patch);
      setActiveProject(proj);
      refreshProjectsList();
    } catch (err: any) {
      setErrorMsg(err?.message || "시료 정보 업데이트에 실패했습니다.");
    }
  };

  const handleStartRun = async () => {
    if (!activeProject) return;
    setIsBusy(true);
    setErrorMsg(null);
    try {
      const started = await api.startRun(activeProject.id, {
        xrd_params: xrdParams,
        sem_params: semParams,
        run_ai_interpretation: runAi,
      });
      const r = await api.getRun(started.run_id);
      setActiveRun(r);
      setViewMode("results");
      writeUrlState({
        projectId: activeProject.id,
        runId: r.id,
        view: "results",
        tab: activeTab,
      });
    } catch (err: any) {
      setErrorMsg(err?.message || "분석 실행 요청에 실패했습니다.");
      setIsBusy(false);
    }
  };

  const handleRetryAi = async (selectedModel?: string) => {
    if (!activeRun) return;
    setIsRetryingAi(true);
    try {
      const updated = await api.retryAi(activeRun.id, selectedModel);
      setActiveRun(updated);
      if (activeProject) {
        const proj = await api.getProject(activeProject.id);
        setActiveProject(proj);
      }
      const h = await api.getHealth();
      setHealth(h);
    } catch (err: any) {
      setErrorMsg(err?.message || "AI 해석 재시도에 실패했습니다.");
    } finally {
      setIsRetryingAi(false);
    }
  };

  const handleSaveGlobalApiConfig = async () => {
    setSavingGlobalApi(true);
    try {
      await api.saveAiConfig({
        gemini_api_key: globalGeminiKey.trim() || undefined,
        gemini_model: globalGeminiModel,
        mp_api_key: globalMpKey.trim() || undefined,
      });
      const h = await api.getHealth();
      setHealth(h);
      if (h.gemini_api_configured) {
        setRunAi(true);
      }
      setGlobalGeminiKey("");
      setGlobalMpKey("");
      setShowGlobalApiPanel(false);
      if (
        h.gemini_api_configured &&
        activeRun &&
        activeRun.status === "completed" &&
        activeRun.ai_report?.status !== "completed"
      ) {
        await handleRetryAi(globalGeminiModel);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "API 설정 저장에 실패했습니다.");
    } finally {
      setSavingGlobalApi(false);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    try {
      await api.deleteProject(projectId);
      if (activeProject?.id === projectId) {
        setActiveProject(null);
        setActiveRun(null);
        writeUrlState({});
      }
      refreshProjectsList();
    } catch (err: any) {
      setErrorMsg(err?.message || "시료 삭제에 실패했습니다.");
    }
  };

  const handleSelectSavedRun = async (runId: string) => {
    if (!activeProject) return;
    setIsBusy(true);
    try {
      const r = await api.getRun(runId);
      setActiveRun(r);
      if (r.params?.xrd_params) setXrdParams(r.params.xrd_params);
      if (r.params?.sem_params) setSemParams(r.params.sem_params);
      writeUrlState({ projectId: activeProject.id, runId: r.id, view: "results", tab: activeTab });
    } catch (err: any) {
      setErrorMsg(err?.message || "이전 실행 결과를 불러오지 못했습니다.");
    } finally {
      setIsBusy(false);
    }
  };

  const isJobRunning = activeRun?.status === "queued" || activeRun?.status === "running";

  return (
    <div className="min-h-screen flex flex-col bg-[#F7F8FA] text-[#191F28]">
      {/* Top Navigation Header */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-[#E5E8EB]">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => {
                setActiveProject(null);
                setActiveRun(null);
                setErrorMsg(null);
                writeUrlState({});
                refreshProjectsList();
              }}
              className="flex items-center gap-2 font-bold text-[19px] tracking-tight text-[#191F28] cursor-pointer shrink-0 min-h-[44px]"
            >
              <span className="w-8 h-8 rounded-[10px] bg-[#3182F6] text-white flex items-center justify-center">
                <Layers className="w-4 h-4" />
              </span>
              <span>MatLens</span>
            </button>

            {/* Service Mode Toggle Switcher */}
            <div className="flex items-center p-0.5 rounded-[10px] bg-[#F2F4F6] border border-[#E5E8EB] ml-1 sm:ml-2">
              <button
                type="button"
                onClick={() => {
                  setServiceMode("matlens");
                  writeUrlState({ mode: "matlens", projectId: activeProject?.id, runId: activeRun?.id, view: viewMode, tab: activeTab });
                }}
                className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-[8px] text-[12px] sm:text-[13px] font-semibold transition-all ${
                  serviceMode === "matlens"
                    ? "bg-white text-[#191F28] shadow-sm font-bold"
                    : "text-[#6B7684] hover:text-[#191F28]"
                }`}
              >
                XRD · SEM 분석
              </button>
              <button
                type="button"
                onClick={() => {
                  setServiceMode("utm");
                  writeUrlState({ mode: "utm" });
                }}
                className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-[8px] text-[12px] sm:text-[13px] font-semibold transition-all flex items-center gap-1.5 ${
                  serviceMode === "utm"
                    ? "bg-white text-[#3182F6] shadow-sm font-bold"
                    : "text-[#6B7684] hover:text-[#191F28]"
                }`}
              >
                <span>UTM 데이터 분석</span>
                <span className="w-1.5 h-1.5 rounded-full bg-[#3182F6]" />
              </button>
            </div>

            {serviceMode === "matlens" && activeProject && (
              <>
                <span className="text-[#E5E8EB] text-[18px]">/</span>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[14px] sm:text-[15px] font-semibold text-[#191F28] truncate">
                    {activeProject.sample_name}
                  </span>
                  {activeProject.is_sample_demo && <SourceTag kind="샘플" />}
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {serviceMode === "matlens" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setShowGlobalApiPanel((v) => !v)}
              >
                <KeyRound className="w-4 h-4 text-[#3182F6]" />
                <span className="hidden sm:inline">Gemini · API 설정</span>
                <span
                  className={`w-2 h-2 rounded-full ${
                    health?.gemini_api_configured ? "bg-[#16A34A]" : "bg-[#D97706]"
                  }`}
                />
              </Button>
            )}

            {serviceMode === "matlens" && activeProject && (
              <>
                {activeRun && viewMode === "setup" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      setViewMode("results");
                      writeUrlState({
                        projectId: activeProject.id,
                        runId: activeRun.id,
                        view: "results",
                        tab: activeTab,
                      });
                    }}
                  >
                    결과 화면으로
                  </Button>
                )}

                {viewMode === "results" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setViewMode("setup");
                      writeUrlState({
                        projectId: activeProject.id,
                        runId: activeRun?.id,
                        view: "setup",
                      });
                    }}
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                    <span className="hidden sm:inline">시료·파일 조건</span>
                  </Button>
                )}

                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setActiveProject(null);
                    setActiveRun(null);
                    setErrorMsg(null);
                    writeUrlState({});
                    refreshProjectsList();
                  }}
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span className="hidden sm:inline">시료 목록</span>
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Global API & Multi-Model Configuration Drawer */}
        {showGlobalApiPanel && (
          <div className="border-t border-[#E5E8EB] bg-[#F8FAFC]">
            <div className="max-w-[1600px] mx-auto px-4 sm:px-8 py-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[14px] font-bold text-[#191F28] flex items-center gap-2">
                  <span>Gemini API 키 및 다중 버전(Auto-Fallback) 설정</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${
                      health?.gemini_api_configured
                        ? "bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]"
                        : "bg-[#FEF3C7] text-[#B45309] border-[#FDE68A]"
                    }`}
                  >
                    {health?.gemini_api_configured ? "Gemini 연결됨" : "Gemini 키 미설정"}
                  </span>
                </div>
                <span className="text-[12px] text-[#6B7684]">
                  .env 파일을 열지 않고 여기서 바로 키와 Gemini 버전을 설정할 수 있습니다 (또는 일반 텍스트 <code>api_config.txt</code> 편집 가능)
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                <div className="md:col-span-4">
                  <label className="block text-[12px] font-semibold text-[#191F28] mb-1">
                    Google Gemini API 키 (AIza...)
                  </label>
                  <input
                    type="password"
                    value={globalGeminiKey}
                    onChange={(e) => setGlobalGeminiKey(e.target.value)}
                    placeholder={
                      health?.gemini_api_configured
                        ? "이미 설정됨 (변경할 때만 새 키 입력)"
                        : "AIza... 로 시작하는 Gemini API 키 붙여넣기"
                    }
                    className="w-full min-h-[42px] px-3 rounded-[10px] border border-[#E5E8EB] bg-white text-[13px] font-mono"
                  />
                </div>

                <div className="md:col-span-4">
                  <label className="block text-[12px] font-semibold text-[#191F28] mb-1">
                    Gemini 모델 버전 선택 (자동 전환 지원)
                  </label>
                  <select
                    value={globalGeminiModel}
                    onChange={(e) => setGlobalGeminiModel(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-[10px] border border-[#E5E8EB] bg-white text-[13px] font-medium"
                  >
                    {(
                      health?.gemini_models || [
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
                      ]
                    ).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-[12px] font-semibold text-[#191F28] mb-1">
                    Materials Project 키 (선택)
                  </label>
                  <input
                    type="password"
                    value={globalMpKey}
                    onChange={(e) => setGlobalMpKey(e.target.value)}
                    placeholder={health?.mp_api_configured ? "설정됨" : "선택 입력"}
                    className="w-full min-h-[42px] px-3 rounded-[10px] border border-[#E5E8EB] bg-white text-[13px] font-mono"
                  />
                </div>

                <div className="md:col-span-2 flex gap-2">
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    className="w-full min-h-[42px]"
                    disabled={savingGlobalApi}
                    onClick={handleSaveGlobalApiConfig}
                  >
                    {savingGlobalApi ? "저장 중..." : "설정 저장"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-8 py-6 sm:py-8">
        {serviceMode === "utm" ? (
          <UtmView />
        ) : viewMode === "setup" || !activeProject ? (
          <LandingSetup
            health={health}
            projects={projects}
            activeProject={activeProject}
            xrdParams={xrdParams}
            semParams={semParams}
            runAi={runAi}
            isBusy={isBusy || isJobRunning}
            errorMsg={errorMsg}
            onClearError={() => setErrorMsg(null)}
            onSelectProject={(pid) => openProject(pid)}
            onDeleteProject={handleDeleteProject}
            onCreateProject={handleCreateProject}
            onQuickImportFiles={handleQuickImportFiles}
            onLoadSample={handleLoadSample}
            onUpdateProjectMeta={handleUpdateProjectMeta}
            onUploadFile={handleUploadFile}
            onUploadFromDesktop={handleUploadFromDesktop}
            onChangeXrdParams={setXrdParams}
            onChangeSemParams={setSemParams}
            onChangeRunAi={setRunAi}
            onStartRun={handleStartRun}
            onNavigateToUtm={() => {
              setServiceMode("utm");
              writeUrlState({ mode: "utm" });
            }}
          />
        ) : (
          <div className="space-y-6">
            {errorMsg && (
              <div className="rounded-[16px] bg-[#FEE2E2] border border-[#FECACA] p-4 text-[13px] text-[#DC2626] flex justify-between items-center">
                <span>{errorMsg}</span>
                <button
                  type="button"
                  onClick={() => setErrorMsg(null)}
                  className="font-semibold underline px-2 min-h-[44px] cursor-pointer"
                >
                  닫기
                </button>
              </div>
            )}

            {/* Background Job Running Progress Card */}
            {isJobRunning && activeRun && (
              <div className="rounded-[20px] bg-white border border-[#BFDBFE] p-8 text-center space-y-4">
                <Loader2 className="w-8 h-8 text-[#3182F6] animate-spin mx-auto" />
                <div className="text-[18px] font-bold text-[#191F28]">
                  분석 엔진이 데이터를 계산하고 있습니다 (Run #{activeRun.run_number})
                </div>
                <p className="text-[14px] text-[#6B7684]">{activeRun.stage_message}</p>
                <div className="max-w-md mx-auto h-2.5 bg-[#F2F4F6] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#3182F6] transition-all duration-300"
                    style={{ width: `${Math.max(10, activeRun.progress_pct)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Completed Results Tabs: [XRD] [SEM] [통합 리포트] */}
            {activeRun && activeRun.status === "completed" && (
              <Tabs.Root
                value={activeTab}
                onValueChange={(val) => {
                  const t = val as "xrd" | "sem" | "report";
                  setActiveTab(t);
                  writeUrlState({
                    projectId: activeProject.id,
                    runId: activeRun.id,
                    view: "results",
                    tab: t,
                  });
                }}
                className="space-y-6"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Tabs.List className="inline-flex p-1.5 rounded-[16px] bg-white border border-[#E5E8EB] gap-1">
                    <Tabs.Trigger
                      value="xrd"
                      className="inline-flex items-center gap-2 min-h-[44px] px-4 sm:px-5 rounded-[12px] text-[14px] font-semibold text-[#6B7684] data-[state=active]:bg-[#3182F6] data-[state=active]:text-white transition-colors cursor-pointer"
                    >
                      <Activity className="w-4 h-4" />
                      XRD
                    </Tabs.Trigger>
                    <Tabs.Trigger
                      value="sem"
                      className="inline-flex items-center gap-2 min-h-[44px] px-4 sm:px-5 rounded-[12px] text-[14px] font-semibold text-[#6B7684] data-[state=active]:bg-[#3182F6] data-[state=active]:text-white transition-colors cursor-pointer"
                    >
                      <Microscope className="w-4 h-4" />
                      SEM
                    </Tabs.Trigger>
                    <Tabs.Trigger
                      value="report"
                      className="inline-flex items-center gap-2 min-h-[44px] px-4 sm:px-5 rounded-[12px] text-[14px] font-semibold text-[#6B7684] data-[state=active]:bg-[#3182F6] data-[state=active]:text-white transition-colors cursor-pointer"
                    >
                      <FileBarChart2 className="w-4 h-4" />
                      통합 리포트
                    </Tabs.Trigger>
                  </Tabs.List>

                  <div className="text-[13px] text-[#6B7684] font-medium">
                    실행 버전: <strong className="text-[#191F28]">Run #{activeRun.run_number}</strong> ·{" "}
                    {new Date(activeRun.created_at).toLocaleString("ko-KR")}
                  </div>
                </div>

                <Tabs.Content value="xrd" className="outline-none">
                  <XrdView
                    runId={activeRun.id}
                    xrdResult={activeRun.xrd_result}
                    xrdParams={xrdParams}
                    expectedElements={activeProject.expected_elements}
                    isBusy={isBusy || isJobRunning}
                    onChangeParams={setXrdParams}
                    onChangeExpectedElements={(nextElems) =>
                      handleUpdateProjectMeta({
                        expected_elements: nextElems,
                        change_summary: `예상 원소 변경: ${nextElems.join(", ") || "없음"}`,
                      })
                    }
                    onRerun={handleStartRun}
                  />
                </Tabs.Content>

                <Tabs.Content value="sem" className="outline-none">
                  <SemView
                    runId={activeRun.id}
                    semResult={activeRun.sem_result}
                    xrdResult={activeRun.xrd_result}
                    semParams={semParams}
                    isBusy={isBusy || isJobRunning}
                    onChangeParams={setSemParams}
                    onRerun={handleStartRun}
                  />
                </Tabs.Content>

                <Tabs.Content value="report" className="outline-none">
                  <IntegratedReportView
                    project={activeProject}
                    run={activeRun}
                    isRetryingAi={isRetryingAi}
                    onRetryAi={handleRetryAi}
                    onSelectRun={handleSelectSavedRun}
                  />
                </Tabs.Content>
              </Tabs.Root>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
