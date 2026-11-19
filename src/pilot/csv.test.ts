import { describe, expect, it } from "vitest";
import { decodeCsv, importRows, missingFields, parseCsv, reportCsv, suggestMapping } from "./csv";
import { runAudit } from "./freight";

describe("parseCsv", () => {
  it("detects semicolon, comma and tab delimiters", () => {
    expect(parseCsv("a;b\n1;2").rows).toEqual([["1", "2"]]);
    expect(parseCsv("a,b\n1,2").rows).toEqual([["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2").rows).toEqual([["1", "2"]]);
  });

  it("strips a BOM and an Excel sep= line", () => {
    const sheet = parseCsv("\uFEFFsep=;\r\nForsendelse;Dato\r\nS1;2026-10-01\r\n");
    expect(sheet.headers).toEqual(["Forsendelse", "Dato"]);
    expect(sheet.rows).toEqual([["S1", "2026-10-01"]]);
  });

  it("handles quoted delimiters, escaped quotes and newlines inside quotes", () => {
    const sheet = parseCsv('navn;note\n"Hansen; A/S";"sagde ""hej""\nfarvel"');
    expect(sheet.rows).toEqual([["Hansen; A/S", 'sagde "hej"\nfarvel']]);
  });

  it("does not let a delimiter inside a quoted header skew detection", () => {
    expect(parseCsv('"a,b";c\n1;2').headers).toEqual(["a,b", "c"]);
  });

  it("skips blank lines", () => {
    expect(parseCsv("a;b\n\n1;2\n;\n").rows).toEqual([["1", "2"]]);
  });

  it("rejects unterminated quotes, missing data and ragged rows", () => {
    expect(() => parseCsv('a;b\n"1;2')).toThrow(/anførselstegn/);
    expect(() => parseCsv("a;b\n")).toThrow(/mindst én datalinje/);
    expect(() => parseCsv("a\n1")).toThrow(/mindst én datalinje/);
    expect(() => parseCsv("a;b\n1;2;3")).toThrow(/flere kolonner/);
  });
});

describe("decodeCsv", () => {
  it("reads UTF-8 and falls back to Windows-1252", () => {
    expect(decodeCsv(new TextEncoder().encode("vægt").buffer)).toBe("vægt");
    expect(decodeCsv(new Uint8Array([0x76, 0xe6, 0x67, 0x74]).buffer)).toBe("vægt");
  });
});

describe("column mapping", () => {
  it("suggests invoice columns from Danish and English headers", () => {
    const mapping = suggestMapping("invoice", ["Pakkenummer", "Dato", "Produkt", "Vægt", "Beløb ekskl. moms", "Til land"]);
    expect(mapping).toMatchObject({ shipment: 0, date: 1, service: 2, weight: 3, destination: 5, origin: -1 });
    expect(suggestMapping("invoice", ["tracking_number", "shipment_date", "service_type", "weight_kg", "billed_amount"]))
      .toMatchObject({ shipment: 0, date: 1, service: 2, weight: 3, billedOre: 4 });
  });

  it("suggests rate columns", () => {
    expect(suggestMapping("rates", ["Service", "Maks kg", "Grundpris", "Brændstof pct", "Fast tillæg", "Gyldig fra", "Gyldig til"]))
      .toEqual({ service: 0, maxWeight: 1, baseOre: 2, fuelPct: 3, fixedOre: 4, from: 5, to: 6 });
  });

  it("leaves a field unmapped when two headers both match", () => {
    expect(suggestMapping("invoice", ["pris", "total"]).billedOre).toBe(-1);
  });

  it("lists the required fields that are still missing", () => {
    const missing = missingFields("invoice", { shipment: 0, date: -1, service: 2, weight: 3 });
    expect(missing.map((field) => field.id)).toEqual(["date", "billedOre"]);
  });
});

describe("importRows", () => {
  const invoiceHeaders = "Forsendelse;Dato;Service;Vægt;Beløb;Til land";

  it("parses Danish and English numbers, dates and country names", () => {
    const sheet = parseCsv([
      invoiceHeaders,
      "S1;05-10-2026;Pakkeshop;1,5;1.234,56 kr.;Danmark",
      "S2;2026-10-06T08:00:00;Pakkeshop;2;1,234.50;",
      "S3;6.10.2026;Pakkeshop;0.75;57;SE",
      "S4;07/10/2026;Pakkeshop;3;1.250;DK",
    ].join("\n"));
    const rows = importRows("invoice", sheet, suggestMapping("invoice", sheet.headers));
    expect(rows.map((row) => [row.date, row.weight, row.billedOre, row.destination])).toEqual([
      ["2026-10-05", 1.5, 123456, "DK"],
      ["2026-10-06", 2, 123450, "DK"],
      ["2026-10-06", 0.75, 5700, "SE"],
      ["2026-10-07", 3, 125000, "DK"],
    ]);
  });

  it("parses rate files with percent signs and optional columns", () => {
    const sheet = parseCsv("Service;Maks kg;Grundpris;Brændstof pct;Gyldig fra\nPakkeshop;5;50,00;12,5%;01-10-2026\nHjem;10;80;;");
    const rows = importRows("rates", sheet, suggestMapping("rates", sheet.headers));
    expect(rows).toEqual([
      { service: "Pakkeshop", maxWeight: 5, baseOre: 5000, fuelPct: 12.5, fixedOre: 0, from: "2026-10-01", to: "" },
      { service: "Hjem", maxWeight: 10, baseOre: 8000, fuelPct: 0, fixedOre: 0, from: "", to: "" },
    ]);
  });

  it("reports the line number and field for bad values", () => {
    const sheet = parseCsv(`${invoiceHeaders}\nS1;2026-10-05;Pakkeshop;2;57\nS2;2026-10-05;Pakkeshop;to;57`);
    expect(() => importRows("invoice", sheet, suggestMapping("invoice", sheet.headers)))
      .toThrow(/Datalinje 2\. .*vægt.*ugyldigt/i);
    const badDate = parseCsv(`${invoiceHeaders}\nS1;oktober;Pakkeshop;2;57`);
    expect(() => importRows("invoice", badDate, suggestMapping("invoice", badDate.headers))).toThrow(/Datalinje 1\. Datoen/);
  });

  it("refuses missing or reused source columns", () => {
    const sheet = parseCsv(`${invoiceHeaders}\nS1;2026-10-05;Pakkeshop;2;57`);
    expect(() => importRows("invoice", sheet, { shipment: 0, date: 1, service: 2, weight: 3, billedOre: -1 }))
      .toThrow(/Tilknyt kolonnerne samlet pris/);
    expect(() => importRows("invoice", sheet, { shipment: 0, date: 1, service: 2, weight: 3, billedOre: 3 }))
      .toThrow(/særskilt kildekolonne/);
  });
});

describe("reportCsv", () => {
  it("writes Danish decimals and neutralises spreadsheet formulas", () => {
    const report = runAudit(
      [{ shipment: "=HYPERLINK(1)", date: "2026-10-05", service: "Pakkeshop", weight: 1.5, billedOre: 5800, origin: "DK", destination: "DK" }],
      [{ service: "Pakkeshop", maxWeight: 5, baseOre: 5000, fuelPct: 10, fixedOre: 200, from: "", to: "" }],
    );
    const [header, row] = reportCsv(report).split("\r\n");
    expect(header.startsWith("Forsendelse;Dato")).toBe(true);
    expect(row).toBe('"\'=HYPERLINK(1)";"2026-10-05";"Pakkeshop";"1,5";"58,00";"57,00";"1,00";"Over aftalen";"Fakturaen ligger over den beregnede aftalepris."');
  });
});
