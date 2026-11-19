import { agreementFromRows, type Agreement } from "./agreements.ts";
import { agreementRatesToRows, extractTerms, type AgreementExtract } from "./agreementExtract.ts";

/** Below this share of the PDF's printed prices, the extract is shown for review instead of saved directly. */
export const AUTO_SAVE_COVERAGE = 0.95;

const shortDate = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "";

/** "Nordfragt 01.01.2027–31.12.2027". The name is generated, never typed. */
export function agreementName(carrier: string, from: string, to: string): string {
  const who = carrier.trim() || "Prisaftale";
  const start = shortDate(from);
  const end = shortDate(to);
  const span = start && end ? `${start}–${end}` : start ? `fra ${start}` : end ? `til ${end}` : "";
  return `${who}${span ? ` ${span}` : ""}`.slice(0, 100);
}

/** Why the extract needs a person to look at it before it is saved. Empty when it can be saved as read. */
export function reviewReasons(extract: AgreementExtract): string[] {
  const reasons: string[] = [];
  if (!extract.carrier.trim()) reasons.push("Transportøren stod ikke i PDF'en.");
  if (!extract.validFrom) reasons.push("Startdatoen stod ikke i PDF'en.");
  if (!extract.validTo) reasons.push("Slutdatoen stod ikke i PDF'en.");
  if (extract.validFrom && extract.validTo && extract.validTo < extract.validFrom) reasons.push("Slutdatoen ligger før startdatoen.");
  const flagged = extract.rates.filter((rate) => rate.issues.length).length
    + extract.items.filter((item) => item.issues.length).length
    + extract.grids.reduce((sum, grid) => sum + grid.unprinted.length + grid.issues.length, 0)
    + extract.surcharges.filter((item) => item.issues.length).length
    + extract.conditions.filter((item) => !item.printed).length;
  if (flagged) reasons.push(`${flagged} ${flagged === 1 ? "felt" : "felter"} skal tjekkes.`);
  reasons.push(...extract.issues);
  const { printed, captured } = extract.coverage;
  if (printed && captured / printed < AUTO_SAVE_COVERAGE) reasons.push(`Kun ${captured} af ${printed} priser blev fundet.`);
  if (extract.confidence === "low") reasons.push("Udtrækket har lav sikkerhed.");
  if (!extract.rates.length && !extract.items.length && !extract.grids.length && !extract.surcharges.length) reasons.push("Der blev ikke fundet priser.");
  return [...new Set(reasons)];
}

/** The extract as an agreement, exactly as read, with the generated name. */
export function agreementFromExtract(extract: AgreementExtract, orgId: string, now = new Date()): Agreement {
  const rows = agreementRatesToRows(extract.rates, extract.validFrom, extract.validTo);
  return agreementFromRows(rows, {
    orgId,
    name: agreementName(extract.carrier, extract.validFrom, extract.validTo),
    carrier: extract.carrier,
    from: extract.validFrom,
    to: extract.validTo,
  }, now, extractTerms(extract));
}
