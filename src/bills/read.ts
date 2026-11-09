import { parseBillText } from "./parse.ts";

const MAX_BYTES = 8_000_000;

export function billFileLabel(name: string): string {
  let cleaned = "";
  for (const char of name) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) continue;
    cleaned += char;
  }
  const compact = cleaned.trim().slice(0, 120);
  return compact || "Freight bill";
}

export async function readBillFile(file: File): Promise<{ label: string; amount: number }> {
  const label = billFileLabel(file.name);
  if (file.size > MAX_BYTES) {
    throw new Error(`${label} is larger than 8 MB.`);
  }
  if (file.size === 0) {
    throw new Error(`${label} is empty.`);
  }
  const text = await textFromFile(file);
  const amount = parseBillText(text, file.name);
  if (amount == null) {
    throw new Error(
      `${label} has no readable amount. Type it in, or use a text PDF or a CSV with an amount column.`,
    );
  }
  return { label, amount };
}

async function textFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) {
    return pdfToText(await file.arrayBuffer());
  }
  return file.text();
}

async function pdfToText(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const document = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if (!("str" in item) || typeof item.str !== "string") continue;
        text += item.str;
        text += "hasEOL" in item && item.hasEOL ? "\n" : " ";
      }
      pages.push(text);
    }
    return pages.join("\n");
  } finally {
    await document.cleanup();
  }
}
