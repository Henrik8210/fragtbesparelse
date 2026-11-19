import PostalMime from "postal-mime";
import type { Attachment, Email } from "postal-mime";
import { customers } from "../src/data/portfolio.ts";
import { carrierInDocument } from "../src/pilot/carrierName.ts";
import { postgresSql, publicDbError, storesInPostgres, withDatabase, type SqlQuery } from "./db.ts";
import { pdfText } from "./pdfText.ts";

export const MAIL_DOMAIN = "freightlytics.io";
export const MAX_MAIL_BYTES = 8_000_000;

const LOCAL_PART = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

export function invoiceAddress(companyId: string): string {
  return `${companyId}@${MAIL_DOMAIN}`;
}

export function isMailFileId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,80}$/.test(id);
}

export function decodeMailBody(raw: Buffer): Buffer | "bad" {
  const marker = Buffer.from('{"v":1,"raw":');
  if (raw.length < marker.length || !raw.subarray(0, marker.length).equals(marker)) return raw;
  try {
    const parsed = JSON.parse(raw.toString("utf8")) as { v?: unknown; raw?: unknown };
    if (parsed.v !== 1 || typeof parsed.raw !== "string" || parsed.raw.length === 0) return "bad";
    const bytes = Buffer.from(parsed.raw, "base64");
    if (bytes.length === 0) return "bad";
    return bytes;
  } catch {
    return "bad";
  }
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

export type MailFile = { id: string; filename: string; bytes: number; carrier: string };
export type MailItem = { id: string; sender: string; subject: string; receivedAt: string; files: MailFile[] };

const CARRIER_KEEP = 2000;
const fileCarriers = new Map<string, string>();

function rememberCarrier(fileId: string, carrier: string) {
  fileCarriers.set(fileId, carrier);
  while (fileCarriers.size > CARRIER_KEEP) {
    const oldest = fileCarriers.keys().next().value;
    if (oldest === undefined) break;
    fileCarriers.delete(oldest);
  }
}

/** Carrier printed in a PDF's text layer. Empty for other files and for PDFs that name none. */
export async function carrierFromFile(filename: string, bytes: Uint8Array): Promise<string> {
  const pdf = bytes.length > 5 && Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-";
  if (!pdf && !/\.(csv|tsv|txt)$/i.test(filename)) return "";
  try {
    const text = pdf ? await pdfText(bytes) : Buffer.from(bytes.subarray(0, 200_000)).toString("utf8");
    return carrierInDocument(text);
  } catch {
    return "";
  }
}

async function carriersFor(files: { id: string; filename: string }[]): Promise<void> {
  for (const file of files) {
    if (fileCarriers.has(file.id)) continue;
    const stored = await readInvoiceFile(file.id).catch(() => null);
    rememberCarrier(file.id, stored ? await carrierFromFile(stored.filename, stored.content) : "");
  }
}

export async function listInvoiceMail(companyId: string): Promise<{ ready: boolean; mails: MailItem[] }> {
  const [mails, files] = await Promise.all([
    postgresSql<{ id: string; sender: string; subject: string; received_at: Date | string }>(
      `select id, sender, subject, received_at
       from public.invoice_mail
       where company_id = $1
       order by received_at desc
       limit 40`,
      [companyId],
    ),
    postgresSql<{ id: string; mail_id: string; filename: string; byte_size: number }>(
      `select id, mail_id, filename, byte_size
       from public.invoice_mail_files
       where company_id = $1
       order by filename`,
      [companyId],
    ),
  ]);
  const listed = new Set(mails.map((mail) => mail.id));
  await carriersFor(files.filter((file) => listed.has(file.mail_id)));
  return {
    ready: true,
    mails: mails.map((mail) => ({
      id: mail.id,
      sender: mail.sender,
      subject: mail.subject,
      receivedAt: receivedStamp(mail.received_at),
      files: files.filter((file) => file.mail_id === mail.id).map((file) => ({
        id: file.id,
        filename: file.filename,
        bytes: Number(file.byte_size),
        carrier: fileCarriers.get(file.id) ?? "",
      })),
    })),
  };
}

export async function readInvoiceFile(id: string): Promise<{ filename: string; companyId: string; content: Buffer } | null> {
  const rows = await postgresSql<{ filename: string; company_id: string; content: unknown }>(
    "select filename, company_id, content from public.invoice_mail_files where id = $1 and company_id is not null",
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return { filename: row.filename, companyId: row.company_id, content: asBuffer(row.content) };
}

export async function invoiceFileCompany(id: string): Promise<string | null> {
  const rows = await postgresSql<{ company_id: string }>("select company_id from public.invoice_mail_files where id = $1", [id]);
  return rows[0]?.company_id ?? null;
}

export type AcceptedMail =
  | { result: "stored"; id: string; companyId: string; postgres: boolean }
  | { result: "database"; message: string }
  | { result: "unknown" | "later" | "large" | "bad" };

export async function acceptInvoiceMail(recipient: string, sender: string, raw: Buffer): Promise<AcceptedMail> {
  if (!Buffer.isBuffer(raw)) return { result: "bad" };
  if (raw.length > MAX_MAIL_BYTES) return { result: "large" };
  const companyId = companyIdFromRecipient(recipient);
  if (!companyId) return { result: "unknown" };
  let mailbox: "ok" | "unknown";
  try {
    mailbox = await ensureMailbox(companyId);
  } catch (error) {
    return { result: "database", message: publicDbError(error) };
  }
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
    await withDatabase(async (query) => {
      await query(
        "insert into public.invoice_mail (id, company_id, sender, subject) values ($1, $2, $3, $4)",
        [mailId, companyId, from, subject],
      );
      for (const file of files) {
        await insertFile(query, mailId, companyId, file);
      }
    });
  } catch (error) {
    await dropMail(mailId, companyId);
    return { result: "database", message: publicDbError(error) };
  }
  try {
    const seen = await postgresSql<{ id: string }>("select id from public.invoice_mail where id = $1 and company_id = $2", [mailId, companyId]);
    const saved = await postgresSql<{ id: string }>("select id from public.invoice_mail_files where mail_id = $1 and company_id = $2", [mailId, companyId]);
    if (!seen[0] || saved.length === 0) {
      await dropMail(mailId, companyId);
      return { result: "database", message: "invoice mail was not stored" };
    }
  } catch (error) {
    await dropMail(mailId, companyId);
    return { result: "database", message: publicDbError(error) };
  }
  return { result: "stored", id: mailId, companyId, postgres: storesInPostgres() };
}

const UPLOAD_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  txt: "text/plain",
  xml: "application/xml",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function uploadType(filename: string, bytes: Uint8Array): string | null {
  const extension = filename.toLowerCase().match(/\.([a-z]+)$/)?.[1] ?? "";
  const mime = UPLOAD_TYPES[extension];
  if (!mime) return null;
  const pdf = bytes.length > 5 && Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-";
  if ((extension === "pdf") !== pdf) return null;
  return mime;
}

export type UploadedInvoice =
  | { result: "stored"; mail: MailItem }
  | { result: "type" | "empty" | "large" | "unknown" }
  | { result: "database"; message: string };

/** A file added by hand on Fakturaer. It is stored as a mail row so the list, the viewer and the PDF read treat it like received mail. */
export async function storeUploadedInvoice(companyId: string, uploader: string, filename: string, bytes: Buffer): Promise<UploadedInvoice> {
  if (bytes.length === 0) return { result: "empty" };
  if (bytes.length > MAX_MAIL_BYTES) return { result: "large" };
  const name = fileName(filename, "");
  const mime = uploadType(name, bytes);
  if (!mime || name === "vedhaeftning") return { result: "type" };
  try {
    if ((await ensureMailbox(companyId)) !== "ok") return { result: "unknown" };
  } catch (error) {
    return { result: "database", message: publicDbError(error) };
  }
  const mailId = crypto.randomUUID();
  const subject = clean(name.replace(/\.[^.]+$/, ""), 200) || name;
  const sender = clean(`Uploadet af ${uploader}`, 200);
  let fileId = "";
  try {
    await withDatabase(async (query) => {
      await query(
        "insert into public.invoice_mail (id, company_id, sender, subject) values ($1, $2, $3, $4)",
        [mailId, companyId, sender, subject],
      );
      fileId = await insertFile(query, mailId, companyId, { name, mime, bytes });
    });
    const rows = await postgresSql<{ received_at: Date | string }>(
      `select m.received_at from public.invoice_mail m
       join public.invoice_mail_files f on f.mail_id = m.id and f.company_id = m.company_id
       where m.id = $1 and m.company_id = $2 and f.id = $3`,
      [mailId, companyId, fileId],
    );
    if (!rows[0]) {
      await dropMail(mailId, companyId);
      return { result: "database", message: "invoice file was not stored" };
    }
    const carrier = await carrierFromFile(name, bytes);
    rememberCarrier(fileId, carrier);
    return {
      result: "stored",
      mail: {
        id: mailId,
        sender,
        subject,
        receivedAt: receivedStamp(rows[0].received_at),
        files: [{ id: fileId, filename: name, bytes: bytes.length, carrier }],
      },
    };
  } catch (error) {
    await dropMail(mailId, companyId);
    return { result: "database", message: publicDbError(error) };
  }
}

export function invoiceMailReply(result: AcceptedMail, inPostgres = storesInPostgres()): { status: number; body: Record<string, unknown> } {
  if (result.result === "stored" && result.postgres && result.id) {
    return { status: 200, body: { ok: true, id: result.id, companyId: result.companyId, postgres: true } };
  }
  if (result.result === "database") return { status: 503, body: { error: "database", message: result.message } };
  if (result.result === "large") return { status: 413, body: { error: "large" } };
  if (result.result === "bad") return { status: 400, body: { error: "mail" } };
  if (result.result === "unknown") return { status: 404, body: { error: "unknown" } };
  if (!inPostgres || result.result === "stored") return { status: 503, body: { error: "database", message: "DATABASE_URL is not set" } };
  return { status: 503, body: { error: "later", message: "invoice mail was not stored" } };
}

function senderLine(parsed: Email | null): string {
  const from = parsed?.from;
  if (!from || typeof from !== "object" || typeof from.address !== "string" || !from.address.trim()) return "";
  const name = typeof from.name === "string" ? from.name.trim() : "";
  const address = from.address.trim();
  return name ? `${name} <${address}>` : address;
}

async function dropMail(mailId: string, companyId: string): Promise<void> {
  await postgresSql("delete from public.invoice_mail_files where mail_id = $1 and company_id = $2", [mailId, companyId]).catch(() => undefined);
  await postgresSql("delete from public.invoice_mail where id = $1 and company_id = $2", [mailId, companyId]).catch(() => undefined);
}

async function ensureMailbox(companyId: string): Promise<"ok" | "unknown"> {
  const found = await postgresSql("select id from public.companies where id = $1", [companyId]);
  if (found[0]) return "ok";
  const sample = customers.find((company) => company.id === companyId);
  if (!sample) return "unknown";
  await postgresSql(
    `insert into public.companies (id, name, industry, place) values ($1, $2, $3, $4)
     on conflict (id) do nothing`,
    [sample.id, sample.name, sample.industry, sample.place],
  );
  return "ok";
}

async function insertFile(query: SqlQuery, mailId: string, companyId: string, file: { name: string; mime: string; bytes: Buffer }): Promise<string> {
  const id = crypto.randomUUID();
  const values = [id, mailId, companyId, file.name, file.mime, file.bytes.length];
  const encoded = file.bytes.toString("base64");
  await query("savepoint file_insert");
  try {
    await query(
      `insert into public.invoice_mail_files (id, mail_id, company_id, filename, mime, byte_size, content)
       values ($1, $2, $3, $4, $5, $6, decode($7, 'base64'))`,
      [...values, encoded],
    );
    await query("release savepoint file_insert");
  } catch (error) {
    await query("rollback to savepoint file_insert");
    if (missingTable(error)) throw error;
    await query(
      `insert into public.invoice_mail_files (id, mail_id, company_id, filename, mime, byte_size, content)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [...values, file.bytes],
    );
  }
  return id;
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

function receivedStamp(value: Date | string): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text)) return `${text.replace(" ", "T")}Z`;
  return text;
}

function missingTable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "42P01";
}
