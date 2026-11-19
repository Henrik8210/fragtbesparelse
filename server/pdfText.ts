type TextItem = { str?: string; transform?: number[]; hasEOL?: boolean };

const MAX_PAGES = 30;

/** Text layer only. A scanned page without text comes back empty. */
export async function pdfText(bytes: Uint8Array): Promise<string> {
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
      pages.push(pageLines(content.items as TextItem[]));
      page.cleanup();
    }
    return pages.join("\n\n").trim();
  } finally {
    await loading.destroy();
  }
}

function pageLines(items: TextItem[]): string {
  const rows: { y: number; parts: { x: number; text: string }[] }[] = [];
  for (const item of items) {
    const value = typeof item.str === "string" ? item.str : "";
    if (!value.trim()) continue;
    const x = item.transform?.[4] ?? 0;
    const y = item.transform?.[5] ?? 0;
    const row = rows.find((candidate) => Math.abs(candidate.y - y) < 2.5);
    if (row) row.parts.push({ x, text: value });
    else rows.push({ y, parts: [{ x, text: value }] });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows
    .map((row) => row.parts.sort((a, b) => a.x - b.x).map((part) => part.text.trim()).join("  "))
    .join("\n");
}
