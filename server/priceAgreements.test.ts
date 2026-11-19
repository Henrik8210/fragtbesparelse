import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, test } from "vitest";
import type { AgreementCreate } from "../src/pilot/agreementRecord.ts";
import type { RateRow } from "../src/pilot/freight.ts";

delete process.env.DATABASE_URL;
delete process.env.CLOUDFLARE_AI_TOKEN;

const {
  agreementStore, createAgreement, deleteAgreement, fromRow, insertParams, listAgreements, readAgreement, updateAgreement,
  INSERT_SQL, UPDATE_SQL, updateParams,
} = await import("./priceAgreements.ts");
const { extractAgreement } = await import("./invoiceExtract.ts");
const { newRecord, patchRecord } = await import("../src/pilot/agreementRecord.ts");
const { extractTerms } = await import("../src/pilot/agreementExtract.ts");

const row: RateRow = { service: "Pakkeshop", maxWeight: 5, baseOre: 4600, fuelPct: 12.5, fixedOre: 240, from: "2027-01-01", to: "2027-12-31" };
const henrik = { id: "u1", name: "Henrik" };
const jesper = { id: "u2", name: "Jesper" };
const input = (fields: Partial<AgreementCreate> = {}): AgreementCreate => ({
  name: "GLS 2027", carrier: "GLS", from: "2027-01-01", to: "2027-12-31", ended: null,
  rows: [row], source: "csv", sourceFilename: "gls.csv", extractSha256: null, ...fields,
});

test("keeps agreements in memory per company without the table, with create, update and delete", async () => {
  expect(agreementStore()).toBe("memory");
  const made = await createAgreement("nordhavn-living", input(), henrik);
  expect(made.store).toBe("memory");
  expect(made.agreement).toMatchObject({ companyId: "nordhavn-living", changed: false, createdByName: "Henrik", source: "csv" });
  await createAgreement("vesterbro-cloth", input({ name: "Andet firma" }), henrik);
  expect((await listAgreements("nordhavn-living")).agreements.map((item) => item.name)).toEqual(["GLS 2027"]);
  expect((await listAgreements(null)).agreements).toHaveLength(2);

  const ended = await updateAgreement(made.agreement, { ended: "2027-03-01T10:00:00.000Z" }, jesper);
  expect(ended.agreement).toMatchObject({ ended: "2027-03-01T10:00:00.000Z", updatedByName: "Jesper", changed: false });
  expect(ended.agreement.history).toEqual([{ at: ended.agreement.updatedAt, by: "u2", name: "Jesper", fields: ["ended"] }]);

  await deleteAgreement(ended.agreement);
  expect(await readAgreement(made.agreement.id)).toBeNull();
});

test("an import with the same id keeps what is stored, and a plain create with it is a conflict", async () => {
  const id = "11111111-2222-4333-8444-555555555555";
  const first = await createAgreement("kolding-table-co", input({ id, source: "browser" }), henrik, true);
  const again = await createAgreement("kolding-table-co", input({ id, name: "Ny", source: "browser" }), jesper, true);
  expect(again).toMatchObject({ existed: true });
  expect(again.agreement.name).toBe(first.agreement.name);
  await expect(createAgreement("kolding-table-co", input({ id }), henrik)).rejects.toThrow("conflict");
  await expect(createAgreement("horsens-gearworks", input({ id }), henrik, true)).rejects.toThrow("conflict");
});

test("a PDF agreement stores the cached AI extract and the original rows next to the edited ones", async () => {
  const pdf = readFileSync(new URL("./fixtures/gls-prisaftale-test.pdf", import.meta.url));
  const reply = {
    response: {
      carrier: "GLS", title: "", validFrom: "2027-01-01", validTo: "2027-12-31", currency: "DKK", surcharges: [],
      rates: [{ service: "Pakkeshop", zone: "", maxWeightKg: 5, price: 46, fuelPercent: 0, fixedSurcharge: 0 }],
    },
  };
  const done = await extractAgreement("skive-plate-works", "gls.pdf", pdf, async () => reply);
  if (done.result !== "extracted") throw new Error(done.result);
  const original = [{ ...row, fuelPct: 0, fixedOre: 0 }];
  const saved = await createAgreement("skive-plate-works", input({
    source: "pdf", sourceFilename: "gls.pdf", extractSha256: done.extract.sha256, original,
  }), henrik);
  expect(saved.agreement.extract?.sha256).toBe(done.extract.sha256);
  expect(saved.agreement.extractSha256).toBe(done.extract.sha256);
  expect(saved.agreement.original).toEqual({ rates: original, items: [], grids: [], surcharges: [], conditions: [] });
  expect(saved.agreement.rows).toEqual([row]);
  expect(saved.agreement.changed).toBe(true);

  const other = await createAgreement("esbjerg-rig-supply", input({ source: "pdf", extractSha256: done.extract.sha256 }), henrik);
  expect(other.agreement.extract).toBeNull();
  expect(other.agreement.extractSha256).toBeNull();
});

test("the SQL file creates a table the insert, update and select statements work against", async () => {
  const db = new PGlite();
  await db.exec("create table public.companies (id text primary key, name text, industry text, place text)");
  await db.exec("insert into public.companies values ('nordhavn-living', 'Nordhavn Living', '', '')");
  await db.exec(readFileSync(new URL("./price-agreements.sql", import.meta.url), "utf8"));
  const record = newRecord(input({ id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" }), "nordhavn-living", henrik, null, new Date("2026-11-19T12:00:00Z"));
  await db.query(INSERT_SQL, insertParams(record));
  const edited = patchRecord(record, { rows: [{ ...row, baseOre: 4500 }], name: "GLS rettet" }, jesper, new Date("2026-11-20T08:00:00Z"));
  await db.query(UPDATE_SQL, updateParams(edited));
  const rows = (await db.query("select * from public.price_agreements")).rows;
  const back = fromRow(rows[0] as Parameters<typeof fromRow>[0]);
  expect(back).toMatchObject({
    name: "GLS rettet", from: "2027-01-01", to: "2027-12-31", changed: true, source: "csv", formatVersion: 2,
    updatedByName: "Jesper", createdByName: "Henrik", createdAt: "2026-11-19T12:00:00.000Z",
  });
  expect(back.rows[0].baseOre).toBe(4500);
  expect(back.original.rates[0].baseOre).toBe(4600);
  expect((rows[0] as { rows: unknown }).rows).toMatchObject({ rates: [{ baseOre: 4500 }], items: [], grids: [] });
  expect(back.history.map((item) => item.fields)).toEqual([["name", "rows"]]);
  await expect(db.query(INSERT_SQL, insertParams({ ...record, id: "x-1-another-id", source: "fax" as "csv" }))).rejects.toThrow();

  // A row written by the format 1 app: bare rate arrays in rows and original.
  await db.query(`insert into public.price_agreements (id, company_id, name, format_version, rows, original, created_by, created_by_name, updated_by, updated_by_name)
    values ('old-format-1', 'nordhavn-living', 'Gammel', 1, $1::jsonb, $1::jsonb, 'u1', 'Henrik', 'u1', 'Henrik')`, [JSON.stringify([row])]);
  const old = fromRow((await db.query("select * from public.price_agreements where id = 'old-format-1'")).rows[0] as Parameters<typeof fromRow>[0]);
  expect(old).toMatchObject({ formatVersion: 1, rows: [row], terms: { items: [], grids: [], surcharges: [], conditions: [] } });
  expect(old.original.rates).toEqual([row]);
  const upgraded = patchRecord(old, { terms: { ...terms, conditions: ["Fakturering månedsvis bagud."] } }, jesper);
  await db.query(UPDATE_SQL, updateParams(upgraded));
  const again = fromRow((await db.query("select * from public.price_agreements where id = 'old-format-1'")).rows[0] as Parameters<typeof fromRow>[0]);
  expect(again).toMatchObject({ formatVersion: 2, rows: [row], changed: true });
  expect(again.terms.conditions).toEqual(["Fakturering månedsvis bagud."]);
  await db.close();
});

const terms = {
  items: [{ category: "Lagerleje", description: "Pallelagerplads", unit: "pr. palle pr. uge", price: 9.4, currency: "DKK", note: "" }],
  grids: [{
    name: "Distribution fra Kolding", category: "Distribution", unit: "pr. leverance", currency: "DKK", rowLabel: "Pallepladser", note: "",
    columns: [{ label: "Jylland/Fyn", detail: "Erhverv" }, { label: "Sjælland", detail: "Erhverv" }],
    rows: [{ label: "1 ppl.", cells: [612.4, 748.9] }], minimum: [612.4, 748.9], maximum: [],
  }],
  surcharges: [{ label: "Farligt gods (ADR)", kind: "agreed" as const, value: null, unit: "", scope: "", note: "" }],
  conditions: [],
};

test("a 3PL agreement with only terms is stored, and edits to a grid cell count as changed against the extract", async () => {
  const pdf = readFileSync(new URL("./fixtures/nordlager-3pl-prisaftale-test.pdf", import.meta.url));
  const reply = { response: { carrier: "Nordlager", title: "", validFrom: "", validTo: "", currency: "DKK", rates: [], ...terms } };
  const done = await extractAgreement("kolding-table-co", "n.pdf", pdf, async () => reply);
  if (done.result !== "extracted") throw new Error(done.result);
  const read = extractTerms(done.extract);
  const same = await createAgreement("kolding-table-co", input({ rows: [], terms: read, source: "pdf", extractSha256: done.extract.sha256 }), henrik);
  expect(same.agreement).toMatchObject({ rows: [], changed: false, formatVersion: 2 });
  expect(same.agreement.terms.grids[0].minimum).toEqual([612.4, 748.9]);
  const edited = structuredClone(read);
  edited.grids[0].rows[0].cells[1] = 750;
  const changed = await createAgreement("kolding-table-co", input({ rows: [], terms: edited, source: "pdf", extractSha256: done.extract.sha256 }), henrik);
  expect(changed.agreement.changed).toBe(true);
  expect(changed.agreement.original.grids).toHaveLength(1);
  await expect(createAgreement("kolding-table-co", input({ rows: [] }), henrik)).rejects.toThrow(/mindst én pris/);
});
