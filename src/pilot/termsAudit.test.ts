import { describe, expect, it } from "vitest";
import type { AgreementTerms } from "./agreementFormat.ts";
import { priceTerms, type TermsLine } from "./termsAudit.ts";

const column = (label: string, detail: string) => ({ label, detail });
const cells = (...values: number[]) => values;

const terms: AgreementTerms = {
  items: [
    { category: "Ordreekspedition", description: "Tillæg pr. ordrelinje", unit: "", price: 8.77, currency: "DKK", note: "" },
    { category: "Lager", description: "Indlagring af palleteret gods", unit: "pr. EUR 1/1 palle", price: 30.68, currency: "DKK", note: "" },
    { category: "Timesatser", description: "Timelønsarbejde inden for normal arbejdstid", unit: "pr. time inkl. materiel", price: 381.8, currency: "DKK", note: "" },
  ],
  grids: [
    {
      name: "Distribution fra FL Vejle til Danmark",
      category: "", unit: "", currency: "DKK", rowLabel: "Levering", note: "",
      columns: [column("Jylland/Fyn", "A (Grossist)"), column("Jylland/Fyn", "B (Butik)"), column("Sjælland", "A (Grossist)"), column("Sjælland", "B (Butik)")],
      rows: [
        { label: "1 palleplads", cells: cells(214.31, 290.27, 288.48, 422.68) },
        { label: "2-3 pallepladser", cells: cells(184.81, 245.21, 267.68, 403.39) },
        { label: "4-6 pallepladser", cells: cells(161.87, 206.44, 247.63, 372.76) },
        { label: "7-10 pallepladser", cells: cells(139.03, 167.79, 226.83, 338.72) },
        { label: "11-15 pallepladser", cells: cells(119.42, 146.90, 212.45, 308.09) },
        { label: "21-27 pallepladser", cells: cells(76.76, 104.26, 174.25, 268.38) },
        { label: "Hele læs, 33 ppl.", cells: cells(1821.80, 2520.83, 4719.17, 7051.58) },
      ],
      minimum: [], maximum: [],
    },
    {
      name: "Distribution fra FL Vejle til Sverige",
      category: "", unit: "", currency: "DKK", rowLabel: "Destination", note: "",
      columns: [column("Malmö", "SE-21124")],
      rows: [{ label: "11-15 pallepladser", cells: cells(302) }],
      minimum: [], maximum: [],
    },
    {
      name: "Distribution fra FL Vejle til Tyskland",
      category: "", unit: "", currency: "DKK", rowLabel: "Destination", note: "",
      columns: [column("Hamburg", "DE-20000 -")],
      rows: [{ label: "16-20 pallepladser", cells: cells(121.24) }],
      minimum: [], maximum: [],
    },
  ],
  surcharges: [],
  conditions: [
    "21,58% for national kørsel i Danmark og Sverige samt kørsel mellem Danmark og Sverige.",
    "28,22% for øvrige lande.",
  ],
};

function shipment(partial: Partial<TermsLine> & Pick<TermsLine, "shipment" | "service" | "billedOre" | "destination">): TermsLine {
  return {
    date: "2026-10-14", weight: 1000, origin: "DK", kind: "shipment", quantity: 1, unit: "ppl", zone: "",
    ...partial,
  };
}

const lines: TermsLine[] = [
  shipment({ shipment: "4500803", service: "Jylland/Fyn A – COOP, 5260 Odense (4-6 ppl)", zone: "Jylland/Fyn A", quantity: 6, billedOre: 97122, destination: "DK" }),
  shipment({ shipment: "4500809", service: "Jylland/Fyn A – Salling Group, 8270 Holme (11-15 ppl)", zone: "Jylland/Fyn A", quantity: 12, billedOre: 143304, destination: "DK" }),
  shipment({ shipment: "4500822", service: "Sjælland A – Dagrofa, 4100 Ringsted (7-10 ppl)", zone: "Sjælland A", quantity: 8, billedOre: 181464, destination: "DK" }),
  shipment({ shipment: "4500830", service: "Sjælland A – Netto, 4600 Køge (21-27 ppl)", zone: "Sjælland A", quantity: 22, billedOre: 383350, destination: "DK" }),
  shipment({ shipment: "4500838", service: "Jylland/Fyn B – SuperBrugsen, 7323 Give (2-3 ppl)", zone: "Jylland/Fyn B", quantity: 2, billedOre: 58054, destination: "DK" }),
  shipment({ shipment: "4500845", service: "Sjælland A – Lidl, 4600 Køge (4-6 ppl)", zone: "Sjælland A", quantity: 4, billedOre: 99052, destination: "DK" }),
  shipment({ shipment: "4500853", service: "Sverige – Malmö, SE-21124 (11-15 ppl)", zone: "Sverige", quantity: 15, billedOre: 453000, destination: "SE" }),
  shipment({ shipment: "4500866", service: "Tyskland – Hamburg, DE-20539 (16-20 ppl)", zone: "Tyskland", quantity: 18, billedOre: 232020, destination: "DE" }),
  shipment({ shipment: "4500872", service: "Jylland/Fyn A – REMA, 8700 Horsens (hele læs)", zone: "Jylland/Fyn A", quantity: 1, unit: "læs", billedOre: 182180, destination: "DK" }),
  { shipment: "ORD-linje", date: "2026-10-31", service: "Tillæg pr. ordrelinje", weight: 0, billedOre: 1_097_050, origin: "DK", destination: "DK", kind: "fee", quantity: 1186, unit: "linje", zone: "" },
  { shipment: "ORD-miljo", date: "2026-10-31", service: "Miljø- og energitillæg lager, pr. ordre", weight: 0, billedOre: 92_300, origin: "DK", destination: "DK", kind: "fee", quantity: 142, unit: "ordre", zone: "" },
  { shipment: "IND", date: "2026-10-01", service: "Indlagring af palleteret gods, EUR 1/1 palle", weight: 0, billedOre: 570_648, origin: "DK", destination: "DK", kind: "fee", quantity: 186, unit: "pll", zone: "" },
  { shipment: "TIM", date: "2026-10-31", service: "Timelønsarbejde, sortering af returvarer", weight: 0, billedOre: 248_170, origin: "DK", destination: "DK", kind: "fee", quantity: 6.5, unit: "time", zone: "" },
  { shipment: "OLIE-DK", date: "2026-10-31", service: "Olietillæg national DK/SE af fragtbeløb", weight: 0, billedOre: 376_697, origin: "DK", destination: "DK", kind: "surcharge", quantity: 15975.26, unit: "DKK", zone: "" },
  { shipment: "OLIE-DE", date: "2026-10-31", service: "Olietillæg øvrige lande af fragtbeløb", weight: 0, billedOre: 65_476, origin: "DK", destination: "DK", kind: "surcharge", quantity: 2320.2, unit: "DKK", zone: "" },
];

describe("3PL agreement check", () => {
  const report = priceTerms(lines, terms);

  it("finds the six deviations and no others, totalling 2.098,15 kr", () => {
    const over = report.filter((line) => line.status === "over");
    expect(over.map((line) => [line.shipment, line.differenceOre])).toEqual([
      ["4500838", 9012],
      ["4500866", 13788],
      ["ORD-linje", 56928],
      ["ORD-miljo", 92300],
      ["OLIE-DK", 33896],
      ["OLIE-DE", 3891],
    ]);
    expect(over.reduce((sum, line) => sum + (line.differenceOre ?? 0), 0)).toBe(209_815);
    expect(report.filter((line) => line.status === "match").map((line) => line.shipment)).toEqual([
      "4500803", "4500809", "4500822", "4500830", "4500845", "4500853", "4500872", "IND", "TIM",
    ]);
  });

  it("names each deviation in Danish with the agreed amount", () => {
    const byId = new Map(report.map((line) => [line.shipment, line]));
    expect(byId.get("ORD-linje")?.reason).toMatch(/8,77 kr\..*1\.186.*= 10\.401,22 kr/);
    expect(byId.get("ORD-miljo")?.reason).toMatch(/står ikke i prisaftalen/);
    expect(byId.get("4500838")?.reason).toMatch(/2-3 pallepladser.*245,21 kr\..*× 2.*= 490,42 kr/);
    expect(byId.get("4500866")?.reason).toMatch(/16-20 pallepladser.*121,24 kr\..*× 18.*= 2\.182,32 kr/);
    expect(byId.get("OLIE-DK")?.reason).toMatch(/21,58 %.*15\.885,14 kr.*= 3\.428,01 kr/);
    expect(byId.get("OLIE-DE")?.reason).toMatch(/28,22 %.*2\.182,32 kr.*= 615,85 kr/);
    expect(byId.get("4500838")?.expectedOre).toBe(49042);
    expect(byId.get("OLIE-DK")?.expectedOre).toBe(342801);
  });
});
