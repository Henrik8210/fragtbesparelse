/**
 * Notices when a carrier's document layout changes, or when the extractor plainly struggles with it.
 * Generic over the document kind: invoices feed it today; a price agreement extract can call the same
 * functions with kind "agreement" and its own vocabulary and signals.
 */

export type DocumentKind = "invoice" | "agreement";

/** Normalized labels from a document's text layer: "t:" a digit-free line, "k:" a key before a colon, "l:" a row label before the first digit, "v:" a line label the extractor read. */
export type LayoutFingerprint = { tokens: string[]; pages: number };

export type LayoutVariant = { id: string; docs: number; counts: Record<string, number> };

export type CarrierProfile = { kind: DocumentKind; carrier: string; docs: number; variants: LayoutVariant[]; seen: string[] };

export type ExtractSignals = {
  /** Lines the extractor returned. */
  lines: number;
  /** Lines whose amount is not printed verbatim in the document. */
  unanchored: number;
  /** Labels the schema had no field for. */
  unmapped: string[];
  /** Line sum minus the printed total, in øre, when they disagree. */
  mismatchOre: number | null;
  lowConfidence: boolean;
  /** Lines a person changed in Check faktura, when known. */
  edited: number | null;
};

export type SignalKind = "unmapped" | "unanchored" | "mismatch" | "edited";

export type LayoutComparison = {
  variant: LayoutVariant | null;
  similarity: number;
  added: string[];
  missing: string[];
  changed: boolean;
};

export type FormatFinding = {
  kind: DocumentKind;
  carrier: string;
  change: "layout" | "signals";
  /** Same key for the same change, so every later document in that layout maps to one notice. */
  key: string;
  variantId: string;
  reasons: string[];
};

export const MATCH_SIMILARITY = 0.6;
const CORE_SHARE = 0.5;
const MIN_CORE = 4;
const MAX_TOKENS = 150;
const MAX_VARIANTS = 6;
const MAX_SEEN = 2000;
const UNMAPPED_STRONG = 3;
const UNANCHORED_SHARE = 0.25;
const EDITED_SHARE = 0.3;

const DIGIT = /\d/;

export function normalizeLabel(value: string): string {
  return value.normalize("NFKC").toLowerCase()
    .split(/\s+/)
    .filter((word) => word && !DIGIT.test(word))
    .join(" ")
    .replace(/[^\p{L}\s&/%-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function usable(label: string, maxWords: number): boolean {
  return label.length >= 2 && label.length <= 40 && label.split(" ").length <= maxWords;
}

/** Labels only, never amounts, dates or numbers, so two invoices in the same layout give nearly the same set. */
export function layoutFingerprint(text: string, vocabulary: string[] = []): LayoutFingerprint {
  const tokens = new Set<string>();
  const pages = text.split(/\n\s*\n/).filter((page) => page.trim()).length;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[\u00a0\u2007\u2009\u202f]/g, " ").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon > 0 && !DIGIT.test(line.slice(0, colon))) {
      const key = normalizeLabel(line.slice(0, colon));
      if (usable(key, 4)) tokens.add(`k:${key}`);
      continue;
    }
    if (!DIGIT.test(line)) {
      for (const cell of line.split(/\s{2,}|\t/)) {
        const label = normalizeLabel(cell);
        if (usable(label, 6)) tokens.add(`t:${label}`);
      }
      continue;
    }
    const lead = normalizeLabel(line.slice(0, line.search(DIGIT)));
    if (usable(lead, 3)) tokens.add(`l:${lead}`);
  }
  for (const item of vocabulary) {
    const label = normalizeLabel(item);
    if (usable(label, 5)) tokens.add(`v:${label}`);
  }
  return { tokens: [...tokens].sort().slice(0, MAX_TOKENS), pages };
}

/** FNV-1a, twice with different seeds, as 16 hex characters. Stable across runs and browsers. */
export function stableHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x01000193 ^ 0x5bd1e995;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x01000193) ^ (second >>> 13);
  }
  return (first >>> 0).toString(16).padStart(8, "0") + (second >>> 0).toString(16).padStart(8, "0");
}

export function emptyProfile(kind: DocumentKind, carrier: string): CarrierProfile {
  return { kind, carrier, docs: 0, variants: [], seen: [] };
}

function core(variant: LayoutVariant): string[] {
  const floor = variant.docs >= 2 ? variant.docs * CORE_SHARE : 1;
  return Object.entries(variant.counts).filter(([, count]) => count >= floor).map(([token]) => token);
}

const shown = (token: string) => token.slice(2);

/** The closest known layout, and whether this document is too far from every one of them. */
export function compareLayout(profile: CarrierProfile, fingerprint: LayoutFingerprint): LayoutComparison {
  const tokens = new Set(fingerprint.tokens);
  let best: LayoutComparison = { variant: null, similarity: 0, added: [], missing: [], changed: false };
  for (const variant of profile.variants) {
    const known = core(variant);
    const kept = known.filter((token) => tokens.has(token));
    const added = fingerprint.tokens.filter((token) => !(token in variant.counts));
    const denominator = known.length + added.length;
    const similarity = denominator === 0 ? 1 : kept.length / denominator;
    if (!best.variant || similarity > best.similarity) {
      best = {
        variant,
        similarity,
        added: added.map(shown),
        missing: known.filter((token) => !tokens.has(token)).map(shown),
        changed: false,
      };
    }
  }
  const comparable = best.variant !== null && core(best.variant).length >= MIN_CORE && fingerprint.tokens.length >= MIN_CORE;
  return { ...best, changed: comparable && best.similarity < MATCH_SIMILARITY };
}

/** Adds the document to its layout, or starts a new one. Returns the layout id. A document already seen is not counted twice. */
export function learnLayout(profile: CarrierProfile, fingerprint: LayoutFingerprint, documentId: string): string {
  const comparison = compareLayout(profile, fingerprint);
  const matched = comparison.variant && (comparison.similarity >= MATCH_SIMILARITY || !comparison.changed) ? comparison.variant : null;
  if (profile.seen.includes(documentId) && matched) return matched.id;
  let variant = matched;
  if (!variant) {
    variant = { id: stableHash(`${profile.kind}|${profile.carrier}|${fingerprint.tokens.join("|")}`), docs: 0, counts: {} };
    profile.variants.push(variant);
    if (profile.variants.length > MAX_VARIANTS) {
      profile.variants.sort((left, right) => right.docs - left.docs);
      profile.variants.splice(MAX_VARIANTS - 1, 1);
    }
  }
  variant.docs += 1;
  for (const token of fingerprint.tokens) variant.counts[token] = (variant.counts[token] ?? 0) + 1;
  profile.docs += 1;
  profile.seen.push(documentId);
  if (profile.seen.length > MAX_SEEN) profile.seen.splice(0, profile.seen.length - MAX_SEEN);
  return variant.id;
}

const kroner = (ore: number) => `${(Math.abs(ore) / 100).toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr.`;
const quoted = (labels: string[], max = 4) => labels.slice(0, max).map((label) => `"${label}"`).join(", ") + (labels.length > max ? " …" : "");

/** Strong signals justify a notice on their own; low confidence is only mentioned beside them. */
export function signalReasons(signals: ExtractSignals, kind: DocumentKind = "invoice"): { strong: SignalKind[]; reasons: string[] } {
  const strong: SignalKind[] = [];
  const reasons: string[] = [];
  const lines = Math.max(signals.lines, 1);
  if (signals.unmapped.length >= UNMAPPED_STRONG) {
    strong.push("unmapped");
    reasons.push(`${signals.unmapped.length} felter passede ikke i skemaet: ${quoted(signals.unmapped)}`);
  }
  if (signals.unanchored >= 2 && signals.unanchored / lines >= UNANCHORED_SHARE) {
    strong.push("unanchored");
    reasons.push(`${signals.unanchored} af ${signals.lines} beløb står ikke ordret i dokumentet`);
  }
  if (signals.mismatchOre !== null && signals.mismatchOre !== 0) {
    strong.push("mismatch");
    reasons.push(`Linjerne summer ikke til totalen (forskel ${kroner(signals.mismatchOre)})`);
  }
  if (signals.edited !== null && signals.edited >= 2 && signals.edited / lines >= EDITED_SHARE) {
    strong.push("edited");
    reasons.push(kind === "agreement"
      ? `${signals.edited} af ${signals.lines} priser rettet i gennemsynet af prisaftalen`
      : `${signals.edited} af ${signals.lines} linjer rettet i Check faktura`);
  }
  if (strong.length > 0 && signals.lowConfidence) reasons.push("Lav sikkerhed i udtrækket");
  return { strong, reasons };
}

/**
 * Compares the document with the carrier's known layouts, learns it, and returns a finding when the layout drifted
 * or the extractor signals are strong. One finding per new layout, and one per layout and set of signals.
 */
export function assessDocument(
  profile: CarrierProfile,
  input: { documentId: string; fingerprint: LayoutFingerprint | null; signals: ExtractSignals },
): FormatFinding | null {
  const known = profile.docs > 0;
  const comparison = input.fingerprint ? compareLayout(profile, input.fingerprint) : null;
  const variantId = input.fingerprint ? learnLayout(profile, input.fingerprint, input.documentId) : comparison?.variant?.id ?? "";
  const { strong, reasons } = signalReasons(input.signals, profile.kind);
  const base = { kind: profile.kind, carrier: profile.carrier, variantId };
  if (known && comparison?.changed) {
    const layout = [`Layoutet ligner det kendte format ${Math.round(comparison.similarity * 100)} %`];
    if (comparison.added.length) layout.push(`Nye felter: ${quoted(comparison.added)}`);
    if (comparison.missing.length) layout.push(`Mangler: ${quoted(comparison.missing)}`);
    return { ...base, change: "layout", key: `layout:${variantId}`, reasons: [...layout, ...reasons] };
  }
  if (strong.length === 0) return null;
  return { ...base, change: "signals", key: `signals:${variantId || "none"}:${[...strong].sort().join("+")}`, reasons };
}

/** Distinct lines a person changed, counting added or removed lines. */
export function editedLineCount(changes: { line: number }[]): number {
  return new Set(changes.map((change) => change.line)).size;
}
