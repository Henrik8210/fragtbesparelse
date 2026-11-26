import { parseDecimal, type SurchargeKind } from "./agreementFormat.ts";
import { rateProblem, type RateDraft } from "./rateDraft.ts";

export type ItemDraft = { category: string; description: string; unit: string; price: string; currency: string; note: string; issues: string[] };
export type GridDraft = {
  name: string; category: string; unit: string; currency: string; rowLabel: string; note: string;
  columns: { label: string; detail: string }[];
  rows: { label: string; cells: string[] }[];
  minimum: string[];
  maximum: string[];
  unprinted: string[];
  issues: string[];
};
export type SurchargeDraft = { label: string; kind: SurchargeKind; value: string; unit: string; scope: string; note: string; issues: string[] };
export type ConditionDraft = { text: string; printed: boolean };

export type ReviewDrafts = {
  carrier: string;
  from: string;
  to: string;
  rates: RateDraft[];
  items: ItemDraft[];
  grids: GridDraft[];
  surcharges: SurchargeDraft[];
  conditions: ConditionDraft[];
};

/**
 * One thing to check before saving. `key` is the `data-issue` of the row or cell on screen.
 * A blocking issue stops the save until it is fixed; the others are values not printed verbatim, which a person may accept.
 */
export type ReviewIssue = { key: string; where: string; message: string; blocking: boolean };

export const NOT_PRINTED = "Tallet står ikke ordret i PDF'en. Sammenlign med aftalen.";

const bad = (value: string) => parseDecimal(value) === undefined;
const filled = (values: string[]) => values.some((value) => value.trim());

function gridCellIssues(grid: GridDraft, gridIndex: number): ReviewIssue[] {
  const name = grid.name.trim() || `Prisgitter ${gridIndex + 1}`;
  const column = (index: number) => grid.columns[index]?.label || `kolonne ${index + 1}`;
  const unprinted = new Set(grid.unprinted);
  const found: ReviewIssue[] = [];
  // "N af M tal står ikke ordret" only sums the cell flags below, which are listed one by one.
  const gridNotes = grid.issues.filter((issue) => !/tal står ikke ordret/.test(issue));
  if (gridNotes.length) found.push({ key: `grid:${gridIndex}`, where: name, message: gridNotes.join(" "), blocking: false });
  if (!grid.columns.length || !grid.rows.length) {
    found.push({ key: `grid:${gridIndex}`, where: name, message: "Prisgitteret skal have mindst én kolonne og én række.", blocking: true });
  }
  const cell = (key: string, label: string, value: string) => {
    if (bad(value)) found.push({ key: `grid:${gridIndex}:${key}`, where: `${name}, ${label}`, message: `«${value}» er ikke et tal.`, blocking: true });
    else if (unprinted.has(key)) found.push({ key: `grid:${gridIndex}:${key}`, where: `${name}, ${label}`, message: NOT_PRINTED, blocking: false });
  };
  grid.rows.forEach((row, rowIndex) => row.cells.forEach((value, index) =>
    cell(`${rowIndex}:${index}`, `${row.label || `række ${rowIndex + 1}`}, ${column(index)}`, value)));
  for (const [which, prefix, label] of [["minimum", "min", "minimum"], ["maximum", "max", "maksimum"]] as const) {
    const values = grid[which];
    grid.columns.forEach((_, index) => {
      const value = values[index] ?? "";
      if (filled(values) || unprinted.has(`${prefix}:${index}`)) cell(`${prefix}:${index}`, `${label}, ${column(index)}`, value);
    });
  }
  return found;
}

/** Every flagged or invalid value, in the order the review shows them. */
export function reviewIssues(drafts: ReviewDrafts): ReviewIssue[] {
  const found: ReviewIssue[] = [];
  if (!drafts.carrier.trim()) found.push({ key: "carrier", where: "Transportør", message: "Transportøren kunne ikke læses. Skriv firmaet, der har udstedt aftalen.", blocking: false });
  if (!drafts.from) found.push({ key: "from", where: "Gyldig fra", message: "Startdatoen kunne ikke læses. Uden den gælder aftalen fra start.", blocking: false });
  if (drafts.from && drafts.to && drafts.to < drafts.from) found.push({ key: "to", where: "Gyldig til", message: "Slutdatoen skal ligge på eller efter startdatoen.", blocking: true });

  drafts.rates.forEach((draft, index) => {
    const where = `Pakkepris ${index + 1}${draft.service.trim() ? ` (${[draft.service.trim(), draft.zone.trim()].filter(Boolean).join(", ")})` : ""}`;
    const problem = rateProblem(draft);
    if (problem) found.push({ key: `rate:${index}`, where, message: problem.message, blocking: true });
    else if (draft.issues.length) found.push({ key: `rate:${index}`, where, message: draft.issues.join(" "), blocking: false });
  });
  drafts.items.forEach((item, index) => {
    const where = `Pris ${index + 1}${item.description.trim() ? ` (${item.description.trim().slice(0, 60)})` : ""}`;
    if (!item.description.trim()) found.push({ key: `item:${index}`, where, message: "Beskrivelsen mangler.", blocking: true });
    else if (bad(item.price)) found.push({ key: `item:${index}`, where, message: `Prisen «${item.price}» er ikke et tal.`, blocking: true });
    else if (item.issues.length) found.push({ key: `item:${index}`, where, message: item.issues.join(" "), blocking: false });
  });
  drafts.grids.forEach((grid, index) => found.push(...gridCellIssues(grid, index)));
  drafts.surcharges.forEach((item, index) => {
    const where = `Tillæg ${index + 1}${item.label.trim() ? ` (${item.label.trim()})` : ""}`;
    const value = item.kind === "agreed" ? null : parseDecimal(item.value);
    if (!item.label.trim()) found.push({ key: `surcharge:${index}`, where, message: "Navnet mangler.", blocking: true });
    else if (value === undefined || (item.kind !== "agreed" && value === null)) found.push({ key: `surcharge:${index}`, where, message: "Tillægget skal have en værdi, eller vælg «Skal aftales».", blocking: true });
    else if (item.issues.length) found.push({ key: `surcharge:${index}`, where, message: item.issues.join(" "), blocking: false });
  });
  drafts.conditions.forEach((item, index) => {
    if (!item.printed) found.push({ key: `condition:${index}`, where: `Betingelse ${index + 1}`, message: "Teksten står ikke ordret i PDF'en.", blocking: false });
  });
  return found;
}

/** A flag a person can accept as right. A missing carrier or date has to be typed instead. */
export function canAccept(issue: ReviewIssue): boolean {
  return !issue.blocking && issue.key !== "carrier" && issue.key !== "from";
}

/** Clears the flag behind a non-blocking issue, as when a person has compared it with the PDF and it is right. */
export function acceptIssue(drafts: ReviewDrafts, key: string): Partial<ReviewDrafts> {
  const [kind, first, ...rest] = key.split(":");
  const index = Number(first);
  if (kind === "rate") return { rates: drafts.rates.map((item, at) => at === index ? { ...item, issues: [] } : item) };
  if (kind === "item") return { items: drafts.items.map((item, at) => at === index ? { ...item, issues: [] } : item) };
  if (kind === "surcharge") return { surcharges: drafts.surcharges.map((item, at) => at === index ? { ...item, issues: [] } : item) };
  if (kind === "condition") return { conditions: drafts.conditions.map((item, at) => at === index ? { ...item, printed: true } : item) };
  if (kind === "grid") {
    const cell = rest.join(":");
    return {
      grids: drafts.grids.map((grid, at) => at !== index ? grid
        : cell ? { ...grid, unprinted: grid.unprinted.filter((item) => item !== cell) } : { ...grid, issues: grid.issues.filter((issue) => /tal står ikke ordret/.test(issue)) }),
    };
  }
  return {};
}

/** The issue to show after `key`: the next one in screen order, wrapping, or null when none is left. */
export function nextIssue(issues: ReviewIssue[], key: string | null, step: 1 | -1 = 1, order: string[] = []): ReviewIssue | null {
  if (!issues.length) return null;
  const at = key ? issues.findIndex((issue) => issue.key === key) : -1;
  if (at >= 0) return issues[(at + step + issues.length) % issues.length];
  // The current issue is gone (fixed): continue from where it stood in the previous order.
  const before = key ? order.indexOf(key) : -1;
  if (before >= 0) {
    const after = order.slice(before + 1).find((item) => issues.some((issue) => issue.key === item));
    if (after) return issues.find((issue) => issue.key === after) ?? issues[0];
  }
  return step === 1 ? issues[0] : issues[issues.length - 1];
}
