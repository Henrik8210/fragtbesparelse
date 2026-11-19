import { nextCheck, type CheckLine, type CheckSummary, type InvoiceCheck } from "../src/pilot/invoiceCheck.ts";
import { postgresSql, storesInPostgres } from "./db.ts";

export type CheckStore = "postgres" | "memory";

const MEMORY_KEEP = 2000;
const memory = new Map<string, InvoiceCheck>();
// When the table is missing, retry it now and then so creating it takes effect without a restart.
const RETRY_MS = 5 * 60 * 1000;
let missingSince = 0;

function key(companyId: string, fileId: string) {
  return `${companyId}\n${fileId}`;
}

function tableUsable(): boolean {
  return storesInPostgres() && (missingSince === 0 || Date.now() - missingSince > RETRY_MS);
}

function absent(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code: unknown }).code : "";
  const message = error instanceof Error ? error.message : String(error);
  return code === "42P01" || /invoice_checks.*does not exist|does not exist.*invoice_checks/i.test(message) || /DATABASE_URL is not set/.test(message);
}

export function checkStore(): CheckStore {
  return tableUsable() ? "postgres" : "memory";
}

type Row = {
  company_id: string;
  file_id: string;
  original: unknown;
  lines: unknown;
  changed: boolean;
  checked_by: string;
  checked_by_name: string;
  checked_at: Date | string;
  first_checked_at: Date | string;
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

function fromRow(row: Row): InvoiceCheck {
  return {
    companyId: row.company_id,
    fileId: row.file_id,
    original: json<CheckLine[]>(row.original),
    lines: json<CheckLine[]>(row.lines),
    changed: Boolean(row.changed),
    checkedBy: row.checked_by,
    checkedByName: row.checked_by_name,
    checkedAt: stamp(row.checked_at),
    firstCheckedAt: stamp(row.first_checked_at),
    history: json<InvoiceCheck["history"]>(row.history) ?? [],
  };
}

function summary(check: InvoiceCheck): CheckSummary {
  return { fileId: check.fileId, changed: check.changed, checkedByName: check.checkedByName, checkedAt: check.checkedAt };
}

function remember(check: InvoiceCheck) {
  const id = key(check.companyId, check.fileId);
  memory.delete(id);
  memory.set(id, check);
  while (memory.size > MEMORY_KEEP) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

export async function listChecks(companyId: string): Promise<{ checks: CheckSummary[]; store: CheckStore }> {
  if (tableUsable()) {
    try {
      const rows = await postgresSql<Pick<Row, "file_id" | "changed" | "checked_by_name" | "checked_at">>(
        "select file_id, changed, checked_by_name, checked_at from public.invoice_checks where company_id = $1",
        [companyId],
      );
      return {
        store: "postgres",
        checks: rows.map((row) => ({ fileId: row.file_id, changed: Boolean(row.changed), checkedByName: row.checked_by_name, checkedAt: stamp(row.checked_at) })),
      };
    } catch (error) {
      if (!absent(error)) throw error;
      missingSince = Date.now();
    }
  }
  return { store: "memory", checks: [...memory.values()].filter((check) => check.companyId === companyId).map(summary) };
}

export async function readCheck(companyId: string, fileId: string): Promise<InvoiceCheck | null> {
  if (tableUsable()) {
    try {
      const rows = await postgresSql<Row>("select * from public.invoice_checks where company_id = $1 and file_id = $2", [companyId, fileId]);
      return rows[0] ? fromRow(rows[0]) : null;
    } catch (error) {
      if (!absent(error)) throw error;
      missingSince = Date.now();
    }
  }
  return memory.get(key(companyId, fileId)) ?? null;
}

export async function saveCheck(input: {
  companyId: string;
  fileId: string;
  original: CheckLine[];
  lines: CheckLine[];
  by: string;
  name: string;
}): Promise<{ check: InvoiceCheck; store: CheckStore }> {
  const previous = await readCheck(input.companyId, input.fileId);
  const check = nextCheck(previous, { ...input, now: new Date() });
  if (tableUsable()) {
    try {
      await postgresSql(
        `insert into public.invoice_checks
           (company_id, file_id, original, lines, changed, checked_by, checked_by_name, checked_at, first_checked_at, history)
         values ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8, $9, $10::jsonb)
         on conflict (company_id, file_id) do update
         set lines = excluded.lines, changed = excluded.changed, checked_by = excluded.checked_by,
             checked_by_name = excluded.checked_by_name, checked_at = excluded.checked_at, history = excluded.history`,
        [
          check.companyId, check.fileId, JSON.stringify(check.original), JSON.stringify(check.lines), check.changed,
          check.checkedBy, check.checkedByName, check.checkedAt, check.firstCheckedAt, JSON.stringify(check.history),
        ],
      );
      return { check, store: "postgres" };
    } catch (error) {
      if (!absent(error)) throw error;
      missingSince = Date.now();
    }
  }
  remember(check);
  return { check, store: "memory" };
}
