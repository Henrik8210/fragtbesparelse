type TextItem = { str?: string; transform?: number[]; width?: number; height?: number; hasEOL?: boolean };
type Part = { x: number; w: number; text: string };
type Row = { y: number; size: number; parts: Part[] };

const MAX_PAGES = 30;

/**
 * Text layer only. A scanned page without text comes back empty.
 * `joinWrappedHeaders` puts a table header that wraps over two lines back on one line, cell by cell.
 */
export async function pdfText(bytes: Uint8Array, options: { joinWrappedHeaders?: boolean } = {}): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  try {
    const document = await loading.promise;
    const pages: string[] = [];
    for (let number = 1; number <= Math.min(document.numPages, MAX_PAGES); number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      pages.push(pageLines(content.items as TextItem[], options.joinWrappedHeaders ?? false));
      page.cleanup();
    }
    return pages.join("\n\n").trim();
  } finally {
    await loading.destroy();
  }
}

function pageLines(items: TextItem[], joinHeaders: boolean): string {
  const rows: Row[] = [];
  for (const item of items) {
    const value = typeof item.str === "string" ? item.str : "";
    if (!value.trim()) continue;
    const x = item.transform?.[4] ?? 0;
    const y = item.transform?.[5] ?? 0;
    const size = Math.abs(item.transform?.[3] ?? 0) || item.height || 10;
    const part = { x, w: item.width ?? 0, text: value.trim() };
    const row = rows.find((candidate) => Math.abs(candidate.y - y) < 2.5);
    if (row) row.parts.push(part);
    else rows.push({ y, size, parts: [part] });
  }
  rows.sort((a, b) => b.y - a.y);
  for (const row of rows) row.parts.sort((a, b) => a.x - b.x);
  return (joinHeaders ? joinWrappedHeaders(rows) : rows)
    .map((row) => row.parts.map((part) => part.text).join("  "))
    .join("\n");
}

const MONEY = /\d,\d{2}(?!\d)/;
const BULLET = /^[\u2022\u25e6\uf0b7\uf0a7\u25aa\u2013-]\s*$|^[\u2022\u25e6\uf0b7\uf0a7\u25aa]/;

/** A header line: short cells, no prices, not a bullet. */
function headerLike(row: Row): boolean {
  return row.parts.every((part) => part.text.length <= 40 && !MONEY.test(part.text) && !BULLET.test(part.text));
}

function overlaps(a: Part, b: Part): boolean {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.w, b.x + b.w);
  return right - left > 0.3 * Math.min(a.w || 1, b.w || 1);
}

/**
 * Merges two adjacent header lines when the shorter one only adds words to cells of the longer one: each of its
 * cells sits under or over at most one cell. A cell with nothing above or below keeps its place by x.
 */
export function joinWrappedHeaders(rows: Row[]): Row[] {
  const out = [...rows];
  for (let index = 0; index + 1 < out.length; index += 1) {
    const upper = out[index];
    const lower = out[index + 1];
    if (upper.y - lower.y > 1.6 * Math.max(upper.size, lower.size)) continue;
    if (!headerLike(upper) || !headerLike(lower)) continue;
    const [small, large] = upper.parts.length < lower.parts.length ? [upper, lower] : [lower, upper];
    // A wrapped header adds a word or two to a few cells; two full header rows (names, then postcodes) stay apart.
    if (large.parts.length < 3 || small.parts.length > Math.max(2, Math.floor(large.parts.length / 2))) continue;
    const pairs = small.parts.map((part) => large.parts.filter((other) => overlaps(part, other)));
    if (pairs.some((hits, at) => hits.length === 1 && small.parts[at].w > 1.5 * Math.max(hits[0].w, 1))) continue;
    if (pairs.some((hits) => hits.length > 1) || !pairs.some((hits) => hits.length === 1)) continue;
    const taken = pairs.flat();
    if (new Set(taken).size !== taken.length) continue;
    const merged: Part[] = large.parts.map((part) => {
      const at = pairs.findIndex((hits) => hits[0] === part);
      if (at < 0) return part;
      const extra = small.parts[at].text;
      return { ...part, text: small === upper ? `${extra} ${part.text}` : `${part.text} ${extra}` };
    });
    small.parts.forEach((part, at) => { if (pairs[at].length === 0) merged.push(part); });
    merged.sort((a, b) => a.x - b.x);
    out.splice(index, 2, { y: lower.y, size: Math.max(upper.size, lower.size), parts: merged });
    index -= 1;
  }
  return out;
}
