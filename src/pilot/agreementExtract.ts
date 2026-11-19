import { z } from "zod";
import {
  MAX_CONDITIONS, MAX_GRID_COLUMNS, MAX_GRID_ROWS, MAX_GRIDS, MAX_ITEMS, MAX_SURCHARGES,
  type AgreementTerms, type GridColumn, type SurchargeKind,
} from "./agreementFormat.ts";
import { MAX_RATES, rateRowSchema, type RateRow } from "./freight.ts";
import { EXTRACT_MODEL, isoDate, printedAmounts, type AiInputs, type Confidence } from "./invoiceExtract.ts";

export const AGREEMENT_EXTRACT_VERSION = 2;
export const AGREEMENT_CACHE_PREFIX = "agreement:";
export const AGREEMENT_NO_TEXT = "PDF'en er kun et billede (fx en scannet side) og har intet tekstlag, så priserne kan ikke læses. Brug en PDF med tekst, eller udfyld skabelonen som CSV.";
/** Text per model call. A 3PL rate sheet has hundreds of numbers, more than one reply can hold, so pages are read in groups. */
export const AGREEMENT_CHUNK_CHARS = 5_000;
export const AGREEMENT_MAX_CHARS = 60_000;
export const AGREEMENT_MAX_CHUNKS = 12;

export type AgreementRate = {
  service: string;
  zone: string;
  maxWeight: number;
  baseOre: number;
  fuelPct: number;
  fixedOre: number;
  issues: string[];
};

export type ExtractItem = { category: string; description: string; unit: string; price: number | null; currency: string; note: string; issues: string[] };
export type ExtractGrid = {
  name: string;
  category: string;
  unit: string;
  currency: string;
  rowLabel: string;
  columns: GridColumn[];
  rows: { label: string; cells: (number | null)[] }[];
  minimum: (number | null)[];
  maximum: (number | null)[];
  note: string;
  /** Cells whose number is not in the PDF text: "row:column", "min:column" or "max:column". */
  unprinted: string[];
  issues: string[];
};
export type ExtractSurcharge = { label: string; kind: SurchargeKind; value: number | null; unit: string; scope: string; note: string; issues: string[] };
export type ExtractCondition = { text: string; printed: boolean };

export type AgreementExtract = {
  kind: "agreement";
  version: number;
  model: string;
  sha256: string;
  filename: string;
  createdAt: string;
  carrier: string;
  title: string;
  validFrom: string;
  validTo: string;
  currency: string;
  rates: AgreementRate[];
  items: ExtractItem[];
  grids: ExtractGrid[];
  surcharges: ExtractSurcharge[];
  conditions: ExtractCondition[];
  /** Distinct prices printed in the PDF (numbers with decimals) and how many of them the extract holds. */
  coverage: { printed: number; captured: number };
  chunks: number;
  confidence: Confidence;
  issues: string[];
  truncated: boolean;
  usage: { inputTokens: number; outputTokens: number; usd: number } | null;
};

const text = { type: "string" } as const;
const number = { type: "number" } as const;
const cell = { ...text, description: "Number exactly as printed, e.g. \"1.234,50\". \"\" when the cell is empty, \"Skal aftales\" when printed so" } as const;

export const AGREEMENT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    carrier: { ...text, description: "Logistics or freight company that offers the agreement, empty if not in this part" },
    title: { ...text, description: "Agreement title as printed, empty if not in this part" },
    validFrom: { ...text, description: "First valid day YYYY-MM-DD, empty if not in this part" },
    validTo: { ...text, description: "Last valid day YYYY-MM-DD, empty if not in this part" },
    currency: { ...text, description: "Main ISO currency, usually DKK" },
    rates: {
      type: "array",
      description: "Parcel price steps by weight only (service and max kg). Pallet, warehouse and zone tables are grids, not rates",
      items: {
        type: "object",
        properties: {
          service: text,
          zone: text,
          maxWeightKg: { ...number, description: "Upper bound of the weight step in kg" },
          price: { ...number, description: "Base price excluding VAT" },
          fuelPercent: { ...number, description: "Fuel percent printed on this row only, 0 otherwise" },
          fixedSurcharge: { ...number, description: "Fixed surcharge printed on this row only, 0 otherwise" },
        },
        required: ["service", "zone", "maxWeightKg", "price", "fuelPercent", "fixedSurcharge"],
      },
    },
    items: {
      type: "array",
      description: "Single prices: one description, one unit, one price. E.g. warehouse rent per pallet per week, order fee per order, hourly rate, trailer hire per day",
      items: {
        type: "object",
        properties: {
          category: { ...text, description: "Section heading the price is under, e.g. Lagerleje, Ordreekspedition, Trailerleje" },
          description: { ...text, description: "What the price is for, as printed, without the unit" },
          unit: { ...text, description: "Unit as printed, e.g. pr. palle, pr. palle pr. uge, pr. ordre, pr. ordrelinje, pr. kolli, pr. time, pr. dag, pr. forsendelse, pr. måned" },
          price: cell,
          currency: { ...text, description: "ISO currency of this price" },
          note: { ...text, description: "Short qualifier printed with the price, e.g. minimum 2 timer" },
        },
        required: ["category", "description", "unit", "price", "currency", "note"],
      },
    },
    grids: {
      type: "array",
      description: "Price tables with row tiers (e.g. pallet places 1, 2-3, 4-6, full load) against columns (region, receiver type, destination, zone, island)",
      items: {
        type: "object",
        properties: {
          name: { ...text, description: "Table heading, e.g. Distribution til Sverige" },
          category: { ...text, description: "Section, e.g. Distribution Danmark, Ø-fragt, Tidslevering" },
          unit: { ...text, description: "What a cell is priced per, e.g. pr. palleplads, pr. leverance" },
          currency: text,
          rowLabel: { ...text, description: "What the rows are, e.g. Pallepladser, Tidsrum" },
          columns: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { ...text, description: "Column heading: region, destination, zone or island name" },
                detail: { ...text, description: "Second heading line for the column: receiver type, postcodes, etc." },
              },
              required: ["label", "detail"],
            },
          },
          rows: {
            type: "array",
            description: "One entry per tier row. Not the minimum or maximum rows",
            items: {
              type: "object",
              properties: { label: { ...text, description: "Row tier as printed, e.g. 2-3 pallepladser, Hele læs" }, cells: { type: "array", items: cell } },
              required: ["label", "cells"],
            },
          },
          minimum: { type: "array", description: "Minimum per delivery for each column, [] if the table has none", items: cell },
          maximum: { type: "array", description: "Maximum for each column, [] if the table has none", items: cell },
          note: { ...text, description: "Short note printed with the table, e.g. ekskl. olie" },
        },
        required: ["name", "category", "unit", "currency", "rowLabel", "columns", "rows", "minimum", "maximum", "note"],
      },
    },
    surcharges: {
      type: "array",
      description: "Surcharges and supplements, e.g. fuel by country group, refrigeration, ETS, dangerous goods",
      items: {
        type: "object",
        properties: {
          label: text,
          kind: { type: "string", enum: ["percent", "amount", "agreed"] },
          value: { ...text, description: "Percent or amount exactly as printed, \"\" when it is to be agreed" },
          unit: { ...text, description: "For an amount: what it is per" },
          scope: { ...text, description: "What it applies to, e.g. Danmark, udland, kølevarer" },
          note: text,
        },
        required: ["label", "kind", "value", "unit", "scope", "note"],
      },
    },
    conditions: {
      type: "array",
      description: "Billing and service conditions as printed, one entry per bullet or sentence. Leave out page footers and address lists",
      items: text,
    },
  },
  required: ["carrier", "title", "validFrom", "validTo", "currency", "rates", "items", "grids", "surcharges", "conditions"],
};

const SYSTEM_PROMPT = `You read Danish and Nordic freight and logistics price agreements (prisaftaler, rateblade, 3PL contracts, parcel rate cards) and return their prices as JSON matching the schema.
Rules:
- Copy every number exactly as printed, in Danish notation, e.g. "1.234,50". Never compute, convert or invent a price.
- A single price with a description and a unit is an item. A table with tiers down the side and regions, receiver types, destinations, zones or islands across the top is a grid; return every cell.
- In a grid, rows labelled Minimum or Maksimum go in minimum and maximum, not in rows. A second header line (receiver type, Postnr., postcodes) goes in the column detail.
- Parcel prices by weight step (service and max kg) are rates.
- Fuel (olietillæg, brændstof), refrigeration (køletillæg), ETS, toll and dangerous goods supplements are surcharges. "Skal aftales" or "aftales separat" is kind "agreed" with value "".
- Bullet points under headings like Forudsætninger and Generelle forudsætninger are conditions. Copy them as printed.
- Only use what is in this part of the document. Return empty arrays for what is not in it.`;

function cleanText(pdfText: string): string {
  return pdfText.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Page groups of at most AGREEMENT_CHUNK_CHARS. pdfText separates pages with a blank line. */
export function agreementChunks(pdfText: string): { chunks: string[]; truncated: boolean } {
  const cleaned = cleanText(pdfText);
  const truncated = cleaned.length > AGREEMENT_MAX_CHARS;
  const body = truncated ? cleaned.slice(0, AGREEMENT_MAX_CHARS) : cleaned;
  const pieces = body.split(/\n\n+/).flatMap((page) => {
    if (page.length <= AGREEMENT_CHUNK_CHARS) return [page];
    const parts: string[] = [];
    let current = "";
    for (const line of page.split("\n")) {
      if (current && current.length + line.length + 1 > AGREEMENT_CHUNK_CHARS) {
        parts.push(current);
        current = "";
      }
      current = current ? `${current}\n${line}` : line;
    }
    if (current) parts.push(current);
    return parts;
  });
  const chunks: string[] = [];
  for (const piece of pieces) {
    const last = chunks.at(-1);
    if (last !== undefined && last.length + piece.length + 2 <= AGREEMENT_CHUNK_CHARS) chunks[chunks.length - 1] = `${last}\n\n${piece}`;
    else chunks.push(piece);
  }
  if (chunks.length > AGREEMENT_MAX_CHUNKS) return { chunks: chunks.slice(0, AGREEMENT_MAX_CHUNKS), truncated: true };
  return { chunks: chunks.length ? chunks : [""], truncated };
}

export function buildAgreementBatches(pdfText: string): { batches: AiInputs[]; truncated: boolean } {
  const { chunks, truncated } = agreementChunks(pdfText);
  return {
    truncated,
    batches: chunks.map((chunk, index) => ({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Price agreement text extracted from the PDF, part ${index + 1} of ${chunks.length}:\n\n${chunk}` },
      ],
      response_format: { type: "json_schema", json_schema: AGREEMENT_JSON_SCHEMA },
      max_tokens: 7000,
      temperature: 0,
    })),
  };
}

/** A printed number into a value, or null when the cell holds none ("", "Skal aftales"). */
export function cellValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !/\d/.test(value)) return null;
  let clean = value.replace(/\s|kr\.?|dkk|sek|eur|%|kg|^\+/gi, "");
  const comma = clean.lastIndexOf(",");
  const dot = clean.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) clean = comma > dot ? clean.replaceAll(".", "").replace(",", ".") : clean.replaceAll(",", "");
  else if (comma >= 0) clean = clean.replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(clean)) clean = clean.replaceAll(".", "");
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : null;
}

const num = z.unknown().transform((value) => cellValue(value) ?? 0);
const raw = z.unknown();
const label = (max: number) => z.unknown().transform((value) =>
  (typeof value === "string" || typeof value === "number" ? String(value) : "").replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim().slice(0, max));
const list = <T extends z.ZodTypeAny>(item: T, max: number) => z.array(item).max(max * 2).catch([]);

const outputSchema = z.object({
  carrier: label(70),
  title: label(100),
  validFrom: label(20),
  validTo: label(20),
  currency: label(8),
  rates: list(z.object({ service: label(64), zone: label(40), maxWeightKg: num, price: num, fuelPercent: num, fixedSurcharge: num }).passthrough(), MAX_RATES),
  items: list(z.object({ category: label(80), description: label(200), unit: label(60), price: raw, currency: label(8), note: label(300) }).passthrough(), MAX_ITEMS),
  grids: list(z.object({
    name: label(160),
    category: label(80),
    unit: label(60),
    currency: label(8),
    rowLabel: label(60),
    columns: list(z.object({ label: label(80), detail: label(160) }).passthrough(), MAX_GRID_COLUMNS),
    rows: list(z.object({ label: label(80), cells: list(raw, MAX_GRID_COLUMNS) }).passthrough(), MAX_GRID_ROWS),
    minimum: list(raw, MAX_GRID_COLUMNS),
    maximum: list(raw, MAX_GRID_COLUMNS),
    note: label(300),
  }).passthrough(), MAX_GRIDS),
  surcharges: list(z.object({ label: label(120), kind: label(10), value: raw, unit: label(60), scope: label(200), note: label(300) }).passthrough(), MAX_SURCHARGES),
  conditions: list(label(1000), MAX_CONDITIONS),
}).passthrough();

type Output = z.infer<typeof outputSchema>;

const ore = (value: number) => Math.round(value * 100);
const VAT = /^(moms|vat|mva)\b/i;
const AGREED = /skal aftales|aftales separat|efter aftale|to be agreed/i;
const squash = (value: string) => value.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "");

/** Distinct prices printed in the text: numbers with one to four decimals, in øre. */
export function printedPrices(pdfText: string): Set<number> {
  const found = new Set<number>();
  const joined = pdfText.normalize("NFKC").replace(/[\u00a0\u2007\u2009\u202f]/g, " ");
  for (const [token] of joined.matchAll(/(?<![\d.,])\d{1,3}(?:\.\d{3})*,\d{1,4}(?![\d,])|(?<![\d.,])\d+,\d{1,4}(?![\d,])/g)) {
    const value = cellValue(token);
    if (value !== null && value > 0) found.add(ore(value));
  }
  return found;
}

export type AgreementMeta = { sha256: string; filename: string; truncated?: boolean; usage?: AgreementExtract["usage"]; now?: Date };

/** Merges the replies for each page group, then looks up every number in the PDF's own text; what is not printed is flagged. */
export function validateAgreementExtract(rawOutput: unknown, pdfText: string, meta: AgreementMeta): AgreementExtract {
  const outputs: unknown[] = Array.isArray(rawOutput) ? rawOutput : [rawOutput];
  const parsedParts = outputs.map((output) => outputSchema.safeParse(output));
  const parts = parsedParts.flatMap((part) => part.success ? [part.data as Output] : []);
  if (parts.length === 0) throw new Error("Modellens svar passer ikke til prisaftaleskemaet.");
  const issues: string[] = [];
  if (parts.length < outputs.length) issues.push(`${outputs.length - parts.length} af ${outputs.length} dele af PDF'en kunne ikke læses.`);

  const amounts = printedAmounts(pdfText);
  const printed = (value: number) => value === 0 || amounts.has(Math.abs(ore(value)));
  const first = (pick: (part: Output) => string) => parts.map(pick).find(Boolean) ?? "";
  const currency = (first((part) => part.currency) || "DKK").toUpperCase();

  const rates: AgreementRate[] = parts.flatMap((part) => part.rates).slice(0, MAX_RATES).map((rate) => {
    const rowIssues: string[] = [];
    const baseOre = Math.max(0, ore(rate.price));
    const maxWeight = rate.maxWeightKg > 0 && rate.maxWeightKg <= 1000 ? Math.round(rate.maxWeightKg * 1000) / 1000 : 0;
    const ownFuel = rate.fuelPercent > 0 && rate.fuelPercent <= 300 ? rate.fuelPercent : 0;
    const ownFixedOre = Math.max(0, ore(rate.fixedSurcharge));
    if (!rate.service) rowIssues.push("Leveringsform mangler.");
    if (!baseOre) rowIssues.push("Grundpris mangler.");
    else if (!printed(rate.price)) rowIssues.push("Prisen står ikke ordret i PDF'en.");
    if (!maxWeight) rowIssues.push("Vægttrin mangler.");
    else if (!printed(maxWeight)) rowIssues.push("Vægttrinnet står ikke ordret i PDF'en.");
    if (ownFuel && !printed(ownFuel)) rowIssues.push("Brændstofprocenten står ikke ordret i PDF'en.");
    return { service: rate.service, zone: rate.zone, maxWeight, baseOre, fuelPct: ownFuel, fixedOre: ownFixedOre, issues: rowIssues };
  });

  const items: ExtractItem[] = parts.flatMap((part) => part.items).filter((item) => item.description).slice(0, MAX_ITEMS).map((item) => {
    const price = cellValue(item.price);
    const agreed = price === null && typeof item.price === "string" && AGREED.test(item.price);
    const itemIssues: string[] = [];
    if (price === null && !agreed) itemIssues.push("Prisen mangler.");
    else if (price !== null && !printed(price)) itemIssues.push("Prisen står ikke ordret i PDF'en.");
    return {
      category: item.category,
      description: item.description,
      unit: item.unit,
      price,
      currency: (item.currency || currency).toUpperCase(),
      note: agreed ? [item.note, "Skal aftales"].filter(Boolean).join(" · ") : item.note,
      issues: itemIssues,
    };
  });

  const grids: ExtractGrid[] = parts.flatMap((part) => part.grids).filter((grid) => grid.columns.length && grid.rows.length).slice(0, MAX_GRIDS).map((grid) => {
    const width = Math.min(grid.columns.length, MAX_GRID_COLUMNS);
    const unprinted: string[] = [];
    const line = (values: unknown[], key: (column: number) => string) => Array.from({ length: width }, (_, column) => {
      const value = cellValue(values[column]);
      if (value !== null && !printed(value)) unprinted.push(key(column));
      return value;
    });
    const rows = grid.rows.slice(0, MAX_GRID_ROWS).map((row, index) => ({
      label: row.label || `Række ${index + 1}`,
      cells: line(row.cells, (column) => `${index}:${column}`),
    }));
    const minimum = grid.minimum.length ? line(grid.minimum, (column) => `min:${column}`) : [];
    const maximum = grid.maximum.length ? line(grid.maximum, (column) => `max:${column}`) : [];
    const gridIssues: string[] = [];
    const total = rows.reduce((sum, row) => sum + row.cells.filter((value) => value !== null).length, 0)
      + minimum.filter((value) => value !== null).length + maximum.filter((value) => value !== null).length;
    if (unprinted.length) gridIssues.push(`${unprinted.length} af ${total} tal står ikke ordret i PDF'en.`);
    if (grid.rows.some((row) => row.cells.length !== grid.columns.length)) gridIssues.push("Nogle rækker har ikke én værdi pr. kolonne.");
    return {
      name: grid.name || "Prisgitter",
      category: grid.category,
      unit: grid.unit,
      currency: (grid.currency || currency).toUpperCase(),
      rowLabel: grid.rowLabel,
      columns: grid.columns.slice(0, width).map((column) => ({ label: column.label, detail: column.detail })),
      rows,
      minimum,
      maximum,
      note: grid.note,
      unprinted,
      issues: gridIssues,
    };
  });

  const surcharges: ExtractSurcharge[] = parts.flatMap((part) => part.surcharges).filter((item) => item.label && !VAT.test(item.label)).slice(0, MAX_SURCHARGES).map((item) => {
    const value = cellValue(item.value);
    const kind: SurchargeKind = value === null ? "agreed" : item.kind === "amount" ? "amount" : item.kind === "percent" ? "percent"
      : typeof item.value === "string" && item.value.includes("%") ? "percent" : "amount";
    const surchargeIssues: string[] = [];
    if (value !== null && !printed(value)) surchargeIssues.push("Værdien står ikke ordret i PDF'en.");
    if (value === null && item.kind !== "agreed" && !(typeof item.value === "string" && AGREED.test(item.value))) surchargeIssues.push("Værdien mangler.");
    return { label: item.label, kind, value, unit: item.unit, scope: item.scope, note: item.note, issues: surchargeIssues };
  });

  // On a parcel rate card the agreement-wide surcharges belong on each weight step, which is what the invoice check prices.
  if (rates.length && !grids.length) {
    const pct = Math.round(surcharges.filter((item) => item.kind === "percent").reduce((sum, item) => sum + (item.value ?? 0), 0) * 100) / 100;
    const fixedOre = surcharges.filter((item) => item.kind === "amount").reduce((sum, item) => sum + ore(item.value ?? 0), 0);
    for (const rate of rates) {
      if (!rate.fuelPct && pct > 0 && pct <= 300) rate.fuelPct = pct;
      if (!rate.fixedOre && fixedOre > 0) rate.fixedOre = fixedOre;
    }
  }

  const source = squash(pdfText);
  const seen = new Set<string>();
  const conditions: ExtractCondition[] = parts.flatMap((part) => part.conditions).filter((condition) => {
    const key = squash(condition);
    if (key.length < 4 || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_CONDITIONS).map((condition) => {
    const key = squash(condition);
    return { text: condition, printed: source.includes(key) || source.includes(key.slice(0, 40)) };
  });

  if (rates.length && currency !== "DKK") issues.push(`Pakkepriserne står i ${currency}, ikke DKK.`);
  if (meta.truncated) issues.push("Aftalen er lang. Kun den første del af teksten blev læst.");
  const priceCount = rates.length + items.length + grids.length + surcharges.length;
  if (priceCount === 0) issues.push("Der blev ikke fundet priser i PDF'en.");
  const unprintedConditions = conditions.filter((condition) => !condition.printed).length;
  if (unprintedConditions) issues.push(`${unprintedConditions} betingelser står ikke ordret i PDF'en.`);
  const validFrom = isoDate(first((part) => part.validFrom));
  const validTo = isoDate(first((part) => part.validTo));

  const prices = printedPrices(pdfText);
  const captured = new Set<number>();
  const take = (value: number | null) => {
    if (value !== null && prices.has(ore(Math.abs(value)))) captured.add(ore(Math.abs(value)));
  };
  for (const rate of rates) take(rate.baseOre / 100);
  for (const item of items) take(item.price);
  for (const grid of grids) for (const value of [...grid.rows.flatMap((row) => row.cells), ...grid.minimum, ...grid.maximum]) take(value);
  for (const item of surcharges) take(item.value);
  const coverage = { printed: prices.size, captured: captured.size };
  if (coverage.printed >= 10 && coverage.captured / coverage.printed < 0.9) {
    issues.push(`Kun ${coverage.captured} af ${coverage.printed} priser i PDF'en er med i udtrækket.`);
  }

  const numbers = rates.length * 2 + items.filter((item) => item.price !== null).length
    + grids.reduce((sum, grid) => sum + grid.rows.length * grid.columns.length, 0) + surcharges.length;
  const flagged = rates.filter((rate) => rate.issues.length).length + items.filter((item) => item.issues.length).length
    + grids.reduce((sum, grid) => sum + grid.unprinted.length, 0) + surcharges.filter((item) => item.issues.length).length;
  const confidence: Confidence = priceCount === 0 || meta.truncated || flagged * 5 > numbers || parts.length < outputs.length
    || (coverage.printed >= 10 && coverage.captured / coverage.printed < 0.75)
    ? "low"
    : flagged > 0 || issues.length > 0 ? "medium" : "high";

  return {
    kind: "agreement",
    version: AGREEMENT_EXTRACT_VERSION,
    model: EXTRACT_MODEL,
    sha256: meta.sha256,
    filename: meta.filename,
    createdAt: (meta.now ?? new Date()).toISOString(),
    carrier: first((part) => part.carrier),
    title: first((part) => part.title),
    validFrom,
    validTo: validTo && validFrom && validTo < validFrom ? "" : validTo,
    currency,
    rates,
    items,
    grids,
    surcharges,
    conditions,
    coverage,
    chunks: outputs.length,
    confidence,
    issues,
    truncated: Boolean(meta.truncated),
    usage: meta.usage ?? null,
  };
}

/** The extract without review markers, as the agreement stores it. */
export function extractTerms(extract: AgreementExtract): AgreementTerms {
  return {
    items: extract.items.map(({ issues: _issues, ...item }) => item),
    grids: extract.grids.map(({ issues: _issues, unprinted: _unprinted, ...grid }) => grid),
    surcharges: extract.surcharges.map(({ issues: _issues, ...item }) => item),
    conditions: extract.conditions.map((condition) => condition.text),
  };
}

/** The service name a rate is checked under. A zone, when the agreement has one, becomes part of it. */
export function rateService(service: string, zone: string): string {
  const name = service.trim();
  const area = zone.trim();
  if (!area || name.toLowerCase().includes(area.toLowerCase())) return name.slice(0, 64);
  return `${name} ${area}`.slice(0, 64);
}

/** Reviewed parcel rates into the rows Prisaftaler stores. Throws a Danish message naming the first bad row. */
export function agreementRatesToRows(rates: Omit<AgreementRate, "issues">[], from: string, to: string): RateRow[] {
  if (rates.length > MAX_RATES) throw new Error(`En prisaftale må højst have ${MAX_RATES} pakkepriser.`);
  return rates.map((rate, index) => {
    const parsed = rateRowSchema.safeParse({
      service: rateService(rate.service, rate.zone),
      maxWeight: rate.maxWeight,
      baseOre: rate.baseOre,
      fuelPct: rate.fuelPct,
      fixedOre: rate.fixedOre,
      from,
      to,
    });
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      const names: Record<string, string> = { service: "leveringsform", maxWeight: "vægttrin", baseOre: "grundpris", fuelPct: "brændstof", fixedOre: "fast tillæg" };
      throw new Error(`Pakkepris ${index + 1}. Kontrollér ${names[String(field)] ?? "rækken"}.`);
    }
    return parsed.data;
  });
}
