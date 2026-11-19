import { describe, expect, it } from "vitest";
import { heldOre, lostPartIssues, partCaptured, partShort, printedOre, readParts } from "./agreementParts.ts";

describe("part checks", () => {
  it("finds the prices a reply holds, however the model wrote them", () => {
    const reply = { response: { grids: [{ rows: [{ cells: [1234.56, "1.007,01", "98,70"] }] }], items: [{ price: "30.68" }] } };
    expect([...heldOre(reply)].sort((a, b) => a - b)).toEqual([3068, 9870, 100701, 123456]);
    expect(partCaptured(reply, [...printedOre("1.234,56  1.007,01  12,00")])).toBe(2);
    expect(partCaptured(null, [100])).toBe(0);
  });

  it("judges a part short only when it has enough prices to judge", () => {
    expect(partShort(3, 20)).toBe(true);
    expect(partShort(15, 20)).toBe(false);
    expect(partShort(0, 4)).toBe(false);
  });

  it("names the pages that were still not read", () => {
    expect(lostPartIssues([
      { pages: [4, 6], expected: 153, captured: 12, retried: true, failed: false },
      { pages: [9, 9], expected: 30, captured: 0, retried: true, failed: true },
      { pages: [10, 11], expected: 40, captured: 39, retried: false, failed: false },
    ])).toEqual([
      "Side 4–6 blev kun delvist læst (12 af 153 priser), også ved andet forsøg. Tjek priserne derfra.",
      "Side 9 kunne ikke læses, heller ikke ved andet forsøg. Priserne derfra mangler.",
    ]);
  });

  it("keeps the first reading when the halves hold less", async () => {
    const prices = [...printedOre(Array.from({ length: 10 }, (_, at) => `${at + 1},50`).join(" "))];
    const full = { response: { items: prices.slice(0, 5).map((price) => ({ price: price / 100 })) } };
    const { outputs, reports } = await readParts(async (inputs) => inputs === "half" ? { response: { items: [] } } : full,
      ["whole"], [{ pages: [1, 1], prices, halves: ["half", "half"] }], { concurrency: 1, timeoutMs: 1000 });
    expect(outputs).toEqual([full]);
    expect(reports[0]).toMatchObject({ retried: true, captured: 5, expected: 10 });
  });
});
