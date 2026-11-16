import PostalMime from "postal-mime";
import type { Attachment, Email } from "postal-mime";
import { customers } from "../src/data/portfolio.ts";
import { reconnectDatabase, sql, storesInPostgres } from "./db.ts";

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

export type AcceptedMail =
  | { result: "stored"; id: string; companyId: string; postgres: boolean }
  | { result: "unknown" | "later" | "large" | "bad" };

export async function acceptInvoiceMail(recipient: string, sender: string, raw: Buffer): Promise<AcceptedMail> {
  if (!Buffer.isBuffer(raw)) return { result: "bad" };
  if (raw.length > MAX_MAIL_BYTES) return { result: "large" };
  await reconnectDatabase();
  const companyId = companyIdFromRecipient(recipient);
  if (!companyId) return { result: "unknown" };
  const mailbox = await ensureMailbox(companyId);
  if (mailbox !== "ok") return { result: mailbox };

  let parsed: Email | null = null;
  try {
    parsed = await PostalMime.parse(raw);
  } catch {
    parsed = null;
  }
  let files: { name: string; mime: string; bytes: Buffer }[] = [];
  if (parsed) {
    try {
      const collected = filesFrom(parsed);
      if (collected === "large") return { result: "large" };
      files = collected;
    } catch {
      files = [];
    }
  }
  if (files.length === 0 && raw.length > 0) {
    files.push({ name: "besked.eml", mime: "message/rfc822", bytes: raw });
  }

  const mailId = crypto.randomUUID();
  const subject = clean(textOrEmpty(parsed?.subject) || subjectFromRaw(raw), 200) || "(uden emne)";
  const from = clean(senderLine(parsed) || sender, 200) || "ukendt";
  try {
    await sql(
      "insert into invoice_mail (id, company_id, sender, subject) values ($1, $2, $3, $4)",
      [mailId, companyId, from, subject],
    );
    for (const file of files) {
      await insertFile(mailId, companyId, file);
    }
  } catch (error) {
    await dropMail(mailId, companyId);
    if (missingTable(error)) return { result: "later" };
    return { result: "later" };
  }
  try {
    const seen = await sql<{ id: string }>("select id from invoice_mail where id = $1 and company_id = $2", [mailId, companyId]);
    const saved = await sql<{ id: string }>("select id from invoice_mail_files where mail_id = $1 and company_id = $2", [mailId, companyId]);
    if (!seen[0] || saved.length === 0) {
      await dropMail(mailId, companyId);
      return { result: "later" };
    }
  } catch {
    return { result: "stored", id: mailId, companyId, postgres: storesInPostgres() };
  }
  return { result: "stored", id: mailId, companyId, postgres: storesInPostgres() };
}

function senderLine(parsed: Email | null): string {
  const from = parsed?.from;
  if (!from || typeof from !== "object" || typeof from.address !== "string" || !from.address.trim()) return "";
  const name = typeof from.name === "string" ? from.name.trim() : "";
  const address = from.address.trim();
  return name ? `${name} <${address}>` : address;
}

async function dropMail(mailId: string, companyId: string): Promise<void> {
  await sql("delete from invoice_mail_files where mail_id = $1 and company_id = $2", [mailId, companyId]).catch(() => undefined);
  await sql("delete from invoice_mail where id = $1 and company_id = $2", [mailId, companyId]).catch(() => undefined);
}

async function ensureMailbox(companyId: string): Promise<"ok" | "unknown" | "later"> {
  try {
    const found = await sql("select id from companies where id = $1", [companyId]);
    if (found[0]) return "ok";
    const sample = customers.find((company) => company.id === companyId);
    if (!sample) return "unknown";
    await sql(
      `insert into companies (id, name, industry, place) values ($1, $2, $3, $4)
       on conflict (id) do nothing`,
      [sample.id, sample.name, sample.industry, sample.place],
    );
    return "ok";
  } catch (error) {
    if (missingTable(error)) return "later";
    return "later";
  }
}

async function insertFile(mailId: string, companyId: string, file: { name: string; mime: string; bytes: Buffer }): Promise<void> {
  const values = [crypto.randomUUID(), mailId, companyId, file.name, file.mime, file.bytes.length];
  try {
    await sql(
      `insert into invoice_mail_files (id, mail_id, company_id, filename, mime, byte_size, content)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [...values, file.bytes],
    );
  } catch (error) {
    if (missingTable(error)) throw error;
    await sql("rollback").catch(() => undefined);
    await sql(
      `insert into invoice_mail_files (id, mail_id, company_id, filename, mime, byte_size, content)
       values ($1, $2, $3, $4, $5, $6, decode($7, 'base64'))`,
      [...values, file.bytes.toString("base64")],
    );
  }
}

function filesFrom(parsed: Email): { name: string; mime: string; bytes: Buffer }[] | "large" {
  const files: { name: string; mime: string; bytes: Buffer }[] = [];
  let total = 0;
  const attachments = Array.isArray(parsed.attachments) ? parsed.attachments.slice(0, 20) : [];
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== "object") continue;
    let file: { name: string; mime: string; bytes: Buffer } | null = null;
    try {
      file = fileFrom(attachment);
    } catch {
      file = null;
    }
    if (!file) continue;
    total += file.bytes.length;
    if (file.bytes.length > MAX_MAIL_BYTES || total > MAX_MAIL_BYTES) return "large";
    files.push(file);
  }
  return files;
}

function fileFrom(attachment: Attachment): { name: string; mime: string; bytes: Buffer } | null {
  const mime = textOrEmpty(attachment.mimeType);
  const filename = textOrEmpty(attachment.filename);
  const disposition = textOrEmpty(attachment.disposition);
  if (!wanted(disposition || null, mime, filename || null)) return null;
  let bytes: Buffer;
  try {
    bytes = contentBytes(attachment.content, textOrEmpty(attachment.encoding));
  } catch {
    return null;
  }
  if (bytes.length === 0) return null;
  return {
    name: fileName(filename || null, mime),
    mime: mime.slice(0, 120) || "application/octet-stream",
    bytes,
  };
}

function textOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function wanted(disposition: string | null, mime: string, filename: string | null): boolean {
  const name = (filename ?? "").toLowerCase();
  const invoice = mime === "application/pdf"
    || mime === "text/csv"
    || mime === "application/xml"
    || mime === "text/xml"
    || mime === "application/vnd.ms-excel"
    || mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    || name.endsWith(".pdf")
    || name.endsWith(".csv")
    || name.endsWith(".xml")
    || name.endsWith(".xls")
    || name.endsWith(".xlsx");
  if (mime.startsWith("image/") && disposition !== "attachment" && !invoice) return false;
  if (disposition === "attachment" || invoice) return true;
  return false;
}

function contentBytes(content: ArrayBuffer | Uint8Array | string | undefined, encoding?: string): Buffer {
  if (content == null) return Buffer.alloc(0);
  if (typeof content === "string") return Buffer.from(content, encoding === "base64" ? "base64" : "utf8");
  if (content instanceof Uint8Array) return Buffer.from(content);
  return Buffer.from(new Uint8Array(content));
}

function subjectFromRaw(raw: Buffer): string {
  const head = raw.subarray(0, Math.min(raw.length, 8000)).toString("latin1");
  const match = head.match(/^Subject:[ \t]*([^\r\n]+)/im);
  return match?.[1]?.trim() ?? "";
}

function fileName(name: string | null, mime: string): string {
  const base = (name ?? "").split(/[/\\]/).pop() ?? "";
  const cleaned = clean(base, 120).replace(/[^\w.\- ()æøåÆØÅ]+/g, "");
  if (cleaned) return cleaned;
  if (mime === "application/pdf") return "faktura.pdf";
  return "vedhaeftning";
}

function clean(value: unknown, max: number): string {
  const text = typeof value === "string" ? value : "";
  let cleaned = "";
  for (const char of text) {
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
