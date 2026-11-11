import { parseBillText } from "./parse.ts";

const MAX_BYTES = 8_000_000;

export type BillReadCode = "too-big" | "empty" | "no-amount";

export class BillReadError extends Error {
  readonly code: BillReadCode;
  readonly label: string;

  constructor(code: BillReadCode, label: string) {
    super(code);
    this.name = "BillReadError";
    this.code = code;
    this.label = label;
  }
}

export function billFileLabel(name: string, fallback = "Freight bill"): string {
  let cleaned = "";
  for (const char of name) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) continue;
    cleaned += char;
  }
  const compact = cleaned.trim().slice(0, 120);
  return compact || fallback;
}

export async function readBillFile(file: File, fallbackName = "Freight bill"): Promise<{ label: string; amount: number }> {
  const label = billFileLabel(file.name, fallbackName);
  if (file.size > MAX_BYTES) throw new BillReadError("too-big", label);
  if (file.size === 0) throw new BillReadError("empty", label);
  const text = await textFromFile(file);
  const amount = parseBillText(text, file.name);
  if (amount == null) throw new BillReadError("no-amount", label);
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
