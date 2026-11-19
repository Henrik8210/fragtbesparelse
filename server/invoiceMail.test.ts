import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { carrierFromFile, companyIdFromRecipient, decodeMailBody, invoiceAddress, isMailFileId, uploadType } from "./invoiceMail.ts";

describe("invoice mail recipients", () => {
  it("builds the company address on freightlytics.io", () => {
    expect(invoiceAddress("nordhavn-living")).toBe("nordhavn-living@freightlytics.io");
  });

  it("extracts the company id from plain and display-name recipients", () => {
    expect(companyIdFromRecipient("nordhavn-living@freightlytics.io")).toBe("nordhavn-living");
    expect(companyIdFromRecipient(" Nordhavn-Living@Freightlytics.io ")).toBe("nordhavn-living");
    expect(companyIdFromRecipient('"Faktura" <vesterbro-cloth@freightlytics.io>')).toBe("vesterbro-cloth");
  });

  it("rejects other domains and unsafe local parts", () => {
    expect(companyIdFromRecipient("nordhavn-living@example.com")).toBeNull();
    expect(companyIdFromRecipient("nordhavn-living@mail.freightlytics.io")).toBeNull();
    expect(companyIdFromRecipient("@freightlytics.io")).toBeNull();
    expect(companyIdFromRecipient("-bad@freightlytics.io")).toBeNull();
    expect(companyIdFromRecipient("a.b@freightlytics.io")).toBeNull();
    expect(companyIdFromRecipient(`${"a".repeat(49)}@freightlytics.io`)).toBeNull();
    expect(companyIdFromRecipient("no-at-sign")).toBeNull();
  });
});

describe("decodeMailBody", () => {
  it("unpacks the worker's base64 envelope", () => {
    const packed = Buffer.from(JSON.stringify({ v: 1, raw: Buffer.from("From: a@b\r\n\r\nhi").toString("base64") }));
    expect(decodeMailBody(packed)).toEqual(Buffer.from("From: a@b\r\n\r\nhi"));
  });

  it("passes a raw message through and flags a broken envelope", () => {
    const raw = Buffer.from("From: a@b\r\n\r\nhi");
    expect(decodeMailBody(raw)).toBe(raw);
    expect(decodeMailBody(Buffer.from('{"v":1,"raw":""}'))).toBe("bad");
    expect(decodeMailBody(Buffer.from('{"v":1,"raw":'))).toBe("bad");
  });
});

describe("uploadType", () => {
  it("accepts invoice files and checks that a .pdf really is one", () => {
    expect(uploadType("faktura.pdf", Buffer.from("%PDF-1.7 ..."))).toBe("application/pdf");
    expect(uploadType("Faktura.CSV", Buffer.from("a;b\n1;2"))).toBe("text/csv");
    expect(uploadType("faktura.pdf", Buffer.from("not a pdf"))).toBeNull();
    expect(uploadType("faktura.csv", Buffer.from("%PDF-1.7"))).toBeNull();
    expect(uploadType("faktura.exe", Buffer.from("MZ"))).toBeNull();
    expect(uploadType("faktura", Buffer.from("a;b"))).toBeNull();
  });
});

describe("carrierFromFile", () => {
  it("reads PostNord from the Nordhavn test PDF and a CSV, and nothing from other files", async () => {
    const pdf = readFileSync(new URL("./fixtures/nordhavn-living-testfaktura.pdf", import.meta.url));
    expect(await carrierFromFile("nordhavn-living-testfaktura.pdf", pdf)).toBe("PostNord");
    expect(await carrierFromFile("faktura.csv", Buffer.from("Transportør: GLS\nforsendelse;dato\n"))).toBe("GLS");
    expect(await carrierFromFile("faktura.xlsx", Buffer.from("GLS"))).toBe("");
  });
});

describe("isMailFileId", () => {
  it("accepts url-safe ids up to 80 characters", () => {
    expect(isMailFileId("abc_DEF-123")).toBe(true);
    expect(isMailFileId("a".repeat(81))).toBe(false);
    expect(isMailFileId("../etc/passwd")).toBe(false);
    expect(isMailFileId("")).toBe(false);
  });
});
