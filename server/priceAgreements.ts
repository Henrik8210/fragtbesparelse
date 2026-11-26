import {
  newRecord, patchRecord, readOriginal, readStoredContent, storedContent,
  type AgreementCreate, type AgreementPatch, type AgreementRecord,
} from "../src/pilot/agreementRecord.ts";
import { postgresSql, storesInPostgres } from "./db.ts";
import { cachedExtract } from "./invoiceExtract.ts";
import { ensureMailbox } from "./invoiceMail.ts";

export type AgreementStore = "postgres" | "memory";
type Actor = { id: string; name: string };

const MEMORY_KEEP = 2000;
const memory = new Map<string, AgreementRecord>();
// When the table is missing, retry it now and then so creating it takes effect without a restart.
const RETRY_MS = 5 * 60 * 1000;
let missingSince = 0;

function tableUsable(): boolean {
  return storesInPostgres() && (missingSince === 0 || Date.now() - missingSince > RETRY_MS);
}

function absent(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code: unknown }).code : "";
  const message = error instanceof Error ? error.message : String(error);
  return code === "42P01" || /price_agreements.*does not exist|does not exist.*price_agreements/i.test(message) || /DATABASE_URL is not set/.test(message);
}

/** Runs the Postgres branch, or returns null when the table is missing so the caller falls back to memory. */
async function withTable<T>(run: () => Promise<T>): Promise<T | null> {
  if (!tableUsable()) return null;
  try {
    return await run();
  } catch (error) {
    if (!absent(error)) throw error;
    missingSince = Date.now();
    return null;
  }
}

/** Who may add, change, end or delete a company's agreements: an admin, or a seat on that company. */
export function canManageAgreements(user: { role: string; company_id: string | null }, companyId: string): boolean {
  return Boolean(companyId) && (user.role === "admin" || user.company_id === companyId);
}

export function agreementStore(): AgreementStore {
  return tableUsable() ? "postgres" : "memory";
}

export type Row = {
  id: string;
  company_id: string;
  name: string;
  carrier: string;
  valid_from: Date | string | null;
  valid_to: Date | string | null;
  ended_at: Date | string | null;
  format_version: number;
  rows: unknown;
  original: unknown;
  changed: boolean;
  source: string;
  source_filename: string;
  extract_sha256: string | null;
  extract: unknown;
  created_by: string;
  created_by_name: string;
  created_at: Date | string;
  updated_by: string;
  updated_by_name: string;
  updated_at: Date | string;
  history: unknown;
};

function json<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function stamp(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const text = String(value).trim();
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text) ? new Date(`${text.replace(" ", "T")}${/[+-]\d{2}(:?\d{2})?$|Z$/.test(text) ? "" : "Z"}`).toISOString() : text;
}

function day(value: Date | string | null): string {
  if (!value) return "";
  if (value instanceof Date) {
    const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

export function fromRow(row: Row): AgreementRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    carrier: row.carrier,
    from: day(row.valid_from),
    to: day(row.valid_to),
    ended: row.ended_at ? stamp(row.ended_at) : null,
    formatVersion: Number(row.format_version) || 1,
    ...readStoredContent(json(row.rows), Number(row.format_version) || 1),
    original: readOriginal(json(row.original)),
    changed: Boolean(row.changed),
    source: row.source === "pdf" || row.source === "browser" ? row.source : "csv",
    sourceFilename: row.source_filename ?? "",
    extractSha256: row.extract_sha256,
    extract: row.extract ? json<AgreementRecord["extract"]>(row.extract) : null,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: stamp(row.created_at),
    updatedBy: row.updated_by,
    updatedByName: row.updated_by_name,
    updatedAt: stamp(row.updated_at),
    history: json<AgreementRecord["history"]>(row.history) ?? [],
  };
}

function remember(record: AgreementRecord) {
  memory.delete(record.id);
  memory.set(record.id, record);
  while (memory.size > MEMORY_KEEP) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

export function insertParams(record: AgreementRecord): unknown[] {
  return [
    record.id, record.companyId, record.name, record.carrier, record.from || null, record.to || null, record.ended,
    record.formatVersion, JSON.stringify(storedContent(record)), JSON.stringify(record.original), record.changed, record.source,
    record.sourceFilename, record.extractSha256, record.extract ? JSON.stringify(record.extract) : null,
    record.createdBy, record.createdByName, record.createdAt, record.updatedBy, record.updatedByName, record.updatedAt,
    JSON.stringify(record.history),
  ];
}

export const INSERT_SQL = `insert into public.price_agreements
  (id, company_id, name, carrier, valid_from, valid_to, ended_at, format_version, rows, original, changed, source,
   source_filename, extract_sha256, extract, created_by, created_by_name, created_at, updated_by, updated_by_name, updated_at, history)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15::jsonb, $16, $17, $18, $19, $20, $21, $22::jsonb)`;

export const UPDATE_SQL = `update public.price_agreements
  set name = $3, carrier = $4, valid_from = $5, valid_to = $6, ended_at = $7, rows = $8::jsonb, changed = $9,
      updated_by = $10, updated_by_name = $11, updated_at = $12, history = $13::jsonb, format_version = $14
  where id = $1 and company_id = $2`;

export function updateParams(record: AgreementRecord): unknown[] {
  return [
    record.id, record.companyId, record.name, record.carrier, record.from || null, record.to || null, record.ended,
    JSON.stringify(storedContent(record)), record.changed, record.updatedBy, record.updatedByName, record.updatedAt, JSON.stringify(record.history),
    record.formatVersion,
  ];
}

const order = (left: AgreementRecord, right: AgreementRecord) => (right.from || right.createdAt).localeCompare(left.from || left.createdAt);

/** One company's agreements, or every company's when companyId is null (admins only). */
export async function listAgreements(companyId: string | null): Promise<{ agreements: AgreementRecord[]; store: AgreementStore }> {
  const rows = await withTable(() => companyId === null
    ? postgresSql<Row>("select * from public.price_agreements order by company_id, valid_from desc nulls last, created_at desc")
    : postgresSql<Row>("select * from public.price_agreements where company_id = $1 order by valid_from desc nulls last, created_at desc", [companyId]));
  if (rows) return { agreements: rows.map(fromRow), store: "postgres" };
  const kept = [...memory.values()].filter((record) => companyId === null || record.companyId === companyId);
  return { agreements: kept.sort(order), store: "memory" };
}

export async function readAgreement(id: string): Promise<AgreementRecord | null> {
  const rows = await withTable(() => postgresSql<Row>("select * from public.price_agreements where id = $1", [id]));
  if (rows) return rows[0] ? fromRow(rows[0]) : null;
  return memory.get(id) ?? null;
}

/** Inserts a new agreement. With `keepExisting`, an id that is already stored is left as it is and returned. */
export async function createAgreement(
  companyId: string,
  input: AgreementCreate,
  by: Actor,
  keepExisting = false,
): Promise<{ agreement: AgreementRecord; store: AgreementStore; existed: boolean }> {
  if (input.id) {
    const found = await readAgreement(input.id);
    if (found) {
      if (keepExisting && found.companyId === companyId) return { agreement: found, store: agreementStore(), existed: true };
      throw new Error("conflict");
    }
  }
  const extract = input.source === "pdf" && input.extractSha256 ? await cachedExtract(companyId, input.extractSha256, "agreement") : null;
  const record = newRecord(input, companyId, by, extract);
  const stored = await withTable(async () => {
    await ensureMailbox(companyId);
    await postgresSql(`${INSERT_SQL} on conflict (id) do nothing`, insertParams(record));
    return true;
  });
  if (stored) return { agreement: record, store: "postgres", existed: false };
  remember(record);
  return { agreement: record, store: "memory", existed: false };
}

export async function updateAgreement(previous: AgreementRecord, patch: AgreementPatch, by: Actor): Promise<{ agreement: AgreementRecord; store: AgreementStore }> {
  const record = patchRecord(previous, patch, by);
  if (record === previous) return { agreement: record, store: agreementStore() };
  const stored = await withTable(async () => {
    await postgresSql(UPDATE_SQL, updateParams(record));
    return true;
  });
  if (stored) return { agreement: record, store: "postgres" };
  remember(record);
  return { agreement: record, store: "memory" };
}

export async function deleteAgreement(record: AgreementRecord): Promise<AgreementStore> {
  memory.delete(record.id);
  const stored = await withTable(async () => {
    await postgresSql("delete from public.price_agreements where id = $1 and company_id = $2", [record.id, record.companyId]);
    return true;
  });
  return stored ? "postgres" : "memory";
}
