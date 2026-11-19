import { importRows, missingFields, parseCsv, suggestMapping } from "./csv.ts";
import { agreementTermsSchema, hasTerms, type AgreementTerms } from "./agreementFormat.ts";
import type { AgreementSource } from "./agreementRecord.ts";
import type { RateRow } from "./freight.ts";

const KEY = "freightlytics-agreements";

export type Agreement = {
  id: string;
  orgId: string;
  name: string;
  carrier: string;
  from: string;
  to: string;
  /** Parcel rate rows the invoice check prices against. Empty for an agreement with only other terms. */
  rows: RateRow[];
  /** Price items, grids, surcharges and conditions (agreement format 2). */
  terms?: AgreementTerms;
  createdAt: string;
  sample: boolean;
  ended?: string;
  /** Set on agreements read from the database: whether the rows differ from what was first read. */
  changed?: boolean;
  source?: AgreementSource;
  createdByName?: string;
};

export type AgreementState = "active" | "historic";

export function loadAgreements(): Agreement[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Agreement[]).filter((item) => item && typeof item.id === "string" && Array.isArray(item.rows)) : [];
  } catch {
    return [];
  }
}

/** Keeps only the browser agreements that have not reached the database yet; with none left the key is removed. */
export function saveAgreements(items: Agreement[]) {
  if (items.length === 0) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify(items.slice(0, 200)));
}

export function rowSpan(rows: RateRow[]): { from: string; to: string } {
  const froms = rows.map((row) => row.from).filter(Boolean).sort();
  const tos = rows.map((row) => row.to);
  return { from: froms[0] ?? "", to: tos.length && tos.every(Boolean) ? [...tos].sort().at(-1) ?? "" : "" };
}

export function sampleAgreement(orgId: string, carrier: string, rows: RateRow[]): Agreement | null {
  if (!rows.length) return null;
  const span = rowSpan(rows);
  return {
    id: `sample:${orgId}`,
    orgId,
    name: "Prøveaftale",
    carrier,
    ...span,
    rows,
    createdAt: span.from ? `${span.from}T00:00:00.000Z` : "",
    sample: true,
  };
}

function sameCarrier(left: Agreement, right: Agreement) {
  return left.carrier.trim().toLowerCase() === right.carrier.trim().toLowerCase();
}

/**
 * Historic when it was ended by hand, when its last valid day has passed, or when a newer agreement
 * with the same carrier has already started. Everything else, including one that starts later, is active.
 */
export function agreementState(agreement: Agreement, all: Agreement[], today: string): AgreementState {
  if (agreement.ended) return "historic";
  if (agreement.to && agreement.to < today) return "historic";
  const replaced = all.some((other) => other.id !== agreement.id
    && !other.ended
    && sameCarrier(other, agreement)
    && Boolean(other.carrier.trim())
    && (other.from || other.createdAt.slice(0, 10)) <= today
    && (other.from || other.createdAt.slice(0, 10)) > (agreement.from || agreement.createdAt.slice(0, 10))
    && !(other.to && other.to < today));
  return replaced ? "historic" : "active";
}

export function splitAgreements(all: Agreement[], today: string): { active: Agreement[]; historic: Agreement[] } {
  const newest = [...all].sort((left, right) => (right.from || right.createdAt).localeCompare(left.from || left.createdAt));
  return {
    active: newest.filter((item) => agreementState(item, all, today) === "active"),
    historic: newest.filter((item) => agreementState(item, all, today) === "historic"),
  };
}

export function agreementFromCsv(
  source: string,
  fields: { orgId: string; name: string; carrier: string; from: string; to: string },
  now = new Date(),
): Agreement {
  const sheet = parseCsv(source);
  const mapping = suggestMapping("rates", sheet.headers);
  const missing = missingFields("rates", mapping);
  if (missing.length) {
    throw new Error(`Filen mangler kolonnerne ${missing.map((field) => field.label.toLowerCase()).join(", ")}. Skabelonen kan hentes under Nyt fakturatjek.`);
  }
  return agreementFromRows(importRows("rates", sheet, mapping), fields, now);
}

export function agreementFromRows(
  rows: RateRow[],
  fields: { orgId: string; name: string; carrier: string; from: string; to: string },
  now = new Date(),
  terms?: AgreementTerms,
): Agreement {
  const checked = terms ? agreementTermsSchema.safeParse(terms) : null;
  if (checked && !checked.success) throw new Error(checked.error.issues[0]?.message ?? "Aftalens priser kunne ikke gemmes.");
  const kept = checked?.success && hasTerms(checked.data) ? checked.data : undefined;
  if (!rows.length && !kept) throw new Error("Tilføj mindst én pris.");
  const span = rowSpan(rows);
  const from = fields.from || span.from;
  const to = fields.to || span.to;
  if (from && to && to < from) throw new Error("Slutdatoen skal ligge på eller efter startdatoen.");
  return {
    id: crypto.randomUUID(),
    orgId: fields.orgId,
    name: fields.name.trim().slice(0, 100) || fields.carrier.trim().slice(0, 70) || "Prisaftale",
    carrier: fields.carrier.trim().slice(0, 70),
    from,
    to,
    rows: rows.map((row) => ({ ...row, from: row.from || from, to: row.to || to })),
    ...(kept ? { terms: kept } : {}),
    createdAt: now.toISOString(),
    sample: false,
  };
}

export function todayIso(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(now);
}
