// Kept free of imports so the Durable Object bundles it next to the AI binding.

/** Below this share of a part's own printed prices, the part is read again as two halves. */
export const PART_MIN_SHARE = 0.6;
/** A part with fewer printed prices than this is never judged short; it is mostly prose. */
export const PART_MIN_PRICES = 8;

export type PartPlan = {
  /** First and last PDF page the part holds, counted from 1. */
  pages: [number, number];
  /** The distinct decimal numbers printed in the part, in øre. */
  prices: number[];
  /** The part split in two, each a complete model request, read when the whole part comes back short. */
  halves: unknown[];
};

export type PartReport = { pages: [number, number]; expected: number; captured: number; retried: boolean; failed: boolean };

export type AiCall = (inputs: unknown) => Promise<unknown>;

const NUMBER = /(?<![\d.,])\d{1,3}(?:\.\d{3})*,\d{1,4}(?![\d,])|(?<![\d.,])\d+,\d{1,4}(?![\d,])/g;

function danishValue(token: string): number | null {
  const parsed = Number(token.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : null;
}

/** Distinct decimal numbers printed in Danish form ("1.234,56", "8,40"), in øre. */
export function printedOre(text: string): Set<number> {
  const found = new Set<number>();
  const joined = text.normalize("NFKC").replace(/[\u00a0\u2007\u2009\u202f]/g, " ");
  for (const [token] of joined.matchAll(NUMBER)) {
    const value = danishValue(token);
    if (value !== null) found.add(value);
  }
  return found;
}

/** Every number a model reply holds, whether it wrote 1234.56, "1.234,56" or "1234,56", in øre. */
export function heldOre(output: unknown): Set<number> {
  const found = new Set<number>();
  const value = output && typeof output === "object" && "response" in output ? (output as { response: unknown }).response : output;
  const visit = (node: unknown) => {
    if (typeof node === "number") {
      if (Number.isFinite(node) && node > 0) found.add(Math.round(node * 100));
    } else if (typeof node === "string") {
      for (const item of printedOre(node)) found.add(item);
      for (const [token] of node.matchAll(/(?<![\d.,])\d+(?:\.\d{1,4})?(?![\d.,])/g)) {
        const parsed = Number(token);
        if (Number.isFinite(parsed) && parsed > 0) found.add(Math.round(parsed * 100));
      }
    } else if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === "object") Object.values(node).forEach(visit);
  };
  if (typeof value === "string") {
    try {
      visit(JSON.parse(value.slice(value.indexOf("{"), value.lastIndexOf("}") + 1)));
    } catch {
      return found;
    }
  } else visit(value);
  return found;
}

/** How many of the part's printed prices the reply holds. A missing or unreadable reply holds none. */
export function partCaptured(output: unknown, prices: number[]): number {
  if (!output) return 0;
  const held = heldOre(output);
  return prices.filter((price) => held.has(price)).length;
}

export function partShort(captured: number, expected: number): boolean {
  return expected >= PART_MIN_PRICES ? captured < expected * PART_MIN_SHARE : false;
}

async function timed(call: AiCall, inputs: unknown, timeoutMs: number, errors: string[]): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      errors.push(`Workers AI svarede ikke inden for ${Math.round(timeoutMs / 1000)} sekunder.`);
      resolve(null);
    }, timeoutMs);
  });
  const answer = call(inputs).catch((error: unknown) => {
    errors.push(error instanceof Error ? error.message : "Workers AI svarede ikke.");
    return null;
  });
  try {
    return await Promise.race([answer, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads every part, a few at a time. A part that times out, fails or holds too few of its own printed prices is read
 * again as two halves, and the better of the two readings is kept. Outputs come back flat, in page order, with one
 * report per planned part so the review can name pages that were still not read.
 */
export async function readParts(
  call: AiCall,
  batches: unknown[],
  plans: (PartPlan | undefined)[],
  options: { concurrency: number; timeoutMs: number; onProgress?: (done: number, total: number) => void },
): Promise<{ outputs: unknown[]; reports: PartReport[]; errors: string[] }> {
  const errors: string[] = [];
  const results: { outputs: unknown[]; report: PartReport }[] = new Array(batches.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < batches.length) {
      const index = next++;
      const plan = plans[index];
      const prices = plan?.prices ?? [];
      const first = await timed(call, batches[index], options.timeoutMs, errors);
      let outputs = [first];
      let captured = partCaptured(first, prices);
      let retried = false;
      if ((!first || partShort(captured, prices.length)) && plan?.halves.length) {
        retried = true;
        const halves = await Promise.all(plan.halves.map((half) => timed(call, half, options.timeoutMs, errors)));
        const held = new Set<number>();
        for (const half of halves) if (half) for (const value of heldOre(half)) held.add(value);
        const halvesCaptured = prices.filter((price) => held.has(price)).length;
        if (!first || halvesCaptured > captured) {
          outputs = halves;
          captured = halvesCaptured;
        }
      } else if (!first) {
        retried = true;
        const again = await timed(call, batches[index], options.timeoutMs, errors);
        outputs = [again];
        captured = partCaptured(again, prices);
      }
      const failed = outputs.every((output) => !output);
      results[index] = { outputs, report: { pages: plan?.pages ?? [0, 0], expected: prices.length, captured, retried, failed } };
      done += 1;
      options.onProgress?.(done, batches.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency, batches.length) }, worker));
  return { outputs: results.flatMap((result) => result.outputs), reports: results.map((result) => result.report), errors };
}

export function pagesLabel([from, to]: [number, number]): string {
  if (!from) return "En del af PDF'en";
  return from === to ? `Side ${from}` : `Side ${from}–${to}`;
}

/** Danish review lines for parts that were still short or unread after the retry. */
export function lostPartIssues(reports: PartReport[]): string[] {
  return reports.filter((report) => report.failed || partShort(report.captured, report.expected)).map((report) =>
    report.failed
      ? `${pagesLabel(report.pages)} kunne ikke læses, heller ikke ved andet forsøg. Priserne derfra mangler.`
      : `${pagesLabel(report.pages)} blev kun delvist læst (${report.captured} af ${report.expected} priser), også ved andet forsøg. Tjek priserne derfra.`);
}
