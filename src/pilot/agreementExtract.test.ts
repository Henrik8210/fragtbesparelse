import { describe, expect, it } from "vitest";
import { agreementFromRows } from "./agreements.ts";
import { readContent } from "./agreementFormat.ts";
import {
  AGREEMENT_CHUNK_CHARS, AGREEMENT_MAX_CHUNKS, agreementChunks, agreementRatesToRows, buildAgreementBatches, cellValue,
  extractTerms, printedPrices, rateService, validateAgreementExtract,
} from "./agreementExtract.ts";
import { runAudit } from "./freight.ts";

const TEXT = `Prisbilag - DAO
Gyldig fra 01.02.2027
Produkt  Zone  Vægt  Pris
Pakkeshop  Zone 1  0-2 kg  41,25 kr
Pakkeshop  Zone 2  0-2 kg  48,00 kr
Brændstof 9 %`;

const reply = (rates: unknown[], extra: Record<string, unknown> = {}) => ({
  carrier: "DAO", title: "", validFrom: "01.02.2027", validTo: "", currency: "DKK",
  surcharges: [
    { label: "Brændstof", kind: "percent", value: "9 %", unit: "", scope: "", note: "" },
    { label: "Moms", kind: "percent", value: "25", unit: "", scope: "", note: "" },
  ],
  items: [], grids: [], conditions: [],
  rates,
  ...extra,
});

const GRID_TEXT = `Distribution Sverige pr. palleplads
Pallepladser  Syd  Midt  Nord
1  1.250,00  1.410,50  1.890,25
2-4  980,40  1.105,00  1.512,75
Minimum  1.250,00  1.410,50  1.890,25
Olietillæg 21,5 %
ETS-tillæg  Skal aftales
Forudsætninger
• Fakturering sker månedsvis bagud.`;

const grid = (cells: string[][], extra: Record<string, unknown> = {}) => ({
  name: "Distribution Sverige", category: "Distribution", unit: "pr. palleplads", currency: "DKK", rowLabel: "Pallepladser",
  columns: [{ label: "Syd", detail: "" }, { label: "Midt", detail: "" }, { label: "Nord", detail: "" }],
  rows: cells.map((row, index) => ({ label: ["1", "2-4"][index] ?? String(index), cells: row })),
  minimum: ["1.250,00", "1.410,50", "1.890,25"],
  maximum: [],
  note: "",
  ...extra,
});

describe("validateAgreementExtract", () => {
  it("anchors parcel prices, weights and percents in the PDF text", () => {
    const extract = validateAgreementExtract(reply([
      { service: "Pakkeshop", zone: "Zone 1", maxWeightKg: "2", price: "41,25", fuelPercent: 0, fixedSurcharge: 0 },
      { service: "Pakkeshop", zone: "Zone 2", maxWeightKg: 2, price: 84, fuelPercent: 0, fixedSurcharge: 0 },
    ]), TEXT, { sha256: "x", filename: "dao.pdf" });
    expect(extract.validFrom).toBe("2027-02-01");
    expect(extract.surcharges).toMatchObject([{ label: "Brændstof", kind: "percent", value: 9, issues: [] }]);
    expect(extract.rates[0]).toMatchObject({ baseOre: 4125, maxWeight: 2, fuelPct: 9, issues: [] });
    expect(extract.rates[1].issues).toEqual(["Prisen står ikke ordret i PDF'en."]);
    expect(extract.confidence).toBe("medium");
  });

  it("flags missing fields, foreign currency and an empty agreement", () => {
    const missing = validateAgreementExtract(reply([{ service: "", zone: "", maxWeightKg: 0, price: 0, fuelPercent: 0, fixedSurcharge: 0 }], { currency: "eur" }), TEXT, { sha256: "x", filename: "f.pdf" });
    expect(missing.rates[0].issues).toEqual(["Leveringsform mangler.", "Grundpris mangler.", "Vægttrin mangler."]);
    expect(missing.issues).toContain("Pakkepriserne står i EUR, ikke DKK.");
    expect(missing.confidence).toBe("low");
    const empty = validateAgreementExtract(reply([], { surcharges: [] }), TEXT, { sha256: "x", filename: "f.pdf" });
    expect(empty.issues).toContain("Der blev ikke fundet priser i PDF'en.");
    expect(() => validateAgreementExtract("no", TEXT, { sha256: "x", filename: "f" })).toThrow(/prisaftaleskemaet/);
  });

  it("keeps a row's own fuel percent over the agreement-wide one", () => {
    const extract = validateAgreementExtract(reply([
      { service: "Pakkeshop", zone: "", maxWeightKg: 2, price: 41.25, fuelPercent: 9, fixedSurcharge: 0 },
    ], { surcharges: [{ label: "Miljøtillæg", kind: "amount", value: "48", unit: "", scope: "", note: "" }] }), TEXT, { sha256: "x", filename: "f.pdf" });
    expect(extract.rates[0]).toMatchObject({ fuelPct: 9, fixedOre: 4800 });
  });

  it("anchors every grid cell and minimum, and flags only the cells that are not printed", () => {
    const extract = validateAgreementExtract(reply([], {
      surcharges: [
        { label: "Olietillæg", kind: "percent", value: "21,5", unit: "", scope: "Sverige", note: "" },
        { label: "ETS-tillæg", kind: "amount", value: "Skal aftales", unit: "", scope: "", note: "" },
      ],
      grids: [grid([["1.250,00", "1.410,50", "1.890,25"], ["980,40", "1.150,00", "1.512,75"]])],
      conditions: ["Fakturering sker månedsvis bagud.", "Betaling netto 8 dage."],
    }), GRID_TEXT, { sha256: "x", filename: "se.pdf" });
    const [read] = extract.grids;
    expect(read.rows[0].cells).toEqual([1250, 1410.5, 1890.25]);
    expect(read.minimum).toEqual([1250, 1410.5, 1890.25]);
    expect(read.maximum).toEqual([]);
    expect(read.unprinted).toEqual(["1:1"]);
    expect(read.issues).toEqual(["1 af 9 tal står ikke ordret i PDF'en."]);
    expect(extract.surcharges.map((item) => [item.kind, item.value, item.issues])).toEqual([["percent", 21.5, []], ["agreed", null, []]]);
    expect(extract.rates).toEqual([]);
    expect(extract.conditions).toEqual([{ text: "Fakturering sker månedsvis bagud.", printed: true }, { text: "Betaling netto 8 dage.", printed: false }]);
    expect(extract.issues).toContain("1 betingelser står ikke ordret i PDF'en.");
    expect(extract.confidence).toBe("medium");
  });

  it("reports how many printed prices the extract holds", () => {
    const partial = validateAgreementExtract(reply([], {
      surcharges: [],
      grids: [grid([["1.250,00", "", ""]], { minimum: [] })],
    }), `${GRID_TEXT}\n${Array.from({ length: 10 }, (_, index) => `Ekstra ${index + 10},25`).join("\n")}`, { sha256: "x", filename: "f.pdf" });
    expect(partial.coverage.captured).toBe(1);
    expect(partial.coverage.printed).toBeGreaterThan(10);
    expect(partial.issues.some((issue) => /Kun 1 af \d+ priser/.test(issue))).toBe(true);
    expect(partial.confidence).toBe("low");
  });

  it("merges replies from several page groups and keeps the first header fields", () => {
    const extract = validateAgreementExtract([
      reply([], { surcharges: [], title: "Aftale A", conditions: ["Fakturering sker månedsvis bagud."] }),
      reply([], { carrier: "", validFrom: "", surcharges: [], grids: [grid([["1.250,00", "1.410,50", "1.890,25"]])], conditions: ["Fakturering sker  månedsvis bagud."] }),
    ], GRID_TEXT, { sha256: "x", filename: "f.pdf" });
    expect(extract.title).toBe("Aftale A");
    expect(extract.carrier).toBe("DAO");
    expect(extract.grids).toHaveLength(1);
    expect(extract.conditions).toHaveLength(1);
    expect(extract.chunks).toBe(2);
  });

  it("drops review markers when the terms are stored", () => {
    const extract = validateAgreementExtract(reply([], { grids: [grid([["1.250,00", "1.410,50", "1.890,25"]])] }), GRID_TEXT, { sha256: "x", filename: "f.pdf" });
    const terms = extractTerms(extract);
    expect(terms.grids[0]).not.toHaveProperty("unprinted");
    expect(terms.surcharges[0]).not.toHaveProperty("issues");
    const agreement = agreementFromRows([], { orgId: "kolding-table-co", name: "SE", carrier: "DAO", from: "", to: "" }, new Date(), terms);
    expect(agreement.rows).toEqual([]);
    expect(agreement.terms?.grids[0].rows[0].cells).toEqual([1250, 1410.5, 1890.25]);
  });
});

describe("page groups", () => {
  it("keeps short agreements in one call and splits long ones on page and line breaks", () => {
    expect(agreementChunks("Side 1\n\nSide 2").chunks).toEqual(["Side 1\n\nSide 2"]);
    const page = Array.from({ length: 120 }, (_, index) => `Linje ${index}  ${index},50  DKK`).join("\n");
    const { chunks, truncated } = agreementChunks([page, page, page].join("\n\n"));
    expect(truncated).toBe(false);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= AGREEMENT_CHUNK_CHARS)).toBe(true);
    expect(chunks.join("\n").split("\n").filter((line) => line.startsWith("Linje"))).toHaveLength(360);
    const { batches } = buildAgreementBatches([page, page].join("\n\n"));
    expect(batches[0].messages[1].content).toMatch(/part 1 of \d/);
  });

  it("stops at the chunk cap and says the text was cut", () => {
    const page = "x ".repeat(AGREEMENT_CHUNK_CHARS / 2 - 10);
    const { chunks, truncated } = agreementChunks(Array.from({ length: AGREEMENT_MAX_CHUNKS + 3 }, () => page).join("\n\n"));
    expect(chunks).toHaveLength(AGREEMENT_MAX_CHUNKS);
    expect(truncated).toBe(true);
  });
});

describe("numbers", () => {
  it("reads printed numbers and leaves 'Skal aftales' empty", () => {
    expect(cellValue("1.234,50")).toBe(1234.5);
    expect(cellValue("+15 %")).toBe(15);
    expect(cellValue("0,85 kr.")).toBe(0.85);
    expect(cellValue("Skal aftales")).toBeNull();
    expect(cellValue("")).toBeNull();
    expect([...printedPrices(GRID_TEXT)].sort((a, b) => a - b)).toEqual([2150, 98040, 110500, 125000, 141050, 151275, 189025]);
  });

  it("reads format 1 rows as content with no other terms", () => {
    const rows = [{ service: "Pakkeshop", maxWeight: 5, baseOre: 4600, fuelPct: 0, fixedOre: 0, from: "", to: "" }];
    expect(readContent(rows, 1)).toEqual({ rates: rows, items: [], grids: [], surcharges: [], conditions: [] });
  });
});

describe("agreementRatesToRows", () => {
  it("turns reviewed rates into rows the invoice check prices against", () => {
    const rows = agreementRatesToRows([
      { service: "Pakkeshop", zone: "", maxWeight: 5, baseOre: 4600, fuelPct: 12.5, fixedOre: 240 },
    ], "2027-01-01", "2027-12-31");
    expect(rows).toEqual([{ service: "Pakkeshop", maxWeight: 5, baseOre: 4600, fuelPct: 12.5, fixedOre: 240, from: "2027-01-01", to: "2027-12-31" }]);
    const report = runAudit([{ shipment: "1", date: "2027-03-01", service: "Pakkeshop", weight: 3, billedOre: 5415, origin: "DK", destination: "DK" }], rows);
    expect(report.lines[0]).toMatchObject({ status: "match", expectedOre: 4600 + 575 + 240 });
  });

  it("names the first bad row, and an agreement needs rates or other terms", () => {
    expect(agreementRatesToRows([], "", "")).toEqual([]);
    expect(() => agreementFromRows([], { orgId: "o", name: "", carrier: "", from: "", to: "" })).toThrow(/mindst én pris/);
    expect(() => agreementRatesToRows([
      { service: "Pakkeshop", zone: "", maxWeight: 5, baseOre: 4600, fuelPct: 0, fixedOre: 0 },
      { service: " ", zone: "", maxWeight: 5, baseOre: 4600, fuelPct: 0, fixedOre: 0 },
    ], "", "")).toThrow(/Pakkepris 2\. Kontrollér leveringsform/);
  });

  it("puts a zone into the service name once", () => {
    expect(rateService("Pakkeshop", "Zone 2")).toBe("Pakkeshop Zone 2");
    expect(rateService("Pakkeshop Zone 2", "zone 2")).toBe("Pakkeshop Zone 2");
    expect(rateService("Pakkeshop", "")).toBe("Pakkeshop");
  });
});
