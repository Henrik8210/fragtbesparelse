import { carrierFromMail } from "../src/pilot/carrierName.ts";
import type { SqlQuery } from "./db.ts";

export type NoticeKind = "demo" | "invoice";

export type Notice = {
  id: string;
  kind: NoticeKind;
  name: string;
  company: string;
  email: string;
  subject: string;
  createdAt: string;
  seenAt: string | null;
};

export type NoticeReader = { role: "admin" | "customer"; company_id: string | null };

type Row = {
  id: string;
  kind: string;
  name: string;
  company: string;
  email: string;
  subject: string | null;
  created_at: Date | string;
  seen_at: Date | string | null;
};

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
  if (reader.role === "admin") return { where: "n.kind in ('demo', 'invoice')", params: [] };
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

function fromRow(row: Row): Notice {
  return {
    id: row.id,
    kind: row.kind === "invoice" ? "invoice" : "demo",
    name: row.name,
    company: row.company,
    email: row.email,
    subject: row.subject ?? "",
    createdAt: stamp(row.created_at),
    seenAt: row.seen_at ? stamp(row.seen_at) : null,
  };
}

function missingTable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "42P01";
}

/** Unseen notices for the bell, or every notice with `all`. An admin reads every company; a company seat reads its own invoices. */
export async function listNotices(query: SqlQuery, reader: NoticeReader, options: { all?: boolean } = {}): Promise<Notice[]> {
  const visible = scope(reader);
  if (!visible) return [];
  const where = options.all ? visible.where : `${visible.where} and n.seen_at is null`;
  const limit = options.all ? 200 : 20;
  try {
    const rows = await query<Row>(
      `select n.id, n.kind, n.name, n.company, n.email, m.subject, n.created_at, n.seen_at
       from notifications n
       left join invoice_mail m on n.kind = 'invoice' and m.id = n.id and m.company_id = n.company
       where ${where}
       order by n.created_at desc
       limit ${limit}`,
      visible.params,
    );
    return rows.map(fromRow);
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  try {
    const rows = await query<Row>(
      `select n.id, n.kind, n.name, n.company, n.email, null as subject, n.created_at, n.seen_at
       from notifications n
       where ${where}
       order by n.created_at desc
       limit ${limit}`,
      visible.params,
    );
    return rows.map(fromRow);
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
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
