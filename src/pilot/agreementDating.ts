import type { Agreement } from "./agreements.ts";
import { normalizedText, runAudit, type AuditLine, type AuditReport, type AuditSummary, type InvoiceRow, type RateRow } from "./freight.ts";

/** The fields of an agreement that decide whether it was valid on a date. */
export type DatedAgreement = Pick<Agreement, "id" | "name" | "carrier" | "from" | "to" | "rows"> & Partial<Pick<Agreement, "ended" | "sample">>;

/**
 * Why a line has no agreement:
 * - `after-last`: later than the end of the newest agreement, so a new agreement is missing. The invoice is held.
 * - `before-first`: earlier than the first agreement starts.
 * - `gap`: between two agreements.
 * - `no-agreement`: the company has no agreement with prices for the carrier.
 * - `no-date`: neither the line nor the invoice has a date.
 */
export type NoMatchReason = "after-last" | "before-first" | "gap" | "no-agreement" | "no-date";

export type LineMatch =
  | { kind: "matched"; date: string; agreementId: string; overlap: string[]; manual: boolean }
  | { kind: "none"; date: string; reason: NoMatchReason };

export type InvoiceMatch = {
  lines: LineMatch[];
  /** Agreements used, in the order their first line appears, with how many lines each prices. */
  used: { agreementId: string; lines: number }[];
  /** Lines with no agreement, by reason. */
  missing: Partial<Record<NoMatchReason, number>>;
  /** True when a line is later than the newest agreement: compare nothing until a new agreement is added. */
  held: boolean;
  /** True when a line had several valid agreements and the latest start was picked. */
  overlap: boolean;
  /** The agreement a person chose for the whole invoice, when it still exists. */
  override: string | null;
  /** End of the newest agreement, for the upload prompt. */
  lastEnd: string;
};

export const NO_MATCH_LABELS: Record<NoMatchReason, string> = {
  "after-last": "Nyere end den seneste prisaftale",
  "before-first": "Før den første prisaftale",
  gap: "Mellem to prisaftaler",
  "no-agreement": "Ingen prisaftale for transportøren",
  "no-date": "Ingen dato",
};

/** Last valid day: the end date, or the day it was ended by hand when that is earlier. Empty when open-ended. */
export function lastValidDay(agreement: DatedAgreement): string {
  const ended = agreement.ended ? copenhagenDay(agreement.ended) : "";
  if (!ended) return agreement.to;
  return !agreement.to || ended < agreement.to ? ended : agreement.to;
}

function copenhagenDay(stamp: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(stamp)) return stamp;
  const date = new Date(stamp);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(date);
}

export function validOn(agreement: DatedAgreement, date: string): boolean {
  const last = lastValidDay(agreement);
  return (!agreement.from || agreement.from <= date) && (!last || date <= last);
}

export function sameCarrier(left: string, right: string): boolean {
  const a = normalizedText(left);
  const b = normalizedText(right);
  return Boolean(a && b) && (a === b || a.startsWith(b) || b.startsWith(a));
}

/** Agreements with parcel prices for the carrier, historic ones included. With no carrier on the invoice, all of them. */
export function candidates<T extends DatedAgreement>(agreements: T[], carrier: string): T[] {
  const priced = agreements.filter((item) => item.rows.length > 0);
  return carrier.trim() ? priced.filter((item) => sameCarrier(item.carrier, carrier)) : priced;
}

/** The agreement valid on a date. Several valid: the latest start wins and the others are listed as overlap. */
export function matchDate(pool: DatedAgreement[], date: string): LineMatch {
  if (!date) return { kind: "none", date, reason: "no-date" };
  if (!pool.length) return { kind: "none", date, reason: "no-agreement" };
  const valid = pool.filter((item) => validOn(item, date))
    .sort((left, right) => (right.from || "").localeCompare(left.from || "") || left.id.localeCompare(right.id));
  if (valid.length) {
    return { kind: "matched", date, agreementId: valid[0].id, overlap: valid.slice(1).map((item) => item.id), manual: false };
  }
  const ends = pool.map(lastValidDay);
  const latestEnd = ends.every(Boolean) ? [...ends].sort().at(-1) ?? "" : "";
  if (latestEnd && date > latestEnd) return { kind: "none", date, reason: "after-last" };
  const firstStart = pool.every((item) => item.from) ? pool.map((item) => item.from).sort()[0] : "";
  if (firstStart && date < firstStart) return { kind: "none", date, reason: "before-first" };
  return { kind: "none", date, reason: "gap" };
}

/**
 * Matches each line on its own date (the shipment date, else the invoice date), so an invoice that spans two
 * agreement periods is priced per line. A manual choice prices every dated line against that agreement.
 */
export function matchInvoice(
  lines: { date: string }[],
  options: { invoiceDate?: string; carrier: string; agreements: DatedAgreement[]; override?: string | null },
): InvoiceMatch {
  const pool = candidates(options.agreements, options.carrier);
  const chosen = options.override ? options.agreements.find((item) => item.id === options.override && item.rows.length) ?? null : null;
  const matches = lines.map((line): LineMatch => {
    const date = line.date || options.invoiceDate || "";
    if (chosen) return date ? { kind: "matched", date, agreementId: chosen.id, overlap: [], manual: true } : { kind: "none", date, reason: "no-date" };
    return matchDate(pool, date);
  });
  const used = new Map<string, number>();
  const missing: InvoiceMatch["missing"] = {};
  for (const match of matches) {
    if (match.kind === "matched") used.set(match.agreementId, (used.get(match.agreementId) ?? 0) + 1);
    else missing[match.reason] = (missing[match.reason] ?? 0) + 1;
  }
  const ends = pool.map(lastValidDay);
  return {
    lines: matches,
    used: [...used].map(([agreementId, count]) => ({ agreementId, lines: count })),
    missing,
    held: Boolean(missing["after-last"]),
    overlap: matches.some((match) => match.kind === "matched" && match.overlap.length > 0),
    override: chosen?.id ?? null,
    lastEnd: ends.length && ends.every(Boolean) ? [...ends].sort().at(-1) ?? "" : "",
  };
}

const MISSING_REASONS: Record<NoMatchReason, string> = {
  "after-last": "Afventer ny prisaftale: datoen ligger efter den seneste prisaftale for transportøren.",
  "before-first": "Ingen gyldig prisaftale: datoen ligger før den første prisaftale for transportøren.",
  gap: "Ingen gyldig prisaftale: datoen ligger mellem to prisaftaler for transportøren.",
  "no-agreement": "Ingen gyldig prisaftale for transportøren.",
  "no-date": "Ingen gyldig prisaftale: linjen og fakturaen har ingen dato.",
};

/** A manual choice prices outside the agreement's own period, so dates that only repeat that period are dropped. */
function chosenRows(agreement: DatedAgreement): RateRow[] {
  return agreement.rows.map((row) => ({
    ...row,
    from: row.from === agreement.from ? "" : row.from,
    to: row.to === agreement.to ? "" : row.to,
  }));
}

function emptySummary(): AuditSummary {
  return { billedOre: 0, checkedOre: 0, expectedOre: 0, overOre: 0, underOre: 0, match: 0, over: 0, under: 0, review: 0 };
}

/**
 * Runs the check per matched agreement and puts the lines back in invoice order. Lines with no agreement are
 * left for review and never compared. A held invoice is not checked at all.
 */
export function datedAudit(invoice: InvoiceRow[], match: InvoiceMatch, agreements: DatedAgreement[]): AuditReport {
  if (match.held) throw new Error("Fakturaen venter på en ny prisaftale. Tilføj prisaftalen først.");
  const byId = new Map(agreements.map((item) => [item.id, item]));
  const lines: AuditLine[] = new Array(invoice.length);
  const groups = new Map<string, number[]>();
  invoice.forEach((row, index) => {
    const found = match.lines[index];
    const agreement = found?.kind === "matched" ? byId.get(found.agreementId) : undefined;
    if (!agreement || found?.kind !== "matched") {
      const reason = found?.kind === "none" ? MISSING_REASONS[found.reason] : MISSING_REASONS["no-agreement"];
      lines[index] = { ...row, key: String(index + 1), status: "review", expectedOre: null, differenceOre: null, reason, rate: null };
      return;
    }
    groups.set(agreement.id, [...(groups.get(agreement.id) ?? []), index]);
  });
  const repeated = new Map<string, number>();
  for (const row of invoice) repeated.set(row.shipment, (repeated.get(row.shipment) ?? 0) + 1);
  for (const [id, indexes] of groups) {
    const agreement = byId.get(id) as DatedAgreement;
    const rows = match.override === id ? chosenRows(agreement) : agreement.rows;
    const report = runAudit(indexes.map((index) => invoice[index]), rows);
    report.lines.forEach((line, position) => {
      const index = indexes[position];
      const split = (repeated.get(line.shipment) ?? 0) > 1 && line.status !== "review";
      lines[index] = split
        ? { ...line, key: String(index + 1), status: "review", expectedOre: null, differenceOre: null, rate: null,
          reason: "Forsendelsesnummeret står på flere linjer. Saml fragt og tillæg i én linje pr. forsendelse." }
        : { ...line, key: String(index + 1) };
    });
  }
  const summary = emptySummary();
  for (const line of lines) {
    summary.billedOre += line.billedOre;
    summary[line.status] += 1;
    if (line.status === "review" || line.expectedOre === null || line.differenceOre === null) continue;
    summary.checkedOre += line.billedOre;
    summary.expectedOre += line.expectedOre;
    if (line.status === "over") summary.overOre += line.differenceOre;
    if (line.status === "under") summary.underOre += -line.differenceOre;
  }
  return { lines, summary };
}

const DAY = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Copenhagen" });

function day(value: string) {
  return DAY.format(new Date(`${value}T12:00:00Z`));
}

/** "1. jan. 2026 – 31. dec. 2026", with "løbende" for an open end. */
export function periodLabel(agreement: DatedAgreement): string {
  const last = lastValidDay(agreement);
  if (!agreement.from && !last) return "Ingen periode";
  return `${agreement.from ? day(agreement.from) : "Fra start"} – ${last ? day(last) : "løbende"}`;
}
