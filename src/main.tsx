import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  FlaskConical,
  Focus,
  History,
  Layers3,
  LoaderCircle,
  Microscope,
  Plus,
  RefreshCw,
  ScanLine,
  Settings2,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import "./style.css";
import { MaterialsProject, MPDetails } from "./MaterialsProject";

type Data = Record<string, any>;
const defaults: Data = {
  x_col: 0,
  y_col: 1,
  wavelength: 1.5406,
  wavelength_confirmed: false,
  low: 10,
  high: 90,
  als_lambda: 1000000,
  smooth: 9,
  prominence: 0.04,
  separation: 0.25,
  k: 0.9,
  instrumental: 0,
  tolerance: 0.25,
  excluded_peaks: [],
  elements: "",
  reference_source: "local",
  mp_snapshot: null,
  mp_ids: [],
  roi: null,
  scale_px: 100,
  scale_length: 1,
  scale_unit: "µm",
  scale_confirmed: false,
  invert: false,
  min_size: 40,
  min_distance: 12,
  exclude_border: true,
  excluded_objects: [],
  segmentation_confirmed: false,
  same_sample: false,
  ai: false,
};
const fmt = (v: any, d = 2) =>
  v == null
    ? "—"
    : Number(v).toLocaleString("ko-KR", { maximumFractionDigits: d });
async function api(path: string, init?: RequestInit) {
  const res = await fetch("/api" + path, init);
  if (!res.ok) {
    let data: any = {};
    try {
      data = await res.json();
    } catch {}
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : "입력값을 확인해주세요. " + res.status,
    );
  }
  return res.json();
}
function Plot({ data, layout = {} }: { data: any[]; layout?: Data }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    let lib: any;
    const el = ref.current;
    import("plotly.js-dist-min").then(({ default: P }) => {
      lib = P;
      if (!disposed && el)
        P.react(
          el,
          data,
          {
            autosize: true,
            height: 310,
            margin: { l: 52, r: 20, t: 20, b: 50 },
            paper_bgcolor: "transparent",
            plot_bgcolor: "transparent",
            font: { family: "Nanum, sans-serif", color: "#8b95a1", size: 11 },
            legend: { orientation: "h", y: 1.14, font: { size: 11 } },
            xaxis: { gridcolor: "#f0f2f5", zeroline: false },
            yaxis: { gridcolor: "#f0f2f5", zeroline: false },
            ...layout,
          },
          {
            responsive: true,
            displaylogo: false,
            modeBarButtonsToRemove: ["lasso2d", "select2d"],
          },
        );
    });
    const ro = new ResizeObserver(() => {
      if (lib && el?.data) lib.Plots.resize(el);
    });
    if (el) ro.observe(el);
    return () => {
      disposed = true;
      ro.disconnect();
      if (lib && el) lib.purge(el);
    };
  }, [JSON.stringify(data), JSON.stringify(layout)]);
  return <div ref={ref} className="plot" />;
}
declare global {
  interface HTMLDivElement {
    data?: any;
  }
}
function Badge({
  children,
  tone = "blue",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={"badge " + tone}>{children}</span>;
}
function Metric({
  label,
  value,
  unit,
  sub,
}: {
  label: string;
  value: any;
  unit?: string;
  sub: string;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>
        {value}
        <small>{unit}</small>
      </strong>
      <p>{sub}</p>
    </div>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Toggle({
  label,
  checked,
  onChange,
  help,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  help?: string;
}) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>
        {label}
        {help && <small>{help}</small>}
      </span>
    </label>
  );
}

function App() {
  const [projects, setProjects] = useState<Data[]>([]),
    [p, setP] = useState<Data | null>(null),
    [result, setResult] = useState<Data | null>(null),
    [s, setS] = useState<Data>({ ...defaults }),
    [tab, setTab] = useState("xrd"),
    [page, setPage] = useState<"home" | "analysis">("home");
  const [busy, setBusy] = useState(false),
    [stage, setStage] = useState(""),
    [error, setError] = useState(""),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [files, setFiles] = useState<Record<string, File>>({}),
    [health, setHealth] = useState(false),
    [candidate, setCandidate] = useState(0),
    [deleteId, setDeleteId] = useState("");
  const [imageMode, setImageMode] = useState("view"),
    [points, setPoints] = useState<number[][]>([]),
    [showOverlay, setShowOverlay] = useState(true),
    [historyOpen, setHistoryOpen] = useState(false);
  const activeRun = useRef("");
  const projectId = useRef("");
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [mpWorking, setMPWorking] = useState(false);
  const change = (key: string, value: any) =>
    setS((old) => ({
      ...old,
      [key]: value,
      ...([
        "min_size",
        "min_distance",
        "invert",
        "roi",
        "excluded_objects",
        "exclude_border",
      ].includes(key)
        ? { segmentation_confirmed: false }
        : {}),
    }));
  const dirty =
    !!result &&
    JSON.stringify(s) !== JSON.stringify({ ...defaults, ...result.settings });
  const refresh = () => api("/projects").then(setProjects);
  const notify = (e: any) => setError(e.message || String(e));
  async function openProject(id: string) {
    try {
      const proj = await api("/projects/" + id);
      projectId.current = id;
      setP(proj);
      setPage("analysis");
      setResult(null);
      setImageMode("view");
      setPoints([]);
      setCandidate(0);
      localStorage.setItem("matlens-project", id);
      const pending = proj.runs?.find((r: Data) =>
        ["queued", "running"].includes(r.status),
      );
      const done = proj.runs?.find((r: Data) => r.status === "complete");
      if (done) {
        const run = await api("/runs/" + done.id);
        setResult(run.result);
        setS({ ...defaults, ...run.result.settings });
        setTab(run.result.xrd ? "xrd" : "sem");
      } else {
        setS({
          ...defaults,
          ...(proj.preview.xrd && {
            x_col: proj.preview.xrd.x_col,
            y_col: proj.preview.xrd.y_col,
          }),
          roi: proj.preview.sem?.roi || null,
          scale_px: proj.preview.sem?.scale_candidate?.length_px || 100,
        });
        setTab(proj.files.xrd ? "xrd" : "sem");
      }
      if (pending) {
        activeRun.current = pending.id;
        setBusy(true);
        poll(pending.id, id);
      }
    } catch (e) {
      notify(e);
    }
  }
  useEffect(() => {
    refresh().catch(notify);
    api("/health")
      .then((h) => setHealth(h.ai_configured))
      .catch(notify);
    const id = localStorage.getItem("matlens-project");
    if (id) openProject(id);
    return () => {
      activeRun.current = "";
    };
  }, []);
  async function poll(id: string, pid: string) {
    try {
      const run = await api("/runs/" + id);
      if (activeRun.current !== id) return;
      setStage(run.stage);
      if (run.status === "complete") {
        setResult(run.result);
        setS({ ...defaults, ...run.result.settings });
        setBusy(false);
        activeRun.current = "";
        setP(await api("/projects/" + pid));
        setCandidate(0);
      } else if (run.status === "failed") {
        setBusy(false);
        activeRun.current = "";
        setError(run.error);
      } else setTimeout(() => poll(id, pid), 850);
    } catch (e) {
      setBusy(false);
      activeRun.current = "";
      notify(e);
    }
  }
  async function analyze() {
    if (!p) return;
    setError("");
    setBusy(true);
    setStage("분석 대기");
    try {
      const run = await api("/projects/" + p.id + "/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
      activeRun.current = run.id;
      poll(run.id, p.id);
    } catch (e) {
      setBusy(false);
      notify(e);
    }
  }
  async function upload() {
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("name", name);
      form.append("description", description);
      Object.entries(files).forEach(([key, file]) => form.append(key, file));
      const proj = await api("/projects", { method: "POST", body: form });
      await refresh();
      await openProject(proj.id);
    } catch (e) {
      notify(e);
    } finally {
      setBusy(false);
    }
  }
  async function sample() {
    setBusy(true);
    setStage("샘플 준비");
    try {
      const proj = await api("/sample", { method: "POST" });
      await refresh();
      await openProject(proj.id);
      setS({
        ...defaults,
        roi: [0, 0, 960, 620],
        scale_px: 200,
        scale_length: 2,
        scale_confirmed: true,
        wavelength_confirmed: true,
        same_sample: true,
      });
    } catch (e) {
      notify(e);
    } finally {
      setBusy(false);
    }
  }
  function newProject() {
    if (busy) return;
    setP(null);
    setResult(null);
    setPage("home");
    setName("");
    setDescription("");
    setFiles({});
    setError("");
    localStorage.removeItem("matlens-project");
  }
  function number(
    key: string,
    label: string,
    step: any = "any",
    min?: number,
    max?: number,
  ) {
    return (
      <Field label={label}>
        <input
          type="number"
          value={s[key]}
          step={step}
          min={min}
          max={max}
          onChange={(e) =>
            change(key, e.target.value === "" ? "" : Number(e.target.value))
          }
        />
      </Field>
    );
  }
  const download = (kind: string) =>
    result &&
    window.open("/api/runs/" + result.id + "/download/" + kind, "_blank");
  async function loadRun(id: string) {
    try {
      const run = await api("/runs/" + id);
      if (run.result) {
        setResult(run.result);
        setS({ ...defaults, ...run.result.settings });
        setHistoryOpen(false);
        setCandidate(0);
      }
    } catch (e) {
      notify(e);
    }
  }
  function imageClick(e: React.MouseEvent<SVGSVGElement>) {
    if (imageMode === "view" || busy) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const info = p!.preview.sem;
    const point = [
      Math.round(((e.clientX - rect.left) / rect.width) * info.width),
      Math.round(((e.clientY - rect.top) / rect.height) * info.height),
    ];
    const next = [...points, point];
    setPoints(next);
    if (next.length === 2) {
      if (imageMode === "roi") {
        const [a, b] = next;
        change("roi", [
          Math.min(a[0], b[0]),
          Math.min(a[1], b[1]),
          Math.max(a[0], b[0]),
          Math.max(a[1], b[1]),
        ]);
      } else {
        const [a, b] = next;
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (length > 0) {
          change("scale_px", Number(length.toFixed(3)));
          change("scale_confirmed", false);
        }
      }
      setImageMode("view");
    }
  }
  const x = result?.xrd,
    sem = result?.sem;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={newProject}>
          <span className="logo">
            <Focus size={24} />
          </span>
          MatLens<span className="version">LAB</span>
        </button>
        <div className="workspace-label">MY WORKSPACE</div>
        <button
          className={"nav-item " + (page === "home" ? "active" : "")}
          disabled={busy}
          onClick={newProject}
        >
          <Plus size={19} />새 분석
        </button>
        <button
          className={"nav-item " + (page === "analysis" ? "active" : "")}
          onClick={() => p && setPage("analysis")}
        >
          <Layers3 size={19} />
          분석 워크스페이스
        </button>
        <div className="sidebar-heading">
          최근 시료 <span>{projects.length}</span>
        </div>
        <div className="project-list">
          {projects.map((proj) => (
            <button
              key={proj.id}
              disabled={busy}
              className={
                "project-item " + (p?.id === proj.id ? "selected" : "")
              }
              onClick={() => openProject(proj.id)}
            >
              <span className="project-dot" />
              <span>
                {proj.name}
                <small>
                  {new Date(proj.created_at).toLocaleDateString("ko-KR")}
                </small>
              </span>
            </button>
          ))}
          {!projects.length && (
            <p className="muted small">첫 번째 시료를 등록해보세요.</p>
          )}
        </div>
        <div className="sidebar-bottom">
          <span className="status-dot" />
          로컬 분석 엔진<small>파일은 이 컴퓨터에 저장돼요.</small>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>
            워크스페이스 <span className="slash">/</span>{" "}
            <strong>{p?.name || "새 분석"}</strong>
          </span>
          <div className="top-actions">
            <span className="local-badge">
              <span className="status-dot" />
              연구용 분석 보조
            </span>
            <div className="avatar">M</div>
          </div>
        </header>
        <main>
          {error && (
            <div className="error" role="alert">
              <span>{error}</span>
              <button aria-label="오류 닫기" onClick={() => setError("")}>
                <X size={17} />
              </button>
            </div>
          )}
          {projects.length > 0 && (
            <div className="mobile-projects">
              <select
                aria-label="저장된 시료 선택"
                value={p?.id || ""}
                disabled={busy}
                onChange={(e) => e.target.value && openProject(e.target.value)}
              >
                <option value="">최근 시료 열기</option>
                {projects.map((proj) => (
                  <option key={proj.id} value={proj.id}>
                    {proj.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {page === "home" ? (
            <>
              <div className="intro">
                <div className="eyebrow">
                  <span /> MATERIAL INTELLIGENCE
                </div>
                <h1>
                  재료를 이해하는
                  <br />
                  <span>새로운 시선.</span>
                </h1>
                <p>
                  XRD의 결정구조와 SEM의 미세구조를 연결해
                  <br className="mobile-hide" /> 데이터에 담긴 이야기를
                  발견하세요.
                </p>
                <button className="text-link" onClick={sample} disabled={busy}>
                  <FlaskConical size={17} /> 샘플 데이터로 둘러보기{" "}
                  <ArrowUpRight size={16} />
                </button>
              </div>
              <section className="card upload-card">
                <div className="section-heading">
                  <div>
                    <h2>분석할 파일을 올려주세요</h2>
                    <p>XRD 또는 SEM 하나만 있어도 시작할 수 있어요.</p>
                  </div>
                  <Badge>새 분석</Badge>
                </div>
                <div className="form-grid">
                  <Field label="시료명">
                    <input
                      placeholder="예: 열처리한 TiO₂ 분말"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={100}
                    />
                  </Field>
                  <Field label="시료 설명 · 선택">
                    <input
                      placeholder="공정 조건, 분석 목적을 기록해주세요"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      maxLength={2000}
                    />
                  </Field>
                </div>
                <div className="drop-grid">
                  {(["xrd", "sem"] as const).map((kind) => (
                    <label
                      className={"dropzone " + (files[kind] ? "has-file" : "")}
                      key={kind}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const f = e.dataTransfer.files[0];
                        if (f) setFiles({ ...files, [kind]: f });
                      }}
                    >
                      <input
                        type="file"
                        accept={
                          kind === "xrd" ? ".csv,.tsv,.txt" : ".jpg,.jpeg,.png"
                        }
                        onChange={(e) =>
                          e.target.files?.[0] &&
                          setFiles({ ...files, [kind]: e.target.files[0] })
                        }
                      />
                      <span className={"file-icon " + kind}>
                        {files[kind] ? (
                          <Check size={24} />
                        ) : kind === "xrd" ? (
                          <Activity size={26} />
                        ) : (
                          <Microscope size={26} />
                        )}
                      </span>
                      <h3>
                        {files[kind]?.name ||
                          (kind === "xrd" ? "XRD 패턴" : "SEM 이미지")}
                      </h3>
                      <p>
                        {files[kind]
                          ? "클릭해서 파일 변경"
                          : "파일을 끌어놓거나 클릭해서 선택하세요"}
                      </p>
                      <span className="format">
                        {kind === "xrd"
                          ? "CSV · 2θ / Intensity"
                          : "JPG, PNG · 최대 1,600만 픽셀"}
                      </span>
                    </label>
                  ))}
                </div>
                <details className="optional">
                  <summary>
                    사용자 기준 CIF 추가 <ChevronDown size={15} />
                  </summary>
                  <p className="muted small">
                    Si·Cu 기본 라이브러리 외의 상을 비교할 때 사용하세요.
                  </p>
                  <input
                    type="file"
                    accept=".cif"
                    onChange={(e) =>
                      e.target.files?.[0] &&
                      setFiles({ ...files, cif: e.target.files[0] })
                    }
                  />
                </details>
                <div className="upload-footer">
                  <span>
                    <CheckCircle2 size={16} /> 원본은 보존하고, 분석 이력을 따로
                    저장해요.
                  </span>
                  <button
                    className="primary"
                    disabled={busy || !name.trim() || !(files.xrd || files.sem)}
                    onClick={upload}
                  >
                    {busy ? <LoaderCircle className="spin" size={17} /> : null}
                    분석 조건 확인 <ArrowRight size={17} />
                  </button>
                </div>
              </section>
              <div className="feature-row">
                <div>
                  <span>01</span>
                  <div>
                    <h3>결정구조를 읽고</h3>
                    <p>배경 보정부터 피크·상 후보까지</p>
                  </div>
                </div>
                <div>
                  <span>02</span>
                  <div>
                    <h3>미세구조를 측정하고</h3>
                    <p>입자 분리와 크기·형상 정량화</p>
                  </div>
                </div>
                <div>
                  <span>03</span>
                  <div>
                    <h3>하나의 해석으로</h3>
                    <p>근거가 연결된 통합 리포트</p>
                  </div>
                </div>
              </div>
            </>
          ) : (
            p && (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">
                      ANALYSIS WORKSPACE{" "}
                      {p.sample && (
                        <Badge tone="gray">샘플 · 합성 데이터</Badge>
                      )}
                    </div>
                    <h1>{p.name}</h1>
                    <p>
                      {p.description ||
                        "분석 조건을 확인하고 데이터에서 인사이트를 찾아보세요."}
                    </p>
                  </div>
                  <div className="heading-actions">
                    <button
                      className="secondary"
                      onClick={() => setHistoryOpen(!historyOpen)}
                    >
                      <History size={16} />
                      분석 이력
                    </button>
                    <button
                      className="icon-button"
                      title="시료 삭제"
                      disabled={busy}
                      onClick={() => setDeleteId(p.id)}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                </div>
                {historyOpen && (
                  <div className="card history">
                    <h3>저장된 분석 실행</h3>
                    {p.runs?.length ? (
                      p.runs.map((run: Data) => (
                        <button
                          className="history-item"
                          key={run.id}
                          disabled={busy || run.status !== "complete"}
                          onClick={() => loadRun(run.id)}
                        >
                          <span>
                            {new Date(run.created_at).toLocaleString("ko-KR")}
                            <small>{run.id.slice(0, 8)}</small>
                          </span>
                          <Badge
                            tone={run.status === "complete" ? "blue" : "gray"}
                          >
                            {run.status === "complete"
                              ? "완료"
                              : run.status === "failed"
                                ? "실패"
                                : run.stage}
                          </Badge>
                        </button>
                      ))
                    ) : (
                      <p className="muted">아직 분석 이력이 없어요.</p>
                    )}
                  </div>
                )}
                <div className="steps">
                  <span className="done">
                    <Check size={13} />
                    파일 등록
                  </span>
                  <i />
                  <span className={!result ? "current" : "done"}>
                    2 분석 조건
                  </span>
                  <i />
                  <span className={result ? "current" : ""}>3 결과 확인</span>
                  <i />
                  <span>4 리포트</span>
                </div>
                <div className="tabs" role="tablist">
                  {[
                    ["xrd", "XRD 분석", Activity],
                    ["sem", "SEM 분석", Microscope],
                    ["report", "통합 리포트", FileText],
                  ].map(([key, label, Icon]: any) => (
                    <button
                      role="tab"
                      aria-selected={tab === key}
                      className={tab === key ? "active" : ""}
                      key={key}
                      onClick={() => setTab(key)}
                    >
                      <Icon size={18} />
                      {label}
                      {result?.[key] && <span className="tab-dot" />}
                    </button>
                  ))}
                </div>
                {dirty && (
                  <div className="notice">
                    <RefreshCw size={17} />
                    <span>
                      조건이 변경됐어요. 현재 결과와 리포트는 이전 실행의
                      값입니다. 재분석하면 새 이력으로 저장돼요.
                    </span>
                  </div>
                )}
                {busy && (
                  <div className="progress" role="status">
                    <LoaderCircle size={19} className="spin" />
                    <div>
                      <strong>{stage || "분석 준비"}</strong>
                      <span>
                        분석 중이에요. 이 화면을 닫아도 서버가 실행 중이면 계속
                        처리해요.
                      </span>
                    </div>
                    <div className="progress-track">
                      <i />
                    </div>
                  </div>
                )}
                <div className="analysis-layout">
                  <aside
                    className={
                      "settings-panel card " +
                      (result && !settingsExpanded ? "mobile-collapsed" : "")
                    }
                  >
                    <div className="section-heading">
                      <h3>
                        <Settings2 size={17} /> 분석 조건
                      </h3>
                      {result && (
                        <button
                          className="mobile-settings-toggle"
                          onClick={() => setSettingsExpanded(!settingsExpanded)}
                        >
                          {settingsExpanded ? "접기" : "변경"}
                          <ChevronDown size={14} />
                        </button>
                      )}
                      <Badge tone="gray">
                        {tab === "report" ? "공통" : tab.toUpperCase()}
                      </Badge>
                    </div>
                    <fieldset disabled={busy}>
                      {tab === "xrd" && p.files.xrd && (
                        <>
                          <div className="file-chip">
                            <Activity size={15} />
                            {p.files.xrd.name}
                            <CheckCircle2 size={14} />
                          </div>
                          <div className="form-grid compact">
                            {["x_col", "y_col"].map((key, i) => (
                              <Field label={i ? "강도 열" : "2θ 열"} key={key}>
                                <select
                                  value={s[key]}
                                  onChange={(e) => change(key, +e.target.value)}
                                >
                                  {p.preview.xrd.columns.map(
                                    (c: string, j: number) => (
                                      <option value={j} key={j}>
                                        {c}
                                      </option>
                                    ),
                                  )}
                                </select>
                              </Field>
                            ))}
                          </div>
                          <Field label="기준 데이터">
                            <select
                              value={s.reference_source || "local"}
                              disabled={mpWorking}
                              onChange={(e) =>
                                change("reference_source", e.target.value)
                              }
                            >
                              <option value="local">
                                기본 Si·Cu / 사용자 CIF
                              </option>
                              <option value="combined">
                                기본·CIF + Materials Project
                              </option>
                              <option value="mp">
                                Materials Project만 비교
                              </option>
                            </select>
                          </Field>
                          {s.reference_source &&
                            s.reference_source !== "local" && (
                              <MaterialsProject
                                settings={s}
                                disabled={busy}
                                onWorking={setMPWorking}
                                onPatch={(patch) =>
                                  setS((old) => ({ ...old, ...patch }))
                                }
                              />
                            )}
                          <Field label="X선 파장 프리셋">
                            <select
                              value={s.wavelength}
                              onChange={(e) => {
                                change("wavelength", +e.target.value);
                                change("wavelength_confirmed", false);
                              }}
                            >
                              <option value={1.5406}>Cu Kα · 1.5406 Å</option>
                              <option value={1.789}>Co Kα · 1.7890 Å</option>
                              <option value={0.7107}>Mo Kα · 0.7107 Å</option>
                              {![1.5406, 1.789, 0.7107].includes(
                                s.wavelength,
                              ) && (
                                <option value={s.wavelength}>
                                  사용자 파장
                                </option>
                              )}
                            </select>
                          </Field>
                          {number(
                            "wavelength",
                            "파장 직접 입력 (Å)",
                            0.0001,
                            0.01,
                            5,
                          )}
                          <Toggle
                            label="측정 파장을 확인했어요"
                            checked={s.wavelength_confirmed}
                            onChange={() =>
                              change(
                                "wavelength_confirmed",
                                !s.wavelength_confirmed,
                              )
                            }
                          />
                          <div className="form-grid compact">
                            {number("low", "시작 2θ (°)", 1, 0.1, 178)}
                            {number("high", "종료 2θ (°)", 1, 0.1, 178)}
                          </div>
                          <Field label="예상 원소 · 선택">
                            <input
                              placeholder="예: Ti O"
                              value={s.elements}
                              onChange={(e) =>
                                change("elements", e.target.value)
                              }
                            />
                          </Field>
                          <details className="advanced">
                            <summary>
                              고급 설정 <ChevronDown size={14} />
                            </summary>
                            {number(
                              "prominence",
                              "피크 prominence 비율",
                              0.01,
                              0.005,
                              0.8,
                            )}
                            {number(
                              "separation",
                              "피크 최소 거리 (°)",
                              0.05,
                              0.03,
                              5,
                            )}
                            {number("als_lambda", "ALS λ", 1000, 100, 1e10)}
                            {number("smooth", "평활화 창 (0 = 끄기)", 2, 0, 51)}
                            {number("k", "Scherrer K", 0.05, 0.1, 2)}
                            {number(
                              "instrumental",
                              "기기 FWHM (°) · Gaussian",
                              0.01,
                              0,
                              3,
                            )}
                            {number(
                              "tolerance",
                              "매칭 허용오차 (°)",
                              0.05,
                              0.03,
                              1,
                            )}
                          </details>
                          <div className="hint">
                            Gaussian 피팅 · 기기 선폭은 Gaussian 분산 차감.
                            복잡한 선폭은 별도 검증이 필요해요.
                          </div>
                        </>
                      )}
                      {tab === "sem" && p.files.sem && (
                        <>
                          <div className="file-chip">
                            <Microscope size={15} />
                            {p.files.sem.name}
                          </div>
                          <Field label="분석 모드">
                            <select value="particles" onChange={() => {}}>
                              <option value="particles">입자 분석</option>
                              <option disabled>
                                결정립 · 선형교차법 (준비 중)
                              </option>
                            </select>
                          </Field>
                          <p className="field-label">스케일 보정</p>
                          <div className="form-grid compact">
                            {number("scale_px", "스케일바 (px)", 1, 0.1)}
                            {number("scale_length", "실제 길이", 0.1, 0.001)}
                          </div>
                          <Field label="실제 길이 단위">
                            <select
                              value={s.scale_unit}
                              onChange={(e) =>
                                change("scale_unit", e.target.value)
                              }
                            >
                              <option>µm</option>
                              <option>nm</option>
                            </select>
                          </Field>
                          <Toggle
                            label="스케일바 길이를 확인했어요"
                            checked={s.scale_confirmed}
                            onChange={() =>
                              change("scale_confirmed", !s.scale_confirmed)
                            }
                            help="확인 전에는 px로만 측정해요."
                          />
                          <p className="field-label">
                            분석 영역 ROI · 원본 좌표
                          </p>
                          <div className="form-grid compact">
                            {["x 시작", "y 시작", "x 끝", "y 끝"].map(
                              (label, i) => (
                                <Field label={label} key={i}>
                                  <input
                                    type="number"
                                    value={s.roi?.[i] ?? 0}
                                    onChange={(e) => {
                                      const r = [...s.roi];
                                      r[i] = +e.target.value;
                                      change("roi", r);
                                    }}
                                  />
                                </Field>
                              ),
                            )}
                          </div>
                          <details className="advanced" open>
                            <summary>
                              입자 분리 설정 <ChevronDown size={14} />
                            </summary>
                            {number(
                              "min_size",
                              "최소 면적 (px²)",
                              5,
                              5,
                              100000,
                            )}
                            {number(
                              "min_distance",
                              "분리 마커 간격 (px)",
                              1,
                              2,
                              200,
                            )}
                            <Toggle
                              label="어두운 입자 · 밝기 반전"
                              checked={s.invert}
                              onChange={() => change("invert", !s.invert)}
                            />
                            <Toggle
                              label="가장자리 객체 제외"
                              checked={s.exclude_border}
                              onChange={() =>
                                change("exclude_border", !s.exclude_border)
                              }
                            />
                          </details>
                        </>
                      )}
                      {tab === "report" && (
                        <>
                          <h3 className="small-title">교차 해석 조건</h3>
                          <p className="muted small">
                            XRD와 SEM이 같은 시료인지 확인해주세요. 파일 하나만
                            있으면 개별 리포트를 생성해요.
                          </p>
                        </>
                      )}
                      <div className="common-settings">
                        <Toggle
                          label="XRD·SEM은 동일 시료예요"
                          checked={s.same_sample}
                          onChange={() => change("same_sample", !s.same_sample)}
                        />
                        <Toggle
                          label="Gemini AI 해석 사용"
                          checked={s.ai}
                          onChange={() => change("ai", !s.ai)}
                          help={
                            health
                              ? "분석값·시료 설명·SEM ROI와 오버레이를 Google에 전송해요."
                              : "서버 API 키·모델 설정 필요. 기본 리포트는 바로 사용할 수 있어요."
                          }
                        />
                      </div>
                    </fieldset>
                    <button
                      className="primary analyze"
                      onClick={analyze}
                      disabled={
                        busy ||
                        mpWorking ||
                        (s.reference_source !== "local" &&
                          !!s.reference_source &&
                          (!s.mp_snapshot || !s.mp_ids?.length))
                      }
                    >
                      {busy ? (
                        <LoaderCircle className="spin" size={17} />
                      ) : (
                        <Sparkles size={17} />
                      )}{" "}
                      {busy
                        ? "분석 중"
                        : result
                          ? "변경 조건으로 재분석"
                          : "분석 시작하기"}
                      {!busy && <ArrowRight size={17} />}
                    </button>
                    <p className="below-button">
                      조건과 결과가 하나의 실행으로 저장돼요.
                    </p>
                  </aside>
                  <div className="result-panel">
                    {tab === "xrd" &&
                      (x ? (
                        <>
                          <div className="metrics">
                            <Metric
                              label="검출 피크"
                              value={x.peaks.length}
                              unit="개"
                              sub="제외·검토 필요 피크 포함"
                            />
                            <Metric
                              label="결정자 크기"
                              value={fmt(x.size_nm)}
                              unit="nm"
                              sub="유효 피크 중앙값 · Scherrer"
                            />
                            <Metric
                              label="최상위 상대 점수"
                              value={fmt(x.candidates[0]?.score, 1)}
                              unit="점"
                              sub={
                                x.candidates[0]?.name ||
                                "파장 또는 기준 확인 필요"
                              }
                            />
                          </div>
                          <section className="card chart-card">
                            <div className="section-heading">
                              <div>
                                <h2>XRD 패턴</h2>
                                <p>드래그하여 확대 · 더블 클릭하여 초기화</p>
                              </div>
                              <button
                                className="icon-button"
                                title="피크 CSV 다운로드"
                                onClick={() => download("xrd")}
                              >
                                <Download size={18} />
                              </button>
                            </div>
                            <Plot
                              data={[
                                {
                                  x: x.x,
                                  y: x.raw,
                                  name: "원본",
                                  line: { color: "#cbd3dd", width: 1 },
                                },
                                {
                                  x: x.x,
                                  y: x.baseline,
                                  name: "배경",
                                  line: {
                                    color: "#f5ac52",
                                    width: 1,
                                    dash: "dot",
                                  },
                                },
                                {
                                  x: x.x,
                                  y: x.corrected,
                                  name: "보정 패턴",
                                  line: { color: "#3182f6", width: 1.5 },
                                },
                                {
                                  x: x.peaks.map((p: Data) => p.position),
                                  y: x.peaks.map((p: Data) => p.height),
                                  name: "피크",
                                  type: "scatter",
                                  mode: "markers",
                                  marker: {
                                    color: "#3182f6",
                                    symbol: "circle-open",
                                    size: 7,
                                  },
                                },
                                ...(x.candidates[candidate]
                                  ? [
                                      {
                                        x: x.candidates[candidate].x,
                                        y: x.candidates[candidate].y.map(
                                          (v: number) =>
                                            (-v / 100) *
                                            Math.max(...x.corrected) *
                                            0.15,
                                        ),
                                        name: "기준 패턴",
                                        type: "bar",
                                        width: 0.12,
                                        marker: { color: "#8b72d8" },
                                      },
                                    ]
                                  : []),
                              ]}
                              layout={{
                                xaxis: {
                                  title: { text: "2θ (°)" },
                                  gridcolor: "#f0f2f5",
                                },
                                yaxis: {
                                  title: { text: "Intensity (a.u.)" },
                                  gridcolor: "#f0f2f5",
                                },
                              }}
                            />
                          </section>
                          <section className="card">
                            <div className="section-heading">
                              <div>
                                <h2>상 후보 비교</h2>
                                <p>
                                  {x.reference_count == null ? "저장된 기준 구조" : `${x.reference_count}개 기준 구조`} ·
                                  상위 {x.candidates.length}개 표시 · 매칭
                                  점수는 확률이 아니에요.
                                </p>
                              </div>
                              <Badge tone="gray">기준 내 비교</Badge>
                            </div>
                            {x.mp && (
                              <p className="mp-result-notice">
                                {x.mp.error
                                  ? "MP 비교 실패: " + x.mp.error
                                  : `Materials Project · ${x.mp.query?.value} · 선택 ${x.mp.selected_ids?.length}개 · 조회 ${new Date(x.mp.fetched_at).toLocaleDateString("ko-KR")}`}
                              </p>
                            )}
                            {x.candidates.length ? (
                              x.candidates.map((c: Data, i: number) => (
                                <button
                                  className={
                                    "candidate " +
                                    (i === candidate ? "selected" : "")
                                  }
                                  key={c.id}
                                  onClick={() => setCandidate(i)}
                                >
                                  <span className="candidate-rank">
                                    {i + 1}
                                  </span>
                                  <div>
                                    <strong>{c.name}</strong>
                                    <small>
                                      {c.source_kind === "mp_calculated"
                                        ? "MP 계산 · "
                                        : ""}
                                      {c.id} · {c.pairs.length}개 일치 /{" "}
                                      {c.unmatched_peak_ids.length}개 미설명
                                    </small>
                                  </div>
                                  <span className="score-bar">
                                    <i style={{ width: c.score + "%" }} />
                                  </span>
                                  <strong>
                                    {fmt(c.score, 1)}
                                    <small> 점</small>
                                  </strong>
                                </button>
                              ))
                            ) : (
                              <p className="muted">
                                파장 확인 또는 원소 필터 조정 후 재분석해주세요.
                              </p>
                            )}
                            <MPDetails candidate={x.candidates[candidate]} />
                            {x.candidates[candidate] && (
                              <details className="source">
                                <summary>기준 출처와 일치 피크 보기</summary>
                                <p>{x.candidates[candidate].source}</p>
                                <p>
                                  일치 피크 ID:{" "}
                                  {x.candidates[candidate].pairs
                                    .map((pair: Data) => pair.peak_id)
                                    .join(", ") || "없음"}
                                </p>
                              </details>
                            )}
                          </section>
                          <section className="card">
                            <div className="section-heading">
                              <h2>피크별 정량 결과</h2>
                              <Badge tone="gray">Gaussian FWHM</Badge>
                            </div>
                            <div className="table-scroll">
                              <table>
                                <thead>
                                  <tr>
                                    <th>사용</th>
                                    <th>2θ (°)</th>
                                    <th>FWHM (°)</th>
                                    <th>크기 (nm)</th>
                                    <th>품질</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {x.peaks.map((peak: Data) => (
                                    <tr key={peak.id}>
                                      <td>
                                        <input
                                          aria-label={
                                            "피크 " + peak.id + " 사용"
                                          }
                                          type="checkbox"
                                          checked={
                                            !s.excluded_peaks.includes(peak.id)
                                          }
                                          disabled={busy}
                                          onChange={() =>
                                            change(
                                              "excluded_peaks",
                                              s.excluded_peaks.includes(peak.id)
                                                ? s.excluded_peaks.filter(
                                                    (v: number) =>
                                                      v !== peak.id,
                                                  )
                                                : [
                                                    ...s.excluded_peaks,
                                                    peak.id,
                                                  ],
                                            )
                                          }
                                        />
                                      </td>
                                      <td>{fmt(peak.position, 3)}</td>
                                      <td>{fmt(peak.fwhm, 4)}</td>
                                      <td>{fmt(peak.size_nm)}</td>
                                      <td title={peak.reason}>
                                        <Badge
                                          tone={
                                            peak.status === "valid"
                                              ? "green"
                                              : "amber"
                                          }
                                        >
                                          {peak.status === "valid"
                                            ? "유효"
                                            : peak.status === "excluded"
                                              ? "제외"
                                              : "확인 필요"}
                                        </Badge>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </section>
                          <section className="card">
                            <h3>Williamson–Hall · 탐색 분석</h3>
                            <p className="muted small">{x.wh.reason}</p>
                            {x.wh.status === "experimental" && (
                              <>
                                <p>
                                  결정자 {fmt(x.wh.size_nm)} nm · 미세변형률{" "}
                                  {fmt(x.wh.strain, 6)} · R² {fmt(x.wh.r2, 3)}
                                </p>
                                <Plot
                                  data={[
                                    {
                                      x: x.wh.x,
                                      y: x.wh.y,
                                      mode: "markers",
                                      name: "피크",
                                    },
                                    {
                                      x: x.wh.x,
                                      y: x.wh.fit,
                                      mode: "lines",
                                      name: "회귀",
                                    },
                                  ]}
                                  layout={{
                                    xaxis: { title: { text: "4 sin θ" } },
                                    yaxis: { title: { text: "β cos θ" } },
                                  }}
                                />
                              </>
                            )}
                            <p className="small muted">
                              다상 조합 정량 비교·상대 결정성 지표는 준비
                              중이에요.
                            </p>
                          </section>
                          <Notes notes={x.notes} />
                        </>
                      ) : (
                        <Empty
                          icon={<Activity size={32} />}
                          title={
                            p.files.xrd
                              ? "패턴 속 구조를 읽어볼까요?"
                              : "XRD 파일이 없는 시료예요"
                          }
                          text={
                            result?.errors.xrd ||
                            "분석 조건을 확인하고 분석 시작하기를 눌러주세요."
                          }
                        />
                      ))}
                    {tab === "sem" && (
                      <>
                        {p.files.sem && (
                          <section className="card">
                            <div className="section-heading">
                              <div>
                                <h2>
                                  {sem && showOverlay
                                    ? "분리된 입자 경계를 확인해주세요"
                                    : "SEM 이미지"}
                                </h2>
                                <p>
                                  {imageMode === "roi"
                                    ? "분석할 사각형의 두 모서리를 클릭하세요."
                                    : imageMode === "scale"
                                      ? "스케일바의 양 끝점을 차례로 클릭하세요."
                                      : "2D 관찰면 · 마커 번호로 객체를 제외할 수 있어요."}
                                </p>
                              </div>
                              {sem && (
                                <button
                                  className="secondary small"
                                  onClick={() => {
                                    setShowOverlay(!showOverlay);
                                    setImageMode("view");
                                  }}
                                >
                                  {showOverlay ? "원본 보기" : "오버레이"}
                                </button>
                              )}
                            </div>
                            <div className="image-toolbar">
                              <button
                                className={
                                  imageMode === "roi" ? "selected" : ""
                                }
                                disabled={busy}
                                onClick={() => {
                                  setImageMode("roi");
                                  setShowOverlay(false);
                                  setPoints([]);
                                }}
                              >
                                <ScanLine size={15} />
                                영역 지정
                              </button>
                              <button
                                className={
                                  imageMode === "scale" ? "selected" : ""
                                }
                                disabled={busy}
                                onClick={() => {
                                  setImageMode("scale");
                                  setShowOverlay(false);
                                  setPoints([]);
                                }}
                              >
                                <Focus size={15} />
                                스케일바 지정
                              </button>
                              {sem && (
                                <button onClick={() => download("overlay")}>
                                  <Download size={15} />
                                  이미지 저장
                                </button>
                              )}
                            </div>
                            <div className="sem-view">
                              {sem && showOverlay ? (
                                <img
                                  src={
                                    "/api/runs/" +
                                    result!.id +
                                    "/download/overlay"
                                  }
                                  alt="입자 경계와 번호가 표시된 SEM 분석 오버레이"
                                />
                              ) : (
                                <div
                                  className="image-canvas"
                                  style={{
                                    aspectRatio:
                                      p.preview.sem.width +
                                      "/" +
                                      p.preview.sem.height,
                                  }}
                                >
                                  <img
                                    src={"/api/projects/" + p.id + "/files/sem"}
                                    alt="원본 SEM 이미지"
                                  />
                                  <svg
                                    viewBox={`0 0 ${p.preview.sem.width} ${p.preview.sem.height}`}
                                    onClick={imageClick}
                                    style={{
                                      cursor:
                                        imageMode === "view"
                                          ? "default"
                                          : "crosshair",
                                    }}
                                  >
                                    {s.roi && (
                                      <rect
                                        x={s.roi[0]}
                                        y={s.roi[1]}
                                        width={s.roi[2] - s.roi[0]}
                                        height={s.roi[3] - s.roi[1]}
                                        fill="rgba(49,130,246,.08)"
                                        stroke="#3182f6"
                                        strokeWidth="3"
                                      />
                                    )}
                                    {points.map((point, i) => (
                                      <circle
                                        key={i}
                                        cx={point[0]}
                                        cy={point[1]}
                                        r={5}
                                        fill="#fbbf24"
                                      />
                                    ))}
                                    {points.length === 2 && (
                                      <line
                                        x1={points[0][0]}
                                        y1={points[0][1]}
                                        x2={points[1][0]}
                                        y2={points[1][1]}
                                        stroke="#fbbf24"
                                        strokeWidth={3}
                                      />
                                    )}
                                  </svg>
                                </div>
                              )}
                            </div>
                            {sem && (
                              <Toggle
                                label="분할 경계를 확인했어요"
                                checked={s.segmentation_confirmed}
                                onChange={() =>
                                  !busy &&
                                  change(
                                    "segmentation_confirmed",
                                    !s.segmentation_confirmed,
                                  )
                                }
                                help="확인 후 재분석하면 확인된 통계와 리포트를 저장해요."
                              />
                            )}
                          </section>
                        )}
                        {sem ? (
                          <>
                            <div className="metrics">
                              <Metric
                                label="측정 입자"
                                value={sem.stats.count}
                                unit="개"
                                sub={
                                  sem.confirmed
                                    ? "분할 확인 완료"
                                    : "분할 확인 전 · 잠정 통계"
                                }
                              />
                              <Metric
                                label="중앙 직경 · D50"
                                value={fmt(sem.stats.median)}
                                unit={sem.unit}
                                sub="개수 기준 등가원 직경"
                              />
                              <Metric
                                label="평균 원형도"
                                value={fmt(sem.stats.circularity, 3)}
                                sub="4πA / P² · Crofton 둘레"
                              />
                            </div>
                            <section className="card">
                              <div className="section-heading">
                                <h2>입자 크기 분포</h2>
                                <button
                                  className="icon-button"
                                  title="입자 CSV 다운로드"
                                  onClick={() => download("sem")}
                                >
                                  <Download size={17} />
                                </button>
                              </div>
                              <Plot
                                data={[
                                  {
                                    x: sem.objects.map((o: Data) => o.diameter),
                                    type: "histogram",
                                    marker: { color: "#3182f6" },
                                    nbinsx: 18,
                                    name: "입자 수",
                                  },
                                ]}
                                layout={{
                                  bargap: 0.15,
                                  xaxis: {
                                    title: {
                                      text: `등가원 직경 (${sem.unit})`,
                                    },
                                  },
                                  yaxis: { title: { text: "입자 수" } },
                                }}
                              />
                              <div className="distribution-stats">
                                {["d10", "d50", "d90", "std"].map((k) => (
                                  <div key={k}>
                                    <span>{k.toUpperCase()}</span>
                                    <strong>
                                      {fmt(sem.stats[k])}{" "}
                                      <small>{sem.unit}</small>
                                    </strong>
                                  </div>
                                ))}
                              </div>
                            </section>
                            <section className="card">
                              <div className="section-heading">
                                <h2>객체 검토</h2>
                                <Badge tone="gray">
                                  {sem.objects.length}개
                                </Badge>
                              </div>
                              <Field label="제외할 객체 번호 · 쉼표로 구분">
                                <input
                                  placeholder="예: 2, 7, 12"
                                  key={result!.id}
                                  defaultValue={s.excluded_objects.join(", ")}
                                  onBlur={(e) =>
                                    change(
                                      "excluded_objects",
                                      e.target.value
                                        .split(",")
                                        .map(Number)
                                        .filter(
                                          (n) => Number.isInteger(n) && n > 0,
                                        ),
                                    )
                                  }
                                />
                              </Field>
                              <div className="table-scroll objects">
                                <table>
                                  <thead>
                                    <tr>
                                      <th>ID</th>
                                      <th>직경 ({sem.unit})</th>
                                      <th>면적 ({sem.unit}²)</th>
                                      <th>원형도</th>
                                      <th>종횡비</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {sem.objects.map((o: Data) => (
                                      <tr key={o.id}>
                                        <td>{o.id}</td>
                                        <td>{fmt(o.diameter)}</td>
                                        <td>{fmt(o.area)}</td>
                                        <td>{fmt(o.circularity, 3)}</td>
                                        <td>{fmt(o.aspect_ratio)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </section>
                            <Notes notes={sem.notes} />
                          </>
                        ) : (
                          <Empty
                            icon={<Microscope size={32} />}
                            title={
                              p.files.sem
                                ? "스케일과 영역을 확인해주세요"
                                : "SEM 파일이 없는 시료예요"
                            }
                            text={
                              result?.errors.sem ||
                              "분석을 실행하면 입자 경계와 크기 분포가 이곳에 표시돼요."
                            }
                          />
                        )}
                      </>
                    )}
                    {tab === "report" &&
                      (result ? (
                        <>
                          <section className="card report-hero">
                            <div className="report-icon">
                              <FileText size={25} />
                            </div>
                            <Badge
                              tone={result.report.integrated ? "blue" : "gray"}
                            >
                              {result.report.integrated
                                ? "통합 분석"
                                : "개별 분석"}
                            </Badge>
                            <h2>데이터에서 발견한 이야기</h2>
                            <p>측정 근거와 해석을 함께 살펴보세요.</p>
                            <div className="report-summary">
                              {result.report.summary.map(
                                (t: string, i: number) => (
                                  <p key={i}>
                                    <CheckCircle2 size={17} />
                                    {t}
                                  </p>
                                ),
                              )}
                            </div>
                            <div className="report-actions">
                              <button
                                className="primary"
                                onClick={() => download("pdf")}
                              >
                                <Download size={17} />
                                PDF 리포트
                              </button>
                              <button
                                className="secondary"
                                onClick={() => download("json")}
                              >
                                전체 결과 JSON
                              </button>
                            </div>
                          </section>
                          <section className="card">
                            <div className="section-heading">
                              <h2>
                                <Sparkles size={20} /> AI 교차 해석
                              </h2>
                              <Badge tone="gray">Gemini</Badge>
                            </div>
                            {result.ai.status === "complete" ? (
                              <>
                                <p className="muted small">
                                  {result.ai.model} · {result.ai.validation}
                                </p>
                                {result.ai.claims.map((c: Data, i: number) => (
                                  <div className="claim" key={i}>
                                    <Badge
                                      tone={
                                        c.kind === "hypothesis"
                                          ? "amber"
                                          : "blue"
                                      }
                                    >
                                      {
                                        {
                                          observation: "관찰",
                                          hypothesis: "가설",
                                          limitation: "한계",
                                          next_experiment: "다음 실험",
                                        }[c.kind as string]
                                      }
                                    </Badge>
                                    <p>{c.text}</p>
                                    <small>
                                      {c.evidence_ids
                                        .map((id: string) => {
                                          const e = result.ai.evidence[id];
                                          return `${id}: ${e.label || ""} ${e.value} ${e.unit || ""}`;
                                        })
                                        .join(" / ")}
                                    </small>
                                  </div>
                                ))}
                              </>
                            ) : (
                              <div className="ai-empty">
                                <Sparkles size={25} />
                                <h3>
                                  {result.ai.status === "off"
                                    ? "AI 해석을 켜면 더 깊이 연결할 수 있어요"
                                    : "AI 해석을 생성하지 못했어요"}
                                </h3>
                                <p>
                                  {result.ai.message ||
                                    "기본 분석 리포트는 준비됐어요. 왼쪽에서 AI 해석을 켜고 재분석하면 수치와 이미지를 함께 해석해요."}
                                </p>
                              </div>
                            )}
                          </section>
                          <section className="card">
                            <h2>다음 실험 제안</h2>
                            {result.report.next_steps.map(
                              (t: string, i: number) => (
                                <div className="next-step" key={i}>
                                  <span>{i + 1}</span>
                                  <p>{t}</p>
                                </div>
                              ),
                            )}
                          </section>
                          <Notes notes={result.report.limitations} />
                          <section className="card">
                            <details>
                              <summary>분석 조건과 재현 정보</summary>
                              <pre>
                                {JSON.stringify(
                                  {
                                    run: result.id,
                                    created_at: result.created_at,
                                    settings: result.settings,
                                    provenance: result.provenance,
                                  },
                                  null,
                                  2,
                                )}
                              </pre>
                            </details>
                          </section>
                        </>
                      ) : (
                        <Empty
                          icon={<FileText size={32} />}
                          title="분석을 마치면 리포트가 완성돼요"
                          text="API 키 없이도 계산 결과와 규칙 기반 요약을 다운로드할 수 있어요."
                        />
                      ))}
                  </div>
                </div>
              </>
            )
          )}
          <footer>
            MatLens <span>·</span> 재료를 이해하는 새로운 시선{" "}
            <span className="footer-right">측정 근거와 함께 판단하세요.</span>
          </footer>
        </main>
      </div>
      {deleteId && (
        <div className="modal-backdrop">
          <section className="modal card">
            <h2>시료와 분석 이력을 삭제할까요?</h2>
            <p>이 시료의 원본 파일과 분석 결과가 함께 삭제돼요.</p>
            <div>
              <button className="secondary" onClick={() => setDeleteId("")}>
                취소
              </button>
              <button
                className="danger"
                onClick={async () => {
                  try {
                    await api("/projects/" + deleteId, { method: "DELETE" });
                    setDeleteId("");
                    newProject();
                    await refresh();
                  } catch (e) {
                    notify(e);
                  }
                }}
              >
                삭제하기
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function Notes({ notes }: { notes: string[] }) {
  return (
    <div className="notes">
      <strong>해석 전에 확인해주세요</strong>
      {notes.map((note, i) => (
        <p key={i}>{note}</p>
      ))}
    </div>
  );
}
function Empty({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="card empty">
      <span>{icon}</span>
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
