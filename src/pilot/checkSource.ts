import { decodeCsv, importRows, parseCsv, suggestMapping } from "./csv.ts";
import { extractMailFile } from "./extractClient.ts";
import { linesFromExtract, linesFromRows, type CheckLine } from "./invoiceCheck.ts";
import type { InvoiceExtract } from "./invoiceExtract.ts";
import { loadMailFile } from "./mailFiles.ts";

export const isSheetName = (name: string) => /\.(csv|tsv|txt)$/i.test(name);
export const isCheckable = (name: string) => /\.pdf$/i.test(name) || isSheetName(name);

export type CheckSource = { lines: CheckLine[]; extract: InvoiceExtract | null };

/** The invoice lines as read before any check: the Workers AI extract for a PDF, the browser's CSV read otherwise. */
export async function loadCheckSource(fileId: string, filename: string, companyId: string): Promise<CheckSource> {
  if (/\.pdf$/i.test(filename)) {
    const extract = await extractMailFile(fileId, companyId);
    return { lines: linesFromExtract(extract), extract };
  }
  if (!isSheetName(filename)) throw new Error("Filen kan ikke læses som fakturalinjer.");
  const blob = await loadMailFile(fileId, companyId).promise;
  const sheet = parseCsv(decodeCsv(await blob.arrayBuffer()));
  return { lines: linesFromRows(importRows("invoice", sheet, suggestMapping("invoice", sheet.headers))), extract: null };
}

