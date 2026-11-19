import { carrierFromMail } from "../src/pilot/carrierName.ts";
import type { SqlQuery } from "./db.ts";

export type NoticeKind = "demo" | "invoice" | "format_change";

export type NoticeDetail = {
  docKind: string;
  change: string;
  fileId: string;
  mailId: string;
  filename: string;
  reasons: string[];
};

export type Notice = {
  id: string;
  kind: NoticeKind;
  name: string;
  company: string;
  email: string;
  subject: string;
  createdAt: string;
  seenAt: string | null;
  detail?: NoticeDetail;
};

export type NoticeReader = { role: "admin" | "customer"; company_id: string | null };

type Row = {
  id: string;
  kind: string;
  name: string;
  company: string;
  email: string;
  subject: string | null;
  detail?: unknown;
  created_at: Date | string;
  seen_at: Date | string | null;
};

// A format_change notice is admin-only: name is the carrier, company the company whose document showed it, email the invoice_mail id.
// For an invoice notice the row id is the invoice_mail id, name is the carrier, company is the company id and email is the sender.
export async function recordInvoiceNotice(
  query: SqlQuery,
  mail: { id: string; companyId: string; sender: string; subject: string; files: { filename: string; carrier?: string }[] },
): Promise<void> {
  const carrier = carrierFromMail({ sender: mail.sender, subject: mail.subject, files: mail.files });
  await query(
    `insert into notifications (id, kind, name, company, email)
     values ($1, 'invoice', $2, $3, $4)
     on conflict (id) do nothing`,
    [mail.id, carrier, mail.companyId, mail.sender],
  );
}

function scope(reader: NoticeReader): { where: string; params: unknown[] } | null {
  if (reader.role === "admin") return { where: "n.kind in ('demo', 'invoice', 'format_change')", params: [] };
  if (!reader.company_id) return null;
  return { where: "n.kind = 'invoice' and n.company = $1", params: [reader.company_id] };
}

function stamp(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text)) {
    const zoned = /[+-]\d{2}(:?\d{2})?$|Z$/.test(text);
    const parsed = new Date(`${text.replace(" ", "T")}${zoned ? "" : "Z"}`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return text;
}

function detailOf(value: unknown): NoticeDetail | undefined {
  const parsed = typeof value === "string" ? (() => { try { return JSON.parse(value) as unknown; } catch { return null; } })() : value;
  if (!parsed || typeof parsed !== "object") return undefined;
  const item = parsed as Record<string, unknown>;
  const text = (key: string) => (typeof item[key] === "string" ? item[key] as string : "");
  return {
    docKind: text("docKind"),
    change: text("change"),
    fileId: text("fileId"),
    mailId: text("mailId"),
    filename: text("filename"),
    reasons: Array.isArray(item.reasons) ? item.reasons.filter((reason): reason is string => typeof reason === "string").slice(0, 8) : [],
  };
}

function fromRow(row: Row): Notice {
  const kind: NoticeKind = row.kind === "invoice" || row.kind === "format_change" ? row.kind : "demo";
  const detail = kind === "format_change" ? detailOf(row.detail) : undefined;
  return {
    id: row.id,
    kind,
    name: row.name,
    company: row.company,
    email: row.email,
    subject: row.subject ?? "",
    createdAt: stamp(row.created_at),
    seenAt: row.seen_at ? stamp(row.seen_at) : null,
    ...(detail ? { detail } : {}),
  };
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? (error as { code: unknown }).code : "";
}

function missingTable(error: unknown): boolean {
  return errorCode(error) === "42P01";
}

const missingColumn = (error: unknown) => errorCode(error) === "42703";

// Until the detail column is added, skip asking for it for a while instead of failing a query on every bell poll.
const DETAIL_RETRY_MS = 5 * 60 * 1000;
const detailMissingSince = new WeakMap<SqlQuery, number>();

/** Unseen notices for the bell, or every notice with `all`. An admin reads every company; a company seat reads its own invoices. */
export async function listNotices(query: SqlQuery, reader: NoticeReader, options: { all?: boolean } = {}): Promise<Notice[]> {
  const visible = scope(reader);
  if (!visible) return [];
  const where = options.all ? visible.where : `${visible.where} and n.seen_at is null`;
  const limit = options.all ? 200 : 20;
  // notifications.detail and invoice_mail are optional: each query drops what is missing.
  const queries = [
    { detail: "n.detail", join: true },
    { detail: "null as detail", join: true },
    { detail: "null as detail", join: false },
  ];
  let lastError: unknown = null;
  const skipDetail = Date.now() - (detailMissingSince.get(query) ?? 0) < DETAIL_RETRY_MS;
  for (const variant of skipDetail ? queries.slice(1) : queries) {
    try {
      const rows = await query<Row>(
        `select n.id, n.kind, n.name, n.company, n.email, ${variant.join ? "m.subject" : "null as subject"}, ${variant.detail}, n.created_at, n.seen_at
         from notifications n
         ${variant.join ? "left join invoice_mail m on n.kind = 'invoice' and m.id = n.id and m.company_id = n.company" : ""}
         where ${where}
         order by n.created_at desc
         limit ${limit}`,
        visible.params,
      );
      if (variant.detail === "n.detail") detailMissingSince.delete(query);
      return rows.map(fromRow);
    } catch (error) {
      if (!missingColumn(error) && !missingTable(error)) throw error;
      if (variant.detail === "n.detail" && missingColumn(error)) detailMissingSince.set(query, Date.now());
      lastError = error;
    }
  }
  if (missingTable(lastError)) return [];
  throw lastError;
}

export async function markNoticeSeen(query: SqlQuery, reader: NoticeReader, id: string): Promise<void> {
  const visible = scope(reader);
  if (!visible) return;
  try {
    await query(
      `update notifications n set seen_at = now()
       where n.id = $${visible.params.length + 1} and n.seen_at is null and ${visible.where}`,
      [...visible.params, id],
    );
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
}
