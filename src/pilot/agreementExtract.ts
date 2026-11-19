import { z } from "zod";
import { MAX_RATES, rateRowSchema, type RateRow } from "./freight.ts";
import { EXTRACT_MODEL, isoDate, MAX_PROMPT_CHARS, printedAmounts, type AiInputs, type Confidence } from "./invoiceExtract.ts";

export const AGREEMENT_EXTRACT_VERSION = 1;
export const AGREEMENT_CACHE_PREFIX = "agreement:";
export const AGREEMENT_NO_TEXT = "PDF'en er kun et billede (fx en scannet side) og har intet tekstlag, så priserne kan ikke læses. Brug en PDF med tekst, eller udfyld skabelonen som CSV.";

export type AgreementRate = {
  service: string;
  zone: string;
  maxWeight: number;
  baseOre: number;
  fuelPct: number;
  fixedOre: number;
  issues: string[];
};

export type AgreementSurcharge = { label: string; pct: number; amountOre: number; printed: boolean };

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
  /** Agreement-wide surcharges as printed. Their percent and kroner are already on each rate unless the rate printed its own. */
  surcharges: AgreementSurcharge[];
  rates: AgreementRate[];
  confidence: Confidence;
  issues: string[];
  truncated: boolean;
  usage: { inputTokens: number; outputTokens: number; usd: number } | null;
};

const text = { type: "string" } as const;
const number = { type: "number" } as const;

export const AGREEMENT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    carrier: { ...text, description: "Freight company the agreement is with, empty if unknown" },
    title: { ...text, description: "Agreement title or number as printed, empty if none" },
    validFrom: { ...text, description: "First valid day YYYY-MM-DD, empty if not printed" },
    validTo: { ...text, description: "Last valid day YYYY-MM-DD, empty if not printed or open-ended" },
    currency: { ...text, description: "ISO code, usually DKK" },
    surcharges: {
      type: "array",
      description: "Surcharges that apply to every shipment, such as brændstoftillæg, vejafgift or miljøtillæg",
      items: {
        type: "object",
        properties: {
          label: text,
          percent: { ...number, description: "Percent of the base price, 0 if it is a kroner amount" },
          amount: { ...number, description: "Kroner per shipment excluding VAT, 0 if it is a percent" },
        },
        required: ["label", "percent", "amount"],
      },
    },
    rates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          service: { ...text, description: "Product or delivery form as printed, e.g. Pakkeshop, Hjemmelevering, Erhverv" },
          zone: { ...text, description: "Zone or area as printed, empty if the table has no zones" },
          maxWeightKg: { ...number, description: "Upper bound of the weight step in kg. For 1-5 kg this is 5" },
          price: { ...number, description: "Base price in kroner excluding VAT for this step" },
          fuelPercent: { ...number, description: "Fuel surcharge percent printed on this row only, 0 otherwise" },
          fixedSurcharge: { ...number, description: "Fixed kroner surcharge printed on this row only, 0 otherwise" },
        },
        required: ["service", "zone", "maxWeightKg", "price", "fuelPercent", "fixedSurcharge"],
      },
    },
  },
  required: ["carrier", "title", "validFrom", "validTo", "currency", "surcharges", "rates"],
};

const SYSTEM_PROMPT = `You read Danish and Nordic freight price agreements (prisaftaler, prisbilag, rate cards) and return the rate table as JSON matching the schema.
Rules:
- Copy values exactly as printed. Never invent services, weights, prices or dates. Use "" or 0 when a value is not printed.
- Amounts are plain numbers with "." as decimal separator. Danish "1.234,56 kr" is 1234.56 and "12,5 %" is 12.5.
- One rate entry per service, zone and weight step. A table with weights down the side and zones across the top gives one entry per cell.
- maxWeightKg is the upper bound of the step: "0-1 kg" is 1, "1,01-5 kg" is 5, "op til 10 kg" is 10.
- price is the base price excluding VAT and excluding surcharges.
- A surcharge that applies to all shipments (brændstoftillæg, vejafgift, miljøtillæg, energitillæg) goes in surcharges, not on each rate.
- Do not include VAT (moms) as a surcharge. Ignore example calculations, totals and terms text.
- Dates are YYYY-MM-DD.`;

export function buildAgreementRequest(pdfText: string): { inputs: AiInputs; truncated: boolean } {
  const cleaned = pdfText.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const truncated = cleaned.length > MAX_PROMPT_CHARS;
  const body = truncated ? cleaned.slice(0, MAX_PROMPT_CHARS) : cleaned;
  return {
    truncated,
    inputs: {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Price agreement text extracted from the PDF:\n\n${body}` },
      ],
      response_format: { type: "json_schema", json_schema: AGREEMENT_JSON_SCHEMA },
      max_tokens: 6000,
      temperature: 0,
    },
  };
}

function numberValue(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  let clean = value.replace(/\s|kr\.?|dkk|%|kg/gi, "");
  if (!clean) return 0;
  const comma = clean.lastIndexOf(",");
  const dot = clean.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) clean = comma > dot ? clean.replaceAll(".", "").replace(",", ".") : clean.replaceAll(",", "");
  else if (comma >= 0) clean = clean.replace(",", ".");
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : 0;
}

const num = z.unknown().transform(numberValue);
const label = (max: number) => z.unknown().transform((value) =>
  (typeof value === "string" || typeof value === "number" ? String(value) : "").replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim().slice(0, max));

const outputSchema = z.object({
  carrier: label(70),
  title: label(100),
  validFrom: label(20),
  validTo: label(20),
  currency: label(8),
  surcharges: z.array(z.object({ label: label(60), percent: num, amount: num }).passthrough()).max(40).catch([]),
  rates: z.array(z.object({
    service: label(64),
    zone: label(40),
    maxWeightKg: num,
    price: num,
    fuelPercent: num,
    fixedSurcharge: num,
  }).passthrough()).max(MAX_RATES * 2),
}).passthrough();

const ore = (value: number) => Math.round(value * 100);

export type AgreementMeta = { sha256: string; filename: string; truncated?: boolean; usage?: AgreementExtract["usage"]; now?: Date };

/** Every price, weight and percent the model returns is looked up in the PDF's own text; what is not printed is flagged for review. */
export function validateAgreementExtract(raw: unknown, pdfText: string, meta: AgreementMeta): AgreementExtract {
  const parsed = outputSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Modellens svar passer ikke til prisaftaleskemaet.");
  const data = parsed.data;
  const amounts = printedAmounts(pdfText);
  const printed = (value: number) => value === 0 || amounts.has(Math.abs(ore(value)));
  const issues: string[] = [];

  const surcharges: AgreementSurcharge[] = data.surcharges
    .filter((item) => item.percent > 0 || item.amount > 0)
    .filter((item) => !/\bmoms\b|\bvat\b/i.test(item.label))
    .map((item) => {
      const pct = item.percent > 0 && item.percent <= 300 ? Math.round(item.percent * 100) / 100 : 0;
      const amountOre = pct ? 0 : Math.max(0, ore(item.amount));
      return {
        label: item.label || (pct ? "Procenttillæg" : "Fast tillæg"),
        pct,
        amountOre,
        printed: printed(pct || item.amount),
      };
    })
    .filter((item) => item.pct > 0 || item.amountOre > 0);
  const sharedPct = Math.round(surcharges.reduce((sum, item) => sum + item.pct, 0) * 100) / 100;
  const sharedFixedOre = surcharges.reduce((sum, item) => sum + item.amountOre, 0);
  for (const item of surcharges) if (!item.printed) issues.push(`${item.label} står ikke ordret i PDF'en.`);

  const rates: AgreementRate[] = data.rates.slice(0, MAX_RATES).map((rate) => {
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
    if (ownFixedOre && !printed(rate.fixedSurcharge)) rowIssues.push("Tillægget står ikke ordret i PDF'en.");
    return {
      service: rate.service,
      zone: rate.zone,
      maxWeight,
      baseOre,
      fuelPct: Math.round((ownFuel || sharedPct) * 100) / 100,
      fixedOre: ownFixedOre || sharedFixedOre,
      issues: rowIssues,
    };
  });

  if (data.rates.length > MAX_RATES) issues.push(`Kun de første ${MAX_RATES} priser er med.`);
  if (meta.truncated) issues.push("Aftalen er lang. Kun den første del af teksten blev læst.");
  if (rates.length === 0) issues.push("Der blev ikke fundet priser i PDF'en.");
  const currency = (data.currency || "DKK").toUpperCase();
  if (currency !== "DKK") issues.push(`Priserne står i ${currency}, ikke DKK.`);
  const validFrom = data.validFrom ? isoDate(data.validFrom) : "";
  const validTo = data.validTo ? isoDate(data.validTo) : "";
  if ((data.validFrom && !validFrom) || (data.validTo && !validTo)) issues.push("Gyldighedsdatoen kunne ikke læses.");

  const unprinted = rates.filter((rate) => rate.issues.some((issue) => issue.includes("ordret"))).length;
  const confidence: Confidence = rates.length === 0 || meta.truncated || unprinted * 2 > rates.length || currency !== "DKK"
    ? "low"
    : rates.some((rate) => rate.issues.length > 0) || issues.length > 0 ? "medium" : "high";

  return {
    kind: "agreement",
    version: AGREEMENT_EXTRACT_VERSION,
    model: EXTRACT_MODEL,
    sha256: meta.sha256,
    filename: meta.filename,
    createdAt: (meta.now ?? new Date()).toISOString(),
    carrier: data.carrier,
    title: data.title,
    validFrom,
    validTo: validTo && validFrom && validTo < validFrom ? "" : validTo,
    currency,
    surcharges,
    rates,
    confidence,
    issues,
    truncated: Boolean(meta.truncated),
    usage: meta.usage ?? null,
  };
}

/** The service name a rate is checked under. A zone, when the agreement has one, becomes part of it. */
export function rateService(service: string, zone: string): string {
  const name = service.trim();
  const area = zone.trim();
  if (!area || name.toLowerCase().includes(area.toLowerCase())) return name.slice(0, 64);
  return `${name} ${area}`.slice(0, 64);
}

/** Reviewed rates into the rows Prisaftaler stores. Throws a Danish message naming the first bad row. */
export function agreementRatesToRows(rates: Omit<AgreementRate, "issues">[], from: string, to: string): RateRow[] {
  if (rates.length === 0) throw new Error("Tilføj mindst én pris.");
  if (rates.length > MAX_RATES) throw new Error(`En prisaftale må højst have ${MAX_RATES} priser.`);
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
      throw new Error(`Række ${index + 1}. Kontrollér ${names[String(field)] ?? "rækken"}.`);
    }
    return parsed.data;
  });
}
