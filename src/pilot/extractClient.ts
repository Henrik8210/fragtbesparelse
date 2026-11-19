import type { InvoiceExtract } from "./invoiceExtract.ts";

const KEEP = 20;
const results = new Map<string, Promise<InvoiceExtract>>();

export class ExtractError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const FALLBACK: Record<string, string> = {
  "ai-unavailable": "Workers AI er ikke tilgængelig her, så PDF'ens linjer kan ikke læses. Brug en CSV.",
  "no-text": "PDF'en har intet tekstlag (fx en scannet side), så linjerne kan ikke læses.",
  "not-pdf": "Filen er ikke en PDF.",
  large: "PDF'en må fylde højst 8 MB.",
  limit: "For mange PDF-udtræk den seneste time. Prøv igen senere.",
  "sign-in": "Log ind igen for at læse PDF'en.",
  missing: "Filen blev ikke fundet.",
};

async function request(url: string, body?: Blob): Promise<InvoiceExtract> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: body ? { "content-type": "application/pdf" } : undefined,
      body,
    });
  } catch {
    throw new ExtractError("network", "Forbindelsen til serveren svigtede. Prøv igen.");
  }
  const payload = (await response.json().catch(() => null)) as { extract?: InvoiceExtract; error?: string; message?: string } | null;
  if (response.ok && payload?.extract) return payload.extract;
  const code = payload?.error ?? `http-${response.status}`;
  throw new ExtractError(code, payload?.message || FALLBACK[code] || "PDF'ens linjer kunne ikke læses.");
}

function remember(key: string, load: () => Promise<InvoiceExtract>): Promise<InvoiceExtract> {
  const hit = results.get(key);
  if (hit) return hit;
  const promise = load().catch((error: unknown) => {
    results.delete(key);
    throw error;
  });
  results.set(key, promise);
  while (results.size > KEEP) {
    const oldest = results.keys().next().value;
    if (oldest === undefined) break;
    results.delete(oldest);
  }
  return promise;
}

export function extractMailFile(fileId: string, companyId: string): Promise<InvoiceExtract> {
  return remember(`file\n${companyId}\n${fileId}`, () =>
    request(`/api/invoice-extract?company=${encodeURIComponent(companyId)}&file=${encodeURIComponent(fileId)}`));
}

export function extractUpload(file: File, companyId: string): Promise<InvoiceExtract> {
  return remember(`upload\n${companyId}\n${file.name}\n${file.size}\n${file.lastModified}`, () =>
    request(`/api/invoice-extract?company=${encodeURIComponent(companyId)}&name=${encodeURIComponent(file.name.slice(0, 120))}`, file));
}
