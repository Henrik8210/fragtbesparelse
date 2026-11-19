import { describe, expect, it } from "vitest";
import { carrierProfile, carrierProfiles, knownCarrier } from "./carriers";

const CARRIERS = ["GLS", "DHL", "PostNord", "Danske Fragtmænd", "DSV", "Bring", "DAO", "UPS", "Schenker"];

describe("carrier index", () => {
  it("lists the nine named carriers once each", () => {
    expect(carrierProfiles.map((profile) => profile.name)).toEqual(CARRIERS);
  });

  it("recognises carriers by exact name only", () => {
    for (const name of CARRIERS) expect(knownCarrier(name)).toBe(true);
    expect(knownCarrier("gls")).toBe(false);
    expect(knownCarrier("Danske Fragtmaend")).toBe(false);
    expect(knownCarrier("")).toBe(false);
    expect(knownCarrier("FedEx")).toBe(false);
  });

  it("returns a one-line shape note per carrier", () => {
    expect(carrierProfile("DSV")?.shape).toMatch(/fuel/);
    expect(carrierProfile("Unknown")).toBeUndefined();
    for (const profile of carrierProfiles) expect(profile.shape).not.toContain("\n");
  });
});
