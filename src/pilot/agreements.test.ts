import { describe, expect, it } from "vitest";
import { agreementFromCsv, agreementState, sampleAgreement, splitAgreements, type Agreement } from "./agreements.ts";
import { orgRateRows, ORGS } from "./orgs.ts";

function agreement(fields: Partial<Agreement>): Agreement {
  return {
    id: crypto.randomUUID(), orgId: "nordhavn-living", name: "Aftale", carrier: "GLS", from: "", to: "",
    rows: [], createdAt: "2026-01-01T00:00:00.000Z", sample: false, ...fields,
  };
}

describe("agreementState", () => {
  it("keeps a running agreement active and moves an expired one to historic", () => {
    const running = agreement({ from: "2026-10-01", to: "2026-12-31" });
    const expired = agreement({ from: "2025-01-01", to: "2025-12-31" });
    expect(agreementState(running, [running, expired], "2026-11-19")).toBe("active");
    expect(agreementState(expired, [running, expired], "2026-11-19")).toBe("historic");
  });

  it("treats an older agreement with the same carrier as replaced once the newer one starts", () => {
    const old = agreement({ carrier: "GLS", from: "2026-01-01" });
    const next = agreement({ carrier: "gls ", from: "2026-11-01" });
    const later = agreement({ carrier: "GLS", from: "2027-01-01" });
    const other = agreement({ carrier: "PostNord", from: "2025-06-01" });
    const all = [old, next, later, other];
    expect(agreementState(old, all, "2026-11-19")).toBe("historic");
    expect(agreementState(next, all, "2026-11-19")).toBe("active");
    expect(agreementState(later, all, "2026-11-19")).toBe("active");
    expect(agreementState(other, all, "2026-11-19")).toBe("active");
  });

  it("moves an agreement ended by hand to historic", () => {
    const ended = agreement({ ended: "2026-11-02T10:00:00.000Z" });
    expect(splitAgreements([ended], "2026-11-19")).toEqual({ active: [], historic: [ended] });
  });
});

describe("sampleAgreement", () => {
  it("spans the sample rate rows and is active in November 2026", () => {
    const org = ORGS[0];
    const sample = sampleAgreement(org.id, org.carrier, orgRateRows(org));
    expect(sample?.from).toBe("2026-10-01");
    expect(sample?.to).toBe("2026-12-31");
    expect(sample && agreementState(sample, [sample], "2026-11-19")).toBe("active");
  });
});

describe("agreementFromCsv", () => {
  it("reads a rate file and fills the validity from the rows", () => {
    const made = agreementFromCsv(
      "service;maks_kg;grundpris_dkk;braendstof_pct;fast_tillaeg_dkk;gyldig_fra;gyldig_til\nPakkeshop;2;32,00;10;0,00;2026-11-01;2027-10-31\n",
      { orgId: "nordhavn-living", name: "", carrier: "GLS", from: "", to: "" },
    );
    expect(made).toMatchObject({ name: "GLS", carrier: "GLS", from: "2026-11-01", to: "2027-10-31", sample: false });
    expect(made.rows[0]).toMatchObject({ service: "Pakkeshop", maxWeight: 2, baseOre: 3200, fuelPct: 10 });
  });

  it("applies typed dates to rows without their own and rejects a reversed period", () => {
    const csv = "service;maks_kg;grundpris_dkk\nPakkeshop;2;32\n";
    const made = agreementFromCsv(csv, { orgId: "x", name: "Ny", carrier: "", from: "2026-12-01", to: "" });
    expect(made.rows[0]).toMatchObject({ from: "2026-12-01", to: "" });
    expect(() => agreementFromCsv(csv, { orgId: "x", name: "Ny", carrier: "", from: "2026-12-01", to: "2026-01-01" })).toThrow(/Slutdatoen/);
  });

  it("names the missing columns", () => {
    expect(() => agreementFromCsv("a;b\n1;2\n", { orgId: "x", name: "", carrier: "", from: "", to: "" })).toThrow(/mangler kolonnerne/);
  });
});
