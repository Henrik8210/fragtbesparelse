import type { AgreementTerms, PriceGrid } from "./agreementFormat.ts";
import {
  normalizedText, serviceKey, type AuditLine, type InvoiceRow, type LineStatus, type RateRow,
} from "./freight.ts";
import { lineTotalOre, type InvoiceExtract, type LineKind } from "./invoiceExtract.ts";

/** An invoice line the agreement check can price. A parcel row leaves kind, quantity and zone empty. */
export type TermsLine = InvoiceRow & {
  kind?: LineKind;
  quantity?: number;
  unit?: string;
  zone?: string;
};

const STATUS_REASON: Record<Exclude<LineStatus, "review">, string> = {
  over: "Fakturaen ligger over den beregnede aftalepris.",
  under: "Fakturaen ligger under den beregnede aftalepris.",
  match: "Fakturaen stemmer med aftalen inden for 1 øre.",
};

const STOP = new Set(["pr", "og", "af", "til", "den", "det", "en", "et", "for", "med", "ved", "paa", "som", "samt", "eller", "der"]);

const kroner = (ore: number) => `${(ore / 100).toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr.`;
const count = (value: number) => value.toLocaleString("da-DK", { maximumFractionDigits: 4 });
const oreOf = (value: number) => Math.round(value * 100);

function words(value: string): string[] {
  return value.toLowerCase().replaceAll("æ", "ae").replaceAll("ø", "oe").replaceAll("å", "aa")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP.has(word));
}

function sameWord(left: string, right: string): boolean {
  if (left === right) return true;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  return shorter.length >= 6 && longer.startsWith(shorter) && longer.length - shorter.length <= 3;
}

function overlap(left: string[], right: string[]): string[] {
  return left.filter((word) => right.some((other) => sameWord(word, other)));
}

type CatalogItem = { description: string; unit: string; price: number };

function scoreItem(line: string, item: CatalogItem): number {
  const own = words(`${item.description} ${item.unit}`);
  const theirs = words(line);
  if (!own.length || !theirs.length) return 0;
  const shared = overlap(own, theirs);
  if (!shared.length) return 0;
  return shared.length / own.length + shared.length / theirs.length;
}

function bestItem(line: string, items: CatalogItem[]): CatalogItem | "several" | null {
  const ranked = items.map((item) => ({ item, score: scoreItem(line, item) })).filter((entry) => entry.score >= 1.15)
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  if (best) {
    const next = ranked[1];
    if (next && best.score - next.score < 0.15 && oreOf(best.item.price) !== oreOf(next.item.price)) return "several";
    return best.item;
  }
  // "Timelønsarbejde, sortering af returvarer" is the item "Timelønsarbejde inden for normal arbejdstid".
  const lead = words(line).find((word) => word.length >= 10);
  if (!lead) return null;
  const hits = items.filter((item) => sameWord(words(item.description)[0] ?? "", lead));
  if (hits.length === 1) return hits[0];
  if (hits.length > 1 && new Set(hits.map((item) => oreOf(item.price))).size === 1) return hits[0];
  return hits.length > 1 ? "several" : null;
}

type Tier = { min: number; max: number; flat: boolean };

function tierOf(label: string): Tier | null {
  const text = label.toLowerCase().replaceAll("æ", "ae");
  if (/hele\s*laes|full-?\s*loads?|\bmodul\b/.test(text)) return { min: 0, max: Infinity, flat: true };
  const above = />\s*(\d+(?:[.,]\d+)?)/.exec(text);
  if (above) return { min: Number(above[1].replace(",", ".")) + 0.001, max: Infinity, flat: false };
  const span = /(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)/.exec(text);
  if (span) return { min: Number(span[1].replace(",", ".")), max: Number(span[2].replace(",", ".")), flat: false };
  const single = /(\d+)\s*(?:palle|ppl|pll)/.exec(text);
  if (single) return { min: Number(single[1]), max: Number(single[1]), flat: false };
  return null;
}

function wantedTier(service: string, unit: string): Tier | null {
  if (/\blæs\b/i.test(unit) || /hele\s*læs/i.test(`${unit} ${service}`)) return { min: 0, max: Infinity, flat: true };
  const named = /\((\d+)\s*[-–]\s*(\d+)\s*ppl\)/i.exec(service);
  if (!named) return null;
  return { min: Number(named[1]), max: Number(named[2]), flat: false };
}

function pickRow(grid: PriceGrid, quantity: number | undefined, service: string, unit: string): PriceGrid["rows"][number] | null {
  const wanted = wantedTier(service, unit);
  const rows = grid.rows.map((row) => ({ row, tier: tierOf(row.label) })).filter((entry) => entry.tier);
  if (wanted?.flat) return rows.find((entry) => entry.tier?.flat)?.row ?? null;
  const usable = rows.filter((entry) => entry.tier && !entry.tier.flat);
  if (wanted) {
    const exact = usable.find((entry) => entry.tier?.min === wanted.min && entry.tier.max === wanted.max);
    if (exact) return exact.row;
  }
  if (quantity === undefined) return null;
  const fits = usable.filter((entry) => entry.tier && entry.tier.min <= quantity && quantity <= entry.tier.max)
    .sort((left, right) => (left.tier!.max - left.tier!.min) - (right.tier!.max - right.tier!.min));
  return fits[0]?.row ?? null;
}

function columnScore(column: PriceGrid["columns"][number], line: TermsLine): number {
  const hay = normalizedText(`${line.zone ?? ""} ${line.service}`);
  const label = normalizedText(column.label);
  if (label.length < 4 || !hay.includes(label)) return 0;
  let score = 4;
  const letter = /^([ab])\b/i.exec(column.detail.trim())?.[1]?.toLowerCase();
  if (letter) {
    const own = letter === "a" ? "b" : "a";
    if (hay.includes(label + letter)) score += 3;
    else if (hay.includes(label + own)) score -= 2;
  }
  const posted = column.detail.toUpperCase().match(/[A-Z]{2}-\d{4,5}/g) ?? [];
  const text = `${line.service} ${line.zone ?? ""}`.toUpperCase();
  if (posted.some((code) => text.includes(code))) score += 5;
  return score;
}

type Cell = { grid: PriceGrid; column: number; row: PriceGrid["rows"][number]; price: number; score: number };

function bestCell(line: TermsLine, grids: PriceGrid[]): Cell | "several" | null {
  const found: Cell[] = [];
  for (const grid of grids) {
    const row = pickRow(grid, line.quantity, line.service, line.unit ?? "");
    if (!row) continue;
    grid.columns.forEach((column, index) => {
      const price = row.cells[index];
      const score = columnScore(column, line);
      if (price === null || price === undefined || score < 4) return;
      found.push({ grid, column: index, row, price, score });
    });
  }
  found.sort((left, right) => right.score - left.score);
  const best = found[0];
  if (!best) return null;
  const rival = found.find((entry) => entry !== best && best.score - entry.score < 1 && oreOf(entry.price) !== oreOf(best.price));
  return rival ? "several" : best;
}

function cellAmount(line: TermsLine, cell: Cell): number {
  const tier = tierOf(cell.row.label);
  const quantity = line.quantity ?? 1;
  const flat = Boolean(tier?.flat);
  const loads = flat && /\blæs\b/i.test(line.unit ?? "") ? quantity : 1;
  let expected = flat ? oreOf(cell.price) * loads : Math.round(quantity * oreOf(cell.price));
  const minimum = cell.grid.minimum[cell.column];
  if (!flat && minimum !== null && minimum !== undefined && expected < oreOf(minimum)) expected = oreOf(minimum);
  return expected;
}

export type FuelRates = { national: number | null; other: number | null };

/** The two oil percentages: national DK/SE, and other countries. Read from surcharges and from the condition text. */
export function fuelRates(terms: AgreementTerms): FuelRates {
  const found: FuelRates = { national: null, other: null };
  const texts = [
    ...terms.conditions,
    ...terms.surcharges.map((item) => `${item.label} ${item.scope} ${item.note}`),
  ];
  for (const item of terms.surcharges) {
    if (item.kind !== "percent" || item.value === null) continue;
    const scope = `${item.label} ${item.scope}`.toLowerCase();
    if (!/olie|brænd|braend|fuel|diesel|national|øvrige|ovrige/.test(scope)) continue;
    if (/øvrige|ovrige|andre lande/.test(scope)) found.other = item.value;
    else found.national = item.value;
  }
  for (const text of texts) {
    const national = /(\d+(?:[.,]\d+)?)\s*%[^.\n]{0,50}national/i.exec(text);
    const other = /(\d+(?:[.,]\d+)?)\s*%[^.\n]{0,40}(?:øvrige|ovrige)/i.exec(text);
    if (national && found.national === null) found.national = Number(national[1].replace(",", "."));
    if (other && found.other === null) found.other = Number(other[1].replace(",", "."));
  }
  return found;
}

function fuelScope(service: string): "national" | "other" | null {
  if (!/olie|brændstof|braendstof|fuel|diesel/i.test(service)) return null;
  if (/øvrige|ovrige|andre lande/i.test(service)) return "other";
  if (/national|danmark|sverige|dk\s*\/\s*se/i.test(service)) return "national";
  return null;
}

function parcelExpected(line: TermsLine, rates: RateRow[]): { expectedOre: number; rate: AuditLine["rate"] } | null {
  if (line.kind && line.kind !== "shipment") return null;
  if (line.origin !== "DK" || line.destination !== "DK") return null;
  const active = rates.filter((rate) => serviceKey(rate.service) === serviceKey(line.service)
    && rate.maxWeight >= line.weight
    && (!rate.from || rate.from <= line.date)
    && (!rate.to || rate.to >= line.date)).sort((left, right) => left.maxWeight - right.maxWeight);
  const rate = active[0];
  if (!rate) return null;
  const same = active.filter((candidate) => candidate.maxWeight === rate.maxWeight);
  if (same.some((candidate) => candidate.baseOre !== rate.baseOre || candidate.fixedOre !== rate.fixedOre || candidate.fuelPct !== rate.fuelPct)) return null;
  const fuelOre = Math.round(rate.baseOre * rate.fuelPct / 100);
  return { expectedOre: rate.baseOre + fuelOre + rate.fixedOre, rate: { ...rate, fuelOre } };
}

function judged(line: TermsLine, key: string, expectedOre: number, detail: string, rate: AuditLine["rate"] = null): AuditLine {
  const differenceOre = line.billedOre - expectedOre;
  const status: Exclude<LineStatus, "review"> = differenceOre > 1 ? "over" : differenceOre < -1 ? "under" : "match";
  return { ...line, key, status, expectedOre, differenceOre, reason: `${STATUS_REASON[status]} ${detail}`.trim(), rate };
}

function review(line: TermsLine, key: string, reason: string): AuditLine {
  return { ...line, key, status: "review", expectedOre: null, differenceOre: null, reason, rate: null };
}

/**
 * Prices every line against the agreement's items, pallet grids, amount surcharges and fuel percentages.
 * Parcel rate rows still price a shipment whose service they name. A fee the agreement does not list is an
 * overcharge of its whole amount. A distribution line with no cell is left for review, not treated as zero.
 */
export function priceTerms(lines: TermsLine[], terms: AgreementTerms, rates: RateRow[] = []): AuditLine[] {
  const catalog: CatalogItem[] = [
    ...terms.items.flatMap((item) => item.price === null || (item.currency && item.currency !== "DKK") ? [] : [{ description: item.description, unit: item.unit, price: item.price }]),
    ...terms.surcharges.flatMap((item) => item.kind === "amount" && item.value !== null ? [{ description: item.label, unit: item.unit, price: item.value }] : []),
  ];
  const fuel = fuelRates(terms);
  const priced: AuditLine[] = new Array(lines.length);
  const freight: { index: number; national: boolean; expectedOre: number }[] = [];

  lines.forEach((line, index) => {
    const key = String(index + 1);
    if (line.billedOre < 0 || line.kind === "credit") {
      priced[index] = review(line, key, "Kreditering. Afstem beløbet mod den oprindelige fakturalinje.");
      return;
    }
    if (fuelScope(line.service)) {
      priced[index] = review(line, key, "");
      return;
    }
    const distribution = !line.kind || line.kind === "shipment";
    const cell = distribution ? bestCell(line, terms.grids) : null;
    if (cell === "several") {
      priced[index] = review(line, key, "Flere ruter i prisaftalen passer på linjen.");
      return;
    }
    if (cell) {
      const expectedOre = cellAmount(line, cell);
      const column = cell.grid.columns[cell.column];
      const where = [column.label, column.detail].filter(Boolean).join(" ");
      const tier = tierOf(cell.row.label);
      const detail = tier?.flat
        ? `Aftalt ${cell.row.label}, ${where}: ${kroner(expectedOre)}.`
        : `Aftalt ${cell.row.label}, ${where}: ${count(cell.price)} kr. × ${count(line.quantity ?? 1)} = ${kroner(expectedOre)}.`;
      priced[index] = judged(line, key, expectedOre, detail);
      freight.push({ index, national: line.destination === "DK" || line.destination === "SE", expectedOre });
      return;
    }
    if (distribution) {
      const parcel = parcelExpected(line, rates);
      if (parcel) {
        priced[index] = judged(line, key, parcel.expectedOre, "", parcel.rate);
        freight.push({ index, national: true, expectedOre: parcel.expectedOre });
        return;
      }
      priced[index] = review(line, key, "Ingen pris i aftalen for ruten og antallet.");
      return;
    }
    const item = bestItem(line.service, catalog);
    if (item === "several") {
      priced[index] = review(line, key, "Flere priser i aftalen passer på linjen.");
      return;
    }
    if (!item) {
      priced[index] = judged(line, key, 0, "Tillægget står ikke i prisaftalen, så det aftalte beløb er 0,00 kr.");
      return;
    }
    const quantity = line.quantity ?? 1;
    const expectedOre = Math.round(quantity * oreOf(item.price));
    const unit = item.unit ? ` ${item.unit}` : "";
    priced[index] = judged(line, key, expectedOre, `Aftalt ${count(item.price)} kr.${unit} × ${count(quantity)} = ${kroner(expectedOre)}.`);
  });

  lines.forEach((line, index) => {
    const scope = fuelScope(line.service);
    if (!scope || line.billedOre < 0) return;
    const percent = fuel[scope];
    if (percent === null) {
      priced[index] = review(line, keyOf(index), "Olietillægget står ikke med en procentsats i prisaftalen.");
      return;
    }
    const baseOre = freight.filter((entry) => (scope === "national" ? entry.national : !entry.national))
      .reduce((sum, entry) => sum + entry.expectedOre, 0);
    const expectedOre = Math.round(baseOre * percent / 100);
    const where = scope === "national" ? "national kørsel i Danmark og Sverige" : "øvrige lande";
    priced[index] = judged(line, keyOf(index), expectedOre, `Aftalt ${count(percent)} % af fragt for ${where} (${kroner(baseOre)}) = ${kroner(expectedOre)}.`);
  });
  return priced;
}

function keyOf(index: number) {
  return String(index + 1);
}

/** Every priced line of a read invoice, fees and fuel included, for the agreement check. */
export function linesFromExtractForAudit(extract: Pick<InvoiceExtract, "lines" | "invoiceDate">): TermsLine[] {
  return extract.lines.flatMap((line, index) => {
    const date = line.date || extract.invoiceDate;
    const service = line.service.trim();
    if (!date || !service) return [];
    return [{
      shipment: (line.shipment || line.reference || `Linje ${index + 1}`).slice(0, 96),
      date,
      service: service.slice(0, 64),
      weight: line.weightKg,
      billedOre: lineTotalOre(line),
      origin: line.origin || "DK",
      destination: line.destination || "DK",
      kind: line.kind,
      quantity: line.quantity,
      unit: line.unit,
      zone: line.zone,
    }];
  });
}
