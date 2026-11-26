import { describe, expect, it } from "vitest";
import { acceptIssue, canAccept, nextIssue, NOT_PRINTED, reviewIssues, type GridDraft, type ReviewDrafts } from "./reviewIssues.ts";

const grid = (patch: Partial<GridDraft> = {}): GridDraft => ({
  name: "Distribution Danmark", category: "", unit: "pr. palleplads", currency: "DKK", rowLabel: "", note: "",
  columns: [{ label: "Zone A", detail: "" }, { label: "Zone B", detail: "" }],
  rows: [{ label: "1 palleplads", cells: ["214,31", "290,27"] }, { label: "2-3 pallepladser", cells: ["184,81", "abc"] }],
  minimum: [], maximum: [], unprinted: ["0:1"], issues: [],
  ...patch,
});

const drafts = (patch: Partial<ReviewDrafts> = {}): ReviewDrafts => ({
  carrier: "Frode Laursen", from: "2026-01-01", to: "2026-12-31",
  rates: [{ service: "Pakkeshop", zone: "", weight: "5", base: "46,00", fuel: "", fixed: "", issues: ["Prisen står ikke ordret i PDF'en."] }],
  items: [{ category: "Lager", description: "Indlagring", unit: "pr. palle", price: "30,68", currency: "DKK", note: "", issues: [] }],
  grids: [grid()],
  surcharges: [{ label: "Olietillæg", kind: "percent", value: "", unit: "", scope: "", note: "", issues: [] }],
  conditions: [{ text: "Bøder accepteres ikke.", printed: false }],
  ...patch,
});

describe("review issues", () => {
  it("lists every flagged or invalid value in screen order, with what is wrong", () => {
    const issues = reviewIssues(drafts());
    expect(issues.map((issue) => [issue.key, issue.blocking])).toEqual([
      ["rate:0", false],
      ["grid:0:0:1", false],
      ["grid:0:1:1", true],
      ["surcharge:0", true],
      ["condition:0", false],
    ]);
    expect(issues[1]).toMatchObject({ where: "Distribution Danmark, 1 palleplads, Zone B", message: NOT_PRINTED });
    expect(issues[2].message).toBe("«abc» er ikke et tal.");
  });

  it("names a missing carrier and a reversed period", () => {
    const issues = reviewIssues(drafts({ carrier: " ", from: "2026-05-01", to: "2026-01-01", rates: [], grids: [], surcharges: [], conditions: [] }));
    expect(issues.map((issue) => issue.key)).toEqual(["carrier", "to"]);
    expect(canAccept(issues[0])).toBe(false);
  });

  it("accepting a yellow flag clears only that flag", () => {
    const base = drafts();
    expect(acceptIssue(base, "grid:0:0:1").grids?.[0].unprinted).toEqual([]);
    expect(acceptIssue(base, "rate:0").rates?.[0].issues).toEqual([]);
    expect(acceptIssue(base, "condition:0").conditions?.[0].printed).toBe(true);
    const after = reviewIssues({ ...base, ...acceptIssue(base, "rate:0") });
    expect(after.some((issue) => issue.key === "rate:0")).toBe(false);
  });

  it("moves on from a fixed issue to the one after it, wrapping at the end", () => {
    const issues = reviewIssues(drafts());
    const order = issues.map((issue) => issue.key);
    expect(nextIssue(issues, null)?.key).toBe("rate:0");
    expect(nextIssue(issues, "condition:0")?.key).toBe("rate:0");
    expect(nextIssue(issues, "rate:0", -1)?.key).toBe("condition:0");
    const fixed = issues.filter((issue) => issue.key !== "grid:0:1:1");
    expect(nextIssue(fixed, "grid:0:1:1", 1, order)?.key).toBe("surcharge:0");
    expect(nextIssue([], "rate:0")).toBeNull();
  });
});
