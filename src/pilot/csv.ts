import { z } from "zod";
import {
  invoiceRowSchema, MAX_LINES, MAX_RATES, normalizedText, rateRowSchema, STATUS_LABELS,
  type AuditReport, type InvoiceRow, type RateRow,
} from "./freight";

type Field = {
  id: string;
  label: string;
  required: boolean;
  aliases: string[];
};

export type ImportKind = "invoice" | "rates";
export type CsvSheet = { headers: string[]; rows: string[][] };
export type Mapping = Record<string, number>;

export const IMPORT_FIELDS: Record<ImportKind, Field[]> = {
  invoice: [
    { id: "shipment", label: "Forsendelsesnummer", required: true, aliases: ["forsendelse", "forsendelsesnummer", "pakkenummer", "tracking", "tracking_number", "shipment_id", "shipment", "reference"] },
    { id: "date", label: "Forsendelsesdato", required: true, aliases: ["dato", "forsendelsesdato", "afsendelsesdato", "shipment_date", "date"] },
    { id: "service", label: "Leveringsform", required: true, aliases: ["service", "leveringsform", "produkt", "ydelse", "service_type"] },
    { id: "weight", label: "Faktureret vægt i kg", required: true, aliases: ["vaegt_kg", "vægt", "faktureret_vægt", "weight", "weight_kg", "chargeable_weight"] },
    { id: "billedOre", label: "Samlet pris i kr. ekskl. moms", required: true, aliases: ["beloeb_dkk", "beløb", "pris", "total", "total_dkk", "billed_amount", "samlet_pris", "belob_ekskl_moms"] },
    { id: "origin", label: "Afsenderland", required: false, aliases: ["fra_land", "afsenderland", "oprindelsesland", "origin_country", "origin"] },
    { id: "destination", label: "Modtagerland", required: false, aliases: ["til_land", "modtagerland", "destinationsland", "destination_country", "destination"] },
  ],
  rates: [
    { id: "service", label: "Leveringsform", required: true, aliases: ["service", "leveringsform", "produkt", "ydelse", "service_type"] },
    { id: "maxWeight", label: "Vægttrin op til kg", required: true, aliases: ["maks_kg", "max_kg", "maks_vaegt", "vægttrin", "max_weight_kg", "max_weight"] },
    { id: "baseOre", label: "Grundpris i kr. ekskl. moms", required: true, aliases: ["grundpris_dkk", "grundpris", "pris", "price", "base_rate", "base_price_dkk"] },
    { id: "fuelPct", label: "Brændstoftillæg i procent", required: false, aliases: ["braendstof_pct", "brændstofprocent", "brændstoftillæg_pct", "fuel_pct", "fuel_surcharge_pct"] },
    { id: "fixedOre", label: "Fast tillæg i kr.", required: false, aliases: ["fast_tillaeg_dkk", "fast_tillæg", "tillæg", "fixed_surcharge", "fixed_fee"] },
    { id: "from", label: "Gyldig fra", required: false, aliases: ["gyldig_fra", "fra_dato", "valid_from", "start_date"] },
    { id: "to", label: "Gyldig til", required: false, aliases: ["gyldig_til", "til_dato", "valid_to", "end_date"] },
  ],
};

export function decodeCsv(bytes: ArrayBuffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function detectDelimiter(source: string) {
  const counts = { ";": 0, ",": 0, "\t": 0 };
  let quoted = false;
  for (const char of source) {
    if (char === '"') quoted = !quoted;
    if (quoted) continue;
    if (char === "\n" || char === "\r") break;
    if (char === ";" || char === "," || char === "\t") counts[char]++;
  }
  return (Object.keys(counts) as (keyof typeof counts)[]).reduce((best, key) =>
    counts[key] > counts[best] ? key : best, ";");
}

export function parseCsv(source: string): CsvSheet {
  const input = source.replace(/^\uFEFF/, "").replace(/^sep=[;,\t][\r\n]+/i, "").trimStart();
  const delimiter = detectDelimiter(input);
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  const endRecord = () => {
    row.push(field.trim());
    if (row.some(Boolean)) records.push(row);
    field = "";
    row = [];
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (quoted || !field.trim()) {
        quoted = !quoted;
      } else {
        field += char;
      }
    } else if (!quoted && char === delimiter) {
      row.push(field.trim());
      field = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && input[i + 1] === "\n") i++;
      endRecord();
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("Der er et felt med uafsluttede anførselstegn i filen.");
  if (field || row.length) endRecord();
  return fromRows(records);
}

export function fromRows(records: string[][]): CsvSheet {
  const [headers, ...rows] = records;
  if (!headers || headers.length < 2 || !rows.length) {
    throw new Error("Filen skal have en kolonneoverskrift og mindst én datalinje.");
  }
  if (headers.length > 100) throw new Error("Filen har for mange kolonner. Brug et udtræk med højst 100 kolonner.");
  if (rows.some((item) => item.length > headers.length)) {
    throw new Error("En datalinje har flere kolonner end overskriften. Kontrollér skilletegnet i filen.");
  }
  return { headers, rows };
}

export function suggestMapping(kind: ImportKind, headers: string[]): Mapping {
  const normalized = headers.map(normalizedText);
  return Object.fromEntries(IMPORT_FIELDS[kind].map((field) => {
    const matches = normalized
      .map((header, index) => field.aliases.some((alias) => normalizedText(alias) === header) ? index : -1)
      .filter((index) => index !== -1);
    return [field.id, matches.length === 1 ? matches[0] : -1];
  }));
}

export function missingFields(kind: ImportKind, mapping: Mapping) {
  return IMPORT_FIELDS[kind].filter((field) => field.required && (mapping[field.id] ?? -1) === -1);
}

function parseNumber(value: string, money = false) {
  let clean = value.trim().replace(/\s/g, "").replace(/(?:dkk|kr\.?)$/i, "");
  if (!clean) throw new Error("Der mangler et tal.");
  const comma = clean.lastIndexOf(",");
  const dot = clean.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    clean = comma > dot ? clean.replaceAll(".", "").replace(",", ".") : clean.replaceAll(",", "");
  } else if (comma >= 0) {
    clean = clean.replace(",", ".");
  } else if (money && /^[-+]?\d{1,3}(\.\d{3})+$/.test(clean)) {
    clean = clean.replaceAll(".", "");
  }
  if (!/^[-+]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(clean)) throw new Error("Tallet er ugyldigt.");
  return Number(clean);
}

function parseDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return value.slice(0, 10);
  const match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(value);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  throw new Error("Datoen skal være ÅÅÅÅ-MM-DD eller DD-MM-ÅÅÅÅ.");
}

function country(value: string) {
  if (!value || ["danmark", "denmark", "dnk"].includes(value.toLowerCase())) return "DK";
  return value.toUpperCase();
}

export function importRows(kind: "invoice", sheet: CsvSheet, mapping: Mapping): InvoiceRow[];
export function importRows(kind: "rates", sheet: CsvSheet, mapping: Mapping): RateRow[];
export function importRows(kind: ImportKind, sheet: CsvSheet, mapping: Mapping) {
  const missing = missingFields(kind, mapping);
  if (missing.length) throw new Error("Tilknyt kolonnerne " + missing.map((field) => field.label.toLowerCase()).join(", ") + ".");
  const selected = Object.values(mapping).filter((column) => column >= 0);
  if (new Set(selected).size !== selected.length) throw new Error("Vælg en særskilt kildekolonne til hvert felt.");
  const limit = kind === "invoice" ? MAX_LINES : MAX_RATES;
  if (sheet.rows.length > limit) throw new Error(`Filen må højst indeholde ${limit.toLocaleString("da-DK")} datalinjer.`);

  return sheet.rows.map((row, i) => {
    const get = (field: string) => row[mapping[field]]?.trim() ?? "";
    const numeric = (field: string, money = false, optional = false) => {
      if (optional && !get(field)) return 0;
      try {
        const value = parseNumber(get(field).replace(/%$/, ""), money);
        return money ? Math.round(value * 100) : value;
      } catch (error) {
        const label = IMPORT_FIELDS[kind].find((item) => item.id === field)?.label;
        throw new Error(`${label}. ${(error as Error).message}`);
      }
    };
    try {
      if (kind === "invoice") {
        return invoiceRowSchema.parse({
          shipment: get("shipment"), date: parseDate(get("date")), service: get("service"),
          weight: numeric("weight"), billedOre: numeric("billedOre", true),
          origin: country(get("origin")), destination: country(get("destination")),
        });
      }
      return rateRowSchema.parse({
        service: get("service"), maxWeight: numeric("maxWeight"), baseOre: numeric("baseOre", true),
        fuelPct: numeric("fuelPct", false, true), fixedOre: numeric("fixedOre", true, true),
        from: get("from") ? parseDate(get("from")) : "",
        to: get("to") ? parseDate(get("to")) : "",
      });
    } catch (error) {
      const first = error instanceof z.ZodError ? error.issues[0] : null;
      const field = first && IMPORT_FIELDS[kind].find((item) => item.id === first.path[0]);
      const message = field ? `Kontrollér feltet ${field.label.toLowerCase()}.`
        : first?.message ?? (error as Error).message;
      throw new Error(`Datalinje ${i + 1}. ${message}`);
    }
  });
}

function csvCell(value: string, numeric = false) {
  const safe = !numeric && /^[\s]*[=+@-]/.test(value) ? "'" + value : value;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function reportCsv(report: AuditReport) {
  const amount = (value: number | null) => value === null ? "" : (value / 100).toFixed(2).replace(".", ",");
  return [
    "Forsendelse;Dato;Leveringsform;Vægt i kg;Faktureret DKK;Aftalt DKK;Forskel DKK;Status;Forklaring",
    ...report.lines.map((line) => [
      csvCell(line.shipment), csvCell(line.date), csvCell(line.service),
      csvCell(String(line.weight).replace(".", ","), true), csvCell(amount(line.billedOre), true),
      csvCell(amount(line.expectedOre), true), csvCell(amount(line.differenceOre), true),
      csvCell(STATUS_LABELS[line.status]), csvCell(line.reason),
    ].join(";")),
  ].join("\r\n");
}
