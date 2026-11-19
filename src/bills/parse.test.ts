import { describe, expect, it } from "vitest";
import { parseAmount, parseBillText } from "./parse";

describe("parseAmount", () => {
  it.each([
    ["1.234,56", 1234.56],
    ["1,234.56", 1234.56],
    ["1234,5", 1234.5],
    ["1234.56", 1234.56],
    ["12.345.678", 12345678],
    ["kr. 899", 899],
    ["899 DKK", 899],
    ["1\u00a0234,00", 1234],
  ])("%s → %d", (raw, expected) => {
    expect(parseAmount(raw)).toBe(expected);
  });

  it.each(["", "abc", "0", "-5", "1,2345"])("rejects %j", (raw) => {
    expect(parseAmount(raw)).toBeNull();
  });
});

describe("parseBillText", () => {
  it("prefers a stated total over the line amounts", () => {
    const text = "Fragt 100,00 kr.\nTillæg 50,00 kr.\nMoms 37,50 kr.\nI alt 187,50 kr.";
    expect(parseBillText(text)).toBe(187.5);
  });

  it("recognises English total words", () => {
    expect(parseBillText("Freight 1,000.00\nAmount due: 1,250.00")).toBe(1250);
  });

  it("sums money lines and skips VAT when no total is stated", () => {
    expect(parseBillText("Pakke 1  45,50\nPakke 2  54,50\nMoms 25,00")).toBe(100);
  });

  it("ignores dates and bare reference numbers", () => {
    expect(parseBillText("Faktura 20261005\nDato 05.10.2026\nFragt 120,00 kr.")).toBe(120);
  });

  it("reads a CSV amount column, or its total row", () => {
    expect(parseBillText("forsendelse;beløb\nA;10,00\nB;20,50")).toBe(30.5);
    expect(parseBillText("label,amount\nA,10.00\nB,20.00\nTotal,30.00")).toBe(30);
  });

  it("returns null for a CSV without an amount column", () => {
    expect(parseBillText("a;b\n1;2", "bill.csv")).toBeNull();
  });

  it("returns null when there is nothing to read", () => {
    expect(parseBillText("Tak for handlen")).toBeNull();
  });
});
