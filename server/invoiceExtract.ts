import { createHash, randomBytes } from "node:crypto";
import {
  buildExtractRequest, EXTRACT_MODEL, EXTRACT_VERSION, modelUsage, parseModelOutput, validateExtract,
  type AiInputs, type InvoiceExtract,
} from "../src/pilot/invoiceExtract.ts";
import { postgresSql, storesInPostgres } from "./db.ts";
import { pdfText } from "./pdfText.ts";

export type AiRun = (model: string, inputs: AiInputs) => Promise<unknown>;

export type Prepared =
  | { result: "cached"; extract: InvoiceExtract }
  | { result: "ready"; sha256: string; filename: string; text: string; inputs: AiInputs; truncated: boolean }
  | { result: "no-text" | "not-pdf" | "pdf" };

export type ExtractJob = { id: string; model: string; inputs: AiInputs };

const JOB_TTL_MS = 5 * 60 * 1000;
const MEMORY_KEEP = 300;
const memory = new Map<string, InvoiceExtract>();
const jobs = new Map<string, { companyId: string; sha256: string; filename: string; text: string; truncated: boolean; expires: number }>();

export function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 5 && Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-";
}

export async function prepareExtract(companyId: string, filename: string, bytes: Uint8Array, refresh = false): Promise<Prepared> {
  if (!isPdf(bytes)) return { result: "not-pdf" };
  const sha256 = sha256Of(bytes);
  if (!refresh) {
    const hit = await cachedExtract(companyId, sha256);
    if (hit) return { result: "cached", extract: hit };
  }
  let text: string;
  try {
    text = await pdfText(bytes);
  } catch {
    return { result: "pdf" };
  }
  if (text.replace(/\s/g, "").length < 20) return { result: "no-text" };
  const { inputs, truncated } = buildExtractRequest(text);
  return { result: "ready", sha256, filename, text, inputs, truncated };
}

export async function finishExtract(
  companyId: string,
  prepared: Extract<Prepared, { result: "ready" }>,
  output: unknown,
): Promise<InvoiceExtract> {
  const extract = validateExtract(parseModelOutput(output), prepared.text, {
    sha256: prepared.sha256,
    filename: prepared.filename,
    truncated: prepared.truncated,
    usage: modelUsage(output),
  });
  await storeExtract(companyId, extract);
  return extract;
}

/** Full run with an injected model call, used by the REST fallback and by tests. */
export async function extractInvoice(companyId: string, filename: string, bytes: Uint8Array, run: AiRun, refresh = false) {
  const prepared = await prepareExtract(companyId, filename, bytes, refresh);
  if (prepared.result !== "ready") return prepared;
  const extract = await finishExtract(companyId, prepared, await run(EXTRACT_MODEL, prepared.inputs));
  return { result: "extracted" as const, extract };
}

const RUNS_PER_HOUR = 60;
const runs = new Map<string, number[]>();

/** Counts one model call for this user, or refuses when the hourly cap is reached. */
export function takeRun(userId: string, now = Date.now()): boolean {
  const recent = (runs.get(userId) ?? []).filter((at) => at > now - 3_600_000);
  if (recent.length >= RUNS_PER_HOUR) {
    runs.set(userId, recent);
    return false;
  }
  recent.push(now);
  runs.set(userId, recent);
  return true;
}

export function openJob(companyId: string, prepared: Extract<Prepared, { result: "ready" }>): ExtractJob {
  const now = Date.now();
  for (const [id, job] of jobs) if (job.expires < now) jobs.delete(id);
  const id = randomBytes(18).toString("hex");
  jobs.set(id, {
    companyId,
    sha256: prepared.sha256,
    filename: prepared.filename,
    text: prepared.text,
    truncated: prepared.truncated,
    expires: now + JOB_TTL_MS,
  });
  return { id, model: EXTRACT_MODEL, inputs: prepared.inputs };
}

export async function closeJob(id: string, output: unknown): Promise<InvoiceExtract | "missing"> {
  const job = jobs.get(id);
  jobs.delete(id);
  if (!job || job.expires < Date.now()) return "missing";
  return finishExtract(job.companyId, { result: "ready", ...job, inputs: buildExtractRequest(job.text).inputs }, output);
}

export function restRunner(): AiRun | null {
  const account = (process.env.CLOUDFLARE_ACCOUNT_ID ?? "").trim();
  const token = (process.env.CLOUDFLARE_AI_TOKEN ?? "").trim();
  if (!/^[a-f0-9]{32}$/.test(account) || !token) return null;
  const gateway = (process.env.AI_GATEWAY_ID ?? "").trim();
  return async (model, inputs) => {
    const url = /^[\w-]{1,64}$/.test(gateway)
      ? `https://gateway.ai.cloudflare.com/v1/${account}/${gateway}/workers-ai/${model}`
      : `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(inputs),
      signal: AbortSignal.timeout(120_000),
    });
    const body = (await response.json().catch(() => null)) as { result?: unknown; success?: boolean } | null;
    if (!response.ok || !body) throw new Error(`Workers AI svarede ${response.status}.`);
    return body.result ?? body;
  };
}

let tableMissing = false;

function tableUsable(): boolean {
  return storesInPostgres() && !tableMissing;
}

function noteTableError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (/invoice_extracts.*does not exist|does not exist.*invoice_extracts/i.test(message)) tableMissing = true;
}

export function extractCacheMode(): "postgres" | "memory" {
  return tableUsable() ? "postgres" : "memory";
}

export async function cachedExtract(companyId: string, sha256: string): Promise<InvoiceExtract | null> {
  const key = `${companyId}\n${sha256}`;
  if (tableUsable()) {
    try {
      const rows = await postgresSql<{ extract: unknown }>(
        "select extract from public.invoice_extracts where company_id = $1 and content_sha256 = $2 and version = $3",
        [companyId, sha256, EXTRACT_VERSION],
      );
      const value = rows[0]?.extract;
      const parsed = typeof value === "string" ? JSON.parse(value) as InvoiceExtract : value as InvoiceExtract | undefined;
      if (parsed) return parsed;
    } catch (error) {
      noteTableError(error);
    }
  }
  const kept = memory.get(key);
  return kept?.version === EXTRACT_VERSION ? kept : null;
}

async function storeExtract(companyId: string, extract: InvoiceExtract): Promise<void> {
  const key = `${companyId}\n${extract.sha256}`;
  memory.delete(key);
  memory.set(key, extract);
  while (memory.size > MEMORY_KEEP) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
  if (!tableUsable()) return;
  try {
    await postgresSql(
      `insert into public.invoice_extracts (company_id, content_sha256, version, model, confidence, extract)
       values ($1, $2, $3, $4, $5, $6::jsonb)
       on conflict (company_id, content_sha256) do update
       set version = excluded.version, model = excluded.model, confidence = excluded.confidence,
           extract = excluded.extract, created_at = now()`,
      [companyId, extract.sha256, extract.version, extract.model, extract.confidence, JSON.stringify(extract)],
    );
  } catch (error) {
    // The table is optional. The in-process copy above still answers repeat requests.
    noteTableError(error);
  }
}
