import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { SqlQuery } from "./db.ts";
import { listNotices, markNoticeSeen, recordInvoiceNotice } from "./notifications.ts";

const admin = { role: "admin" as const, company_id: null };
const nordhavn = { role: "customer" as const, company_id: "nordhavn-living" };
const vesterbro = { role: "customer" as const, company_id: "vesterbro-cloth" };

let query: SqlQuery;

beforeEach(async () => {
  const db = new PGlite();
  await db.exec(readFileSync(new URL("./notifications.sql", import.meta.url), "utf8"));
  await db.exec("create table public.invoice_mail (id text primary key, company_id text not null, sender text not null, subject text not null)");
  query = (async (text, params = []) => (await db.query(text, params)).rows) as SqlQuery;
});

async function receive(id: string, companyId: string, subject: string, files: { filename: string; carrier?: string }[]) {
  const sender = "Henrik Jacobsen <henrik@example.com>";
  await query("insert into invoice_mail (id, company_id, sender, subject) values ($1, $2, $3, $4)", [id, companyId, sender, subject]);
  await recordInvoiceNotice(query, { id, companyId, sender, subject, files });
}

describe("invoice notifications", () => {
  it("puts a received invoice on the bell with the carrier read from the PDF", async () => {
    const id = "605ebb1e-2914-43c1-b36c-4b66aa4768b4";
    await receive(id, "nordhavn-living", "Test faktura", [{ filename: "faktura.pdf", carrier: "PostNord" }]);
    const [notice] = await listNotices(query, admin);
    expect(notice).toMatchObject({ id, kind: "invoice", name: "PostNord", company: "nordhavn-living", subject: "Test faktura", seenAt: null });
  });

  it("shows a company seat only its own invoices and never demo requests", async () => {
    await receive("11111111-1111-4111-8111-111111111111", "nordhavn-living", "Faktura GLS", [{ filename: "a.pdf" }]);
    await receive("22222222-2222-4222-8222-222222222222", "vesterbro-cloth", "Faktura DHL", [{ filename: "b.pdf" }]);
    await query("insert into notifications (id, kind, name, company, email) values ('33333333-3333-4333-8333-333333333333', 'demo', 'Jesper', 'Firma', 'j@example.com')");
    expect((await listNotices(query, nordhavn)).map((item) => item.name)).toEqual(["GLS"]);
    expect((await listNotices(query, vesterbro)).map((item) => item.name)).toEqual(["DHL"]);
    expect(await listNotices(query, { role: "customer", company_id: null })).toEqual([]);
    expect(await listNotices(query, admin)).toHaveLength(3);
  });

  it("keeps a seen invoice for the full list and lets only its company mark it", async () => {
    const id = "44444444-4444-4444-8444-444444444444";
    await receive(id, "nordhavn-living", "Faktura", [{ filename: "c.pdf" }]);
    await markNoticeSeen(query, vesterbro, id);
    expect(await listNotices(query, nordhavn)).toHaveLength(1);
    await markNoticeSeen(query, nordhavn, id);
    expect(await listNotices(query, nordhavn)).toEqual([]);
    const [all] = await listNotices(query, nordhavn, { all: true });
    expect(all.id).toBe(id);
    expect(all.seenAt).not.toBeNull();
  });

  it("records one notice per mail", async () => {
    const id = "55555555-5555-4555-8555-555555555555";
    await receive(id, "nordhavn-living", "Faktura", [{ filename: "d.pdf" }]);
    await recordInvoiceNotice(query, { id, companyId: "nordhavn-living", sender: "x", subject: "Faktura", files: [] });
    expect(await listNotices(query, admin)).toHaveLength(1);
  });

  it("returns nothing when the table is missing", async () => {
    const empty = new PGlite();
    const bare = (async (text, params = []) => (await empty.query(text, params)).rows) as SqlQuery;
    expect(await listNotices(bare, admin)).toEqual([]);
    await expect(markNoticeSeen(bare, admin, "x")).resolves.toBeUndefined();
  });
});
