import { describe, expect, it } from "vitest";
import { carrierFromMail, carrierInDocument } from "./carrierName.ts";

describe("carrierInDocument", () => {
  it("reads the label on the Nordhavn test invoice text", () => {
    expect(carrierInDocument("Fakturanr: NL-2026-001\nTransportor: PostNord\nPeriode: Oktober 2026")).toBe("PostNord");
  });

  it("prefers a labeled line, then the carrier named first", () => {
    expect(carrierInDocument("Leveret til GLS pakkeshop\nTransportør: DHL Express")).toBe("DHL");
    expect(carrierInDocument("Bring Parcels AB\nLeveret til GLS pakkeshop")).toBe("Bring");
    expect(carrierInDocument("Faktura 12\nI alt 100 kr")).toBe("");
  });
});

describe("carrierFromMail", () => {
  it("uses the sender, subject and file names before the PDF text", () => {
    expect(carrierFromMail({ sender: "faktura@gls.dk", subject: "Faktura", files: [{ filename: "a.pdf", carrier: "PostNord" }] })).toBe("GLS");
    expect(carrierFromMail({ sender: "Henrik <h@example.com>", subject: "Test", files: [{ filename: "nordhavn-living-testfaktura.pdf", carrier: "PostNord" }] })).toBe("PostNord");
    expect(carrierFromMail({ sender: "h@example.com", subject: "Test", files: [{ filename: "a.pdf" }] })).toBe("");
    expect(carrierFromMail({ sender: "Uploadet af Henrik", subject: "", files: [{ filename: "frode-laursen-faktura-test-2026.pdf" }] })).toBe("Frode Laursen");
    expect(carrierInDocument("Frode Laursen A/S\nLagerhotel Vejle")).toBe("Frode Laursen");
  });
});
