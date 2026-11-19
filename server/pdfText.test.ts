import { describe, expect, it } from "vitest";
import { joinWrappedHeaders } from "./pdfText.ts";

const part = (x: number, text: string, w = text.length * 5) => ({ x, w, text });
const line = (row: { parts: { text: string }[] }) => row.parts.map((item) => item.text).join("  ");

const HEADER = { y: 700, size: 9, parts: [part(40, "Destination"), part(150, "Aarby"), part(250, "Bstrup"), part(350, "Nedre"), part(450, "Fjordby")] };

describe("joinWrappedHeaders", () => {
  it("puts a wrapped word back on the column it belongs to", () => {
    const rows = joinWrappedHeaders([HEADER, { y: 690, size: 9, parts: [part(350, "Vang")] }]);
    expect(rows.map(line)).toEqual(["Destination  Aarby  Bstrup  Nedre Vang  Fjordby"]);
  });

  it("puts a word printed above a cell in front of it", () => {
    const rows = joinWrappedHeaders([{ y: 710, size: 9, parts: [part(250, "Øvre")] }, HEADER]);
    expect(rows.map(line)).toEqual(["Destination  Aarby  Øvre Bstrup  Nedre  Fjordby"]);
  });

  it("keeps the names and the postcode line apart", () => {
    const codes = { y: 690, size: 9, parts: [part(40, "Postnr."), part(150, "DE-10000"), part(250, "DE-20000"), part(350, "DE-30000"), part(450, "DE-40000")] };
    expect(joinWrappedHeaders([HEADER, codes]).map(line)).toHaveLength(2);
  });

  it("leaves price rows, distant lines and wide sentences alone", () => {
    const prices = { y: 690, size: 9, parts: [part(350, "440,30")] };
    expect(joinWrappedHeaders([HEADER, prices])).toHaveLength(2);
    expect(joinWrappedHeaders([HEADER, { y: 640, size: 9, parts: [part(350, "Vang")] }])).toHaveLength(2);
    expect(joinWrappedHeaders([HEADER, { y: 690, size: 9, parts: [part(340, "Raterne er angivet i DKK", 200)] }])).toHaveLength(2);
  });
});
