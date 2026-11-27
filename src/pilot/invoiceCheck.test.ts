import { describe, expect, it } from "vitest";
import {
  checkedExtract, checkIssues, checkLinesSchema, isFieldEdited, lineChanges, lineProblems, linesFromExtract, linesFromRows,
  nextCheck, parseKroner, parseWeight, rowsFromLines, type CheckLine,
} from "./invoiceCheck.ts";
import { lineFee, validateExtract } from "./invoiceExtract.ts";

const PDF_TEXT = `Freightlytics testfaktura
Fakturanr: NL-2026-001
Dato: 16 Nov 2026
Transportor: PostNord
Linje 1 Pakke 2 kg Taastrup til Aarhus  85,00 kr
Linje 2 Pakke 5 kg Taastrup til Odense 120,00 kr
Linje 3 Braendstoftillaeg  18,50 kr
I alt  223,50 kr`;

const extract = validateExtract({
  carrier: "PostNord", invoiceNumber: "NL-2026-001", invoiceDate: "2026-11-16", currency: "DKK", subtotal: 0, vat: 0, total: 223.5,
  lines: [
    { kind: "shipment", shipment: "", date: "", reference: "Linje 1", service: "Pakke", weightKg: 2, zone: "Taastrup til Aarhus", origin: "DK", destination: "DK", amount: 80, surcharges: [{ label: "Miljø", amount: 5 }] },
    { kind: "shipment", shipment: "", date: "", reference: "Linje 2", service: "Pakke", weightKg: 5, zone: "", origin: "DK", destination: "DK", amount: 120, surcharges: [] },
    { kind: "surcharge", shipment: "", date: "", reference: "Linje 3", service: "Braendstoftillaeg", weightKg: 0, zone: "", origin: "", destination: "", amount: 18.5, surcharges: [] },
  ],
}, PDF_TEXT, { sha256: "x", filename: "nordhavn-living-testfaktura.pdf" });

describe("check lines", () => {
  it("fold each PDF line's own surcharges into its amount", () => {
    const lines = linesFromExtract(extract);
    expect(lines.map((line) => [line.kind, line.reference, line.amountOre])).toEqual([
      ["shipment", "Linje 1", 8500], ["shipment", "Linje 2", 12000], ["surcharge", "Linje 3", 1850],
    ]);
  });

  it("come from CSV rows with negative amounts as credits", () => {
    const lines = linesFromRows([
      { shipment: "S1", date: "2026-10-05", service: "Pakkeshop", weight: 1.5, billedOre: 4150, origin: "DK", destination: "DK" },
      { shipment: "S2", date: "2026-10-06", service: "Pakkeshop", weight: 1, billedOre: -500, origin: "DK", destination: "SE" },
    ]);
    expect(lines.map((line) => [line.kind, line.amountOre, line.destination])).toEqual([["shipment", 4150, "DK"], ["credit", -500, "SE"]]);
  });
});

describe("edits", () => {
  const original = linesFromExtract(extract);
  const edited: CheckLine[] = original.map((line, index) => index === 1 ? { ...line, weightKg: 4, amountOre: 11000 } : line);

  it("are listed per field and flagged per cell", () => {
    expect(lineChanges(original, edited)).toEqual([
      { line: 1, field: "weightKg", from: 5, to: 4 },
      { line: 1, field: "amountOre", from: 12000, to: 11000 },
    ]);
    expect(lineChanges(original, original)).toEqual([]);
    expect(isFieldEdited(original, edited, 1, "amountOre")).toBe(true);
    expect(isFieldEdited(original, edited, 0, "amountOre")).toBe(false);
    expect(lineChanges(original, original.slice(0, 2)).filter((change) => change.line === 2)).toHaveLength(8);
  });

  it("override the extract and are redone against the printed total", () => {
    const applied = checkedExtract(extract, edited);
    expect(applied.lines[1]).toMatchObject({ weightKg: 4, amountOre: 11000, surcharges: [] });
    expect(applied.check).toMatchObject({ lineSumOre: 21350, targetOre: 22350, status: "mismatch" });
    expect(applied.carrier).toBe("PostNord");
    expect(applied.lines[0].zone).toBe("Taastrup til Aarhus");
    expect(checkedExtract(extract, original).check.status).toBe("match");
  });

  it("override the rows used by the invoice check, with shared surcharges spread", () => {
    const rows = rowsFromLines(edited, { invoiceNumber: "NL-2026-001", invoiceDate: "2026-11-16" });
    expect(rows.map((row) => [row.weight, row.billedOre, row.date])).toEqual([[2, 8500 + 806, "2026-11-16"], [4, 11000 + 1044, "2026-11-16"]]);
    expect(rows.reduce((sum, row) => sum + row.billedOre, 0)).toBe(8500 + 11000 + 1850);
  });
});

describe("nextCheck", () => {
  const original = linesFromExtract(extract);
  const first = nextCheck(null, { fileId: "f1", companyId: "nordhavn-living", original, lines: original, by: "u1", name: "Henrik", now: new Date("2026-11-19T10:00:00Z") });

  it("records who confirmed an unchanged invoice and when", () => {
    expect(first).toMatchObject({ changed: false, checkedBy: "u1", checkedByName: "Henrik", checkedAt: "2026-11-19T10:00:00.000Z", firstCheckedAt: "2026-11-19T10:00:00.000Z" });
    expect(first.history).toEqual([{ at: "2026-11-19T10:00:00.000Z", by: "u1", name: "Henrik", changes: [] }]);
  });

  it("keeps the first original when a later save sends other values", () => {
    const edited = original.map((line, index) => index === 0 ? { ...line, service: "Pakkeshop" } : line);
    const second = nextCheck(first, {
      fileId: "f1", companyId: "nordhavn-living", original: edited, lines: edited, by: "u2", name: "Jesper", now: new Date("2026-11-20T08:00:00Z"),
    });
    expect(second.original).toBe(original);
    expect(second).toMatchObject({ changed: true, checkedByName: "Jesper", firstCheckedAt: "2026-11-19T10:00:00.000Z" });
    expect(second.history.at(-1)?.changes).toEqual([{ line: 0, field: "service", from: "Pakke", to: "Pakkeshop" }]);
  });
});

describe("input", () => {
  it("parses Danish and plain kroner and weights", () => {
    expect(parseKroner("1.234,56")).toBe(123456);
    expect(parseKroner("85")).toBe(8500);
    expect(parseKroner("-5,5 kr")).toBe(-550);
    expect(parseKroner("1.250")).toBe(125000);
    expect(parseKroner("abc")).toBeNull();
    expect(parseWeight("2,5")).toBe(2.5);
    expect(parseWeight("")).toBe(0);
    expect(parseWeight("1001")).toBeNull();
    expect(parseWeight("17650", 40_000)).toBe(17650);
  });

  it("names lines that cannot be used and rejects malformed payloads", () => {
    const line = linesFromExtract(extract)[0];
    expect(lineProblems([{ ...line, service: " " }], "2026-11-16")).toEqual(["Linje 1: leveringsform mangler."]);
    expect(lineProblems([{ ...line, date: "" }], "")).toEqual(["Linje 1: dato mangler."]);
    expect(lineProblems([{ ...line, kind: "fee" }], "2026-11-16")).toEqual(["Fakturaen skal have mindst én forsendelse."]);
    const blank = { kind: "shipment" as const, date: "2026-10-02", service: "", weight: "", amount: "971,22" };
    const issues = checkIssues([blank, { ...blank, service: "Jylland/Fyn A – COOP", weight: "2840" }, { ...blank, service: "", weight: "x" }], "2026-10-31");
    expect(issues.map((issue) => issue.key)).toEqual(["line:0:service", "line:2:service", "line:2:weight"]);
    expect(issues[0].message).toMatch(/Leveringsform mangler/);
    expect(checkLinesSchema.safeParse([{ ...line, weightKg: 2840 }]).success).toBe(true);
    expect(checkLinesSchema.safeParse([{ ...line, date: "2026-02-30" }]).success).toBe(false);
    expect(checkLinesSchema.safeParse([{ ...line, amountOre: 1.5 }]).success).toBe(false);
    expect(checkLinesSchema.safeParse([]).success).toBe(false);
    expect(checkLinesSchema.parse([{ ...line, service: "  Pakke\n shop " }])[0].service).toBe("Pakke shop");
  });

  it("keeps a priced fee's quantity through a saved check, so it is not spread over the shipments", () => {
    const source = {
      ...extract,
      lines: [
        { ...extract.lines[0], kind: "fee" as const, quantity: 186, unit: "pll", unitPriceOre: 3068, amountOre: 570648, weightKg: 0, service: "Indlagring", shipment: "", surcharges: [] },
        extract.lines[1],
      ],
    };
    const saved = checkLinesSchema.parse(linesFromExtract(source));
    expect(saved[0].quantity).toBe(186);
    expect(saved[0].unit).toBe("pll");
    const shown = checkedExtract(source, saved);
    expect(lineFee(shown.lines[0])).toBe(true);
    const rows = rowsFromLines(saved, { invoiceDate: "2026-11-16" });
    expect(rows).toHaveLength(1);
    expect(rows[0].billedOre).toBe(extract.lines[1].amountOre + extract.lines[1].surcharges.reduce((sum, item) => sum + item.amountOre, 0));
  });
});
