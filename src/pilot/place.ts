export type WorkspaceView = "overview" | "check" | "inbox" | "agreements" | "coverage" | "settings" | "report";

const HASHES: Record<string, WorkspaceView> = {
  "#/overblik": "overview",
  "#/fakturakontrol": "check",
  "#/fakturakontrol/modtaget": "inbox",
  "#/fakturakontrol/prisaftaler": "agreements",
  "#/historik": "check",
  "#/benchmark": "coverage",
  "#/indstillinger": "settings",
};

export function viewFromHash(hash: string): WorkspaceView {
  return HASHES[hash] ?? "overview";
}

export function hashForView(view: WorkspaceView): string {
  if (view === "settings") return "#/indstillinger";
  if (view === "inbox") return "#/fakturakontrol/modtaget";
  if (view === "agreements") return "#/fakturakontrol/prisaftaler";
  if (view === "check" || view === "report") return "#/fakturakontrol";
  if (view === "coverage") return "#/benchmark";
  return "";
}
