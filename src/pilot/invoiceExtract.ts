import { z } from "zod";
import { invoiceRowSchema, type InvoiceRow } from "./freight.ts";

export const EXTRACT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const EXTRACT_VERSION = 1;
export const MAX_PROMPT_CHARS = 36_000;
export const MAX_EXTRACT_LINES = 400;
const SUM_TOLERANCE_ORE = 100;
// USD per million tokens for EXTRACT_MODEL on Workers AI.
const PRICE_IN = 0.293;
const PRICE_OUT = 2.253;

export type LineKind = "shipment" | "surcharge" | "fee" | "credit";
export type Confidence = "high" | "medium" | "low";

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: "Høj sikkerhed",
  medium: "Middel sikkerhed",
  low: "Lav sikkerhed",
};

export type ExtractLine = {
  kind: LineKind;
  shipment: string;
  date: string;
  reference: string;
  service: string;
  weightKg: number;
  zone: string;
  origin: string;
  destination: string;
  amountOre: number;
  surcharges: { label: string; amountOre: number }[];
  issues: string[];
};

export type SumCheck = {
  lineSumOre: number;
  targetOre: number | null;
  against: "subtotal" | "total-vat" | "total" | "none";
  differenceOre: number | null;
  status: "match" | "mismatch" | "no-total";
};

export type InvoiceExtract = {
  version: number;
  model: string;
  sha256: string;
  filename: string;
  createdAt: string;
  carrier: string;
  invoiceNumber: string;
  invoiceDate: string;
  currency: string;
  subtotalOre: number | null;
  vatOre: number | null;
  totalOre: number | null;
  lines: ExtractLine[];
  check: SumCheck;
  confidence: Confidence;
  issues: string[];
  truncated: boolean;
  usage: { inputTokens: number; outputTokens: number; usd: number } | null;
};

export type AiInputs = {
  messages: { role: "system" | "user"; content: string }[];
  response_format: { type: "json_schema"; json_schema: Record<string, unknown> };
  max_tokens: number;
  temperature: number;
};

const text = { type: "string" } as const;
const number = { type: "number" } as const;

export const EXTRACT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    carrier: { ...text, description: "Freight company that issued the invoice, empty if unknown" },
    invoiceNumber: text,
    invoiceDate: { ...text, description: "YYYY-MM-DD, empty if not printed" },
    currency: { ...text, description: "ISO code, usually DKK" },
    subtotal: { ...number, description: "Total excluding VAT as printed, 0 if not printed" },
    vat: { ...number, description: "VAT (moms) amount, 0 if not printed" },
    total: { ...number, description: "Grand total (i alt / at betale) as printed, 0 if not printed" },
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["shipment", "surcharge", "fee", "credit"] },
          shipment: { ...text, description: "Shipment or parcel number, empty if none" },
          date: { ...text, description: "Shipment date YYYY-MM-DD, empty if none" },
          reference: { ...text, description: "Customer reference or line number as printed" },
          service: { ...text, description: "Product or service name as printed" },
          weightKg: { ...number, description: "Billed weight in kg, 0 if none" },
          zone: { ...text, description: "Zone or route as printed, empty if none" },
          origin: { ...text, description: "ISO 3166 alpha-2 country of origin, DK for Danish towns, empty if unknown" },
          destination: { ...text, description: "ISO 3166 alpha-2 destination country, DK for Danish towns, empty if unknown" },
          amount: { ...number, description: "Line amount excluding VAT and excluding the surcharges listed for this line" },
          surcharges: {
            type: "array",
            items: {
              type: "object",
              properties: { label: text, amount: number },
              required: ["label", "amount"],
            },
          },
        },
        required: ["kind", "shipment", "date", "reference", "service", "weightKg", "zone", "origin", "destination", "amount", "surcharges"],
      },
    },
  },
  required: ["carrier", "invoiceNumber", "invoiceDate", "currency", "subtotal", "vat", "total", "lines"],
};

const SYSTEM_PROMPT = `You read Danish and Nordic freight invoices and return their lines as JSON matching the schema.
Rules:
- Copy values exactly as printed. Never invent shipments, amounts, weights or dates. Use "" or 0 when a value is not printed.
- Amounts are plain numbers with "." as decimal separator. Danish "1.234,56 kr" is 1234.56.
- One entry per invoice line. A shipment or parcel line is kind "shipment". A credit note line is kind "credit" with a negative amount.
- Surcharges printed on the same line as a shipment go in that line's surcharges array. A surcharge printed as its own line for the whole invoice (for example brændstoftillæg, fuel, vejafgift, miljøtillæg) is kind "surcharge" with its amount in amount. Administration or invoice fees are kind "fee".
- Do not add VAT (moms), subtotal or total lines as lines. Put them in subtotal, vat and total.
- amount excludes VAT.
- Dates are YYYY-MM-DD.`;

export function buildExtractRequest(pdfText: string): { inputs: AiInputs; truncated: boolean } {
  const cleaned = pdfText.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const truncated = cleaned.length > MAX_PROMPT_CHARS;
  const body = truncated ? cleaned.slice(0, MAX_PROMPT_CHARS) : cleaned;
  return {
    truncated,
    inputs: {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Invoice text extracted from the PDF:\n\n${body}` },
      ],
      response_format: { type: "json_schema", json_schema: EXTRACT_JSON_SCHEMA },
      max_tokens: 6000,
      temperature: 0,
    },
  };
}

export function parseModelOutput(raw: unknown): unknown {
  const value = raw && typeof raw === "object" && "response" in raw ? (raw as { response: unknown }).response : raw;
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") throw new Error("Modellen svarede ikke med JSON.");
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Modellen svarede ikke med JSON.");
  try {
    return JSON.parse(value.slice(start, end + 1));
  } catch {
    throw new Error("Modellens JSON kunne ikke læses.");
  }
}

export function modelUsage(raw: unknown): InvoiceExtract["usage"] {
  const usage = raw && typeof raw === "object" ? (raw as { usage?: unknown }).usage : null;
  if (!usage || typeof usage !== "object") return null;
  const input = Number((usage as { prompt_tokens?: unknown }).prompt_tokens) || 0;
  const output = Number((usage as { completion_tokens?: unknown }).completion_tokens) || 0;
  if (!input && !output) return null;
  return { inputTokens: input, outputTokens: output, usd: Math.round((input * PRICE_IN + output * PRICE_OUT) * 100) / 1e8 };
}

function amountValue(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  let clean = value.replace(/\s|kr\.?|dkk/gi, "");
  if (!clean) return 0;
  const comma = clean.lastIndexOf(",");
  const dot = clean.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) clean = comma > dot ? clean.replaceAll(".", "").replace(",", ".") : clean.replaceAll(",", "");
  else if (comma >= 0) clean = clean.replace(",", ".");
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : 0;
}

const amount = z.unknown().transform(amountValue);
const label = (max: number) => z.unknown().transform((value) =>
  (typeof value === "string" || typeof value === "number" ? String(value) : "").replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim().slice(0, max));

const outputSchema = z.object({
  carrier: label(70),
  invoiceNumber: label(60),
  invoiceDate: label(20),
  currency: label(8),
  subtotal: amount,
  vat: amount,
  total: amount,
  lines: z.array(z.object({
    kind: z.unknown().transform((value): LineKind =>
      value === "surcharge" || value === "fee" || value === "credit" ? value : "shipment"),
    shipment: label(96),
    date: label(20),
    reference: label(96),
    service: label(64),
    weightKg: amount,
    zone: label(40),
    origin: label(20),
    destination: label(20),
    amount,
    surcharges: z.array(z.object({ label: label(60), amount })).max(20).catch([]),
  }).passthrough()).max(MAX_EXTRACT_LINES * 2),
}).passthrough();

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, maj: 5, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dec: 12,
};

export function isoDate(value: string): string {
  const trimmed = value.trim();
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(trimmed);
  let parts: [number, number, number] | null = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  if (!parts) {
    match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(trimmed);
    if (match) parts = [Number(match[3]), Number(match[2]), Number(match[1])];
  }
  if (!parts) {
    match = /^(\d{1,2})\.?\s+([a-zæøå]{3})[a-zæøå]*\.?\s+(\d{4})$/i.exec(trimmed);
    const month = match ? MONTHS[match[2].toLowerCase()] : undefined;
    if (match && month) parts = [Number(match[3]), month, Number(match[1])];
  }
  if (!parts) return "";
  const [year, month, day] = parts;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : "";
}

function countryCode(value: string): string {
  const upper = value.trim().toUpperCase();
  if (["DANMARK", "DENMARK", "DNK"].includes(upper)) return "DK";
  return /^[A-Z]{2}$/.test(upper) ? upper : "";
}

const ore = (value: number) => Math.round(value * 100);

function printedForms(valueOre: number): string[] {
  const absolute = Math.abs(valueOre);
  const whole = Math.floor(absolute / 100);
  const cents = String(absolute % 100).padStart(2, "0");
  const grouped = whole.toLocaleString("en-US").replaceAll(",", ".");
  return [`${whole},${cents}`, `${whole}.${cents}`, `${grouped},${cents}`, `${whole.toLocaleString("en-US")}.${cents}`];
}

function printed(valueOre: number, haystack: string): boolean {
  return printedForms(valueOre).some((form) => haystack.includes(form));
}

export type ExtractMeta = { sha256: string; filename: string; truncated?: boolean; usage?: InvoiceExtract["usage"]; now?: Date };

export function validateExtract(raw: unknown, pdfText: string, meta: ExtractMeta): InvoiceExtract {
  const parsed = outputSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Modellens svar passer ikke til fakturaskemaet.");
  const data = parsed.data;
  const haystack = pdfText.replace(/\s+/g, " ");
  const compact = pdfText.replace(/\s+/g, "");
  const issues: string[] = [];

  const lines: ExtractLine[] = data.lines.slice(0, MAX_EXTRACT_LINES).map((line) => {
    const lineIssues: string[] = [];
    const amountOre = ore(line.amount);
    const kind: LineKind = line.kind === "shipment" && amountOre < 0 ? "credit" : line.kind;
    const surcharges = line.surcharges
      .map((item) => ({ label: item.label || "Tillæg", amountOre: ore(item.amount) }))
      .filter((item) => item.amountOre !== 0);
    if (amountOre === 0 && surcharges.length === 0) lineIssues.push("Linjen har intet beløb.");
    else if (amountOre !== 0 && !printed(amountOre, haystack) && !printed(amountOre, compact)) lineIssues.push("Beløbet står ikke ordret i PDF'en.");
    const weightKg = line.weightKg > 0 && line.weightKg <= 1000 ? Math.round(line.weightKg * 1000) / 1000 : 0;
    if (kind === "shipment") {
      if (!line.service) lineIssues.push("Leveringsform mangler.");
      if (!weightKg) lineIssues.push("Vægt mangler.");
    }
    const date = line.date ? isoDate(line.date) : "";
    if (line.date && !date) lineIssues.push("Datoen kunne ikke læses.");
    return {
      kind,
      shipment: line.shipment,
      date,
      reference: line.reference,
      service: line.service,
      weightKg,
      zone: line.zone,
      origin: countryCode(line.origin),
      destination: countryCode(line.destination),
      amountOre,
      surcharges,
      issues: lineIssues,
    };
  });
  if (data.lines.length > MAX_EXTRACT_LINES) issues.push(`Kun de første ${MAX_EXTRACT_LINES} linjer er med.`);
  if (meta.truncated) issues.push("Fakturaen er lang. Kun den første del af teksten blev læst.");

  const subtotalOre = data.subtotal > 0 ? ore(data.subtotal) : null;
  const vatOre = data.vat > 0 ? ore(data.vat) : null;
  const totalOre = data.total !== 0 ? ore(data.total) : null;
  const check = sumCheck(lines, subtotalOre, vatOre, totalOre);
  const shipments = lines.filter((line) => line.kind === "shipment" || line.kind === "credit");
  if (shipments.length === 0) issues.push("Der blev ikke fundet forsendelseslinjer.");
  if (check.status === "mismatch") issues.push("Linjerne summer ikke til fakturaens total.");
  if (check.status === "no-total") issues.push("Fakturaen har ingen total at afstemme mod.");
  const totalPrinted = [subtotalOre, totalOre].filter((value): value is number => value !== null)
    .every((value) => printed(value, haystack) || printed(value, compact));
  if (!totalPrinted) issues.push("Totalen står ikke ordret i PDF'en.");

  const lineIssues = lines.some((line) => line.issues.length > 0);
  const confidence: Confidence = check.status !== "match" || shipments.length === 0 || meta.truncated || !totalPrinted
    ? "low"
    : lineIssues || data.lines.length > MAX_EXTRACT_LINES ? "medium" : "high";

  return {
    version: EXTRACT_VERSION,
    model: EXTRACT_MODEL,
    sha256: meta.sha256,
    filename: meta.filename,
    createdAt: (meta.now ?? new Date()).toISOString(),
    carrier: data.carrier,
    invoiceNumber: data.invoiceNumber,
    invoiceDate: data.invoiceDate ? isoDate(data.invoiceDate) : "",
    currency: (data.currency || "DKK").toUpperCase(),
    subtotalOre,
    vatOre,
    totalOre,
    lines,
    check,
    confidence,
    issues,
    truncated: Boolean(meta.truncated),
    usage: meta.usage ?? null,
  };
}

export function lineTotalOre(line: ExtractLine): number {
  return line.amountOre + line.surcharges.reduce((sum, item) => sum + item.amountOre, 0);
}

function sumCheck(lines: ExtractLine[], subtotalOre: number | null, vatOre: number | null, totalOre: number | null): SumCheck {
  const lineSumOre = lines.reduce((sum, line) => sum + lineTotalOre(line), 0);
  const candidates: { against: SumCheck["against"]; target: number }[] = [];
  if (subtotalOre !== null) candidates.push({ against: "subtotal", target: subtotalOre });
  if (totalOre !== null && vatOre !== null) candidates.push({ against: "total-vat", target: totalOre - vatOre });
  if (totalOre !== null) candidates.push({ against: "total", target: totalOre });
  if (candidates.length === 0) return { lineSumOre, targetOre: null, against: "none", differenceOre: null, status: "no-total" };
  const best = candidates.find((item) => Math.abs(lineSumOre - item.target) <= SUM_TOLERANCE_ORE) ?? candidates[0];
  const differenceOre = lineSumOre - best.target;
  return {
    lineSumOre,
    targetOre: best.target,
    against: best.against,
    differenceOre,
    status: Math.abs(differenceOre) <= SUM_TOLERANCE_ORE ? "match" : "mismatch",
  };
}

/** Invoice-level surcharges and fees are spread over the shipments by amount so each row carries its full price. */
export function extractToInvoiceRows(extract: InvoiceExtract): InvoiceRow[] {
  const shipments = extract.lines.filter((line) => line.kind === "shipment" || line.kind === "credit");
  if (shipments.length === 0) throw new Error("PDF'en har ingen forsendelseslinjer, der kan kontrolleres.");
  const sharedOre = extract.lines
    .filter((line) => line.kind === "surcharge" || line.kind === "fee")
    .reduce((sum, line) => sum + lineTotalOre(line), 0);
  const own = shipments.map(lineTotalOre);
  const basis = own.reduce((sum, value) => sum + Math.max(0, value), 0);
  const shares = own.map((value) => (basis > 0 ? Math.round((sharedOre * Math.max(0, value)) / basis) : 0));
  const lastPositive = own.map((value) => value > 0).lastIndexOf(true);
  if (lastPositive >= 0) shares[lastPositive] += sharedOre - shares.reduce((sum, value) => sum + value, 0);
  const prefix = extract.invoiceNumber || "Linje";
  return shipments.map((line, index) => {
    const date = line.date || extract.invoiceDate;
    if (!date) throw new Error("PDF'en har ingen dato på linjerne eller fakturaen.");
    return invoiceRowSchema.parse({
      shipment: (line.shipment || line.reference || `${prefix}-${index + 1}`).slice(0, 96),
      date,
      service: line.service || "Ukendt",
      weight: line.weightKg,
      billedOre: own[index] + shares[index],
      origin: line.origin || "DK",
      destination: line.destination || "DK",
    });
  });
}

export function sharedSurchargeOre(extract: InvoiceExtract): number {
  return extract.lines
    .filter((line) => line.kind === "surcharge" || line.kind === "fee")
    .reduce((sum, line) => sum + lineTotalOre(line), 0);
}
