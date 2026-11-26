import { describe, expect, it } from "vitest";
import { agreementFromRows } from "./agreements.ts";
import { readContent } from "./agreementFormat.ts";
import {
  AGREEMENT_CHUNK_CHARS, AGREEMENT_MAX_CHUNKS, agreementChunks, agreementRatesToRows, buildAgreementBatches, cellValue,
  extractTerms, issuingCarrier, printedGrids, printedPrices, rateService, validateAgreementExtract,
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

const GRID_TEXT = `Prisblad DAO
Distribution Sverige pr. palleplads
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
    expect(read.rows[1].cells).toEqual([980.4, 1105, 1512.75]);
    expect(read.minimum).toEqual([1250, 1410.5, 1890.25]);
    expect(read.maximum).toEqual([]);
    expect(read.unprinted).toEqual([]);
    expect(read.issues).toEqual([]);
    expect(extract.surcharges.map((item) => [item.kind, item.value, item.issues])).toEqual([["percent", 21.5, []], ["agreed", null, []]]);
    expect(extract.rates).toEqual([]);
    expect(extract.conditions).toEqual([{ text: "Fakturering sker månedsvis bagud.", printed: true }, { text: "Betaling netto 8 dage.", printed: false }]);
    expect(extract.issues).toContain("1 betingelser står ikke ordret i PDF'en.");
    expect(extract.confidence).toBe("medium");
  });

  it("flags only the cells that are not printed when no printed table holds the grid", () => {
    const prose = GRID_TEXT.replace(/ {2,}/g, " / ");
    const [read] = validateAgreementExtract(reply([], {
      surcharges: [],
      grids: [grid([["1.250,00", "1.410,50", "1.890,25"], ["980,40", "1.150,00", "1.512,75"]])],
    }), prose, { sha256: "x", filename: "se.pdf" }).grids;
    expect(read.unprinted).toEqual(["1:1"]);
    expect(read.issues).toEqual(["1 af 9 tal står ikke ordret i PDF'en."]);
  });

  it("takes a reworded condition as the sentence printed in the PDF", () => {
    const extract = validateAgreementExtract(reply([], { surcharges: [], conditions: ["Fakturering sker bagud månedsvis."] }), GRID_TEXT, { sha256: "x", filename: "se.pdf" });
    expect(extract.conditions).toEqual([{ text: "Fakturering sker månedsvis bagud.", printed: true }]);
  });

  it("reports how many printed prices the extract holds", () => {
    const partial = validateAgreementExtract(reply([], {
      surcharges: [],
      grids: [grid([["1.250,00", "", ""]], { minimum: [] })],
    }), `${GRID_TEXT}\n${Array.from({ length: 10 }, (_, index) => `Ekstra ${index + 10},25`).join("\n")}`, { sha256: "x", filename: "f.pdf" });
    // The grid's one cell brings the printed table, six prices; the ten "Ekstra" numbers stay out.
    expect(partial.coverage.captured).toBe(6);
    expect(partial.coverage.printed).toBeGreaterThan(10);
    expect(partial.issues.some((issue) => /Kun 6 af \d+ priser/.test(issue))).toBe(true);
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

const ISSUED_TEXT = `Rateblad for Kunde Handel
Gyldig fra 01.01.2027 til 31.12.2027
Lager
Lagerleje pr. uge, pr. EUR-palle  31,50  DKK
Pluk pr. kolli  1,75  DKK
Distribution til Tyskland
Destination  Aarby  Bstrup  Nedre Vang
Postnr.  DE-10000  DE-20000  DE-30000
Minimum pr. lev.  700,10  455,20  440,30
1-5 pallepladser  250,40  170,50  160,60
Ventetid pr. påbegyndt time  580,00  DKK
Med venlig hilsen
Nordfragt A/S
Nordfragt A/S, Havnevej 1, 9000 Aalborg`;

describe("a reply that misses lines and shifts a wrapped header", () => {
  const raw = {
    carrier: "Kunde Handel", title: "Rateblad for Kunde Handel", validFrom: "01.01.2027", validTo: "31.12.2027", currency: "DKK",
    rates: [{ service: "Distribution til Tyskland", zone: "", maxWeightKg: 0, price: 0, fuelPercent: 0, fixedSurcharge: 0 }],
    items: [],
    grids: [{
      name: "Distribution til Tyskland", category: "", unit: "pr. palleplads", currency: "DKK", rowLabel: "",
      columns: ["Destination", "Aarby", "Bstrup", "Nedre", "Vang"].map((label) => ({ label, detail: "" })),
      rows: [
        { label: "Minimum pr. lev.", cells: ["700,10", "455,20", "440,30", null, null] },
        { label: "1-5 pallepladser", cells: ["250,40", "170,50", "160,60", null, null] },
      ],
      minimum: [], maximum: [], note: "",
    }],
    surcharges: [{ label: "Ventetid", kind: "percent", value: "580", unit: "pr. påbegyndt time", scope: "", note: "" }],
    conditions: [],
  };
  const extract = validateAgreementExtract([raw], ISSUED_TEXT, { sha256: "x", filename: "rateblad.pdf" });

  it("takes the carrier as the issuing company, not the customer", () => {
    expect(extract.carrier).toBe("Nordfragt");
  });

  it("adds the price lines the model skipped, from the text as printed", () => {
    expect(extract.items.map((item) => [item.category, item.price])).toEqual([["Lager", 31.5], ["Lager", 1.75]]);
    expect(extract.items.every((item) => item.issues.length === 0)).toBe(true);
  });

  it("puts the cells under the printed column names", () => {
    const [read] = extract.grids;
    expect(read.columns).toEqual([
      { label: "Aarby", detail: "DE-10000" }, { label: "Bstrup", detail: "DE-20000" }, { label: "Nedre Vang", detail: "DE-30000" },
    ]);
    expect(read.minimum).toEqual([700.1, 455.2, 440.3]);
    expect(read.rows).toEqual([{ label: "1-5 pallepladser", cells: [250.4, 170.5, 160.6] }]);
    expect(read.issues).toEqual([]);
  });

  it("drops an empty rate, reads an hourly price as an amount and finds every price", () => {
    expect(extract.rates).toEqual([]);
    expect(extract.surcharges[0]).toMatchObject({ kind: "amount", value: 580 });
    expect(extract.coverage.captured).toBe(extract.coverage.printed);
  });

  it("flags a column without prices when no printed table holds the grid", () => {
    const prose = ISSUED_TEXT.replace(/^(?:Destination|Postnr\.).*\n/gm, "").replace(/ {2,}/g, " ");
    const empty = validateAgreementExtract([{ ...raw, grids: [{ ...raw.grids[0], columns: raw.grids[0].columns.slice(1), rows: raw.grids[0].rows.map((row) => ({ ...row, cells: [...row.cells.slice(0, 3), null] })) }] }], prose, { sha256: "x", filename: "x.pdf" });
    expect(empty.grids[0].issues.join(" ")).toMatch(/«Vang» har ingen priser/);
  });

  it("drops a column the model added when the printed table has none", () => {
    const wide = validateAgreementExtract([{ ...raw, grids: [{ ...raw.grids[0], columns: raw.grids[0].columns.slice(1), rows: raw.grids[0].rows.map((row) => ({ ...row, cells: [...row.cells.slice(0, 3), null] })) }] }], ISSUED_TEXT.replace(/^(?:Destination|Postnr\.).*\n/gm, ""), { sha256: "x", filename: "x.pdf" });
    expect(wide.grids[0].columns).toHaveLength(3);
    expect(wide.grids[0].issues.join(" ")).not.toMatch(/ingen priser/);
  });
});

describe("printedGrids", () => {
  it("reads a table with its title, header, detail line and minimum straight from the text", () => {
    expect(printedGrids(ISSUED_TEXT)).toEqual([{
      name: "Distribution til Tyskland", category: "", unit: "", currency: "DKK", rowLabel: "Destination",
      columns: [{ label: "Aarby", detail: "DE-10000" }, { label: "Bstrup", detail: "DE-20000" }, { label: "Nedre Vang", detail: "DE-30000" }],
      rows: [{ label: "1-5 pallepladser", cells: [250.4, 170.5, 160.6] }],
      minimum: [700.1, 455.2, 440.3], maximum: [], note: "", unprinted: [], issues: [],
    }]);
  });

  it("leaves single price lines and prose alone", () => {
    expect(printedGrids("Lagerleje pr. uge  31,50  DKK\nPluk pr. kolli  1,75  DKK\nVentetid koster 580,00 kr. pr. time")).toEqual([]);
  });

  it("leaves the prices it reads out of a part's own count, so a dropped table is not a short read", () => {
    const { plans } = buildAgreementBatches(`${ISSUED_TEXT}\nTillæg ved levering efter kl. 16 udgør 125,00 kr.`);
    expect(plans.flatMap((plan) => plan.prices)).toEqual([12500]);
  });
});

describe("listed surcharges and grid rows read twice", () => {
  const text = `Distribution til Nord
Pallepladser  Aarby  Bstrup
Minimum  1.007,01  1.057,36
Alle transportrater er ekskl. gældende olietillæg, som pr. 01-12-2026 udgør:
◦  21,58% for national kørsel.
◦  28,22% for øvrige lande.
Olietillæg reguleres månedligt.`;
  const extract = validateAgreementExtract([{
    carrier: "Nordfragt", title: "", validFrom: "", validTo: "", currency: "DKK", rates: [], conditions: [],
    items: [
      { category: "Distribution til Nord", description: "Minimum", unit: "", price: "1.007,01", currency: "DKK", note: "" },
    ],
    grids: [{
      name: "Distribution til Nord", category: "", unit: "", currency: "DKK", rowLabel: "Pallepladser", note: "", minimum: [], maximum: [],
      columns: [{ label: "Aarby", detail: "" }, { label: "Bstrup", detail: "" }], rows: [{ label: "Minimum", cells: ["1.007,01", "1.057,36"] }],
    }],
    surcharges: [
      { label: "Olietillæg", kind: "agreed", value: null, unit: "", scope: "", note: "" },
      { label: "Olietillæg", kind: "agreed", value: null, unit: "", scope: "", note: "" },
    ],
  }], text, { sha256: "x", filename: "x.pdf" });

  it("takes each percentage from the bullets under the surcharge", () => {
    expect(extract.surcharges.map((item) => [item.kind, item.value, item.scope])).toEqual([
      ["percent", 21.58, "for national kørsel"], ["percent", 28.22, "for øvrige lande"],
    ]);
  });

  it("drops an item that repeats a cell of the grid it names", () => {
    expect(extract.items).toEqual([]);
    expect(extract.grids[0].rows[0].cells).toEqual([1007.01, 1057.36]);
  });

  it("does not take a reply that is not an agreement object as an empty part", () => {
    const wrapped = validateAgreementExtract([{ response: {} }, reply([])], TEXT, { sha256: "x", filename: "x.pdf" });
    expect(wrapped.issues).toContain("1 af 2 dele af PDF'en kunne ikke læses.");
  });
});

const PALLET_TEXT = `Prisaftale fra Vest Logistik A/S
Rateblad for Kunde Handel
Hasteleverancer
Raterne er angivet i DKK for levering samme dag.
Område  Zone 1  Zone 2  Øer
0 – 3 ppl  1.025,14  1.935,04  3.303,29
3,1 – 15 ppl  702,61  1.151,08  2.341,20
15,1 ppl - FTL  437,13  733,57  1.531,15
Ab lager gælder Zone 1 satser.
Med venlig hilsen
Vest Logistik A/S`;

describe("a pallet table read as parcel rates, and a carrier the PDF does not print", () => {
  const prices: Record<string, string[]> = { "Zone 1": ["1.025,14", "702,61", "437,13"], "Zone 2": ["1.935,04", "1.151,08", "733,57"], "Øer": ["3.303,29", "2.341,20", "1.531,15"] };
  const rates = Object.entries(prices).flatMap(([zone, column]) => column.map((price, tier) => ({
    service: "Hasteleverancer", zone, maxWeightKg: [3, 15, 0][tier], price, fuelPercent: 0, fixedSurcharge: 0,
  })));
  const part = (carrier: string, extra: Record<string, unknown> = {}) => ({
    carrier, title: "", validFrom: "", validTo: "", currency: "DKK", rates: [], items: [], grids: [], surcharges: [], conditions: [], ...extra,
  });
  const extract = validateAgreementExtract([part("Nordfragt", { rates: rates.slice(0, 7) }), part("Nordfragt"), part("VL")], PALLET_TEXT, { sha256: "x", filename: "x.pdf" });

  it("moves the rows out of the parcel rates into the printed table, tiers the model skipped included", () => {
    expect(extract.rates).toEqual([]);
    expect(extract.grids).toHaveLength(1);
    expect(extract.grids[0]).toMatchObject({
      name: "Hasteleverancer", rowLabel: "Område",
      columns: [{ label: "Zone 1", detail: "" }, { label: "Zone 2", detail: "" }, { label: "Øer", detail: "" }],
      rows: [
        { label: "0 – 3 ppl", cells: [1025.14, 1935.04, 3303.29] },
        { label: "3,1 – 15 ppl", cells: [702.61, 1151.08, 2341.2] },
        { label: "15,1 ppl - FTL", cells: [437.13, 733.57, 1531.15] },
      ],
    });
    expect(extract.coverage.captured).toBe(extract.coverage.printed);
  });

  it("keeps a parcel rate by weight", () => {
    const text = `Pakker\nVægt  Zone 1\n0 - 5 kg  41,25\n5 - 10 kg  48,00`;
    const read = validateAgreementExtract([part("", { rates: [{ service: "Pakker", zone: "Zone 1", maxWeightKg: 5, price: "41,25", fuelPercent: 0, fixedSurcharge: 0 }] })], text, { sha256: "x", filename: "x.pdf" });
    expect(read.rates).toHaveLength(1);
    expect(read.grids).toEqual([]);
  });

  it("does not take a carrier name the PDF does not print", () => {
    expect(extract.carrier).toBe("Vest Logistik");
    expect(issuingCarrier(["Nordfragt"], PALLET_TEXT)).toBe("Vest Logistik");
  });

  it("names no company as an example in the prompt", () => {
    const { batches } = buildAgreementBatches(PALLET_TEXT);
    const prompt = JSON.stringify(batches[0]);
    expect(prompt).not.toMatch(/Nordfragt/i);
  });
});
