import { useEffect, useRef } from "react";
import Plotly from "plotly.js-dist-min";

interface PlotlyChartProps {
  data: any[];
  layout: Record<string, any>;
  height?: number;
  config?: Record<string, any>;
  style?: React.CSSProperties;
  onPointClick?: (point: any) => void;
}

export function PlotlyChart({ data, layout, height = 420, config: userConfig, style, onPointClick }: PlotlyChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const mergedLayout = {
      autosize: true,
      height,
      paper_bgcolor: "#FFFFFF",
      plot_bgcolor: "#FFFFFF",
      font: {
        family:
          'Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
        color: "#191F28",
        size: 12,
      },
      margin: { l: 56, r: 20, t: 28, b: 48 },
      ...layout,
    };

    const config: Partial<Plotly.Config> = {
      responsive: true,
      displaylogo: false,
      modeBarButtonsToRemove: ["lasso2d", "select2d"],
      ...userConfig,
    };

    Plotly.react(el, data, mergedLayout, config);

    const plotEl = el as any;
    const handleClick = (ev: any) => {
      if (onPointClick && ev?.points?.length > 0) {
        onPointClick(ev.points[0]);
      }
    };
    if (onPointClick && plotEl.on) {
      plotEl.on("plotly_click", handleClick);
    }

    const handleResize = () => {
      if (containerRef.current && containerRef.current.offsetWidth > 0) {
        Plotly.Plots.resize(containerRef.current);
      }
    };
    window.addEventListener("resize", handleResize);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => {
        handleResize();
      });
      ro.observe(el);
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      if (ro) {
        ro.disconnect();
      }
      if (plotEl?.removeAllListeners) {
        plotEl.removeAllListeners("plotly_click");
      }
    };
  }, [data, layout, height, onPointClick]);

  useEffect(() => {
    return () => {
      if (containerRef.current) {
        Plotly.purge(containerRef.current);
      }
    };
  }, []);

  return <div ref={containerRef} style={style} className="w-full overflow-hidden rounded-[14px]" />;
}
