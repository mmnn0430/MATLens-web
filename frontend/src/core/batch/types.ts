/**
 * Universal Batch Architecture Types
 * Flexible & Extensible for UTM, XRD, SEM, DSC, TGA, LFA, FTIR, and Generic Instruments.
 */

export type InstrumentType =
  | "UTM"
  | "XRD"
  | "SEM"
  | "GENERIC"
  | "DSC"
  | "TGA"
  | "LFA"
  | "FTIR";

export type BatchFileStatus = "pending" | "parsing" | "analyzing" | "success" | "error";

export interface UniversalDataset<TRaw = any, TResult = any> {
  id: string;
  file?: File;
  fileName: string;
  fileSize: number;
  sampleName: string;            // e.g. "ABS100", "TiO2-series", "Silicon-SRM"
  specimenOrCondition: string;   // e.g. "#1", "500°C", "FOV-Center", "FOV-Edge"
  color: string;                 // Hex color for chart visualization
  visible: boolean;              // Toggle visibility on plots
  status: BatchFileStatus;
  progress?: number;             // 0-100%
  rawData?: TRaw;
  analysisResult?: TResult;
  errorMessage?: string;
  instrumentType: InstrumentType;
  metadata?: Record<string, any>;
  createdAt: number;
}

export interface InstrumentAdapter<TRaw = any, TResult = any, TOptions = any> {
  instrumentType: InstrumentType;
  displayName: string;
  category: "Mechanical" | "Diffraction" | "Microscopy" | "Thermal" | "Spectroscopy" | "Generic";
  acceptedExtensions: string[];
  mimeAccept?: string;
  description: string;
  parseData: (file: File, options?: TOptions) => Promise<TRaw>;
  analyzeData: (raw: TRaw, options?: TOptions, file?: File) => Promise<TResult>;
  extractMetadata?: (
    fileName: string,
    raw?: TRaw
  ) => { sampleName: string; specimenOrCondition: string; metadata?: Record<string, any> };
  createSampleDatasets?: () => Promise<UniversalDataset<TRaw, TResult>[]>;
}

// ----------------------------------------------------------------------
// Specific Result Types for XRD Batch Comparison
// ----------------------------------------------------------------------
export interface XrdSpectrumSeries {
  twoTheta: number[];
  intensity: number[];
  normalizedIntensity: number[]; // 0 ~ 100%
  background?: number[];
}

export interface XrdPeakInfo {
  peakId: string;
  twoTheta: number;
  fwhm: number;
  height: number;
  area: number;
  crystalliteSizeNm: number; // Scherrer formula
  phaseName?: string;
  hkl?: string;
}

export interface XrdPhaseFraction {
  phaseName: string;
  formula: string;
  fractionPct: number; // 0 ~ 100%
  color?: string;
}

export interface XrdBatchAnalysisResult {
  series: XrdSpectrumSeries;
  peaks: XrdPeakInfo[];
  phases: XrdPhaseFraction[];
  crystallinityPct?: number;
  meanCrystalliteSizeNm?: number;
  latticeConstantA?: number;
  latticeConstantC?: number;
}

// ----------------------------------------------------------------------
// Specific Result Types for UTM Batch Comparison
// ----------------------------------------------------------------------
export interface UtmPoint {
  strainPct: number;
  stressMpa: number;
  timeSec?: number;
  loadN?: number;
  dispMm?: number;
}

export interface UtmBatchAnalysisResult {
  curves: {
    strainPct: number[];
    stressMpa: number[];
    dispMm?: number[];
    loadN?: number[];
  };
  metrics: {
    utsMpa: number;              // Ultimate Tensile Strength
    yieldStrengthMpa: number;    // 0.2% Offset Yield Strength
    elasticModulusGpa: number;   // Young's Modulus E
    elongationPct: number;       // Elongation at break
    toughnessMjM3?: number;      // Area under curve
  };
}

// ----------------------------------------------------------------------
// Specific Result Types for SEM Batch Comparison
// ----------------------------------------------------------------------
export interface SemParticleObject {
  id: number;
  equivalentDiameter: number;   // in unit (nm or um)
  area: number;
  circularity: number;
  aspectRatio: number;
  majorAxis: number;
  minorAxis: number;
}

export interface SemBatchAnalysisResult {
  imageUrl: string;
  overlayUrl?: string | null;
  roiUrl?: string | null;
  scale: {
    pxPerUnit: number;
    unit: "nm" | "µm" | "mm" | "px";
    realValue: number;
    lengthPx: number;
    isConfirmed: boolean;
  };
  stats: {
    d10: number;
    d50: number; // Median
    d90: number;
    meanDiameter: number;
    stdDev: number;
    count: number;
    meanCircularity: number;
  };
  histogram: {
    binCenters: number[];
    counts: number[];
    widths: number[];
    unit: string;
  };
  objects: SemParticleObject[];
}
