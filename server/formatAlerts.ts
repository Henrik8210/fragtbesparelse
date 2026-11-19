import { createHash } from "node:crypto";
import { carrierIn } from "../src/pilot/carrierName.ts";
import {
  assessDocument, editedLineCount, emptyProfile, learnLayout,
  type CarrierProfile, type DocumentKind, type ExtractSignals, type FormatFinding, type LayoutFingerprint,
} from "../src/pilot/formatDrift.ts";
import { lineChanges, type InvoiceCheck } from "../src/pilot/invoiceCheck.ts";
import { EXTRACT_VERSION, type InvoiceExtract } from "../src/pilot/invoiceExtract.ts";
import { AGREEMENT_CACHE_PREFIX, AGREEMENT_EXTRACT_VERSION, type AgreementExtract } from "../src/pilot/agreementExtract.ts";
import { editedPriceCount, type AgreementRecord } from "../src/pilot/agreementRecord.ts";
import { postgresSql, storesInPostgres, type SqlQuery } from "./db.ts";
import { cachedExtract, sha256Of } from "./invoiceExtract.ts";
import { readInvoiceFile } from "./invoiceMail.ts";

/**
 * Admin-only notices when a carrier's document format changes. Layouts are learned per carrier across every company,
 * from the `layout` each extract carries in invoice_extracts, so a restart rebuilds them without a table of its own.
 *
 * Price agreements plug in through `observeDocument` with kind "agreement": pass the agreement's carrier, a
 * `layoutFingerprint(text, rateLabels)` and its own signals (unmapped rate columns, rates not printed verbatim,
 * low confidence, lines changed in review). Profiles and notice ids are kept apart by kind.
 */

export type FormatNoticeDetail = {
  docKind: DocumentKind;
  change: FormatFinding["change"];
  fileId: string;
  mailId: string;
  filename: string;
  reasons: string[];
};

export type ObservedDocument = {
  kind: DocumentKind;
  companyId: string;
  /** Stable id for this document, so a re-read does not count twice. */
  documentId: string;
  carrier: string;
  filename: string;
  fileId?: string;
  fingerprint: LayoutFingerprint | null;
  signals: ExtractSignals;
};

const profiles = new Map<string, CarrierProfile>();
const loaded = new Map<DocumentKind, Promise<void>>();
const files = new Map<string, { carrier: string; documentId: string; fingerprint: LayoutFingerprint | null; lines: number; filename: string }>();
const jobFiles = new Map<string, { companyId: string; fileId: string; expires: number }>();
const FILES_KEEP = 2000;
const JOB_TTL_MS = 5 * 60 * 1000;
const UNKNOWN = "Ukendt transportør";

let query: SqlQuery = (text, params) => postgresSql(text, params);
let inPostgres = () => storesInPostgres();

/** Tests swap the database. */
export function setFormatDatabase(next: SqlQuery, postgres = true): void {
  query = next;
  inPostgres = () => postgres;
  profiles.clear();
  loaded.clear();
  files.clear();
}

export function carrierKey(carrier: string): string {
  return carrierIn(carrier) || carrier.replace(/\s+/g, " ").trim().slice(0, 70) || UNKNOWN;
}

function profileFor(kind: DocumentKind, carrier: string): CarrierProfile {
  const key = `${kind}\n${carrier.toLowerCase()}`;
  let profile = profiles.get(key);
  if (!profile) {
    profile = emptyProfile(kind, carrier);
    profiles.set(key, profile);
  }
  return profile;
}

/** Notice ids are uuid-shaped so the bell's seen route accepts them. */
export function formatNoticeId(kind: DocumentKind, carrier: string, key: string): string {
  const hex = createHash("sha256").update(`format_change|${kind}|${carrier.toLowerCase()}|${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function code(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
}

/**
 * Learns earlier layouts of one kind once per process, leaving out the document being observed. Agreement extracts
 * share invoice_extracts under the `agreement:` prefix, so each kind reads only its own rows.
 */
function loadLayouts(kind: DocumentKind, skipKey: string): Promise<void> {
  const existing = loaded.get(kind);
  if (existing) return existing;
  const agreement = kind === "agreement";
  const run = (async () => {
    if (!inPostgres()) return;
    try {
      const rows = await query<{ company_id: string; content_sha256: string; extract: unknown }>(
        `select company_id, content_sha256, extract from public.invoice_extracts
         where version = $1 and content_sha256 <> $2 and extract ? 'layout'
           and (content_sha256 like $3) = $4
         order by created_at asc
         limit 2000`,
        [agreement ? AGREEMENT_EXTRACT_VERSION : EXTRACT_VERSION, skipKey, `${AGREEMENT_CACHE_PREFIX}%`, agreement],
      );
      for (const row of rows) {
        const extract = (typeof row.extract === "string" ? JSON.parse(row.extract) : row.extract) as { carrier: string; layout?: LayoutFingerprint };
        if (!extract?.layout) continue;
        learnLayout(profileFor(kind, carrierKey(extract.carrier)), extract.layout, `${row.company_id}:${row.content_sha256}`);
      }
    } catch {
      // No invoice_extracts table: layouts are learned from this process's extracts only.
    }
  })();
  loaded.set(kind, run);
  return run;
}

const loadInvoiceLayouts = (skipSha: string) => loadLayouts("invoice", skipSha);

async function mailIdOf(fileId: string, companyId: string): Promise<string> {
  if (!fileId) return "";
  try {
    const rows = await query<{ mail_id: string }>(
      "select mail_id from public.invoice_mail_files where id = $1 and company_id = $2",
      [fileId, companyId],
    );
    return rows[0]?.mail_id ?? "";
  } catch {
    return "";
  }
}

/** One row per finding key. A missing detail column still records the notice; a missing table records nothing. */
export async function recordFormatNotice(finding: FormatFinding, document: Pick<ObservedDocument, "companyId" | "fileId" | "filename">): Promise<string | null> {
  const id = formatNoticeId(finding.kind, finding.carrier, finding.key);
  const fileId = document.fileId ?? "";
  const mailId = await mailIdOf(fileId, document.companyId);
  const detail: FormatNoticeDetail = { docKind: finding.kind, change: finding.change, fileId, mailId, filename: document.filename, reasons: finding.reasons };
  const params = [id, finding.carrier, document.companyId, mailId];
  try {
    await query(
      `insert into notifications (id, kind, name, company, email, detail)
       values ($1, 'format_change', $2, $3, $4, $5::jsonb)
       on conflict (id) do nothing`,
      [...params, JSON.stringify(detail)],
    );
    return id;
  } catch (error) {
    if (code(error) === "42P01") return null;
    if (code(error) !== "42703") throw error;
  }
  await query(
    `insert into notifications (id, kind, name, company, email)
     values ($1, 'format_change', $2, $3, $4)
     on conflict (id) do nothing`,
    params,
  );
  return id;
}

/** Any document kind. Never throws: a failed notice does not fail the extract or the check. */
export async function observeDocument(document: ObservedDocument): Promise<FormatFinding | null> {
  try {
    const profile = profileFor(document.kind, carrierKey(document.carrier));
    const finding = assessDocument(profile, document);
    if (finding && inPostgres()) await recordFormatNotice(finding, document);
    return finding;
  } catch (error) {
    console.warn("format notice failed:", error instanceof Error ? error.message.slice(0, 160) : "unknown");
    return null;
  }
}

export function invoiceSignals(extract: InvoiceExtract, edited: number | null = null): ExtractSignals {
  return {
    lines: extract.lines.length,
    unanchored: extract.lines.filter((line) => line.issues.some((issue) => /står ikke ordret/.test(issue))).length,
    unmapped: (extract.unmapped ?? []).map((item) => item.label),
    mismatchOre: extract.check.status === "mismatch" ? extract.check.differenceOre : null,
    lowConfidence: extract.confidence === "low",
    edited,
  };
}

function rememberFile(fileId: string, entry: typeof files extends Map<string, infer V> ? V : never): void {
  files.delete(fileId);
  files.set(fileId, entry);
  while (files.size > FILES_KEEP) {
    const oldest = files.keys().next().value;
    if (oldest === undefined) break;
    files.delete(oldest);
  }
}

/** Call with a freshly read extract, not a cache hit. */
export async function observeInvoiceExtract(companyId: string, extract: InvoiceExtract, fileId = ""): Promise<FormatFinding | null> {
  const carrier = carrierKey(extract.carrier);
  const documentId = `${companyId}:${extract.sha256}`;
  await loadInvoiceLayouts(extract.sha256);
  if (fileId) rememberFile(fileId, { carrier, documentId, fingerprint: extract.layout ?? null, lines: extract.lines.length, filename: extract.filename });
  return observeDocument({
    kind: "invoice",
    companyId,
    documentId,
    carrier,
    filename: extract.filename,
    fileId,
    fingerprint: extract.layout ?? null,
    signals: invoiceSignals(extract),
  });
}

async function storedFile(companyId: string, fileId: string) {
  const file = await readInvoiceFile(fileId).catch(() => null);
  if (!file || file.companyId !== companyId) return null;
  const extract = await cachedExtract(companyId, sha256Of(file.content)).catch(() => null);
  if (!extract) return null;
  await loadInvoiceLayouts("");
  const entry = {
    carrier: carrierKey(extract.carrier),
    documentId: `${companyId}:${extract.sha256}`,
    fingerprint: extract.layout ?? null,
    lines: extract.lines.length,
    filename: extract.filename,
  };
  rememberFile(fileId, entry);
  return entry;
}

/** After a save in Check faktura. A file without a cached PDF extract (a CSV) has no layout and is skipped. */
export async function observeCheckEdits(companyId: string, check: InvoiceCheck): Promise<FormatFinding | null> {
  const known = files.get(check.fileId) ?? (inPostgres() ? await storedFile(companyId, check.fileId) : null);
  if (!known) return null;
  const edited = editedLineCount(lineChanges(check.original, check.lines));
  if (edited === 0) return null;
  return observeDocument({
    kind: "invoice",
    companyId,
    documentId: known.documentId,
    carrier: known.carrier,
    filename: known.filename,
    fileId: check.fileId,
    fingerprint: known.fingerprint,
    signals: { lines: Math.max(check.original.length, check.lines.length), unanchored: 0, unmapped: [], mismatchOre: null, lowConfidence: false, edited },
  });
}

/** The Worker's AI bridge returns the model output under a job id; this ties it back to the stored file. */
export function rememberJobFile(jobId: string, companyId: string, fileId: string): void {
  const now = Date.now();
  for (const [id, entry] of jobFiles) if (entry.expires < now) jobFiles.delete(id);
  jobFiles.set(jobId, { companyId, fileId, expires: now + JOB_TTL_MS });
}

export function takeJobFile(jobId: string): { companyId: string; fileId: string } | null {
  const entry = jobFiles.get(jobId);
  jobFiles.delete(jobId);
  return entry && entry.expires >= Date.now() ? { companyId: entry.companyId, fileId: entry.fileId } : null;
}

/** Every number in an agreement extract, and how many of them are not printed verbatim in the PDF. */
export function agreementSignals(extract: AgreementExtract, edited: number | null = null): ExtractSignals {
  const unprintedRates = extract.rates.filter((rate) => rate.issues.some((issue) => /står ikke ordret/.test(issue))).length;
  const unprintedItems = extract.items.filter((item) => item.issues.some((issue) => /står ikke ordret/.test(issue))).length;
  const unprintedSurcharges = extract.surcharges.filter((item) => item.issues.some((issue) => /står ikke ordret/.test(issue))).length;
  const cells = extract.grids.reduce((sum, grid) => sum + grid.rows.reduce((count, row) => count + row.cells.filter((cell) => cell !== null).length, 0)
    + grid.minimum.filter((cell) => cell !== null).length + grid.maximum.filter((cell) => cell !== null).length, 0);
  return {
    lines: extract.rates.length + extract.items.length + cells + extract.surcharges.length,
    unanchored: unprintedRates + unprintedItems + unprintedSurcharges + extract.grids.reduce((sum, grid) => sum + grid.unprinted.length, 0),
    unmapped: extract.unmapped ?? [],
    mismatchOre: null,
    lowConfidence: extract.confidence === "low",
    edited,
  };
}

/** Call with a freshly read agreement extract, not a cache hit. */
export async function observeAgreementExtract(companyId: string, extract: AgreementExtract): Promise<FormatFinding | null> {
  const documentId = `${companyId}:${AGREEMENT_CACHE_PREFIX}${extract.sha256}`;
  await loadLayouts("agreement", `${AGREEMENT_CACHE_PREFIX}${extract.sha256}`);
  return observeDocument({
    kind: "agreement",
    companyId,
    documentId,
    carrier: carrierKey(extract.carrier),
    filename: extract.filename,
    fingerprint: extract.layout ?? null,
    signals: agreementSignals(extract),
  });
}

/** A fresh extract of either kind, as the extract route returns it. */
export function observeExtract(companyId: string, extract: InvoiceExtract | AgreementExtract, fileId = ""): Promise<FormatFinding | null> {
  return "kind" in extract && extract.kind === "agreement"
    ? observeAgreementExtract(companyId, extract)
    : observeInvoiceExtract(companyId, extract as InvoiceExtract, fileId);
}

/** After a PDF agreement is saved: heavy edits in the review are a signal, like edits in Check faktura. */
export async function observeAgreementEdits(record: AgreementRecord): Promise<FormatFinding | null> {
  const extract = record.extract;
  if (record.source !== "pdf" || !extract || !record.changed) return null;
  const edited = editedPriceCount(record);
  if (edited === 0) return null;
  await loadLayouts("agreement", `${AGREEMENT_CACHE_PREFIX}${extract.sha256}`);
  return observeDocument({
    kind: "agreement",
    companyId: record.companyId,
    documentId: `${record.companyId}:${AGREEMENT_CACHE_PREFIX}${extract.sha256}`,
    carrier: carrierKey(extract.carrier),
    filename: extract.filename,
    fingerprint: extract.layout ?? null,
    signals: { ...agreementSignals(extract, edited), unanchored: 0, unmapped: [], lowConfidence: false },
  });
}
