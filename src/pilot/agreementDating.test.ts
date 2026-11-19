import { describe, expect, it } from "vitest";
import { datedAudit, lastValidDay, matchDate, matchInvoice, periodLabel, type DatedAgreement } from "./agreementDating.ts";
import type { InvoiceRow, RateRow } from "./freight.ts";

const rate = (baseOre: number, from = "", to = ""): RateRow => ({ service: "Pakkeshop", maxWeight: 5, baseOre, fuelPct: 0, fixedOre: 0, from, to });
const agreement = (id: string, from: string, to: string, baseOre: number, extra: Partial<DatedAgreement> = {}): DatedAgreement => ({
  id, name: id, carrier: "GLS", from, to, rows: [rate(baseOre, from, to)], ...extra,
});
const line = (shipment: string, date: string, billedOre: number): InvoiceRow => ({
  shipment, date, service: "Pakkeshop", weight: 2, billedOre, origin: "DK", destination: "DK",
});

const y2025 = agreement("a2025", "2025-01-01", "2025-12-31", 4000);
const y2026 = agreement("a2026", "2026-01-01", "2026-12-31", 4500);

describe("agreement valid on a date", () => {
  it("includes the first and the last day, and nothing outside", () => {
    expect(matchDate([y2025], "2025-01-01")).toMatchObject({ kind: "matched", agreementId: "a2025" });
    expect(matchDate([y2025], "2025-12-31")).toMatchObject({ kind: "matched", agreementId: "a2025" });
    expect(matchDate([y2025], "2024-12-31")).toMatchObject({ kind: "none", reason: "before-first" });
    expect(matchDate([y2025], "2026-01-01")).toMatchObject({ kind: "none", reason: "after-last" });
  });

  it("treats an empty start or end as open", () => {
    const open = agreement("open", "", "", 4000);
    expect(matchDate([open], "1999-05-05")).toMatchObject({ kind: "matched", agreementId: "open" });
    expect(matchDate([agreement("tail", "2026-01-01", "", 1)], "2040-01-01")).toMatchObject({ kind: "matched" });
  });

  it("stops on the day an agreement was ended by hand", () => {
    const ended = { ...y2026, ended: "2026-06-30T10:00:00.000Z" };
    expect(lastValidDay(ended)).toBe("2026-06-30");
    expect(matchDate([ended], "2026-06-30")).toMatchObject({ kind: "matched" });
    expect(matchDate([ended], "2026-07-01")).toMatchObject({ kind: "none", reason: "after-last" });
    expect(lastValidDay({ ...y2025, ended: "2026-03-01T00:00:00.000Z" })).toBe("2025-12-31");
  });

  it("picks the latest start when agreements overlap, and flags it", () => {
    const amendment = agreement("tillaeg", "2026-07-01", "2026-12-31", 4700);
    expect(matchDate([y2026, amendment], "2026-08-01")).toEqual({
      kind: "matched", date: "2026-08-01", agreementId: "tillaeg", overlap: ["a2026"], manual: false,
    });
    expect(matchDate([y2026, amendment], "2026-03-01")).toMatchObject({ agreementId: "a2026", overlap: [] });
  });

  it("tells a gap, a date before the first agreement and one after the newest apart", () => {
    const pool = [y2025, agreement("a2026b", "2026-03-01", "2026-12-31", 4500)];
    expect(matchDate(pool, "2026-02-01")).toMatchObject({ reason: "gap" });
    expect(matchDate(pool, "2024-06-01")).toMatchObject({ reason: "before-first" });
    expect(matchDate(pool, "2027-01-02")).toMatchObject({ reason: "after-last" });
    expect(matchDate([], "2026-01-01")).toMatchObject({ reason: "no-agreement" });
    expect(matchDate(pool, "")).toMatchObject({ reason: "no-date" });
  });

  it("is never after the newest when that one is open-ended", () => {
    const pool = [y2025, agreement("open2026", "2026-03-01", "", 4500)];
    expect(matchDate(pool, "2026-02-01")).toMatchObject({ reason: "gap" });
  });
});

describe("matching an invoice", () => {
  it("uses only agreements for the invoice's carrier, historic ones included", () => {
    const dao = agreement("dao", "2025-01-01", "2026-12-31", 9900, { carrier: "DAO" });
    const match = matchInvoice([line("1", "2025-06-01", 4000)], { carrier: "GLS Denmark A/S", agreements: [dao, y2025, y2026] });
    expect(match.used).toEqual([{ agreementId: "a2025", lines: 1 }]);
  });

  it("skips agreements without parcel prices", () => {
    const terms = agreement("3pl", "2025-01-01", "2026-12-31", 0, { rows: [] });
    expect(matchInvoice([line("1", "2025-06-01", 4000)], { carrier: "GLS", agreements: [terms] }).missing).toEqual({ "no-agreement": 1 });
  });

  it("falls back to the invoice date for a line without one", () => {
    const match = matchInvoice([{ date: "" }], { invoiceDate: "2026-02-02", carrier: "GLS", agreements: [y2025, y2026] });
    expect(match.lines[0]).toMatchObject({ kind: "matched", date: "2026-02-02", agreementId: "a2026" });
  });

  it("splits an invoice across two agreement periods line by line", () => {
    const invoice = [line("1", "2025-12-30", 4000), line("2", "2026-01-02", 4500), line("3", "2025-12-31", 4100)];
    const match = matchInvoice(invoice, { carrier: "GLS", agreements: [y2025, y2026] });
    expect(match.used).toEqual([{ agreementId: "a2025", lines: 2 }, { agreementId: "a2026", lines: 1 }]);
    const report = datedAudit(invoice, match, [y2025, y2026]);
    expect(report.lines.map((item) => [item.key, item.status, item.expectedOre])).toEqual([
      ["1", "match", 4000], ["2", "match", 4500], ["3", "over", 4000],
    ]);
    expect(report.summary).toMatchObject({ match: 2, over: 1, overOre: 100, checkedOre: 12600, expectedOre: 12500 });
  });

  it("holds an invoice dated after the newest agreement, and matches it again once one is added", () => {
    const invoice = [line("1", "2026-12-31", 4500), line("2", "2027-01-05", 4500)];
    const held = matchInvoice(invoice, { carrier: "GLS", agreements: [y2025, y2026] });
    expect(held).toMatchObject({ held: true, lastEnd: "2026-12-31", missing: { "after-last": 1 } });
    expect(() => datedAudit(invoice, held, [y2025, y2026])).toThrow(/Tilføj prisaftalen/);
    const y2027 = agreement("a2027", "2027-01-01", "2027-12-31", 4500);
    const again = matchInvoice(invoice, { carrier: "GLS", agreements: [y2025, y2026, y2027] });
    expect(again.held).toBe(false);
    expect(datedAudit(invoice, again, [y2025, y2026, y2027]).summary.match).toBe(2);
  });

  it("leaves lines without an agreement for review and does not compare them", () => {
    const invoice = [line("1", "2024-06-01", 9999), line("2", "2025-06-01", 4000)];
    const match = matchInvoice(invoice, { carrier: "GLS", agreements: [y2025, y2026] });
    expect(match).toMatchObject({ held: false, missing: { "before-first": 1 } });
    const report = datedAudit(invoice, match, [y2025, y2026]);
    expect(report.lines[0]).toMatchObject({ status: "review", expectedOre: null, reason: expect.stringContaining("før den første") });
    expect(report.summary).toMatchObject({ review: 1, match: 1, checkedOre: 4000, billedOre: 13999 });
  });

  it("prices every line against a manual choice, outside its own period too", () => {
    const invoice = [line("1", "2027-02-01", 4500), line("2", "2025-06-01", 4500)];
    const match = matchInvoice(invoice, { carrier: "GLS", agreements: [y2025, y2026], override: "a2026" });
    expect(match).toMatchObject({ held: false, override: "a2026", used: [{ agreementId: "a2026", lines: 2 }] });
    expect(datedAudit(invoice, match, [y2025, y2026]).summary.match).toBe(2);
  });

  it("ignores a manual choice that no longer exists", () => {
    const match = matchInvoice([line("1", "2025-06-01", 4000)], { carrier: "GLS", agreements: [y2025], override: "gone" });
    expect(match).toMatchObject({ override: null, used: [{ agreementId: "a2025", lines: 1 }] });
  });

  it("flags a shipment number repeated across two periods", () => {
    const invoice = [line("7", "2025-12-31", 4000), line("7", "2026-01-01", 4500)];
    const report = datedAudit(invoice, matchInvoice(invoice, { carrier: "GLS", agreements: [y2025, y2026] }), [y2025, y2026]);
    expect(report.lines.map((item) => item.status)).toEqual(["review", "review"]);
  });

  it("labels the period", () => {
    expect(periodLabel(y2025)).toBe("1. jan. 2025 – 31. dec. 2025");
    expect(periodLabel(agreement("x", "2026-01-01", "", 1))).toBe("1. jan. 2026 – løbende");
  });
});
