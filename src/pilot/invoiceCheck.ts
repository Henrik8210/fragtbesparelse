import { z } from "zod";
import { SHIPMENT_MAX_KG, type InvoiceRow } from "./freight.ts";
import { extractToInvoiceRows, lineTotalOre, sumCheck, type ExtractLine, type InvoiceExtract, type LineKind } from "./invoiceExtract.ts";

export const MAX_CHECK_LINES = 1200;

/** One invoice line as the person checking it sees it. amountOre is the line's full amount excluding VAT, own surcharges included. */
export type CheckLine = {
  kind: LineKind;
  shipment: string;
  reference: string;
  date: string;
  service: string;
  zone: string;
  weightKg: number;
  amountOre: number;
  origin: string;
  destination: string;
  /** Kept so a priced fee stays a line after the check is saved, and is not spread over the shipments. */
  quantity?: number;
  unit?: string;
  unitPriceOre?: number;
};

export type CheckField = "kind" | "shipment" | "reference" | "date" | "service" | "zone" | "weightKg" | "amountOre";
export const CHECK_FIELDS: CheckField[] = ["kind", "shipment", "reference", "date", "service", "zone", "weightKg", "amountOre"];

export type CheckChange = { line: number; field: CheckField; from: string | number; to: string | number };

export type CheckEvent = { at: string; by: string; name: string; changes: CheckChange[] };

export type InvoiceCheck = {
  fileId: string;
  companyId: string;
  original: CheckLine[];
  lines: CheckLine[];
  changed: boolean;
  checkedBy: string;
  checkedByName: string;
  checkedAt: string;
  firstCheckedAt: string;
  history: CheckEvent[];
};

export type CheckSummary = Pick<InvoiceCheck, "fileId" | "changed" | "checkedByName" | "checkedAt">;

const isoDay = /^\d{4}-\d{2}-\d{2}$/;

function realDate(value: string) {
  if (!isoDay.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const short = (max: number) => z.string().max(max).transform((value) => value.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim());

export const checkLineSchema = z.object({
  kind: z.enum(["shipment", "surcharge", "fee", "credit"]),
  shipment: short(96),
  reference: short(96),
  date: z.string().refine((value) => value === "" || realDate(value), "Datoen skal være ÅÅÅÅ-MM-DD."),
  service: short(64),
  zone: short(40).default(""),
  weightKg: z.number().finite().min(0).max(SHIPMENT_MAX_KG),
  amountOre: z.number().int().min(-100_000_000).max(100_000_000),
  origin: z.string().regex(/^([A-Z]{2})?$/).default(""),
  destination: z.string().regex(/^([A-Z]{2})?$/).default(""),
  quantity: z.number().finite().min(0).max(1_000_000).optional(),
  unit: short(32).optional(),
  unitPriceOre: z.number().int().min(-100_000_000).max(100_000_000).optional(),
});

export const checkLinesSchema = z.array(checkLineSchema).min(1).max(MAX_CHECK_LINES);

export function linesFromExtract(extract: Pick<InvoiceExtract, "lines">): CheckLine[] {
  return extract.lines.map((line) => ({
    kind: line.kind,
    shipment: line.shipment,
    reference: line.reference,
    date: line.date,
    service: line.service,
    zone: line.zone,
    weightKg: line.weightKg,
    amountOre: lineTotalOre(line),
    origin: line.origin,
    destination: line.destination,
    quantity: line.quantity,
    unit: line.unit,
    unitPriceOre: line.unitPriceOre,
  }));
}

export function linesFromRows(rows: InvoiceRow[]): CheckLine[] {
  return rows.map((row) => ({
    kind: row.billedOre < 0 ? "credit" : "shipment",
    shipment: row.shipment,
    reference: "",
    date: row.date,
    service: row.service,
    zone: "",
    weightKg: row.weight,
    amountOre: row.billedOre,
    origin: row.origin,
    destination: row.destination,
  }));
}

function sameValue(field: CheckField, left: CheckLine, right: CheckLine) {
  return field === "weightKg" || field === "amountOre" ? Number(left[field]) === Number(right[field]) : String(left[field]).trim() === String(right[field]).trim();
}

/** Field-level differences between two versions of the same invoice. A line added or removed counts as every field changing. */
export function lineChanges(before: CheckLine[], after: CheckLine[]): CheckChange[] {
  const changes: CheckChange[] = [];
  const count = Math.max(before.length, after.length);
  for (let index = 0; index < count; index += 1) {
    const left = before[index];
    const right = after[index];
    for (const field of CHECK_FIELDS) {
      if (left && right && sameValue(field, left, right)) continue;
      changes.push({ line: index, field, from: left ? left[field] : "", to: right ? right[field] : "" });
    }
  }
  return changes;
}

export function isFieldEdited(original: CheckLine[], lines: CheckLine[], index: number, field: CheckField): boolean {
  const left = original[index];
  const right = lines[index];
  return !left || !right || !sameValue(field, left, right);
}

function asExtractLine(line: CheckLine): ExtractLine {
  return {
    kind: line.kind,
    shipment: line.shipment,
    date: line.date,
    reference: line.reference,
    service: line.service,
    weightKg: line.weightKg,
    zone: line.zone ?? "",
    origin: line.origin,
    destination: line.destination,
    amountOre: line.amountOre,
    surcharges: [],
    issues: [],
    quantity: line.quantity,
    unit: line.unit,
    unitPriceOre: line.unitPriceOre,
  };
}

/** The extract with the checked lines in place of what the model read. The sum check is redone against the printed totals. */
export function checkedExtract(extract: InvoiceExtract, lines: CheckLine[]): InvoiceExtract {
  const replaced = lines.map(asExtractLine);
  return {
    ...extract,
    lines: replaced,
    check: sumCheck(replaced, extract.subtotalOre, extract.vatOre, extract.totalOre),
    issues: extract.issues.filter((issue) => !/summer ikke|står ikke ordret/.test(issue)),
  };
}

/** Rows for the invoice check. Invoice-level surcharges and fees are spread over the shipments, as for an unchecked PDF. */
export function rowsFromLines(lines: CheckLine[], meta: { invoiceNumber?: string; invoiceDate?: string } = {}): InvoiceRow[] {
  return extractToInvoiceRows({ lines: lines.map(asExtractLine), invoiceNumber: meta.invoiceNumber ?? "", invoiceDate: meta.invoiceDate ?? "" });
}

export function lineSumOre(lines: CheckLine[]): number {
  return lines.reduce((sum, line) => sum + line.amountOre, 0);
}

/** Danish "1.234,56", "1234.56" or "85" kroner as øre. Null when it is not a number. */
export function parseKroner(value: string): number | null {
  let clean = value.trim().replace(/\s|kr\.?$/gi, "");
  if (!clean) return null;
  const comma = clean.lastIndexOf(",");
  const dot = clean.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) clean = comma > dot ? clean.replaceAll(".", "").replace(",", ".") : clean.replaceAll(",", "");
  else if (comma >= 0) clean = clean.replace(",", ".");
  else if (/^[-+]?\d{1,3}(\.\d{3})+$/.test(clean)) clean = clean.replaceAll(".", "");
  if (!/^[-+]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(clean)) return null;
  const ore = Math.round(Number(clean) * 100);
  return Number.isFinite(ore) ? ore : null;
}

export function kronerText(ore: number): string {
  return (ore / 100).toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function parseWeight(value: string, maxKg = 1000): number | null {
  const clean = value.trim().replace(/\s|kg$/gi, "").replace(",", ".");
  if (!clean) return 0;
  if (!/^\d+(?:\.\d+)?$/.test(clean)) return null;
  const weight = Number(clean);
  return weight <= maxKg ? Math.round(weight * 1000) / 1000 : null;
}

export type CheckIssue = { key: string; where: string; message: string; blocking: true };

/** Everything that blocks saving a check, one entry per field, in line order. */
export function checkIssues(rows: { kind: LineKind; date: string; service: string; weight: string; amount: string }[], invoiceDate = ""): CheckIssue[] {
  const found: CheckIssue[] = [];
  const carries = rows.some((row) => row.kind === "shipment" || row.kind === "credit");
  if (rows.length > 0 && !carries) found.push({ key: "shipments", where: "Fakturaen", message: "Fakturaen skal have mindst én forsendelse.", blocking: true });
  rows.forEach((row, index) => {
    const where = `Linje ${index + 1}`;
    const key = (field: string) => `line:${index}:${field}`;
    if (row.date && !realDate(row.date)) found.push({ key: key("date"), where, message: "Datoen er ugyldig.", blocking: true });
    else if ((row.kind === "shipment" || row.kind === "credit") && !row.date && !invoiceDate) found.push({ key: key("date"), where, message: "Dato mangler. Udfyld datoen, eller lad fakturadatoen gælde.", blocking: true });
    if (row.kind === "shipment" && !row.service.trim()) found.push({ key: key("service"), where, message: "Leveringsform mangler. Skriv ruten eller ydelsen, som den står på fakturaen.", blocking: true });
    if (parseWeight(row.weight, SHIPMENT_MAX_KG) === null) found.push({ key: key("weight"), where, message: "Vægten er ikke et tal, eller den er over 40.000 kg.", blocking: true });
    if (parseKroner(row.amount) === null) found.push({ key: key("amount"), where, message: "Beløbet er ikke et tal.", blocking: true });
  });
  return found;
}

/** Problems that keep a checked invoice from being used in the invoice check. */
export function lineProblems(lines: CheckLine[], invoiceDate = ""): string[] {
  const problems: string[] = [];
  const shipments = lines.filter((line) => line.kind === "shipment" || line.kind === "credit");
  if (shipments.length === 0) problems.push("Fakturaen skal have mindst én forsendelse.");
  lines.forEach((line, index) => {
    const label = `Linje ${index + 1}`;
    if (line.date && !realDate(line.date)) problems.push(`${label}: datoen er ugyldig.`);
    if ((line.kind === "shipment" || line.kind === "credit") && !line.date && !invoiceDate) problems.push(`${label}: dato mangler.`);
    if (line.kind === "shipment" && !line.service.trim()) problems.push(`${label}: leveringsform mangler.`);
  });
  return problems;
}

/** The record to store: the first original is kept for audit, and every save adds who, when and what changed. */
export function nextCheck(
  previous: InvoiceCheck | null,
  input: { fileId: string; companyId: string; original: CheckLine[]; lines: CheckLine[]; by: string; name: string; now: Date },
): InvoiceCheck {
  const original = previous?.original ?? input.original;
  const at = input.now.toISOString();
  const changes = lineChanges(previous?.lines ?? original, input.lines);
  return {
    fileId: input.fileId,
    companyId: input.companyId,
    original,
    lines: input.lines,
    changed: lineChanges(original, input.lines).length > 0,
    checkedBy: input.by,
    checkedByName: input.name,
    checkedAt: at,
    firstCheckedAt: previous?.firstCheckedAt ?? at,
    history: [...(previous?.history ?? []), { at, by: input.by, name: input.name, changes }].slice(-50),
  };
}
