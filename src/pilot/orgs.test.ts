import { describe, expect, it } from "vitest";
import { knownCarrier } from "../data/carriers";
import { ORGS, SAMPLE_COVERAGE, orgAudit, orgById, orgFromCompany, orgRateRows } from "./orgs";

const SAMPLE_IDS = ["nordhavn-living", "vesterbro-cloth", "kolding-table-co", "horsens-gearworks", "skive-plate-works", "esbjerg-rig-supply"];

describe("sample organizations", () => {
  it("are the six sample companies in order", () => {
    expect(ORGS.map((org) => org.id)).toEqual(SAMPLE_IDS);
    expect(Object.keys(SAMPLE_COVERAGE).sort()).toEqual([...SAMPLE_IDS].sort());
  });

  it("each use a carrier from the profile index", () => {
    for (const org of ORGS) expect(knownCarrier(org.carrier), org.id).toBe(true);
  });

  it.each(ORGS.map((org) => [org.id, org] as const))("%s: October invoice and rate file import and audit", (_id, org) => {
    const report = orgAudit(org);
    expect(report.lines.length).toBeGreaterThan(0);
    expect(orgRateRows(org).length).toBeGreaterThan(0);
    expect(report.lines.every((line) => line.date.startsWith("2026-10"))).toBe(true);
    const { summary } = report;
    expect(summary.match + summary.over + summary.under + summary.review).toBe(report.lines.length);
    expect(summary.billedOre).toBe(report.lines.reduce((sum, line) => sum + line.billedOre, 0));
  });

  it("finds at least one overcharge across the sample set", () => {
    expect(ORGS.some((org) => orgAudit(org).summary.overOre > 0)).toBe(true);
  });

  it("gives a created organization an empty check", () => {
    const org = orgFromCompany({ id: "ny-kunde", name: "Ny kunde" });
    expect(orgAudit(org).lines).toEqual([]);
    expect(orgRateRows(org)).toEqual([]);
  });

  it("falls back to the first sample company for an unknown id", () => {
    expect(orgById("missing").id).toBe("nordhavn-living");
  });
});
