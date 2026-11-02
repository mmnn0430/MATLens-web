import React, { useEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut, RotateCcw, Ruler, Crop, MousePointerClick } from "lucide-react";
import type { Point2D, ROIRect, SEMParams } from "../types";
import { Button, cn } from "./ui/primitives";

interface SemInteractiveCanvasProps {
  imageUrl: string;
  mode: "setup" | "result_particle" | "result_grain";
  semParams: SEMParams;
  onChangeParams: (next: SEMParams) => void;
  /** Objects in ROI coords for result_particle click-to-exclude */
  objects?: Array<{
    object_id: number;
    excluded: boolean;
    roi_cx: number;
    roi_cy: number;
    roi_bbox: [number, number, number, number];
    equiv_diameter: number;
    unit: string;
  }>;
  /** Grain intersections in ROI coords for result_grain click-to-edit */
  intersections?: Array<{
    id: string;
    x: number;
    y: number;
    source: string;
    removed: boolean;
  }>;
  /** Representative grains from grain_phase_map */
  grains?: Array<{
    grain_id: string;
    zone: string;
    roi_x: number;
    roi_y: number;
    bbox: [number, number, number, number];
    predicted_formula: string;
    color_hex?: string;
  }>;
  selectedGrainId?: string | null;
  onSelectGrain?: (grainId: string) => void;
  showGrainMarkers?: boolean;
  detectedDatabarY?: number | null;
}

export function SemInteractiveCanvas({
  imageUrl,
  mode,
  semParams,
  onChangeParams,
  objects = [],
  intersections = [],
  grains = [],
  selectedGrainId = null,
  onSelectGrain,
  showGrainMarkers = true,
  detectedDatabarY,
}: SemInteractiveCanvasProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [natSize, setNatSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [zoom, setZoom] = useState<number>(1);
  const [tool, setTool] = useState<"scale" | "roi" | "inspect">(
    mode === "setup" ? "scale" : "inspect"
  );
  const [pendingPt, setPendingPt] = useState<Point2D | null>(null);
  const [dragStart, setDragStart] = useState<Point2D | null>(null);

  useEffect(() => {
    setTool(mode === "setup" ? "scale" : "inspect");
    setPendingPt(null);
  }, [mode]);

  const toImageCoords = (e: React.MouseEvent<SVGSVGElement>): Point2D | null => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height || !natSize.w || !natSize.h) return null;
    const x = ((e.clientX - rect.left) / rect.width) * natSize.w;
    const y = ((e.clientY - rect.top) / rect.height) * natSize.h;
    return {
      x: Math.max(0, Math.min(natSize.w, x)),
      y: Math.max(0, Math.min(natSize.h, y)),
    };
  };

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const pt = toImageCoords(e);
    if (!pt) return;

    if (mode === "setup" && tool === "scale") {
      if (!pendingPt) {
        setPendingPt(pt);
      } else {
        const dx = pt.x - pendingPt.x;
        const dy = pt.y - pendingPt.y;
        const lenPx = Math.hypot(dx, dy);
        if (lenPx >= 4) {
          onChangeParams({
            ...semParams,
            scale_x0: Math.round(pendingPt.x * 10) / 10,
            scale_y0: Math.round(pendingPt.y * 10) / 10,
            scale_x1: Math.round(pt.x * 10) / 10,
            scale_y1: Math.round(pt.y * 10) / 10,
            scale_length_px: Math.round(lenPx * 10) / 10,
          });
        }
        setPendingPt(null);
      }
      return;
    }

    if (mode === "result_particle" && tool === "inspect") {
      // Find nearest particle containing click point
      let hitObj: (typeof objects)[number] | null = null;
      let bestDist = Infinity;
      for (const o of objects) {
        const [minC, minR, maxC, maxR] = o.roi_bbox;
        if (pt.x >= minC - 3 && pt.x <= maxC + 3 && pt.y >= minR - 3 && pt.y <= maxR + 3) {
          const d = Math.hypot(pt.x - o.roi_cx, pt.y - o.roi_cy);
          if (d < bestDist) {
            bestDist = d;
            hitObj = o;
          }
        }
      }
      if (hitObj) {
        const cur = new Set(semParams.excluded_object_ids);
        if (cur.has(hitObj.object_id)) {
          cur.delete(hitObj.object_id);
        } else {
          cur.add(hitObj.object_id);
        }
        onChangeParams({ ...semParams, excluded_object_ids: Array.from(cur) });
      }
      return;
    }

    if (mode === "result_grain" && tool === "inspect") {
      // Check if clicking near an existing intersection (within 10 px)
      let nearest: (typeof intersections)[number] | null = null;
      let minD = 12;
      for (const ip of intersections) {
        const d = Math.hypot(pt.x - ip.x, pt.y - ip.y);
        if (d < minD) {
          minD = d;
          nearest = ip;
        }
      }
      if (nearest) {
        if (nearest.source === "manual") {
          const idx = parseInt(nearest.id.replace("USER-H", ""), 10) - 1;
          const nextAdded = semParams.added_intersections.filter((_, i) => i !== idx);
          onChangeParams({ ...semParams, added_intersections: nextAdded });
        } else {
          const rem = new Set(semParams.removed_intersection_ids);
          if (rem.has(nearest.id)) rem.delete(nearest.id);
          else rem.add(nearest.id);
          onChangeParams({ ...semParams, removed_intersection_ids: Array.from(rem) });
        }
      } else {
        onChangeParams({
          ...semParams,
          added_intersections: [
            ...semParams.added_intersections,
            { x: Math.round(pt.x * 10) / 10, y: Math.round(pt.y * 10) / 10 },
          ],
        });
      }
    }
  };

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (mode === "setup" && tool === "roi") {
      const pt = toImageCoords(e);
      if (pt) setDragStart(pt);
    }
  };

  const handleMouseUp = (e: React.MouseEvent<SVGSVGElement>) => {
    if (mode === "setup" && tool === "roi" && dragStart) {
      const pt = toImageCoords(e);
      if (pt) {
        const x = Math.round(Math.min(dragStart.x, pt.x));
        const y = Math.round(Math.min(dragStart.y, pt.y));
        const w = Math.round(Math.abs(pt.x - dragStart.x));
        const h = Math.round(Math.abs(pt.y - dragStart.y));
        if (w >= 32 && h >= 32) {
          const nextRoi: ROIRect = { x, y, w, h };
          onChangeParams({ ...semParams, roi: nextRoi });
        }
      }
      setDragStart(null);
    }
  };

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[#F7F8FA] p-2.5 rounded-[14px] border border-[#E5E8EB]">
        <div className="flex flex-wrap items-center gap-1.5">
          {mode === "setup" && (
            <>
              <Button
                type="button"
                size="sm"
                variant={tool === "scale" ? "primary" : "outline"}
                onClick={() => {
                  setTool("scale");
                  setPendingPt(null);
                }}
              >
                <Ruler className="w-4 h-4" />
                스케일바 양 끝점 지정
              </Button>
              <Button
                type="button"
                size="sm"
                variant={tool === "roi" ? "primary" : "outline"}
                onClick={() => setTool("roi")}
              >
                <Crop className="w-4 h-4" />
                분석 영역(ROI) 드래그
              </Button>
            </>
          )}
          {mode === "result_particle" && (
            <span className="inline-flex items-center gap-1.5 text-[13px] text-[#191F28] font-medium px-2">
              <MousePointerClick className="w-4 h-4 text-[#3182F6]" />
              입자를 클릭하면 잘못 분리된 객체를 통계에서 제외/복원합니다 (제외 {semParams.excluded_object_ids.length}개)
            </span>
          )}
          {mode === "result_grain" && (
            <span className="inline-flex items-center gap-1.5 text-[13px] text-[#191F28] font-medium px-2">
              <MousePointerClick className="w-4 h-4 text-[#3182F6]" />
              노란 교차점을 클릭해 제외하거나 빈 경계를 클릭해 교차점을 수동 추가합니다
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)))}
            aria-label="축소"
          >
            <ZoomOut className="w-4 h-4" />
          </Button>
          <span className="text-[12px] font-semibold text-[#6B7684] px-1.5 tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setZoom((z) => Math.min(3, +(z + 0.5).toFixed(1)))}
            aria-label="확대"
          >
            <ZoomIn className="w-4 h-4" />
          </Button>
          {zoom > 1 && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setZoom(1)}>
              <RotateCcw className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {mode === "setup" && tool === "scale" && (
        <div className="text-[12px] text-[#6B7684] px-1">
          {pendingPt
            ? "첫 번째 끝점이 선택되었습니다. 스케일바의 반대쪽 끝점을 클릭해주세요."
            : "이미지 하단 스케일바의 왼쪽 끝과 오른쪽 끝을 차례대로 클릭하면 픽셀 길이가 원본 해상도 기준으로 측정됩니다."}
        </div>
      )}

      {/* Scrollable zoom viewport */}
      <div className="relative overflow-auto max-h-[600px] rounded-[16px] border border-[#E5E8EB] bg-[#191F28]">
        <div
          className="relative mx-auto select-none"
          style={{ width: `${zoom * 100}%` }}
        >
          <img
            ref={imgRef}
            src={imageUrl}
            alt="SEM 분석 이미지"
            className="block w-full h-auto"
            onLoad={(e) => {
              const el = e.currentTarget;
              setNatSize({ w: el.naturalWidth, h: el.naturalHeight });
            }}
          />
          {natSize.w > 0 && natSize.h > 0 && (
            <svg
              viewBox={`0 0 ${natSize.w} ${natSize.h}`}
              className={cn(
                "absolute inset-0 w-full h-full",
                mode === "setup" || mode === "result_particle" || mode === "result_grain"
                  ? "cursor-crosshair"
                  : ""
              )}
              onClick={handleSvgClick}
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
            >
              {/* Setup Mode Overlays: Excluded Info Bar, ROI Box, Scale Bar Endpoints */}
              {mode === "setup" && detectedDatabarY && detectedDatabarY < natSize.h && (
                <g>
                  <line
                    x1={0}
                    y1={detectedDatabarY}
                    x2={natSize.w}
                    y2={detectedDatabarY}
                    stroke="#D97706"
                    strokeWidth={Math.max(2, natSize.w * 0.002)}
                    strokeDasharray="8 6"
                  />
                </g>
              )}

              {mode === "setup" && semParams.roi && (
                <rect
                  x={semParams.roi.x}
                  y={semParams.roi.y}
                  width={semParams.roi.w}
                  height={semParams.roi.h}
                  fill="rgba(49, 130, 246, 0.08)"
                  stroke="#3182F6"
                  strokeWidth={Math.max(2.5, natSize.w * 0.0025)}
                />
              )}

              {mode === "setup" &&
                semParams.scale_x0 !== null &&
                semParams.scale_y0 !== null &&
                semParams.scale_x1 !== null &&
                semParams.scale_y1 !== null && (
                  <g>
                    <line
                      x1={semParams.scale_x0}
                      y1={semParams.scale_y0}
                      x2={semParams.scale_x1}
                      y2={semParams.scale_y1}
                      stroke="#16A34A"
                      strokeWidth={Math.max(3, natSize.w * 0.0035)}
                    />
                    <circle
                      cx={semParams.scale_x0}
                      cy={semParams.scale_y0}
                      r={Math.max(5, natSize.w * 0.006)}
                      fill="#16A34A"
                      stroke="#FFFFFF"
                      strokeWidth={2}
                    />
                    <circle
                      cx={semParams.scale_x1}
                      cy={semParams.scale_y1}
                      r={Math.max(5, natSize.w * 0.006)}
                      fill="#16A34A"
                      stroke="#FFFFFF"
                      strokeWidth={2}
                    />
                  </g>
                )}

              {pendingPt && (
                <circle
                  cx={pendingPt.x}
                  cy={pendingPt.y}
                  r={Math.max(6, natSize.w * 0.007)}
                  fill="#3182F6"
                  stroke="#FFFFFF"
                  strokeWidth={2}
                />
              )}

              {/* Particle Result Mode: Highlight newly toggled exclusions immediately */}
              {mode === "result_particle" &&
                objects
                  .filter((o) => semParams.excluded_object_ids.includes(o.object_id))
                  .map((o) => {
                    const [minC, minR, maxC, maxR] = o.roi_bbox;
                    return (
                      <g key={o.object_id}>
                        <rect
                          x={minC}
                          y={minR}
                          width={maxC - minC}
                          height={maxR - minR}
                          fill="rgba(220, 38, 38, 0.22)"
                          stroke="#DC2626"
                          strokeWidth={2}
                          strokeDasharray="4 3"
                        />
                      </g>
                    );
                  })}

              {/* Grain Phase Identification Markers (G1..GN) */}
              {showGrainMarkers && grains.length > 0 && (
                <g className="grain-phase-markers">
                  {grains.map((g) => {
                    const isSelected = selectedGrainId === g.grain_id;
                    const col = g.color_hex || (g.zone === "matrix" ? "#3182F6" : g.zone === "bright" ? "#F59E0B" : "#10B981");
                    const [minC, minR, maxC, maxR] = g.bbox;
                    const w = Math.max(maxC - minC, 12);
                    const h = Math.max(maxR - minR, 12);
                    return (
                      <g
                        key={g.grain_id}
                        className="cursor-pointer transition-opacity hover:opacity-90"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onSelectGrain) onSelectGrain(g.grain_id);
                        }}
                      >
                        <rect
                          x={minC}
                          y={minR}
                          width={w}
                          height={h}
                          fill={isSelected ? `${col}33` : "transparent"}
                          stroke={col}
                          strokeWidth={isSelected ? 3 : 1.5}
                          strokeDasharray={isSelected ? undefined : "3 2"}
                          rx={3}
                        />
                        <circle
                          cx={g.roi_x}
                          cy={g.roi_y}
                          r={isSelected ? 6 : 4}
                          fill={col}
                          stroke="#FFFFFF"
                          strokeWidth={1.5}
                        />
                        {/* Badge with Grain ID and Formula */}
                        <g transform={`translate(${g.roi_x + 6}, ${g.roi_y - 6})`}>
                          <rect
                            x={0}
                            y={-14}
                            width={g.grain_id.length * 8 + g.predicted_formula.length * 7 + 14}
                            height={18}
                            rx={4}
                            fill={isSelected ? "#191F28" : "rgba(25, 31, 40, 0.85)"}
                            stroke={col}
                            strokeWidth={isSelected ? 1.5 : 0.8}
                          />
                          <text
                            x={4}
                            y={-2}
                            fill="#FFFFFF"
                            fontSize="11"
                            fontWeight="bold"
                            fontFamily="monospace"
                          >
                            {g.grain_id}:
                          </text>
                          <text
                            x={g.grain_id.length * 8 + 6}
                            y={-2}
                            fill={isSelected ? "#90B8F8" : "#E5E8EB"}
                            fontSize="10"
                            fontWeight="600"
                          >
                            {g.predicted_formula}
                          </text>
                        </g>
                      </g>
                    );
                  })}
                </g>
              )}
            </svg>
          )}
        </div>
      </div>

      {natSize.w > 0 && (
        <div className="flex flex-wrap items-center justify-between text-[12px] text-[#6B7684] px-1">
          <span>
            표시 해상도: {natSize.w} × {natSize.h} px
          </span>
          {mode === "setup" && semParams.roi && (
            <span>
              분석 영역(ROI): ({semParams.roi.x}, {semParams.roi.y}) · {semParams.roi.w} × {semParams.roi.h} px
            </span>
          )}
        </div>
      )}
    </div>
  );
}
