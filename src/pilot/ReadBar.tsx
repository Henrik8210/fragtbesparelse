const elapsedLabel = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s`;
};

/** The same bar as a price-agreement read: a real stage, and a percent only when the server has reported one. */
export function ReadBar({ name, stage, uploadPercent = null, done = 0, total = 0, elapsedMs }: {
  name: string;
  stage: "upload" | "read" | "done";
  uploadPercent?: number | null;
  done?: number;
  total?: number;
  elapsedMs: number;
}) {
  const parts = stage === "read" && total > 1;
  const width = stage === "done" ? 100
    : stage === "upload" ? Math.max(4, Math.min(100, uploadPercent ?? 4))
      : parts ? Math.max(4, Math.round((done / total) * 100))
        : 0;
  const detail = stage === "upload" ? `${uploadPercent ?? 0} % uploadet`
    : stage === "done" ? "linjerne er læst"
      : parts ? `${done} af ${total} dele læst`
        : "læser linjerne";
  const title = stage === "upload" ? `Uploader ${name}` : stage === "done" ? `Færdig · ${name}` : `Læser ${name}`;
  return (
    <div className="agreement-progress" role="status" aria-live="polite">
      <div className={`progress-track${stage === "read" && !parts ? " busy" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={stage === "read" && !parts ? undefined : width} aria-label={title}>
        <span style={stage === "read" && !parts ? undefined : { width: `${width}%` }} />
      </div>
      <p><strong>{title}</strong>{" · "}{detail}{" · "}{elapsedLabel(elapsedMs)}</p>
    </div>
  );
}
