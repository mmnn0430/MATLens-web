import { useCallback, useEffect, useState } from "react";
import {
  Layers,
  Microscope,
  Activity,
  KeyRound,
  Zap,
  Flame,
  Share2,
  FolderPlus,
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
import { HomeDashboard } from "./components/HomeDashboard";
import { XrdWorkspace } from "./components/XrdWorkspace";
import { SemWorkspace } from "./components/SemWorkspace";
import { UtmView } from "./components/UtmView";
import { HallView } from "./components/HallView";
import { LfaView } from "./components/LfaView";
import { SpectroView } from "./components/SpectroView";
import { IntegratedAnalysisView } from "./components/IntegratedAnalysisView";
import {
  SampleRegistrationModal,
  SampleSelectorBar,
  type SampleFormPayload,
} from "./components/SampleManagement";
import { Button, SourceTag } from "./components/ui/primitives";

import type { ServiceMode } from "./types";
export type { ServiceMode };

function normalizeMode(rawMode: string | null, tab: string | null, projectId: string | null, sessionId: string | null): ServiceMode {
  if (rawMode === "spectro") return "ftir";
  if (rawMode === "matlens") {
    return tab === "sem" ? "sem" : "xrd";
  }
  if (
    rawMode === "home" ||
    rawMode === "xrd" ||
    rawMode === "sem" ||
    rawMode === "utm" ||
    rawMode === "hall" ||
    rawMode === "lfa" ||
    rawMode === "ftir" ||
    rawMode === "dsc" ||
    rawMode === "tga" ||
    rawMode === "integrated"
  ) {
    return rawMode;
  }
  if (projectId) {
    return tab === "sem" ? "sem" : "xrd";
  }
  if (sessionId) {
    return "integrated";
  }
  return "home";
}

function readUrlState() {
  const sp = new URLSearchParams(window.location.search);
  const rawMode = sp.get("mode");
  const projectId = sp.get("project");
  const sessionId = sp.get("session");
  const tab = (sp.get("tab") as "xrd" | "sem") || null;
  const resolvedMode = normalizeMode(rawMode, tab, projectId, sessionId);
  return {
    mode: resolvedMode,
    projectId,
    runId: sp.get("run"),
    view: (sp.get("view") as "setup" | "results") || null,
    tab: tab || (resolvedMode === "sem" ? "sem" : "xrd"),
  };
}

function writeUrlState(next: {
  mode?: ServiceMode;
  projectId?: string | null;
  runId?: string | null;
  view?: "setup" | "results";
  tab?: "xrd" | "sem";
}) {
  const sp = new URLSearchParams();
  const effectiveMode = next.mode || (next.projectId ? "xrd" : "home");
  if (effectiveMode !== "home") {
    sp.set("mode", effectiveMode);
  }
  if (next.projectId) sp.set("project", next.projectId);
  if (next.runId) sp.set("run", next.runId);
  if (next.view) sp.set("view", next.view);
  if (next.tab) sp.set("tab", next.tab);
  const qs = sp.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}

export default function App() {
  const [serviceMode, setServiceMode] = useState<ServiceMode>(() => readUrlState().mode);
  const [visitedModes, setVisitedModes] = useState<Record<string, boolean>>({});
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [projectsLoading, setProjectsLoading] = useState<boolean>(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<ProjectDetail | null>(null);
  const [activeRun, setActiveRun] = useState<RunDetail | null>(null);

  const [xrdParams, setXrdParams] = useState<XRDParams>(DEFAULT_XRD_PARAMS);
  const [semParams, setSemParams] = useState<SEMParams>(DEFAULT_SEM_PARAMS);
  const [runAi, setRunAi] = useState<boolean>(true);

  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [, setIsRetryingAi] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showGlobalApiPanel, setShowGlobalApiPanel] = useState<boolean>(false);
  const [globalGeminiKey, setGlobalGeminiKey] = useState<string>("");
  const [globalGeminiModel, setGlobalGeminiModel] = useState<string>("auto");
  const [globalMpKey, setGlobalMpKey] = useState<string>("");
  const [savingGlobalApi, setSavingGlobalApi] = useState<boolean>(false);

  // Sample Registration & Edit Modal State
  const [sampleModalOpen, setSampleModalOpen] = useState<boolean>(false);
  const [editingSampleTarget, setEditingSampleTarget] = useState<ProjectDetail | ProjectListItem | null>(null);

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
    setProjectsLoading(true);
    setProjectsError(null);
    try {
      const list = await api.listProjects();
      setProjects(list);
      return list;
    } catch (err: any) {
      setProjectsError(err?.message || "저장된 분석 데이터를 불러오지 못했습니다.");
      return [];
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  const openProject = useCallback(
    async (
      projectId: string,
      preferredRunId?: string | null,
      targetMode?: ServiceMode,
      isInitialUrlLoad?: boolean
    ) => {
      setIsBusy(true);
      setErrorMsg(null);
      try {
        const proj = await api.getProject(projectId);
        setActiveProject(proj);
        hydrateParamsFromProject(proj);

        const targetRunId = preferredRunId || proj.latest_run_id;
        let resolvedRun: RunDetail | null = null;
        if (targetRunId) {
          resolvedRun = await api.getRun(targetRunId);
          setActiveRun(resolvedRun);
        } else {
          setActiveRun(null);
        }

        const hasXrdFile = proj.files.some((f) => f.file_role === "xrd");
        const hasSemFile = proj.files.some((f) => f.file_role === "sem");

        const nextMode: ServiceMode =
          targetMode && targetMode !== "home" && targetMode !== "matlens"
            ? targetMode
            : resolvedRun?.xrd_result
            ? "xrd"
            : resolvedRun?.sem_result
            ? "sem"
            : hasXrdFile
            ? "xrd"
            : hasSemFile
            ? "sem"
            : "xrd";

        setServiceMode(nextMode);
        writeUrlState({
          mode: nextMode,
          projectId: proj.id,
          runId: resolvedRun?.id || null,
        });
      } catch (err: any) {
        if (isInitialUrlLoad) {
          writeUrlState({ mode: "home" });
          setServiceMode("home");
          setActiveProject(null);
          setActiveRun(null);
          setErrorMsg(null);
        } else {
          setErrorMsg(err?.message || "시료 데이터를 불러오지 못했습니다.");
        }
      } finally {
        setIsBusy(false);
      }
    },
    [hydrateParamsFromProject]
  );

  // Switch active sample while keeping current instrument tab
  const handleSelectSampleKeepMode = useCallback(
    async (projectId: string) => {
      await openProject(projectId, null, serviceMode === "home" ? "xrd" : serviceMode, false);
    },
    [openProject, serviceMode]
  );

  // Track visited analysis modes so in-memory analysis state is preserved across tab switches
  useEffect(() => {
    if (["utm", "hall", "lfa", "ftir", "dsc", "tga"].includes(serviceMode)) {
      setVisitedModes((prev) => (prev[serviceMode] ? prev : { ...prev, [serviceMode]: true }));
    }
  }, [serviceMode]);

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

    refreshProjectsList().then((list) => {
      if (urlState.projectId) {
        openProject(urlState.projectId, urlState.runId, urlState.mode, true);
      } else if (urlState.mode !== "home") {
        setServiceMode(urlState.mode);
        // Auto-select most recent sample if entering an instrument tab without an explicit project param
        if (list.length > 0 && (urlState.mode === "xrd" || urlState.mode === "sem")) {
          openProject(list[0].id, null, urlState.mode, true);
        }
      } else {
        setServiceMode("home");
      }
    });
  }, [openProject, refreshProjectsList]);

  // Synchronize active XRD and SEM measurements to shared storage for Integrated Report
  useEffect(() => {
    if (activeRun?.xrd_result?.scherrer?.mean_nm) {
      try {
        localStorage.setItem(
          "matlens_shared_xrd_data",
          JSON.stringify({
            crystallite_size_nm: activeRun.xrd_result.scherrer.mean_nm,
            space_group: activeRun.xrd_result.phase_matching?.candidates?.[0]?.spacegroup || "F-43m",
            sample_id: activeProject?.sample_name || "XRD-Sample",
            formula: activeProject?.expected_formula || "Custom",
            timestamp: new Date().toISOString(),
          })
        );
      } catch {
        // ignore
      }
    }
    const semFile = activeProject?.files?.find((f) => f.file_role === "sem");
    let semImageUrl: string | null = null;
    if (activeRun?.id && (activeRun.has_overlay || activeRun.status === "completed")) {
      semImageUrl = api.overlayUrl(activeRun.id);
    } else if (activeRun?.id && activeRun.has_roi_image) {
      semImageUrl = api.roiUrl(activeRun.id);
    } else if (activeProject?.id && semFile?.id) {
      semImageUrl = api.rawFileUrl(activeProject.id, semFile.id);
    }

    if (activeRun?.sem_result || semImageUrl) {
      const meanGrain =
        activeRun?.sem_result?.summary_stats?.mean_diameter ||
        activeRun?.sem_result?.grain_intercept?.mean_intercept_length ||
        activeRun?.sem_result?.summary_stats?.d50 ||
        activeRun?.sem_result?.summary_stats?.mean_um ||
        2.4;
      const porosityVal =
        activeRun?.sem_result?.porosity?.porosity_fraction_pct ||
        activeRun?.sem_result?.porosity?.porosity_percent ||
        1.2;

      try {
        localStorage.setItem(
          "matlens_shared_sem_data",
          JSON.stringify({
            grain_size_um: Number(Number(meanGrain).toFixed(2)),
            porosity_pct: Number(Number(porosityVal).toFixed(1)),
            sample_id: activeProject?.sample_name || "SEM-Sample",
            image_url: semImageUrl,
            timestamp: new Date().toISOString(),
          })
        );
      } catch {
        // ignore
      }
    }
  }, [activeRun, activeProject]);

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
            const nextMode: ServiceMode =
              serviceMode === "sem"
                ? "sem"
                : serviceMode === "xrd"
                ? "xrd"
                : updated.xrd_result
                ? "xrd"
                : "sem";
            writeUrlState({
              mode: nextMode,
              projectId: updated.project_id,
              runId: updated.id,
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
  }, [activeRun, activeProject, refreshProjectsList, serviceMode]);

  // Handle Sample Registration or Edit Modal Submit
  const handleSampleModalSubmit = async (payload: SampleFormPayload, editingSampleId?: string) => {
    setIsBusy(true);
    setErrorMsg(null);
    try {
      if (editingSampleId) {
        const updated = await api.updateProject(editingSampleId, {
          sample_name: payload.sample_name,
          expected_formula: payload.expected_formula,
          sample_code: payload.sample_code,
          processing_method: payload.processing_method,
          experiment_memo: payload.experiment_memo,
          description: payload.description,
          expected_elements: payload.expected_elements,
          is_same_sample: payload.is_same_sample,
          change_summary: `시료 정보 수정: ${payload.sample_name}`,
        });
        if (activeProject?.id === editingSampleId) {
          setActiveProject(updated);
        }
        await refreshProjectsList();
      } else {
        const created = await api.createProject(payload);
        setActiveProject(created);
        setActiveRun(null);
        hydrateParamsFromProject(created);
        await refreshProjectsList();
        if (serviceMode !== "home") {
          writeUrlState({ mode: serviceMode, projectId: created.id });
        }
      }
      setSampleModalOpen(false);
      setEditingSampleTarget(null);
    } catch (err: any) {
      setErrorMsg(err?.message || "시료 저장에 실패했습니다.");
    } finally {
      setIsBusy(false);
    }
  };

  const handleLoadSample = async (preset: "tio2_powder" | "sintered_grains" | "desktop_nbfesb") => {
    setIsBusy(true);
    setErrorMsg(null);
    const targetMode: ServiceMode = preset === "sintered_grains" ? "sem" : "xrd";
    setServiceMode(targetMode);
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

      const started = await api.startRun(proj.id, {
        xrd_params: nextXrd,
        sem_params: nextSem,
        run_ai_interpretation: Boolean(health?.gemini_api_configured && runAi),
      });
      const r = await api.getRun(started.run_id);
      setActiveRun(r);
      writeUrlState({ mode: targetMode, projectId: proj.id, runId: r.id });
    } catch (err: any) {
      setErrorMsg(err?.message || "샘플 프로젝트 생성에 실패했습니다.");
      setIsBusy(false);
    }
  };

  // Multi-file upload without resetting existing uploaded files
  const handleUploadMultipleFiles = async (role: "xrd" | "sem" | "cif", files: File[]) => {
    if (!activeProject || files.length === 0) return;
    setIsBusy(true);
    setErrorMsg(null);
    try {
      let latestProj = activeProject;
      for (const file of files) {
        latestProj = await api.uploadFile(latestProj.id, role, file);
      }
      setActiveProject(latestProj);
      hydrateParamsFromProject(latestProj);
      await refreshProjectsList();
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

  const handleDeleteFile = async (fileId: string) => {
    if (!activeProject) return;
    setIsBusy(true);
    setErrorMsg(null);
    try {
      const proj = await api.deleteProjectFile(activeProject.id, fileId);
      setActiveProject(proj);
      refreshProjectsList();
    } catch (err: any) {
      setErrorMsg(err?.message || "파일 삭제에 실패했습니다.");
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

  const handleStartRunWithSelection = async (
    selectedXrdFileId?: string | null,
    selectedSemFileId?: string | null,
    overrideSemParams?: SEMParams
  ) => {
    if (!activeProject) return;
    setIsBusy(true);
    setErrorMsg(null);
    try {
      const started = await api.startRun(activeProject.id, {
        xrd_params: xrdParams,
        sem_params: overrideSemParams || semParams,
        run_ai_interpretation: runAi,
        selected_xrd_file_id: selectedXrdFileId || null,
        selected_sem_file_id: selectedSemFileId || null,
      });
      const r = await api.getRun(started.run_id);
      setActiveRun(r);
      writeUrlState({
        mode: serviceMode,
        projectId: activeProject.id,
        runId: r.id,
      });
    } catch (err: any) {
      setErrorMsg(err?.message || "분석 실행 요청에 실패했습니다.");
      setIsBusy(false);
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
      writeUrlState({ mode: serviceMode, projectId: activeProject.id, runId: r.id });
    } catch (err: any) {
      setErrorMsg(err?.message || "이전 실행 결과를 불러오지 못했습니다.");
    } finally {
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
        writeUrlState({ mode: serviceMode });
      }
      refreshProjectsList();
    } catch (err: any) {
      setErrorMsg(err?.message || "시료 삭제에 실패했습니다.");
    }
  };

  const switchMode = (nextMode: ServiceMode) => {
    setServiceMode(nextMode);
    setErrorMsg(null);
    if ((nextMode === "xrd" || nextMode === "sem") && !activeProject && projects.length > 0) {
      openProject(projects[0].id, null, nextMode, false);
      return;
    }
    writeUrlState({
      mode: nextMode,
      projectId: nextMode === "home" ? null : activeProject?.id,
      runId: nextMode === "xrd" || nextMode === "sem" ? activeRun?.id : null,
    });
  };

  const isJobRunning = activeRun?.status === "queued" || activeRun?.status === "running";

  return (
    <div className="min-h-screen flex flex-col bg-[#F7F8FA] text-[#191F28]">
      {/* Top Navigation Header */}
      <header className="sticky top-0 z-40 w-full bg-white/95 backdrop-blur border-b border-[#E5E8EB]">
        <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-8 min-h-16 py-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 max-w-full">
            <button
              type="button"
              onClick={() => {
                setServiceMode("home");
                setErrorMsg(null);
                writeUrlState({ mode: "home" });
                refreshProjectsList();
              }}
              aria-label="MatLens 홈 화면으로 이동"
              title="MatLens 홈 화면으로 이동"
              className="group flex items-center gap-2 font-bold text-[19px] tracking-tight text-[#191F28] hover:text-[#3182F6] cursor-pointer shrink-0 min-h-[44px] px-2 -ml-2 rounded-[12px] hover:bg-[#F2F4F6]/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3182F6] transition-all"
            >
              <span className="w-8 h-8 rounded-[10px] bg-[#3182F6] group-hover:bg-[#1B64DA] text-white flex items-center justify-center transition-colors">
                <Layers className="w-4 h-4" />
              </span>
              <span>MatLens</span>
            </button>

            {/* Independent Instrument Tabs Navigation */}
            <nav
              aria-label="주요 분석 기기 탭"
              className="flex items-center p-0.5 rounded-[10px] bg-[#F2F4F6] border border-[#E5E8EB] ml-1 sm:ml-2 gap-0.5 overflow-x-auto max-w-full whitespace-nowrap"
            >
              <button
                type="button"
                onClick={() => switchMode("xrd")}
                className={`px-2.5 py-1 rounded-[8px] text-[12px] font-semibold transition-all flex items-center gap-1 cursor-pointer ${
                  serviceMode === "xrd"
                    ? "bg-white text-[#3182F6] shadow-xs font-bold"
                    : "text-[#6B7684] hover:text-[#191F28]"
                }`}
              >
                <Activity className="w-3 h-3 text-[#3182F6]" />
                <span>XRD</span>
              </button>

              <button
                type="button"
                onClick={() => switchMode("sem")}
                className={`px-2.5 py-1 rounded-[8px] text-[12px] font-semibold transition-all flex items-center gap-1 cursor-pointer ${
                  serviceMode === "sem"
                    ? "bg-white text-[#15803D] shadow-xs font-bold"
                    : "text-[#6B7684] hover:text-[#191F28]"
                }`}
              >
                <Microscope className="w-3 h-3 text-[#15803D]" />
                <span>SEM</span>
              </button>

              <button
                type="button"
                onClick={() => switchMode("utm")}
                className={`px-2.5 py-1 rounded-[8px] text-[12px] font-semibold transition-all cursor-pointer ${
                  serviceMode === "utm"
                    ? "bg-white text-[#3182F6] shadow-xs font-bold"
                    : "text-[#6B7684] hover:text-[#191F28]"
                }`}
              >
                UTM
              </button>

              <button
                type="button"
                onClick={() => switchMode("hall")}
                className={`px-2.5 py-1 rounded-[8px] text-[12px] font-semibold transition-all flex items-center gap-1 cursor-pointer ${
                  serviceMode === "hall"
                    ? "bg-white text-[#2563EB] shadow-xs font-bold"
                    : "text-[#6B7684] hover:text-[#191F28]"
                }`}
              >
                <Zap className="w-3 h-3 text-[#2563EB]" />
                <span>Hall</span>
              </button>

              <button
                type="button"
                onClick={() => switchMode("lfa")}
                className={`px-2.5 py-1 rounded-[8px] text-[12px] font-semibold transition-all flex items-center gap-1 cursor-pointer ${
                  serviceMode === "lfa"
                    ? "bg-white text-[#D97706] shadow-xs font-bold"
                    : "text-[#6B7684] hover:text-[#191F28]"
                }`}
              >
                <Flame className="w-3 h-3 text-[#D97706]" />
                <span>LFA</span>
              </button>

              <button
                type="button"
                onClick={() => switchMode("ftir")}
                className={`px-2.5 py-1 rounded-[8px] text-[12px] font-semibold transition-all flex items-center gap-1 cursor-pointer ${
                  serviceMode === "ftir"
                    ? "bg-white text-[#4F46E5] shadow-xs font-bold"
                    : "text-[#6B7684] hover:text-[#191F28]"
                }`}
              >
                <Activity className="w-3 h-3 text-[#4F46E5]" />
                <span>FT-IR</span>
              </button>

              <button
                type="button"
                onClick={() => switchMode("dsc")}
                className={`px-2.5 py-1 rounded-[8px] text-[12px] font-semibold transition-all flex items-center gap-1 cursor-pointer ${
                  serviceMode === "dsc"
                    ? "bg-white text-[#DB2777] shadow-xs font-bold"
                    : "text-[#6B7684] hover:text-[#191F28]"
                }`}
              >
                <Flame className="w-3 h-3 text-[#DB2777]" />
                <span>DSC</span>
              </button>

              <button
                type="button"
                onClick={() => switchMode("tga")}
                className={`px-2.5 py-1 rounded-[8px] text-[12px] font-semibold transition-all flex items-center gap-1 cursor-pointer ${
                  serviceMode === "tga"
                    ? "bg-white text-[#059669] shadow-xs font-bold"
                    : "text-[#6B7684] hover:text-[#191F28]"
                }`}
              >
                <Flame className="w-3 h-3 text-[#059669]" />
                <span>TGA</span>
              </button>

              <button
                type="button"
                onClick={() => switchMode("integrated")}
                className={`px-2.5 py-1 rounded-[8px] text-[12px] font-semibold transition-all flex items-center gap-1 cursor-pointer ${
                  serviceMode === "integrated"
                    ? "bg-white text-[#7C3AED] shadow-xs font-bold"
                    : "text-[#6B7684] hover:text-[#191F28]"
                }`}
              >
                <Share2 className="w-3 h-3 text-[#7C3AED]" />
                <span>통합 리포트</span>
              </button>
            </nav>

            {serviceMode !== "home" && activeProject && (
              <>
                <span className="hidden 2xl:inline text-[#E5E8EB] text-[18px]">/</span>
                <div className="hidden 2xl:flex items-center gap-2 min-w-0 max-w-[260px] overflow-hidden">
                  <span className="text-[13px] font-semibold text-[#191F28] truncate">
                    {activeProject.sample_name}
                  </span>
                  {activeProject.is_sample_demo && <SourceTag kind="샘플" />}
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setEditingSampleTarget(null);
                setSampleModalOpen(true);
              }}
            >
              <FolderPlus className="w-4 h-4 text-[#3182F6]" />
              <span className="hidden sm:inline">시료 등록하기</span>
            </Button>

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
                  .env 파일을 열지 않고 여기서 바로 키와 Gemini 버전을 설정할 수 있습니다
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
                        { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash (표준 호환)" },
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
        {errorMsg && (
          <div className="mb-5 rounded-[16px] bg-[#FEE2E2] border border-[#FECACA] p-4 text-[13px] text-[#DC2626] flex justify-between items-center">
            <span>{errorMsg}</span>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              className="font-semibold underline px-2 min-h-[36px] cursor-pointer"
            >
              닫기
            </button>
          </div>
        )}

        {/* Common Sample Selector Bar across all analysis instruments */}
        {serviceMode !== "home" && (
          <SampleSelectorBar
            projects={projects}
            activeProject={activeProject}
            currentInstrument={
              serviceMode === "matlens" ? "xrd" : serviceMode
            }
            onSelectSample={handleSelectSampleKeepMode}
            onNavigateHomeSampleManager={() => switchMode("home")}
            onOpenEditModal={() => {
              if (activeProject) {
                setEditingSampleTarget(activeProject);
                setSampleModalOpen(true);
              }
            }}
            onProjectUpdated={async () => {
              if (activeProject) {
                const p = await api.getProject(activeProject.id);
                setActiveProject(p);
              }
              refreshProjectsList();
            }}
          />
        )}

        {/* Persistent Mounted Instrument Views (preserving in-memory state across tab navigation) */}
        {(visitedModes.utm || serviceMode === "utm") && (
          <div className={serviceMode === "utm" ? "block" : "hidden"}>
            <UtmView
              activeSample={activeProject}
              onRecordSaved={async () => {
                if (activeProject) {
                  const p = await api.getProject(activeProject.id);
                  setActiveProject(p);
                }
                refreshProjectsList();
              }}
              onNavigateToIntegrated={() => switchMode("integrated")}
            />
          </div>
        )}

        {(visitedModes.hall || serviceMode === "hall") && (
          <div className={serviceMode === "hall" ? "block" : "hidden"}>
            <HallView
              activeSample={activeProject}
              onRecordSaved={async () => {
                if (activeProject) {
                  const p = await api.getProject(activeProject.id);
                  setActiveProject(p);
                }
                refreshProjectsList();
              }}
              onNavigateToIntegrated={() => switchMode("integrated")}
            />
          </div>
        )}

        {(visitedModes.lfa || serviceMode === "lfa") && (
          <div className={serviceMode === "lfa" ? "block" : "hidden"}>
            <LfaView
              activeSample={activeProject}
              onRecordSaved={async () => {
                if (activeProject) {
                  const p = await api.getProject(activeProject.id);
                  setActiveProject(p);
                }
                refreshProjectsList();
              }}
              onNavigateToIntegrated={() => switchMode("integrated")}
            />
          </div>
        )}

        {(visitedModes.ftir || serviceMode === "ftir") && (
          <div className={serviceMode === "ftir" ? "block" : "hidden"}>
            <SpectroView
              initialInstrument="ftir"
              lockedInstrument="ftir"
              activeSample={activeProject}
              onRecordSaved={async () => {
                if (activeProject) {
                  const p = await api.getProject(activeProject.id);
                  setActiveProject(p);
                }
                refreshProjectsList();
              }}
            />
          </div>
        )}

        {(visitedModes.dsc || serviceMode === "dsc") && (
          <div className={serviceMode === "dsc" ? "block" : "hidden"}>
            <SpectroView
              initialInstrument="dsc"
              lockedInstrument="dsc"
              activeSample={activeProject}
              onRecordSaved={async () => {
                if (activeProject) {
                  const p = await api.getProject(activeProject.id);
                  setActiveProject(p);
                }
                refreshProjectsList();
              }}
            />
          </div>
        )}

        {(visitedModes.tga || serviceMode === "tga") && (
          <div className={serviceMode === "tga" ? "block" : "hidden"}>
            <SpectroView
              initialInstrument="tga"
              lockedInstrument="tga"
              activeSample={activeProject}
              onRecordSaved={async () => {
                if (activeProject) {
                  const p = await api.getProject(activeProject.id);
                  setActiveProject(p);
                }
                refreshProjectsList();
              }}
            />
          </div>
        )}

        {/* Active View Render */}
        {serviceMode === "home" ? (
          <HomeDashboard
            health={health}
            projects={projects}
            projectsLoading={projectsLoading}
            projectsError={projectsError}
            isBusy={isBusy || isJobRunning}
            onRefreshProjects={refreshProjectsList}
            onOpenProject={(pid, targetMode) =>
              openProject(pid, null, targetMode || "xrd", false)
            }
            onDeleteProject={handleDeleteProject}
            onNavigateMode={(nextMode) => switchMode(nextMode)}
            onLoadSample={handleLoadSample}
            onOpenRegisterModal={() => {
              setEditingSampleTarget(null);
              setSampleModalOpen(true);
            }}
            onOpenEditSampleModal={(sample) => {
              setEditingSampleTarget(sample);
              setSampleModalOpen(true);
            }}
          />
        ) : serviceMode === "xrd" || serviceMode === "matlens" ? (
          <XrdWorkspace
            health={health}
            activeProject={activeProject}
            activeRun={activeRun}
            xrdParams={xrdParams}
            runAi={runAi}
            isBusy={isBusy}
            isJobRunning={isJobRunning}
            onChangeXrdParams={setXrdParams}
            onChangeRunAi={setRunAi}
            onUpdateProjectMeta={handleUpdateProjectMeta}
            onUploadMultipleFiles={handleUploadMultipleFiles}
            onUploadFromDesktop={handleUploadFromDesktop}
            onDeleteFile={handleDeleteFile}
            onStartXrdRun={(selectedXrdFileId) =>
              handleStartRunWithSelection(selectedXrdFileId, null)
            }
            onSelectRun={handleSelectSavedRun}
            onLoadSample={handleLoadSample}
            onOpenRegisterModal={() => {
              setEditingSampleTarget(null);
              setSampleModalOpen(true);
            }}
            onNavigateToSem={() => switchMode("sem")}
            onNavigateToIntegrated={() => switchMode("integrated")}
          />
        ) : serviceMode === "sem" ? (
          <SemWorkspace
            activeProject={activeProject}
            activeRun={activeRun}
            semParams={semParams}
            runAi={runAi}
            isBusy={isBusy}
            isJobRunning={isJobRunning}
            onChangeSemParams={setSemParams}
            onChangeRunAi={setRunAi}
            onUploadMultipleFiles={handleUploadMultipleFiles}
            onUploadFromDesktop={handleUploadFromDesktop}
            onDeleteFile={handleDeleteFile}
            onStartSemRun={(selectedSemFileId, overrideParams) =>
              handleStartRunWithSelection(null, selectedSemFileId, overrideParams)
            }
            onSelectRun={handleSelectSavedRun}
            onLoadSample={handleLoadSample}
            onOpenRegisterModal={() => {
              setEditingSampleTarget(null);
              setSampleModalOpen(true);
            }}
            onNavigateToXrd={() => switchMode("xrd")}
            onNavigateToIntegrated={() => switchMode("integrated")}
          />
        ) : serviceMode === "integrated" ? (
          <IntegratedAnalysisView
            activeProject={activeProject}
            activeRun={activeRun}
            onNavigateMode={switchMode}
          />
        ) : null}
      </main>

      {/* Global Sample Registration & Edit Modal */}
      <SampleRegistrationModal
        open={sampleModalOpen}
        initialSample={editingSampleTarget}
        isBusy={isBusy}
        onClose={() => {
          setSampleModalOpen(false);
          setEditingSampleTarget(null);
        }}
        onSubmit={handleSampleModalSubmit}
      />
    </div>
  );
}
