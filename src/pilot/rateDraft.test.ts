import { describe, expect, it } from "vitest";
import { fromRate, rateProblem, rateProblemText, type RateDraft } from "./rateDraft.ts";

const draft = (patch: Partial<RateDraft> = {}): RateDraft => ({
  service: "Pakkeshop", zone: "Zone 2", weight: "5", base: "41,25", fuel: "9", fixed: "", issues: [], ...patch,
});

describe("rateProblem", () => {
  it("accepts a filled row, and a row with flags", () => {
    expect(rateProblem(draft())).toBeNull();
    expect(rateProblem(draft({ issues: ["Prisen står ikke ordret i PDF'en."] }))).toBeNull();
    expect(fromRate(draft({ base: "1.733,57" }))).toMatchObject({ maxWeight: 5, baseOre: 173357, fuelPct: 9, fixedOre: 0 });
  });

  it("names the row and the field that blocks saving", () => {
    const empty = draft({ weight: "" });
    const found = rateProblem(empty);
    expect(found?.field).toBe("weight");
    expect(rateProblemText(empty, 2, found!)).toMatch(/^Pakkepris 3 \(Pakkeshop, Zone 2\): Maks\. kg mangler\./);
    expect(rateProblem(draft({ weight: "tre" }))?.message).toBe("Maks. kg «tre» er ikke et tal mellem 0 og 1000.");
    expect(rateProblem(draft({ base: "" }))?.field).toBe("base");
    expect(rateProblem(draft({ fuel: "400" }))?.field).toBe("fuel");
    expect(rateProblem(draft({ fixed: "abc" }))?.field).toBe("fixed");
    expect(rateProblem(draft({ service: " " }))?.field).toBe("service");
    expect(fromRate(empty)).toBeNull();
  });
});
