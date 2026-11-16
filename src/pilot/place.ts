export type WorkspaceView = "overview" | "check" | "history" | "coverage" | "settings" | "report";

const HASHES: Record<string, WorkspaceView> = {
  "#/overblik": "overview",
  "#/fakturakontrol": "check",
  "#/historik": "history",
  "#/benchmark": "coverage",
  "#/indstillinger": "settings",
};

export function viewFromHash(hash: string): WorkspaceView {
  return HASHES[hash] ?? "overview";
}

export function hashForView(view: WorkspaceView): string {
  if (view === "settings") return "#/indstillinger";
  if (view === "check" || view === "report") return "#/fakturakontrol";
  if (view === "history") return "#/historik";
  if (view === "coverage") return "#/benchmark";
  return "";
}
