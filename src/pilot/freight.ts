import { z } from "zod";

export const MAX_LINES = 1200;
export const MAX_RATES = 500;
export const MAX_FILE_BYTES = 1024 * 1024;
export const COVERAGE_TARGET = 25;
export const VOLUME_BANDS = [
  { id: "small", label: "Under 5.000 pakker om året" },
  { id: "medium", label: "5.000–19.999 pakker om året" },
  { id: "large", label: "20.000+ pakker om året" },
] as const;

export const BENCHMARK_SERVICES = [
  { key: "pakkeshop", label: "Pakkeshop" },
  { key: "hjemmelevering", label: "Hjemmelevering" },
] as const;

export const WEIGHT_BANDS = [
  { key: "0-2", label: "Op til 2 kg", max: 2 },
  { key: "2-5", label: "Over 2 til 5 kg", max: 5 },
  { key: "5-10", label: "Over 5 til 10 kg", max: 10 },
] as const;

export const CONSENT_VERSION = "benchmark-pilot-v1";
export const CONSENT_TEXT =
  "Jeg bekræfter, at virksomheden må bidrage med de kontrollerede prisdata fra denne rapport til fremtidige, samlede markedsbenchmarks.";

const oreSchema = z.number().int().min(-100000000).max(100000000);
const weightSchema = z.number().finite().min(0).max(1000);
const countrySchema = z.string().regex(/^[A-Z]{2}$/);

function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const dateSchema = z.string().refine(isDate, "Angiv en gyldig dato.");

export const invoiceRowSchema = z.object({
  shipment: z.string().trim().min(1).max(96),
  date: dateSchema,
  service: z.string().trim().min(1).max(64),
  weight: weightSchema,
  billedOre: oreSchema,
  origin: countrySchema.default("DK"),
  destination: countrySchema.default("DK"),
});

export const rateRowSchema = z.object({
  service: z.string().trim().min(1).max(64),
  maxWeight: weightSchema.positive(),
  baseOre: oreSchema.nonnegative(),
  fuelPct: z.number().finite().min(0).max(300).default(0),
  fixedOre: oreSchema.nonnegative().default(0),
  from: z.union([dateSchema, z.literal("")]).default(""),
  to: z.union([dateSchema, z.literal("")]).default(""),
}).refine((rate) => !rate.from || !rate.to || rate.from <= rate.to, {
  message: "Slutdatoen skal ligge på eller efter startdatoen.",
});

export const contributionSchema = z.object({
  cvr: z.string().regex(/^\d{8}$/),
  volume: z.enum(["small", "medium", "large"]),
  consentVersion: z.literal(CONSENT_VERSION),
});

export const auditRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  carrier: z.string().trim().max(70),
  invoice: z.array(invoiceRowSchema).min(1).max(MAX_LINES),
  rates: z.array(rateRowSchema).min(1).max(MAX_RATES),
  contribution: contributionSchema.nullable().default(null),
});

export type InvoiceRow = z.infer<typeof invoiceRowSchema>;
export type RateRow = z.infer<typeof rateRowSchema>;
export type AuditInput = z.infer<typeof auditRequestSchema>;
export type Contribution = z.infer<typeof contributionSchema>;
export type Volume = Contribution["volume"];
export type LineStatus = "match" | "over" | "under" | "review";

export type AuditLine = InvoiceRow & {
  key: string;
  status: LineStatus;
  expectedOre: number | null;
  differenceOre: number | null;
  reason: string;
  rate: (RateRow & { fuelOre: number }) | null;
};

export type AuditSummary = {
  billedOre: number;
  checkedOre: number;
  expectedOre: number;
  overOre: number;
  underOre: number;
  match: number;
  over: number;
  under: number;
  review: number;
};

export type AuditReport = {
  lines: AuditLine[];
  summary: AuditSummary;
};

export type AuditIndexEntry = {
  id: string;
  name: string;
  carrier: string;
  createdAt: string;
  summary: AuditSummary;
  contributed: boolean;
  sampleCount: number;
};

export type SavedAudit = AuditIndexEntry & { report: AuditReport };

export type BenchmarkSample = {
  group: string;
  shipment: string;
  month: string;
  priceOre: number;
};

export type Coverage = {
  groups: Record<string, number>;
  companies: number;
};

export function normalizedText(value: string) {
  return value.toLowerCase().trim()
    .replaceAll("æ", "ae").replaceAll("ø", "oe").replaceAll("å", "aa")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function serviceKey(value: string) {
  const key = normalizedText(value);
  if (["pakkeshop", "pakkeshops", "parcelshop", "pickuppoint", "servicepoint"].includes(key)) return "pakkeshop";
  if (["hjemmelevering", "hjem", "privatlevering", "homedelivery", "home"].includes(key)) return "hjemmelevering";
  return key;
}

export function serviceLabel(value: string) {
  return BENCHMARK_SERVICES.find((service) => service.key === serviceKey(value))?.label ?? value;
}

export function runAudit(invoice: InvoiceRow[], rates: RateRow[]): AuditReport {
  const seen = new Map<string, number>();
  for (const line of invoice) seen.set(line.shipment, (seen.get(line.shipment) ?? 0) + 1);
  const ratesByService = new Map<string, RateRow[]>();
  for (const rate of rates) {
    const key = serviceKey(rate.service);
    const group = ratesByService.get(key) ?? [];
    group.push(rate);
    ratesByService.set(key, group);
  }
  for (const group of ratesByService.values()) group.sort((a, b) => a.maxWeight - b.maxWeight);

  const summary: AuditSummary = {
    billedOre: 0, checkedOre: 0, expectedOre: 0, overOre: 0, underOre: 0,
    match: 0, over: 0, under: 0, review: 0,
  };

  const lines = invoice.map((line, index): AuditLine => {
    summary.billedOre += line.billedOre;
    const key = String(index + 1);
    const review = (reason: string): AuditLine => {
      summary.review += 1;
      return { ...line, key, status: "review", expectedOre: null, differenceOre: null, reason, rate: null };
    };

    if ((seen.get(line.shipment) ?? 0) > 1) {
      return review("Forsendelsesnummeret står på flere linjer. Saml fragt og tillæg i én linje pr. forsendelse.");
    }
    if (line.billedOre < 0) return review("Kreditering. Afstem beløbet mod den oprindelige fakturalinje.");
    if (line.origin !== "DK" || line.destination !== "DK") {
      return review("Vælg en dansk indenrigsforsendelse til dette tjek.");
    }

    const active = (ratesByService.get(serviceKey(line.service)) ?? []).filter((rate) =>
      rate.maxWeight >= line.weight &&
      (!rate.from || rate.from <= line.date) &&
      (!rate.to || rate.to >= line.date)
    );
    const rate = active[0];
    if (!rate) return review("Ingen gyldig aftalepris for leveringsformen, vægten og datoen.");

    const sameBand = active.filter((candidate) => candidate.maxWeight === rate.maxWeight);
    const conflict = sameBand.some((candidate) =>
      candidate.baseOre !== rate.baseOre ||
      candidate.fixedOre !== rate.fixedOre ||
      candidate.fuelPct !== rate.fuelPct
    );
    if (conflict) return review("Flere aftalepriser gælder for samme vægttrin på denne dato.");

    const fuelOre = Math.round(rate.baseOre * rate.fuelPct / 100);
    const expectedOre = rate.baseOre + fuelOre + rate.fixedOre;
    const differenceOre = line.billedOre - expectedOre;
    const status: LineStatus = differenceOre > 1 ? "over" : differenceOre < -1 ? "under" : "match";
    const reasons = {
      over: "Fakturaen ligger over den beregnede aftalepris.",
      under: "Fakturaen ligger under den beregnede aftalepris.",
      match: "Fakturaen stemmer med aftalen inden for 1 øre.",
    };
    summary[status] += 1;
    summary.checkedOre += line.billedOre;
    summary.expectedOre += expectedOre;
    if (status === "over") summary.overOre += differenceOre;
    if (status === "under") summary.underOre += -differenceOre;
    return { ...line, key, status, expectedOre, differenceOre, reason: reasons[status], rate: { ...rate, fuelOre } };
  });

  return { lines, summary };
}

export function benchmarkSamples(report: AuditReport, volume: Volume): BenchmarkSample[] {
  return report.lines.flatMap((line) => {
    const service = serviceKey(line.service);
    const band = WEIGHT_BANDS.find((item) => line.weight <= item.max);
    if (line.status !== "match" || line.billedOre <= 0 || !band ||
      !BENCHMARK_SERVICES.some((item) => item.key === service)) return [];
    return [{
      group: ["DK", service, band.key, volume].join("|"),
      shipment: line.shipment,
      month: line.date.slice(0, 7),
      priceOre: line.billedOre,
    }];
  });
}

export const STATUS_LABELS: Record<LineStatus, string> = {
  match: "Stemmer", over: "Over aftalen", under: "Under aftalen", review: "Kræver gennemgang",
};
