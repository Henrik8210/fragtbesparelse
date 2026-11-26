import { z } from "zod";
import {
  MAX_CONDITIONS, MAX_GRID_COLUMNS, MAX_GRID_ROWS, MAX_GRIDS, MAX_ITEMS, MAX_SURCHARGES,
  type AgreementTerms, type GridColumn, type SurchargeKind,
} from "./agreementFormat.ts";
import { MAX_RATES, rateRowSchema, type RateRow } from "./freight.ts";
import { layoutFingerprint, type LayoutFingerprint } from "./formatDrift.ts";
import { EXTRACT_MODEL, EXTRACT_SEED, isoDate, printedAmounts, type AiInputs, type Confidence } from "./invoiceExtract.ts";
import { lostPartIssues, PART_MIN_PRICES, printedOre, type PartPlan, type PartReport } from "./agreementParts.ts";

export const AGREEMENT_EXTRACT_VERSION = 6;
export const AGREEMENT_CACHE_PREFIX = "agreement:";
export const AGREEMENT_NO_TEXT = "PDF'en er kun et billede (fx en scannet side) og har intet tekstlag, så priserne kan ikke læses. Brug en PDF med tekst, eller tilføj prisaftalen som CSV.";
/** Text per model call. A 3PL rate sheet has hundreds of numbers, more than one reply can hold, so pages are read in groups. */
export const AGREEMENT_CHUNK_CHARS = 5_000;
export const AGREEMENT_MAX_CHARS = 60_000;
export const AGREEMENT_MAX_CHUNKS = 12;
/** Printed prices per part. A denser page is split, so one reply never has to hold a hundred grid cells. */
export const AGREEMENT_CHUNK_PRICES = 60;

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
  /** Keys the model returned outside the schema. */
  unmapped: string[];
  /** Normalized labels from the text layer, for format-change notices. */
  layout?: LayoutFingerprint;
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
    carrier: { ...text, description: "Company that issues the agreement and does the transport or warehousing (the supplier). Not the customer the agreement is for. Empty if the supplier is not named in this part" },
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
- The carrier is the supplier that issues the agreement and does the work. The customer is who it is for: in "Rateblad for X", "Prisaftale for X" or "Tilbud til X", X is the customer, never the carrier.
- Every line with a description and one price, e.g. "Pluk pr. kolli  1,57  DKK", is an item. Return every such line; never skip, merge or summarise them. A row inside a table is part of that grid, never an item.
- The carrier is the full company name exactly as printed in this document without its legal suffix (A/S, ApS, AB), never an abbreviation used in headings. Return "" when no company name is printed in this part.
- A surcharge whose percentages are listed in bullets under it is percent, one surcharge per bullet, with the value printed there.
- A price per hour, day, order or unit followed by DKK is an item or an amount, never a percent.
- A single price with a description and a unit is an item. A table with tiers down the side and regions, receiver types, destinations, zones or islands across the top is a grid; return every cell.
- The first cell of a grid's header row (Destination, Postnr., Ø Navn, Zone) names the row-label column. It is not a price column. Each column has one value per row, in printed order.
- In a grid, rows labelled Minimum or Maksimum go in minimum and maximum, not in rows. A second header line (receiver type, Postnr., postcodes) goes in the column detail.
- Parcel prices by weight step (service and max kg) are rates. A table with tiers in pallets (ppl, pll), loading metres (ldm), FTL or colli is a grid, never rates.
- Fuel (olietillæg, brændstof), refrigeration (køletillæg), ETS, toll and dangerous goods supplements are surcharges. "Skal aftales" or "aftales separat" is kind "agreed" with value "".
- Bullet points under headings like Forudsætninger and Generelle forudsætninger are conditions. Copy them as printed.
- Only use what is in this part of the document. Return empty arrays for what is not in it.`;

function cleanText(pdfText: string): string {
  return pdfText.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

type Piece = { text: string; page: number };

/** Index of each line that starts a block: a line without prices right after one with prices (a new table's name). */
function blockStarts(lines: string[]): number[] {
  const starts = [0];
  for (let index = 1; index < lines.length; index += 1) {
    if (!printedOre(lines[index]).size && printedOre(lines[index - 1]).size) starts.push(index);
  }
  return starts;
}

const isTitle = (line: string) => /^\p{Lu}/u.test(line.trim()) && !/\s{2,}/.test(line.trim()) && !printedOre(line).size && line.trim().length <= 90;

/** A page's blocks, grouped so no group passes a part's limit on text or prices unless one block alone does. */
function splitPage(text: string, page: number): Piece[] {
  if (text.length <= AGREEMENT_CHUNK_CHARS && printedOre(text).size <= AGREEMENT_CHUNK_PRICES) return [{ text, page }];
  const lines = text.split("\n");
  const starts = blockStarts(lines);
  const blocks = starts.map((start, at) => lines.slice(start, starts[at + 1] ?? lines.length).join("\n"));
  const pieces: Piece[] = [];
  let current = "";
  let title = "";
  for (const block of blocks) {
    const joined = current ? `${current}\n${block}` : block;
    if (current && (joined.length > AGREEMENT_CHUNK_CHARS || printedOre(joined).size > AGREEMENT_CHUNK_PRICES)) {
      pieces.push({ text: current, page });
      // A table cut from its title ("Distribution til Sverige") keeps the title as context.
      current = title && !block.startsWith(title) ? `${title}\n${block}` : block;
    } else current = joined;
    for (const line of block.split("\n")) if (isTitle(line)) title = line.trim();
  }
  if (current) pieces.push({ text: current, page });
  // A single block longer than a part is cut by line, as before.
  return pieces.flatMap((piece) => piece.text.length <= AGREEMENT_CHUNK_CHARS ? [piece] : cutLines(piece.text).map((part) => ({ text: part, page })));
}

function cutLines(text: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (current && current.length + line.length + 1 > AGREEMENT_CHUNK_CHARS) {
      parts.push(current);
      current = "";
    }
    current = current ? `${current}\n${line}` : line;
  }
  if (current) parts.push(current);
  return parts;
}

export type AgreementChunk = { text: string; pages: [number, number] };

/**
 * Page groups of at most AGREEMENT_CHUNK_CHARS and AGREEMENT_CHUNK_PRICES. pdfText separates pages with a blank line.
 * A page dense with prices gets parts of its own, so no single reply has to hold a hundred cells.
 */
export function agreementParts(pdfText: string): { parts: AgreementChunk[]; truncated: boolean } {
  const cleaned = cleanText(pdfText);
  const truncated = cleaned.length > AGREEMENT_MAX_CHARS;
  const body = truncated ? cleaned.slice(0, AGREEMENT_MAX_CHARS) : cleaned;
  const pieces = body.split(/\n\n+/).flatMap((page, index) => splitPage(page, index + 1));
  const parts: (AgreementChunk & { prices: number })[] = [];
  for (const piece of pieces) {
    const last = parts.at(-1);
    const prices = printedOre(piece.text).size;
    if (last && last.text.length + piece.text.length + 2 <= AGREEMENT_CHUNK_CHARS && last.prices + prices <= AGREEMENT_CHUNK_PRICES) {
      last.text = `${last.text}\n\n${piece.text}`;
      last.pages = [last.pages[0], piece.page];
      last.prices += prices;
    } else parts.push({ text: piece.text, pages: [piece.page, piece.page], prices });
  }
  const kept = parts.slice(0, AGREEMENT_MAX_CHUNKS).map(({ text, pages }) => ({ text, pages }));
  return { parts: kept.length ? kept : [{ text: "", pages: [1, 1] }], truncated: truncated || parts.length > AGREEMENT_MAX_CHUNKS };
}

export function agreementChunks(pdfText: string): { chunks: string[]; truncated: boolean } {
  const { parts, truncated } = agreementParts(pdfText);
  return { chunks: parts.map((part) => part.text), truncated };
}

/** The part in two at the block start nearest half of its prices, so a table keeps its name and header. */
function halves(text: string): [string, string] | null {
  const lines = text.split("\n");
  const total = printedOre(text).size;
  if (lines.length < 4 || total < PART_MIN_PRICES) return null;
  let best: { at: number; gap: number } | null = null;
  for (const at of blockStarts(lines).slice(1)) {
    const gap = Math.abs(printedOre(lines.slice(0, at).join("\n")).size - total / 2);
    if (!best || gap < best.gap) best = { at, gap };
  }
  const at = best?.at ?? Math.floor(lines.length / 2);
  return [lines.slice(0, at).join("\n"), lines.slice(at).join("\n")];
}

function agreementRequest(text: string, label: string): AiInputs {
  return {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Price agreement text extracted from the PDF, ${label}:\n\n${text}` },
    ],
    response_format: { type: "json_schema", json_schema: AGREEMENT_JSON_SCHEMA },
    max_tokens: 7000,
    temperature: 0,
    seed: EXTRACT_SEED,
  };
}

export function buildAgreementBatches(pdfText: string): { batches: AiInputs[]; plans: PartPlan[]; truncated: boolean } {
  const { parts, truncated } = agreementParts(pdfText);
  const label = (index: number) => `part ${index + 1} of ${parts.length}`;
  return {
    truncated,
    batches: parts.map((part, index) => agreementRequest(part.text, label(index))),
    plans: parts.map((part, index) => {
      const split = halves(part.text);
      // Tables and "description  price  DKK" lines are read from the text itself, so only the rest must come from the model.
      const own = new Set([...printedGrids(part.text).flatMap(gridValues), ...printedPriceLines(part.text).map((line) => ore(line.price))]);
      return {
        pages: part.pages,
        prices: [...printedOre(part.text)].filter((price) => !own.has(price)),
        halves: split ? split.map((text, half) => agreementRequest(text, `${label(index)}, ${half ? "second" : "first"} half`)) : [],
      };
    }),
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

const CUSTOMER = /\b(?:rateblad|prisaftale|prisblad|prisliste|tilbud|aftale|kontrakt|rate card|price list)\s+(?:for|til)\s+([^\n(,:]{2,60})/i;
const LEGAL_NAME = /(\p{Lu}[\p{L}&.'-]*(?: \p{Lu}[\p{L}&.'-]*){0,3}) (?:A\/S|ApS|I\/S|K\/S|AB|AS|GmbH|Oy|BV)(?![\p{L}])/gu;
const baseName = (value: string) => value.replace(/\s+(?:A\/S|ApS|I\/S|K\/S|AB|AS|GmbH|Oy|BV)\.?$/i, "").trim();

/** Who the agreement is for, from "Rateblad for X" and similar. */
export function agreementCustomer(pdfText: string): string {
  return CUSTOMER.exec(pdfText.normalize("NFKC"))?.[1]?.replace(/\s+/g, " ").trim().slice(0, 70) ?? "";
}

const initials = (name: string) => name.split(/[\s&-]+/).filter(Boolean).map((word) => word[0]).join("").toLowerCase();

/**
 * The issuing company. The model's answers count, except one that names the customer; then the company with a
 * legal suffix (A/S, ApS, AB …) named most often in the text, again not the customer. An answer that is that company's
 * initials or the start of its name ("NF" for Nord Fragt A/S) becomes the full name. An answer whose first word the
 * text does not print, and that is not such a short form, does not count.
 */
export function issuingCarrier(answers: string[], pdfText: string): string {
  const customer = squash(agreementCustomer(pdfText));
  const isCustomer = (name: string) => {
    const key = squash(baseName(name));
    return Boolean(customer && key && (key === customer || key.includes(customer) || customer.includes(key)));
  };
  const text = pdfText.normalize("NFKC");
  const named = new Map<string, { name: string; count: number; at: number }>();
  for (const match of text.matchAll(LEGAL_NAME)) {
    const name = match[1].trim();
    if (isCustomer(name)) continue;
    const key = squash(name);
    if (named.has(key)) continue;
    named.set(key, { name, count: text.split(name).length - 1, at: match.index ?? 0 });
  }
  const companies = [...named.values()].sort((a, b) => b.count - a.count || a.at - b.at);
  const fullName = (answer: string) => {
    const key = squash(answer);
    const found = companies.find((company) => {
      const full = squash(company.name);
      return full !== key && (initials(company.name) === key || (key.length >= 3 && full.startsWith(key)));
    });
    return found?.name ?? answer;
  };
  const words = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}&]+/gu, " ")} `;
  const printed = (name: string) => {
    const lead = name.toLowerCase().replace(/[^\p{L}\p{N}&]+/gu, " ").trim().split(" ")[0] ?? "";
    return lead.length > 0 && words.includes(` ${lead} `);
  };
  const votes = new Map<string, { name: string; count: number }>();
  for (const answer of answers) {
    const name = baseName(answer);
    if (!name || isCustomer(name)) continue;
    const full = fullName(name);
    // A name the PDF does not print (one the model brought along) is not the issuer.
    if (full === name && !printed(name)) continue;
    const key = squash(full);
    votes.set(key, { name: votes.get(key)?.name ?? full, count: (votes.get(key)?.count ?? 0) + 1 });
  }
  const voted = [...votes.values()].sort((a, b) => b.count - a.count)[0];
  if (voted) return voted.name.slice(0, 70);
  const best = companies[0];
  return best && best.count >= 2 ? best.name.slice(0, 70) : "";
}

const PRICE_LINE = /^(?![\u2022\u25e6\uf0b7\uf0a7\u25aa•◦])(\S.{2,160}?)\s{2,}(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})\s{2,}(DKK|EUR|SEK|NOK)\s*$/i;
const HEADING = /^\p{Lu}[^\d:]{2,58}[^\d:.,;]$/u;

/** "Description  1,57  DKK" lines from the text, each with the heading above it. */
export function printedPriceLines(pdfText: string): { category: string; description: string; unit: string; price: number; currency: string }[] {
  const found: { category: string; description: string; unit: string; price: number; currency: string }[] = [];
  let heading = "";
  for (const raw of pdfText.normalize("NFKC").split("\n")) {
    const line = raw.trim();
    const match = PRICE_LINE.exec(line);
    if (!match) {
      if (HEADING.test(line) && !/\s{2,}/.test(line) && !/^(?:raterne|priserne|alle priser)\b/i.test(line)) heading = line;
      continue;
    }
    const price = cellValue(match[2]);
    if (price === null || price <= 0) continue;
    const text = match[1].replace(/\s+/g, " ").trim();
    const split = text.search(/,?\s+pr\.\s/i);
    // "Tillæg pr. ordrelinje" says nothing without its unit, so a generic first word keeps the whole line.
    const at = split > 0 && !/^(?:tillæg|pris|håndtering|gebyr|rate)$/i.test(text.slice(0, split).trim()) ? split : -1;
    found.push({
      category: heading.slice(0, 80),
      description: (at > 0 ? text.slice(0, at) : text).replace(/,$/, "").slice(0, 200),
      unit: at > 0 ? text.slice(at).replace(/^,?\s+/, "").slice(0, 60) : "",
      price,
      currency: match[3].toUpperCase(),
    });
  }
  return found;
}

const HEADER_CELL = /^(?:destination(?:er)?|postnr\.?|post nr\.?|postnumre|ø[- ]?navn|zone|zoner|region|land|område|modtager|til)$/i;

/** The model sometimes makes the row-label header (Destination, Ø Navn) a price column and shifts the names by one. */
const isHeaderCell = (cell: string, grid: { rowLabel: string }) =>
  HEADER_CELL.test(cell.trim()) || Boolean(grid.rowLabel.trim() && squash(cell) === squash(grid.rowLabel));

function dropHeaderColumn(grid: ExtractGrid): ExtractGrid {
  if (grid.columns.length < 2 || !isHeaderCell(grid.columns[0].label, grid)) return grid;
  const lines = [...grid.rows.map((row) => row.cells), grid.minimum, grid.maximum].filter((line) => line.length);
  const lastEmpty = lines.every((line) => line[grid.columns.length - 1] === null || line[grid.columns.length - 1] === undefined);
  const firstEmpty = lines.every((line) => line[0] === null || line[0] === undefined);
  if (!lastEmpty && !firstEmpty) return grid;
  const keep = (line: (number | null)[]) => (firstEmpty ? line.slice(1) : line.slice(0, grid.columns.length - 1));
  const shiftKey = (key: string) => {
    const [row, column] = key.split(":");
    const index = Number(column) - (firstEmpty ? 1 : 0);
    return index >= 0 && index < grid.columns.length - 1 ? `${row}:${index}` : "";
  };
  return {
    ...grid,
    columns: firstEmpty ? grid.columns.slice(1) : grid.columns.slice(1).map((column, index) => ({ ...column, detail: column.detail || grid.columns[index]?.detail || "" })),
    rows: grid.rows.map((row) => ({ ...row, cells: keep(row.cells) })),
    minimum: grid.minimum.length ? keep(grid.minimum) : [],
    maximum: grid.maximum.length ? keep(grid.maximum) : [],
    unprinted: grid.unprinted.map(shiftKey).filter(Boolean),
  };
}

/** Percentages listed in bullets under the line that introduces the label and ends with a colon. */
export function listedPercents(label: string, pdfText: string): { value: number; scope: string }[] {
  const key = squash(label);
  if (!key) return [];
  const lines = pdfText.normalize("NFKC").split("\n");
  const start = lines.findIndex((line) => squash(line).includes(key) && line.trim().endsWith(":"));
  if (start < 0) return [];
  const found: { value: number; scope: string }[] = [];
  for (const line of lines.slice(start + 1)) {
    const match = /^[^\p{L}\d]*(\d+(?:,\d+)?)\s*%\s*(.*)$/u.exec(line.trim());
    if (!match) break;
    found.push({ value: Number(match[1].replace(",", ".")), scope: match[2].replace(/\.$/, "").slice(0, 200) });
  }
  return found;
}

const cellsOf = (line: string) => line.trim().split(/\s{2,}/).map((cell) => cell.trim()).filter(Boolean);

const MONEY_CELL = /^(?:\d{1,3}(?:\.\d{3})+|\d+),\d{1,2}$/;
const LIMIT_ROW = /^(minimum|min\.?|maks(?:imum)?\.?|max(?:imum)?\.?)(?:\s|$)/i;
const NOT_TITLE = /^(?:raterne|priserne|alle priser|gældende|rateblad)\b/i;

/** A table row: a label, then only prices ("2-3 pallepladser  184,81  245,21 …"). */
function valueRow(cells: string[]): boolean {
  return cells.length >= 2 && !MONEY_CELL.test(cells[0]) && /\p{L}|\d/u.test(cells[0]) && cells.slice(1).every((cell) => MONEY_CELL.test(cell));
}

/**
 * Price tables read straight from the text layer: a run of rows with the same number of prices, the header line
 * above them (with or without a row-label cell), a second header line as column detail, and Minimum or Maksimum
 * rows as limits. Every cell is printed by construction, so a model grid that matches one takes its cells from here.
 */
export function printedGrids(pdfText: string, currency = "DKK"): ExtractGrid[] {
  const lines = pdfText.normalize("NFKC").replace(/[\u00a0\u2007\u2009\u202f]/g, " ").split("\n");
  const rows = lines.map(cellsOf);
  const grids: ExtractGrid[] = [];
  let index = 0;
  while (index < rows.length) {
    if (!valueRow(rows[index])) {
      index += 1;
      continue;
    }
    const width = rows[index].length;
    let end = index;
    while (end + 1 < rows.length && valueRow(rows[end + 1]) && rows[end + 1].length === width) end += 1;
    const body = rows.slice(index, end + 1);
    const priced = body.filter((cells) => !LIMIT_ROW.test(cells[0]));
    if (body.length >= 2 && priced.length >= 1) {
      // Header lines sit right above the rows; a wrapped tail ("2652") may come between. One cell never heads one column.
      const fits = (cells: string[]) => cells.length === width || (cells.length === width - 1 && width > 2);
      const headers: { cells: string[]; at: number }[] = [];
      for (let at = index - 1, skipped = 0; at >= Math.max(0, index - 5); at -= 1) {
        const cells = rows[at];
        const usable = cells.length > 0 && !cells.some((cell) => MONEY_CELL.test(cell)) && !NOT_TITLE.test(lines[at].trim());
        if (usable && fits(cells) && headers.length < 2) headers.unshift({ cells, at });
        else if (headers.length || skipped++ >= 2) break;
      }
      const top = headers[0];
      const detail = headers[1];
      const names = (line?: { cells: string[] }) => !line ? [] : line.cells.length === width ? line.cells.slice(1) : line.cells;
      const labels = names(top);
      const details = names(detail);
      const titleAt = (top?.at ?? index) - 1;
      const title = lines.slice(Math.max(0, titleAt - 3), titleAt + 1).reverse().map((line) => line.trim())
        .find((line) => /^\p{L}/u.test(line) && line.length >= 4 && !/\s{2,}/.test(line) && !NOT_TITLE.test(line) && !printedOre(line).size) ?? "";
      const values = (cells: string[]) => cells.slice(1).map((cell) => cellValue(cell));
      grids.push({
        name: title.replace(/:$/, "").slice(0, 80) || grids[grids.length - 1]?.name || "Prisgitter",
        category: "",
        unit: "",
        currency,
        rowLabel: top && top.cells.length === width ? top.cells[0].slice(0, 60) : "",
        columns: Array.from({ length: width - 1 }, (_, column) => ({ label: (labels[column] ?? `Kolonne ${column + 1}`).slice(0, 80), detail: (details[column] ?? "").slice(0, 80) })),
        rows: priced.map((cells) => ({ label: cells[0].slice(0, 80), cells: values(cells) })),
        minimum: values(body.find((cells) => /^min/i.test(cells[0])) ?? []),
        maximum: values(body.find((cells) => /^ma(?:ks|x)/i.test(cells[0])) ?? []),
        note: "",
        unprinted: [],
        issues: [],
      });
    }
    index = end + 1;
  }
  return grids;
}

const gridValues = (grid: Pick<ExtractGrid, "rows" | "minimum" | "maximum">) =>
  [...grid.rows.flatMap((row) => row.cells), ...grid.minimum, ...grid.maximum].flatMap((value) => value === null || value === undefined ? [] : [ore(value)]);

/**
 * The printed table a model grid was read from: the one holding most of its values, when that is at least half of them.
 * A misread or skipped cell then comes from the text instead of being flagged.
 */
export function matchPrintedGrid(grid: Pick<ExtractGrid, "rows" | "minimum" | "maximum">, printed: ExtractGrid[], taken: Set<number>): number {
  const own = gridValues(grid);
  if (own.length < 2) return -1;
  let best = -1;
  let bestHits = 0;
  printed.forEach((candidate, at) => {
    if (taken.has(at)) return;
    const values = new Set(gridValues(candidate));
    const hits = own.filter((value) => values.has(value)).length;
    if (hits > bestHits) {
      best = at;
      bestHits = hits;
    }
  });
  return bestHits * 2 >= own.length ? best : -1;
}

const wordsOf = (text: string) => new Set(text.toLowerCase().normalize("NFKC").split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1));

/** Lines of running text, alone and joined with the next, as candidates for a condition the model reworded. */
export function printedSentences(pdfText: string): string[] {
  const lines = pdfText.normalize("NFKC").split("\n").map((line) => line.replace(/^[\s\u2022\u25e6\uf0b7\uf0a7\u25aa•◦-]+/, "").trim())
    .filter((line) => line.length >= 12 && !/\s{2,}/.test(line));
  return lines.flatMap((line, index) => index + 1 < lines.length ? [line, `${line} ${lines[index + 1]}`] : [line]);
}

/** The printed sentence sharing at least 70 % of its words with the condition, both ways; else empty. */
export function closestSentence(condition: string, sentences: string[]): string {
  const own = wordsOf(condition);
  if (own.size < 3) return "";
  let best = "";
  let bestScore = 0;
  for (const sentence of sentences) {
    const words = wordsOf(sentence);
    let shared = 0;
    for (const word of own) if (words.has(word)) shared += 1;
    const score = Math.min(shared / own.size, shared / words.size);
    if (score > bestScore) {
      best = sentence;
      bestScore = score;
    }
  }
  return bestScore >= 0.7 ? best.slice(0, 500) : "";
}

/** The printed table's title, cells, rows and column names; the model's category, unit and note, which the table does not hold. */
function fromPrintedGrid(grid: ExtractGrid, table: ExtractGrid): ExtractGrid {
  const named = table.columns.every((column) => !/^Kolonne \d+$/.test(column.label));
  const columns = named ? table.columns : table.columns.map((column, index) => grid.columns[index] ?? column);
  return {
    ...table,
    name: table.name === "Prisgitter" ? grid.name || table.name : table.name,
    category: grid.category,
    unit: grid.unit,
    currency: grid.currency || table.currency,
    rowLabel: table.rowLabel || grid.rowLabel,
    columns,
    note: grid.note,
    unprinted: [],
    issues: [],
  };
}

/**
 * Takes a grid's column names from the header line printed above its first row ("Destination  Aarby  Bstrup …"), with
 * the Postnr. line under it as the column detail, when that header has as many names as the row has prices.
 */
export function alignToPrintedHeader(grid: ExtractGrid, pdfText: string): ExtractGrid {
  const first = grid.rows.find((row) => row.cells.some((cell) => cell !== null));
  if (!first) return grid;
  const lines = pdfText.normalize("NFKC").split("\n");
  const firstValue = danishNumber(first.cells.find((cell) => cell !== null) as number);
  const at = lines.findIndex((line) => squash(line).startsWith(squash(first.label)) && line.includes(firstValue));
  if (at < 0) return grid;
  const printed = cellsOf(lines[at]).length - 1;
  for (let index = at - 1; index >= Math.max(0, at - 4); index -= 1) {
    const cells = cellsOf(lines[index]);
    if (!cells.length || !isHeaderCell(cells[0], grid)) continue;
    let labels = cells.slice(1);
    let details: string[] = [];
    const below = cellsOf(lines[index + 1] ?? "");
    if (index + 1 < at && below.length && isHeaderCell(below[0], grid)) details = below.slice(1);
    else if (index > 0 && /^(?:postnr\.?|post nr\.?)$/i.test(cells[0])) {
      const above = cellsOf(lines[index - 1]);
      details = labels;
      labels = above.length && isHeaderCell(above[0], grid) ? above.slice(1) : grid.columns.slice(0, details.length).map((column) => column.label);
    }
    if (labels.length !== printed) return grid;
    const width = labels.length;
    const lead = grid.columns.length - width;
    const used = [...grid.rows.map((row) => row.cells), grid.minimum, grid.maximum].filter((line) => line.length);
    const outside = (index: number) => used.every((line) => line[index] === null || line[index] === undefined);
    // Extra columns the model added must be empty, or the cells cannot be moved under the printed names.
    const extra = grid.columns.map((_, index) => index).filter((index) => index >= width);
    if (lead < 0 || !extra.every(outside)) return grid;
    const fit = (line: (number | null)[]) => (line.length ? line.slice(0, width) : line);
    return {
      ...grid,
      columns: labels.map((label, column) => ({ label: label.slice(0, 80), detail: (details.length === width ? details[column] : grid.columns[column]?.detail ?? "").slice(0, 80) })),
      rows: grid.rows.map((row) => ({ ...row, cells: fit(row.cells) })),
      minimum: fit(grid.minimum),
      maximum: fit(grid.maximum),
      unprinted: grid.unprinted.filter((key) => Number(key.split(":")[1]) < width),
    };
  }
  return grid;
}

const NOT_WEIGHT = /\b(?:ppl|pll|paller?|pallepladser?|ldm|ftl|ltl|colli|kolli|stk|m3|cbm)\b/i;
const WEIGHT = /\bkg\b/i;

/**
 * Rates the model read from a table whose tiers are pallets, loading metres or FTL ("0 – 3 ppl  2.025,14  2.935,04 …")
 * are not parcel prices by weight. They become that table as a grid, rebuilt from the printed lines, and leave the rates.
 */
export function palletRates(rates: AgreementRate[], pdfText: string, currency: string): { rates: AgreementRate[]; grids: ExtractGrid[] } {
  const lines = pdfText.normalize("NFKC").replace(/[\u00a0\u2007\u2009\u202f]/g, " ").split("\n");
  const rows = lines.map(cellsOf);
  const tierAt = (price: string) => rows.flatMap((cells, at) => cells.slice(1).includes(price) ? [at] : []);
  const moved = new Map<string, { service: string; zones: string[]; at: Set<number>; rates: AgreementRate[] }>();
  const kept: AgreementRate[] = [];
  for (const rate of rates) {
    const found = rate.baseOre > 0 ? tierAt(danishNumber(rate.baseOre / 100)) : [];
    const pallet = found.length > 0 && found.some((at) => NOT_WEIGHT.test(rows[at][0])) && !found.some((at) => WEIGHT.test(rows[at][0]));
    if (!pallet) {
      kept.push(rate);
      continue;
    }
    const key = squash(rate.service) || "prisgitter";
    const group = moved.get(key) ?? { service: rate.service || "Prisgitter", zones: [], at: new Set<number>(), rates: [] };
    if (rate.zone && !group.zones.includes(rate.zone)) group.zones.push(rate.zone);
    for (const at of found) if (NOT_WEIGHT.test(rows[at][0])) group.at.add(at);
    group.rates.push(rate);
    moved.set(key, group);
  }
  const grids: ExtractGrid[] = [];
  for (const group of moved.values()) {
    const first = Math.min(...group.at);
    const width = rows[first].length;
    // The table runs on from its first tier while lines keep the same number of cells, so tiers the model skipped come along.
    let last = first;
    while (last + 1 < rows.length && rows[last + 1].length === width && printedOre(lines[last + 1]).size) last += 1;
    const header = rows.slice(Math.max(0, first - 3), first).reverse().find((cells) => cells.length === width && !printedOre(cells.join(" ")).size);
    const columns = header ? header.slice(1) : group.zones;
    if (columns.length !== width - 1) {
      kept.push(...group.rates);
      continue;
    }
    grids.push({
      name: group.service.slice(0, 80),
      category: "",
      unit: "",
      currency,
      rowLabel: header?.[0] ?? "",
      columns: columns.map((label) => ({ label: label.slice(0, 80), detail: "" })),
      rows: rows.slice(first, last + 1).map((cells) => ({ label: cells[0].slice(0, 80), cells: cells.slice(1).map(cellValue) })),
      minimum: [],
      maximum: [],
      note: "",
      unprinted: [],
      issues: [],
    });
  }
  return { rates: kept, grids };
}

function danishNumber(value: number): string {
  return new Intl.NumberFormat("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true }).format(value);
}

/** True when the value is printed as money ("576,00 DKK") and never as a percent. */
function printedAsMoney(value: number, pdfText: string): boolean {
  const token = danishNumber(value).replace(/\./g, "\\.").replace(/\s/g, "\\s?");
  const money = new RegExp(`(?<![\\d.,])${token}\\s*(?:DKK|kr\\.?|EUR|SEK|NOK)`, "i");
  const percent = new RegExp(`(?<![\\d.,])${token}\\s*%`);
  const normalized = pdfText.normalize("NFKC").replace(/[\u00a0\u2007\u2009\u202f]/g, " ");
  return money.test(normalized) && !percent.test(normalized);
}

export type AgreementMeta = { sha256: string; filename: string; truncated?: boolean; usage?: AgreementExtract["usage"]; now?: Date; parts?: PartReport[] };

/** Merges the replies for each page group, then looks up every number in the PDF's own text; what is not printed is flagged. */
export function validateAgreementExtract(rawOutput: unknown, pdfText: string, meta: AgreementMeta): AgreementExtract {
  const outputs: unknown[] = Array.isArray(rawOutput) ? rawOutput : [rawOutput];
  // Every field falls back to empty, so a reply that is not an agreement object at all must not pass as an empty part.
  const shaped = (output: unknown) => Boolean(output && typeof output === "object" && !Array.isArray(output)
    && ["carrier", "rates", "items", "grids", "surcharges", "conditions"].some((key) => key in output));
  const parsedParts = outputs.map((output) => shaped(output) ? outputSchema.safeParse(output) : outputSchema.safeParse(null));
  const parts = parsedParts.flatMap((part) => part.success ? [part.data as Output] : []);
  if (parts.length === 0) throw new Error("Modellens svar passer ikke til prisaftaleskemaet.");
  const issues: string[] = [];
  const lost = meta.parts ? lostPartIssues(meta.parts) : [];
  if (meta.parts) issues.push(...lost);
  else if (parts.length < outputs.length) issues.push(`${outputs.length - parts.length} af ${outputs.length} dele af PDF'en kunne ikke læses.`);

  const known = new Set(Object.keys(outputSchema.shape));
  const unmapped = [...new Set(parts.flatMap((part) => Object.keys(part).filter((key) => !known.has(key))))].slice(0, 20);
  const amounts = printedAmounts(pdfText);
  const printed = (value: number) => value === 0 || amounts.has(Math.abs(ore(value)));
  const first = (pick: (part: Output) => string) => parts.map(pick).find(Boolean) ?? "";
  const currency = (first((part) => part.currency) || "DKK").toUpperCase();

  // A rate with no price and no weight that only repeats a grid's name is the grid read twice.
  const gridNames = new Set(parts.flatMap((part) => part.grids.map((grid) => squash(grid.name))).filter(Boolean));
  const readRates: AgreementRate[] = parts.flatMap((part) => part.rates)
    .filter((rate) => ore(rate.price) > 0 || rate.maxWeightKg > 0 || !gridNames.has(squash(rate.service)))
    .slice(0, MAX_RATES).map((rate) => {
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
  const readGridNames = new Set(parts.flatMap((part) => part.grids.map((grid) => squash(grid.name))));
  const { rates, grids: palletGrids } = palletRates(readRates, pdfText, currency);
  const tableGrids = palletGrids.filter((grid) => !readGridNames.has(squash(grid.name)));
  const tables = printedGrids(pdfText, currency);
  const printedLines = printedPriceLines(pdfText);

  const items: ExtractItem[] = parts.flatMap((part) => part.items).filter((item) => item.description).slice(0, MAX_ITEMS).map((item) => {
    const read = cellValue(item.price);
    // A line printed once with this description gives the price, so a misread digit is corrected instead of flagged.
    const key = squash(item.description);
    const whole = squash(`${item.description} ${item.unit}`);
    // "Manuel booking, pr. ordre" as one description is the printed line "Manuel booking" with its unit "pr. ordre".
    const same = key.length >= 4 ? printedLines.filter((line) => {
      const printedKey = squash(line.description);
      const printedWhole = squash(`${line.description} ${line.unit}`);
      return (printedKey === key && (!item.unit || !line.unit || squash(line.unit) === squash(item.unit))) || printedWhole === key || printedWhole === whole;
    }) : [];
    const agreed = read === null && typeof item.price === "string" && AGREED.test(item.price);
    const price = same.length === 1 && !agreed ? same[0].price : read;
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

  const heldPrices = new Set<number>([
    ...rates.map((rate) => rate.baseOre),
    ...tableGrids.flatMap((grid) => grid.rows.flatMap((row) => row.cells)).flatMap((value) => value === null ? [] : [ore(value)]),
    ...items.flatMap((item) => item.price === null ? [] : [ore(item.price)]),
    ...parts.flatMap((part) => [...part.grids.flatMap((grid) => [...grid.rows.flatMap((row) => row.cells), ...grid.minimum, ...grid.maximum]),
      ...part.surcharges.map((item) => item.value)]).flatMap((value) => {
      const parsed = cellValue(value);
      return parsed === null ? [] : [ore(parsed)];
    }),
  ]);
  // Lines the model left out are taken from the text layer as printed, so they are anchored by construction.
  for (const line of printedPriceLines(pdfText)) {
    if (items.length >= MAX_ITEMS || heldPrices.has(ore(line.price))) continue;
    heldPrices.add(ore(line.price));
    items.push({ ...line, note: "", issues: [] });
  }

  const modelGrids: ExtractGrid[] = parts.flatMap((part) => part.grids).filter((grid) => grid.columns.length && grid.rows.length).slice(0, MAX_GRIDS).map((grid) => {
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
    return dropHeaderColumn({
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
    });
  }).map((grid) => alignToPrintedHeader(grid, pdfText)).concat(tableGrids);
  // Each grid the model read becomes the printed table it came from, so its cells, rows and columns are the same on every
  // read; a second copy of a table (two parts both reading it) is dropped. Printed tables the model left out are added.
  const used = new Set<number>();
  const snapped = modelGrids.flatMap((grid) => {
    const at = matchPrintedGrid(grid, tables, new Set());
    if (at < 0) return [grid];
    if (used.has(at)) return [];
    used.add(at);
    return [fromPrintedGrid(grid, tables[at])];
  });
  const otherPrices = new Set([...rates.map((rate) => rate.baseOre), ...items.flatMap((item) => item.price === null ? [] : [ore(item.price)])]);
  const left = tables.filter((table, at) => {
    if (used.has(at)) return false;
    const values = gridValues(table);
    return values.filter((value) => otherPrices.has(value)).length * 2 < values.length;
  });
  const grids: ExtractGrid[] = [...snapped, ...left].slice(0, MAX_GRIDS).map((grid) => {
    const empty = grid.columns.map((column, index) => ({ column, index })).filter(({ index }) =>
      [...grid.rows.map((row) => row.cells), grid.minimum, grid.maximum].every((line) => line[index] === null || line[index] === undefined));
    const issues = [...grid.issues];
    for (const { column, index } of empty) issues.push(`Kolonnen «${column.label || index + 1}» har ingen priser. Kontrollér kolonnerne.`);
    if (grid.columns.some((column) => !column.label.trim() || isHeaderCell(column.label, grid))) issues.push("En kolonne mangler sit navn.");
    return { ...grid, issues };
  });

  const surcharges: ExtractSurcharge[] = parts.flatMap((part) => part.surcharges).filter((item) => item.label && !VAT.test(item.label)).slice(0, MAX_SURCHARGES).map((item) => {
    const value = cellValue(item.value);
    const stated: SurchargeKind = value === null ? "agreed" : item.kind === "amount" ? "amount" : item.kind === "percent" ? "percent"
      : typeof item.value === "string" && item.value.includes("%") ? "percent" : "amount";
    const kind: SurchargeKind = stated === "percent" && value !== null && printedAsMoney(value, pdfText) ? "amount" : stated;
    const surchargeIssues: string[] = [];
    if (value !== null && !printed(value)) surchargeIssues.push("Værdien står ikke ordret i PDF'en.");
    if (value === null && item.kind !== "agreed" && !(typeof item.value === "string" && AGREED.test(item.value))) surchargeIssues.push("Værdien mangler.");
    return { label: item.label, kind, value, unit: item.unit, scope: item.scope, note: item.note, issues: surchargeIssues };
  });

  // A grid row the model also returned as an item ("Minimum 1.007,01" under the grid's own name) is the grid read twice.
  const gridSets = new Map(grids.map((grid) => [squash(grid.name), new Set(
    [...grid.rows.flatMap((row) => row.cells), ...grid.minimum, ...grid.maximum].flatMap((value) => value === null ? [] : [ore(value)]),
  )]));
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    const values = gridSets.get(squash(item.category));
    if (values && item.price !== null && values.has(ore(item.price))) items.splice(index, 1);
  }

  // "Olietillæg … udgør:" followed by "◦ 21,58% for …" bullets: the values are printed, one surcharge per bullet.
  const taken = new Map<string, number>();
  for (const item of surcharges) {
    if (item.value !== null || item.kind !== "agreed") continue;
    const key = squash(item.label);
    const listed = listedPercents(item.label, pdfText);
    const at = taken.get(key) ?? 0;
    if (at >= listed.length) continue;
    taken.set(key, at + 1);
    item.kind = "percent";
    item.value = listed[at].value;
    if (!item.scope) item.scope = listed[at].scope;
    item.issues = [];
  }

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
  const sentences = printedSentences(pdfText);
  const conditions: ExtractCondition[] = parts.flatMap((part) => part.conditions).map((condition) => {
    const key = squash(condition);
    if (source.includes(key) || source.includes(key.slice(0, 40))) return { text: condition, printed: true };
    // A condition the model reworded is the printed sentence it came from, when nearly the same words are there.
    const near = closestSentence(condition, sentences);
    return near ? { text: near, printed: true } : { text: condition, printed: false };
  }).filter((condition) => {
    const key = squash(condition.text);
    if (key.length < 4 || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_CONDITIONS);

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
  // Numbers inside text the extract holds (tier labels such as "0,5 ppl", conditions such as "maks. 2,60 meter") are read too.
  const held = [
    ...rates.map((rate) => `${rate.service} ${rate.zone}`),
    ...items.map((item) => `${item.description} ${item.unit} ${item.note}`),
    ...grids.flatMap((grid) => [grid.name, grid.note, ...grid.rows.map((row) => row.label), ...grid.columns.flatMap((column) => [column.label, column.detail])]),
    ...surcharges.map((item) => `${item.label} ${item.unit} ${item.scope} ${item.note}`),
    ...conditions.filter((condition) => condition.printed).map((condition) => condition.text),
  ].join("\n");
  for (const value of printedPrices(held)) if (prices.has(value)) captured.add(value);
  const coverage = { printed: prices.size, captured: captured.size };
  if (coverage.printed >= 10 && coverage.captured / coverage.printed < 0.9) {
    issues.push(`Kun ${coverage.captured} af ${coverage.printed} priser i PDF'en er med i udtrækket.`);
  }

  const numbers = rates.length * 2 + items.filter((item) => item.price !== null).length
    + grids.reduce((sum, grid) => sum + grid.rows.length * grid.columns.length, 0) + surcharges.length;
  const flagged = rates.filter((rate) => rate.issues.length).length + items.filter((item) => item.issues.length).length
    + grids.reduce((sum, grid) => sum + grid.unprinted.length, 0) + surcharges.filter((item) => item.issues.length).length;
  const confidence: Confidence = priceCount === 0 || meta.truncated || flagged * 5 > numbers || lost.length > 0 || (!meta.parts && parts.length < outputs.length)
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
    carrier: issuingCarrier(parts.map((part) => part.carrier), pdfText),
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
    unmapped,
    layout: layoutFingerprint(pdfText, [
      ...rates.map((rate) => rate.service),
      ...items.map((item) => item.category),
      ...grids.flatMap((grid) => [grid.name, grid.rowLabel]),
      ...surcharges.map((item) => item.label),
    ]),
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
