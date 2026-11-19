import type { AgreementExtract } from "./agreementExtract.ts";
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

async function request<T = InvoiceExtract>(url: string, body?: Blob): Promise<T> {
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
  const payload = (await response.json().catch(() => null)) as { extract?: T; error?: string; message?: string } | null;
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

export type ReadProgress = { done: number; total: number; elapsedMs: number };

type StreamLine = { progress?: { done?: number; total?: number; elapsedMs?: number; waitingMs?: number }; status?: number; body?: unknown };

/** Reads newline-delimited JSON, calling `onLine` for each complete line. */
export async function readLines(stream: ReadableStream<Uint8Array>, onLine: (line: StreamLine) => void): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      onLine(JSON.parse(trimmed) as StreamLine);
    } catch {
      // A torn line from a dropped connection is skipped; the missing result line reports it.
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let at = buffer.indexOf("\n");
    while (at >= 0) {
      flush(buffer.slice(0, at));
      buffer = buffer.slice(at + 1);
      at = buffer.indexOf("\n");
    }
  }
  flush(buffer + decoder.decode());
}

// Twelve parts four at a time, each stopped after 150 s on the server, end well inside this.
export const AGREEMENT_READ_LIMIT_MS = 10 * 60 * 1000;

function failure(payload: { error?: string; message?: string } | null, status: number): ExtractError {
  const code = payload?.error ?? `http-${status}`;
  return new ExtractError(code, payload?.message || FALLBACK[code] || "PDF'ens linjer kunne ikke læses.");
}

/**
 * Reads a price agreement PDF. The server streams one line per finished part, so `onProgress` can show how far it
 * is; the read always ends in an extract or an ExtractError, at the latest after AGREEMENT_READ_LIMIT_MS.
 */
export async function extractAgreementUpload(
  file: File,
  companyId: string,
  onProgress?: (progress: ReadProgress) => void,
  limitMs = AGREEMENT_READ_LIMIT_MS,
): Promise<AgreementExtract> {
  const controller = new AbortController();
  const started = Date.now();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, limitMs);
  const stopped = () => timedOut
    ? new ExtractError("timeout", `Læsningen tog over ${Math.round(limitMs / 60_000)} minutter og blev stoppet. Prøv igen, eller tilføj prisaftalen som CSV.`)
    : new ExtractError("network", "Forbindelsen til serveren svigtede under læsningen. Prøv igen.");
  try {
    let response: Response;
    try {
      response = await fetch(
        `/api/invoice-extract?kind=agreement&company=${encodeURIComponent(companyId)}&name=${encodeURIComponent(file.name.slice(0, 120))}`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/pdf", accept: "application/x-ndjson, application/json" },
          body: file,
          signal: controller.signal,
        },
      );
    } catch {
      throw stopped();
    }
    if (!/application\/x-ndjson/.test(response.headers.get("content-type") ?? "") || !response.body) {
      const payload = (await response.json().catch(() => null)) as { extract?: AgreementExtract; error?: string; message?: string } | null;
      if (response.ok && payload?.extract) return payload.extract;
      throw failure(payload, response.status);
    }
    let result: { status: number; body: unknown } | null = null;
    let total = 0;
    let done = 0;
    try {
      await readLines(response.body, (line) => {
        if (typeof line.status === "number") result = { status: line.status, body: line.body };
        else if (line.progress) {
          total = line.progress.total ?? total;
          done = line.progress.done ?? done;
          onProgress?.({ done, total, elapsedMs: Date.now() - started });
        }
      });
    } catch {
      throw stopped();
    }
    const final = result as { status: number; body: unknown } | null;
    if (!final) throw stopped();
    const payload = final.body as { extract?: AgreementExtract; error?: string; message?: string } | null;
    if (final.status === 200 && payload?.extract) return payload.extract;
    throw failure(payload, final.status);
  } finally {
    clearTimeout(timer);
  }
}
