import { createHash, randomBytes } from "node:crypto";
import {
  buildExtractRequest, EXTRACT_MODEL, EXTRACT_VERSION, modelUsage, parseModelOutput, validateExtract,
  type AiInputs, type InvoiceExtract,
} from "../src/pilot/invoiceExtract.ts";
import {
  AGREEMENT_CACHE_PREFIX, AGREEMENT_EXTRACT_VERSION, buildAgreementBatches, validateAgreementExtract,
  type AgreementExtract,
} from "../src/pilot/agreementExtract.ts";
import { partShort, readParts, type PartPlan, type PartReport } from "../src/pilot/agreementParts.ts";
import { postgresSql, storesInPostgres } from "./db.ts";
import { pdfText } from "./pdfText.ts";

export type AiRun = (model: string, inputs: AiInputs) => Promise<unknown>;

export type ExtractKind = "invoice" | "agreement";
type ExtractOf<K extends ExtractKind> = K extends "agreement" ? AgreementExtract : InvoiceExtract;
type AnyExtract = InvoiceExtract | AgreementExtract;

export type Prepared<K extends ExtractKind = "invoice"> =
  | { result: "cached"; extract: ExtractOf<K> }
  | { result: "ready"; kind: K; sha256: string; filename: string; text: string; batches: AiInputs[]; plans: PartPlan[]; truncated: boolean; partKeys: string[] }
  | { result: "no-text" | "not-pdf" | "pdf" };

/** `inputs` is the first batch, for a Durable Object that predates `batches`. `plans` lets it check and retry each part. */
export type ExtractJob = { id: string; model: string; inputs: AiInputs; batches: AiInputs[]; plans: PartPlan[] };

type Spec = {
  version: number;
  /** Agreement extracts share invoice_extracts; the prefix keeps their rows apart from an invoice with the same bytes. */
  prefix: string;
  /** One model call per batch. An invoice is one; a long agreement is read in page groups. */
  build: (text: string) => { batches: AiInputs[]; plans?: PartPlan[]; truncated: boolean };
  validate: (raw: unknown[], text: string, meta: { sha256: string; filename: string; truncated: boolean; usage: InvoiceExtract["usage"]; parts?: PartReport[] }) => AnyExtract;
};

const SPECS: Record<ExtractKind, Spec> = {
  invoice: {
    version: EXTRACT_VERSION,
    prefix: "",
    build: (text) => {
      const { inputs, truncated } = buildExtractRequest(text);
      return { batches: [inputs], truncated };
    },
    validate: (raw, text, meta) => validateExtract(parseModelOutput(raw[0]), text, meta),
  },
  agreement: {
    version: AGREEMENT_EXTRACT_VERSION,
    prefix: AGREEMENT_CACHE_PREFIX,
    build: buildAgreementBatches,
    // A part the model answered badly is counted as unread instead of failing the whole agreement.
    validate: (raw, text, meta) => validateAgreementExtract(raw.map((output) => {
      try {
        return parseModelOutput(output);
      } catch {
        return null;
      }
    }), text, meta),
  },
};

// A long agreement runs up to 12 parts four at a time, each allowed BATCH_TIMEOUT_MS, so the job outlives that.
const JOB_TTL_MS = 15 * 60 * 1000;
export const BATCH_TIMEOUT_MS = 150_000;
const MEMORY_KEEP = 300;
const memory = new Map<string, AnyExtract>();
const jobs = new Map<string, { kind: ExtractKind; companyId: string; sha256: string; filename: string; text: string; truncated: boolean; partKeys: string[]; expires: number }>();
/** Agreement parts by request hash: a page group with the same text gets the same reply, in any PDF of that company. */
export const PART_CACHE_PREFIX = "agreement-part:";
const PART_MEMORY_KEEP = 600;
const partMemory = new Map<string, unknown[]>();

export function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 5 && Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-";
}

export async function prepareExtract<K extends ExtractKind = "invoice">(
  companyId: string,
  filename: string,
  bytes: Uint8Array,
  refresh = false,
  kind: K = "invoice" as K,
): Promise<Prepared<K>> {
  if (!isPdf(bytes)) return { result: "not-pdf" };
  const sha256 = sha256Of(bytes);
  if (!refresh) {
    const hit = await cachedExtract(companyId, sha256, kind);
    if (hit) return { result: "cached", extract: hit };
  }
  let text: string;
  try {
    text = await pdfText(bytes, { joinWrappedHeaders: kind === "agreement" });
  } catch {
    return { result: "pdf" };
  }
  if (text.replace(/\s/g, "").length < 20) return { result: "no-text" };
  const { batches, plans = [], truncated } = SPECS[kind].build(text);
  const partKeys = kind === "agreement" ? batches.map(partKey) : [];
  if (!refresh) {
    await Promise.all(partKeys.map(async (key, index) => {
      const cached = plans[index] ? await cachedPart(companyId, key) : null;
      if (cached) plans[index] = { ...plans[index], cached };
    }));
  }
  return { result: "ready", kind, sha256, filename, text, batches, plans, truncated, partKeys };
}

export function partKey(batch: AiInputs): string {
  return createHash("sha256").update(`${EXTRACT_MODEL}\n${AGREEMENT_EXTRACT_VERSION}\n${JSON.stringify(batch)}`).digest("hex");
}

export async function finishExtract<K extends ExtractKind>(
  companyId: string,
  prepared: Extract<Prepared<K>, { result: "ready" }>,
  output: unknown,
  parts?: PartReport[],
): Promise<ExtractOf<K>> {
  const outputs = Array.isArray(output) ? output : [output];
  const extract = SPECS[prepared.kind].validate(outputs, prepared.text, {
    sha256: prepared.sha256,
    filename: prepared.filename,
    truncated: prepared.truncated,
    usage: totalUsage(outputs),
    parts,
  }) as ExtractOf<K>;
  await storeExtract(companyId, prepared.kind, extract);
  await storeParts(companyId, prepared.partKeys, outputs, parts);
  return extract;
}

function totalUsage(outputs: unknown[]): InvoiceExtract["usage"] {
  const parts = outputs.map(modelUsage).filter((usage) => usage !== null);
  if (!parts.length) return null;
  return parts.reduce((sum, usage) => ({
    inputTokens: sum.inputTokens + usage.inputTokens,
    outputTokens: sum.outputTokens + usage.outputTokens,
    usd: Math.round((sum.usd + usage.usd) * 1e8) / 1e8,
  }));
}

/**
 * Runs every batch, a few at a time, in page order. A part that times out, fails or comes back holding too few of its
 * own printed prices is read again (as two halves when it has a plan), so a lost part is retried instead of dropped.
 */
export async function runParts(
  run: AiRun,
  batches: AiInputs[],
  plans: PartPlan[] = [],
  onProgress?: (done: number, total: number) => void,
  timeoutMs = BATCH_TIMEOUT_MS,
  concurrency = 4,
): Promise<{ outputs: unknown[]; reports: PartReport[] }> {
  const { outputs, reports, errors } = await readParts((inputs) => run(EXTRACT_MODEL, inputs as AiInputs), batches, plans, { concurrency, timeoutMs, onProgress });
  if (reports.every((report) => report.failed)) throw new Error(errors[0] ?? "Workers AI svarede ikke.");
  return { outputs, reports };
}

/** Full run with an injected model call, used by the REST fallback and by tests. */
export async function extractInvoice(companyId: string, filename: string, bytes: Uint8Array, run: AiRun, refresh = false) {
  const prepared = await prepareExtract(companyId, filename, bytes, refresh);
  if (prepared.result !== "ready") return prepared;
  const { outputs, reports } = await runParts(run, prepared.batches, prepared.plans);
  const extract = await finishExtract(companyId, prepared, outputs, reports);
  return { result: "extracted" as const, extract };
}

export async function extractAgreement(companyId: string, filename: string, bytes: Uint8Array, run: AiRun, refresh = false) {
  const prepared = await prepareExtract(companyId, filename, bytes, refresh, "agreement");
  if (prepared.result !== "ready") return prepared;
  const { outputs, reports } = await runParts(run, prepared.batches, prepared.plans);
  const extract = await finishExtract(companyId, prepared, outputs, reports);
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

export function openJob<K extends ExtractKind>(companyId: string, prepared: Extract<Prepared<K>, { result: "ready" }>): ExtractJob {
  const now = Date.now();
  for (const [id, job] of jobs) if (job.expires < now) jobs.delete(id);
  const id = randomBytes(18).toString("hex");
  jobs.set(id, {
    kind: prepared.kind,
    companyId,
    sha256: prepared.sha256,
    filename: prepared.filename,
    text: prepared.text,
    truncated: prepared.truncated,
    partKeys: prepared.partKeys,
    expires: now + JOB_TTL_MS,
  });
  return { id, model: EXTRACT_MODEL, inputs: prepared.batches[0], batches: prepared.batches, plans: prepared.plans };
}

/** `output` is one reply per batch, or a single reply from a Durable Object that predates `batches`. */
export async function closeJob(id: string, output: unknown, parts?: PartReport[]): Promise<AnyExtract | "missing"> {
  const job = jobs.get(id);
  jobs.delete(id);
  if (!job || job.expires < Date.now()) return "missing";
  return finishExtract<ExtractKind>(job.companyId, { result: "ready", ...job, batches: [], plans: [] }, output, parts);
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

export async function cachedExtract<K extends ExtractKind = "invoice">(
  companyId: string,
  sha256: string,
  kind: K = "invoice" as K,
): Promise<ExtractOf<K> | null> {
  const { prefix, version } = SPECS[kind];
  const key = `${companyId}\n${prefix}${sha256}`;
  if (tableUsable()) {
    try {
      const rows = await postgresSql<{ extract: unknown }>(
        "select extract from public.invoice_extracts where company_id = $1 and content_sha256 = $2 and version = $3",
        [companyId, prefix + sha256, version],
      );
      const value = rows[0]?.extract;
      const parsed = typeof value === "string" ? JSON.parse(value) as ExtractOf<K> : value as ExtractOf<K> | undefined;
      if (parsed) return parsed;
    } catch (error) {
      noteTableError(error);
    }
  }
  const kept = memory.get(key);
  return kept?.version === version ? kept as ExtractOf<K> : null;
}

async function storeExtract(companyId: string, kind: ExtractKind, extract: AnyExtract): Promise<void> {
  const contentKey = SPECS[kind].prefix + extract.sha256;
  const key = `${companyId}\n${contentKey}`;
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
      [companyId, contentKey, extract.version, extract.model, extract.confidence, JSON.stringify(extract)],
    );
  } catch (error) {
    // The table is optional. The in-process copy above still answers repeat requests.
    noteTableError(error);
  }
}

async function cachedPart(companyId: string, key: string): Promise<unknown[] | null> {
  if (tableUsable()) {
    try {
      const rows = await postgresSql<{ extract: unknown }>(
        "select extract from public.invoice_extracts where company_id = $1 and content_sha256 = $2 and version = $3",
        [companyId, PART_CACHE_PREFIX + key, AGREEMENT_EXTRACT_VERSION],
      );
      const value = rows[0]?.extract;
      const parsed = (typeof value === "string" ? JSON.parse(value) : value) as { outputs?: unknown } | undefined;
      if (Array.isArray(parsed?.outputs) && parsed.outputs.length) return parsed.outputs;
    } catch (error) {
      noteTableError(error);
    }
  }
  return partMemory.get(`${companyId}\n${key}`) ?? null;
}

/**
 * Keeps each part's replies under its request hash. Only a part read in full counts: a failed or short read, or one
 * that came from this cache, is not stored, so a bad reply is read again next time instead of being repeated.
 */
async function storeParts(companyId: string, keys: string[], outputs: unknown[], reports?: PartReport[]): Promise<void> {
  if (!keys.length || !reports || reports.length !== keys.length || reports.some((report) => typeof report.outputs !== "number")) return;
  let at = 0;
  for (const [index, report] of reports.entries()) {
    const own = outputs.slice(at, at + (report.outputs ?? 0));
    at += report.outputs ?? 0;
    if (report.failed || report.cached || partShort(report.captured, report.expected) || !own.length || own.some((output) => !output)) continue;
    // Token usage stays with the read that paid for it.
    const kept = own.map((output) => output && typeof output === "object" && "response" in output ? { response: (output as { response: unknown }).response } : output);
    const memoryKey = `${companyId}\n${keys[index]}`;
    partMemory.delete(memoryKey);
    partMemory.set(memoryKey, kept);
    while (partMemory.size > PART_MEMORY_KEEP) {
      const oldest = partMemory.keys().next().value;
      if (oldest === undefined) break;
      partMemory.delete(oldest);
    }
    if (!tableUsable()) continue;
    try {
      await postgresSql(
        `insert into public.invoice_extracts (company_id, content_sha256, version, model, confidence, extract)
         values ($1, $2, $3, $4, 'part', $5::jsonb)
         on conflict (company_id, content_sha256) do update
         set version = excluded.version, model = excluded.model, confidence = excluded.confidence,
             extract = excluded.extract, created_at = now()`,
        [companyId, PART_CACHE_PREFIX + keys[index], AGREEMENT_EXTRACT_VERSION, EXTRACT_MODEL, JSON.stringify({ outputs: kept })],
      );
    } catch (error) {
      noteTableError(error);
    }
  }
}
