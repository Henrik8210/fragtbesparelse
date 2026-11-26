import type { AgreementRate } from "./agreementExtract.ts";
import { parseKroner, parseWeight } from "./invoiceCheck.ts";

export type RateDraft = { service: string; zone: string; weight: string; base: string; fuel: string; fixed: string; issues: string[] };
export type RateField = "service" | "weight" | "base" | "fuel" | "fixed";

export const RATE_FIELD_LABELS: Record<RateField, string> = {
  service: "Leveringsform", weight: "Maks. kg", base: "Grundpris", fuel: "Brændstof", fixed: "Fast tillæg",
};

export function parsePct(value: string): number | null {
  const clean = value.trim().replace(/\s|%$/g, "").replace(",", ".");
  if (!clean) return 0;
  if (!/^\d+(?:\.\d+)?$/.test(clean)) return null;
  const pct = Number(clean);
  return pct <= 300 ? pct : null;
}

/** The first field of a parcel rate that cannot be saved, with a Danish reason, or null when the row is valid. */
export function rateProblem(draft: RateDraft): { field: RateField; message: string } | null {
  if (!draft.service.trim()) return { field: "service", message: "Leveringsform mangler." };
  const weight = parseWeight(draft.weight);
  if (weight === 0) return { field: "weight", message: "Maks. kg mangler. En pakkepris gælder op til et vægttrin; er det ikke en pakkepris, så slet rækken." };
  if (weight === null) return { field: "weight", message: `Maks. kg «${draft.weight.trim()}» er ikke et tal mellem 0 og 1000.` };
  const base = parseKroner(draft.base);
  if (!draft.base.trim()) return { field: "base", message: "Grundpris mangler." };
  if (base === null || base < 0) return { field: "base", message: `Grundpris «${draft.base.trim()}» er ikke et beløb.` };
  if (parsePct(draft.fuel) === null) return { field: "fuel", message: `Brændstof «${draft.fuel.trim()}» er ikke en procent mellem 0 og 300.` };
  const fixed = draft.fixed.trim() ? parseKroner(draft.fixed) : 0;
  if (fixed === null || fixed < 0) return { field: "fixed", message: `Fast tillæg «${draft.fixed.trim()}» er ikke et beløb.` };
  return null;
}

/** "Pakkepris 3 (Hasteleverancer Danmark, Zone 2): Maks. kg mangler. …" */
export function rateProblemText(draft: RateDraft, index: number, problem: { message: string }): string {
  const where = [draft.service.trim(), draft.zone.trim()].filter(Boolean).join(", ");
  return `Pakkepris ${index + 1}${where ? ` (${where})` : ""}: ${problem.message}`;
}

export function fromRate(draft: RateDraft): Omit<AgreementRate, "issues"> | null {
  if (rateProblem(draft)) return null;
  return {
    service: draft.service,
    zone: draft.zone,
    maxWeight: parseWeight(draft.weight) as number,
    baseOre: parseKroner(draft.base) as number,
    fuelPct: parsePct(draft.fuel) as number,
    fixedOre: draft.fixed.trim() ? parseKroner(draft.fixed) as number : 0,
  };
}
