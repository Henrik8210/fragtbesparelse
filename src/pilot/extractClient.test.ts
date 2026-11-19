import { afterEach, describe, expect, it, vi } from "vitest";
import { extractAgreementUpload, readLines } from "./extractClient.ts";

const stream = (chunks: string[]) => new ReadableStream<Uint8Array>({
  start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
    controller.close();
  },
});

const ndjson = (chunks: string[]) => new Response(stream(chunks), { headers: { "content-type": "application/x-ndjson" } });
const file = new File(["%PDF-1.4"], "aftale.pdf", { type: "application/pdf" });

afterEach(() => vi.unstubAllGlobals());

describe("readLines", () => {
  it("reads lines split across chunks and skips a torn one", async () => {
    const lines: unknown[] = [];
    await readLines(stream(['{"progress":{"done":0,', '"total":2}}\n{"progress":{"done":1}}\n{"sta', 'tus":200}\n{"torn"']), (line) => lines.push(line));
    expect(lines).toEqual([{ progress: { done: 0, total: 2 } }, { progress: { done: 1 } }, { status: 200 }]);
  });
});

describe("extractAgreementUpload", () => {
  it("reports each finished part and returns the extract", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ndjson([
      '{"progress":{"done":0,"total":2}}\n{"progress":{"waitingMs":15000}}\n{"progress":{"done":1,"total":2}}\n',
      '{"progress":{"done":2,"total":2}}\n{"status":200,"body":{"extract":{"kind":"agreement"}}}\n',
    ])));
    const progress: string[] = [];
    const extract = await extractAgreementUpload(file, "nordhavn-living", (step) => progress.push(`${step.done}/${step.total}`));
    expect(extract).toEqual({ kind: "agreement" });
    expect(progress).toEqual(["0/2", "0/2", "1/2", "2/2"]);
  });

  it("ends in a clear error when the stream stops without a result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ndjson(['{"progress":{"done":0,"total":2}}\n'])));
    await expect(extractAgreementUpload(file, "nordhavn-living")).rejects.toMatchObject({ code: "network" });
  });

  it("passes on the server's message for a failed read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ndjson(['{"status":502,"body":{"error":"ai","message":"Workers AI: fejl"}}\n'])));
    await expect(extractAgreementUpload(file, "nordhavn-living")).rejects.toMatchObject({ code: "ai", message: "Workers AI: fejl" });
  });

  it("stops after the time limit", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    await expect(extractAgreementUpload(file, "nordhavn-living", undefined, 30)).rejects.toMatchObject({ code: "timeout" });
  });
});
