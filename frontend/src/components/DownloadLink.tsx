import { useState, type AnchorHTMLAttributes, type MouseEvent } from "react";
import { downloadFile } from "../download";

export function DownloadLink({ href, download, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const start = async (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (busy || !href) return;
    setBusy(true); setFailed(false); setMessage("파일을 준비하고 있습니다…");
    try {
      await downloadFile(href, typeof download === "string" ? download : undefined);
      setMessage("파일을 브라우저로 전달했습니다.");
    } catch (error) {
      setFailed(true); setMessage(error instanceof Error ? error.message : "다운로드에 실패했습니다.");
    } finally { setBusy(false); }
  };
  return <span className="inline-flex flex-col gap-1">
    <a {...props} href={href} download={download} onClick={start} aria-busy={busy} aria-disabled={busy}>{children}</a>
    {message && <span role={failed ? "alert" : "status"} className={`text-xs ${failed ? "text-red-600" : "text-slate-500"}`}>{message}</span>}
  </span>;
}
