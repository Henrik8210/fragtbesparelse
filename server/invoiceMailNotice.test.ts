import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it, vi } from "vitest";

const db = new PGlite();

vi.mock("./db.ts", () => {
  const query = async (text: string, params: unknown[] = []) => (await db.query(text, params)).rows;
  return {
    postgresSql: query,
    withDatabase: (run: (q: typeof query) => Promise<unknown>) => db.transaction((tx) => run(async (text, params = []) => (await tx.query(text, params)).rows)),
    publicDbError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    storesInPostgres: () => true,
  };
});

const { acceptInvoiceMail } = await import("./invoiceMail.ts");
const { listNotices } = await import("./notifications.ts");

it("creates a bell notice when an invoice mail is stored", async () => {
  await db.exec("create table public.companies (id text primary key, name text, industry text, place text)");
  await db.exec(readFileSync(new URL("./invoice-mail.sql", import.meta.url), "utf8").replace(/references public\.companies \(id\)/g, ""));
  await db.exec(readFileSync(new URL("./notifications.sql", import.meta.url), "utf8"));
  const pdf = readFileSync(new URL("./fixtures/nordhavn-living-testfaktura.pdf", import.meta.url));
  const raw = Buffer.from([
    "From: Henrik <henrik@example.com>",
    "To: nordhavn-living@freightlytics.io",
    "Subject: Test faktura",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="b"',
    "",
    "--b",
    "Content-Type: text/plain",
    "",
    "Se vedhæftet.",
    "--b",
    "Content-Type: application/pdf",
    'Content-Disposition: attachment; filename="faktura.pdf"',
    "Content-Transfer-Encoding: base64",
    "",
    pdf.toString("base64"),
    "--b--",
    "",
  ].join("\r\n"));

  const stored = await acceptInvoiceMail("nordhavn-living@freightlytics.io", "henrik@example.com", raw);
  expect(stored.result).toBe("stored");
  const notices = await listNotices(async (text, params = []) => (await db.query(text, params)).rows as never, { role: "customer", company_id: "nordhavn-living" });
  expect(notices).toHaveLength(1);
  expect(notices[0]).toMatchObject({
    id: stored.result === "stored" ? stored.id : "",
    kind: "invoice",
    name: "PostNord",
    company: "nordhavn-living",
    subject: "Test faktura",
  });
});
