import { useMemo, useState } from "react";
import {
  Upload,
  AlertTriangle,
  Download,
  Eye,
  EyeOff,
  Layers,
  Play,
  Trash2,
  Info,
} from "lucide-react";
import { api } from "../api";
import type { UTMAnalysisResult, UTMParsedData } from "../types";
import { Button, Card } from "./ui/primitives";
import { PlotlyChart } from "./PlotlyChart";

/**
 * [Prototype] 복수 UTM 반복 시험 비교 분석
 * - 기획안 3순위: 복수 UTM 데이터 일괄 업로드, 파일별 독립 분석, 응력-변형률 곡선 중첩, 물성 편차 비교
 * - 수치 계산은 모두 기존 Python 엔진(/api/utm/analyze)을 파일별로 호출하여 수행한다.
 * - 통계(평균·표준편차·CV)는 '유효'로 판정된 값만 사용하며, 사용된 표본 수(n)를 함께 표시한다.
 */

const PALETTE = ["#2563EB", "#DC2626", "#16A34A", "#D97706", "#7C3AED", "#0891B2", "#DB2777", "#4B5563"];

interface SpecimenEntry {
  id: string;
  filename: string;
  label: string;
  color: string;
  visible: boolean;
  parsed: UTMParsedData | null;
  result: UTMAnalysisResult | null;
  endIndexUsed: number | null;
  trimmedNegative: boolean;
  error: string | null;
  status: "parsing" | "analyzing" | "done" | "error";
}

interface SharedParams {
  elasticStartPct: string;
  elasticEndPct: string;
  calcOffsetYield: boolean;
  trimNegativeAfterPeak: boolean;
  useSpecimenDim: boolean;
  specimenA0: string;
  specimenL0: string;
}

type MetricKey = "peak_stress" | "peak_load" | "strain_at_peak" | "E" | "offset_yield";

const METRICS: { key: MetricKey; label: string; unit: string; digits: number }[] = [
  { key: "peak_stress", label: "최대 응력", unit: "MPa", digits: 3 },
  { key: "peak_load", label: "최대 하중", unit: "N", digits: 2 },
  { key: "strain_at_peak", label: "최대 응력 시 변형률", unit: "%", digits: 3 },
  { key: "E", label: "탄성계수", unit: "GPa", digits: 3 },
  { key: "offset_yield", label: "0.2% 오프셋 내력", unit: "MPa", digits: 3 },
];

function metricValue(r: UTMAnalysisResult | null, key: MetricKey): { value: number | null; reason?: string } {
  if (!r) return { value: null, reason: "분석 결과 없음" };
  switch (key) {
    case "peak_stress":
      return r.peak_stress ? { value: r.peak_stress.stress_MPa } : { value: null, reason: "응력 열 없음 (시편 치수 필요)" };
    case "peak_load":
      return r.peak_load?.load_N != null ? { value: r.peak_load.load_N } : { value: null, reason: "하중 열/단위 확인 필요" };
    case "strain_at_peak":
      return r.peak_stress?.strain_pct != null
        ? { value: r.peak_stress.strain_pct }
        : { value: null, reason: "변형률 열 없음" };
    case "E":
      if (!r.elastic_modulus) return { value: null, reason: "변형률 열 없음" };
      if (!r.elastic_modulus.is_valid || r.elastic_modulus.E_GPa == null)
        return {
          value: null,
          reason:
            r.elastic_modulus.reason ||
            `회귀 적합도 부족 (R²=${r.elastic_modulus.r_squared ?? "-"}, 기준 0.85)`,
        };
      return { value: r.elastic_modulus.E_GPa };
    case "offset_yield":
      if (!r.offset_yield)
        return {
          value: null,
          reason:
            r.elastic_modulus && !r.elastic_modulus.is_valid
              ? "탄성계수가 유효하지 않아 오프셋 선을 정의할 수 없음 (E 회귀 구간 조정 필요)"
              : "계산 미선택 또는 산출 조건 부족",
        };
      if (!r.offset_yield.is_valid || r.offset_yield.yield_stress_MPa == null)
        return { value: null, reason: r.offset_yield.reason || "교점 없음" };
      return { value: r.offset_yield.yield_stress_MPa };
  }
}

function stats(values: number[]) {
  const n = values.length;
  if (n === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { n, mean, sd: null as number | null, cv: null as number | null, min: mean, max: mean };
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  return { n, mean, sd, cv: mean !== 0 ? (sd / Math.abs(mean)) * 100 : null, min: Math.min(...values), max: Math.max(...values) };
}

const fmt = (v: number | null | undefined, d: number) => (v == null || Number.isNaN(v) ? "-" : v.toFixed(d));

export function UtmCompareView() {
  const [entries, setEntries] = useState<SpecimenEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [chartTab, setChartTab] = useState<"stress_strain" | "load_disp">("stress_strain");
  const [params, setParams] = useState<SharedParams>({
    elasticStartPct: "0.05",
    elasticEndPct: "0.30",
    calcOffsetYield: true,
    trimNegativeAfterPeak: true,
    useSpecimenDim: false,
    specimenA0: "",
    specimenL0: "",
  });

  const updateEntry = (id: string, patch: Partial<SpecimenEntry>) =>
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  /** 공통 조건으로 파일 하나를 분석. 최대 하중 이후 음수 하중 구간은 옵션에 따라 분석 범위에서 제외한다. */
  const analyzeOne = async (parsed: UTMParsedData, p: SharedParams) => {
    const num = (s: string) => {
      const v = parseFloat(s);
      return Number.isNaN(v) ? undefined : v;
    };
    const base = {
      parsed_data: parsed,
      start_index: 0,
      end_index: parsed.row_count,
      specimen_area_A0: p.useSpecimenDim && Number(p.specimenA0) > 0 ? Number(p.specimenA0) : undefined,
      specimen_gauge_L0: p.useSpecimenDim && Number(p.specimenL0) > 0 ? Number(p.specimenL0) : undefined,
      elastic_start_strain_pct: num(p.elasticStartPct),
      elastic_end_strain_pct: num(p.elasticEndPct),
      calc_offset_yield: p.calcOffsetYield,
      analysis_name: parsed.filename,
    };
    let res = await api.analyzeUtm(base);
    let endIndexUsed = parsed.row_count;
    let trimmed = false;
    if (p.trimNegativeAfterPeak && res.negative_load_summary.count > 0) {
      const loads: number[] = res.curves.load_raw;
      let peakIdx = 0;
      loads.forEach((v, i) => {
        if (v > loads[peakIdx]) peakIdx = i;
      });
      const negIdx = loads.findIndex((v, i) => i > peakIdx && v < 0);
      if (negIdx > 0) {
        endIndexUsed = negIdx;
        trimmed = true;
        res = await api.analyzeUtm({ ...base, end_index: negIdx });
      }
    }
    return { res, endIndexUsed, trimmed };
  };

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setErrorMsg(null);
    setBusy(true);
    const startCount = entries.length;
    const newEntries: SpecimenEntry[] = list.map((f, i) => ({
      id: `${Date.now()}-${i}-${f.name}`,
      filename: f.name,
      label: f.name.replace(/\.[^/.]+$/, ""),
      color: PALETTE[(startCount + i) % PALETTE.length],
      visible: true,
      parsed: null,
      result: null,
      endIndexUsed: null,
      trimmedNegative: false,
      error: null,
      status: "parsing",
    }));
    setEntries((prev) => [...prev, ...newEntries]);

    await Promise.all(
      list.map(async (file, i) => {
        const id = newEntries[i].id;
        try {
          const parsed = await api.parseUtm(file);
          updateEntry(id, { parsed, status: "analyzing" });
          const { res, endIndexUsed, trimmed } = await analyzeOne(parsed, params);
          updateEntry(id, { result: res, endIndexUsed, trimmedNegative: trimmed, status: "done" });
        } catch (err: any) {
          updateEntry(id, { status: "error", error: err?.message || "파일 처리 실패" });
        }
      }),
    );
    setBusy(false);
  };

  const reanalyzeAll = async () => {
    setBusy(true);
    setErrorMsg(null);
    await Promise.all(
      entries.map(async (e) => {
        if (!e.parsed) return;
        updateEntry(e.id, { status: "analyzing", error: null });
        try {
          const { res, endIndexUsed, trimmed } = await analyzeOne(e.parsed, params);
          updateEntry(e.id, { result: res, endIndexUsed, trimmedNegative: trimmed, status: "done" });
        } catch (err: any) {
          updateEntry(e.id, { status: "error", error: err?.message || "재계산 실패" });
        }
      }),
    );
    setBusy(false);
  };

  const done = entries.filter((e) => e.status === "done" && e.result);

  // 비교 조건 점검: 단위·응력 출처가 서로 다르면 단순 비교에 주의가 필요하다.
  const consistencyWarnings = useMemo(() => {
    const w: string[] = [];
    const stressSources = new Set(done.map((e) => e.result!.peak_stress?.source).filter(Boolean));
    if (stressSources.size > 1) w.push(`응력 산출 방식이 파일마다 다릅니다 (${[...stressSources].join(", ")}). 동일 기준으로 맞춘 뒤 비교하세요.`);
    const stressUnits = new Set(done.map((e) => e.result!.peak_stress?.stress_raw_unit).filter(Boolean));
    if (stressUnits.size > 1) w.push(`원본 응력 단위가 서로 다릅니다 (${[...stressUnits].join(", ")}). 표는 MPa로 환산된 값입니다.`);
    const loadUnits = new Set(done.map((e) => e.result!.peak_load?.load_raw_unit).filter(Boolean));
    if (loadUnits.size > 1) w.push(`원본 하중 단위가 서로 다릅니다 (${[...loadUnits].join(", ")}). 표는 N으로 환산된 값입니다.`);
    const headerSets = new Set(done.map((e) => (e.parsed?.headers || []).join("|")));
    if (headerSets.size > 1) w.push("파일 간 열 구성이 다릅니다. 서로 다른 시험기·시험 조건의 데이터인지 확인하세요.");
    if (done.length === 1) w.push("비교·통계를 위해서는 2개 이상의 시험편 데이터가 필요합니다.");
    return w;
  }, [done]);

  const statRows = useMemo(
    () =>
      METRICS.map((m) => {
        const vals = done
          .map((e) => metricValue(e.result, m.key).value)
          .filter((v): v is number => v != null && Number.isFinite(v));
        return { metric: m, s: stats(vals), excluded: done.length - vals.length };
      }),
    [done],
  );

  const chartData = useMemo(() => {
    return done
      .filter((e) => e.visible)
      .flatMap((e) => {
        const c = e.result!.curves;
        const x = chartTab === "stress_strain" ? c.strain_pct : c.disp_raw;
        const y = chartTab === "stress_strain" ? c.stress_MPa : c.load_N;
        if (!x?.length || !y?.length) return [];
        const traces: any[] = [
          {
            type: "scattergl",
            mode: "lines",
            name: e.label,
            x,
            y,
            line: { color: e.color, width: 2 },
            hovertemplate: `${e.label}<br>%{x:.3f}, %{y:.3f}<extra></extra>`,
          },
        ];
        if (chartTab === "stress_strain" && e.result!.peak_stress?.strain_pct != null) {
          traces.push({
            type: "scatter",
            mode: "markers",
            name: `${e.label} 최대 응력`,
            showlegend: false,
            x: [e.result!.peak_stress.strain_pct],
            y: [e.result!.peak_stress.stress_MPa],
            marker: { color: e.color, size: 10, symbol: "star", line: { color: "#fff", width: 1 } },
            hovertemplate: `${e.label} 최대 응력<br>%{y:.3f} MPa @ %{x:.3f}%<extra></extra>`,
          });
        }
        return traces;
      });
  }, [done, chartTab]);

  const chartLayout = useMemo(
    () => ({
      xaxis: {
        title: { text: chartTab === "stress_strain" ? "공칭 변형률 Strain (%)" : "변위 Displacement (mm)" },
        gridcolor: "#F2F4F6",
        zeroline: false,
      },
      yaxis: {
        title: { text: chartTab === "stress_strain" ? "공칭 응력 Stress (MPa)" : "하중 Load (N)" },
        gridcolor: "#F2F4F6",
        zeroline: false,
      },
      legend: { orientation: "h", y: -0.18 },
      margin: { l: 64, r: 20, t: 20, b: 80 },
    }),
    [chartTab],
  );

  const downloadComparisonCsv = () => {
    const header = [
      "시험편",
      "파일명",
      "분석 행 수",
      "분석 종료 행",
      "음수하중 이후 제외",
      ...METRICS.map((m) => `${m.label} (${m.unit})`),
      "E 회귀 R²",
      "비고",
    ];
    const rows = done.map((e) => {
      const r = e.result!;
      const notes = METRICS.map((m) => {
        const mv = metricValue(r, m.key);
        return mv.value == null ? `${m.label}: ${mv.reason}` : null;
      }).filter(Boolean);
      return [
        e.label,
        e.filename,
        r.analysis_range.count,
        e.endIndexUsed ?? "",
        e.trimmedNegative ? "예" : "아니오",
        ...METRICS.map((m) => {
          const v = metricValue(r, m.key).value;
          return v == null ? "계산 불가" : v.toFixed(m.digits);
        }),
        r.elastic_modulus?.r_squared ?? "",
        notes.join(" / "),
      ];
    });
    const statLines = (["평균", "표준편차", "CV(%)", "n"] as const).map((name) => [
      `[통계] ${name}`,
      "",
      "",
      "",
      "",
      ...statRows.map(({ s, metric }) => {
        if (!s) return "";
        if (name === "평균") return s.mean.toFixed(metric.digits);
        if (name === "표준편차") return s.sd == null ? "" : s.sd.toFixed(metric.digits);
        if (name === "CV(%)") return s.cv == null ? "" : s.cv.toFixed(2);
        return String(s.n);
      }),
      "",
      "유효값만 사용",
    ]);
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [header, ...rows, ...statLines].map((r) => r.map(esc).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "utm_specimen_comparison.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const pickFiles = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".txt,.csv,.tsv,.dat";
    input.onchange = (e: any) => e.target.files && handleFiles(e.target.files);
    input.click();
  };

  return (
    <div className="space-y-6">
      {errorMsg && (
        <div className="rounded-[16px] bg-[#FEE2E2] border border-[#FECACA] p-4 text-[13px] text-[#DC2626] flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {entries.length === 0 ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
          }}
          onClick={pickFiles}
          className="border-2 border-dashed border-[#D1D5DB] rounded-[24px] p-12 text-center bg-white/60 hover:bg-white hover:border-[#7C3AED] transition-all cursor-pointer"
        >
          <div className="w-14 h-14 rounded-full bg-[#F5F3FF] text-[#7C3AED] flex items-center justify-center mx-auto mb-4">
            <Layers className="w-7 h-7" />
          </div>
          <div className="text-[17px] font-bold text-[#191F28] mb-1">
            반복 시험 UTM 파일 여러 개를 한 번에 끌어다 놓으세요
          </div>
          <p className="text-[13px] text-[#8B95A1] max-w-lg mx-auto mb-4">
            예: abs100-3.txt, abs100-4.txt, abs100-5.txt — 파일별로 독립 분석한 뒤 응력-변형률 곡선을 하나의 그래프에
            중첩하고, 주요 물성의 평균·표준편차·변동계수(CV)를 계산합니다.
          </p>
          <Button variant="outline" size="sm">
            여러 파일 선택
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: specimens & shared params */}
          <div className="lg:col-span-4 space-y-6">
            <Card className="p-5 space-y-3">
              <div className="flex items-center justify-between border-b border-[#F2F4F6] pb-3">
                <div className="font-bold text-[15px] text-[#191F28] flex items-center gap-2">
                  <Layers className="w-4 h-4 text-[#7C3AED]" />
                  시험편 목록 ({entries.length})
                </div>
                <Button size="sm" variant="outline" onClick={pickFiles} disabled={busy}>
                  <Upload className="w-4 h-4" /> 추가
                </Button>
              </div>
              <div className="space-y-2">
                {entries.map((e) => (
                  <div key={e.id} className="flex items-center gap-2 rounded-[12px] border border-[#E5E8EB] p-2.5 bg-white">
                    <input
                      type="color"
                      value={e.color}
                      onChange={(ev) => updateEntry(e.id, { color: ev.target.value })}
                      className="w-6 h-6 rounded cursor-pointer border-0 p-0 shrink-0"
                      title="곡선 색상"
                    />
                    <div className="min-w-0 flex-1">
                      <input
                        value={e.label}
                        onChange={(ev) => updateEntry(e.id, { label: ev.target.value })}
                        className="w-full text-[13px] font-semibold text-[#191F28] bg-transparent outline-none focus:bg-[#F8FAFC] rounded px-1"
                        title="시험편 이름 (범례에 표시)"
                      />
                      <div className="text-[11px] text-[#8B95A1] px-1 truncate">
                        {e.status === "parsing" && "파일 읽는 중..."}
                        {e.status === "analyzing" && "Python 엔진 분석 중..."}
                        {e.status === "error" && <span className="text-[#DC2626]">{e.error}</span>}
                        {e.status === "done" &&
                          `${e.filename} · ${e.result?.analysis_range.count}행${e.trimmedNegative ? " · 음수하중 이후 제외" : ""}`}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => updateEntry(e.id, { visible: !e.visible })}
                      className="p-1.5 rounded hover:bg-[#F2F4F6] text-[#6B7684]"
                      title={e.visible ? "그래프에서 숨기기" : "그래프에 표시"}
                    >
                      {e.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEntries((prev) => prev.filter((x) => x.id !== e.id))}
                      className="p-1.5 rounded hover:bg-[#FEE2E2] text-[#6B7684] hover:text-[#DC2626]"
                      title="목록에서 제거"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-5 space-y-4">
              <div className="font-bold text-[15px] text-[#191F28] border-b border-[#F2F4F6] pb-3">
                공통 분석 조건 (모든 시험편에 동일 적용)
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-[12px] font-semibold text-[#4E5968]">
                  E 회귀 시작 변형률 (%)
                  <input
                    value={params.elasticStartPct}
                    onChange={(e) => setParams({ ...params, elasticStartPct: e.target.value })}
                    className="mt-1 w-full min-h-[38px] px-3 rounded-[10px] border border-[#E5E8EB] text-[13px]"
                  />
                </label>
                <label className="text-[12px] font-semibold text-[#4E5968]">
                  E 회귀 종료 변형률 (%)
                  <input
                    value={params.elasticEndPct}
                    onChange={(e) => setParams({ ...params, elasticEndPct: e.target.value })}
                    className="mt-1 w-full min-h-[38px] px-3 rounded-[10px] border border-[#E5E8EB] text-[13px]"
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-[13px] text-[#333D4B]">
                <input
                  type="checkbox"
                  checked={params.calcOffsetYield}
                  onChange={(e) => setParams({ ...params, calcOffsetYield: e.target.checked })}
                />
                0.2% 오프셋 내력 계산
              </label>
              <label className="flex items-center gap-2 text-[13px] text-[#333D4B]">
                <input
                  type="checkbox"
                  checked={params.trimNegativeAfterPeak}
                  onChange={(e) => setParams({ ...params, trimNegativeAfterPeak: e.target.checked })}
                />
                최대 하중 이후 첫 음수 하중 지점에서 분석 종료
              </label>
              <label className="flex items-center gap-2 text-[13px] text-[#333D4B]">
                <input
                  type="checkbox"
                  checked={params.useSpecimenDim}
                  onChange={(e) => setParams({ ...params, useSpecimenDim: e.target.checked })}
                />
                시편 치수로 하중·변위에서 재계산 (동일 규격 시편)
              </label>
              {params.useSpecimenDim && (
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-[12px] font-semibold text-[#4E5968]">
                    단면적 A₀ (mm²)
                    <input
                      value={params.specimenA0}
                      onChange={(e) => setParams({ ...params, specimenA0: e.target.value })}
                      className="mt-1 w-full min-h-[38px] px-3 rounded-[10px] border border-[#E5E8EB] text-[13px]"
                    />
                  </label>
                  <label className="text-[12px] font-semibold text-[#4E5968]">
                    게이지 길이 L₀ (mm)
                    <input
                      value={params.specimenL0}
                      onChange={(e) => setParams({ ...params, specimenL0: e.target.value })}
                      className="mt-1 w-full min-h-[38px] px-3 rounded-[10px] border border-[#E5E8EB] text-[13px]"
                    />
                  </label>
                </div>
              )}
              <Button variant="primary" className="w-full" onClick={reanalyzeAll} disabled={busy || entries.length === 0}>
                <Play className="w-4 h-4" /> {busy ? "계산 중..." : "전체 재계산"}
              </Button>
            </Card>
          </div>

          {/* Right: overlay chart + comparison */}
          <div className="lg:col-span-8 space-y-6">
            {consistencyWarnings.length > 0 && (
              <div className="rounded-[16px] bg-[#FFFBEB] border border-[#FDE68A] p-4 text-[13px] text-[#92400E] space-y-1">
                <div className="font-bold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> 비교 조건 확인 필요
                </div>
                {consistencyWarnings.map((w) => (
                  <div key={w}>· {w}</div>
                ))}
              </div>
            )}

            <Card className="p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-bold text-[15px] text-[#191F28]">곡선 중첩 비교</div>
                <div className="flex p-0.5 rounded-[10px] bg-[#F2F4F6]">
                  {(
                    [
                      ["stress_strain", "응력-변형률"],
                      ["load_disp", "하중-변위"],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setChartTab(k)}
                      className={`px-3 py-1.5 rounded-[8px] text-[12px] font-semibold ${
                        chartTab === k ? "bg-white shadow-sm text-[#191F28]" : "text-[#6B7684]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {chartData.length > 0 ? (
                <PlotlyChart data={chartData} layout={chartLayout} height={460} />
              ) : (
                <div className="h-[200px] flex items-center justify-center text-[13px] text-[#8B95A1]">
                  {busy ? "분석 중..." : "표시할 곡선이 없습니다."}
                </div>
              )}
              <div className="text-[11px] text-[#8B95A1]">
                [계산값] Python 엔진이 파일별로 산출한 곡선입니다. ★ 표시는 각 시험편의 최대 응력 지점입니다.
              </div>
            </Card>

            <Card className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="font-bold text-[15px] text-[#191F28]">시험편별 물성 비교</div>
                <Button size="sm" variant="outline" onClick={downloadComparisonCsv} disabled={done.length === 0}>
                  <Download className="w-4 h-4" /> 비교표 CSV
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-[#6B7684] border-b border-[#E5E8EB]">
                      <th className="py-2 pr-3">시험편</th>
                      {METRICS.map((m) => (
                        <th key={m.key} className="py-2 px-2 text-right whitespace-nowrap">
                          {m.label}
                          <div className="font-normal text-[10px]">({m.unit})</div>
                        </th>
                      ))}
                      <th className="py-2 px-2 text-right">E R²</th>
                    </tr>
                  </thead>
                  <tbody>
                    {done.map((e) => (
                      <tr key={e.id} className="border-b border-[#F2F4F6]">
                        <td className="py-2 pr-3 font-semibold text-[#191F28] whitespace-nowrap">
                          <span className="inline-block w-2.5 h-2.5 rounded-full mr-2" style={{ background: e.color }} />
                          {e.label}
                        </td>
                        {METRICS.map((m) => {
                          const mv = metricValue(e.result, m.key);
                          return (
                            <td key={m.key} className="py-2 px-2 text-right tabular-nums">
                              {mv.value == null ? (
                                <span className="text-[#D97706] font-semibold cursor-help" title={mv.reason}>
                                  계산 불가
                                </span>
                              ) : (
                                mv.value.toFixed(m.digits)
                              )}
                            </td>
                          );
                        })}
                        <td className="py-2 px-2 text-right tabular-nums text-[#6B7684]">
                          {fmt(e.result?.elastic_modulus?.r_squared, 4)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {done.length > 0 && (
                    <tfoot className="bg-[#F8FAFC]">
                      {(
                        [
                          ["평균", (s: any, d: number) => fmt(s?.mean, d)],
                          ["표준편차 (SD)", (s: any, d: number) => fmt(s?.sd, d)],
                          ["변동계수 CV (%)", (s: any) => fmt(s?.cv, 2)],
                          ["범위 (min~max)", (s: any, d: number) => (s ? `${fmt(s.min, d)}~${fmt(s.max, d)}` : "-")],
                          ["사용 표본 n", (s: any) => (s ? String(s.n) : "0")],
                        ] as const
                      ).map(([name, f]) => (
                        <tr key={name} className="text-[#333D4B]">
                          <td className="py-1.5 pr-3 font-semibold">{name}</td>
                          {statRows.map(({ metric, s }) => (
                            <td key={metric.key} className="py-1.5 px-2 text-right tabular-nums">
                              {f(s, metric.digits)}
                            </td>
                          ))}
                          <td />
                        </tr>
                      ))}
                    </tfoot>
                  )}
                </table>
              </div>
              <div className="rounded-[12px] bg-[#F8FAFC] border border-[#E5E8EB] p-3 text-[11.5px] text-[#4E5968] space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-[#191F28]">
                  <Info className="w-3.5 h-3.5" /> 통계 산출 기준 [규칙 요약]
                </div>
                <div>· 통계는 '계산 불가'로 판정된 값을 0이나 임의 값으로 대체하지 않고 제외하며, 실제 사용된 표본 수(n)를 표시합니다.</div>
                <div>· 표준편차는 표본 표준편차(n−1)이며, n &lt; 2이면 표시하지 않습니다.</div>
                <div>
                  · 탄성계수는 R² ≥ 0.85인 경우에만 유효로 판정합니다. 변형률 측정 방식(크로스헤드/신율계)에 따라 값이 달라질 수 있습니다.
                </div>
                {statRows.some((r) => r.excluded > 0) && (
                  <div className="text-[#B45309]">
                    · 제외된 값:{" "}
                    {statRows
                      .filter((r) => r.excluded > 0)
                      .map((r) => `${r.metric.label} ${r.excluded}건`)
                      .join(", ")}{" "}
                    (표의 '계산 불가'에 마우스를 올리면 사유가 표시됩니다)
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
