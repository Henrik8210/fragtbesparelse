import { describe, expect, it } from "vitest";
import { agreementRatesToRows, rateService, validateAgreementExtract } from "./agreementExtract.ts";
import { runAudit } from "./freight.ts";

const TEXT = `Prisbilag - DAO
Gyldig fra 01.02.2027
Produkt  Zone  Vægt  Pris
Pakkeshop  Zone 1  0-2 kg  41,25 kr
Pakkeshop  Zone 2  0-2 kg  48,00 kr
Brændstof 9 %`;

const reply = (rates: unknown[], extra: Record<string, unknown> = {}) => ({
  carrier: "DAO", title: "", validFrom: "01.02.2027", validTo: "", currency: "DKK",
  surcharges: [{ label: "Brændstof", percent: "9 %", amount: 0 }, { label: "Moms", percent: 25, amount: 0 }],
  rates,
  ...extra,
});

describe("validateAgreementExtract", () => {
  it("anchors prices, weights and percents in the PDF text", () => {
    const extract = validateAgreementExtract(reply([
      { service: "Pakkeshop", zone: "Zone 1", maxWeightKg: "2", price: "41,25", fuelPercent: 0, fixedSurcharge: 0 },
      { service: "Pakkeshop", zone: "Zone 2", maxWeightKg: 2, price: 84, fuelPercent: 0, fixedSurcharge: 0 },
    ]), TEXT, { sha256: "x", filename: "dao.pdf" });
    expect(extract.validFrom).toBe("2027-02-01");
    expect(extract.surcharges).toEqual([{ label: "Brændstof", pct: 9, amountOre: 0, printed: true }]);
    expect(extract.rates[0]).toMatchObject({ baseOre: 4125, maxWeight: 2, fuelPct: 9, issues: [] });
    expect(extract.rates[1].issues).toEqual(["Prisen står ikke ordret i PDF'en."]);
    expect(extract.confidence).toBe("medium");
  });

  it("flags missing fields, foreign currency and an empty table", () => {
    const missing = validateAgreementExtract(reply([{ service: "", zone: "", maxWeightKg: 0, price: 0, fuelPercent: 0, fixedSurcharge: 0 }], { currency: "eur" }), TEXT, { sha256: "x", filename: "f.pdf" });
    expect(missing.rates[0].issues).toEqual(["Leveringsform mangler.", "Grundpris mangler.", "Vægttrin mangler."]);
    expect(missing.issues).toContain("Priserne står i EUR, ikke DKK.");
    expect(missing.confidence).toBe("low");
    const empty = validateAgreementExtract(reply([]), TEXT, { sha256: "x", filename: "f.pdf" });
    expect(empty.issues).toContain("Der blev ikke fundet priser i PDF'en.");
    expect(() => validateAgreementExtract({ rates: "no" }, TEXT, { sha256: "x", filename: "f" })).toThrow(/prisaftaleskemaet/);
  });

  it("keeps a row's own fuel percent over the agreement-wide one", () => {
    const extract = validateAgreementExtract(reply([
      { service: "Pakkeshop", zone: "", maxWeightKg: 2, price: 41.25, fuelPercent: 9, fixedSurcharge: 0 },
    ], { surcharges: [{ label: "Miljøtillæg", percent: 0, amount: 48 }] }), TEXT, { sha256: "x", filename: "f.pdf" });
    expect(extract.rates[0]).toMatchObject({ fuelPct: 9, fixedOre: 4800 });
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

  it("names the first bad row and refuses an empty list", () => {
    expect(() => agreementRatesToRows([], "", "")).toThrow(/mindst én pris/);
    expect(() => agreementRatesToRows([
      { service: "Pakkeshop", zone: "", maxWeight: 5, baseOre: 4600, fuelPct: 0, fixedOre: 0 },
      { service: " ", zone: "", maxWeight: 5, baseOre: 4600, fuelPct: 0, fixedOre: 0 },
    ], "", "")).toThrow(/Række 2\. Kontrollér leveringsform/);
  });

  it("puts a zone into the service name once", () => {
    expect(rateService("Pakkeshop", "Zone 2")).toBe("Pakkeshop Zone 2");
    expect(rateService("Pakkeshop Zone 2", "zone 2")).toBe("Pakkeshop Zone 2");
    expect(rateService("Pakkeshop", "")).toBe("Pakkeshop");
  });
});
