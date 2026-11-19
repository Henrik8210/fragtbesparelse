import { describe, expect, it } from "vitest";
import { agreementFromExtract, agreementName, reviewReasons } from "./agreementAuto.ts";
import { validateAgreementExtract } from "./agreementExtract.ts";

const TEXT = `Prisaftale Nordfragt
Gyldig fra 01.01.2027 til 31.12.2027
Lager
Lagerleje pr. uge  31,50  DKK
Pluk pr. kolli  1,75  DKK`;

const extract = (extra: Record<string, unknown> = {}) => validateAgreementExtract([{
  carrier: "Nordfragt", title: "", validFrom: "01.01.2027", validTo: "31.12.2027", currency: "DKK",
  rates: [], grids: [], surcharges: [], conditions: [],
  items: [
    { category: "Lager", description: "Lagerleje", unit: "pr. uge", price: "31,50", currency: "DKK", note: "" },
    { category: "Lager", description: "Pluk", unit: "pr. kolli", price: "1,75", currency: "DKK", note: "" },
  ],
  ...extra,
}], TEXT, { sha256: "a".repeat(64), filename: "aftale.pdf" });

describe("agreementName", () => {
  it("is the carrier and the validity", () => {
    expect(agreementName("Nordfragt", "2027-01-01", "2027-12-31")).toBe("Nordfragt 01.01.2027–31.12.2027");
    expect(agreementName("Nordfragt", "2027-01-01", "")).toBe("Nordfragt fra 01.01.2027");
    expect(agreementName("", "", "")).toBe("Prisaftale");
  });
});

describe("reviewReasons", () => {
  it("is empty when carrier, dates and every price were read", () => {
    const read = extract();
    expect(read.coverage).toEqual({ printed: 2, captured: 2 });
    expect(reviewReasons(read)).toEqual([]);
    const agreement = agreementFromExtract(read, "nordhavn-living");
    expect(agreement).toMatchObject({ name: "Nordfragt 01.01.2027–31.12.2027", carrier: "Nordfragt", from: "2027-01-01", to: "2027-12-31" });
    expect(agreement.terms?.items).toHaveLength(2);
  });

  it("names what could not be read", () => {
    expect(reviewReasons(extract({ carrier: "", validTo: "" }))).toEqual(["Transportøren stod ikke i PDF'en.", "Slutdatoen stod ikke i PDF'en."]);
    const wrong = extract({ items: [{ category: "Lager", description: "Lagerleje", unit: "pr. uge", price: "39,50", currency: "DKK", note: "" }] });
    expect(reviewReasons(wrong).join(" ")).toMatch(/skal tjekkes/);
  });
});
