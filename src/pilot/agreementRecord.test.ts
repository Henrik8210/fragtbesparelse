import { beforeEach, describe, expect, it } from "vitest";
import {
  agreementCreateSchema, browserAgreementInput, editedPriceCount, extractOriginalRows, newRecord, patchRecord, recordToAgreement,
} from "./agreementRecord.ts";
import type { AgreementExtract } from "./agreementExtract.ts";
import { loadAgreements, saveAgreements, type Agreement } from "./agreements.ts";
import type { RateRow } from "./freight.ts";

const row: RateRow = { service: "Pakkeshop", maxWeight: 5, baseOre: 4600, fuelPct: 0, fixedOre: 0, from: "", to: "" };
const by = { id: "u1", name: "Henrik" };

describe("agreement records", () => {
  it("marks a record changed when the saved rows differ from what was read", () => {
    const base = agreementCreateSchema.parse({ name: "", carrier: "GLS", rows: [row] });
    expect(newRecord(base, "nordhavn-living", by, null)).toMatchObject({ name: "GLS", changed: false, original: { rates: [row], items: [] }, formatVersion: 2 });
    const edited = newRecord({ ...base, original: [{ ...row, baseOre: 4700 }] }, "nordhavn-living", by, null);
    expect(edited.changed).toBe(true);
  });

  it("records who changed which fields, and returns the same record for a no-op", () => {
    const record = newRecord(agreementCreateSchema.parse({ name: "A", rows: [row] }), "x", by, null);
    expect(patchRecord(record, { name: "A", rows: [row] }, by)).toBe(record);
    const next = patchRecord(record, { carrier: "DAO", rows: [{ ...row, baseOre: 1 }] }, { id: "u2", name: "Jesper" });
    expect(next.history).toEqual([{ at: next.updatedAt, by: "u2", name: "Jesper", fields: ["carrier", "rows"] }]);
    expect(next.changed).toBe(true);
    expect(patchRecord(next, { rows: [row] }, by).changed).toBe(false);
    expect(() => patchRecord(record, { from: "2027-02-01", to: "2027-01-01" }, by)).toThrow(/Slutdatoen/);
  });

  it("rejects bad rows and reversed dates on create", () => {
    expect(agreementCreateSchema.safeParse({ rows: [] }).success).toBe(false);
    expect(agreementCreateSchema.safeParse({ rows: [], terms: { conditions: ["Fakturering månedsvis."] } }).success).toBe(true);
    expect(agreementCreateSchema.safeParse({ rows: [], terms: { surcharges: [{ label: "ETS", kind: "percent", value: null }] } }).success).toBe(false);
    expect(agreementCreateSchema.safeParse({ rows: [{ ...row, maxWeight: 0 }] }).success).toBe(false);
    expect(agreementCreateSchema.safeParse({ rows: [row], from: "2027-02-01", to: "2027-01-01" }).success).toBe(false);
  });

  it("keeps the extract's rows as the original, zone included", () => {
    const extract = {
      validFrom: "2027-01-01", validTo: "",
      rates: [{ service: "Pakkeshop", zone: "Zone 2", maxWeight: 0, baseOre: 4800, fuelPct: 9, fixedOre: 0, issues: ["Vægttrin mangler."] }],
    } as unknown as AgreementExtract;
    expect(extractOriginalRows(extract)).toEqual([{ service: "Pakkeshop Zone 2", maxWeight: 0, baseOre: 4800, fuelPct: 9, fixedOre: 0, from: "2027-01-01", to: "" }]);
  });

  it("turns a record back into the agreement the screens use", () => {
    const record = newRecord(agreementCreateSchema.parse({ id: "abcdefgh-1", name: "A", rows: [row], ended: "2027-01-01T00:00:00.000Z" }), "x", by, null);
    expect(recordToAgreement(record)).toMatchObject({ id: "abcdefgh-1", orgId: "x", sample: false, ended: "2027-01-01T00:00:00.000Z", createdByName: "Henrik" });
  });
});

describe("browser agreements", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    globalThis.localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    } as Storage;
  });

  it("converts a stored agreement into an import with its id and date", () => {
    const local: Agreement = { id: "0f6c2b1e-1111-4222-8333-944445555666", orgId: "x", name: "Gammel", carrier: "GLS", from: "", to: "", rows: [row], createdAt: "2026-05-01T00:00:00.000Z", sample: false };
    expect(browserAgreementInput(local)).toMatchObject({ id: local.id, source: "browser", createdAt: local.createdAt, ended: null });
    expect(browserAgreementInput({ ...local, rows: [] })).toBeNull();
    const terms = { items: [], grids: [], surcharges: [], conditions: ["Fakturering månedsvis bagud."] };
    expect(browserAgreementInput({ ...local, rows: [], terms })).toMatchObject({ rows: [], terms });
  });

  it("removes the localStorage key once nothing is left", () => {
    saveAgreements([{ id: "a", orgId: "x", name: "", carrier: "", from: "", to: "", rows: [row], createdAt: "", sample: false }]);
    expect(loadAgreements()).toHaveLength(1);
    saveAgreements([]);
    expect(store.has("freightlytics-agreements")).toBe(false);
  });
});

describe("edited prices", () => {
  it("counts changed rates, items, grid cells and surcharges against what was read", () => {
    const grid = {
      name: "G", category: "", unit: "", currency: "DKK", rowLabel: "", note: "",
      columns: [{ label: "A", detail: "" }, { label: "B", detail: "" }],
      rows: [{ label: "1", cells: [1, 2] }, { label: "2", cells: [3, 4] }], minimum: [1, 2], maximum: [],
    };
    const terms = { items: [], grids: [grid], surcharges: [], conditions: [] };
    const base = newRecord(agreementCreateSchema.parse({ name: "A", rows: [row], terms }), "x", by, null);
    expect(editedPriceCount(base)).toBe(0);
    const edited = { ...grid, rows: [{ label: "1", cells: [1, 5] }, { label: "2", cells: [3, 6] }], minimum: [1, 9] };
    expect(editedPriceCount({ ...base, rows: [{ ...row, baseOre: 1 }, row], terms: { ...terms, grids: [edited] } })).toBe(2 + 3);
  });
});
