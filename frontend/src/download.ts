export async function downloadFile(url: string, filename?: string, init?: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok) {
    let detail = `다운로드 실패 (HTTP ${response.status}). 잠시 후 다시 시도해주세요.`;
    try {
      const body = await response.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch { /* Keep a readable message for non-JSON server errors. */ }
    throw new Error(detail);
  }
  const blob = await response.blob();
  if (!blob.size || blob.type.includes("text/html")) throw new Error("파일 대신 빈 응답 또는 오류 페이지가 반환되었습니다.");
  const disposition = response.headers.get("content-disposition") || "";
  const suggested = disposition.match(/filename="([^"]+)"/i)?.[1];
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename || suggested || "matlens-download";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Leave the blob alive long enough for browsers to start saving it.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
