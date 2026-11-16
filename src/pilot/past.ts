import type { AuditReport, InvoiceRow, RateRow } from "./freight.ts";

export type PastSource = {
  id: string;
  name: string;
  date: string;
  carrier: string;
  note: string;
  csv?: string;
  fileId?: string;
};

function money(ore: number) {
  return (ore / 100).toFixed(2).replace(".", ",");
}

function weight(value: number) {
  return String(value).replace(".", ",");
}

export function invoiceCsv(rows: InvoiceRow[]) {
  const lines = rows.map((row) => [
    row.shipment, row.date, row.service, weight(row.weight), money(row.billedOre), row.origin, row.destination,
  ].join(";"));
  return `forsendelse;dato;service;vaegt_kg;beloeb_dkk;fra_land;til_land\n${lines.join("\n")}\n`;
}

export function rateCsv(rows: RateRow[]) {
  const lines = rows.map((row) => [
    row.service, weight(row.maxWeight), money(row.baseOre), weight(row.fuelPct), money(row.fixedOre), row.from, row.to,
  ].join(";"));
  return `service;maks_kg;grundpris_dkk;braendstof_pct;fast_tillaeg_dkk;gyldig_fra;gyldig_til\n${lines.join("\n")}\n`;
}

export function invoicesFromReport(report: AuditReport): InvoiceRow[] {
  return report.lines.map((line) => ({
    shipment: line.shipment,
    date: line.date,
    service: line.service,
    weight: line.weight,
    billedOre: line.billedOre,
    origin: line.origin,
    destination: line.destination,
  }));
}

export function ratesFromReport(report: AuditReport): RateRow[] {
  const seen = new Set<string>();
  const rows: RateRow[] = [];
  for (const line of report.lines) {
    if (!line.rate) continue;
    const rate: RateRow = {
      service: line.rate.service,
      maxWeight: line.rate.maxWeight,
      baseOre: line.rate.baseOre,
      fuelPct: line.rate.fuelPct,
      fixedOre: line.rate.fixedOre,
      from: line.rate.from,
      to: line.rate.to,
    };
    const key = `${rate.service}|${rate.maxWeight}|${rate.baseOre}|${rate.fuelPct}|${rate.fixedOre}|${rate.from}|${rate.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(rate);
  }
  return rows;
}
