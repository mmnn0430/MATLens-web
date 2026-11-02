export interface CrystallinityConfig {
  enabled: boolean;
  sample_family: string;
  background_model: string;
  separation_method: string;
  two_theta_min: number;
  two_theta_max: number;
}

export interface XRDParams {
  col_two_theta: number | string | null;
  col_intensity: number | string | null;
  xray_source: string;
  wavelength_angstrom: number;
  wavelength_confirmed: boolean;
  two_theta_min: number | null;
  two_theta_max: number | null;
  als_lam: number;
  als_p: number;
  use_smoothing: boolean;
  smooth_window: number;
  smooth_polyorder: number;
  prominence_rel: number;
  min_rel_height: number;
  min_distance_deg: number;
  fit_profile: "pseudo_voigt" | "gaussian" | "lorentzian";
  excluded_peak_ids: string[];
  match_tol_deg: number;
  max_shift_deg: number;
  use_element_filter: boolean;
  max_e_hull_ev: number;
  use_mp_live: boolean;
  enable_multiphase: boolean;
  scherrer_k: number;
  inst_fwhm_deg: number | null;
  enable_williamson_hall: boolean;
  crystallinity: CrystallinityConfig;
}

export interface ROIRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface SEMParams {
  mode: "particle" | "grain";
  roi: ROIRect | null;
  scale_confirmed: boolean;
  scale_x0: number | null;
  scale_y0: number | null;
  scale_x1: number | null;
  scale_y1: number | null;
  scale_length_px: number | null;
  scale_real_value: number | null;
  scale_unit: "nm" | "µm" | "mm";
  clahe_clip: number;
  gaussian_blur: number;
  invert_polarity: boolean;
  threshold_mode: "otsu" | "manual";
  manual_threshold: number;
  min_size_px: number;
  split_sensitivity: number;
  exclude_border: boolean;
  excluded_object_ids: number[];
  segmentation_confirmed: boolean;
  grain_boundary_confirmed: boolean;
  grain_block_size: number;
  grain_offset: number;
  n_test_lines: number;
  added_intersections: Point2D[];
  removed_intersection_ids: string[];
}

export interface ProjectFileInfo {
  id: string;
  file_role: "xrd" | "sem" | "cif";
  original_filename: string;
  sha256: string;
  size_bytes: number;
  is_sample: boolean;
  inspection: any;
  created_at: string;
}

export interface RunBrief {
  id: string;
  run_number: number;
  status: "queued" | "running" | "completed" | "failed";
  progress_pct: number;
  stage_message: string;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface ProjectDetail {
  id: string;
  sample_name: string;
  description: string;
  expected_elements: string[];
  expected_formula: string;
  is_same_sample: boolean;
  is_sample_demo: boolean;
  current_conditions: {
    xrd_params?: Partial<XRDParams>;
    sem_params?: Partial<SEMParams>;
  };
  files: ProjectFileInfo[];
  runs: RunBrief[];
  latest_run_id: string | null;
  has_outdated_ai: boolean;
  edit_history: Array<{ id: string; action_type: string; summary: string; created_at: string }>;
  created_at: string;
  updated_at: string;
}

export interface ProjectListItem {
  id: string;
  sample_name: string;
  description: string;
  expected_formula: string;
  expected_elements: string[];
  is_same_sample: boolean;
  is_sample_demo: boolean;
  file_roles: string[];
  run_count: number;
  updated_at: string;
}

export interface RunDetail {
  id: string;
  project_id: string;
  run_number: number;
  status: "queued" | "running" | "completed" | "failed";
  progress_pct: number;
  stage_message: string;
  params: {
    xrd_params: XRDParams;
    sem_params: SEMParams;
    run_ai_interpretation: boolean;
  };
  file_hashes: Record<string, string>;
  ref_library_version: string;
  algo_versions: Record<string, string>;
  xrd_result: any | null;
  sem_result: any | null;
  rule_summary: any | null;
  has_overlay: boolean;
  has_roi_image: boolean;
  ai_report: any | null;
  previous_outdated_ai_report: any | null;
  is_ai_outdated: boolean;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface DesktopFileInfo {
  filename: string;
  role: "xrd" | "sem" | "cif";
  ext: string;
  size_bytes: number;
}

export interface GeminiModelOption {
  id: string;
  label: string;
}

export interface HealthInfo {
  status: string;
  gemini_api_configured: boolean;
  gemini_model: string;
  gemini_models?: GeminiModelOption[];
  mp_api_configured?: boolean;
  xray_presets: Record<string, number>;
  ref_library_version: string;
  ref_phase_count: number;
  max_upload_mb: number;
  max_image_pixels: number;
  versions: Record<string, string>;
}

// ==========================================
// UTM Raw Data Types
// ==========================================
export interface UTMParsedData {
  filename: string;
  encoding: string;
  headers: string[];
  units: string[];
  col_mapping: Record<string, string>;
  row_count: number;
  rows: Record<string, number>[];
  preview_rows: Record<string, number>[];
  skipped_rows: { line: number; reason: string; content: string }[];
}

export interface UTMPeakStress {
  index: number;
  serial_number: number;
  stress_raw: number;
  stress_raw_unit: string;
  stress_MPa: number;
  strain_pct: number | null;
  time_sec: number | null;
  displacement_mm: number | null;
  source: string;
}

export interface UTMPeakLoad {
  index: number;
  serial_number: number;
  load_raw: number;
  load_raw_unit: string;
  load_N: number | null;
  time_sec: number | null;
}

export interface UTMEtlasticModulus {
  strain_start_pct: number;
  strain_end_pct: number;
  point_count: number;
  unique_strain_count: number;
  slope_MPa?: number;
  E_GPa?: number;
  intercept_MPa?: number;
  r_squared?: number;
  is_valid: boolean;
  reason?: string;
}

export interface UTMOffsetYield {
  yield_stress_MPa?: number;
  yield_strain_pct?: number;
  index?: number;
  serial_number?: number;
  method?: string;
  is_valid: boolean;
  reason?: string;
}

export interface UTMCurves {
  index: number[];
  time: number[];
  load_raw: number[];
  load_N: number[];
  disp_raw: number[];
  stress_raw: number[];
  stress_MPa: number[];
  strain_pct: number[];
  true_stress_raw: (number | null)[];
  true_strain_raw: (number | null)[];
}

export interface UTMAnalysisResult {
  analysis_range: {
    start_idx: number;
    end_idx: number;
    count: number;
    total_count: number;
  };
  peak_stress: UTMPeakStress | null;
  peak_load: UTMPeakLoad | null;
  elastic_modulus: UTMEtlasticModulus | null;
  offset_yield: UTMOffsetYield | null;
  fracture_candidate: {
    candidate_index: number;
    serial_number: number;
    stress_MPa: number;
    strain_pct: number | null;
    note: string;
  } | null;
  negative_load_summary: {
    count: number;
    first_serial: number | null;
    last_serial: number | null;
  };
  summary_text: string;
  curves: UTMCurves;
}

