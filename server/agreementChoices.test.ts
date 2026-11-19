import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, test } from "vitest";

delete process.env.DATABASE_URL;

const { choiceStore, clearChoice, fromRow, listChoices, saveChoice, UPSERT_SQL, upsertParams } = await import("./agreementChoices.ts");

test("keeps a manual agreement choice per company and file in memory without the table", async () => {
  expect(choiceStore()).toBe("memory");
  const first = await saveChoice({ companyId: "nordhavn-living", fileId: "f1", agreementId: "a2025", chosenBy: "u1", chosenByName: "Henrik" });
  expect(first.store).toBe("memory");
  await saveChoice({ companyId: "nordhavn-living", fileId: "f1", agreementId: "a2026", chosenBy: "u2", chosenByName: "Jesper" });
  await saveChoice({ companyId: "vesterbro-cloth", fileId: "f2", agreementId: "x", chosenBy: "u1", chosenByName: "Henrik" });
  expect((await listChoices("nordhavn-living")).choices).toMatchObject([{ fileId: "f1", agreementId: "a2026", chosenByName: "Jesper" }]);
  await clearChoice("nordhavn-living", "f1");
  expect((await listChoices("nordhavn-living")).choices).toEqual([]);
  expect((await listChoices("vesterbro-cloth")).choices).toHaveLength(1);
});

test("the SQL file and the upsert agree on the six columns", async () => {
  const db = new PGlite();
  await db.exec(`
    create table public.companies (id text primary key);
    create table public.invoice_mail_files (id text primary key);
    insert into public.companies values ('nordhavn-living');
    insert into public.invoice_mail_files values ('f1');
  `);
  await db.exec(readFileSync(new URL("./invoice-agreement-choices.sql", import.meta.url), "utf8"));
  const choice = { companyId: "nordhavn-living", fileId: "f1", agreementId: "sample:nordhavn-living", chosenBy: "u1", chosenByName: "Henrik", chosenAt: "2026-11-19T10:00:00.000Z" };
  await db.query(UPSERT_SQL, upsertParams(choice));
  await db.query(UPSERT_SQL, upsertParams({ ...choice, agreementId: "a2027", chosenByName: "Jesper" }));
  const rows = (await db.query<Parameters<typeof fromRow>[0]>("select * from public.invoice_agreement_choices")).rows;
  expect(rows.map(fromRow)).toEqual([{ ...choice, agreementId: "a2027", chosenByName: "Jesper" }]);
  await db.query("delete from public.invoice_mail_files where id = 'f1'");
  expect((await db.query("select * from public.invoice_agreement_choices")).rows).toEqual([]);
  await db.close();
});
