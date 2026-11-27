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

export function extractMailFile(fileId: string, companyId: string, onProgress?: (progress: ReadProgress) => void): Promise<InvoiceExtract> {
  const url = `/api/invoice-extract?company=${encodeURIComponent(companyId)}&file=${encodeURIComponent(fileId)}`;
  return remember(`file\n${companyId}\n${fileId}`, () => onProgress ? postExtract(url, null, onProgress) : request(url));
}

export function extractUpload(file: File, companyId: string, onProgress?: (progress: ReadProgress) => void): Promise<InvoiceExtract> {
  const url = `/api/invoice-extract?company=${encodeURIComponent(companyId)}&name=${encodeURIComponent(file.name.slice(0, 120))}`;
  return remember(`upload\n${companyId}\n${file.name}\n${file.size}\n${file.lastModified}`, () =>
    onProgress ? postExtract(url, file, onProgress) : request(url, file));
}

type StreamState = { done: number; total: number; result: { status: number; body: unknown } | null };

/** One NDJSON line from a PDF read: part progress, or the final status. */
export function noteStream(line: StreamLine, state: StreamState): StreamState {
  if (typeof line.status === "number") return { ...state, result: { status: line.status, body: line.body } };
  if (!line.progress) return state;
  return { ...state, total: line.progress.total ?? state.total, done: line.progress.done ?? state.done };
}

export type ReadProgress = {
  done: number;
  total: number;
  elapsedMs: number;
  /** Upload of the file, then the read. A missing stage is the read. */
  stage?: "upload" | "read";
  loaded?: number;
  size?: number;
};

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

function fromBody(payload: { extract?: InvoiceExtract; error?: string; message?: string } | null, status: number): InvoiceExtract {
  if (status >= 200 && status < 300 && payload?.extract) return payload.extract;
  throw failure(payload, status);
}

/**
 * Posts a PDF and reads the NDJSON the server writes while Workers AI runs. Upload progress is the bytes sent.
 * A JSON body (a cached extract, or an error) is accepted too.
 */
export function postExtract(url: string, file: Blob | null, onProgress?: (progress: ReadProgress) => void): Promise<InvoiceExtract> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const started = Date.now();
    xhr.open("POST", url);
    xhr.withCredentials = true;
    xhr.setRequestHeader("accept", "application/x-ndjson, application/json");
    if (file) xhr.setRequestHeader("content-type", file.type || "application/pdf");
    let parsed = 0;
    let state: StreamState = { done: 0, total: 0, result: null };
    const report = (stage: "upload" | "read", extra: Partial<ReadProgress> = {}) => {
      onProgress?.({ stage, done: state.done, total: state.total, elapsedMs: Date.now() - started, ...extra });
    };
    const consume = (final: boolean) => {
      const text = xhr.responseText ?? "";
      const slice = text.slice(parsed);
      const parts = slice.split("\n");
      if (!final) parsed += slice.length - (parts.pop()?.length ?? 0);
      else parsed = text.length;
      if (final && text.trim().startsWith("{") && !text.includes("\n")) return;
      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        try {
          state = noteStream(JSON.parse(trimmed) as StreamLine, state);
        } catch {
          // A torn line is completed on the next event.
        }
      }
      report("read");
    };
    xhr.upload.onprogress = (event) => {
      report("upload", { loaded: event.loaded, size: event.lengthComputable ? event.total : file?.size });
    };
    xhr.onprogress = () => consume(false);
    xhr.onerror = () => reject(new ExtractError("network", "Forbindelsen til serveren svigtede. Prøv igen."));
    xhr.onload = () => {
      try {
        consume(true);
      } catch {
        reject(new ExtractError("network", "Svaret fra serveren kunne ikke læses. Prøv igen."));
        return;
      }
      const type = xhr.getResponseHeader("content-type") ?? "";
      if (!/ndjson/.test(type)) {
        try {
          const payload = xhr.responseText ? JSON.parse(xhr.responseText) as { extract?: InvoiceExtract; error?: string; message?: string } : null;
          resolve(fromBody(payload, xhr.status));
        } catch (error) {
          reject(error instanceof ExtractError ? error : new ExtractError("network", "Svaret fra serveren kunne ikke læses. Prøv igen."));
        }
        return;
      }
      const result = state.result;
      if (!result) {
        reject(new ExtractError("network", "Forbindelsen til serveren svigtede under læsningen. Prøv igen."));
        return;
      }
      try {
        resolve(fromBody(result.body as { extract?: InvoiceExtract; error?: string; message?: string } | null, result.status));
      } catch (error) {
        reject(error);
      }
    };
    if (!file) report("read");
    xhr.send(file);
  });
}

/** Uploads one invoice file and reports how many bytes have been sent. */
export function uploadWithProgress<T>(url: string, file: File, onProgress: (loaded: number, total: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = true;
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (event) => onProgress(event.loaded, event.lengthComputable ? event.total : file.size);
    xhr.onerror = () => reject(new ExtractError("network", "Forbindelsen til serveren svigtede. Prøv igen."));
    xhr.onload = () => {
      try {
        const payload = xhr.responseText ? JSON.parse(xhr.responseText) as { error?: string; message?: string } : null;
        if (xhr.status >= 200 && xhr.status < 300 && payload) {
          resolve(payload as T);
          return;
        }
        reject(failure(payload, xhr.status));
      } catch {
        reject(new ExtractError("network", "Svaret fra serveren kunne ikke læses. Prøv igen."));
      }
    };
    xhr.send(file);
  });
}

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
