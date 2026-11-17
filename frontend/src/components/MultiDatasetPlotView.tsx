import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Upload,
  Layers,
  BarChart2,
  GitCompare,
  Sliders,
  Settings,
  Download,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Eye,
  EyeOff,
  RefreshCw,
  Sparkles,
  Tag,
  Microscope,
  Info,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Image as ImageIcon,
  ArrowRight,
  Maximize2,
  X,
  SlidersHorizontal,
} from "lucide-react";
import { api } from "../api";
import type { PlotDataset, PlotAnnotation, PeakDifferenceRow, XrdSemLinkedResult } from "../types";
import { PlotlyChart } from "./PlotlyChart";
import { Button, Card, SourceTag } from "./ui/primitives";

interface MultiDatasetPlotViewProps {
  initialDatasets?: PlotDataset[];
  onImportCurrentRun?: () => void;
  hasActiveRun?: boolean;
}

type PlotMode = "stacked" | "overlay" | "subplot" | "peak_comparison";
type NormalizationMode = "none" | "maximum" | "area" | "user";

const PALETTE = [
  "#2563EB", // Blue
  "#DC2626", // Red
  "#059669", // Green
  "#D97706", // Amber
  "#7C3AED", // Purple
  "#DB2777", // Pink
  "#0891B2", // Cyan
  "#475569", // Slate
];

export function MultiDatasetPlotView({
  initialDatasets = [],
  onImportCurrentRun,
  hasActiveRun = false,
}: MultiDatasetPlotViewProps) {
  // Datasets state
  const [datasets, setDatasets] = useState<PlotDataset[]>(initialDatasets);
  const [activePlotMode, setActivePlotMode] = useState<PlotMode>("stacked");
  const [selectedInstrument, setSelectedInstrument] = useState<string>("XRD");
  const [globalNormalization, setGlobalNormalization] = useState<NormalizationMode>("maximum");
  const [userScale, setUserScale] = useState<number>(1.0);
  const [autoOffset, setAutoOffset] = useState<boolean>(true);
  const [globalOffsetStep, setGlobalOffsetStep] = useState<number>(1.15);

  // Preprocessing toggles
  const [useBackgroundSub, setUseBackgroundSub] = useState<boolean>(false);
  const [useSmoothing, setUseSmoothing] = useState<boolean>(false);
  const [smoothWindow, setSmoothWindow] = useState<number>(11);

  // Graph Properties
  const [plotTitle, setPlotTitle] = useState<string>("XRD Pattern Comparison (Stacked)");
  const [xAxisLabel, setXAxisLabel] = useState<string>("2θ");
  const [xAxisUnit, setXAxisUnit] = useState<string>("degree");
  const [yAxisLabel, setYAxisLabel] = useState<string>("Normalized Intensity");
  const [yAxisUnit, setYAxisUnit] = useState<string>("a.u.");
  const [fontSize, setFontSize] = useState<number>(12);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [legendLocation, setLegendLocation] = useState<string>("upper right");
  const [customXMin, setCustomXMin] = useState<string>("");
  const [customXMax, setCustomXMax] = useState<string>("");

  // Annotations
  const [annotations, setAnnotations] = useState<PlotAnnotation[]>([
    {
      id: "ann_002",
      type: "miller_index",
      x: 25.4,
      y: 1.05,
      hkl: "002",
      text: "(002)",
      verification_status: "Verified (COD)",
    },
    {
      id: "ann_100",
      type: "miller_index",
      x: 43.8,
      y: 0.35,
      hkl: "100",
      text: "(100)",
      verification_status: "Candidate (89% Match)",
    },
  ]);

  // UI Drawers & Panels
  const [showEditorDrawer, setShowEditorDrawer] = useState<boolean>(false);
  const [showAnnotationModal, setShowAnnotationModal] = useState<boolean>(false);
  const [showDigitizeModal, setShowDigitizeModal] = useState<boolean>(false);
  const [showPresetsDropdown, setShowPresetsDropdown] = useState<boolean>(false);
  const [rightPanelTab, setRightPanelTab] = useState<"peaks" | "summary" | "sem" | "quality">("peaks");

  // Mode D Peak Comparison states
  const [referenceDatasetId, setReferenceDatasetId] = useState<string>("");
  const [toleranceDeg, setToleranceDeg] = useState<number>(0.35);
  const [peakDiffRows, setPeakDiffRows] = useState<PeakDifferenceRow[]>([]);
  const [manualMatchOverride, setManualMatchOverride] = useState<Record<string, { ref: number; sample: number }>>({});

  // XRD-SEM Link State
  const [selectedSemSampleId, setSelectedSemSampleId] = useState<string>("AC850");
  const [semLinkedData, setSemLinkedData] = useState<XrdSemLinkedResult | null>(null);
  const [isLoadingSem, setIsLoadingSem] = useState<boolean>(false);

  // General loading & error
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const digitizeInputRef = useRef<HTMLInputElement | null>(null);

  // Load initial presets if empty
  useEffect(() => {
    if (datasets.length === 0) {
      loadPresetSeries("AC Series");
    }
  }, []);

  // Update default reference sample when datasets change
  useEffect(() => {
    if (datasets.length > 0 && (!referenceDatasetId || !datasets.some((d) => d.id === referenceDatasetId))) {
      setReferenceDatasetId(datasets[0].id);
    }
  }, [datasets, referenceDatasetId]);

  // Load SEM Linked Data when selected sample changes
  useEffect(() => {
    if (!selectedSemSampleId) return;
    setIsLoadingSem(true);
    api
      .getSampleSemLink(selectedSemSampleId)
      .then((res) => setSemLinkedData(res))
      .catch(() => setSemLinkedData(null))
      .finally(() => setIsLoadingSem(false));
  }, [selectedSemSampleId]);

  // -------------------------------------------------------------------------
  // Preset loader
  // -------------------------------------------------------------------------
  const loadPresetSeries = async (categoryName?: string) => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.getPlotPresets();
      const presets = res.presets || [];
      if (presets.length === 0) return;

      // Find selected or default to first category (AC Series)
      const targetCat = presets.find((p) => p.category.includes(categoryName || "AC")) || presets[0];
      const newDsList: PlotDataset[] = targetCat.items.map((item: any, idx: number) => ({
        id: `ds_${item.sample_id}_${Date.now()}_${idx}`,
        sample_id: item.sample_id,
        sample_name: item.name,
        measurement_type: item.measurement_type,
        x_unit: item.x_unit,
        y_unit: item.y_unit,
        source_type: "raw_file",
        source_filename: item.file,
        color: item.color || PALETTE[idx % PALETTE.length],
        offset: idx * 1.15,
        visible: true,
        line_width: 1.8,
        line_style: "solid",
        x: item.x,
        y: item.y,
        peaks: item.peaks || [],
        data_quality: item.data_quality,
      }));

      setDatasets(newDsList);
      setSelectedInstrument(targetCat.instrument);
      setPlotTitle(`${targetCat.category}`);
      if (newDsList.length > 0) {
        setReferenceDatasetId(newDsList[0].id);
        setSelectedSemSampleId(newDsList[newDsList.length > 1 ? 1 : 0].sample_id);
      }
    } catch (err: any) {
      setErrorMsg(err.message || "샘플 프리셋을 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
      setShowPresetsDropdown(false);
    }
  };

  // -------------------------------------------------------------------------
  // File Upload Handler
  // -------------------------------------------------------------------------
  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const fileArr = Array.from(files);
      const res = await api.uploadPlotDatasets(fileArr, {
        measurement_type: selectedInstrument,
      });

      const uploaded: PlotDataset[] = (res.datasets || []).map((ds: any, idx: number) => {
        const curIdx = datasets.length + idx;
        return {
          id: ds.id,
          sample_id: ds.sample_id,
          sample_name: ds.sample_name,
          measurement_type: ds.measurement_type,
          x_unit: ds.x_unit,
          y_unit: ds.y_unit,
          source_type: ds.source_type,
          source_filename: ds.source_filename,
          color: ds.data?.color || PALETTE[curIdx % PALETTE.length],
          offset: curIdx * globalOffsetStep,
          visible: true,
          line_width: 1.8,
          line_style: ds.data?.line_style || "solid",
          x: ds.data?.x || [],
          y: ds.data?.y || [],
          peaks: ds.data?.peaks || [],
          data_quality: ds.data_quality || {},
          measurement_conditions: ds.measurement_conditions || {},
          processing_history: ds.processing_history || [],
        };
      });

      setDatasets((prev) => [...prev, ...uploaded]);
    } catch (err: any) {
      setErrorMsg(err.message || "파일 업로드에 실패했습니다.");
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // -------------------------------------------------------------------------
  // Image Digitization Handler
  // -------------------------------------------------------------------------
  const handleImageDigitize = async (file: File) => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.digitizeXrdImage(file, {
        two_theta_min: 10.0,
        two_theta_max: 80.0,
        intensity_min: 0.0,
        intensity_max: 1000.0,
      });
      const ds = res.dataset;
      const curIdx = datasets.length;
      const newDs: PlotDataset = {
        id: ds.id,
        sample_id: ds.sample_id,
        sample_name: ds.sample_name,
        measurement_type: "XRD",
        x_unit: ds.x_unit,
        y_unit: ds.y_unit,
        source_type: "image_digitization",
        source_filename: ds.source_filename,
        color: "#DC2626",
        offset: curIdx * globalOffsetStep,
        visible: true,
        line_width: 1.8,
        line_style: "dash",
        x: ds.data?.x || [],
        y: ds.data?.y || [],
        peaks: ds.data?.peaks || [],
        data_quality: ds.data_quality || {},
        measurement_conditions: ds.measurement_conditions || {},
        processing_history: ds.processing_history || [],
      };
      setDatasets((prev) => [...prev, newDs]);
      setShowDigitizeModal(false);
    } catch (err: any) {
      setErrorMsg(err.message || "이미지 복원에 실패했습니다.");
    } finally {
      setIsLoading(false);
      if (digitizeInputRef.current) digitizeInputRef.current.value = "";
    }
  };

  // -------------------------------------------------------------------------
  // Reorder & Manage Datasets
  // -------------------------------------------------------------------------
  const moveDataset = (index: number, direction: "up" | "down") => {
    const targetIdx = direction === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= datasets.length) return;
    const next = [...datasets];
    const temp = next[index];
    next[index] = next[targetIdx];
    next[targetIdx] = temp;

    // Recalculate auto offsets if in auto mode
    if (autoOffset) {
      let visCounter = 0;
      next.forEach((d) => {
        if (d.visible) {
          d.offset = Math.round(visCounter * globalOffsetStep * 100) / 100;
          visCounter++;
        }
      });
    }
    setDatasets(next);
  };

  const toggleDatasetVisibility = (id: string) => {
    setDatasets((prev) =>
      prev.map((d) => {
        if (d.id === id) {
          return { ...d, visible: !d.visible };
        }
        return d;
      })
    );
  };

  const updateDatasetProp = (id: string, patch: Partial<PlotDataset>) => {
    setDatasets((prev) =>
      prev.map((d) => {
        if (d.id === id) {
          return { ...d, ...patch };
        }
        return d;
      })
    );
  };

  const removeDataset = (id: string) => {
    setDatasets((prev) => prev.filter((d) => d.id !== id));
  };

  const applyAutoOffsets = () => {
    let visCounter = 0;
    setDatasets((prev) =>
      prev.map((d) => {
        if (d.visible) {
          const off = Math.round(visCounter * globalOffsetStep * 100) / 100;
          visCounter++;
          return { ...d, offset: off };
        }
        return d;
      })
    );
  };

  // -------------------------------------------------------------------------
  // Process Data for Plot (Non-destructive: y_display = y_norm + offset)
  // -------------------------------------------------------------------------
  const processedSeries = useMemo(() => {
    return datasets.map((ds, idx) => {
      const x = ds.x || [];
      const yRaw = ds.y || [];
      if (x.length === 0 || yRaw.length === 0) {
        return { ...ds, y_normalized: [], y_display: [] };
      }

      // Step 1: Preprocessing (Baseline & Smoothing)
      let yWork = [...yRaw];
      if (useBackgroundSub) {
        const minVal = Math.min(...yWork);
        yWork = yWork.map((v) => Math.max(0, v - minVal * 0.9));
      }
      if (useSmoothing && yWork.length > 5) {
        // Simple moving average fallback for client-side live rendering
        const half = Math.floor(smoothWindow / 2);
        yWork = yWork.map((val, i) => {
          let sum = 0;
          let cnt = 0;
          for (let j = Math.max(0, i - half); j <= Math.min(yWork.length - 1, i + half); j++) {
            sum += yWork[j];
            cnt++;
          }
          return cnt > 0 ? sum / cnt : val;
        });
      }

      // Step 2: Normalization
      let yNorm: number[] = [];
      const maxY = Math.max(...yWork);
      if (globalNormalization === "maximum" && maxY > 0) {
        yNorm = yWork.map((v) => v / maxY);
      } else if (globalNormalization === "area") {
        const sumY = yWork.reduce((acc, v) => acc + v, 0);
        yNorm = sumY > 0 ? yWork.map((v) => (v / sumY) * 50) : yWork;
      } else if (globalNormalization === "user") {
        yNorm = yWork.map((v) => v * userScale);
      } else {
        yNorm = yWork;
      }

      // Step 3: Offset (strictly for visualization)
      const offset = activePlotMode === "stacked" ? ds.offset || 0 : 0;
      const yDisplay = yNorm.map((v) => v + offset);

      return {
        ...ds,
        y_normalized: yNorm,
        y_display: yDisplay,
      };
    });
  }, [
    datasets,
    activePlotMode,
    globalNormalization,
    userScale,
    useBackgroundSub,
    useSmoothing,
    smoothWindow,
  ]);

  // -------------------------------------------------------------------------
  // Peak Comparison Calculation (Mode D)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (activePlotMode !== "peak_comparison" || !referenceDatasetId) return;
    const refDs = datasets.find((d) => d.id === referenceDatasetId);
    if (!refDs || !refDs.peaks || refDs.peaks.length === 0) return;

    const otherDs = datasets.filter((d) => d.id !== referenceDatasetId && d.visible);
    if (otherDs.length === 0) {
      setPeakDiffRows([]);
      return;
    }

    const rows: PeakDifferenceRow[] = [];
    const topRefPeaks = [...refDs.peaks].sort((a, b) => b.height - a.height).slice(0, 8);

    otherDs.forEach((sampleDs) => {
      const samplePeaks = sampleDs.peaks || [];
      topRefPeaks.forEach((rPk, rIdx) => {
        // Nearest peak within tolerance
        const candidates = samplePeaks.filter(
          (sPk) => Math.abs(sPk.two_theta - rPk.two_theta) <= toleranceDeg
        );
        candidates.sort(
          (a, b) => Math.abs(a.two_theta - rPk.two_theta) - Math.abs(b.two_theta - rPk.two_theta)
        );
        const match = candidates[0];

        if (match) {
          const deltaTt = match.two_theta - rPk.two_theta;
          const deltaD = match.d_spacing - rPk.d_spacing;
          const fwhmRatio = rPk.fwhm > 0 ? match.fwhm / rPk.fwhm : 1.0;
          const intRatio = rPk.height > 0 ? match.height / rPk.height : 1.0;
          const status = Math.abs(deltaTt) >= 0.04 ? "Shifted" : "Matched";

          rows.push({
            peak_index: rIdx + 1,
            sample_id: sampleDs.sample_id,
            sample_name: sampleDs.sample_name,
            ref_two_theta: rPk.two_theta,
            sample_two_theta: match.two_theta,
            delta_two_theta: Math.round(deltaTt * 1000) / 1000,
            ref_d_spacing: rPk.d_spacing,
            sample_d_spacing: match.d_spacing,
            delta_d_spacing: Math.round(deltaD * 10000) / 10000,
            ref_fwhm: rPk.fwhm,
            sample_fwhm: match.fwhm,
            fwhm_ratio: Math.round(fwhmRatio * 100) / 100,
            intensity_ratio: Math.round(intRatio * 100) / 100,
            status,
          });
        } else {
          rows.push({
            peak_index: rIdx + 1,
            sample_id: sampleDs.sample_id,
            sample_name: sampleDs.sample_name,
            ref_two_theta: rPk.two_theta,
            sample_two_theta: null,
            delta_two_theta: null,
            ref_d_spacing: rPk.d_spacing,
            sample_d_spacing: null,
            delta_d_spacing: null,
            ref_fwhm: rPk.fwhm,
            sample_fwhm: null,
            fwhm_ratio: null,
            intensity_ratio: 0,
            status: "Unmatched",
          });
        }
      });
    });

    setPeakDiffRows(rows);
  }, [activePlotMode, referenceDatasetId, datasets, toleranceDeg]);

  // -------------------------------------------------------------------------
  // Plotly Data & Layout Construction
  // -------------------------------------------------------------------------
  const plotlyData = useMemo(() => {
    const visibleSeries = processedSeries.filter((d) => d.visible);

    if (activePlotMode === "subplot" && visibleSeries.length > 1) {
      // Subplots
      return visibleSeries.map((ds, i) => ({
        x: ds.x,
        y: ds.y_normalized,
        type: "scatter",
        mode: "lines",
        name: ds.sample_name,
        line: {
          color: ds.color,
          width: ds.line_width,
          dash: ds.line_style === "dash" ? "dash" : ds.line_style === "dot" ? "dot" : "solid",
        },
        xaxis: "x",
        yaxis: i === 0 ? "y" : `y${i + 1}`,
      }));
    }

    // Standard Stacked, Overlay, or Peak Comparison
    const traces: any[] = visibleSeries.map((ds) => {
      const yData = activePlotMode === "stacked" ? ds.y_display : ds.y_normalized;
      const isRef = ds.id === referenceDatasetId;

      return {
        x: ds.x,
        y: yData,
        type: "scatter",
        mode: "lines",
        name:
          activePlotMode === "stacked" && ds.offset > 0
            ? `${ds.sample_name} (+${ds.offset})`
            : ds.sample_name,
        line: {
          color: ds.color,
          width: ds.line_width + (isRef && activePlotMode === "peak_comparison" ? 0.8 : 0),
          dash: ds.line_style === "dash" ? "dash" : ds.line_style === "dot" ? "dot" : "solid",
        },
        hovertemplate:
          `<b>${ds.sample_name}</b><br>` +
          `2θ: %{x:.2f}°<br>` +
          `강도: %{y:.2f}<br>` +
          `<extra></extra>`,
      };
    });

    // In Mode D, add vertical connector tie-lines between matched peaks
    if (activePlotMode === "peak_comparison" && peakDiffRows.length > 0) {
      const matched = peakDiffRows.filter((r) => r.sample_two_theta !== null);
      matched.forEach((r, idx) => {
        traces.push({
          x: [r.ref_two_theta, r.sample_two_theta],
          y: [0.95, 0.95],
          type: "scatter",
          mode: "lines+markers",
          line: { color: "#DC2626", width: 1.2, dash: "dot" },
          marker: { size: 4, color: "#DC2626" },
          showlegend: idx === 0,
          name: idx === 0 ? "피크 이동 (Δ2θ)" : undefined,
          hoverinfo: "text",
          text: `Δ2θ: ${r.delta_two_theta > 0 ? "+" : ""}${r.delta_two_theta}°`,
        });
      });
    }

    return traces;
  }, [processedSeries, activePlotMode, referenceDatasetId, peakDiffRows]);

  const plotlyLayout = useMemo(() => {
    const visibleSeries = processedSeries.filter((d) => d.visible);
    const numSubplots = activePlotMode === "subplot" ? visibleSeries.length : 1;

    // Convert annotations to Plotly layout annotations
    const plotlyAnnotations: any[] = [];

    // User / Phase Annotations
    annotations.forEach((ann) => {
      plotlyAnnotations.push({
        x: ann.x,
        y: ann.y,
        xref: "x",
        yref: "y",
        text: ann.hkl ? `<b>(${ann.hkl})</b>` : ann.text,
        showarrow: true,
        arrowhead: 2,
        arrowsize: 1,
        arrowwidth: 1.2,
        arrowcolor: "#475569",
        ax: 0,
        ay: -25,
        font: {
          family: "Pretendard, sans-serif",
          size: fontSize * 0.9,
          color: ann.type === "phase_marker" ? "#B91C1C" : "#1E293B",
        },
        bgcolor: "#FFFFFF",
        bordercolor: "#CBD5E1",
        borderwidth: 1,
        borderpad: 3,
        opacity: 0.92,
      });
    });

    // In Mode B Stacked, add baseline labels
    if (activePlotMode === "stacked") {
      visibleSeries.forEach((ds) => {
        if (ds.offset > 0 && ds.x.length > 0) {
          plotlyAnnotations.push({
            x: ds.x[0],
            y: ds.offset,
            xref: "x",
            yref: "y",
            text: `Base +${ds.offset.toFixed(1)}`,
            showarrow: false,
            xanchor: "left",
            yanchor: "bottom",
            font: { size: 9, color: ds.color },
            opacity: 0.7,
          });
        }
      });
    }

    // Base layout
    const layout: Record<string, any> = {
      title: {
        text: `<b>${plotTitle}</b>`,
        font: { size: fontSize * 1.2, color: "#0F172A" },
        x: 0.05,
      },
      paper_bgcolor: "#FFFFFF",
      plot_bgcolor: "#FFFFFF",
      showlegend: true,
      legend: {
        x: legendLocation.includes("right") ? 0.98 : 0.02,
        y: legendLocation.includes("upper") ? 0.98 : 0.02,
        xanchor: legendLocation.includes("right") ? "right" : "left",
        yanchor: legendLocation.includes("upper") ? "top" : "bottom",
        bgcolor: "rgba(255, 255, 255, 0.92)",
        bordercolor: "#E2E8F0",
        borderwidth: 1,
        font: { size: fontSize * 0.85 },
      },
      annotations: plotlyAnnotations,
      hovermode: "closest",
    };

    // Subplot axis layout
    if (activePlotMode === "subplot" && numSubplots > 1) {
      layout.grid = {
        rows: numSubplots,
        columns: 1,
        pattern: "coupled",
        roworder: "top to bottom",
      };
      layout.xaxis = {
        title: `${xAxisLabel} (${xAxisUnit})`,
        tickfont: { size: fontSize * 0.85 },
        showgrid: showGrid,
        gridcolor: "#F1F5F9",
        zeroline: false,
      };
      for (let i = 1; i <= numSubplots; i++) {
        const yKey = i === 1 ? "yaxis" : `yaxis${i}`;
        layout[yKey] = {
          title: visibleSeries[i - 1]?.sample_name || `Sample ${i}`,
          tickfont: { size: fontSize * 0.8 },
          showgrid: showGrid,
          gridcolor: "#F1F5F9",
        };
      }
    } else {
      layout.xaxis = {
        title: `<b>${xAxisLabel} (${xAxisUnit})</b>`,
        tickfont: { size: fontSize * 0.9 },
        showgrid: showGrid,
        gridcolor: "#F1F5F9",
        zeroline: false,
        range:
          customXMin && customXMax
            ? [parseFloat(customXMin), parseFloat(customXMax)]
            : undefined,
      };
      layout.yaxis = {
        title: `<b>${yAxisLabel} (${yAxisUnit})</b>`,
        tickfont: { size: fontSize * 0.9 },
        showgrid: showGrid,
        gridcolor: "#F1F5F9",
        zeroline: false,
      };
    }

    return layout;
  }, [
    processedSeries,
    activePlotMode,
    plotTitle,
    xAxisLabel,
    xAxisUnit,
    yAxisLabel,
    yAxisUnit,
    fontSize,
    showGrid,
    legendLocation,
    customXMin,
    customXMax,
    annotations,
  ]);

  // -------------------------------------------------------------------------
  // Publication Export
  // -------------------------------------------------------------------------
  const handleExport = (format: "png" | "svg" | "pdf") => {
    setIsLoading(true);
    const visibleData = processedSeries.filter((d) => d.visible);
    const payload = {
      title: plotTitle,
      plot_type: activePlotMode,
      normalization: globalNormalization,
      format,
      dpi: 300,
      width_in: 7.2,
      height_in: activePlotMode === "subplot" ? Math.max(5.5, visibleData.length * 1.8) : 5.2,
      datasets: visibleData.map((d) => ({
        sample_name: d.sample_name,
        color: d.color,
        offset: d.offset,
        line_width: d.line_width,
        line_style: d.line_style,
        x: d.x,
        y_normalized: d.y_normalized,
        y_display: d.y_display,
        y_raw: d.y,
      })),
      x_axis: {
        label: xAxisLabel,
        unit: xAxisUnit,
        min: customXMin ? parseFloat(customXMin) : null,
        max: customXMax ? parseFloat(customXMax) : null,
      },
      y_axis: {
        label: yAxisLabel,
        unit: yAxisUnit,
      },
      annotations: annotations,
      graph_properties: {
        font_size: fontSize,
        grid: showGrid,
        legend_position: legendLocation,
      },
    };

    api
      .exportPlot(payload, `${plotTitle.replace(/\s+/g, "_")}_${activePlotMode}`)
      .catch((err) => setErrorMsg("내보내기 실패: " + err.message))
      .finally(() => setIsLoading(false));
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Notification */}
      {errorMsg && (
        <div className="p-4 rounded-[12px] bg-red-50 border border-red-200 text-red-700 flex items-center justify-between text-[13px]">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{errorMsg}</span>
          </div>
          <button
            onClick={() => setErrorMsg(null)}
            className="text-red-500 hover:text-red-800 text-[12px] font-semibold"
          >
            닫기
          </button>
        </div>
      )}

      {/* Main 3-Panel Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* ========================================================= */}
        {/* LEFT PANEL: Dataset Manager (Cols: 3.5)                     */}
        {/* ========================================================= */}
        <div className="lg:col-span-4 xl:col-span-3 space-y-4">
          <Card className="p-4 bg-white border border-[#E5E8EB] shadow-sm rounded-[16px] space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-[#3182F6]" />
                <h3 className="text-[15px] font-bold text-[#191F28]">데이터셋 관리</h3>
              </div>
              <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full bg-[#F2F4F6] text-[#4E5968]">
                {datasets.filter((d) => d.visible).length} / {datasets.length}개 표시
              </span>
            </div>

            {/* Upload Buttons */}
            <div className="space-y-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 min-h-[40px] px-3 rounded-[10px] bg-[#3182F6] hover:bg-[#2563EB] text-white text-[13px] font-semibold flex items-center justify-center gap-1.5 transition-all shadow-sm"
                >
                  <Upload className="w-4 h-4" />
                  파일 추가 (CSV/TXT)
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".csv,.txt,.xlsx"
                  className="hidden"
                  onChange={(e) => handleFileUpload(e.target.files)}
                />

                <button
                  type="button"
                  onClick={() => setShowDigitizeModal(true)}
                  className="px-3 rounded-[10px] bg-[#F2F4F6] hover:bg-[#E5E8EB] text-[#333D4B] text-[13px] font-semibold flex items-center justify-center gap-1 transition-all"
                  title="XRD 이미지에서 데이터 복원"
                >
                  <ImageIcon className="w-4 h-4 text-[#4E5968]" />
                  복원
                </button>
              </div>

              {/* Presets and Run Import Buttons */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <button
                    type="button"
                    onClick={() => setShowPresetsDropdown((v) => !v)}
                    className="w-full min-h-[34px] px-3 rounded-[8px] border border-[#E5E8EB] hover:border-[#B0B8C1] bg-white text-[#4E5968] text-[12px] font-medium flex items-center justify-between"
                  >
                    <span>📚 검증용 프리셋 시료</span>
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>

                  {showPresetsDropdown && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-[#E5E8EB] shadow-lg rounded-[10px] z-50 p-1 space-y-1">
                      <button
                        onClick={() => loadPresetSeries("AC Series")}
                        className="w-full text-left px-3 py-1.5 rounded-[6px] text-[12px] font-medium text-[#191F28] hover:bg-[#F2F4F6]"
                      >
                        🔥 <strong>AC 흑연화 시리즈</strong> (AC, AC700, AC850, AC1000)
                      </button>
                      <button
                        onClick={() => loadPresetSeries("BaTiO3")}
                        className="w-full text-left px-3 py-1.5 rounded-[6px] text-[12px] font-medium text-[#191F28] hover:bg-[#F2F4F6]"
                      >
                        🧪 <strong>BaTiO3 소결체</strong> (600°C, 700°C, 800°C)
                      </button>
                      <button
                        onClick={() => loadPresetSeries("TiO2")}
                        className="w-full text-left px-3 py-1.5 rounded-[6px] text-[12px] font-medium text-[#191F28] hover:bg-[#F2F4F6]"
                      >
                        🔬 <strong>TiO2 혼상 분석</strong> (Anatase & Rutile)
                      </button>
                      <button
                        onClick={() => loadPresetSeries("UTM")}
                        className="w-full text-left px-3 py-1.5 rounded-[6px] text-[12px] font-medium text-[#191F28] hover:bg-[#F2F4F6]"
                      >
                        ⚙️ <strong>UTM 인장시험</strong> (ABS & 합금 곡선)
                      </button>
                    </div>
                  )}
                </div>

                {hasActiveRun && onImportCurrentRun && (
                  <button
                    type="button"
                    onClick={onImportCurrentRun}
                    className="px-2.5 rounded-[8px] bg-[#EBF4FF] text-[#3182F6] hover:bg-[#DBE9FE] text-[12px] font-semibold flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    현재 분석 추가
                  </button>
                )}
              </div>
            </div>

            {/* Global Preprocessing & Offset Controls */}
            <div className="p-3 bg-[#F9FAFB] border border-[#E5E8EB] rounded-[12px] space-y-2.5 text-[12px]">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#333D4B]">정규화 (Normalization)</span>
                <select
                  value={globalNormalization}
                  onChange={(e) => setGlobalNormalization(e.target.value as NormalizationMode)}
                  className="px-2 py-1 rounded-[6px] border border-[#D1D5DB] bg-white text-[#191F28] text-[12px]"
                >
                  <option value="maximum">최대 강도 (I/I_max)</option>
                  <option value="area">면적 정규화 (Area=1)</option>
                  <option value="none">원본 강도 (None)</option>
                  <option value="user">사용자 배율 (Scale)</option>
                </select>
              </div>

              {globalNormalization === "user" && (
                <div className="flex items-center justify-between">
                  <span className="text-[#6B7684]">스케일 계수:</span>
                  <input
                    type="number"
                    step="0.1"
                    value={userScale}
                    onChange={(e) => setUserScale(parseFloat(e.target.value) || 1.0)}
                    className="w-20 px-2 py-0.5 border border-[#D1D5DB] rounded text-right"
                  />
                </div>
              )}

              {/* Offset Controls for Stacked Mode */}
              {activePlotMode === "stacked" && (
                <div className="space-y-1.5 pt-1 border-t border-[#E5E8EB]">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[#333D4B]">수직 오프셋 간격 (ΔO)</span>
                    <button
                      type="button"
                      onClick={applyAutoOffsets}
                      className="text-[11px] text-[#3182F6] hover:underline font-semibold flex items-center gap-0.5"
                    >
                      <RefreshCw className="w-3 h-3" />
                      균등 재배치
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="0.2"
                      max="3.0"
                      step="0.05"
                      value={globalOffsetStep}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setGlobalOffsetStep(val);
                        if (autoOffset) {
                          let vis = 0;
                          setDatasets((prev) =>
                            prev.map((d) => {
                              if (d.visible) {
                                const off = Math.round(vis * val * 100) / 100;
                                vis++;
                                return { ...d, offset: off };
                              }
                              return d;
                            })
                          );
                        }
                      }}
                      className="flex-1 accent-[#3182F6]"
                    />
                    <span className="w-12 text-right font-mono text-[11px] text-[#4E5968]">
                      {globalOffsetStep.toFixed(2)}
                    </span>
                  </div>
                </div>
              )}

              {/* Preprocessing Toggles */}
              <div className="pt-2 border-t border-[#E5E8EB] flex items-center justify-between gap-3 text-[#4E5968]">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useBackgroundSub}
                    onChange={(e) => setUseBackgroundSub(e.target.checked)}
                    className="rounded text-[#3182F6]"
                  />
                  <span>ALS 배경 차감</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useSmoothing}
                    onChange={(e) => setUseSmoothing(e.target.checked)}
                    className="rounded text-[#3182F6]"
                  />
                  <span>Savitzky-Golay 스무딩</span>
                </label>
              </div>
            </div>

            {/* Datasets Scrollable List */}
            <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
              {datasets.length === 0 ? (
                <div className="text-center py-8 text-[#8B95A1] text-[13px]">
                  데이터셋이 없습니다.<br />위 버튼을 눌러 파일을 추가하세요.
                </div>
              ) : (
                datasets.map((ds, idx) => (
                  <div
                    key={ds.id}
                    className={`p-3 rounded-[12px] border transition-all ${
                      ds.visible ? "bg-white border-[#E5E8EB]" : "bg-[#F8FAFC] border-[#E2E8F0] opacity-60"
                    }`}
                  >
                    {/* Header Row: Color + Name + Action buttons */}
                    <div className="flex items-center gap-2">
                      {/* Color Dot / Picker */}
                      <input
                        type="color"
                        value={ds.color}
                        onChange={(e) => updateDatasetProp(ds.id, { color: e.target.value })}
                        className="w-5 h-5 rounded-full border border-gray-300 cursor-pointer p-0 shrink-0"
                        title="선 색상 변경"
                      />

                      {/* Sample Name Editor */}
                      <input
                        type="text"
                        value={ds.sample_name}
                        onChange={(e) => updateDatasetProp(ds.id, { sample_name: e.target.value })}
                        className="flex-1 font-semibold text-[13px] text-[#191F28] bg-transparent border-b border-transparent hover:border-[#CBD5E1] focus:border-[#3182F6] outline-none px-1"
                      />

                      {/* Reorder Buttons */}
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => moveDataset(idx, "up")}
                          disabled={idx === 0}
                          className="p-1 hover:bg-[#F2F4F6] rounded text-[#6B7684] disabled:opacity-20"
                          title="위로 이동"
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveDataset(idx, "down")}
                          disabled={idx === datasets.length - 1}
                          className="p-1 hover:bg-[#F2F4F6] rounded text-[#6B7684] disabled:opacity-20"
                          title="아래로 이동"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleDatasetVisibility(ds.id)}
                          className="p-1 hover:bg-[#F2F4F6] rounded text-[#6B7684]"
                          title={ds.visible ? "숨기기" : "표시하기"}
                        >
                          {ds.visible ? <Eye className="w-3.5 h-3.5 text-[#3182F6]" /> : <EyeOff className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeDataset(ds.id)}
                          className="p-1 hover:bg-red-50 rounded text-red-500"
                          title="삭제"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Metadata & Offset Adjustment */}
                    <div className="mt-2 pt-2 border-t border-[#F2F4F6] flex flex-wrap items-center justify-between text-[11px] text-[#6B7684]">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[#4E5968]">{ds.sample_id}</span>
                        {ds.source_type === "image_digitization" ? (
                          <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold border border-amber-200">
                            이미지 복원 (±0.05°)
                          </span>
                        ) : ds.source_type === "analysis_run" ? (
                          <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold border border-blue-200">
                            MatLens 분석
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded bg-gray-100 text-[#4E5968]">
                            실측 원본
                          </span>
                        )}
                      </div>

                      {/* Offset Input for Stacked Mode */}
                      {activePlotMode === "stacked" && (
                        <div className="flex items-center gap-1">
                          <span>오프셋:</span>
                          <input
                            type="number"
                            step="0.1"
                            value={ds.offset}
                            onChange={(e) =>
                              updateDatasetProp(ds.id, { offset: parseFloat(e.target.value) || 0 })
                            }
                            className="w-14 px-1 py-0.5 border border-[#D1D5DB] rounded text-right font-mono"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>

        {/* ========================================================= */}
        {/* CENTER PANEL: Interactive Plot & Controls (Cols: 5.5)      */}
        {/* ========================================================= */}
        <div className="lg:col-span-8 xl:col-span-6 space-y-4">
          <Card className="p-4 bg-white border border-[#E5E8EB] shadow-sm rounded-[16px] space-y-4">
            {/* Top Toolbar: Plot Mode Switcher & Tools */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 pb-3 border-b border-[#E5E8EB]">
              {/* Mode Buttons */}
              <div className="inline-flex p-1 rounded-[12px] bg-[#F2F4F6] gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setActivePlotMode("stacked");
                    setPlotTitle("Stacked XRD Pattern (Vertical Offset)");
                  }}
                  className={`px-3 py-1.5 rounded-[9px] text-[13px] font-semibold transition-all flex items-center gap-1.5 ${
                    activePlotMode === "stacked"
                      ? "bg-white text-[#3182F6] shadow-sm font-bold"
                      : "text-[#6B7684] hover:text-[#191F28]"
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  Stacked (Mode B)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActivePlotMode("overlay");
                    setPlotTitle("Multi-Dataset Overlay Plot");
                  }}
                  className={`px-3 py-1.5 rounded-[9px] text-[13px] font-semibold transition-all flex items-center gap-1.5 ${
                    activePlotMode === "overlay"
                      ? "bg-white text-[#3182F6] shadow-sm font-bold"
                      : "text-[#6B7684] hover:text-[#191F28]"
                  }`}
                >
                  <GitCompare className="w-3.5 h-3.5" />
                  Overlay (Mode A)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActivePlotMode("subplot");
                    setPlotTitle("Multi-Panel Subplots (Shared X)");
                  }}
                  className={`px-3 py-1.5 rounded-[9px] text-[13px] font-semibold transition-all flex items-center gap-1.5 ${
                    activePlotMode === "subplot"
                      ? "bg-white text-[#3182F6] shadow-sm font-bold"
                      : "text-[#6B7684] hover:text-[#191F28]"
                  }`}
                >
                  <BarChart2 className="w-3.5 h-3.5" />
                  Subplot (Mode C)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActivePlotMode("peak_comparison");
                    setPlotTitle("XRD Peak Position & Shift Comparison");
                    setRightPanelTab("peaks");
                  }}
                  className={`px-3 py-1.5 rounded-[9px] text-[13px] font-semibold transition-all flex items-center gap-1.5 ${
                    activePlotMode === "peak_comparison"
                      ? "bg-white text-[#3182F6] shadow-sm font-bold"
                      : "text-[#6B7684] hover:text-[#191F28]"
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  피크 비교 (Mode D)
                </button>
              </div>

              {/* Action Buttons: Editor Drawer & Export */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowEditorDrawer((v) => !v)}
                  className="px-2.5 py-1.5 rounded-[9px] border border-[#E5E8EB] bg-white hover:bg-[#F9FAFB] text-[#4E5968] text-[12px] font-semibold flex items-center gap-1.5"
                  title="그래프 제목, 축 레이블, 폰트 및 격자 설정"
                >
                  <Settings className="w-3.5 h-3.5" />
                  스타일 편집
                </button>

                <button
                  type="button"
                  onClick={() => setShowAnnotationModal(true)}
                  className="px-2.5 py-1.5 rounded-[9px] border border-[#E5E8EB] bg-white hover:bg-[#F9FAFB] text-[#4E5968] text-[12px] font-semibold flex items-center gap-1.5"
                  title="밀러 지수(hkl) 및 상 마커 추가"
                >
                  <Tag className="w-3.5 h-3.5" />
                  어노테이션
                </button>

                {/* Export Dropdown */}
                <div className="relative group">
                  <button
                    type="button"
                    className="min-h-[34px] px-3 rounded-[9px] bg-[#191F28] hover:bg-[#333D4B] text-white text-[12px] font-semibold flex items-center gap-1.5 shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5" />
                    내보내기 (Export)
                  </button>
                  <div className="hidden group-hover:block absolute right-0 top-full mt-1 bg-white border border-[#E5E8EB] shadow-xl rounded-[10px] p-1.5 z-50 w-48 space-y-1">
                    <button
                      onClick={() => handleExport("png")}
                      className="w-full text-left px-3 py-1.5 rounded-[6px] text-[12px] text-[#191F28] hover:bg-[#F2F4F6] font-medium"
                    >
                      🖼️ <strong>PNG (300 DPI 논문용)</strong>
                    </button>
                    <button
                      onClick={() => handleExport("svg")}
                      className="w-full text-left px-3 py-1.5 rounded-[6px] text-[12px] text-[#191F28] hover:bg-[#F2F4F6] font-medium"
                    >
                      📐 <strong>SVG (무손실 벡터)</strong>
                    </button>
                    <button
                      onClick={() => handleExport("pdf")}
                      className="w-full text-left px-3 py-1.5 rounded-[6px] text-[12px] text-[#191F28] hover:bg-[#F2F4F6] font-medium"
                    >
                      📄 <strong>PDF (학술 보고서용)</strong>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Scientific Formula / Mode Explainer Pill */}
            {activePlotMode === "stacked" && (
              <div className="px-3 py-1.5 rounded-[8px] bg-[#EFF6FF] border border-[#BFDBFE] text-[12px] text-[#1E40AF] flex items-center justify-between">
                <span>
                  <strong>논문용 Stacked Pattern:</strong>{" "}
                  <code className="font-mono bg-white px-1 py-0.5 rounded text-[#1D4ED8]">
                    I_display,i(x) = I_norm,i(x) + O_i
                  </code>
                </span>
                <span className="text-[11px] text-[#3B82F6]">
                  ※ 오프셋은 시각화에만 반영되며 정량 데이터는 원본 보존됩니다.
                </span>
              </div>
            )}

            {/* Interactive Plot Canvas */}
            <div className="w-full min-h-[460px] bg-white rounded-[14px] border border-[#F2F4F6]">
              <PlotlyChart
                data={plotlyData}
                layout={plotlyLayout}
                height={activePlotMode === "subplot" ? Math.max(460, datasets.length * 150) : 480}
              />
            </div>

            {/* Quick Instrument Badges */}
            <div className="flex flex-wrap items-center justify-between text-[12px] text-[#6B7684] pt-2 border-t border-[#F2F4F6]">
              <div className="flex items-center gap-2">
                <span>적용 분석기기:</span>
                {["XRD", "SEM", "UTM", "LFA", "Hall"].map((inst) => (
                  <button
                    key={inst}
                    type="button"
                    onClick={() => setSelectedInstrument(inst)}
                    className={`px-2 py-0.5 rounded-[6px] text-[11px] font-semibold transition-all ${
                      selectedInstrument === inst
                        ? "bg-[#3182F6] text-white"
                        : "bg-[#F2F4F6] text-[#4E5968] hover:bg-[#E5E8EB]"
                    }`}
                  >
                    {inst}
                  </button>
                ))}
              </div>

              <div className="text-[11px] text-[#8B95A1]">
                OriginPro 대체 고해상도 벡터 렌더링 지원
              </div>
            </div>
          </Card>
        </div>

        {/* ========================================================= */}
        {/* RIGHT PANEL: Analysis, Comparison & XRD-SEM Link (Cols: 3) */}
        {/* ========================================================= */}
        <div className="lg:col-span-12 xl:col-span-3 space-y-4">
          <Card className="p-4 bg-white border border-[#E5E8EB] shadow-sm rounded-[16px] space-y-3">
            {/* Right Panel Tabs */}
            <div className="flex border-b border-[#E5E8EB] text-[13px] font-bold text-[#6B7684]">
              <button
                type="button"
                onClick={() => setRightPanelTab("peaks")}
                className={`flex-1 pb-2 border-b-2 text-center transition-all ${
                  rightPanelTab === "peaks"
                    ? "border-[#3182F6] text-[#3182F6]"
                    : "border-transparent hover:text-[#191F28]"
                }`}
              >
                피크 비교 (Mode D)
              </button>
              <button
                type="button"
                onClick={() => setRightPanelTab("sem")}
                className={`flex-1 pb-2 border-b-2 text-center transition-all ${
                  rightPanelTab === "sem"
                    ? "border-[#3182F6] text-[#3182F6]"
                    : "border-transparent hover:text-[#191F28]"
                }`}
              >
                XRD–SEM 연계
              </button>
              <button
                type="button"
                onClick={() => setRightPanelTab("summary")}
                className={`flex-1 pb-2 border-b-2 text-center transition-all ${
                  rightPanelTab === "summary"
                    ? "border-[#3182F6] text-[#3182F6]"
                    : "border-transparent hover:text-[#191F28]"
                }`}
              >
                시료 요약
              </button>
            </div>

            {/* TAB 1: Mode D Peak Comparison Table */}
            {rightPanelTab === "peaks" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-semibold text-[#333D4B]">기준 시료 (Reference):</span>
                  <select
                    value={referenceDatasetId}
                    onChange={(e) => setReferenceDatasetId(e.target.value)}
                    className="px-2 py-1 rounded-[6px] border border-[#D1D5DB] bg-white text-[#191F28] text-[12px] max-w-[140px] truncate"
                  >
                    {datasets.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.sample_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between text-[11px] text-[#6B7684]">
                  <span>피크 매칭 허용오차:</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="range"
                      min="0.1"
                      max="1.0"
                      step="0.05"
                      value={toleranceDeg}
                      onChange={(e) => setToleranceDeg(parseFloat(e.target.value))}
                      className="w-16 accent-[#3182F6]"
                    />
                    <span className="font-mono">±{toleranceDeg.toFixed(2)}°</span>
                  </div>
                </div>

                {/* Difference Table */}
                <div className="max-h-[380px] overflow-y-auto border border-[#E5E8EB] rounded-[10px]">
                  <table className="w-full text-[11px] text-left border-collapse">
                    <thead className="bg-[#F8FAFC] text-[#475569] font-semibold sticky top-0 border-b border-[#E2E8F0]">
                      <tr>
                        <th className="p-1.5">#</th>
                        <th className="p-1.5">시료</th>
                        <th className="p-1.5">Ref 2θ</th>
                        <th className="p-1.5">Sample 2θ</th>
                        <th className="p-1.5">Δ(2θ)</th>
                        <th className="p-1.5">상태</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F1F5F9] text-[#1E293B]">
                      {peakDiffRows.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-4 text-center text-[#94A3B8]">
                            비교할 매칭 피크가 없습니다.
                          </td>
                        </tr>
                      ) : (
                        peakDiffRows.map((row, idx) => (
                          <tr key={idx} className="hover:bg-[#F8FAFC]">
                            <td className="p-1.5 font-mono">{row.peak_index}</td>
                            <td className="p-1.5 font-medium truncate max-w-[60px]" title={row.sample_name}>
                              {row.sample_name}
                            </td>
                            <td className="p-1.5 font-mono">{row.ref_two_theta.toFixed(2)}°</td>
                            <td className="p-1.5 font-mono">
                              {row.sample_two_theta !== null ? `${row.sample_two_theta.toFixed(2)}°` : "-"}
                            </td>
                            <td className="p-1.5 font-mono font-bold">
                              {row.delta_two_theta !== null ? (
                                <span
                                  className={
                                    Math.abs(row.delta_two_theta) >= 0.04 ? "text-red-600" : "text-green-600"
                                  }
                                >
                                  {row.delta_two_theta > 0 ? "+" : ""}
                                  {row.delta_two_theta.toFixed(3)}°
                                </span>
                              ) : (
                                "-"
                              )}
                            </td>
                            <td className="p-1.5">
                              <span
                                className={`px-1 py-0.5 rounded text-[10px] font-semibold ${
                                  row.status === "Shifted"
                                    ? "bg-red-50 text-red-700"
                                    : row.status === "Matched"
                                    ? "bg-green-50 text-green-700"
                                    : "bg-gray-100 text-gray-500"
                                }`}
                              >
                                {row.status}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="p-2.5 rounded-[8px] bg-[#F8FAFC] border border-[#E2E8F0] text-[11px] text-[#64748B] space-y-1">
                  <div>
                    <strong>피크 시프트 계산식:</strong> Δ(2θ) = 2θ_sample - 2θ_ref
                  </div>
                  <div>
                    ※ 격자 왜곡(Strain) 또는 고용체(Solid solution) 형성에 따른 면간거리 변화를 의미합니다.
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: XRD–SEM Integration */}
            {rightPanelTab === "sem" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-semibold text-[#333D4B]">연계 시료 선택:</span>
                  <select
                    value={selectedSemSampleId}
                    onChange={(e) => setSelectedSemSampleId(e.target.value)}
                    className="px-2 py-1 rounded-[6px] border border-[#D1D5DB] bg-white text-[#191F28] text-[12px] max-w-[140px] truncate"
                  >
                    {datasets.map((d) => (
                      <option key={d.id} value={d.sample_id}>
                        {d.sample_name} ({d.sample_id})
                      </option>
                    ))}
                  </select>
                </div>

                {isLoadingSem ? (
                  <div className="p-6 text-center text-[#8B95A1] text-[12px]">
                    SEM 연계 데이터 검색 중...
                  </div>
                ) : semLinkedData ? (
                  <div className="space-y-3">
                    {/* SEM Micrograph & Grain Size Summary */}
                    <div className="p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-[10px] space-y-2">
                      <div className="flex items-center justify-between text-[12px]">
                        <span className="font-bold text-[#1E293B] flex items-center gap-1.5">
                          <Microscope className="w-4 h-4 text-[#3182F6]" />
                          SEM 미세구조 연계 결과
                        </span>
                        <span className="text-[11px] text-[#64748B]">
                          {semLinkedData.process_temperature}
                        </span>
                      </div>

                      {/* Grain Size Statistics */}
                      {semLinkedData.grain_size_analysis && (
                        <div className="grid grid-cols-3 gap-1.5 text-center text-[11px] pt-1">
                          <div className="p-1.5 rounded bg-white border border-[#E2E8F0]">
                            <div className="text-[#64748B]">D50</div>
                            <div className="font-bold text-[#0F172A]">
                              {semLinkedData.grain_size_analysis.d50_um} µm
                            </div>
                          </div>
                          <div className="p-1.5 rounded bg-white border border-[#E2E8F0]">
                            <div className="text-[#64748B]">평균 직경</div>
                            <div className="font-bold text-[#0F172A]">
                              {semLinkedData.grain_size_analysis.mean_diameter_um} µm
                            </div>
                          </div>
                          <div className="p-1.5 rounded bg-white border border-[#E2E8F0]">
                            <div className="text-[#64748B]">기공률</div>
                            <div className="font-bold text-[#0F172A]">
                              {semLinkedData.grain_size_analysis.porosity_pct}%
                            </div>
                          </div>
                        </div>
                      )}

                      {/* XRD Phase Info */}
                      {semLinkedData.xrd_phase_info && (
                        <div className="text-[11px] text-[#334155] space-y-1 pt-1 border-t border-[#E2E8F0]">
                          <div>
                            <strong>주요 결정상:</strong> {semLinkedData.xrd_phase_info.dominant_phase}
                          </div>
                          {semLinkedData.xrd_phase_info.crystallite_size_nm && (
                            <div>
                              <strong>XRD 결정립 크기:</strong>{" "}
                              {semLinkedData.xrd_phase_info.crystallite_size_nm} nm
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Integrated Scientific Interpretation */}
                    <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-[10px] space-y-1.5 text-[12px] text-[#1E3A8A]">
                      <div className="font-bold flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#2563EB]" />
                        XRD–SEM 통합 해석 (Integrated Report)
                      </div>
                      <p className="text-[11.5px] leading-relaxed text-[#1E40AF]">
                        {semLinkedData.integrated_interpretation}
                      </p>
                    </div>

                    {/* Scientific Warning Disclaimer */}
                    <div className="p-2.5 rounded-[8px] bg-amber-50 border border-amber-200 text-amber-800 text-[11px] leading-snug">
                      {semLinkedData.scientific_disclaimer}
                    </div>
                  </div>
                ) : (
                  <div className="p-6 text-center text-[#8B95A1] text-[12px]">
                    연결된 SEM 결과가 없습니다.
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: Sample Comparison Summary */}
            {rightPanelTab === "summary" && (
              <div className="space-y-3">
                <div className="text-[12px] font-semibold text-[#333D4B]">
                  전체 시료 특성 요약 ({datasets.length}개)
                </div>
                <div className="space-y-2 max-h-[380px] overflow-y-auto">
                  {datasets.map((ds) => (
                    <div
                      key={ds.id}
                      className="p-2.5 rounded-[8px] border border-[#E5E8EB] bg-[#F8FAFC] space-y-1 text-[11px]"
                    >
                      <div className="flex items-center justify-between font-bold text-[#191F28]">
                        <span className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ds.color }} />
                          {ds.sample_name}
                        </span>
                        <span className="font-mono text-[#6B7684]">{ds.sample_id}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-[#64748B] pt-1">
                        <div>데이터 포인트: {ds.x.length}점</div>
                        <div>피크 개수: {ds.peaks?.length || 0}개</div>
                        <div>측정 기기: {ds.measurement_type}</div>
                        <div>
                          신뢰도:{" "}
                          <span
                            className={
                              ds.data_quality?.confidence?.includes("High")
                                ? "text-green-600 font-semibold"
                                : "text-amber-600 font-semibold"
                            }
                          >
                            {ds.data_quality?.confidence || "Normal"}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ========================================================= */}
      {/* MODAL 1: Image Digitization Dialog                         */}
      {/* ========================================================= */}
      {showDigitizeModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[20px] max-w-md w-full p-6 shadow-2xl border border-[#E5E8EB] space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-[#DC2626]" />
                <h3 className="text-[17px] font-bold text-[#191F28]">XRD 그래프 이미지 복원</h3>
              </div>
              <button
                onClick={() => setShowDigitizeModal(false)}
                className="text-[#8B95A1] hover:text-[#191F28]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-[13px] text-[#4E5968] leading-relaxed">
              논문이나 보고서의 캡처 이미지에서 2θ-강도 수치 데이터를 복원합니다. 복원된 데이터는{" "}
              <strong>오차 추정값(±0.05°)</strong>과 함께 별도 플롯에 오버레이됩니다.
            </p>

            <div
              onClick={() => digitizeInputRef.current?.click()}
              className="border-2 border-dashed border-[#CBD5E1] hover:border-[#3182F6] rounded-[14px] p-6 text-center cursor-pointer bg-[#F8FAFC] transition-colors space-y-2"
            >
              <Upload className="w-8 h-8 text-[#94A3B8] mx-auto" />
              <div className="text-[13px] font-semibold text-[#1E293B]">
                이미지 파일 선택 (PNG, JPG)
              </div>
              <div className="text-[11px] text-[#64748B]">클릭하여 그래프 캡처 파일 업로드</div>
            </div>
            <input
              ref={digitizeInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  handleImageDigitize(e.target.files[0]);
                }
              }}
            />

            <div className="p-3 bg-amber-50 rounded-[10px] border border-amber-200 text-amber-800 text-[11px]">
              ※ 픽셀 분해능 및 스케일 왜곡에 따라 미세 오차가 발생할 수 있으며, 원본 실측치와 명확히 구분되어 표기됩니다.
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 2: Annotation Editor                                 */}
      {/* ========================================================= */}
      {showAnnotationModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[20px] max-w-lg w-full p-6 shadow-2xl border border-[#E5E8EB] space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Tag className="w-5 h-5 text-[#3182F6]" />
                <h3 className="text-[17px] font-bold text-[#191F28]">XRD 어노테이션 관리</h3>
              </div>
              <button
                onClick={() => setShowAnnotationModal(false)}
                className="text-[#8B95A1] hover:text-[#191F28]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {annotations.map((ann, aIdx) => (
                <div
                  key={ann.id}
                  className="p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-[10px] flex items-center justify-between text-[12px]"
                >
                  <div className="space-y-0.5">
                    <div className="font-bold text-[#0F172A]">
                      {ann.hkl ? `(${ann.hkl}) 밀러 지수` : ann.text} @ 2θ = {ann.x}°
                    </div>
                    <div className="text-[11px] text-[#64748B]">
                      검증 상태:{" "}
                      <span className="font-semibold text-blue-600">
                        {ann.verification_status || "사용자 등록"}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setAnnotations((prev) => prev.filter((a) => a.id !== ann.id))}
                    className="p-1 hover:bg-red-50 text-red-500 rounded"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add New Annotation */}
            <div className="pt-3 border-t border-[#E5E8EB] flex gap-2">
              <input
                type="text"
                placeholder="(hkl) 또는 상 이름"
                id="new_ann_text"
                className="flex-1 px-3 py-1.5 border border-[#CBD5E1] rounded-[8px] text-[12px]"
              />
              <input
                type="number"
                step="0.1"
                placeholder="2θ 각도"
                id="new_ann_x"
                className="w-24 px-2 py-1.5 border border-[#CBD5E1] rounded-[8px] text-[12px]"
              />
              <button
                type="button"
                onClick={() => {
                  const txtEl = document.getElementById("new_ann_text") as HTMLInputElement;
                  const xEl = document.getElementById("new_ann_x") as HTMLInputElement;
                  if (txtEl && xEl && txtEl.value && xEl.value) {
                    setAnnotations((prev) => [
                      ...prev,
                      {
                        id: `ann_${Date.now()}`,
                        type: "miller_index",
                        x: parseFloat(xEl.value),
                        y: 1.0,
                        text: txtEl.value,
                        hkl: txtEl.value.replace(/[()]/g, ""),
                        verification_status: "User Added",
                      },
                    ]);
                    txtEl.value = "";
                    xEl.value = "";
                  }
                }}
                className="px-3 py-1.5 bg-[#3182F6] hover:bg-[#2563EB] text-white text-[12px] font-semibold rounded-[8px]"
              >
                추가
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* DRAWER: Graph Style Editor                                 */}
      {/* ========================================================= */}
      {showEditorDrawer && (
        <div className="fixed inset-y-0 right-0 w-80 bg-white shadow-2xl border-l border-[#E5E8EB] z-50 p-5 space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between pb-3 border-b border-[#E5E8EB]">
            <h3 className="text-[16px] font-bold text-[#191F28] flex items-center gap-2">
              <Settings className="w-4 h-4 text-[#3182F6]" />
              그래프 스타일 편집
            </h3>
            <button
              onClick={() => setShowEditorDrawer(false)}
              className="text-[#8B95A1] hover:text-[#191F28]"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-3 text-[12px]">
            <div>
              <label className="font-semibold text-[#333D4B] block mb-1">그래프 제목</label>
              <input
                type="text"
                value={plotTitle}
                onChange={(e) => setPlotTitle(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-[#CBD5E1] rounded-[8px]"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="font-semibold text-[#333D4B] block mb-1">X축 레이블</label>
                <input
                  type="text"
                  value={xAxisLabel}
                  onChange={(e) => setXAxisLabel(e.target.value)}
                  className="w-full px-2 py-1.5 border border-[#CBD5E1] rounded-[8px]"
                />
              </div>
              <div>
                <label className="font-semibold text-[#333D4B] block mb-1">X축 단위</label>
                <input
                  type="text"
                  value={xAxisUnit}
                  onChange={(e) => setXAxisUnit(e.target.value)}
                  className="w-full px-2 py-1.5 border border-[#CBD5E1] rounded-[8px]"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="font-semibold text-[#333D4B] block mb-1">Y축 레이블</label>
                <input
                  type="text"
                  value={yAxisLabel}
                  onChange={(e) => setYAxisLabel(e.target.value)}
                  className="w-full px-2 py-1.5 border border-[#CBD5E1] rounded-[8px]"
                />
              </div>
              <div>
                <label className="font-semibold text-[#333D4B] block mb-1">Y축 단위</label>
                <input
                  type="text"
                  value={yAxisUnit}
                  onChange={(e) => setYAxisUnit(e.target.value)}
                  className="w-full px-2 py-1.5 border border-[#CBD5E1] rounded-[8px]"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="font-semibold text-[#333D4B] block mb-1">X축 최소 (Min)</label>
                <input
                  type="number"
                  placeholder="자동"
                  value={customXMin}
                  onChange={(e) => setCustomXMin(e.target.value)}
                  className="w-full px-2 py-1.5 border border-[#CBD5E1] rounded-[8px]"
                />
              </div>
              <div>
                <label className="font-semibold text-[#333D4B] block mb-1">X축 최대 (Max)</label>
                <input
                  type="number"
                  placeholder="자동"
                  value={customXMax}
                  onChange={(e) => setCustomXMax(e.target.value)}
                  className="w-full px-2 py-1.5 border border-[#CBD5E1] rounded-[8px]"
                />
              </div>
            </div>

            <div>
              <label className="font-semibold text-[#333D4B] block mb-1">폰트 크기</label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="9"
                  max="18"
                  value={fontSize}
                  onChange={(e) => setFontSize(parseInt(e.target.value))}
                  className="flex-1 accent-[#3182F6]"
                />
                <span className="w-8 text-right font-mono">{fontSize}pt</span>
              </div>
            </div>

            <div>
              <label className="font-semibold text-[#333D4B] block mb-1">범례(Legend) 위치</label>
              <select
                value={legendLocation}
                onChange={(e) => setLegendLocation(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-[#CBD5E1] rounded-[8px] bg-white"
              >
                <option value="upper right">우측 상단 (Upper Right)</option>
                <option value="upper left">좌측 상단 (Upper Left)</option>
                <option value="lower right">우측 하단 (Lower Right)</option>
                <option value="lower left">좌측 하단 (Lower Left)</option>
              </select>
            </div>

            <div className="pt-2 border-t border-[#E5E8EB]">
              <label className="flex items-center gap-2 cursor-pointer font-semibold text-[#333D4B]">
                <input
                  type="checkbox"
                  checked={showGrid}
                  onChange={(e) => setShowGrid(e.target.checked)}
                  className="rounded text-[#3182F6]"
                />
                <span>격자 표시 (Grid Visibility)</span>
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
