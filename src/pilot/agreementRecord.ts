import { z } from "zod";
import { MAX_RATES, rateRowSchema, type RateRow } from "./freight.ts";
import { extractTerms, rateService, type AgreementExtract } from "./agreementExtract.ts";
import { AGREEMENT_FORMAT_VERSION, agreementTermsSchema, EMPTY_TERMS, hasTerms, readContent, type AgreementTerms } from "./agreementFormat.ts";
import type { Agreement } from "./agreements.ts";

export { AGREEMENT_FORMAT_VERSION };

export type AgreementSource = "csv" | "pdf" | "browser";
export type AgreementChange = { at: string; by: string; name: string; fields: string[] };

/** One row of public.price_agreements as the app uses it. */
export type AgreementRecord = {
  id: string;
  companyId: string;
  name: string;
  carrier: string;
  from: string;
  to: string;
  ended: string | null;
  formatVersion: number;
  /** Parcel rate rows. Stored with `terms` in the `rows` column as one format 2 object. */
  rows: RateRow[];
  terms: AgreementTerms;
  /** Rates and terms as first read (AI extract or file), before the review. */
  original: AgreementOriginal;
  changed: boolean;
  source: AgreementSource;
  sourceFilename: string;
  extractSha256: string | null;
  extract: AgreementExtract | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedBy: string;
  updatedByName: string;
  updatedAt: string;
  history: AgreementChange[];
};

/** Kept as read: a value the review fixed (an empty service, a misread cell) is still accepted here. */
export type AgreementOriginal = { rates: z.infer<typeof originalRowSchema>[] } & Record<"items" | "grids" | "surcharges" | "conditions", unknown[]>;

const isoDay = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).default("");
const rowsSchema = z.array(rateRowSchema).max(MAX_RATES);
/** Original rows are kept as read, so a value the review fixed (an empty service, a missing weight) is still accepted here. */
const originalRowSchema = z.object({
  service: z.string().max(64).default(""),
  maxWeight: z.number().finite().default(0),
  baseOre: z.number().finite().default(0),
  fuelPct: z.number().finite().default(0),
  fixedOre: z.number().finite().default(0),
  from: z.string().max(10).default(""),
  to: z.string().max(10).default(""),
});

export const agreementCreateSchema = z.object({
  id: z.string().trim().min(8).max(80).regex(/^[\w:-]+$/).optional(),
  name: z.string().trim().max(100).default(""),
  carrier: z.string().trim().max(70).default(""),
  from: isoDay,
  to: isoDay,
  ended: z.string().max(40).nullable().default(null),
  rows: rowsSchema,
  terms: agreementTermsSchema.optional(),
  /** Format 1 clients sent the rates as read. A PDF's original is taken from the cached extract instead. */
  original: z.array(originalRowSchema).max(MAX_RATES * 2).optional(),
  source: z.enum(["csv", "pdf", "browser"]).default("csv"),
  sourceFilename: z.string().trim().max(160).default(""),
  extractSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  createdAt: z.string().max(40).optional(),
}).refine((value) => !value.from || !value.to || value.from <= value.to, { message: "Slutdatoen skal ligge på eller efter startdatoen." })
  .refine((value) => value.rows.length > 0 || hasTerms(value.terms), { message: "Tilføj mindst én pris." });

export const agreementPatchSchema = z.object({
  name: z.string().trim().max(100).optional(),
  carrier: z.string().trim().max(70).optional(),
  from: isoDay.optional(),
  to: isoDay.optional(),
  ended: z.string().max(40).nullable().optional(),
  rows: rowsSchema.optional(),
  terms: agreementTermsSchema.optional(),
});

export type AgreementCreate = z.infer<typeof agreementCreateSchema>;
export type AgreementPatch = z.infer<typeof agreementPatchSchema>;

const RATE_KEYS = ["service", "maxWeight", "baseOre", "fuelPct", "fixedOre", "from", "to"] as const;

function sameRows(left: Partial<RateRow>[], right: Partial<RateRow>[]): boolean {
  return left.length === right.length && left.every((row, index) => RATE_KEYS.every((key) => row[key] === right[index][key]));
}

/** Key order differs between an extract and a parsed request, so terms are compared with sorted keys. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)))
    : item);
}

function sameContent(original: AgreementOriginal, rows: RateRow[], terms: AgreementTerms): boolean {
  return sameRows(original.rates, rows) && (["items", "grids", "surcharges", "conditions"] as const)
    .every((key) => canonical(original[key]) === canonical(terms[key]));
}

/** The original column of any format version. Format 1 stored the rates as a bare array. */
export function readOriginal(value: unknown): AgreementOriginal {
  if (Array.isArray(value)) return { ...EMPTY_TERMS, rates: value };
  const object = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const list = (key: string) => Array.isArray(object[key]) ? object[key] as unknown[] : [];
  return { rates: list("rates") as AgreementOriginal["rates"], items: list("items"), grids: list("grids"), surcharges: list("surcharges"), conditions: list("conditions") };
}

/** What the rows column holds for a record: format 2 content. */
export function storedContent(record: Pick<AgreementRecord, "rows" | "terms">) {
  return { rates: record.rows, ...record.terms };
}

export function readStoredContent(value: unknown, formatVersion: number): { rows: RateRow[]; terms: AgreementTerms } {
  const { rates, ...terms } = readContent(value, formatVersion);
  return { rows: rates, terms };
}

export function newRecord(
  input: AgreementCreate,
  companyId: string,
  by: { id: string; name: string },
  extract: AgreementExtract | null,
  now = new Date(),
): AgreementRecord {
  const at = now.toISOString();
  const terms = input.terms ?? EMPTY_TERMS;
  if (!input.rows.length && !hasTerms(terms)) throw new Error("Tilføj mindst én pris.");
  const original: AgreementOriginal = extract
    ? { rates: extractOriginalRows(extract), ...extractTerms(extract) }
    : input.original ? { ...EMPTY_TERMS, rates: input.original } : { rates: input.rows, ...terms };
  const name = input.name || input.carrier || "Prisaftale";
  return {
    id: input.id ?? crypto.randomUUID(),
    companyId,
    name,
    carrier: input.carrier,
    from: input.from,
    to: input.to,
    ended: input.ended,
    formatVersion: AGREEMENT_FORMAT_VERSION,
    rows: input.rows,
    terms,
    original,
    changed: !sameContent(original, input.rows, terms),
    source: input.source,
    sourceFilename: input.sourceFilename,
    extractSha256: extract ? input.extractSha256 : null,
    extract,
    createdBy: by.id,
    createdByName: by.name,
    createdAt: input.createdAt && !Number.isNaN(Date.parse(input.createdAt)) ? new Date(input.createdAt).toISOString() : at,
    updatedBy: by.id,
    updatedByName: by.name,
    updatedAt: at,
    history: [],
  };
}

export function patchRecord(previous: AgreementRecord, patch: AgreementPatch, by: { id: string; name: string }, now = new Date()): AgreementRecord {
  const next: AgreementRecord = { ...previous };
  const fields: string[] = [];
  for (const key of ["name", "carrier", "from", "to", "ended"] as const) {
    const value = patch[key];
    if (value === undefined || value === previous[key]) continue;
    if (key === "name") next.name = (value as string) || previous.name;
    else if (key === "ended") next.ended = value as string | null;
    else next[key] = value as string;
    fields.push(key);
  }
  if (next.from && next.to && next.to < next.from) throw new Error("Slutdatoen skal ligge på eller efter startdatoen.");
  if (patch.rows && !sameRows(previous.rows, patch.rows)) {
    next.rows = patch.rows;
    fields.push("rows");
  }
  if (patch.terms && canonical(previous.terms) !== canonical(patch.terms)) {
    next.terms = patch.terms;
    fields.push("terms");
  }
  if (!next.rows.length && !hasTerms(next.terms)) throw new Error("Tilføj mindst én pris.");
  if (!fields.length) return previous;
  const at = now.toISOString();
  return {
    ...next,
    formatVersion: AGREEMENT_FORMAT_VERSION,
    changed: !sameContent(next.original, next.rows, next.terms),
    updatedBy: by.id,
    updatedByName: by.name,
    updatedAt: at,
    history: [...previous.history, { at, by: by.id, name: by.name, fields }].slice(-50),
  };
}

/** The rows the AI read, before anyone edited them in the review. */
export function extractOriginalRows(extract: AgreementExtract): z.infer<typeof originalRowSchema>[] {
  return extract.rates.map((rate) => ({
    service: rateService(rate.service, rate.zone),
    maxWeight: rate.maxWeight,
    baseOre: rate.baseOre,
    fuelPct: rate.fuelPct,
    fixedOre: rate.fixedOre,
    from: extract.validFrom,
    to: extract.validTo,
  }));
}

export function recordToAgreement(record: AgreementRecord): Agreement {
  return {
    id: record.id,
    orgId: record.companyId,
    name: record.name,
    carrier: record.carrier,
    from: record.from,
    to: record.to,
    rows: record.rows,
    ...(hasTerms(record.terms) ? { terms: record.terms } : {}),
    createdAt: record.createdAt,
    sample: false,
    ended: record.ended ?? undefined,
    changed: record.changed,
    source: record.source,
    createdByName: record.createdByName,
  };
}

/** A localStorage agreement from before Prisaftaler lived in the database, as an import request. */
export function browserAgreementInput(agreement: Agreement): AgreementCreate | null {
  const parsed = agreementCreateSchema.safeParse({
    id: agreement.id,
    name: agreement.name,
    carrier: agreement.carrier,
    from: agreement.from,
    to: agreement.to,
    ended: agreement.ended ?? null,
    rows: agreement.rows,
    terms: agreement.terms,
    source: "browser",
    createdAt: agreement.createdAt,
  });
  return parsed.success ? parsed.data : null;
}

/** How many prices a person changed in review: rate rows, items, grid cells and surcharges, counting added or removed ones. */
export function editedPriceCount(record: Pick<AgreementRecord, "original" | "rows" | "terms">): number {
  const differ = (left: unknown[], right: unknown[]) => {
    let count = 0;
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
      if (canonical(left[index] ?? null) !== canonical(right[index] ?? null)) count += 1;
    }
    return count;
  };
  const pick = (row: Partial<RateRow>) => RATE_KEYS.map((key) => row[key] ?? null);
  const rates = differ(record.original.rates.map(pick), record.rows.map(pick));
  const grids = record.terms.grids.reduce((sum, grid, index) => {
    const before = record.original.grids[index] as typeof grid | undefined;
    if (!before) return sum + grid.rows.reduce((cells, row) => cells + row.cells.length, 0);
    const cells = (rows: typeof grid.rows) => rows.flatMap((row) => row.cells);
    return sum + differ(cells(before.rows ?? []), cells(grid.rows)) + differ(before.minimum ?? [], grid.minimum) + differ(before.maximum ?? [], grid.maximum);
  }, 0);
  return rates + differ(record.original.items, record.terms.items) + grids + differ(record.original.surcharges, record.terms.surcharges);
}
