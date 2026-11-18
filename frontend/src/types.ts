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

export interface RunXrdSummary {
  source_file_id?: string | null;
  source_filename?: string | null;
  peak_count?: number;
  primary_phase?: string | null;
  primary_formula?: string | null;
  scherrer_mean_nm?: number | null;
}

export interface RunSemSummary {
  source_file_id?: string | null;
  source_filename?: string | null;
  fov_label?: string | null;
  mode?: "particle" | "grain";
  unit?: string;
  scale_confirmed?: boolean;
  count?: number | null;
  mean_size?: number | null;
  d10?: number | null;
  d50?: number | null;
  d90?: number | null;
  porosity_pct?: number | null;
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
  xrd_file_id?: string | null;
  sem_file_id?: string | null;
  xrd_summary?: RunXrdSummary | null;
  sem_summary?: RunSemSummary | null;
}

export interface ProjectDetail {
  id: string;
  sample_name: string;
  description: string;
  expected_elements: string[];
  expected_formula: string;
  is_same_sample: boolean;
  is_sample_demo: boolean;
  sample_code?: string;
  processing_method?: string;
  experiment_memo?: string;
  instrument_counts?: Record<string, number>;
  experiment_meta?: ExperimentMeta;
  current_conditions: {
    xrd_params?: Partial<XRDParams>;
    sem_params?: Partial<SEMParams>;
    xrd_params_by_file?: Record<string, Partial<XRDParams>>;
    sem_params_by_file?: Record<string, Partial<SEMParams>>;
    sample_meta?: {
      sample_code?: string;
      processing_method?: string;
      experiment_memo?: string;
    };
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
  sample_code?: string;
  processing_method?: string;
  experiment_memo?: string;
  instrument_counts?: Record<string, number>;
  experiment_meta?: ExperimentMeta;
  file_roles: string[];
  run_count: number;
  updated_at: string;
}

export interface XrdSeriesCurveItem {
  file_id: string;
  filename: string;
  created_at: string;
  order_index: number;
  two_theta: number[];
  intensity_raw: number[];
  intensity_norm: number[];
  latest_run_id: string | null;
  peak_count: number;
  peaks: any[];
  primary_phase: string | null;
  primary_formula: string | null;
  scherrer_mean_nm: number | null;
}

export interface SampleInstrumentRecord {
  id: string;
  sample_id: string;
  instrument_type: string;
  original_filename: string;
  metadata: Record<string, any>;
  raw_payload: Record<string, any>;
  created_at: string;
  analyses: Array<{
    id: string;
    sample_id: string;
    measurement_id: string;
    analysis_type: string;
    parameters: Record<string, any>;
    results: Record<string, any>;
    summary_text: string;
    created_at: string;
  }>;
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


// ==========================================
// MatLens 2.0: Hall, LFA, RAG & Integrated
// ==========================================
export interface HallAnalysisResult {
  slope_dV_dB: number;
  r_squared: number;
  hall_coefficient_m3_C: number;
  hall_coefficient_cm3_C: number;
  carrier_type: string;
  carrier_concentration_cm3: number;
  carrier_concentration_m3: number;
  sheet_carrier_density_cm2: number;
  hall_mobility_cm2_Vs: number | null;
  electrical_conductivity_S_cm: number | null;
  resistivity_Ohm_cm: number | null;
  sheet_resistance_Ohm_sq: number | null;
  uncertainty_carrier_pct: number;
  uncertainty_mobility_pct: number;
  raw_b_field: number[];
  raw_v_hall: number[];
  antisym_b_field: number[];
  antisym_v_hall: number[];
  fitted_v_hall: number[];
  longitudinal_offset_mV: number;
  offset_ratio_pct: number;
  warnings: string[];
  notes: string[];
}

export interface LfaAnalysisResult {
  half_rise_time_s: number;
  thermal_diffusivity_mm2_s: number;
  thermal_diffusivity_m2_s: number;
  thickness_mm: number;
  baseline_temp_C: number;
  max_temp_rise_C: number;
  thermal_conductivity_W_mK: number | null;
  density_g_cm3: number | null;
  specific_heat_J_gK: number | null;
  is_literature_density: boolean;
  is_literature_cp: boolean;
  missing_inputs: string[];
  time_series_s: number[];
  temp_series_C: number[];
  fitted_time_s: number[];
  fitted_temp_C: number[];
  heat_loss_ratio: number;
  uncertainty_diffusivity_pct: number;
  uncertainty_conductivity_pct: number;
  warnings: string[];
  notes: string[];
}

export interface LiteratureReference {
  id: string;
  doi: string;
  title: string;
  authors: string[];
  journal: string;
  year: number;
  is_open_access?: boolean;
  oa_url?: string;
  relevance_score?: number;
  category_code?: number;
  category_label?: string;
  evidence_location?: string;
  key_claims?: string[];
  is_verified_doi?: boolean;
}

export interface GroundedClaim {
  claim_text: string;
  category: "Measured Fact" | "Calculated Result" | "Literature-Supported" | "Hypothesis" | "Insufficient Evidence";
  source_id?: string;
  doi?: string;
  evidence_location?: string;
  confidence: "High" | "Moderate" | "Low";
  limitation_note?: string;
}

export interface GroundingData {
  pipeline_status: string;
  pipeline_log: { step: number; name: string; status: string; details: any }[];
  verified_references: LiteratureReference[];
  grounded_claims: GroundedClaim[];
  top_benchmark_paper?: LiteratureReference;
}

export interface ScientificInterpretation {
  analysis_summary: string;
  input_data_summary: string;
  data_quality_assessment: string;
  calculated_properties: string;
  graph_interpretation: string;
  composition_processing_interpretation: string;
  literature_comparison: string;
  mechanism_discussion: string;
  alternative_explanations: string;
  limitations_and_uncertainty: string;
  suggested_additional_experiments: string[];
  references: { id: string; doi: string; title: string; verified: boolean }[];
  ai_engine?: string;
}

export interface WiedemannFranzResult {
  temperature_K: number;
  lorenz_number_W_Ohm_K2: number;
  is_sommerfeld_limit: boolean;
  total_thermal_conductivity_W_mK: number;
  electronic_thermal_conductivity_W_mK: number;
  lattice_thermal_conductivity_W_mK: number;
  electronic_fraction_pct: number;
  lattice_fraction_pct: number;
  dominant_mechanism: string;
  warnings: string[];
}

export interface IntegratedAnalysisResult {
  sample_id: string;
  material_name: string;
  instruments_included: string[];
  wiedemann_franz: WiedemannFranzResult | null;
  xrd_sem_correlation: any | null;
  sem_hall_correlation: any | null;
  sem_lfa_correlation: any | null;
  xrd_hall_correlation: any | null;
  xrd_utm_correlation?: any | null;
  synthesis_to_properties_chain: { stage: string; description: string; data_source: string }[];
  grounded_claims: GroundedClaim[];
  warnings: string[];
  notes: string[];
  executive_summary_items?: Array<{ type: "finding" | "caution"; badge: string; text: string }>;
  linkage_assessment?: {
    linkage_mode: "same_specimen" | "connected_series" | "unverified_mismatch";
    linkage_badge: string;
    linkage_summary: string;
    sample_count_n: number;
    is_single_sample: boolean;
    criteria_checked: string[];
    mismatches: string[];
    sources: Array<{
      instrument: string;
      sample_id: string;
      composition: string;
      process_condition: string;
      temperature_K: number;
      is_sample_demo: boolean;
      source_file: string;
    }>;
  };
  instrument_availability?: Array<{
    instrument: string;
    label: string;
    available: boolean;
    status_badge: string;
    data_source_badge: string;
    summary: string;
    missing_impact: string | null;
  }>;
  key_metrics_table?: Array<{
    instrument: string;
    metric_name: string;
    value: string;
    unit: string;
    condition: string;
    category: "측정 사실" | "계산 결과";
    source_label: string;
    term_explanation: string;
  }>;
  cross_correlations?: Array<{
    id: string;
    title: string;
    instruments: string[];
    basis_condition: string;
    measured_facts: string[];
    calculated_results: string[];
    interpretation_hypotheses: string[];
    caution_note: string;
  }>;
  limitations_and_next_actions?: {
    cannot_determine_now: string[];
    recommended_next_steps: string[];
  };
}

export type ComparisonQuestionType = "auto" | "process_variation" | "dopant_type" | "dopant_amount";

export interface ExperimentMeta {
  base_matrix: string;
  nominal_composition: string;
  dopant_element: string;
  dopant_amount: number | null;
  dopant_unit: string;
  process_temp_c: number | null;
  process_time_h: number | null;
  atmosphere: string;
  process_method: string;
  replicate_id: string;
  is_synthetic_demo?: boolean;
  explicitly_saved?: boolean;
  missing_fields?: string[];
}

