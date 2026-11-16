import PostalMime from "postal-mime";
import { sql } from "./db.ts";

export const MAIL_DOMAIN = "freightlytics.io";
export const MAX_MAIL_BYTES = 8_000_000;

const LOCAL_PART = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

export function invoiceAddress(companyId: string): string {
  return `${companyId}@${MAIL_DOMAIN}`;
}

export function companyIdFromRecipient(recipient: string): string | null {
  const trimmed = recipient.trim().toLowerCase();
  const angled = trimmed.match(/<([^>]+)>\s*$/);
  const address = (angled?.[1] ?? trimmed).trim();
  const at = address.lastIndexOf("@");
  if (at <= 0) return null;
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  if (domain !== MAIL_DOMAIN || !LOCAL_PART.test(local)) return null;
  return local;
}

export type MailFile = { id: string; filename: string; bytes: number };
export type MailItem = { id: string; sender: string; subject: string; receivedAt: string; files: MailFile[] };

export async function listInvoiceMail(companyId: string): Promise<{ ready: boolean; mails: MailItem[] }> {
  try {
    const mails = await sql<{ id: string; sender: string; subject: string; received_at: Date | string }>(
      `select id, sender, subject, received_at
       from invoice_mail
       where company_id = $1
       order by received_at desc
       limit 40`,
      [companyId],
    );
    const ids = mails.map((mail) => mail.id);
    const marks = ids.map((_, index) => `$${index + 2}`).join(", ");
    const files = ids.length === 0
      ? []
      : await sql<{ id: string; mail_id: string; filename: string; byte_size: number }>(
        `select id, mail_id, filename, byte_size
         from invoice_mail_files
         where company_id = $1 and mail_id in (${marks})
         order by filename`,
        [companyId, ...ids],
      );
    return {
      ready: true,
      mails: mails.map((mail) => ({
        id: mail.id,
        sender: mail.sender,
        subject: mail.subject,
        receivedAt: String(mail.received_at),
        files: files.filter((file) => file.mail_id === mail.id).map((file) => ({
          id: file.id,
          filename: file.filename,
          bytes: Number(file.byte_size),
        })),
      })),
    };
  } catch (error) {
    if (missingTable(error)) return { ready: false, mails: [] };
    throw error;
  }
}

export async function readInvoiceFile(id: string): Promise<{ filename: string; companyId: string; content: Buffer } | null> {
  try {
    const rows = await sql<{ filename: string; company_id: string; content: unknown }>(
      "select filename, company_id, content from invoice_mail_files where id = $1 and company_id is not null",
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    return { filename: row.filename, companyId: row.company_id, content: asBuffer(row.content) };
  } catch (error) {
    if (missingTable(error)) return null;
    throw error;
  }
}

export async function acceptInvoiceMail(recipient: string, sender: string, raw: Buffer): Promise<"stored" | "unknown" | "later" | "large" | "bad"> {
  if (raw.length > MAX_MAIL_BYTES) return "large";
  const companyId = companyIdFromRecipient(recipient);
  if (!companyId) return "unknown";
  let parsed;
  try {
    parsed = await PostalMime.parse(raw);
  } catch {
    return "bad";
  }
  const files: { name: string; mime: string; bytes: Buffer }[] = [];
  for (const attachment of (parsed.attachments ?? []).slice(0, 20)) {
    if (!wanted(attachment.disposition, attachment.mimeType)) continue;
    const bytes = contentBytes(attachment.content);
    if (bytes.length > MAX_MAIL_BYTES) return "large";
    if (bytes.length === 0) continue;
    files.push({
      name: fileName(attachment.filename, attachment.mimeType),
      mime: attachment.mimeType.slice(0, 120) || "application/octet-stream",
      bytes,
    });
  }
  if (files.reduce((sum, file) => sum + file.bytes.length, 0) > MAX_MAIL_BYTES) return "large";

  let company;
  try {
    company = await sql("select id from companies where id = $1", [companyId]);
  } catch (error) {
    if (missingTable(error)) return "later";
    throw error;
  }
  if (!company[0]) return "unknown";

  const mailId = crypto.randomUUID();
  const subject = clean(parsed.subject ?? "", 200) || "(uden emne)";
  const from = clean(sender, 200) || "ukendt";
  try {
    await sql(
      "insert into invoice_mail (id, company_id, sender, subject) values ($1, $2, $3, $4)",
      [mailId, companyId, from, subject],
    );
    for (const file of files) {
      await sql(
        `insert into invoice_mail_files (id, mail_id, company_id, filename, mime, byte_size, content)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [crypto.randomUUID(), mailId, companyId, file.name, file.mime, file.bytes.length, file.bytes],
      );
    }
  } catch (error) {
    if (!missingTable(error)) {
      await sql("delete from invoice_mail where id = $1 and company_id = $2", [mailId, companyId]).catch(() => undefined);
    }
    if (missingTable(error)) return "later";
    throw error;
  }
  return "stored";
}

function wanted(disposition: string | null, mime: string): boolean {
  if (mime.startsWith("image/") && disposition !== "attachment") return false;
  if (disposition === "attachment") return true;
  return mime === "application/pdf"
    || mime === "text/csv"
    || mime === "application/xml"
    || mime === "text/xml"
    || mime === "application/vnd.ms-excel"
    || mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

function contentBytes(content: ArrayBuffer | Uint8Array | string): Buffer {
  if (typeof content === "string") return Buffer.from(content);
  if (content instanceof Uint8Array) return Buffer.from(content);
  return Buffer.from(new Uint8Array(content));
}

function fileName(name: string | null, mime: string): string {
  const base = (name ?? "").split(/[/\\]/).pop() ?? "";
  const cleaned = clean(base, 120).replace(/[^\w.\- ()æøåÆØÅ]+/g, "");
  if (cleaned) return cleaned;
  if (mime === "application/pdf") return "faktura.pdf";
  return "vedhaeftning";
}

function clean(value: string, max: number): string {
  let cleaned = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    cleaned += code < 32 || code === 127 ? " " : char;
  }
  return cleaned.replace(/\s+/g, " ").trim().slice(0, max);
}

function asBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") {
    const hex = value.startsWith("\\x") ? value.slice(2) : value;
    return Buffer.from(hex, "hex");
  }
  return Buffer.alloc(0);
}

function missingTable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "42P01";
}
