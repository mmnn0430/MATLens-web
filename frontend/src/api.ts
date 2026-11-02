import { downloadFile } from "./download";
import type {
  DesktopFileInfo,
  HealthInfo,
  ProjectDetail,
  ProjectListItem,
  RunDetail,
  SEMParams,
  XRDParams,
} from "./types";

export const DEFAULT_XRD_PARAMS: XRDParams = {
  col_two_theta: null,
  col_intensity: null,
  xray_source: "Cu Kα (1.5406 Å)",
  wavelength_angstrom: 1.5406,
  wavelength_confirmed: true,
  two_theta_min: null,
  two_theta_max: null,
  als_lam: 100000,
  als_p: 0.01,
  use_smoothing: true,
  smooth_window: 9,
  smooth_polyorder: 3,
  prominence_rel: 0.025,
  min_rel_height: 0.02,
  min_distance_deg: 0.14,
  fit_profile: "pseudo_voigt",
  excluded_peak_ids: [],
  match_tol_deg: 0.22,
  max_shift_deg: 0.15,
  use_element_filter: true,
  max_e_hull_ev: 0.15,
  use_mp_live: true,
  enable_multiphase: true,
  scherrer_k: 0.9,
  inst_fwhm_deg: null,
  enable_williamson_hall: true,
  crystallinity: {
    enabled: false,
    sample_family: "",
    background_model: "als_envelope",
    separation_method: "crystalline_peak_area_over_total_coherent_scatter",
    two_theta_min: 10,
    two_theta_max: 70,
  },
};

export const DEFAULT_SEM_PARAMS: SEMParams = {
  mode: "particle",
  roi: null,
  scale_confirmed: false,
  scale_x0: null,
  scale_y0: null,
  scale_x1: null,
  scale_y1: null,
  scale_length_px: null,
  scale_real_value: null,
  scale_unit: "µm",
  clahe_clip: 2.0,
  gaussian_blur: 3,
  invert_polarity: false,
  threshold_mode: "otsu",
  manual_threshold: 128,
  min_size_px: 25,
  split_sensitivity: 0.55,
  exclude_border: true,
  excluded_object_ids: [],
  segmentation_confirmed: false,
  grain_boundary_confirmed: false,
  grain_block_size: 41,
  grain_offset: 4.0,
  n_test_lines: 6,
  added_intersections: [],
  removed_intersection_ids: [],
};

async function handleJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `요청 처리에 실패했습니다 (HTTP ${res.status})`;
    try {
      const body = await res.json();
      if (body?.detail) {
        msg = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
      }
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getHealth: () => fetch("/api/health").then((r) => handleJson<HealthInfo>(r)),

  listProjects: () => fetch("/api/projects").then((r) => handleJson<ProjectListItem[]>(r)),

  createProject: (payload: {
    sample_name: string;
    description: string;
    expected_elements: string[];
    expected_formula: string;
    is_same_sample: boolean;
  }) =>
    fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => handleJson<ProjectDetail>(r)),

  createSampleDemo: (preset: "tio2_powder" | "sintered_grains" | "desktop_nbfesb") =>
    fetch(`/api/projects/sample-demo?preset=${encodeURIComponent(preset)}`, {
      method: "POST",
    }).then((r) => handleJson<ProjectDetail>(r)),

  listDesktopFiles: () =>
    fetch("/api/desktop-files").then((r) =>
      handleJson<{ desktop_path: string; files: DesktopFileInfo[] }>(r)
    ),

  uploadFromDesktop: (projectId: string, role: "xrd" | "sem" | "cif", filename: string) =>
    fetch(
      `/api/projects/${projectId}/files/${role}/from-desktop?filename=${encodeURIComponent(filename)}`,
      { method: "POST" }
    ).then((r) => handleJson<ProjectDetail>(r)),

  getProject: (projectId: string) =>
    fetch(`/api/projects/${projectId}`).then((r) => handleJson<ProjectDetail>(r)),

  updateProject: (projectId: string, payload: Record<string, any>) =>
    fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => handleJson<ProjectDetail>(r)),

  deleteProject: (projectId: string) =>
    fetch(`/api/projects/${projectId}`, { method: "DELETE" }).then((r) =>
      handleJson<{ deleted: boolean; project_id: string }>(r)
    ),

  uploadFile: (projectId: string, role: "xrd" | "sem" | "cif", file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch(`/api/projects/${projectId}/files/${role}`, {
      method: "POST",
      body: fd,
    }).then((r) => handleJson<ProjectDetail>(r));
  },

  getAiScope: (projectId: string) =>
    fetch(`/api/projects/${projectId}/ai-scope`).then((r) => handleJson<any>(r)),

  startRun: (
    projectId: string,
    payload: {
      xrd_params: XRDParams;
      sem_params: SEMParams;
      run_ai_interpretation: boolean;
    }
  ) =>
    fetch(`/api/projects/${projectId}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => handleJson<{ run_id: string; run_number: number; status: string }>(r)),

  getRun: (runId: string) => fetch(`/api/runs/${runId}`).then((r) => handleJson<RunDetail>(r)),

  retryAi: (runId: string, model?: string) => {
    const qs = model ? `?model=${encodeURIComponent(model)}` : "";
    return fetch(`/api/runs/${runId}/ai-retry${qs}`, { method: "POST" }).then((r) =>
      handleJson<RunDetail>(r)
    );
  },

  getAiConfig: () =>
    fetch("/api/ai-config").then((r) =>
      handleJson<{
        gemini_api_configured: boolean;
        gemini_model: string;
        gemini_models: Array<{ id: string; label: string }>;
        mp_api_configured: boolean;
      }>(r)
    ),

  saveAiConfig: (payload: {
    gemini_api_key?: string;
    gemini_model?: string;
    mp_api_key?: string;
  }) =>
    fetch("/api/ai-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) =>
      handleJson<{
        gemini_api_configured: boolean;
        gemini_model: string;
        gemini_models: Array<{ id: string; label: string }>;
        mp_api_configured: boolean;
      }>(r)
    ),

  rawFileUrl: (projectId: string, fileId: string) => `/api/projects/${projectId}/files/${fileId}/raw`,
  overlayUrl: (runId: string) => `/api/runs/${runId}/overlay.png`,
  roiUrl: (runId: string) => `/api/runs/${runId}/roi.png`,
  downloadPdfUrl: (runId: string) => `/api/runs/${runId}/download/pdf`,
  downloadXrdChartPngUrl: (runId: string, candidateId?: string) =>
    `/api/runs/${runId}/download/xrd-chart.png${candidateId ? `?candidate_id=${encodeURIComponent(candidateId)}` : ""}`,
  downloadXrdCsvUrl: (runId: string) => `/api/runs/${runId}/download/xrd-peaks.csv`,
  downloadSemCsvUrl: (runId: string) => `/api/runs/${runId}/download/sem-objects.csv`,
  downloadJsonUrl: (runId: string) => `/api/runs/${runId}/download/result.json`,
  downloadOverlayUrl: (runId: string) => `/api/runs/${runId}/download/overlay.png`,

  // UTM Raw Data Endpoints
  parseUtm: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/utm/parse", { method: "POST", body: fd });
    return handleJson<any>(r);
  },

  analyzeUtm: async (payload: {
    parsed_data: any;
    start_index?: number;
    end_index?: number;
    specimen_area_A0?: number;
    specimen_gauge_L0?: number;
    elastic_start_strain_pct?: number;
    elastic_end_strain_pct?: number;
    calc_offset_yield?: boolean;
    analysis_name?: string;
    notes?: string;
  }) => {
    const r = await fetch("/api/utm/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return handleJson<any>(r);
  },

  downloadUtmChart: (payload: any) => downloadFile("/api/utm/download/chart", "utm_analysis_charts.png", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }),

  downloadUtmCsv: (payload: any) => downloadFile("/api/utm/download/csv", "utm_converted_data.csv", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }),

  downloadUtmJson: (payload: any) => downloadFile("/api/utm/download/json", "utm_analysis_result.json", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }),

  downloadUtmPdf: (payload: any) => downloadFile("/api/utm/download/pdf", "utm_analysis_report.pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }),
};
