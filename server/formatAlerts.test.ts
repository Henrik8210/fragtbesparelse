import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { linesFromExtract } from "../src/pilot/invoiceCheck.ts";
import { validateExtract } from "../src/pilot/invoiceExtract.ts";
import type { SqlQuery } from "./db.ts";
import { formatNoticeId, observeCheckEdits, observeDocument, observeInvoiceExtract, setFormatDatabase } from "./formatAlerts.ts";
import { listNotices, markNoticeSeen } from "./notifications.ts";

const admin = { role: "admin" as const, company_id: null };
const nordhavn = { role: "customer" as const, company_id: "nordhavn-living" };

let db: PGlite;
let query: SqlQuery;

async function setup(withDetail: boolean) {
  db = new PGlite();
  await db.exec(readFileSync(new URL("./notifications.sql", import.meta.url), "utf8"));
  if (withDetail) await db.exec(readFileSync(new URL("./format-alerts.sql", import.meta.url), "utf8"));
  await db.exec("create table public.invoice_mail (id text primary key, company_id text not null, sender text not null, subject text not null)");
  await db.exec("create table public.invoice_mail_files (id text primary key, mail_id text not null, company_id text not null, filename text not null)");
  await db.exec(readFileSync(new URL("./invoice-extract.sql", import.meta.url), "utf8").replace(/references public\.companies \(id\)/g, ""));
  query = (async (text, params = []) => (await db.query(text, params)).rows) as SqlQuery;
  setFormatDatabase(query);
}

beforeEach(() => setup(true));

/** Synthetic GLS invoices: the known layout, then a redesign with English labels and new columns. */
function oldText(customer: string, number: number) {
  return [
    "GLS Denmark A/S",
    `Kunde: ${customer}`,
    `Fakturanr: GLS-${number}`,
    "Fakturadato: 01.11.2026",
    "Dato  Pakkenr.  Produkt  Vægt  Zone  Beløb",
    `01.10.2026  ${number}01  BusinessParcel  2 kg  DK  85,00 kr`,
    `02.10.2026  ${number}02  BusinessParcel  5 kg  DK  120,00 kr`,
    "Brændstoftillæg  18,50 kr",
    "I alt  223,50 kr",
    "Betalingsbetingelser",
  ].join("\n");
}

function newText(number: number) {
  return [
    "GLS Denmark A/S",
    `Customer account: ${number}`,
    `Invoice no.: G${number}`,
    "Issue date: 2026-11-01",
    "Shipment overview",
    "Track ID  Service level  Billable weight  Destination  Energy fee  Net amount",
    `G${number}1  EuroBusinessParcel  2 kg  SE  4,10  85,00`,
    `G${number}2  EuroBusinessParcel  5 kg  NO  4,10  120,00`,
    "Climate compensation  18,50",
    "Amount due  223,50",
  ].join("\n");
}

function reply(extra: Record<string, unknown> = {}) {
  const line = (amount: number, weightKg: number) => ({
    kind: "shipment", shipment: "", date: "2026-10-01", reference: "", service: "BusinessParcel", weightKg, zone: "",
    origin: "DK", destination: "DK", amount, surcharges: [],
  });
  return {
    carrier: "GLS Denmark A/S", invoiceNumber: "1", invoiceDate: "2026-11-01", currency: "DKK", subtotal: 0, vat: 0, total: 223.5,
    lines: [line(85, 2), line(120, 5), { ...line(18.5, 0), kind: "surcharge", service: "Brændstoftillæg" }],
    unmapped: [],
    ...extra,
  };
}

const extractOf = (text: string, sha: string, extra: Record<string, unknown> = {}) =>
  validateExtract(reply(extra), text, { sha256: sha, filename: `${sha}.pdf` });

async function storeFile(fileId: string, mailId: string, companyId: string) {
  await query("insert into invoice_mail_files (id, mail_id, company_id, filename) values ($1, $2, $3, $4)", [fileId, mailId, companyId, `${fileId}.pdf`]);
}

describe("format change notices", () => {
  it("adds layout and unmapped fields to the extract", () => {
    const extract = extractOf(newText(5), "a", {
      unmapped: [{ label: "Energy fee", value: "4,10" }],
      lines: [{ ...reply().lines[0], co2Kg: 1.2 }],
    });
    expect(extract.unmapped).toEqual([{ label: "Energy fee", value: "4,10" }, { label: "co2Kg", value: "1.2" }]);
    expect(extract.layout?.tokens).toContain("t:shipment overview");
  });

  it("tells admins once when a carrier's invoice layout changes, and opens the document", async () => {
    await storeFile("file-new-1", "mail-new-1", "nordhavn-living");
    expect(await observeInvoiceExtract("nordhavn-living", extractOf(oldText("Nordhavn Living", 1), "s1"), "file-old-1")).toBeNull();
    expect(await observeInvoiceExtract("vesterbro-cloth", extractOf(oldText("Vesterbro Cloth", 2), "s2"), "file-old-2")).toBeNull();
    const finding = await observeInvoiceExtract("nordhavn-living", extractOf(newText(3), "s3"), "file-new-1");
    expect(finding).toMatchObject({ carrier: "GLS", change: "layout" });
    expect(await observeInvoiceExtract("vesterbro-cloth", extractOf(newText(4), "s4"), "file-new-2")).toBeNull();

    const notices = await listNotices(query, admin);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      id: formatNoticeId("invoice", "GLS", finding!.key),
      kind: "format_change",
      name: "GLS",
      company: "nordhavn-living",
      email: "mail-new-1",
      detail: { docKind: "invoice", change: "layout", fileId: "file-new-1", mailId: "mail-new-1", filename: "s3.pdf" },
    });
    expect(notices[0].detail?.reasons[0]).toMatch(/^Layoutet ligner det kendte format \d+ %$/);
  });

  it("never shows a format notice to a company seat", async () => {
    await observeInvoiceExtract("nordhavn-living", extractOf(oldText("Nordhavn Living", 1), "s1"), "f1");
    const finding = await observeInvoiceExtract("nordhavn-living", extractOf(newText(2), "s2"), "f2");
    const id = formatNoticeId("invoice", "GLS", finding!.key);
    expect(await listNotices(query, nordhavn, { all: true })).toEqual([]);
    await markNoticeSeen(query, nordhavn, id);
    expect((await listNotices(query, admin))[0].seenAt).toBeNull();
  });

  it("rebuilds known layouts from invoice_extracts after a restart", async () => {
    for (const [sha, company] of [["s1", "nordhavn-living"], ["s2", "vesterbro-cloth"]]) {
      const extract = extractOf(oldText(company, 1), sha);
      await query(
        "insert into invoice_extracts (company_id, content_sha256, version, model, confidence, extract) values ($1, $2, $3, $4, $5, $6::jsonb)",
        [company, sha, extract.version, extract.model, extract.confidence, JSON.stringify(extract)],
      );
    }
    setFormatDatabase(query);
    expect(await observeInvoiceExtract("kolding-table-co", extractOf(oldText("Kolding Table Co", 3), "s3"))).toBeNull();
    expect((await observeInvoiceExtract("kolding-table-co", extractOf(newText(4), "s4")))?.change).toBe("layout");
  });

  it("raises a mismatch and unmapped fields in a known layout as one notice", async () => {
    await observeInvoiceExtract("nordhavn-living", extractOf(oldText("Nordhavn Living", 1), "s1"));
    const odd = { total: 300, unmapped: [{ label: "CO2", value: "1" }, { label: "Palle", value: "2" }, { label: "Lift", value: "3" }] };
    expect((await observeInvoiceExtract("nordhavn-living", extractOf(oldText("Nordhavn Living", 2), "s2", odd)))?.change).toBe("signals");
    await observeInvoiceExtract("vesterbro-cloth", extractOf(oldText("Vesterbro Cloth", 3), "s3", odd));
    const [notice] = await listNotices(query, admin);
    expect(await listNotices(query, admin)).toHaveLength(1);
    expect(notice.detail?.reasons).toEqual([
      '3 felter passede ikke i skemaet: "CO2", "Palle", "Lift"',
      "Linjerne summer ikke til totalen (forskel 76,50 kr.)",
      "Lav sikkerhed i udtrækket",
    ]);
  });

  it("raises heavy edits in Check faktura", async () => {
    await storeFile("f1", "m1", "nordhavn-living");
    const extract = extractOf(oldText("Nordhavn Living", 1), "s1");
    await observeInvoiceExtract("nordhavn-living", extract, "f1");
    const original = linesFromExtract(extract);
    const lines = original.map((line, index) => (index < 2 ? { ...line, amountOre: line.amountOre + 500 } : line));
    const check = { fileId: "f1", companyId: "nordhavn-living", original, lines, changed: true, checkedBy: "u", checkedByName: "Henrik", checkedAt: "", firstCheckedAt: "", history: [] };
    const finding = await observeCheckEdits("nordhavn-living", check);
    expect(finding?.reasons).toEqual(["2 af 3 linjer rettet i Check faktura"]);
    const [notice] = await listNotices(query, admin);
    expect(notice.detail?.mailId).toBe("m1");
  });

  it("still records the notice before the detail column exists", async () => {
    await setup(false);
    await storeFile("f2", "m2", "nordhavn-living");
    await observeInvoiceExtract("nordhavn-living", extractOf(oldText("Nordhavn Living", 1), "s1"), "f1");
    await observeInvoiceExtract("nordhavn-living", extractOf(newText(2), "s2"), "f2");
    const [notice] = await listNotices(query, admin);
    expect(notice).toMatchObject({ kind: "format_change", name: "GLS", email: "m2" });
    expect(notice.detail).toBeUndefined();
  });

  it("takes other document kinds through the same hook", async () => {
    const signals = { lines: 4, unanchored: 0, unmapped: [], mismatchOre: 500, lowConfidence: false, edited: null };
    const finding = await observeDocument({
      kind: "agreement", companyId: "nordhavn-living", documentId: "a1", carrier: "DHL", filename: "prisaftale.pdf", fingerprint: null, signals,
    });
    expect(finding).toMatchObject({ kind: "agreement", carrier: "DHL", change: "signals" });
    expect((await listNotices(query, admin))[0].detail?.docKind).toBe("agreement");
  });
});
