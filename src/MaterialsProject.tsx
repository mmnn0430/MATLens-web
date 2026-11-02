import { useEffect, useState } from "react";
import {
  Database,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  Search,
} from "lucide-react";

type Data = Record<string, any>;
async function request(path: string, body?: Data) {
  const response = await fetch(
    "/api/materials-project/" + path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      typeof result.detail === "string"
        ? result.detail
        : "입력값을 확인해주세요.",
    );
  return result;
}

export function MaterialsProject({
  settings,
  onPatch,
  disabled,
  onWorking,
}: {
  settings: Data;
  onPatch: (patch: Data) => void;
  disabled: boolean;
  onWorking: (v: boolean) => void;
}) {
  const [connection, setConnection] = useState<Data>({ configured: false }),
    [showKey, setShowKey] = useState(false),
    [key, setKey] = useState("");
  const [query, setQuery] = useState(""),
    [mode, setMode] = useState("formula"),
    [limit, setLimit] = useState(30),
    [snapshot, setSnapshot] = useState<Data | null>(null);
  const [working, setWorking] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    request("status")
      .then(setConnection)
      .catch(() => setError("MP 연결 상태를 불러오지 못했어요."));
  }, []);
  useEffect(() => {
    let canceled = false;
    if (settings.mp_snapshot)
      request("snapshots/" + settings.mp_snapshot)
        .then((data) => {
          if (!canceled) {
            setSnapshot(data);
            setMode(data.query.mode);
            setQuery(data.query.value);
            setLimit(data.query.limit);
          }
        })
        .catch((e) => {
          if (!canceled) setError(e.message);
        });
    else setSnapshot(null);
    return () => {
      canceled = true;
    };
  }, [settings.mp_snapshot]);
  function wait(v: boolean) {
    setWorking(v);
    onWorking(v);
  }
  async function connect() {
    wait(true);
    setError("");
    setMessage("");
    try {
      setConnection(await request("key", { api_key: key }));
      setShowKey(false);
      setMessage("MP 연결을 확인했어요. 키는 이 서버에만 저장됐어요.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setKey("");
      wait(false);
    }
  }
  async function search(refresh = false) {
    wait(true);
    setError("");
    setMessage("");
    try {
      const data = await request("search", { mode, query, limit, refresh });
      setSnapshot(data);
      onPatch({
        mp_snapshot: data.snapshot_id,
        mp_ids: data.materials.slice(0, 20).map((m: Data) => m.id),
      });
      setMessage(
        data.materials.length
          ? "검색 결과 중 앞쪽 최대 20개를 선택했어요. 비교할 후보를 검토해주세요."
          : "조건에 맞는 구조가 없어요. 다른 화학식 또는 원소계를 입력해주세요.",
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      wait(false);
    }
  }
  const ids: string[] = settings.mp_ids || [];
  const locked = disabled || working;
  return (
    <div className="mp-panel">
      <div className="mp-heading">
        <Database size={16} />
        <strong>Materials Project</strong>
        <span className={"badge " + (connection.configured ? "green" : "gray")}>
          {connection.configured ? "키 설정됨" : "연결 필요"}
        </span>
      </div>
      <p className="mp-help">
        계산 구조로 만든 이론 XRD를 비교해요. 검색 조건만 MP로 전송하며 실험
        파일은 전송하지 않아요.
      </p>
      <button
        className="mp-connect"
        disabled={locked}
        onClick={() => setShowKey(!showKey)}
      >
        <KeyRound size={14} />
        {connection.configured ? "API 키 변경" : "API 키 연결"}
      </button>
      {showKey && (
        <div className="mp-key-box">
          <label className="field">
            <span>MP API 키</span>
            <input
              aria-label="Materials Project API 키"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="32자리 API 키"
              value={key}
              disabled={locked}
              maxLength={64}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          <p className="mp-help">
            연결 확인 후 로컬 서버에 저장해요. 브라우저에는 저장하지 않아요.
          </p>
          <a
            href="https://materialsproject.org/dashboard"
            target="_blank"
            rel="noreferrer"
          >
            MP 대시보드에서 발급 <ExternalLink size={12} />
          </a>
          <button
            className="secondary"
            disabled={locked || !key.trim()}
            onClick={connect}
          >
            {working ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <KeyRound size={14} />
            )}
            연결 확인하고 저장
          </button>
        </div>
      )}
      <div className="mp-search-grid">
        <label className="field">
          <span>검색 방식</span>
          <select
            value={mode}
            disabled={locked}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="formula">화학식</option>
            <option value="chemsys">원소계</option>
          </select>
        </label>
        <label className="field">
          <span>검색 개수 제한</span>
          <select
            value={limit}
            disabled={locked}
            onChange={(e) => setLimit(+e.target.value)}
          >
            <option value={10}>10개</option>
            <option value={30}>30개</option>
            <option value={50}>50개</option>
          </select>
        </label>
      </div>
      <label className="field">
        <span>
          {mode === "formula" ? "화학식 · 예: TiO2" : "원소계 · 예: Ti-O"}
        </span>
        <input
          value={query}
          disabled={locked}
          maxLength={100}
          placeholder={mode === "formula" ? "TiO2" : "Ti-O"}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !locked &&
              query.trim() &&
              connection.configured
            ) {
              e.preventDefault();
              search();
            }
          }}
        />
      </label>
      <button
        className="secondary mp-search"
        disabled={locked || !connection.configured || !query.trim()}
        onClick={() => search()}
      >
        {working ? (
          <LoaderCircle className="spin" size={15} />
        ) : (
          <Search size={15} />
        )}
        후보 구조 검색
      </button>
      {error && (
        <p role="alert" className="mp-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="mp-message">
          {message}
        </p>
      )}
      {snapshot && (
        <div className="mp-results">
          <div className="mp-results-title">
            <strong>
              {ids.length}개 선택 / {snapshot.materials.length}개
            </strong>
            <button
              disabled={locked}
              onClick={() =>
                onPatch({
                  mp_ids: ids.length
                    ? []
                    : snapshot.materials.slice(0, 20).map((m: Data) => m.id),
                })
              }
            >
              {ids.length ? "선택 해제" : "최대 20개 선택"}
            </button>
          </div>
          <p className="mp-help">
            {snapshot.query.mode === "formula" ? "화학식" : "원소계"}:{" "}
            {snapshot.query.value} · {snapshot.cached ? "로컬 캐시" : "새 조회"}
          </p>
          <div className="mp-material-list">
            {snapshot.materials.map((m: Data) => (
              <label className="mp-material" key={m.id}>
                <input
                  type="checkbox"
                  checked={ids.includes(m.id)}
                  disabled={locked || (!ids.includes(m.id) && ids.length >= 20)}
                  onChange={() =>
                    onPatch({
                      mp_ids: ids.includes(m.id)
                        ? ids.filter((id) => id !== m.id)
                        : [...ids, m.id],
                    })
                  }
                />
                <span>
                  <strong>{m.name}</strong>
                  <small>
                    {m.id} · {m.spacegroup || "공간군 정보 없음"}
                  </small>
                </span>
                <a
                  href={m.url}
                  aria-label={m.id + " MP에서 보기"}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={13} />
                </a>
              </label>
            ))}
          </div>
          {snapshot.truncated && (
            <p className="mp-warning">
              검색 결과가 {snapshot.query.limit}개로 제한됐어요. 전체 자료를
              비교한 결과가 아니에요.
            </p>
          )}
          {snapshot.skipped_ids.length > 0 && (
            <p className="mp-warning">
              복잡하거나 지원하지 않는 구조 {snapshot.skipped_ids.length}개를
              제외했어요.
            </p>
          )}
          <p className="mp-help">
            조회: {new Date(snapshot.fetched_at).toLocaleString("ko-KR")}
            <br />
            캐시 24시간 · 새 검색도 이전 분석 이력을 바꾸지 않아요.
          </p>
          <button
            className="mp-refresh"
            disabled={locked || !connection.configured}
            onClick={() => search(true)}
          >
            MP에서 다시 조회
          </button>
        </div>
      )}
    </div>
  );
}

export function MPDetails({ candidate }: { candidate: Data }) {
  if (candidate?.source_kind !== "mp_calculated") return null;
  const number = (v: any, d = 3) =>
    v == null
      ? "자료 없음"
      : Number(v).toLocaleString("ko-KR", { maximumFractionDigits: d });
  return (
    <div className="mp-details">
      <div className="mp-heading">
        <Database size={16} />
        <strong>MP 후보의 참고 계산값</strong>
        <a href={candidate.url} target="_blank" rel="noreferrer">
          {candidate.id} <ExternalLink size={12} />
        </a>
      </div>
      <p>
        아래 값은 선택한 후보의 데이터베이스 계산값이며, 업로드한 시료에서
        측정한 물성이 아니에요.
      </p>
      <dl>
        <div>
          <dt>공간군</dt>
          <dd>{candidate.spacegroup || "자료 없음"}</dd>
        </div>
        <div>
          <dt>계산 밴드갭</dt>
          <dd>
            {number(candidate.band_gap)}{" "}
            {candidate.band_gap != null ? "eV" : ""}
          </dd>
        </div>
        <div>
          <dt>계산 밀도</dt>
          <dd>
            {number(candidate.density)}{" "}
            {candidate.density != null ? "g/cm³" : ""}
          </dd>
        </div>
        <div>
          <dt>Hull 위 에너지</dt>
          <dd>
            {number(candidate.energy_above_hull, 5)}{" "}
            {candidate.energy_above_hull != null ? "eV/atom" : ""}
          </dd>
        </div>
      </dl>
      <p>
        격자 a / b / c:{" "}
        {["a", "b", "c"]
          .map((k) => number(candidate.lattice?.[k], 4))
          .join(" / ")}{" "}
        Å<br />
        격자 α / β / γ:{" "}
        {["alpha", "beta", "gamma"]
          .map((k) => number(candidate.lattice?.[k], 2))
          .join(" / ")}{" "}
        °
      </p>
      <p>
        열역학적 안정성만으로 실제 상의 존재나 합성 가능성을 확정하지 않아요.
        계산 구조의 격자·상대 강도는 실측과 차이가 날 수 있어요.
      </p>
    </div>
  );
}
