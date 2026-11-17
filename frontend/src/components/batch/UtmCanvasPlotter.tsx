import { useEffect, useRef, useState } from "react";
import type { UniversalDataset, UtmBatchAnalysisResult } from "../../core/batch/types";

interface UtmCanvasPlotterProps {
  datasets: UniversalDataset<any, UtmBatchAnalysisResult>[];
  chartMode: "stress_strain" | "load_disp";
  showMeanCurve: boolean;
  showStdDevBand: boolean;
  onToggleVisible?: (id: string) => void;
  height?: number;
}

export function UtmCanvasPlotter({
  datasets,
  chartMode,
  showMeanCurve,
  showStdDevBand,
  height = 460,
}: UtmCanvasPlotterProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Mouse hover state for multi-crosshair
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [hoverY, setHoverY] = useState<number | null>(null);
  const [hoverData, setHoverData] = useState<{
    xVal: number;
    points: { name: string; cond: string; color: string; yVal: number }[];
  } | null>(null);

  const visibleDatasets = datasets.filter((d) => d.visible && d.analysisResult?.curves);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Margins
    const m = { top: 35, right: 30, bottom: 50, left: 65 };
    const plotW = width - m.left - m.right;
    const plotH = height - m.top - m.bottom;

    // Background
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, height);

    if (visibleDatasets.length === 0) {
      ctx.fillStyle = "#6B7684";
      ctx.font = "14px Pretendard, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("표시할 활성 시편 곡선이 없습니다.", width / 2, height / 2);
      ctx.restore();
      return;
    }

    // Determine Global Max
    let maxX = 0.01;
    let maxY = 0.01;

    visibleDatasets.forEach((d) => {
      const c = d.analysisResult!.curves;
      const xArr = chartMode === "stress_strain" ? c.strainPct : (c.dispMm || []);
      const yArr = chartMode === "stress_strain" ? c.stressMpa : (c.loadN || []);

      if (xArr.length > 0) {
        maxX = Math.max(maxX, Math.max(...xArr));
      }
      if (yArr.length > 0) {
        maxY = Math.max(maxY, Math.max(...yArr));
      }
    });

    // Add 8% headroom
    maxX *= 1.08;
    maxY *= 1.08;

    // Coordinate conversion
    const scaleX = (x: number) => m.left + (x / maxX) * plotW;
    const scaleY = (y: number) => m.top + plotH - (y / maxY) * plotH;
    const invScaleX = (px: number) => ((px - m.left) / plotW) * maxX;

    // Gridlines & Ticks
    const numTicksX = 7;
    const numTicksY = 6;

    ctx.strokeStyle = "#F2F4F6";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#8B95A1";
    ctx.font = "11px Pretendard, sans-serif";

    // X Grid
    for (let i = 0; i <= numTicksX; i++) {
      const val = (maxX / numTicksX) * i;
      const x = scaleX(val);
      ctx.beginPath();
      ctx.moveTo(x, m.top);
      ctx.lineTo(x, m.top + plotH);
      ctx.stroke();

      ctx.textAlign = "center";
      ctx.fillText(val.toFixed(val >= 10 ? 1 : 2), x, m.top + plotH + 18);
    }

    // Y Grid
    for (let i = 0; i <= numTicksY; i++) {
      const val = (maxY / numTicksY) * i;
      const y = scaleY(val);
      ctx.beginPath();
      ctx.moveTo(m.left, y);
      ctx.lineTo(m.left + plotW, y);
      ctx.stroke();

      ctx.textAlign = "right";
      ctx.fillText(val.toFixed(val >= 10 ? 1 : 2), m.left - 10, y + 4);
    }

    // Axis Lines
    ctx.strokeStyle = "#D1D6DB";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(m.left, m.top);
    ctx.lineTo(m.left, m.top + plotH);
    ctx.lineTo(m.left + plotW, m.top + plotH);
    ctx.stroke();

    // Axis Labels
    ctx.fillStyle = "#333D4B";
    ctx.font = "bold 12px Pretendard, sans-serif";
    ctx.textAlign = "center";
    const xLabel = chartMode === "stress_strain" ? "변형률 Strain ε (%)" : "변위 Displacement (mm)";
    ctx.fillText(xLabel, m.left + plotW / 2, height - 12);

    ctx.save();
    ctx.translate(18, m.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    const yLabel = chartMode === "stress_strain" ? "공칭 응력 Stress σ (MPa)" : "시험 하중 Load (N)";
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();

    // -------------------------------------------------------------
    // Calculate Mean Curve and Std Dev Band across visible datasets
    // -------------------------------------------------------------
    if ((showMeanCurve || showStdDevBand) && visibleDatasets.length >= 2) {
      const nGrid = 150;
      const gridX: number[] = [];
      const meanY: number[] = [];
      const stdY: number[] = [];

      for (let i = 0; i <= nGrid; i++) {
        const x = (maxX / nGrid) * i;
        gridX.push(x);

        // Interpolate y value for each dataset at x
        const interpolatedY: number[] = [];
        visibleDatasets.forEach((d) => {
          const c = d.analysisResult!.curves;
          const xArr = chartMode === "stress_strain" ? c.strainPct : (c.dispMm || []);
          const yArr = chartMode === "stress_strain" ? c.stressMpa : (c.loadN || []);

          if (xArr.length >= 2 && x <= xArr[xArr.length - 1]) {
            // Find segment
            let idx = 0;
            while (idx < xArr.length - 1 && xArr[idx + 1] < x) {
              idx++;
            }
            if (idx < xArr.length - 1) {
              const x0 = xArr[idx];
              const x1 = xArr[idx + 1];
              const y0 = yArr[idx];
              const y1 = yArr[idx + 1];
              const t = (x - x0) / (x1 - x0 || 1);
              interpolatedY.push(y0 + t * (y1 - y0));
            }
          }
        });

        if (interpolatedY.length >= 2) {
          const mean = interpolatedY.reduce((a, b) => a + b, 0) / interpolatedY.length;
          const variance =
            interpolatedY.reduce((a, b) => a + Math.pow(b - mean, 2), 0) /
            (interpolatedY.length - 1);
          meanY.push(mean);
          stdY.push(Math.sqrt(variance));
        } else {
          meanY.push(NaN);
          stdY.push(NaN);
        }
      }

      // Draw ±1σ Shaded Band Polygon
      if (showStdDevBand) {
        ctx.fillStyle = "rgba(49, 130, 246, 0.16)";
        ctx.beginPath();
        let started = false;

        // Top line (+1 sigma)
        for (let i = 0; i < gridX.length; i++) {
          if (!isNaN(meanY[i])) {
            const px = scaleX(gridX[i]);
            const py = scaleY(meanY[i] + stdY[i]);
            if (!started) {
              ctx.moveTo(px, py);
              started = true;
            } else {
              ctx.lineTo(px, py);
            }
          }
        }

        // Bottom line (-1 sigma, backwards)
        for (let i = gridX.length - 1; i >= 0; i--) {
          if (!isNaN(meanY[i])) {
            const px = scaleX(gridX[i]);
            const py = scaleY(Math.max(0, meanY[i] - stdY[i]));
            ctx.lineTo(px, py);
          }
        }

        ctx.closePath();
        ctx.fill();
      }

      // Draw Mean Curve
      if (showMeanCurve) {
        ctx.strokeStyle = "#1E293B"; // Dark slate bold
        ctx.lineWidth = 3.0;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < gridX.length; i++) {
          if (!isNaN(meanY[i])) {
            const px = scaleX(gridX[i]);
            const py = scaleY(meanY[i]);
            if (!started) {
              ctx.moveTo(px, py);
              started = true;
            } else {
              ctx.lineTo(px, py);
            }
          }
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // -------------------------------------------------------------
    // Draw Individual Specimen Curves
    // -------------------------------------------------------------
    visibleDatasets.forEach((d) => {
      const c = d.analysisResult!.curves;
      const xArr = chartMode === "stress_strain" ? c.strainPct : (c.dispMm || []);
      const yArr = chartMode === "stress_strain" ? c.stressMpa : (c.loadN || []);

      if (xArr.length < 2) return;

      ctx.strokeStyle = d.color;
      ctx.lineWidth = 2.2;
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(scaleX(xArr[0]), scaleY(yArr[0]));

      for (let i = 1; i < xArr.length; i++) {
        ctx.lineTo(scaleX(xArr[i]), scaleY(yArr[i]));
      }
      ctx.stroke();
    });

    // -------------------------------------------------------------
    // Draw Multi-Crosshair if mouse hover is active
    // -------------------------------------------------------------
    if (hoverX != null && hoverX >= m.left && hoverX <= m.left + plotW) {
      const xVal = invScaleX(hoverX);

      // Vertical line
      ctx.strokeStyle = "#475569";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hoverX, m.top);
      ctx.lineTo(hoverX, m.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      // Collect points from each dataset at this xVal
      const points: { name: string; cond: string; color: string; yVal: number }[] = [];

      visibleDatasets.forEach((d) => {
        const c = d.analysisResult!.curves;
        const xArr = chartMode === "stress_strain" ? c.strainPct : (c.dispMm || []);
        const yArr = chartMode === "stress_strain" ? c.stressMpa : (c.loadN || []);

        let closestIdx = 0;
        let minDiff = Infinity;
        for (let i = 0; i < xArr.length; i++) {
          const diff = Math.abs(xArr[i] - xVal);
          if (diff < minDiff) {
            minDiff = diff;
            closestIdx = i;
          }
        }

        if (minDiff < maxX * 0.08) {
          const yVal = yArr[closestIdx];
          points.push({
            name: d.sampleName,
            cond: d.specimenOrCondition,
            color: d.color,
            yVal,
          });

          // Draw marker circle
          const px = scaleX(xArr[closestIdx]);
          const py = scaleY(yVal);
          ctx.fillStyle = "#FFFFFF";
          ctx.strokeStyle = d.color;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(px, py, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      });

      setHoverData({ xVal, points });
    } else {
      setHoverData(null);
    }

    ctx.restore();
  }, [
    visibleDatasets,
    chartMode,
    showMeanCurve,
    showStdDevBand,
    height,
    hoverX,
  ]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHoverX(e.clientX - rect.left);
    setHoverY(e.clientY - rect.top);
  };

  const handleMouseLeave = () => {
    setHoverX(null);
    setHoverY(null);
    setHoverData(null);
  };

  return (
    <div ref={containerRef} className="relative w-full overflow-hidden select-none">
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="block cursor-crosshair rounded-[14px]"
      />

      {/* Floating Multi-Crosshair Tooltip Card */}
      {hoverData && hoverData.points.length > 0 && hoverX != null && hoverY != null && (
        <div
          className="absolute z-30 pointer-events-none bg-[#191F28]/95 text-white p-3 rounded-[12px] shadow-xl text-[12px] border border-white/10 backdrop-blur-md"
          style={{
            left: Math.min(hoverX + 16, (containerRef.current?.clientWidth || 600) - 180),
            top: Math.max(10, Math.min(hoverY - 20, height - 140)),
          }}
        >
          <div className="font-bold border-b border-white/15 pb-1 mb-1.5 text-[#93C5FD]">
            {chartMode === "stress_strain" ? `변형률 ε = ${hoverData.xVal.toFixed(3)}%` : `변위 = ${hoverData.xVal.toFixed(3)} mm`}
          </div>
          <div className="space-y-1">
            {hoverData.points.map((pt, idx) => (
              <div key={idx} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 font-medium truncate max-w-[110px]">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: pt.color }} />
                  {pt.name} ({pt.cond})
                </span>
                <span className="font-mono font-bold">
                  {pt.yVal.toFixed(2)} {chartMode === "stress_strain" ? "MPa" : "N"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
