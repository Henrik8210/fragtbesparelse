import { describe, expect, it } from "vitest";
import {
  auditRequestSchema, benchmarkSamples, normalizedText, rateRowSchema, runAudit, serviceKey, serviceLabel,
  type InvoiceRow, type RateRow,
} from "./freight";

function rate(overrides: Partial<RateRow> = {}): RateRow {
  return { service: "Pakkeshop", maxWeight: 5, baseOre: 5000, fuelPct: 10, fixedOre: 200, from: "", to: "", ...overrides };
}

function line(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    shipment: "S1", date: "2026-10-05", service: "Pakkeshop", weight: 2, billedOre: 5700,
    origin: "DK", destination: "DK", ...overrides,
  };
}

describe("normalizedText and serviceKey", () => {
  it("folds Danish letters, accents, case and punctuation", () => {
    expect(normalizedText("  Vægt (kg) ")).toBe("vaegtkg");
    expect(normalizedText("Brændstof-Tillæg")).toBe("braendstoftillaeg");
    expect(normalizedText("Gyldig_Til")).toBe("gyldigtil");
    expect(normalizedText("Café")).toBe("cafe");
  });

  it("maps service synonyms to the benchmark keys", () => {
    expect(serviceKey("Parcel Shop")).toBe("pakkeshop");
    expect(serviceKey("ServicePoint")).toBe("pakkeshop");
    expect(serviceKey("Home delivery")).toBe("hjemmelevering");
    expect(serviceKey("Privatlevering")).toBe("hjemmelevering");
    expect(serviceKey("Express 12")).toBe("express12");
  });

  it("labels known services and keeps unknown ones as written", () => {
    expect(serviceLabel("parcelshop")).toBe("Pakkeshop");
    expect(serviceLabel("Express 12")).toBe("Express 12");
  });
});

describe("runAudit", () => {
  it("computes the agreed price as base + fuel% of base + fixed fee", () => {
    const report = runAudit([line()], [rate()]);
    const [result] = report.lines;
    expect(result.status).toBe("match");
    expect(result.expectedOre).toBe(5000 + 500 + 200);
    expect(result.differenceOre).toBe(0);
    expect(result.rate?.fuelOre).toBe(500);
  });

  it("rounds the fuel surcharge to whole øre", () => {
    const report = runAudit([line({ billedOre: 1234 + 154 })], [rate({ baseOre: 1234, fuelPct: 12.5, fixedOre: 0 })]);
    expect(report.lines[0].rate?.fuelOre).toBe(154);
    expect(report.lines[0].status).toBe("match");
  });

  it("tolerates one øre either way before flagging a deviation", () => {
    const rates = [rate()];
    expect(runAudit([line({ billedOre: 5701 })], rates).lines[0].status).toBe("match");
    expect(runAudit([line({ billedOre: 5699 })], rates).lines[0].status).toBe("match");
    expect(runAudit([line({ billedOre: 5702 })], rates).lines[0].status).toBe("over");
    expect(runAudit([line({ billedOre: 5698 })], rates).lines[0].status).toBe("under");
  });

  it("sums deviations in the summary", () => {
    const invoice = [
      line({ shipment: "A", billedOre: 6700 }),
      line({ shipment: "B", billedOre: 5200 }),
      line({ shipment: "C", billedOre: 5700 }),
      line({ shipment: "D", service: "Pallet" }),
    ];
    const { summary } = runAudit(invoice, [rate()]);
    expect(summary).toEqual({
      billedOre: 6700 + 5200 + 5700 + 5700,
      checkedOre: 6700 + 5200 + 5700,
      expectedOre: 5700 * 3,
      overOre: 1000,
      underOre: 500,
      match: 1, over: 1, under: 1, review: 1,
    });
  });

  it("picks the smallest weight band that covers the shipment", () => {
    const rates = [rate({ maxWeight: 10, baseOre: 9000 }), rate({ maxWeight: 2, baseOre: 3000 }), rate({ maxWeight: 5, baseOre: 5000 })];
    const report = runAudit([line({ weight: 2 }), line({ shipment: "S2", weight: 2.1 }), line({ shipment: "S3", weight: 7 })], rates);
    expect(report.lines.map((item) => item.rate?.baseOre)).toEqual([3000, 5000, 9000]);
  });

  it("matches rate service names through synonyms", () => {
    const report = runAudit([line({ service: "parcelshop" })], [rate({ service: "Pakkeshop" })]);
    expect(report.lines[0].status).toBe("match");
  });

  it("only uses rates valid on the shipment date", () => {
    const rates = [
      rate({ from: "2026-01-01", to: "2026-09-30", baseOre: 4000 }),
      rate({ from: "2026-10-01", to: "", baseOre: 5000 }),
    ];
    expect(runAudit([line()], rates).lines[0].rate?.baseOre).toBe(5000);
    expect(runAudit([line({ date: "2026-09-30" })], rates).lines[0].rate?.baseOre).toBe(4000);
    expect(runAudit([line({ date: "2025-12-31" })], rates).lines[0].status).toBe("review");
  });

  it("sends duplicates, credits, foreign lanes and missing rates to review", () => {
    const invoice = [
      line({ shipment: "DUP" }), line({ shipment: "DUP" }),
      line({ shipment: "CR", billedOre: -500 }),
      line({ shipment: "SE", destination: "SE" }),
      line({ shipment: "HEAVY", weight: 30 }),
    ];
    const report = runAudit(invoice, [rate()]);
    expect(report.lines.every((item) => item.status === "review")).toBe(true);
    expect(report.lines.every((item) => item.expectedOre === null && item.differenceOre === null)).toBe(true);
    expect(report.lines[0].reason).toMatch(/flere linjer/);
    expect(report.lines[2].reason).toMatch(/Kreditering/);
    expect(report.lines[3].reason).toMatch(/indenrigs/);
    expect(report.lines[4].reason).toMatch(/Ingen gyldig aftalepris/);
    expect(report.summary.review).toBe(5);
    expect(report.summary.checkedOre).toBe(0);
  });

  it("flags conflicting rates in the same band but accepts identical duplicates", () => {
    const conflict = runAudit([line()], [rate(), rate({ baseOre: 5100 })]);
    expect(conflict.lines[0].status).toBe("review");
    expect(conflict.lines[0].reason).toMatch(/Flere aftalepriser/);
    expect(runAudit([line()], [rate(), rate()]).lines[0].status).toBe("match");
  });

  it("numbers lines from 1 in invoice order", () => {
    const report = runAudit([line({ shipment: "A" }), line({ shipment: "B" })], [rate()]);
    expect(report.lines.map((item) => item.key)).toEqual(["1", "2"]);
  });
});

describe("benchmarkSamples", () => {
  it("keeps matched domestic parcel lines in a known weight band", () => {
    const invoice = [
      line({ shipment: "OK", weight: 1.5 }),
      line({ shipment: "OVER", billedOre: 9000 }),
      line({ shipment: "HEAVY", weight: 12 }),
      line({ shipment: "PALLET", service: "Palle" }),
    ];
    const rates = [rate({ maxWeight: 20 }), rate({ service: "Palle", maxWeight: 20 })];
    const samples = benchmarkSamples(runAudit(invoice, rates), "medium");
    expect(samples).toEqual([{ group: "DK|pakkeshop|0-2|medium", shipment: "OK", month: "2026-10", priceOre: 5700 }]);
  });
});

describe("schemas", () => {
  it("rejects a rate whose end date is before its start date", () => {
    expect(rateRowSchema.safeParse(rate({ from: "2026-10-01", to: "2026-09-01" })).success).toBe(false);
    expect(rateRowSchema.safeParse(rate({ from: "2026-10-01", to: "2026-10-01" })).success).toBe(true);
  });

  it("rejects impossible calendar dates", () => {
    const request = { name: "x", carrier: "GLS", invoice: [line({ date: "2026-02-30" })], rates: [rate()] };
    expect(auditRequestSchema.safeParse(request).success).toBe(false);
    expect(auditRequestSchema.safeParse({ ...request, invoice: [line()] }).success).toBe(true);
  });
});
