import { z } from "zod";
import { MAX_RATES, rateRowSchema, type RateRow } from "./freight.ts";

/**
 * Format 2 of a price agreement. Format 1 was parcel rate rows only; they live on as `rates`, which the invoice
 * check prices against. Everything else is general building blocks, with money in the agreement's currency as
 * decimal numbers (not øre), because 3PL agreements mix currencies and quote prices like 0,85 kr. per line.
 */
export const AGREEMENT_FORMAT_VERSION = 2;

export const MAX_ITEMS = 300;
export const MAX_GRIDS = 60;
export const MAX_GRID_ROWS = 60;
export const MAX_GRID_COLUMNS = 20;
export const MAX_SURCHARGES = 60;
export const MAX_CONDITIONS = 200;

const money = z.number().finite().min(-1_000_000).max(10_000_000);
const text = (max: number) => z.string().trim().max(max).default("");

export const priceItemSchema = z.object({
  category: text(80),
  description: z.string().trim().min(1).max(200),
  unit: text(60),
  price: money.nullable(),
  currency: text(8),
  note: text(300),
});

export const gridColumnSchema = z.object({ label: text(80), detail: text(160) });
export const gridRowSchema = z.object({ label: z.string().trim().min(1).max(80), cells: z.array(money.nullable()).max(MAX_GRID_COLUMNS) });

export const priceGridSchema = z.object({
  name: z.string().trim().min(1).max(160),
  category: text(80),
  unit: text(60),
  currency: text(8),
  rowLabel: text(60),
  columns: z.array(gridColumnSchema).min(1).max(MAX_GRID_COLUMNS),
  rows: z.array(gridRowSchema).min(1).max(MAX_GRID_ROWS),
  minimum: z.array(money.nullable()).max(MAX_GRID_COLUMNS).default([]),
  maximum: z.array(money.nullable()).max(MAX_GRID_COLUMNS).default([]),
  note: text(300),
}).refine((grid) => grid.rows.every((row) => row.cells.length === grid.columns.length), { message: "Hver række i et prisgitter skal have én værdi pr. kolonne." });

export const SURCHARGE_KINDS = ["percent", "amount", "agreed"] as const;
export type SurchargeKind = (typeof SURCHARGE_KINDS)[number];

export const surchargeSchema = z.object({
  label: z.string().trim().min(1).max(120),
  kind: z.enum(SURCHARGE_KINDS),
  value: z.number().finite().min(-1_000_000).max(10_000_000).nullable(),
  unit: text(60),
  scope: text(200),
  note: text(300),
}).refine((item) => item.kind === "agreed" ? item.value === null : item.value !== null, { message: "Et tillæg skal have en værdi, medmindre det skal aftales." });

export const agreementTermsSchema = z.object({
  items: z.array(priceItemSchema).max(MAX_ITEMS).default([]),
  grids: z.array(priceGridSchema).max(MAX_GRIDS).default([]),
  surcharges: z.array(surchargeSchema).max(MAX_SURCHARGES).default([]),
  conditions: z.array(z.string().trim().min(1).max(1000)).max(MAX_CONDITIONS).default([]),
});

export const agreementContentSchema = agreementTermsSchema.extend({
  rates: z.array(rateRowSchema).max(MAX_RATES).default([]),
});

export type PriceItem = z.infer<typeof priceItemSchema>;
export type GridColumn = z.infer<typeof gridColumnSchema>;
export type GridRow = z.infer<typeof gridRowSchema>;
export type PriceGrid = z.infer<typeof priceGridSchema>;
export type AgreementSurcharge = z.infer<typeof surchargeSchema>;
export type AgreementTerms = z.infer<typeof agreementTermsSchema>;
export type AgreementContent = z.infer<typeof agreementContentSchema>;

export const EMPTY_TERMS: AgreementTerms = { items: [], grids: [], surcharges: [], conditions: [] };

export function hasTerms(terms: AgreementTerms | undefined): boolean {
  return Boolean(terms && (terms.items.length || terms.grids.length || terms.surcharges.length || terms.conditions.length));
}

/** Reads stored content of any format version. Format 1 was a bare array of parcel rate rows. */
export function readContent(value: unknown, formatVersion: number): AgreementContent {
  if (formatVersion <= 1 || Array.isArray(value)) {
    const rows = z.array(rateRowSchema).safeParse(value);
    return { ...EMPTY_TERMS, rates: rows.success ? rows.data : [] };
  }
  const parsed = agreementContentSchema.safeParse(value);
  return parsed.success ? parsed.data : { ...EMPTY_TERMS, rates: [] };
}

export const UNIT_SUGGESTIONS = [
  "pr. palle", "pr. palle pr. uge", "pr. ordre", "pr. ordrelinje", "pr. kolli", "pr. enhed", "pr. time", "pr. dag",
  "pr. forsendelse", "pr. leverance", "pr. palleplads", "pr. måned", "pr. pakke",
];

/** Money keeps two decimals, as rate sheets print it. A percent is shown as written. */
export function decimalText(value: number | null, kind: "money" | "percent" = "money"): string {
  if (value === null) return "";
  const min = kind === "percent" && Number.isInteger(value) ? 0 : 2;
  return value.toLocaleString("da-DK", { minimumFractionDigits: min, maximumFractionDigits: 4 });
}

/** Danish or English decimal text into a number. Empty is null; anything else unreadable is undefined. */
export function parseDecimal(value: string): number | null | undefined {
  let clean = value.trim().replace(/\s|kr\.?$|dkk$|%$/gi, "");
  if (!clean) return null;
  const comma = clean.lastIndexOf(",");
  const dot = clean.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) clean = comma > dot ? clean.replaceAll(".", "").replace(",", ".") : clean.replaceAll(",", "");
  else if (comma >= 0) clean = clean.replace(",", ".");
  else if (/^[-+]?\d{1,3}(\.\d{3})+$/.test(clean)) clean = clean.replaceAll(".", "");
  if (!/^[-+]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(clean)) return undefined;
  return Number(clean);
}

export function contentSize(content: Pick<AgreementContent, "rates"> & Partial<AgreementTerms>): number {
  return content.rates.length + (content.items?.length ?? 0) + (content.grids?.length ?? 0) + (content.surcharges?.length ?? 0);
}

export type { RateRow };
