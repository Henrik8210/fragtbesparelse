import { describe, expect, it } from "vitest";
import {
  assessDocument, compareLayout, editedLineCount, emptyProfile, layoutFingerprint, learnLayout, normalizeLabel, signalReasons,
  stableHash, type ExtractSignals,
} from "./formatDrift.ts";

const quiet: ExtractSignals = { lines: 3, unanchored: 0, unmapped: [], mismatchOre: null, lowConfidence: false, edited: null };

/** A GLS-style invoice in the layout the team already knows. Customer, numbers and amounts vary. */
function oldLayout(customer: string, number: number, amounts: string[]): string {
  return [
    "GLS Denmark A/S",
    `Kunde: ${customer}`,
    `Fakturanr: GLS-${number}`,
    "Fakturadato: 01.11.2026",
    "Forfaldsdato: 15.11.2026",
    "Forsendelser",
    "Dato  Pakkenr.  Produkt  Vægt  Zone  Beløb",
    ...amounts.map((amount, index) => `0${index + 1}.10.2026  ${number}0${index}  BusinessParcel  ${index + 2} kg  DK  ${amount} kr`),
    "Brændstoftillæg  18,50 kr",
    "Subtotal  223,50 kr",
    "Moms 25%  55,88 kr",
    "I alt  279,38 kr",
    "Betalingsbetingelser",
    "Tak fordi du valgte GLS",
  ].join("\n");
}

/** Same carrier after a redesign: new column names, a new section and an energy surcharge per line. */
function newLayout(customer: string, number: number): string {
  return [
    "GLS Denmark A/S",
    `Customer account: ${customer}`,
    `Invoice no.: G${number}`,
    "Issue date: 2026-11-01",
    "Shipment overview",
    "Track ID  Service level  Billable weight  Destination  Energy fee  Net amount",
    `G${number}1  EuroBusinessParcel  3 kg  SE  4,10  85,00`,
    `G${number}2  EuroBusinessParcel  7 kg  NO  4,10  120,00`,
    "Climate compensation  2,00",
    "Total excl. VAT  215,20",
    "VAT  53,80",
    "Amount due  269,00",
    "Questions about your invoice",
  ].join("\n");
}

const vocab = ["BusinessParcel", "Brændstoftillæg"];

describe("layoutFingerprint", () => {
  it("keeps labels and drops numbers, dates and amounts", () => {
    const tokens = layoutFingerprint(oldLayout("Nordhavn Living", 4411, ["85,00", "120,00"]), vocab).tokens;
    expect(tokens).toContain("k:fakturanr");
    expect(tokens).toContain("t:pakkenr");
    expect(tokens).toContain("t:beløb");
    expect(tokens).toContain("l:i alt");
    expect(tokens).toContain("v:businessparcel");
    expect(tokens.some((token) => /\d/.test(token))).toBe(false);
  });

  it("gives the same labels for two invoices in one layout", () => {
    const first = layoutFingerprint(oldLayout("Nordhavn Living", 4411, ["85,00", "120,00"]), vocab);
    const second = layoutFingerprint(oldLayout("Nordhavn Living", 5120, ["99,00", "12,00", "40,00"]), vocab);
    expect(second.tokens).toEqual(first.tokens);
  });

  it("normalizes case and punctuation", () => {
    expect(normalizeLabel("  Vægt (kg) 12 ")).toBe("vægt kg");
  });
});

describe("assessDocument", () => {
  it("learns the first invoice quietly and accepts the same layout from another company", () => {
    const profile = emptyProfile("invoice", "GLS");
    expect(assessDocument(profile, { documentId: "a", fingerprint: layoutFingerprint(oldLayout("Nordhavn Living", 1, ["85,00"]), vocab), signals: quiet })).toBeNull();
    expect(assessDocument(profile, { documentId: "b", fingerprint: layoutFingerprint(oldLayout("Vesterbro Cloth", 2, ["10,00", "20,00"]), vocab), signals: quiet })).toBeNull();
    expect(assessDocument(profile, { documentId: "c", fingerprint: layoutFingerprint(oldLayout("Kolding Table Co", 3, ["15,00"]), vocab), signals: quiet })).toBeNull();
    expect(profile.variants).toHaveLength(1);
    expect(profile.docs).toBe(3);
  });

  it("flags a redesign once and then treats that layout as known", () => {
    const profile = emptyProfile("invoice", "GLS");
    for (const [index, customer] of ["Nordhavn Living", "Vesterbro Cloth"].entries()) {
      assessDocument(profile, { documentId: `old-${index}`, fingerprint: layoutFingerprint(oldLayout(customer, index, ["85,00"]), vocab), signals: quiet });
    }
    const finding = assessDocument(profile, {
      documentId: "new-1",
      fingerprint: layoutFingerprint(newLayout("Nordhavn Living", 77), ["EuroBusinessParcel"]),
      signals: quiet,
    });
    expect(finding).toMatchObject({ kind: "invoice", carrier: "GLS", change: "layout" });
    expect(finding?.key).toBe(`layout:${finding?.variantId}`);
    expect(finding?.reasons.join("\n")).toMatch(/Nye felter: .*"/);
    expect(finding?.reasons.join("\n")).toMatch(/Mangler: .*"fakturanr"/);

    const next = assessDocument(profile, {
      documentId: "new-2",
      fingerprint: layoutFingerprint(newLayout("Esbjerg Rig Supply", 78), ["EuroBusinessParcel"]),
      signals: quiet,
    });
    expect(next).toBeNull();
    expect(profile.variants).toHaveLength(2);
    expect(compareLayout(profile, layoutFingerprint(oldLayout("Skive Plate Works", 9, ["1,00"]), vocab)).changed).toBe(false);
  });

  it("gives the same key when the same redesign reaches a fresh process", () => {
    const keys = [0, 1].map(() => {
      const profile = emptyProfile("invoice", "GLS");
      assessDocument(profile, { documentId: "old", fingerprint: layoutFingerprint(oldLayout("Nordhavn Living", 1, ["85,00"]), vocab), signals: quiet });
      return assessDocument(profile, { documentId: "new", fingerprint: layoutFingerprint(newLayout("Nordhavn Living", 2), []), signals: quiet })?.key;
    });
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  it("does not count the same document twice", () => {
    const profile = emptyProfile("invoice", "GLS");
    const fingerprint = layoutFingerprint(oldLayout("Nordhavn Living", 1, ["85,00"]), vocab);
    learnLayout(profile, fingerprint, "same");
    learnLayout(profile, fingerprint, "same");
    expect(profile.docs).toBe(1);
  });

  it("raises strong extractor signals once per layout and signal set", () => {
    const profile = emptyProfile("invoice", "PostNord");
    const fingerprint = layoutFingerprint(oldLayout("Nordhavn Living", 1, ["85,00"]), vocab);
    const signals = { ...quiet, lines: 4, unanchored: 3, mismatchOre: 1250, lowConfidence: true };
    const first = assessDocument(profile, { documentId: "x", fingerprint, signals });
    const second = assessDocument(profile, { documentId: "y", fingerprint, signals });
    expect(first?.change).toBe("signals");
    expect(first?.reasons).toEqual([
      "3 af 4 beløb står ikke ordret i dokumentet",
      "Linjerne summer ikke til totalen (forskel 12,50 kr.)",
      "Lav sikkerhed i udtrækket",
    ]);
    expect(second?.key).toBe(first?.key);
  });

  it("keeps agreement layouts apart from invoice layouts", () => {
    const invoice = emptyProfile("invoice", "GLS");
    const agreement = emptyProfile("agreement", "GLS");
    const fingerprint = layoutFingerprint(newLayout("Nordhavn Living", 1), []);
    expect(learnLayout(invoice, fingerprint, "a")).not.toBe(learnLayout(agreement, fingerprint, "a"));
  });
});

describe("signalReasons", () => {
  it("does not notify on low confidence alone", () => {
    expect(signalReasons({ ...quiet, lowConfidence: true }).strong).toEqual([]);
  });

  it("names unmapped fields and heavy edits", () => {
    const result = signalReasons({ ...quiet, lines: 6, unmapped: ["CO2 kg", "Kundenr. hos modtager", "Palleplads"], edited: 3 });
    expect(result.strong).toEqual(["unmapped", "edited"]);
    expect(result.reasons[0]).toBe('3 felter passede ikke i skemaet: "CO2 kg", "Kundenr. hos modtager", "Palleplads"');
    expect(result.reasons[1]).toBe("3 af 6 linjer rettet i Check faktura");
  });

  it("ignores a single edited or unanchored line", () => {
    expect(signalReasons({ ...quiet, lines: 3, unanchored: 1, edited: 1 }).strong).toEqual([]);
  });
});

it("counts edited lines, not edited fields", () => {
  expect(editedLineCount([{ line: 0 }, { line: 0 }, { line: 2 }])).toBe(2);
});

it("hashes stably", () => {
  expect(stableHash("GLS")).toBe(stableHash("GLS"));
  expect(stableHash("GLS")).not.toBe(stableHash("DHL"));
  expect(stableHash("x")).toMatch(/^[0-9a-f]{16}$/);
});
